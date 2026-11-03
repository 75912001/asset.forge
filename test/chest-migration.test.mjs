import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,rm,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import {normalizeHeroMotion} from '../public/editor/hero-runtime.mjs';
const migration=await import('../local/chest-migration.mjs').catch(()=>({}));

async function legacy(t) {
  const folder=await mkdtemp(join(tmpdir(),'asset-forge-chest-migration-')),filename=join(folder,'workspace.sqlite'),resourcesRoot=join(folder,'assets'),backupDir=join(folder,'backups');
  await mkdir(join(resourcesRoot,'icons/chests'),{recursive:true});
  for(const name of ['wood','iron','copper','silver','gold'])await writeFile(join(resourcesRoot,`icons/chests/${name}.png`),'original png bytes');
  const db=new DatabaseSync(filename);t.after(async()=>{db.close();await rm(folder,{recursive:true,force:true});});
  for(const name of readdirSync(resolve('drizzle')).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(join(resolve('drizzle'),name),'utf8'));
  db.prepare('INSERT INTO workspaces(owner_id,revision,updated_at) VALUES(?,?,?)').run('local-workspace',23,'before');
  const add=(kind,key,value,position=0)=>db.prepare('INSERT INTO workspace_records(owner_id,kind,entry_key,position,payload) VALUES(?,?,?,?,?)').run('local-workspace',kind,key,position,JSON.stringify(value));
  add('category','item',{key:'item',name:'道具',start:1,end:99});
  add('category','drop_package',{key:'drop_package',system:'drop_package',name:'掉落包',start:200,end:209},1);
  add('category','drop_entry',{key:'drop_entry',system:'drop_entry',name:'条目',start:210,end:299},2);
  add('table','item',[{key:'id',label:'ID',type:'uint32',required:true}]);add('row','item:1',{id:1});
  add('table','drop_package',[{key:'id',label:'ID',type:'uint32',required:true},{key:'name',label:'名称',type:'string',required:true},{key:'selection_mode',label:'模式',type:'string',required:true}]);
  add('row','drop_package:200',{id:200,name:'新手包',selection_mode:'weight'});
  add('table','drop_entry',[{key:'id',label:'ID',type:'uint32',required:true},{key:'package_id',label:'包',type:'uint32',required:true},{key:'weight',label:'权重',type:'uint32',required:true},{key:'rewards',label:'奖励',type:'asset_list',required:true}]);
  add('row','drop_entry:210',{id:210,package_id:200,weight:1,rewards:[{asset_id:1,count:3,probability:10000}]});
  return {folder,db,filename,resourcesRoot,backupDir};
}

test('legacy project migration backs up the complete database, binds wood, preserves rewards and is idempotent',async t=>{
  assert.equal(typeof migration.migrateChestAppearances,'function','explicit appearance migration is missing');
  const f=await legacy(t),rewardsBefore=f.db.prepare("SELECT payload FROM workspace_records WHERE entry_key='drop_entry:210'").get().payload;
  const result=await migration.migrateChestAppearances(f);
  assert.equal(result.changed,true);assert.equal(result.revision,24);assert.ok(result.backup);
  const backup=new DatabaseSync(result.backup,{readOnly:true});try{assert.equal(backup.prepare('SELECT revision FROM workspaces').get().revision,23);assert.equal(backup.prepare("SELECT count(*) n FROM workspace_records WHERE kind='chest_appearance'").get().n,0);}finally{backup.close();}
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_records WHERE kind='chest_appearance'").get().n,5);
  const pack=JSON.parse(f.db.prepare("SELECT payload FROM workspace_records WHERE entry_key='drop_package:200'").get().payload);assert.equal(pack.chest_appearance_id,1);
  assert.equal(f.db.prepare("SELECT payload FROM workspace_records WHERE entry_key='drop_entry:210'").get().payload,rewardsBefore);
  const again=await migration.migrateChestAppearances(f);assert.equal(again.changed,false);assert.equal(again.revision,24);assert.equal((await readdir(f.backupDir)).length,1);
  assert.equal(await readFile(join(f.resourcesRoot,'icons/chests/wood.png'),'utf8'),'original png bytes');
});

test('migration refuses a missing source database without creating an empty replacement',async t=>{
  const f=await legacy(t),filename=join(f.folder,'missing.sqlite');
  await assert.rejects(migration.migrateChestAppearances({...f,filename}));
  await assert.rejects(stat(filename),{code:'ENOENT'});
});

test('外观迁移识别并原样保留已有英雄动作记录',async t=>{
  const f=await legacy(t),motion=normalizeHeroMotion();motion.amplitude=.65;
  const payload=JSON.stringify(motion);
  f.db.prepare('INSERT INTO workspace_records(owner_id,kind,entry_key,position,payload) VALUES(?,?,?,?,?)').run('local-workspace','hero_motion','shared',0,payload);
  assert.equal((await migration.migrateChestAppearances(f)).changed,true);
  assert.equal(f.db.prepare("SELECT payload FROM workspace_records WHERE kind='hero_motion'").get().payload,payload);
  assert.equal((await migration.migrateChestAppearances(f)).changed,false);
});

test('migration rejects invalid nonempty guarantees before changing any data or creating a backup',async t=>{
  assert.equal(typeof migration.migrateChestAppearances,'function');
  const f=await legacy(t),row={id:210,package_id:200,weight:1,rewards:[{asset_id:1,count:3,probability:5000}]};
  f.db.prepare("UPDATE workspace_records SET payload=? WHERE entry_key='drop_entry:210'").run(JSON.stringify(row));
  await assert.rejects(migration.migrateChestAppearances(f),/100%/);
  assert.equal(f.db.prepare('SELECT revision FROM workspaces').get().revision,23);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_records WHERE kind='chest_appearance'").get().n,0);
  await assert.rejects(readdir(f.backupDir),{code:'ENOENT'});
});
