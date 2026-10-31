import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir,realpath,stat,rename} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,LOCAL_OWNER} from './store.mjs';
import {handleWorkspaceRequest} from '../lib/workspace-api.mjs';
import {normalizePngReference} from '../public/editor/png.mjs';
import {workspaceFiles} from '../public/editor/workspace.mjs';
import {port} from './config.mjs';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const within=(root,path)=>{const tail=relative(root,path);return !isAbsolute(tail)&&tail!=='..'&&!tail.startsWith('..\\')&&!tail.startsWith('../');};
export async function createLocalServer({root=projectRoot,dataDir=join(root,'data'),resourceDir,seed}={}) {
  await mkdir(dataDir,{recursive:true});
  if(!seed)try{seed=JSON.parse(await readFile(join(dataDir,'seed-workspace.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  let config={resourcesRoot:resourceDir||join(root,'assets'),exportRoot:join(root,'cfg')};
  try{config={...config,...JSON.parse(await readFile(join(dataDir,'local-config.json'),'utf8'))};}catch(error){if(error.code!=='ENOENT')throw error;}
  config.resourcesRoot=resolve(root,config.resourcesRoot);config.exportRoot=resolve(root,config.exportRoot);
  await mkdir(config.resourcesRoot,{recursive:true});
  const store=openStore(join(dataDir,'workspace.sqlite'),root,seed);
  async function resourceFile(path) {
    const safe=normalizePngReference(path),base=await realpath(config.resourcesRoot),file=await realpath(join(base,...safe.split('/')));
    if(!within(base,file)||!(await stat(file)).isFile())throw Object.assign(new Error('资源不在指定目录中'),{status:400});
    return file;
  }
  const bucket={async head(key){if(!key.startsWith(LOCAL_OWNER+'/'))return null;try{await resourceFile(key.slice(LOCAL_OWNER.length+1));return {};}catch{return null;}}};
  async function listResources() {
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
  async function writeAtomic(path,contents) {await mkdir(dirname(path),{recursive:true});const temp=path+'.'+crypto.randomUUID()+'.tmp';await writeFile(temp,contents,'utf8');await rename(temp,path);}
  const server=createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body));};
    try {
      const port=server.address().port,host=req.headers.host;
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return send(403,{error:'仅允许本机访问'});
      const origin='http://'+host,url=new URL(req.url,origin),method=req.method;
      if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'仅允许本地编辑器访问'});
      let body;
      if(!['GET','HEAD'].includes(method)){const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>16*1024*1024)return send(413,{error:'请求过大'});parts.push(part);}body=Buffer.concat(parts);}
      const request=new Request(url,{method,headers:{...req.headers,'oai-authenticated-user-id':LOCAL_OWNER,'oai-authenticated-user-email':'Local workspace'},...(body?.length?{body}: {})});
      if(url.pathname==='/api/health'&&method==='GET')return send(200,{app:'asset-forge-local',root,pid:process.pid});
      if(url.pathname==='/api/workspace'||url.pathname==='/api/workspace/migrate') {
        const response=await handleWorkspaceRequest(request,store.db,bucket),data=await response.json();if(data.user)data.user.name='本地工作区';return send(response.status,data);
      }
      if(url.pathname==='/api/images') {
        if(method!=='GET')return send(405,{error:'本地版只引用原 PNG 文件, 不上传或复制资源'});
        let path;try{path=normalizePngReference(url.searchParams.get('file'));}catch(error){return send(400,{error:error.message});}
        try{return send(200,await readFile(await resourceFile(path)),'image/png');}catch(error){return send(error.status||404,{error:'找不到 PNG, 请检查资源目录和相对路径'});}
      }
      if(url.pathname==='/api/resources'&&method==='GET')return send(200,{root:config.resourcesRoot,paths:await listResources()});
      if(url.pathname==='/api/local-config') {
        if(method==='GET')return send(200,config);
        if(method!=='PUT')return send(405,{error:'不支持此请求方法'});
        const next=await request.json();
        if(!['resourcesRoot','exportRoot'].every(key=>typeof next[key]==='string'&&next[key].trim()))return send(400,{error:'请填写资源目录和导出目录'});
        const resourcesRoot=await realpath(resolve(root,next.resourcesRoot));
        if(!(await stat(resourcesRoot)).isDirectory())return send(400,{error:'资源目录无效'});
        const updated={resourcesRoot,exportRoot:resolve(root,next.exportRoot)},stored={...updated};
        for(const key of ['resourcesRoot','exportRoot']) {
          const path=resolve(root,next[key]);
          if(within(root,path))stored[key]=relative(root,path).replaceAll('\\','/')||'.';
        }
        await writeAtomic(join(dataDir,'local-config.json'),JSON.stringify(stored,null,2));config=updated;return send(200,config);
      }
      if(url.pathname==='/api/export'&&method==='POST') {
        const input=await request.json();
        if(typeof input.filename!=='string'||!/^\w[\w.-]*\.ya?ml$/.test(input.filename))return send(400,{error:'YAML 文件名无效'});
        const current=await (await handleWorkspaceRequest(new Request(origin+'/api/workspace',{headers:{'oai-authenticated-user-id':LOCAL_OWNER}}),store.db,bucket)).json();
        if(input.expectedRevision!==current.revision)return send(409,{error:'本地数据版本已更新, 请重新加载后导出'});
        const all=workspaceFiles(current.workspace,input.filename),files=input.scope==='__all__'?all:input.scope==='__enums__'?all.filter(file=>file.name==='asset-enums.yaml'):all.filter(file=>file.name===input.scope+'.yaml');
        if(!files.length)return send(400,{error:'导出范围无效'});
        for(const file of files)await writeAtomic(join(config.exportRoot,file.name),file.content);
        return send(200,{directory:config.exportRoot,files:files.map(file=>file.name)});
      }
      if(method!=='GET')return send(405,{error:'不支持此请求方法'});
      if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
      const name=url.pathname==='/'?'index.html':url.pathname.startsWith('/editor/')?decodeURIComponent(url.pathname.slice(8)):null;
      if(!name)return send(404,{error:'页面不存在'});
      const base=await realpath(join(root,'public','editor')),file=await realpath(resolve(base,name));
      if(!within(base,file))return send(404,{error:'页面不存在'});
      const type={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)];
      if(!type)return send(404,{error:'页面不存在'});
      let text=await readFile(file,'utf8');
      if(name==='index.html')text=text.replace('href="style.css"','href="/editor/style.css"').replace('src="app.mjs"','src="/editor/app.mjs"');
      return send(200,text,type);
    }catch(error){console.error(error);return send(error.code==='ENOENT'?404:error.status||400,{error:error.code==='ENOENT'?'文件或目录不存在':error.message});}
  });
  let closed=false;
  return {get url(){return `http://127.0.0.1:${server.address().port}`;},listen:port=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});}),async close(){if(closed)return;closed=true;if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createLocalServer();
  try{await app.listen(port);console.log(`Asset Forge 本地编辑器: ${app.url}\n数据: ${join(projectRoot,'data','workspace.sqlite')}\n按 Ctrl+C 停止服务.`);}
  catch(error){await app.close();console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用. 请检查已运行的编辑器或修改 local/config.mjs 中的端口.`:error);process.exitCode=1;}
  process.on('SIGINT',async()=>{await app.close();process.exit(0);});
  process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
}
