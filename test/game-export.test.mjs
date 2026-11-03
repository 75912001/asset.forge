import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,realpath,readdir,lstat,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openProjects} from '../local/projects.mjs';
import {LOCAL_OWNER} from '../local/store.mjs';
import {handleWorkspaceRequest} from '../lib/workspace-api.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'asset-forge-export-')));
  await cp(resolve('drizzle'),join(root,'drizzle'),{recursive:true});
  await mkdir(join(root,'public','editor'),{recursive:true});
  await cp(resolve('public','editor','hero-runtime.mjs'),join(root,'public','editor','hero-runtime.mjs'));
  const projects=await openProjects({root});
  t.after(async()=>{projects.close();await rm(root,{recursive:true,force:true});});
  async function project(id,name) {
    await projects.create({id,name});
    const {folder,store}=await projects.context(id);
    await mkdir(join(folder,'game'));await mkdir(join(folder,'assets','heroes'));
    await writeFile(join(folder,'assets','heroes','头像.png'),png);
    await writeFile(join(folder,'assets','unused.png'),'not exported');
    await writeFile(join(folder,'game','index.html'),'<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><script type="module" src="./app.mjs"></script></body></html>');
    await writeFile(join(folder,'game','app.mjs'),'export const projectName='+JSON.stringify(name)+';\nexport const config="./workspace.json";\nexport const runtime="./hero-runtime.mjs";\n');
    await writeFile(join(folder,'game','style.css'),'body{color:#fff}');
    await writeFile(join(folder,'game','private.sqlite'),'must not publish');
    const workspace={categories:[{key:'hero',name:'英雄',start:1,end:9}],enums:[],tables:{hero:{fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'name',label:'名称',type:'string',required:true},{key:'icon',label:'头像',type:'png',required:true}],rows:[{id:1,name,icon:'heroes/头像.png'}]}}};
    const response=await handleWorkspaceRequest(new Request('http://localhost/api/workspace',{method:'PUT',headers:{'oai-authenticated-user-id':LOCAL_OWNER,'Content-Type':'application/json'},body:JSON.stringify({workspace,expectedRevision:1})}),store.db,{async head(key){try{return await lstat(join(folder,'assets',key.slice(LOCAL_OWNER.length+1)));}catch{return null;}}});
    assert.equal(response.status,200);
    return folder;
  }
  return {root,projects,project,target:join(root,'published')};
}

