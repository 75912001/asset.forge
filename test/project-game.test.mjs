import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,realpath,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalServer} from '../local/server.mjs';

async function fixture(t) {
  // 使用真实长路径, 避免 Windows 临时目录的 8.3 别名触发项目边界校验.
  const root=await realpath(await mkdtemp(join(tmpdir(),'asset-forge-game-')));
  await cp(resolve('drizzle'),join(root,'drizzle'),{recursive:true});
  const app=await createLocalServer({root});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  await app.listen(0);
  async function project(id) {
    const response=await fetch(app.url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name:id})});
    assert.equal(response.status,201);
    return join(root,'projects',id);
  }
  return {root,app,project};
}

// 原始 path 不经 URL 规范化, 真实覆盖编码目录穿越与浏览器导航请求头.
function request(app,path,{method='GET',headers={}}={}) {
  const address=new URL(app.url);
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:address.hostname,port:address.port,path,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });
    req.on('error',reject);req.end();
  });
}

async function game(folder,files={'index.html':'<!doctype html><title>game</title>'}) {
  await mkdir(join(folder,'game'),{recursive:true});
  for(const [name,content] of Object.entries(files))await writeFile(join(folder,'game',name),content);
}

test('项目标识允许连字符, 仍拒绝目录字符和 Windows 保留名称',async t=>{
  const f=await fixture(t),folder=await f.project('hero-td');
  assert.equal(JSON.parse(await readFile(join(folder,'project.json'),'utf8')).id,'hero-td');
  for(const id of ['-hero','hero.td','hero/td','hero\\td','HERO-TD','con','aux','a'.repeat(65)]) {
    const response=await fetch(f.app.url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name:'invalid'})});
    assert.equal(response.status,400,id);
  }
});

test('游戏入口状态区分未配置, 缺少入口与存在入口, 不存在项目返回 404',async t=>{
  const f=await fixture(t),folder=await f.project('alpha');
  for(const createFolder of [false,true]) {
    if(createFolder)await mkdir(join(folder,'game'));
    const status=await request(f.app,'/api/projects/alpha/game');
    assert.equal(status.status,200);assert.deepEqual(JSON.parse(status.body),{available:false,url:null});
  }
  await game(folder);
  const status=await request(f.app,'/api/projects/alpha/game');
  assert.equal(status.status,200);assert.deepEqual(JSON.parse(status.body),{available:true,url:'/games/alpha/index.html?project=alpha'});
  assert.equal((await request(f.app,'/api/projects/missing/game')).status,404);
  assert.equal((await request(f.app,'/games/missing/index.html')).status,404);
  assert.equal((await request(f.app,'/games/alpha/missing.mjs')).status,404);
});

