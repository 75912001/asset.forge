import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,rm,readFile,readdir,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const migration=await import('../local/chest-type-migration.mjs').catch(()=>({}));

async function legacy(t) {
  const folder=await realpath(await mkdtemp(join(tmpdir(),'asset-forge-chest-types-'))),filename=join(folder,'workspace.sqlite'),resourcesRoot=join(folder,'assets'),backupDir=join(folder,'backups'),exportRoot=join(folder,'cfg');
  await mkdir(join(resourcesRoot,'icons/chests'),{recursive:true});await mkdir(exportRoot);
  await writeFile(join(resourcesRoot,'icons/chests/wood.png'),await readFile('projects/mmorpg/assets/icons/chests/wood.png'));
  await writeFile(join(exportRoot,'chest-appearances.yaml'),'old appearances');await writeFile(join(exportRoot,'drop_package.yaml'),'old packages');
  const db=new DatabaseSync(filename);t.after(async()=>{db.close();await rm(folder,{recursive:true,force:true});});
  for(const name of readdirSync(resolve('drizzle')).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(join(resolve('drizzle'),name),'utf8'));
  db.exec('PRAGMA journal_mode=WAL');
  db.prepare('INSERT INTO workspaces(owner_id,revision,updated_at) VALUES(?,?,?)').run('local-workspace',23,'before');
  const add=(kind,key,value,position=0)=>db.prepare('INSERT INTO workspace_records(owner_id,kind,entry_key,position,payload) VALUES(?,?,?,?,?)').run('local-workspace',kind,key,position,JSON.stringify(value));
  add('category','drop_package',{key:'drop_package',system:'drop_package',name:'掉落包',start:200,end:209});
  add('category','drop_entry',{key:'drop_entry',system:'drop_entry',name:'条目',start:210,end:299},1);
  add('table','drop_package',[{key:'id',label:'ID',type:'uint32',required:true},{key:'name',label:'名称',type:'string',required:true},{key:'selection_mode',label:'模式',type:'string',required:true},{key:'chest_appearance_id',label:'宝箱外观',type:'uint32',required:true}]);
  add('row','drop_package:200',{id:200,name:'新手包',selection_mode:'weight',chest_appearance_id:1});
  add('table','drop_entry',[{key:'id',label:'ID',type:'uint32',required:true},{key:'package_id',label:'包',type:'uint32',required:true},{key:'weight',label:'权重',type:'uint32',required:true},{key:'rewards',label:'奖励',type:'asset_list',required:true}]);
  add('row','drop_entry:210',{id:210,package_id:200,weight:1,rewards:[{asset_id:200,count:3,probability:10000}]});
  add('enum','chest_type',{key:'chest_type',label:'宝箱类型',items:[{key:'undefined',label:'未定义',value:0},{key:'wood',label:'木箱',value:1}]});
  add('chest_appearance','1',{id:1,name:'木箱',icon:'icons/chests/wood.png'});
  return {folder,db,filename,resourcesRoot,backupDir,exportRoot};
}

test('显式迁移备份 WAL 数据和 YAML, 合并图标并保持奖励字节, 重复执行不写入',async t=>{
  assert.equal(typeof migration.migrateChestTypes,'function','缺少显式宝箱类型迁移');
  const f=await legacy(t),before=f.db.prepare("SELECT payload FROM workspace_records WHERE entry_key='drop_entry:210'").get().payload;
  const result=await migration.migrateChestTypes(f);
  assert.equal(result.changed,true);assert.equal(result.revision,24);
  const backup=new DatabaseSync(join(result.backup,'workspace.sqlite'),{readOnly:true});
  try{assert.equal(backup.prepare('SELECT revision FROM workspaces').get().revision,23);assert.equal(backup.prepare("SELECT count(*) n FROM workspace_records WHERE kind='chest_appearance'").get().n,1);}finally{backup.close();}
  assert.equal(await readFile(join(result.backup,'cfg/chest-appearances.yaml'),'utf8'),'old appearances');
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_records WHERE kind='chest_appearance'").get().n,0);
  assert.equal(JSON.parse(f.db.prepare("SELECT payload FROM workspace_records WHERE entry_key='drop_package:200'").get().payload).chest_type,1);
  assert.equal(f.db.prepare("SELECT payload FROM workspace_records WHERE entry_key='drop_entry:210'").get().payload,before);
  assert.match(await readFile(join(f.exportRoot,'asset-enums.yaml'),'utf8'),/icon: "icons\/chests\/wood.png"/);
  assert.match(await readFile(join(f.exportRoot,'drop_package.yaml'),'utf8'),/chest_type: 1/);
  await assert.rejects(stat(join(f.exportRoot,'chest-appearances.yaml')),{code:'ENOENT'});
  const again=await migration.migrateChestTypes(f);assert.equal(again.changed,false);assert.equal(again.revision,24);assert.equal((await readdir(f.backupDir)).length,1);
});

