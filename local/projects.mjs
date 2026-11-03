import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile,readdir,realpath,lstat,rename,rm,copyFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {openStore,LOCAL_OWNER} from './store.mjs';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
import {pngReferences} from '../public/editor/png.mjs';

export const within=(root,path)=>{const tail=relative(root,path);return !isAbsolute(tail)&&tail!=='..'&&!tail.startsWith('..\\')&&!tail.startsWith('../');};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function validateProjectId(id) {
  if(typeof id!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(id)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(id))throw fail('项目标识需以小写字母开头, 仅含小写字母、数字或下划线, 最长 64 位, 不能使用 Windows 保留名称');
  return id;
}
function projectMetadata(input) {
  if(!input||typeof input!=='object')throw fail('项目数据格式无效');
  const id=validateProjectId(input.id);
  if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>100)throw fail('请填写 1-100 字的项目显示名称');
  return {id,name:input.name.trim()};
}
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function writeAtomic(path,contents) {
  const temp=path+'.'+crypto.randomUUID()+'.tmp';
  try{await writeFile(temp,contents,'utf8');await rename(temp,path);}
  catch(error){await rm(temp,{force:true});throw error;}
}
// 只复制普通文件和目录. 符号链接可能跳出项目边界, 迁移时显式报错.
async function copyTree(source,target) {
  if((await lstat(source)).isSymbolicLink())throw fail('迁移源目录不能是符号链接: '+source);
  await mkdir(target,{recursive:true});
  for(const entry of await readdir(source,{withFileTypes:true})) {
    const from=join(source,entry.name),to=join(target,entry.name);
    if(entry.isSymbolicLink())throw fail('迁移资源包含符号链接: '+from);
    if(entry.isDirectory())await copyTree(from,to);
    else if(entry.isFile()) {
      const digest=createHash('sha256').update(await readFile(from)).digest('hex');
      await copyFile(from,to);
      if(digest!==createHash('sha256').update(await readFile(to)).digest('hex'))throw fail('迁移文件校验失败: '+from);
    } else throw fail('迁移资源包含不支持的文件: '+from);
  }
}
function databaseContents(sqlite) {
  if(sqlite.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw fail('旧数据库完整性检查失败');
  const metadata=sqlite.prepare('SELECT * FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER);
  if(!metadata||!Number.isSafeInteger(metadata.revision)||metadata.revision<1)throw fail('旧数据库缺少有效的本地工作区');
  const records=sqlite.prepare('SELECT kind,entry_key,position,payload FROM workspace_records WHERE owner_id=? ORDER BY kind,entry_key').all(LOCAL_OWNER);
  const workspace={categories:[],tables:{},enums:[],chestAppearances:[]},rows=[];
  for(const record of [...records].sort((a,b)=>a.position-b.position)) {
    const value=JSON.parse(record.payload);
    if(record.kind==='category')workspace.categories.push(value);
    else if(record.kind==='table')workspace.tables[record.entry_key]={fields:value,rows:[]};
    else if(record.kind==='enum')workspace.enums.push(value);
    else if(record.kind==='chest_appearance')workspace.chestAppearances.push(value);
    else if(record.kind==='hero_motion')workspace.heroMotion=value;
    else if(record.kind==='row')rows.push([record.entry_key.split(':')[0],value]);
    else throw fail('旧数据库包含未知记录类型');
  }
  for(const [key,value] of rows){if(!workspace.tables[key])throw fail('旧数据库包含孤立资产记录');workspace.tables[key].rows.push(value);}
  normalizeWorkspace(workspace);
  return {serialized:JSON.stringify({metadata,records}),workspace};
}

export async function openProjects({root,dataDir=join(root,'data'),resourceDir,seed,projectsDir=join(root,'projects')}) {
  await mkdir(projectsDir,{recursive:true});
  const base=await realpath(projectsDir),stores=new Map();
  if(base!==resolve(projectsDir))throw fail('projects 根目录不能使用符号链接');
  const close=()=>{for(const store of stores.values())store.close();stores.clear();};
  async function projectPath(id) {
    validateProjectId(id);
    const path=join(base,id),actual=await realpath(path);
    if(actual!==path||!within(base,actual))throw fail('项目目录不能使用符号链接');
    return path;
  }
  async function read(id) {
    const folder=await projectPath(id),metadataPath=join(folder,'project.json');
    if((await lstat(metadataPath)).isSymbolicLink())throw fail('项目元数据不能使用符号链接');
    const raw=JSON.parse(await readFile(metadataPath,'utf8'));
    const meta=projectMetadata(raw);
    if(meta.id!==id)throw fail('项目目录与元数据标识不一致: '+id);
    return {...meta,...(raw.legacyMigration===1?{legacyMigration:1}: {})};
  }
  async function list() {
    const projects=[];
    for(const entry of await readdir(base,{withFileTypes:true})) {
      if(entry.name.startsWith('.'))continue;
      if(entry.isSymbolicLink())throw fail('项目目录不能使用符号链接: '+entry.name);
      if(entry.isDirectory())projects.push(await read(entry.name));
    }
    return projects.sort((a,b)=>a.id.localeCompare(b.id));
  }
  // 先独占目标目录, 最后写 project.json. 失败清理仅限本次创建的目录.
  // 创建过程中的目录不应被其他请求列出, 因此操作由队列串行化.
  let pending=Promise.resolve();
  function mutate(action){const result=pending.then(action);pending=result.catch(()=>{});return result;}
  async function create(input,initialize) {
    const meta=projectMetadata(input),folder=join(base,meta.id);
    if(!within(base,folder)||folder===base)throw fail('项目目录超出 projects 根目录');
    try{await mkdir(folder);}catch(error){if(error.code==='EEXIST')throw fail('项目标识或目录已存在',409);throw error;}
    try {
      await mkdir(join(folder,'assets'));await mkdir(join(folder,'cfg'));
      // Git 不保存空目录. 占位文件让空白项目在 clone 后仍具备固定目录结构.
      await writeFile(join(folder,'assets','.gitkeep'),'');await writeFile(join(folder,'cfg','.gitkeep'),'');
      if(initialize)await initialize(folder,meta);
      else {const store=openStore(join(folder,'workspace.sqlite'),root);store.close();}
      await writeAtomic(join(folder,'project.json'),JSON.stringify(meta,null,2)+'\n');
      return meta;
    } catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  }
  async function context(id) {
    const meta=await read(id),folder=await projectPath(id);
    // 已登记项目缺少数据库或目录时必须报错, 不能初始化空库掩盖损坏.
    for(const name of ['workspace.sqlite','assets','cfg']) {
      const path=join(folder,name),info=await lstat(path);
      if(info.isSymbolicLink()||(name==='workspace.sqlite'?!info.isFile():!info.isDirectory()))throw fail('项目文件或目录无效: '+path);
    }
    if(!stores.has(id))stores.set(id,openStore(join(folder,'workspace.sqlite'),root,undefined,{initialize:false}));
    return {meta,folder,store:stores.get(id),config:{resourcesRoot:join(folder,'assets'),exportRoot:join(folder,'cfg')}};
  }
  try {
    const legacyDb=join(dataDir,'workspace.sqlite'),seedPath=join(dataDir,'seed-workspace.json');
    const hasDatabase=await exists(legacyDb),hasSeed=seed!==undefined||await exists(seedPath);
    if(hasDatabase||hasSeed) {
      const destination=join(base,'mmorpg');
      if(await exists(destination)) {
        if((await read('mmorpg')).legacyMigration!==1)throw fail('mmorpg 目录已存在且未标记完成旧数据迁移, 不会覆盖');
        await context('mmorpg');
      } else {
        let config={resourcesRoot:resourceDir||join(root,'assets'),exportRoot:join(root,'cfg')};
        const configPath=join(dataDir,'local-config.json');
        if(await exists(configPath))config={...config,...JSON.parse(await readFile(configPath,'utf8'))};
        for(const key of ['resourcesRoot','exportRoot']) {
          if(typeof config[key]!=='string'||!config[key].trim())throw fail('旧目录配置无效: '+key);
          config[key]=resolve(root,config[key]);
          if(within(base,config[key])||within(config[key],base))throw fail('旧资源或导出目录与 projects 目录重叠');
        }
        await create({id:'mmorpg',name:'mmorpg'},async(folder,meta)=>{
          const target=join(folder,'workspace.sqlite');
          let workspace;
          if(hasDatabase) {
            const source=new DatabaseSync(legacyDb,{readOnly:true});
            try {
              // VACUUM INTO 通过 SQLite 生成包含已提交 WAL 的一致性快照.
              // 复制前后的逻辑内容还需一致, 源库并发变化时明确中止迁移.
              source.exec('BEGIN');const before=databaseContents(source);
              source.exec('ROLLBACK');
              source.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);
              const copied=new DatabaseSync(target,{readOnly:true});
              try{const after=databaseContents(copied);if(after.serialized!==before.serialized)throw fail('数据库迁移内容或版本校验失败');workspace=after.workspace;}finally{copied.close();}
            } finally{source.close();}
          } else {
            const initial=seed??JSON.parse(await readFile(seedPath,'utf8'));
            if(!initial?.workspace)throw fail('旧初始化快照无效');
            workspace=normalizeWorkspace(initial.workspace);
            const store=openStore(target,root,initial);store.close();
          }
          for(const [key,name] of [['resourcesRoot','assets'],['exportRoot','cfg']]) {
            if(!await exists(config[key]))throw fail('旧目录不存在: '+config[key]);
            await copyTree(config[key],join(folder,name));
          }
          for(const path of pngReferences(workspace)) {
            if(!await exists(join(folder,'assets',...path.split('/'))))throw fail('迁移资产引用的 PNG 不存在: '+path);
          }
          meta.legacyMigration=1;
        });
      }
    }
    await list();
    return {list:()=>mutate(list),read,context,close,
      create:input=>mutate(()=>create(input)),
      rename:(id,input)=>mutate(async()=>{
        if(input?.id!==undefined)throw fail('项目标识创建后不可修改');
        const previous=await read(id),next={...previous,...projectMetadata({id,name:input?.name})};
        await writeAtomic(join(await projectPath(id),'project.json'),JSON.stringify(next,null,2)+'\n');return next;
      })};
  } catch(error){close();throw error;}
}
