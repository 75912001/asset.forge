import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,rename,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalServer} from '../local/server.mjs';
import {openStore,LOCAL_OWNER} from '../local/store.mjs';

const seed={revision:13,updatedAt:'2026-10-29T06:00:00.000Z',workspace:{chestAppearances:[],categories:[{key:'equipment',name:'装备',start:1,end:9}],enums:[],tables:{equipment:{fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'name',label:'名称',type:'string',required:true},{key:'icon',label:'图标',type:'png',required:false}],rows:[{id:1,name:'草帽',icon:null}]}}}};
const bytes=Uint8Array.from([137,80,78,71,13,10,26,10]);
async function fixture(t,{legacy=true}={}) {
  const root=await mkdtemp(join(tmpdir(),'asset-forge-projects-'));
  await cp(resolve('drizzle'),join(root,'drizzle'),{recursive:true});
  await cp(resolve('public','editor'),join(root,'public','editor'),{recursive:true});
  await mkdir(join(root,'assets','装备'),{recursive:true});await mkdir(join(root,'cfg'));
  await writeFile(join(root,'assets','装备','草帽.png'),bytes);
  await writeFile(join(root,'cfg','existing.yaml'),'retained: true\n');
  const options={root,...(legacy?{seed}: {})};let instance;
  t.after(async()=>{await instance?.close();await rm(root,{recursive:true,force:true});});
  return {root,options,async start(){instance=await createLocalServer(options);await instance.listen(0);return instance;},async stop(){await instance.close();}};
}
const api=(app,id='mmorpg',path='/workspace')=>app.url+'/api/projects/'+id+path;
async function json(url,method,body) {return fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function workspace(app,id='mmorpg'){const response=await fetch(api(app,id));assert.equal(response.status,200);return response.json();}

test('migration preserves the old workspace and files, is idempotent, and keeps all business APIs project-qualified',async t=>{
  const f=await fixture(t),app=await f.start();
  const projects=(await (await fetch(app.url+'/api/projects')).json()).projects;
  assert.deepEqual(projects,[{id:'mmorpg',name:'mmorpg',legacyMigration:1}]);
  const saved=await workspace(app);assert.equal(saved.revision,13);assert.deepEqual(saved.workspace,seed.workspace);
  const page=await (await fetch(app.url+'/')).text();assert.match(page,/window.assetForgeLocal=true/);assert.doesNotMatch(page,/fonts.googleapis.com/);
  assert.match(await (await fetch(app.url+'/editor/projects.css')).text(),/project-controls/);
  assert.deepEqual((await (await fetch(api(app,'mmorpg','/resources'))).json()).paths,['装备/草帽.png']);
  for(const path of ['/api/workspace','/api/images?file=装备/草帽.png','/api/resources','/api/local-config','/api/export'])assert.equal((await fetch(app.url+path)).status,404);
  assert.equal((await json(api(app,'mmorpg','/local-config'),'PUT',{resourcesRoot:'other',exportRoot:'other'})).status,405);
  assert.equal(await readFile(join(f.root,'cfg','existing.yaml'),'utf8'),'retained: true\n');
  assert.equal(await readFile(join(f.root,'projects','mmorpg','cfg','existing.yaml'),'utf8'),'retained: true\n');
  const changed=structuredClone(saved.workspace);changed.tables.equipment.rows[0].icon='装备/草帽.png';
  const body={workspace:changed,expectedRevision:13,expectedUserId:saved.user.id};
  assert.equal((await json(api(app),'PUT',body)).status,200);assert.equal((await json(api(app),'PUT',body)).status,409);
  assert.equal((await fetch(api(app,'mmorpg','/images'),{method:'POST',body:bytes})).status,405);
  assert.equal((await fetch(api(app,'mmorpg','/images?file=..%2Fsecret.png'))).status,400);
  const denied=await fetch(api(app),{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:JSON.stringify(body)});assert.equal(denied.status,403);
  await f.stop();const restarted=await f.start();
  assert.equal((await workspace(restarted)).revision,14);assert.equal((await workspace(restarted)).workspace.tables.equipment.rows[0].icon,'装备/草帽.png');
  assert.deepEqual(new Uint8Array(await readFile(join(f.root,'assets','装备','草帽.png'))),bytes);
});

test('independent projects isolate the same category, ID, PNG filename, enums, drops, save revisions and exports',async t=>{
  const f=await fixture(t),app=await f.start();
  assert.equal((await json(app.url+'/api/projects','POST',{id:'sa',name:'石器时代'})).status,201);
  const empty=await workspace(app,'sa');assert.deepEqual(empty.workspace,{categories:[],enums:[],tables:{},chestAppearances:[]});assert.equal(empty.revision,1);
  await mkdir(join(f.root,'projects','sa','assets','装备'));
  const other=Uint8Array.from([...bytes,99]);await writeFile(join(f.root,'projects','sa','assets','装备','草帽.png'),other);
  const original=await workspace(app),sa=structuredClone(seed.workspace);sa.tables.equipment.rows[0]={id:1,name:'SA 帽子',icon:'装备/草帽.png'};
  const mmorpg=structuredClone(seed.workspace);mmorpg.tables.equipment.rows[0].icon='装备/草帽.png';
  const saves=await Promise.all([json(api(app,'sa'),'PUT',{workspace:sa,expectedRevision:1}),json(api(app),'PUT',{workspace:mmorpg,expectedRevision:original.revision})]);
  assert.deepEqual(saves.map(response=>response.status),[200,200]);
  assert.equal((await workspace(app,'sa')).workspace.tables.equipment.rows[0].name,'SA 帽子');assert.equal((await workspace(app)).workspace.tables.equipment.rows[0].name,'草帽');
  for(const [id,expected] of [['sa',other],['mmorpg',bytes]]) {
    const image=await fetch(api(app,id,'/images?file='+encodeURIComponent('装备/草帽.png')));assert.equal(image.status,200);assert.deepEqual(new Uint8Array(await image.arrayBuffer()),expected);
    const current=await workspace(app,id),exported=await json(api(app,id,'/export'),'POST',{scope:'equipment',filename:'asset-categories.yaml',expectedRevision:current.revision});
    assert.equal(exported.status,200);assert.deepEqual((await exported.json()).files,['equipment.yaml']);
    assert.match(await readFile(join(f.root,'projects',id,'cfg','equipment.yaml'),'utf8'),/icon: "装备\/草帽.png"/);
  }
  assert.match(await readFile(join(f.root,'projects','sa','cfg','equipment.yaml'),'utf8'),/SA 帽子/);
  assert.doesNotMatch(await readFile(join(f.root,'projects','mmorpg','cfg','equipment.yaml'),'utf8'),/SA 帽子/);
  assert.equal((await json(api(app,'sa','/export'),'POST',{scope:'equipment',filename:'../escape.yaml',expectedRevision:2})).status,400);
  assert.equal((await json(api(app,'sa','/export'),'POST',{scope:'equipment',filename:'asset-categories.yaml',expectedRevision:1})).status,409);
  const {enableDrops}=await import('../public/editor/drops.mjs'),withDrops=enableDrops(sa,{start:100,end:109},{start:110,end:119});
  withDrops.enums=[{key:'quality',label:'SA 品质',items:[{key:'undefined',label:'未定义',value:0}]}];
  assert.equal((await json(api(app,'sa'),'PUT',{workspace:withDrops,expectedRevision:2})).status,200);
  const untouched=await workspace(app);assert.deepEqual(untouched.workspace.enums,[]);assert.equal(untouched.workspace.categories.length,1);
  assert.equal((await json(api(app,'sa'),'PUT',{workspace:sa,expectedRevision:2})).status,409);
  await writeFile(join(f.root,'projects','sa','assets','only-sa.png'),other);
  assert.deepEqual((await (await fetch(api(app,'mmorpg','/resources'))).json()).paths,['装备/草帽.png']);assert.equal((await fetch(api(app,'mmorpg','/images?file=only-sa.png'))).status,404);
});

test('project creation validates identifiers and duplicate directories; rename changes only the display name',async t=>{
  const f=await fixture(t,{legacy:false}),app=await f.start();assert.deepEqual((await (await fetch(app.url+'/api/projects')).json()).projects,[]);
  for(const id of ['../escape','SA','a-b','con','aux','nul','com1','lpt9','',null,'a'.repeat(65)])assert.equal((await json(app.url+'/api/projects','POST',{id,name:'test'})).status,400);
  assert.equal((await json(app.url+'/api/projects','POST',{id:'sa',name:' '})).status,400);
  const results=await Promise.all([json(app.url+'/api/projects','POST',{id:'sa',name:'SA'}),json(app.url+'/api/projects','POST',{id:'sa',name:'Other'})]);assert.deepEqual(results.map(result=>result.status),[201,409]);
  const response=await json(api(app,'sa',''),'PATCH',{name:'石器时代'});assert.equal(response.status,200);assert.equal((await response.json()).project.name,'石器时代');
  assert.equal((await json(api(app,'sa',''),'PATCH',{id:'new',name:'x'})).status,400);assert.equal((await fetch(api(app,'missing'))).status,404);assert.equal((await fetch(api(app,'sa',''),{method:'DELETE'})).status,405);
  assert.equal((await workspace(app,'sa')).revision,1);
  await f.stop();await rm(join(f.root,'projects','sa','workspace.sqlite'));
  const restarted=await f.start();assert.equal((await fetch(api(restarted,'sa'))).status,404);await assert.rejects(stat(join(f.root,'projects','sa','workspace.sqlite')),{code:'ENOENT'});
});

test('a project folder can move independently to another installation without retaining machine paths',async t=>{
  const f=await fixture(t),app=await f.start(),current=await workspace(app);current.workspace.tables.equipment.rows[0].icon='装备/草帽.png';
  assert.equal((await json(api(app),'PUT',{workspace:current.workspace,expectedRevision:13})).status,200);await f.stop();
  const other=await fixture(t,{legacy:false});await mkdir(join(other.root,'projects'));await rename(join(f.root,'projects','mmorpg'),join(other.root,'projects','mmorpg'));
  const moved=await other.start(),image=await fetch(api(moved,'mmorpg','/images?file='+encodeURIComponent('装备/草帽.png')));assert.equal(image.status,200);assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);
  const exported=await json(api(moved,'mmorpg','/export'),'POST',{scope:'equipment',filename:'asset-categories.yaml',expectedRevision:14});assert.equal(exported.status,200);assert.equal((await exported.json()).directory,join(other.root,'projects','mmorpg','cfg'));
  assert.match(await readFile(join(other.root,'projects','mmorpg','cfg','equipment.yaml'),'utf8'),/icon: "装备\/草帽.png"/);
  assert.doesNotMatch(await readFile(join(other.root,'projects','mmorpg','project.json'),'utf8'),/resourcesRoot|exportRoot|[A-Z]:/);
});