test('冲突、缺失枚举项、无效引用或旧版本在备份写入之前明确拒绝',async t=>{
  assert.equal(typeof migration.migrateChestTypes,'function');
  for(const [sql,pattern] of [
    ["UPDATE workspace_records SET payload=json_set(payload,'$.name','冲突名称') WHERE kind='chest_appearance'",/名称/],
    ["UPDATE workspace_records SET payload=json_set(payload,'$.items[1].icon','other.png') WHERE kind='enum'",/图标/],
    ["UPDATE workspace_records SET payload=json_remove(payload,'$.items[1]') WHERE kind='enum'",/对应/],
    ["UPDATE workspace_records SET payload=json_set(payload,'$.chest_appearance_id',2) WHERE entry_key='drop_package:200'",/引用/],
    ["UPDATE workspace_records SET payload=json_remove(payload,'$[3]') WHERE kind='table' AND entry_key='drop_package'",/前置升级/]
  ]) {
    const f=await legacy(t);f.db.exec(sql);
    await assert.rejects(migration.migrateChestTypes(f),pattern);
    assert.equal(f.db.prepare('SELECT revision FROM workspaces').get().revision,23);
    await assert.rejects(readdir(f.backupDir),{code:'ENOENT'});
  }
});

test('迁移事务中写入失败会回滚并报告备份',async t=>{
  assert.equal(typeof migration.migrateChestTypes,'function');
  const f=await legacy(t);
  f.db.exec("CREATE TRIGGER fail_migration BEFORE DELETE ON workspace_records WHEN OLD.kind='chest_appearance' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await assert.rejects(migration.migrateChestTypes(f),/回滚.*备份/);
  assert.equal(f.db.prepare('SELECT revision FROM workspaces').get().revision,23);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspace_records WHERE kind='chest_appearance'").get().n,1);
  assert.equal(await readFile(join(f.exportRoot,'drop_package.yaml'),'utf8'),'old packages');
});

test('YAML 导出失败明确报告恢复方式, 重试完成导出且不重复递增版本',async t=>{
  const f=await legacy(t),rename=t.mock.method(fsPromises,'rename',async()=>{throw new Error('injected export failure');});
  syncBuiltinESMExports();
  try {
    await assert.rejects(migration.migrateChestTypes(f),/数据库迁移已完成.*保持停服并重跑迁移.*恢复 workspace.sqlite/);
  }finally{rename.mock.restore();syncBuiltinESMExports();}
  assert.equal(f.db.prepare('SELECT revision FROM workspaces').get().revision,24);
  assert.equal(await readFile(join(f.exportRoot,'drop_package.yaml'),'utf8'),'old packages');
  const retried=await migration.migrateChestTypes(f);
  assert.equal(retried.changed,false);assert.equal(retried.revision,24);
  assert.match(await readFile(join(f.exportRoot,'drop_package.yaml'),'utf8'),/chest_type: 1/);
  await assert.rejects(stat(join(f.exportRoot,'chest-appearances.yaml')),{code:'ENOENT'});
  assert.deepEqual(await migration.migrateChestTypes(f),{changed:false,revision:24});
});

test('拒绝缺失数据库, 不创建空库',async t=>{
  assert.equal(typeof migration.migrateChestTypes,'function');
  const f=await legacy(t),filename=join(f.folder,'missing.sqlite');
  await assert.rejects(migration.migrateChestTypes({...f,filename}));await assert.rejects(stat(filename),{code:'ENOENT'});
});
