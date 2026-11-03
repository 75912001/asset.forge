import {mkdir,mkdtemp,readFile,readdir,lstat,realpath,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProjects,validateProjectId,within} from '../local/projects.mjs';
import {LOCAL_OWNER} from '../local/store.mjs';
import {handleWorkspaceRequest} from '../lib/workspace-api.mjs';
import {pngReferences} from '../public/editor/png.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const staticTypes=new Set(['.html','.mjs','.css','.json','.png','.svg']);

async function ordinaryPath(path,directory=false) {
  const info=await lstat(path);
  if(info.isSymbolicLink()||await realpath(path)!==path)throw new Error('导出路径不能使用符号链接: '+path);
  if(directory?!info.isDirectory():!info.isFile())throw new Error('导出来源不是'+(directory?'普通目录':'普通文件')+': '+path);
  return path;
}

async function requireMissing(path) {
  try{await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
  throw new Error('导出目标已存在, 不会覆盖: '+path);
}

export async function exportProjectGame({projectId,targetDir,root=projectRoot}) {
  validateProjectId(projectId);
  if(typeof targetDir!=='string'||!targetDir.trim())throw new Error('请指定不存在的导出目标目录');
  root=resolve(root);
  const directory=resolve(targetDir),parent=dirname(directory);
  await ordinaryPath(root,true);
  if(within(join(root,'projects'),directory))throw new Error('导出目标不能位于资产项目目录内');
  await requireMissing(directory);
  await ordinaryPath(parent,true);
  await ordinaryPath(join(root,'projects'),true);
  await ordinaryPath(join(root,'projects',projectId),true);
  const projects=await openProjects({root}),files=new Map(),names=new Set(),directories=new Set();
  let temporary;
  try {
    const {meta,folder,store}=await projects.context(projectId);
    const project={id:meta.id,name:meta.name};
    const response=await handleWorkspaceRequest(new Request('http://localhost/api/workspace',{headers:{'oai-authenticated-user-id':LOCAL_OWNER}}),store.db);
    const saved=await response.json();
    if(!response.ok||!saved.workspace)throw new Error(saved.error||'项目没有已保存的工作区');
    function addFile(name,content) {
      // 同时防止 Windows 大小写别名和游戏自带文件覆盖生成配置或共享运行时.
      const key=name.toLowerCase(),parts=key.split('/'),parents=[];
      while(parts.length>1){parts.pop();parents.push(parts.join('/'));}
      if(names.has(key)||directories.has(key)||parents.some(parent=>names.has(parent)))throw new Error('导出文件路径冲突: '+name);
      for(const parent of parents)directories.add(parent);
      names.add(key);files.set(name,content);
    }
    const gameRoot=await ordinaryPath(join(folder,'game'),true);
    async function readGame(directory,prefix='') {
      for(const entry of await readdir(directory,{withFileTypes:true})) {
        const source=join(directory,entry.name),name=prefix+entry.name;
        if(entry.isSymbolicLink())throw new Error('游戏目录包含符号链接: '+source);
        if(entry.isDirectory())await readGame(await ordinaryPath(source,true),name+'/');
        else if(entry.isFile()) {
          if(staticTypes.has(extname(name)))addFile(name,await readFile(await ordinaryPath(source)));
        } else throw new Error('游戏目录包含不支持的文件: '+source);
      }
    }
    await readGame(gameRoot);
    if(!files.has('index.html'))throw new Error('游戏入口 game/index.html 不存在');
    const assetsRoot=await ordinaryPath(join(folder,'assets'),true);
    for(const reference of pngReferences(saved.workspace)) {
      const source=join(assetsRoot,...reference.split('/'));
      await ordinaryPath(source);
      if(!within(assetsRoot,await realpath(source)))throw new Error('PNG 超出项目资源目录: '+reference);
      addFile('assets/'+reference,await readFile(source));
    }
    addFile('hero-runtime.mjs',await readFile(await ordinaryPath(join(root,'public','editor','hero-runtime.mjs'))));
    addFile('workspace.json',JSON.stringify({workspace:saved.workspace,project},null,2)+'\n');

    // 全部来源先读入快照, 避免写到一半才发现缺图, 也不把未完成目录作为成品暴露.
    temporary=await mkdtemp(join(parent,'.'+basename(directory)+'.export-'));
    for(const [name,content] of files) {
      const destination=join(temporary,...name.split('/'));
      await mkdir(dirname(destination),{recursive:true});
      await writeFile(destination,content,{flag:'wx'});
    }
    await requireMissing(directory);
    await rename(temporary,directory);temporary=undefined;
    return {project,directory,files:files.size};
  } catch(error) {
    if(temporary) {
      try {
        // 清理仅限此次 mkdtemp 创建且仍位于目标父目录内的目录.
        if(dirname(temporary)!==parent||!within(parent,temporary))throw new Error('临时目录超出清理范围');
        await rm(temporary,{recursive:true,force:true});
      } catch(cleanupError) {throw new Error(`游戏导出失败: ${error.message}; 临时目录清理失败: ${cleanupError.message}`,{cause:error});}
    }
    throw new Error('游戏导出失败: '+error.message,{cause:error});
  } finally {projects.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==4)throw new Error('用法: node scripts/export-project-game.mjs <项目标识> <目标目录>, 目标父目录必须已存在');
    const result=await exportProjectGame({projectId:process.argv[2],targetDir:process.argv[3]});
    console.log(`\x1b[32m成功: 已导出 ${result.project.name} 的 ${result.files} 个静态文件至 ${result.directory}\x1b[0m`);
  } catch(error) {console.error(`\x1b[31m失败: ${error.message}\x1b[0m`);process.exitCode=1;}
}
