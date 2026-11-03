import assert from 'node:assert/strict';
import {access,readdir,readFile,realpath,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

// 只验证独立副本, 通过该副本自身的模块启动服务, 避免借用源工作区依赖掩盖缺失文件.
async function verifyClone(directory) {
  if(!directory)throw new Error('用法: node verify-clone.mjs <独立副本目录>');
  const root=await realpath(resolve(directory));
  const dependencies=await stat(join(root,'node_modules')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  assert.ok(!dependencies,'独立副本不能包含 node_modules, 请使用暂存区导出的目录或新 clone');
  const folders=(await readdir(join(root,'projects'),{withFileTypes:true})).filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')).map(entry=>entry.name).sort();
  for(const id of folders) {
    const folder=join(root,'projects',id),database=join(folder,'workspace.sqlite');
    assert.equal(JSON.parse(await readFile(join(folder,'project.json'),'utf8')).id,id,'项目元数据与目录名不一致: '+id);
    for(const name of ['assets','cfg'])assert.ok((await stat(join(folder,name))).isDirectory(),'项目目录缺失: '+join(folder,name));
    await access(database);
    const sqlite=new DatabaseSync(database,{readOnly:true});
    try{assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok','SQLite 完整性检查失败: '+database);}
    finally{sqlite.close();}
  }
  const {createLocalServer}=await import(pathToFileURL(join(root,'local','server.mjs')).href);
  const {workspaceFiles}=await import(pathToFileURL(join(root,'public','editor','workspace.mjs')).href);
  const {pngReferences,inspectPng}=await import(pathToFileURL(join(root,'public','editor','png.mjs')).href);
  const app=await createLocalServer({root});
  const summary={projects:0,categories:0,rows:0,images:0};
  try {
    await app.listen(0);
    async function get(path) {
      const response=await fetch(app.url+path,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error(`${path}: HTTP ${response.status}, ${await response.text()}`);
      return response;
    }
    assert.match(await (await get('/')).text(),/window\.assetForgeLocal=true/,'本地编辑器页面未正常加载');
    // 逐个读取实际静态文件, 不仅检查健康接口或 HTML 外壳.
    for(const entry of await readdir(join(root,'public','editor'),{withFileTypes:true})) {
      if(entry.isFile()&&/\.(mjs|css)$/.test(entry.name)) {
        const bytes=Buffer.from(await (await get('/editor/'+encodeURIComponent(entry.name))).arrayBuffer());
        assert.ok(bytes.equals(await readFile(join(root,'public','editor',entry.name))),'静态资源内容不一致: '+entry.name);
      }
    }
    const {projects}=await (await get('/api/projects')).json();
    assert.deepEqual(projects.map(project=>project.id).sort(),folders,'项目清单不一致, 可能缺失项目文件或意外触发旧数据迁移');
    for(const project of projects) {
      const prefix='/api/projects/'+encodeURIComponent(project.id),folder=join(root,'projects',project.id);
      const saved=await (await get(prefix+'/workspace')).json();
      assert.ok(Number.isSafeInteger(saved.revision)&&saved.revision>0,'工作区版本无效: '+project.id);
      for(const file of workspaceFiles(saved.workspace,'asset-categories.yaml')) {
        const filename=join(folder,'cfg',file.name),contents=await readFile(filename,'utf8');
        assert.ok(contents.replaceAll('\r\n','\n')===file.content,'YAML 与已保存数据库不一致: '+filename);
      }
      const resources=await (await get(prefix+'/resources')).json();
      for(const path of pngReferences(saved.workspace))assert.ok(resources.paths.includes(path),'缺少引用 PNG: '+project.id+'/'+path);
      for(const path of resources.paths) {
        const bytes=Buffer.from(await (await get(prefix+'/images?file='+encodeURIComponent(path))).arrayBuffer());
        assert.ok(bytes.equals(await readFile(join(folder,'assets',...path.split('/')))),'PNG 内容不一致: '+project.id+'/'+path);
        inspectPng(bytes);
      }
      summary.projects++;
      summary.categories+=saved.workspace.categories.length;
      summary.rows+=Object.values(saved.workspace.tables).reduce((total,table)=>total+table.rows.length,0);
      summary.images+=resources.paths.length;
    }
    return summary;
  } finally {await app.close();}
}

try {
  const summary=await verifyClone(process.argv[2]);
  console.log('\u001b[32m🟢 成功: 独立副本的编辑器, 项目数据, YAML 和 PNG 验证通过.\u001b[0m');
  console.log(JSON.stringify(summary));
} catch(error) {
  console.error('\u001b[31m🔴 失败: 独立副本验证失败: '+error.message+'\u001b[0m');
  process.exitCode=1;
}
