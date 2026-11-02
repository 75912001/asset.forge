import {chestEnum} from './chest-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {enableDrops,migrateLootBag,saveDropPackage,deleteDropPackage} from '../public/editor/drops.mjs';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
const api=await import('../lib/workspace-api.mjs').catch(()=>({}));
function database() {
  const sqlite=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  const db={prepare(sql){return {bind(...values){return {sql,values};}};},async batch(statements){
    sqlite.exec('BEGIN');try {const result=statements.map(({sql,values})=>{const statement=sqlite.prepare(sql);const results=statement.all(...values);return {results,meta:{changes:sqlite.prepare('select changes() count').get().count}};});sqlite.exec('COMMIT');return result;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};return db;
}
const workspace=()=>({categories:[{key:'equipment',name:'装备',start:100,end:199},{key:'drops',name:'掉落包',start:200,end:299}],enums:[{key:'slot',label:'部位',items:[{key:'undefined',label:'未定义',value:0},{key:'head',label:'头部',value:1}]}],tables:{equipment:{fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'slot',label:'部位',type:'enum',enum:'slot',required:true},{key:'amount',label:'数量',type:'uint64',required:true},{key:'enabled',label:'启用',type:'bool',required:true}],rows:[{id:100,slot:0,amount:'18446744073709551615',enabled:false}]},drops:{fields:[{key:'id',label:'ID',type:'uint32',required:true}],rows:[{id:200},{id:201}]}}});
function dropWorkspace() {
  const w=workspace();w.enums.push(chestEnum('chests/wood.png'));
  return normalizeWorkspace(enableDrops(w,{start:300,end:309},{start:310,end:399}));
}
async function call(db,{user='user-a',method='GET',body,path='/api/workspace',origin='https://forge.test',bucket={head:async key=>key==='user-a/chests/wood.png'?{}:null}}={}) {
  const headers={'Content-Type':'application/json','Origin':origin};if(user)headers['oai-authenticated-user-id']=user;
  const request=new Request('https://forge.test'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  const response=await api.handleWorkspaceRequest(request,db,bucket);return {status:response.status,data:await response.json()};
}

test('cloud saves reject unavailable PNG references before committing a revision',async()=>{
  const db=database(),draft=workspace(),path='images/'+'c'.repeat(64)+'.png';
  draft.tables.equipment.fields.push({key:'icon',label:'图标',type:'png',required:false});draft.tables.equipment.rows[0].icon=path;
  const body={workspace:draft,expectedRevision:0,requestId:'png'};
  const bucket={head:async key=>key==='user-a/'+path?{}:null};
  assert.equal((await call(db,{method:'POST',path:'/api/workspace/migrate',body,bucket:{head:async()=>null}})).status,400);
  assert.equal((await call(db)).data.revision,0);
  assert.equal((await call(db,{method:'POST',path:'/api/workspace/migrate',body,bucket})).status,200);
  assert.equal((await call(db)).data.workspace.tables.equipment.rows[0].icon,path);
});
test('workspace APIs require login and do not trust an owner supplied in the payload',async()=>{
  assert.equal(typeof api.handleWorkspaceRequest,'function','cloud API is missing');const db=database();
  assert.equal((await call(db,{user:null})).status,401);
  assert.equal((await call(db,{user:null,method:'POST',path:'/api/workspace/migrate',body:{workspace:workspace(),expectedRevision:0}})).status,401);
  const saved=await call(db,{method:'POST',path:'/api/workspace/migrate',body:{workspace:workspace(),expectedRevision:0,requestId:'migration-one',ownerId:'user-b'}});
  assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
  assert.equal((await call(db,{user:'user-b'})).data.workspace,null);
  assert.equal((await call(db,{user:'user-b',method:'POST',path:'/api/workspace/migrate',body:{workspace:workspace(),expectedRevision:0,requestId:'account-switch',expectedUserId:'user-a'}})).status,409);
  assert.equal((await call(db,{user:'user-b'})).data.workspace,null,'an account switch must not copy the previous account workspace');
  assert.deepEqual((await call(db)).data.workspace,workspace());
});
test('migration is explicit, preserves exact values, and retries do not overwrite cloud data',async()=>{
  assert.equal(typeof api.handleWorkspaceRequest,'function','cloud API is missing');const db=database();
  assert.equal((await call(db)).data.workspace,null);
  assert.equal((await call(db,{method:'PUT',body:{workspace:workspace(),expectedRevision:0}})).status,409);
  const body={workspace:workspace(),expectedRevision:0,requestId:'migration-two'};
  assert.equal((await call(db,{method:'POST',path:'/api/workspace/migrate',body})).status,200);
  const changed=workspace();changed.categories[0].name='装备新版';
  assert.equal((await call(db,{method:'PUT',body:{workspace:changed,expectedRevision:1}})).status,200);
  const retry=await call(db,{method:'POST',path:'/api/workspace/migrate',body});
  assert.equal(retry.data.revision,2);assert.equal(retry.data.workspace.categories[0].name,'装备新版');
  assert.equal((await call(db,{method:'POST',path:'/api/workspace/migrate',body:{...body,requestId:'another-device'}})).status,409);
  const record=(await call(db)).data.workspace.tables.equipment.rows[0];
  assert.deepEqual(record,{id:100,slot:0,amount:'18446744073709551615',enabled:false});
});
test('two saves from the same revision yield one commit and one conflict without mixed records',async()=>{
  assert.equal(typeof api.handleWorkspaceRequest,'function','cloud API is missing');const db=database();
  await call(db,{method:'POST',path:'/api/workspace/migrate',body:{workspace:workspace(),expectedRevision:0,requestId:'concurrent'}});
  const a=workspace(),b=workspace();a.categories[0].name='电脑A';b.categories[0].name='电脑B';a.tables.equipment.rows[0].slot=1;
  const responses=await Promise.all([a,b].map(workspace=>call(db,{method:'PUT',body:{workspace,expectedRevision:1}})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const saved=await call(db);assert.equal(saved.data.revision,2);assert.deepEqual(saved.data.workspace,a);
  const invalid=workspace();invalid.tables.equipment.rows[0].slot=7;
  assert.equal((await call(db,{method:'PUT',body:{workspace:invalid,expectedRevision:2}})).status,400);
  assert.deepEqual((await call(db)).data.workspace,a);
});
test('writes reject cross-origin requests, missing revisions, and more than ten thousand rows',async()=>{
  assert.equal(typeof api.handleWorkspaceRequest,'function','cloud API is missing');const db=database();
  assert.equal((await call(db,{method:'PUT',origin:'https://evil.test',body:{workspace:workspace(),expectedRevision:1}})).status,403);
  assert.equal((await call(db,{method:'PUT',body:{workspace:workspace()}})).status,400);
  const large=workspace();large.categories=[{key:'equipment',name:'装备',start:1,end:20000}];delete large.tables.drops;
  large.tables.equipment.rows=Array.from({length:10001},(_,i)=>({id:i+1,slot:0,amount:'0',enabled:false}));
  assert.equal((await call(db,{method:'POST',path:'/api/workspace/migrate',body:{workspace:large,expectedRevision:0,requestId:'large'}})).status,400);
});

test('drop aggregates persist arrays and reject conflicting saves, invalid deletes, and schema bypasses atomically',async()=>{
  const db=database();
  const base=dropWorkspace();
  const full=normalizeWorkspace(saveDropPackage(base,{id:300,chest_type:1,name:'组合宝箱'},[{id:310,package_id:300,weight:4294967295,rewards:[{asset_id:100,count:3}]}]));
  assert.equal((await call(db,{method:'POST',path:'/api/workspace/migrate',body:{workspace:full,expectedRevision:0,requestId:'drop-test'}})).status,200);
  assert.deepEqual((await call(db)).data.workspace,full);
  const changed=structuredClone(full);changed.tables.drop_entry.rows[0].rewards[0].count=5;
  assert.equal((await call(db,{method:'PUT',body:{workspace:changed,expectedRevision:1}})).status,200);
  assert.equal((await call(db,{method:'PUT',body:{workspace:deleteDropPackage(full,300),expectedRevision:1}})).status,409);
  const invalid=structuredClone(changed);invalid.tables.equipment.rows=[];
  assert.equal((await call(db,{method:'PUT',body:{workspace:invalid,expectedRevision:2}})).status,400);
  const bypass=structuredClone(changed);for(const category of bypass.categories)delete category.system;
  assert.equal((await call(db,{method:'PUT',body:{workspace:bypass,expectedRevision:2}})).status,400);
  assert.deepEqual((await call(db)).data.workspace,changed);
  assert.equal((await call(db,{method:'PUT',body:{workspace:deleteDropPackage(changed,300),expectedRevision:2}})).status,200);
  const deleted=(await call(db)).data.workspace;
  assert.deepEqual(deleted.tables.drop_package.rows,[]);assert.deepEqual(deleted.tables.drop_entry.rows,[]);
});

test('legacy category migration is one revision and stale retries cannot duplicate or overwrite records',async()=>{
  const db=database(),legacy=workspace();legacy.categories[1].key='loot_bag';legacy.tables.loot_bag={fields:legacy.tables.drops.fields,rows:[]};delete legacy.tables.drops;
  await call(db,{method:'POST',path:'/api/workspace/migrate',body:{workspace:legacy,expectedRevision:0,requestId:'legacy-drops'}});
  const migrated=normalizeWorkspace(migrateLootBag(normalizeWorkspace(legacy),{start:300,end:399}));
  assert.equal((await call(db,{method:'PUT',body:{workspace:migrated,expectedRevision:1}})).status,200);
  const saved=(await call(db)).data;
  assert.equal(saved.revision,2);assert.equal(saved.workspace.categories[1].start,200);assert.equal(saved.workspace.categories[1].end,299);
  assert.deepEqual(saved.workspace.tables.equipment,legacy.tables.equipment);assert.equal(Object.hasOwn(saved.workspace.tables,'loot_bag'),false);
  assert.equal((await call(db,{method:'PUT',body:{workspace:migrated,expectedRevision:1}})).status,409);
  assert.deepEqual((await call(db)).data.workspace,saved.workspace);
});

test('cloud loading defaults legacy rewards without a write, and saves exact per-item probabilities',async()=>{
  const db=database(),base=dropWorkspace();
  const full=normalizeWorkspace(saveDropPackage(base,{id:300,chest_type:1,name:'概率测试'},[{id:310,package_id:300,weight:1,rewards:[{asset_id:100,count:1},{asset_id:200,count:2},{asset_id:201,count:1}]}]));
  await call(db,{method:'POST',path:'/api/workspace/migrate',body:{workspace:full,expectedRevision:0,requestId:'probability'}});
  const legacy=structuredClone(full.tables.drop_entry.rows[0]);for(const reward of legacy.rewards)delete reward.probability;
  await db.batch([db.prepare('UPDATE workspace_records SET payload=? WHERE owner_id=? AND kind=? AND entry_key=?').bind(JSON.stringify(legacy),'user-a','row','drop_entry:310')]);
  const read=await call(db);assert.equal(read.data.revision,1);assert.deepEqual(read.data.workspace,full);
  full.tables.drop_entry.rows[0].rewards[0].probability=0;full.tables.drop_entry.rows[0].rewards[1].probability=5000;
  assert.equal((await call(db,{method:'PUT',body:{workspace:full,expectedRevision:1}})).status,200);
  assert.deepEqual((await call(db)).data.workspace,full);
  full.tables.drop_entry.rows[0].rewards[1].probability=10001;
  assert.equal((await call(db,{method:'PUT',body:{workspace:full,expectedRevision:2}})).status,400);
  assert.equal((await call(db)).data.workspace.tables.drop_entry.rows[0].rewards[1].probability,5000);
});

test('cloud round trips probability mode and independent combination rates, rejects invalid rates and protects concurrent switches',async()=>{
  const db=database(),base=dropWorkspace();
  const full=normalizeWorkspace(saveDropPackage(base,{id:300,chest_type:1,name:'组合概率',selection_mode:'probability'},[
    {id:310,package_id:300,weight:1,probability:10000,rewards:[{asset_id:100,count:1}]},
    {id:311,package_id:300,weight:2,probability:0,rewards:[{asset_id:100,count:2,probability:5000},{asset_id:200,count:1,probability:10000}]}
  ]));
  assert.equal((await call(db,{method:'POST',path:'/api/workspace/migrate',body:{workspace:full,expectedRevision:0,requestId:'modes'}})).status,200);
  assert.deepEqual((await call(db)).data.workspace,full);
  const changed=structuredClone(full);changed.tables.drop_entry.rows[1].probability=5000;
  assert.equal((await call(db,{method:'PUT',body:{workspace:changed,expectedRevision:1}})).status,200);
  full.tables.drop_package.rows[0].selection_mode='weight';
  assert.equal((await call(db,{method:'PUT',body:{workspace:full,expectedRevision:1}})).status,409);
  const bad=structuredClone(changed);bad.tables.drop_entry.rows[1].probability=10001;
  assert.equal((await call(db,{method:'PUT',body:{workspace:bad,expectedRevision:2}})).status,400);
  assert.deepEqual((await call(db)).data.workspace,changed);
});