test('游戏静态路由仅返回当前项目的允许文件类型和原始内容',async t=>{
  const f=await fixture(t),alpha=await f.project('alpha'),beta=await f.project('beta');
  const png=Buffer.from([137,80,78,71,13,10,26,10,255]);
  await game(alpha,{'index.html':'<title>alpha</title>','app.mjs':'export const project="alpha";','style.css':'body{color:red}','levels.json':'{"level":1}','头像.png':png,'mark.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>','secret.sqlite':'private-db','only-alpha.mjs':'alpha only'});
  await game(beta,{'index.html':'<title>beta</title>','app.mjs':'export const project="beta";'});
  for(const [file,type,body] of [
    ['index.html','text/html; charset=utf-8','<title>alpha</title>'],
    ['app.mjs','text/javascript; charset=utf-8','export const project="alpha";'],
    ['style.css','text/css; charset=utf-8','body{color:red}'],
    ['levels.json','application/json; charset=utf-8','{"level":1}'],
    ['mark.svg','image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['头像.png','image/png',png],
  ]) {
    const response=await request(f.app,'/games/alpha/'+encodeURIComponent(file));
    assert.equal(response.status,200,file);assert.equal(response.type,type);assert.deepEqual(response.body,Buffer.from(body));
  }
  assert.equal((await request(f.app,'/games/beta/index.html')).body.toString(),'<title>beta</title>');
  assert.equal((await request(f.app,'/games/beta/app.mjs')).body.toString(),'export const project="beta";');
  assert.equal((await request(f.app,'/games/beta/only-alpha.mjs')).status,404);
  assert.equal((await request(f.app,'/games/alpha/secret.sqlite')).status,404);
  await mkdir(join(alpha,'game','directory.html'));
  assert.equal((await request(f.app,'/games/alpha/directory.html')).status,400);
});

test('游戏路由拒绝非法项目标识及编码穿越, 不暴露项目数据库和相邻目录',async t=>{
  const f=await fixture(t),alpha=await f.project('alpha'),beta=await f.project('beta');
  await game(alpha);await game(beta,{'index.html':'<title>private beta</title>'});
  await writeFile(join(alpha,'secret.json'),'project-private');
  for(const path of [
    '/games/alpha/..%2Fsecret.json',
    '/games/alpha/%2e%2e%5csecret.json',
    '/games/alpha/%2findex.html',
    '/games/alpha/C%3A%5Csecret.json',
    '/games/alpha/index.html%00',
    '/games/alpha/%E0%A4%A',
    '/games/alpha/..%2F..%2Fbeta%2Fgame%2Findex.html',
    '/games/alpha/..%2Fworkspace.sqlite',
    '/games/alpha%2F..%2Fbeta/index.html',
    '/games/ALPHA/index.html',
    '/games/con/index.html',
    '/api/projects/alpha%2F..%2Fbeta/game',
  ]) {
    const response=await request(f.app,path);
    assert.equal(response.status,400,path);assert.doesNotMatch(response.body.toString(),/project-private|private beta/);
  }
});

test('游戏状态和静态入口只允许 GET, 不修改游戏文件',async t=>{
  const f=await fixture(t),folder=await f.project('alpha');await game(folder);
  for(const path of ['/api/projects/alpha/game','/games/alpha/index.html'])for(const method of ['HEAD','POST','PUT','DELETE']) {
    assert.equal((await request(f.app,path,{method})).status,405,path+' '+method);
  }
  assert.equal(await readFile(join(folder,'game','index.html'),'utf8'),'<!doctype html><title>game</title>');
});

test('外部顶层导航可打开游戏入口, 跨站接口, 子页面, 脚本与嵌入仍被拒绝',async t=>{
  const f=await fixture(t),folder=await f.project('alpha');
  await game(folder,{'index.html':'<title>game</title>','extra.html':'<title>extra</title>','app.mjs':'export {};'});
  const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
  assert.equal((await request(f.app,'/games/alpha/index.html?project=alpha',{headers})).status,200);
  for(const path of ['/api/projects/alpha/game','/api/projects/alpha/workspace','/games/alpha/app.mjs','/games/alpha/extra.html'])assert.equal((await request(f.app,path,{headers})).status,403,path);
  for(const change of [
    {'sec-fetch-dest':'iframe'},
    {'sec-fetch-mode':'cors'},
    {origin:'https://external.test'},
    {host:'external.test'},
  ])assert.equal((await request(f.app,'/games/alpha/index.html',{headers:{...headers,...change}})).status,403);
});

test('游戏根目录损坏或入口为目录时明确报错, 不伪装成未配置',async t=>{
  const f=await fixture(t),alpha=await f.project('alpha'),beta=await f.project('beta');
  await writeFile(join(alpha,'game'),'not-a-directory');
  await mkdir(join(beta,'game','index.html'),{recursive:true});
  for(const id of ['alpha','beta']) {
    const response=await request(f.app,'/api/projects/'+id+'/game');
    assert.equal(response.status,400,id);assert.equal(typeof JSON.parse(response.body).error,'string');
  }
});

test('拒绝游戏根链接及子目录链接越界, 不读取其他项目内容',async t=>{
  const f=await fixture(t),alpha=await f.project('alpha'),beta=await f.project('beta');
  await game(beta,{'index.html':'private beta','secret.json':'beta secret'});
  await symlink(join(beta,'game'),join(alpha,'game'),'junction');
  for(const path of ['/api/projects/alpha/game','/games/alpha/index.html'])assert.equal((await request(f.app,path)).status,400,path);
  await rm(join(alpha,'game'));
  await game(alpha);
  await symlink(join(beta,'game'),join(alpha,'game','linked'),'junction');
  const linked=await request(f.app,'/games/alpha/linked/secret.json');
  assert.equal(linked.status,400);assert.doesNotMatch(linked.body.toString(),/beta secret/);
});

test('项目目录替换为链接后, 游戏状态与静态入口都拒绝访问',async t=>{
  const f=await fixture(t),alpha=await f.project('alpha');await game(alpha);
  const moved=join(f.root,'moved-alpha');await rename(alpha,moved);
  await symlink(moved,alpha,'junction');
  for(const path of ['/api/projects/alpha/game','/games/alpha/index.html'])assert.equal((await request(f.app,path)).status,400,path);
});
