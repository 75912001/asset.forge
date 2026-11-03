import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,cp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {openStore} from '../local/store.mjs';
import {workspaceFiles} from '../public/editor/workspace.mjs';

const execute=promisify(execFile);
const script=resolve('.agents/skills/push-git/scripts/verify-clone.mjs');
const workspace={categories:[{key:'equipment',name:'装备',start:1,end:9}],enums:[],tables:{equipment:{fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'name',label:'名称',type:'string',required:true},{key:'icon',label:'图标',type:'png',required:false}],rows:[{id:1,name:'测试装备',icon:'icons/sample.png'}]}}};

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'asset-forge-clone-check-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const folder of ['local','lib','public','drizzle'])await cp(resolve(folder),join(root,folder),{recursive:true});
  // 与真实 clone 一样按 ESM 加载, 不复制 node_modules 或任何本机配置.
  await writeFile(join(root,'package.json'),'{"type":"module"}\n');
  const project=join(root,'projects','sample');
  await mkdir(join(project,'assets','icons'),{recursive:true});
  await mkdir(join(project,'cfg'));
  await writeFile(join(project,'project.json'),'{"id":"sample","name":"测试项目"}\n');
  const store=openStore(join(project,'workspace.sqlite'),root,{revision:7,workspace});store.close();
  for(const file of workspaceFiles(workspace,'asset-categories.yaml'))await writeFile(join(project,'cfg',file.name),file.content);
  await writeFile(join(project,'assets','icons','sample.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
  return {root,project};
}

test('clone verification loads saved project data and PNG without installed dependencies',async t=>{
  const {root}=await fixture(t);
  const {stdout}=await execute(process.execPath,[script,root],{timeout:20000});
  assert.deepEqual(JSON.parse(stdout.trim().split('\n').at(-1)),{projects:1,categories:1,rows:1,images:1});
  await assert.rejects(stat(join(root,'node_modules')),{code:'ENOENT'});
});

test('clone verification rejects a saved PNG reference whose source file was omitted',async t=>{
  const {root,project}=await fixture(t);
  await rm(join(project,'assets','icons','sample.png'));
  await assert.rejects(execute(process.execPath,[script,root],{timeout:20000}),error=>error.code===1&&/sample\.png/.test(error.stderr));
});

test('clone verification rejects YAML that no longer represents the saved database',async t=>{
  const {root,project}=await fixture(t);
  await writeFile(join(project,'cfg','equipment.yaml'),'version: 1\ncategory: equipment\nrows: []\n');
  await assert.rejects(execute(process.execPath,[script,root],{timeout:20000}),error=>error.code===1&&/equipment\.yaml/.test(error.stderr));
});

test('clone verification rejects a missing project database without initializing a replacement',async t=>{
  const {root,project}=await fixture(t),database=join(project,'workspace.sqlite');
  await rm(database);
  await assert.rejects(execute(process.execPath,[script,root],{timeout:20000}),error=>error.code===1&&/workspace\.sqlite/.test(error.stderr));
  await assert.rejects(stat(database),{code:'ENOENT'});
});
