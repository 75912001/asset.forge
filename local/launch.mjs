import {spawn} from 'node:child_process';
import {mkdir,open,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {port,url} from './config.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const health=async()=>{try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(800)});return response.ok?await response.json():null;}catch{return null;}};
try {
  const existing=await health();
  if(existing&&(existing.app!=='asset-forge-local'||existing.root!==root))throw new Error(`端口 ${port} 已由其他程序使用`);
  if(!existing) {
    await mkdir(join(root,'data'),{recursive:true});
    const out=await open(join(root,'data','server.log'),'a'),err=await open(join(root,'data','server-error.log'),'a');
    const child=spawn(process.execPath,[join(root,'local','server.mjs')],{cwd:root,detached:true,stdio:['ignore',out.fd,err.fd],windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    await writeFile(join(root,'data','server.pid'),String(child.pid));child.unref();await out.close();await err.close();
    let ready=false;for(let i=0;i<40;i++){if((await health())?.root===root){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
    if(!ready)throw new Error('启动失败, 请查看 data/server-error.log');
  }
  console.log('Asset Forge 已启动: '+url);
  if(!process.argv.includes('--no-open'))spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true}).unref();
}catch(error){console.error(error.message);process.exitCode=1;}