test('migration takes a consistent SQLite snapshot including committed WAL and never replaces it with an older seed',async t=>{
  const f=await fixture(t),filename=join(f.root,'data','workspace.sqlite'),store=openStore(filename,f.root,seed),writer=new DatabaseSync(filename);
  try {
    writer.exec('PRAGMA wal_autocheckpoint=0');writer.prepare('UPDATE workspace_records SET payload=? WHERE owner_id=? AND kind=? AND entry_key=?').run(JSON.stringify({id:1,name:'WAL 最新记录',icon:null}),LOCAL_OWNER,'row','equipment:1');writer.prepare('UPDATE workspaces SET revision=14 WHERE owner_id=?').run(LOCAL_OWNER);
    assert.ok((await stat(filename+'-wal')).size>0);
    const app=await f.start(),saved=await workspace(app);assert.equal(saved.revision,14);assert.equal(saved.workspace.tables.equipment.rows[0].name,'WAL 最新记录');
    assert.equal(writer.prepare('SELECT revision FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER).revision,14);
  } finally{writer.close();store.close();}
});

test('migration conflicts and invalid sources fail explicitly without overwriting source or target data',async t=>{
  const f=await fixture(t);await mkdir(join(f.root,'projects','mmorpg'),{recursive:true});await writeFile(join(f.root,'projects','mmorpg','project.json'),JSON.stringify({id:'mmorpg',name:'已有项目'}));await writeFile(join(f.root,'projects','mmorpg','keep.txt'),'user-owned');
  await assert.rejects(f.start(),/不会覆盖/);assert.equal(await readFile(join(f.root,'projects','mmorpg','keep.txt'),'utf8'),'user-owned');
  const broken=await fixture(t);await mkdir(join(broken.root,'data'));await writeFile(join(broken.root,'data','workspace.sqlite'),'corrupt database');await assert.rejects(broken.start());
  assert.equal(await readFile(join(broken.root,'data','workspace.sqlite'),'utf8'),'corrupt database');assert.deepEqual(await readdir(join(broken.root,'projects')),[]);
  const missing=await fixture(t);await rm(join(missing.root,'assets'),{recursive:true});await assert.rejects(missing.start(),/旧目录不存在/);assert.deepEqual(await readdir(join(missing.root,'projects')),[]);
  const referenced=await fixture(t);referenced.options.seed=structuredClone(seed);referenced.options.seed.workspace.tables.equipment.rows[0].icon='missing.png';await assert.rejects(referenced.start(),/PNG 不存在/);assert.deepEqual(await readdir(join(referenced.root,'projects')),[]);
});
