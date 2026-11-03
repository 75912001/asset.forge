import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalServer} from '../local/server.mjs';
import {mountProjects,currentProject} from '../public/editor/projects.mjs';

test('测试入口按当前项目打开游戏, 未保存修改和弹窗拦截会明确提示',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'asset-forge-game-ui-')));
  const original={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
  let app;
  t.after(async()=>{Object.assign(globalThis,original);await app?.close();await rm(root,{recursive:true,force:true});});
  await cp(resolve('drizzle'),join(root,'drizzle'),{recursive:true});
  await cp(resolve('public/editor'),join(root,'public/editor'),{recursive:true});
  app=await createLocalServer({root});await app.listen(0);
  for(const id of ['hero-td','other','empty']) {
    const created=await original.fetch(app.url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name:id})});
    assert.equal(created.status,201);
    if(id!=='empty'){await mkdir(join(root,'projects',id,'game'));await writeFile(join(root,'projects',id,'game','index.html'),'<html>'+id+'</html>');}
  }
  const html=await readFile(join(root,'public/editor/index.html'),'utf8'),notifications=[],opened=[];
  let elements,allowed=true,blocked=false;
  const element=id=>elements.get(id);
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  globalThis.fetch=(url,options)=>original.fetch(new URL(url,app.url),options);
  async function mount(id) {
    elements=new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(match=>[match[1],{
      value:'',disabled:/\bdisabled\b/.test(match[0]),hidden:/\bhidden\b/.test(match[0]),listeners:{},
      addEventListener(name,handler){this.listeners[name]=handler;},
    }]));
    const location={href:app.url+'/?project='+id};
    globalThis.document={getElementById:element};
    globalThis.window={assetForgeLocal:true,location,history:{replaceState:(_,__,url)=>location.href=app.url+url},open(url,name,features){
      if(blocked)return null;
      const popup={opener:{},focus(){this.focused=true;}};opened.push({url,name,features,popup});return popup;
    }};
    await mountProjects({canSwitch:()=>allowed,notify:message=>notifications.push(message)});
  }
  await mount('hero-td');
  assert.equal(element('project-test')?.disabled,false,'已配置游戏的项目必须可以测试');
  await element('project-test').listeners.click();
  assert.equal(opened.at(-1).url,'/games/hero-td/index.html?project=hero-td');
  assert.match(opened.at(-1).features,/popup/);assert.equal(opened.at(-1).popup.opener,null);
  allowed=false;await element('project-test').listeners.click();
  assert.equal(opened.length,1);assert.match(notifications.at(-1),/保存/);
  allowed=true;blocked=true;await element('project-test').listeners.click();assert.match(notifications.at(-1),/弹窗/);
  blocked=false;await mount('other');await element('project-test').listeners.click();
  assert.equal(opened.at(-1).url,'/games/other/index.html?project=other');
  assert.notEqual(opened[0].name,opened[1].name,'不同项目不能复用同一个游戏窗口');
  await mount('empty');assert.equal(element('project-test').disabled,true);assert.match(element('project-test').title,/游戏/);
  assert.equal(currentProject().id,'empty');
  await mount('missing');assert.equal(element('project-test').disabled,true);assert.equal(currentProject(),null);
});
