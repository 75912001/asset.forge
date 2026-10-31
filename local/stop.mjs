import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {url} from './config.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)}),info=await response.json();if(info.app!=='asset-forge-local'||info.root!==root)throw new Error('当前端口不是此目录的 Asset Forge, 未停止其他程序');process.kill(info.pid);console.log('Asset Forge 已停止');}
catch(error){if(error.cause?.code==='ECONNREFUSED')console.log('Asset Forge 未运行');else{console.error(error.message);process.exitCode=1;}}