// 动态加载使缺少导出能力成为明确断言失败, 不掩盖后续模块自身的语法或导入错误.
async function exporter() {
  const filename=resolve('scripts/export-project-game.mjs');
  let exists=true;try{await lstat(filename);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
  assert.equal(exists,true,'需要实现可移植游戏导出命令');
  return (await import(pathToFileURL(filename))).exportProjectGame;
}

function savedState(folder) {
  const db=new DatabaseSync(join(folder,'workspace.sqlite'),{readOnly:true});
  try{return {revision:db.prepare('SELECT revision FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER).revision,rows:db.prepare('SELECT kind,entry_key,payload FROM workspace_records ORDER BY kind,entry_key').all()};}
  finally{db.close();}
}

test('静态导出包含独立页面, 共享运行时, 已保存配置和引用 PNG, 保持原数据版本',async t=>{
  const f=await fixture(t),folder=await f.project('hero-td','群英守关');f.projects.close();
  const before=savedState(folder),exportProjectGame=await exporter();
  const result=await exportProjectGame({root:f.root,projectId:'hero-td',targetDir:f.target});
  assert.equal(result.directory,f.target);assert.equal(result.project.id,'hero-td');
  assert.deepEqual(savedState(folder),before);
  assert.match(await readFile(join(f.target,'index.html'),'utf8'),/src="\.\/app\.mjs"/);
  const app=await import(pathToFileURL(join(f.target,'app.mjs')));
  assert.equal(app.projectName,'群英守关');
  const json=await readFile(join(f.target,app.config),'utf8'),published=JSON.parse(json);
  assert.deepEqual(Object.keys(published).sort(),['project','workspace']);
  assert.deepEqual(published.project,{id:'hero-td',name:'群英守关'});
  assert.equal(published.workspace.tables.hero.rows[0].name,'群英守关');
  assert.ok(!json.includes(f.root));assert.ok(!json.includes(LOCAL_OWNER));
  assert.deepEqual(await readFile(join(f.target,'assets',published.workspace.tables.hero.rows[0].icon)),png);
  assert.equal(await readFile(join(f.target,'style.css'),'utf8'),'body{color:#fff}');
  assert.deepEqual(await readFile(join(f.target,'hero-runtime.mjs')),await readFile(join(f.root,'public','editor','hero-runtime.mjs')));
  const runtime=await import(pathToFileURL(join(f.target,app.runtime)));
  assert.equal(runtime.createHeroMotion(published.workspace.heroMotion).snapshot().state,'idle');
  for(const name of ['workspace.sqlite','project.json','private.sqlite','editor','assets/unused.png'])await assert.rejects(lstat(join(f.target,name)),{code:'ENOENT'});
});

test('静态导出只读取指定项目, 同名资源与配置不会串用',async t=>{
  const f=await fixture(t),alpha=await f.project('alpha','甲项目'),beta=await f.project('beta','乙项目');
  const otherPng=Buffer.concat([png,Buffer.from([7])]);await writeFile(join(beta,'assets','heroes','头像.png'),otherPng);f.projects.close();
  const exportProjectGame=await exporter();
  await exportProjectGame({root:f.root,projectId:'beta',targetDir:f.target});
  assert.equal(JSON.parse(await readFile(join(f.target,'workspace.json'),'utf8')).workspace.tables.hero.rows[0].name,'乙项目');
  assert.deepEqual(await readFile(join(f.target,'assets','heroes','头像.png')),otherPng);
  assert.deepEqual(await readFile(join(alpha,'assets','heroes','头像.png')),png);
});

test('缺失入口, 已引用 PNG 或共享运行时在创建输出前失败',async t=>{
  const exportProjectGame=await exporter();
  for(const missing of ['game/index.html','assets/heroes/头像.png','runtime'])await t.test(missing,async t=>{
    const f=await fixture(t),folder=await f.project('hero-td','群英守关');f.projects.close();
    await rm(missing==='runtime'?join(f.root,'public','editor','hero-runtime.mjs'):join(folder,missing));
    const before=await readdir(f.root);
    await assert.rejects(exportProjectGame({root:f.root,projectId:'hero-td',targetDir:f.target}),/不存在|ENOENT/);
    await assert.rejects(lstat(f.target),{code:'ENOENT'});assert.deepEqual(await readdir(f.root),before);
  });
});

test('已有目标, 项目内目标和不存在项目不被覆盖或创建',async t=>{
  const f=await fixture(t),folder=await f.project('hero-td','群英守关');f.projects.close();
  const exportProjectGame=await exporter();
  await mkdir(f.target);await writeFile(join(f.target,'keep.txt'),'user-owned');
  await assert.rejects(exportProjectGame({root:f.root,projectId:'hero-td',targetDir:f.target}),/已存在/);
  assert.equal(await readFile(join(f.target,'keep.txt'),'utf8'),'user-owned');
  for(const targetDir of [join(folder,'export'),join(f.root,'projects','published')]) {
    await assert.rejects(exportProjectGame({root:f.root,projectId:'hero-td',targetDir}),/项目目录/);
    await assert.rejects(lstat(targetDir),{code:'ENOENT'});
  }
  await assert.rejects(exportProjectGame({root:f.root,projectId:'missing',targetDir:join(f.root,'missing-game')}));
  await assert.rejects(lstat(join(f.root,'missing-game')),{code:'ENOENT'});
});

test('导出拒绝游戏, 图片, 运行时目录中的符号链接及链接目标父目录',async t=>{
  const exportProjectGame=await exporter();
  for(const source of ['game','assets/heroes','runtime','target'])await t.test(source,async t=>{
    const f=await fixture(t),folder=await f.project('hero-td','群英守关');f.projects.close();
    const original=source==='runtime'?join(f.root,'public','editor'):source==='target'?join(f.root,'target-parent'):join(folder,source);
    if(source==='target')await mkdir(original);
    const moved=join(f.root,'linked-source');await rename(original,moved);await symlink(moved,original,'junction');
    const targetDir=source==='target'?join(original,'published'):f.target;
    const before=await readdir(f.root);
    await assert.rejects(exportProjectGame({root:f.root,projectId:'hero-td',targetDir}),/符号链接|真实目录/);
    await assert.rejects(lstat(targetDir),{code:'ENOENT'});assert.deepEqual(await readdir(f.root),before);
  });
});

test('游戏文件不能覆盖导出的配置或共享运行时',async t=>{
  const f=await fixture(t),folder=await f.project('hero-td','群英守关');f.projects.close();
  await writeFile(join(folder,'game','workspace.json'),'{}');
  const exportProjectGame=await exporter();
  await assert.rejects(exportProjectGame({root:f.root,projectId:'hero-td',targetDir:f.target}),/冲突/);
  await assert.rejects(lstat(f.target),{code:'ENOENT'});
});

test('生成文件与游戏子目录同名时在输出前明确报告冲突',async t=>{
  const f=await fixture(t),folder=await f.project('hero-td','群英守关');f.projects.close();
  await mkdir(join(folder,'game','workspace.json'));
  await writeFile(join(folder,'game','workspace.json','part.mjs'),'export {};');
  const exportProjectGame=await exporter(),before=await readdir(f.root);
  await assert.rejects(exportProjectGame({root:f.root,projectId:'hero-td',targetDir:f.target}),/冲突/);
  assert.deepEqual(await readdir(f.root),before);
});

test('未初始化的工作区不会因导出请求而创建项目目录',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'asset-forge-uninitialized-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const exportProjectGame=await exporter();
  await assert.rejects(exportProjectGame({root,projectId:'hero-td',targetDir:join(root,'published')}));
  assert.deepEqual(await readdir(root),[]);
});
