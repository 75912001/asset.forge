import {normalizeWorkspace} from '../public/editor/workspace.mjs';
import {assertDropTransition} from '../public/editor/drops.mjs';
import {pngReferences} from '../public/editor/png.mjs';
import {imageStorageKey} from './images-api.mjs';
class HttpError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
const conflict=()=>new HttpError(409,'本地版本已更新. 本机修改已保留, 请先下载草稿备份再加载本地.');
function entries(workspace) {
  const result=[];
  const add=(kind,key,position,value)=>result.push({kind,key,position,payload:JSON.stringify(value)});
  workspace.categories.forEach((category,index)=>{
    add('category',category.key,index,category);
    const table=workspace.tables[category.key];add('table',category.key,index,table.fields);
    table.rows.forEach((record,position)=>add('row',`${category.key}:${record.id}`,position,record));
  });
  workspace.enums.forEach((definition,index)=>add('enum',definition.key,index,definition));
  add('hero_motion','shared',0,workspace.heroMotion);
  return result;
}
async function read(db,owner) {
  const [metadata,records]=await db.batch([
    db.prepare('SELECT * FROM workspaces WHERE owner_id=?').bind(owner),
    db.prepare('SELECT kind,entry_key,payload FROM workspace_records WHERE owner_id=? ORDER BY position').bind(owner)
  ]);
  const meta=metadata.results[0];
  if(!meta||meta.revision===0)return {workspace:null,revision:0};
  const workspace={categories:[],tables:{},enums:[]},dataRows=[];
  for(const record of records.results) {
    const value=JSON.parse(record.payload);
    if(record.kind==='category')workspace.categories.push(value);
    else if(record.kind==='enum')workspace.enums.push(value);
    else if(record.kind==='chest_appearance')throw new HttpError(409,'旧宝箱外观配置需要停服后执行 node scripts/migrate-chest-types.mjs <项目标识>');
    else if(record.kind==='hero_motion')workspace.heroMotion=value;
    else if(record.kind==='table')workspace.tables[record.entry_key]={fields:value,rows:[]};
    else if(record.kind==='row')dataRows.push([record.entry_key.split(':')[0],value]);
  }
  for(const [key,value] of dataRows)workspace.tables[key].rows.push(value);
  return {workspace:normalizeWorkspace(workspace),revision:meta.revision,updatedAt:meta.updated_at,migrationId:meta.migration_id,migrationHash:meta.migration_hash};
}
async function save(db,owner,body,migrate,bucket) {
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new HttpError(400,'缺少有效的 expectedRevision');
  let workspace;
  try {workspace=normalizeWorkspace(body.workspace);}catch(error){throw new HttpError(400,error.message);}
  if(Object.values(workspace.tables).reduce((count,table)=>count+table.rows.length,0)>10000)throw new HttpError(400,'首版最多支持 10000 行资产数据');
  const current=await read(db,owner);
  let hash=null;
  if(migrate) {
    if(body.expectedRevision!==0||typeof body.requestId!=='string'||!body.requestId||body.requestId.length>100)throw new HttpError(400,'迁移请求无效');
    hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(workspace)))),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(current.workspace&&current.migrationId===body.requestId&&current.migrationHash===hash)return current;
    if(current.workspace)throw conflict();
  } else if(!current.workspace)throw new HttpError(409,'尚未迁移. 请先在保存旧数据的原浏览器完成迁移.');
  if(current.revision!==body.expectedRevision)throw conflict();
  for(const path of pngReferences(workspace)) {
    if(!bucket)throw new HttpError(503,'图片存储暂不可用, 本机修改已保留');
    if(!await bucket.head(imageStorageKey(owner,path)))throw new HttpError(400,'PNG 资源不存在, 请检查资源目录和相对路径');
  }
  if(current.workspace)try{assertDropTransition(current.workspace,workspace);}catch(error){throw new HttpError(400,error.message);}
  const now=new Date().toISOString(),revision=body.expectedRevision,statements=[];
  if(migrate)statements.push(db.prepare('INSERT OR IGNORE INTO workspaces(owner_id,revision,updated_at) VALUES(?,0,?)').bind(owner,now));
  statements.push(db.prepare('DELETE FROM workspace_records WHERE owner_id=? AND EXISTS(SELECT 1 FROM workspaces WHERE owner_id=? AND revision=?)').bind(owner,owner,revision));
  const all=entries(workspace);
  // D1 batches are transactional. Every write checks the same revision until the final CAS.
  for(let index=0;index<all.length;index+=250) {
    statements.push(db.prepare(`INSERT INTO workspace_records(owner_id,kind,entry_key,position,payload)
      SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.key'),json_extract(value,'$.position'),json_extract(value,'$.payload')
      FROM json_each(?) WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner_id=? AND revision=?)`).bind(owner,JSON.stringify(all.slice(index,index+250)),owner,revision));
  }
  statements.push(migrate
    ?db.prepare('UPDATE workspaces SET revision=revision+1,updated_at=?,migration_id=?,migration_hash=? WHERE owner_id=? AND revision=?').bind(now,body.requestId,hash,owner,revision)
    :db.prepare('UPDATE workspaces SET revision=revision+1,updated_at=? WHERE owner_id=? AND revision=?').bind(now,owner,revision));
  const result=await db.batch(statements);
  if(result.at(-1).meta.changes!==1)throw conflict();
  return {workspace,revision:revision+1,updatedAt:now};
}
export async function handleWorkspaceRequest(request,db,bucket) {
  const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
  const json=(body,status=200)=>Response.json(body,{status,headers});
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner)return json({error:'请先使用 ChatGPT 登录',signIn:'/signin-with-chatgpt?return_to=%2F'},401);
  const url=new URL(request.url),migrate=url.pathname==='/api/workspace/migrate';
  try {
    let result;
    if(request.method==='GET'&&!migrate)result=await read(db,owner);
    else if(request.method===(migrate?'POST':'PUT')) {
      if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new HttpError(403,'仅允许本站提交保存');
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(400,'请提交 JSON 数据');
      let body;try{body=await request.json();}catch{throw new HttpError(400,'JSON 数据格式无效');}
      if(!body||typeof body!=='object')throw new HttpError(400,'请求格式无效');
      if(body.expectedUserId&&body.expectedUserId!==owner)throw new HttpError(409,'登录账号发生变化. 请备份草稿并重新加载本地.');
      result=await save(db,owner,body,migrate,bucket);
    } else throw new HttpError(405,'不支持此请求方法');
    const {migrationId,migrationHash,...data}=result;
    return json({...data,user:{id:owner,name:request.headers.get('oai-authenticated-user-email')||'当前账号'}});
  } catch(error) {
    if(!error.status)console.error('Workspace storage failed',error);
    return json({error:error.status?error.message:'本地存储暂不可用. 本机修改未丢失, 请稍后重试.'},error.status||503);
  }
}
