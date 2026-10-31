import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {handleWorkspaceRequest} from '../lib/workspace-api.mjs';
import {enableDrops,saveDropPackage,deleteDropPackage} from '../public/editor/drops.mjs';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
import {handleImageRequest} from '../lib/images-api.mjs';
const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB'],r2Buckets:['BUCKET']});
try {
  const db=await runtime.getD1Database('DB');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
    const sql=readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8');
    await db.batch(sql.split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s.trim())));
  }
  const workspace={categories:[{key:'equipment',name:'装备',start:1,end:10000}],enums:[],tables:{equipment:{fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'value',label:'数值',type:'uint64',required:true},{key:'enabled',label:'启用',type:'bool',required:true}],rows:Array.from({length:10000},(_,i)=>({id:i+1,value:'18446744073709551615',enabled:false}))}}};
  const request=(owner,method='GET',body,path='/api/workspace')=>new Request('https://local.test'+path,{method,headers:{'oai-authenticated-user-id':owner,'Content-Type':'application/json',Origin:'https://local.test'},...(body?{body:JSON.stringify(body)}:{})});
  const result=await handleWorkspaceRequest(request('first','POST',{workspace,expectedRevision:0,requestId:'scale-test'},'/api/workspace/migrate'),db);
  assert.equal(result.status,200,await result.clone().text());
  const fetched=await (await handleWorkspaceRequest(request('first'),db)).json();
  assert.equal(fetched.workspace.tables.equipment.rows.length,10000);
  assert.deepEqual(fetched.workspace.tables.equipment.rows[9999],{id:10000,value:'18446744073709551615',enabled:false});
  assert.equal((await (await handleWorkspaceRequest(request('other'),db)).json()).workspace,null);
  const left=structuredClone(workspace),right=structuredClone(workspace);left.categories[0].name='A';right.categories[0].name='B';
  const responses=await Promise.all([left,right].map(workspace=>handleWorkspaceRequest(request('first','PUT',{workspace,expectedRevision:1}),db)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const accepted=await (await handleWorkspaceRequest(request('first'),db)).json();
  const broken={prepare:sql=>db.prepare(sql),batch:statements=>db.batch([...statements,db.prepare('SELECT * FROM deliberate_missing_test_table')])};
  const originalConsole=console.error;console.error=()=>{};
  try {assert.equal((await handleWorkspaceRequest(request('first','PUT',{workspace,expectedRevision:2}),broken)).status,503);}
  finally{console.error=originalConsole;}
  const after=await (await handleWorkspaceRequest(request('first'),db)).json();
  assert.equal(after.revision,2);assert.deepEqual(after.workspace,accepted.workspace);
  const small=structuredClone(workspace);small.tables.equipment.rows=small.tables.equipment.rows.slice(0,2);
  const drops=normalizeWorkspace(saveDropPackage(normalizeWorkspace(enableDrops(small,{start:10001,end:10009},{start:10010,end:10100})),{id:10001,name:'混合奖励',selection_mode:'probability'},[
    {id:10010,package_id:10001,weight:4294967295,probability:10000,rewards:[{asset_id:1,count:3,probability:5000},{asset_id:2,count:1,probability:0}]},
    {id:10011,package_id:10001,weight:1,probability:0,rewards:[{asset_id:1,count:1,probability:10000}]}
  ]));
  assert.equal((await handleWorkspaceRequest(request('drops','POST',{workspace:drops,expectedRevision:0,requestId:'drops'},'/api/workspace/migrate'),db)).status,200);
  assert.deepEqual((await (await handleWorkspaceRequest(request('drops'),db)).json()).workspace,drops);
  console.error=()=>{};
  try{assert.equal((await handleWorkspaceRequest(request('drops','PUT',{workspace:deleteDropPackage(drops,10001),expectedRevision:1}),broken)).status,503);}
  finally{console.error=originalConsole;}
  assert.deepEqual((await (await handleWorkspaceRequest(request('drops'),db)).json()).workspace,drops,'failed aggregate deletion must roll back both tables');
  assert.equal((await handleWorkspaceRequest(request('drops','PUT',{workspace:deleteDropPackage(drops,10001),expectedRevision:1}),db)).status,200);
  assert.equal((await (await handleWorkspaceRequest(request('drops'),db)).json()).workspace.tables.drop_entry.rows.length,0);
  const bucket=await runtime.getR2Bucket('BUCKET');
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=','base64'));
  const uploaded=await handleImageRequest(new Request('https://local.test/api/images',{method:'POST',headers:{'oai-authenticated-user-id':'png-owner','Content-Type':'image/png',Origin:'https://local.test'},body:png}),bucket);
  assert.equal(uploaded.status,200,await uploaded.clone().text());const {path}=await uploaded.json();
  const pngWorkspace={categories:[{key:'base',name:'基础数值',start:1,end:9}],enums:[],tables:{base:{fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'icon',label:'图标',type:'png',required:false}],rows:[{id:1,icon:path}]}}};
  assert.equal((await handleWorkspaceRequest(request('png-owner','POST',{workspace:pngWorkspace,expectedRevision:0,requestId:'png'},'/api/workspace/migrate'),db,bucket)).status,200);
  assert.deepEqual((await (await handleWorkspaceRequest(request('png-owner'),db,bucket)).json()).workspace,pngWorkspace);
  const imageRequest=owner=>new Request('https://local.test/api/images?file='+encodeURIComponent(path),{headers:{'oai-authenticated-user-id':owner}});
  assert.deepEqual(new Uint8Array(await (await handleImageRequest(imageRequest('png-owner'),bucket)).arrayBuffer()),png);
  assert.equal((await handleImageRequest(imageRequest('other'),bucket)).status,404);
  assert.equal((await handleWorkspaceRequest(request('other','POST',{workspace:pngWorkspace,expectedRevision:0,requestId:'png-steal'},'/api/workspace/migrate'),db,bucket)).status,400);
  console.log('R2 integration passed: exact PNG upload/read, D1 reference round trip, account isolation and unauthorized-reference rejection.');
  console.log('D1 integration passed: 10000 rows, exact uint64/false, account isolation, concurrent CAS, combination mode/probabilities, reward probabilities and aggregate rollback/deletion.');
} finally {await runtime.dispose();}
