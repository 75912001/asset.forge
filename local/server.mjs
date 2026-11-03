import {createServer} from 'node:http';
import {readFile,mkdir,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,join,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOCAL_OWNER} from './store.mjs';
import {openProjects,within,writeAtomic} from './projects.mjs';
import {handleWorkspaceRequest} from '../lib/workspace-api.mjs';
import {normalizePngReference} from '../public/editor/png.mjs';
import {workspaceFiles} from '../public/editor/workspace.mjs';
import {port} from './config.mjs';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function createLocalServer({root=projectRoot,dataDir=join(root,'data'),resourceDir,seed,projectsDir=join(root,'projects')}={}) {
  await mkdir(dataDir,{recursive:true});
  const projects=await openProjects({root,dataDir,resourceDir,seed,projectsDir});
  async function resourceFile(config,path) {
    const safe=normalizePngReference(path),base=await realpath(config.resourcesRoot),file=await realpath(join(base,...safe.split('/')));
    if(!within(base,file)||!(await stat(file)).isFile())throw Object.assign(new Error('资源不在指定目录中'),{status:400});
    return file;
  }
  function imageBucket(config){return {async head(key){if(!key.startsWith(LOCAL_OWNER+'/'))return null;try{await resourceFile(config,key.slice(LOCAL_OWNER.length+1));return {};}catch{return null;}}};}
  async function listResources(config) {
    const paths=[];
    async function walk(folder,prefix='') {
      for(const item of await readdir(folder,{withFileTypes:true})) {
        if(item.isSymbolicLink())continue;
        const path=prefix+item.name;
        if(item.isDirectory())await walk(join(folder,item.name),path+'/');
        else if(item.isFile()&&/\.png$/i.test(item.name))paths.push(path);
      }
    }
    await walk(config.resourcesRoot);return paths.sort((a,b)=>a.localeCompare(b,'zh-CN'));
  }
  const server=createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body));};
    try {
      const port=server.address().port,host=req.headers.host;
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return send(403,{error:'仅允许本机访问'});
      const origin='http://'+host,url=new URL(req.url,origin),method=req.method;
      // 外部链接可进入明确的 HTML 页面, 数据接口和嵌入资源仍要求本地编辑器来源.
      const pageNavigation=method==='GET'&&['/','/editor/index.html','/editor/hero-example.html'].includes(url.pathname)&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
      if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'&&!pageNavigation)return send(403,{error:'仅允许本地编辑器访问'});
      let body;
      if(!['GET','HEAD'].includes(method)){const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>16*1024*1024)return send(413,{error:'请求过大'});parts.push(part);}body=Buffer.concat(parts);}
      const request=new Request(url,{method,headers:{...req.headers,'oai-authenticated-user-id':LOCAL_OWNER,'oai-authenticated-user-email':'Local workspace'},...(body?.length?{body}: {})});
      if(url.pathname==='/api/health'&&method==='GET')return send(200,{app:'asset-forge-local',root,pid:process.pid});
      if(url.pathname==='/api/projects') {
        if(method==='GET')return send(200,{projects:await projects.list()});
        if(method==='POST')return send(201,{project:await projects.create(await request.json())});
        return send(405,{error:'不支持此请求方法'});
      }
      const match=/^\/api\/projects\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if(match) {
      const id=decodeURIComponent(match[1]),path=match[2]||'';
      if(!path) {
        if(method==='PATCH')return send(200,{project:await projects.rename(id,await request.json())});
        return send(405,{error:'不支持此请求方法'});
      }
      const {meta,config,store}=await projects.context(id),bucket=imageBucket(config);
      if(path==='/workspace') {
        const response=await handleWorkspaceRequest(request,store.db,bucket),data=await response.json();
        if(data.user)data.user.name=meta.name;return send(response.status,{...data,project:meta});
      }
      if(path==='/images') {
        if(method!=='GET')return send(405,{error:'本地版只引用原 PNG 文件, 不上传或复制资源'});
        let path;try{path=normalizePngReference(url.searchParams.get('file'));}catch(error){return send(400,{error:error.message});}
        try{return send(200,await readFile(await resourceFile(config,path)),'image/png');}catch(error){return send(error.status||404,{error:'找不到 PNG, 请检查资源目录和相对路径'});}
      }
      if(path==='/resources'&&method==='GET')return send(200,{root:config.resourcesRoot,paths:await listResources(config)});
      if(path==='/local-config') {
        if(method==='GET')return send(200,config);
        return send(405,{error:'项目目录固定, 不支持修改'});
      }
      if(path==='/export'&&method==='POST') {
        const input=await request.json();
        if(typeof input.filename!=='string'||!/^\w[\w.-]*\.ya?ml$/.test(input.filename))return send(400,{error:'YAML 文件名无效'});
        const response=await handleWorkspaceRequest(new Request(origin+url.pathname.replace(/\/export$/,'/workspace'),{headers:{'oai-authenticated-user-id':LOCAL_OWNER}}),store.db,bucket);
        const current=await response.json();if(!response.ok)return send(response.status,current);
        if(input.expectedRevision!==current.revision)return send(409,{error:'本地数据版本已更新, 请重新加载后导出'});
        const all=workspaceFiles(current.workspace,input.filename),files=input.scope==='__all__'?all:input.scope==='__enums__'?all.filter(file=>file.name==='asset-enums.yaml'):input.scope==='__hero_motion__'?all.filter(file=>file.name==='hero-motion.yaml'):all.filter(file=>file.name===input.scope+'.yaml');
        if(!files.length)return send(400,{error:'导出范围无效'});
        const directory=await realpath(config.exportRoot);
        if(directory!==config.exportRoot)return send(400,{error:'导出目录不能使用符号链接'});
        const completed=[];
        try{for(const file of files){await writeAtomic(join(directory,file.name),file.content);completed.push(file.name);}}
        catch(error){throw Object.assign(new Error(`YAML 导出失败, 已写入 ${completed.length} 个文件 (${completed.join(', ')}): ${error.message}`),{status:500});}
        return send(200,{directory:config.exportRoot,files:files.map(file=>file.name)});
      }
      return send(404,{error:'项目接口不存在'});
      }
      if(url.pathname.startsWith('/api/'))return send(404,{error:'请使用带项目标识的接口'});
      if(method!=='GET')return send(405,{error:'不支持此请求方法'});
      if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
      const name=url.pathname==='/'?'index.html':url.pathname.startsWith('/editor/')?decodeURIComponent(url.pathname.slice(8)):null;
      if(!name)return send(404,{error:'页面不存在'});
      const base=await realpath(join(root,'public','editor')),file=await realpath(resolve(base,name));
      if(!within(base,file))return send(404,{error:'页面不存在'});
      const type={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)];
      if(!type)return send(404,{error:'页面不存在'});
      let text=await readFile(file,'utf8');
      if(name==='index.html')text=text.replace('href="style.css"','href="/editor/style.css"').replace('src="app.mjs"','src="/editor/app.mjs"').replace('<head>','<head><script>window.assetForgeLocal=true;</script>');
      return send(200,text,type);
    }catch(error){if(!error.status&&error.code!=='ENOENT')console.error(error);return send(error.code==='ENOENT'?404:error.status||400,{error:error.code==='ENOENT'?'文件或目录不存在':error.message});}
  });
  let closed=false;
  return {get url(){return `http://127.0.0.1:${server.address().port}`;},listen:port=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});}),async close(){if(closed)return;closed=true;if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}projects.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createLocalServer();
  try{await app.listen(port);console.log(`Asset Forge 本地编辑器: ${app.url}\n项目目录: ${join(projectRoot,'projects')}\n按 Ctrl+C 停止服务.`);}
  catch(error){await app.close();console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用. 请检查已运行的编辑器或修改 local/config.mjs 中的端口.`:error);process.exitCode=1;}
  process.on('SIGINT',async()=>{await app.close();process.exit(0);});
  process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
}
