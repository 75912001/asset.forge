import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
import {enableDrops} from '../public/editor/drops.mjs';
import {mountDropEditor} from '../public/editor/drop-editor.mjs';
import {chestEnum} from './chest-fixture.mjs';

// 只替换浏览器和 HTTP 边界, 真实 app, 编辑器与工作区校验负责状态变更.
class Element {
  constructor(attributes='') {
    this.value=/\bvalue="([^"]*)"/.exec(attributes)?.[1]||'';
    this.hidden=/\bhidden\b/.test(attributes);this.textContent='';this.innerHTML='';
    this.listeners={};this.classList={toggle(){}};
  }
  addEventListener(type,handler){this.listeners[type]=handler;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  focus(){}
  remove(){}
}
const html=await readFile(new URL('../public/editor/index.html',import.meta.url),'utf8');
let loadId=0;
function fixture(){return {categories:[{key:'item',name:'道具',start:1,end:9,description:''}],tables:{item:{fields:[{key:'id',label:'ID',type:'uint32',required:true}],rows:[{id:1}]}},enums:[chestEnum('chests/wood.png')]};}
function input(dataset,value){return {target:{dataset,value}};}
function click(dataset){return {target:{closest:selector=>selector.includes('data-drop-action')||selector.includes('data-chest-action')?{dataset}:null}};}
async function browser(t,{local=false,workspace=fixture()}={}) {
  const names=['document','window','fetch','localStorage','confirm','indexedDB','setTimeout','innerWidth'];
  const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
  t.after(()=>Object.assign(globalThis,previous));
  const values=new Map(),navigation=[],unload=[];let elements,server=workspace,revision=1,offline=false,link,dialog;
  const nativeFetch=previous.fetch;
  globalThis.fetch=async(url,options)=>{
    if(typeof url!=='string'||!url.startsWith('/api/'))return nativeFetch(url,options);
    if(url==='/api/projects')return Response.json({projects:[{id:'one',name:'项目一'},{id:'two',name:'项目二'}]});
    if(url.endsWith('/local-config'))return new Response('',{status:404});
    if(url.endsWith('/resources'))return Response.json({root:'assets',paths:['chests/wood.png','chests/gold.png']});
    if(url.endsWith('/workspace')) {
      if(options?.method==='PUT') {
        if(offline)throw new TypeError('offline');
        const body=JSON.parse(options.body);
        if(body.expectedRevision!==revision)return Response.json({error:'版本冲突'},{status:409});
        server=normalizeWorkspace(body.workspace);revision++;
      }
      return Response.json({workspace:server,revision,user:{id:'chest-ui',name:'UI'}});
    }
    throw new Error('未预期请求: '+url);
  };
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  globalThis.confirm=()=>true;globalThis.innerWidth=1280;
  globalThis.setTimeout=(fn,ms)=>previous.setTimeout(fn,ms).unref();
  globalThis.indexedDB={open:()=>{const request={error:new Error('unavailable')};queueMicrotask(()=>request.onerror());return request;}};
  async function load(project='one') {
    elements=new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(match=>[match[1],new Element(match[0])]));
    globalThis.document={getElementById:id=>{if(!elements.has(id)&&/^drop-probability-\d+$/.test(id))elements.set(id,new Element());return elements.get(id);},querySelectorAll:()=>[],body:{append(){}},createElement:tag=>{
      const element=new Element();element.click=()=>link={href:element.href,download:element.download};
      if(tag==='dialog') {
        dialog=element;const children=new Map();
        element.querySelector=selector=>{if(!children.has(selector))children.set(selector,new Element());return children.get(selector);};
        element.setAttribute=()=>{};element.showModal=()=>{};element.close=()=>{};
      }
      return element;
    }};
    globalThis.window={assetForgeLocal:local,location:{href:'http://localhost/?project='+project,assign:url=>navigation.push(url)},history:{replaceState(){}},addEventListener:(type,fn)=>{if(type==='beforeunload')unload.push(fn);}};
    await import('../public/editor/app.mjs?chest-ui-'+(++loadId));
  }
  await load();
  return {get:id=>elements.get(id),values,navigation,unload,load,get server(){return server;},set offline(value){offline=value;},bumpRevision(){revision++;},get link(){return link;},get dialog(){return dialog;}};
}

test('真实 app 将枚举图标选择接入资源选择器, 选择结果随保存提交',async t=>{
  const ui=await browser(t);
  const pending=ui.get('enum-items').listeners.click({target:{closest:selector=>selector==='[data-png-select]'?{dataset:{enumIcon:'1'}}:null}});
  await new Promise(setImmediate);
  assert.ok(ui.dialog,'应用必须打开 PNG 资源选择器');
  ui.dialog.listeners.click({target:{closest:selector=>selector==='[data-resource-path]'?{dataset:{resourcePath:'chests/gold.png'}}:null}});
  await pending;
  assert.match(ui.get('enum-items').innerHTML,/chests%2Fgold.png/);
  await ui.get('enum-save').listeners.click();assert.equal(ui.server.enums[0].items[1].icon,'chests/gold.png');
});

test('枚举图标随保存与分类编辑保留, 外观入口及独立导出已移除',async t=>{
  const ui=await browser(t);
  assert.equal(ui.get('chest-new'),undefined);
  assert.doesNotMatch(ui.get('export-scope').innerHTML,/__chest_appearances__/);
  assert.match(ui.get('enum-items').innerHTML,/chests%2Fwood.png/);
  ui.get('enum-label').value='宝箱类型配置';await ui.get('enum-label').listeners.input();
  await ui.get('enum-save').listeners.click();
  assert.equal(ui.server.enums[0].label,'宝箱类型配置');
  ui.get('category-name').value='新道具';await ui.get('category-form').listeners.input();
  await ui.get('category-form').listeners.submit({preventDefault(){}});
  assert.equal(ui.server.enums[0].items[1].icon,'chests/wood.png');
  assert.equal(Object.hasOwn(ui.server,'chestAppearances'),false);
});

test('枚举草稿阻止导出和跨项目切换, 离线失败后可恢复并重试',async t=>{
  const ui=await browser(t,{local:true});
  ui.get('enum-label').value='待保存宝箱';await ui.get('enum-label').listeners.input();
  await ui.get('export-now').listeners.click();assert.equal(ui.get('export-error').hidden,false);
  let prevented=false;ui.unload.at(-1)({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  ui.get('project-select').value='two';await ui.get('project-select').listeners.change();assert.deepEqual(ui.navigation,[]);
  ui.offline=true;await ui.get('enum-save').listeners.click();
  const key='asset-forge-draft:chest-ui:project:one';
  assert.equal(JSON.parse(ui.values.get(key)).enumeration.draft.items[1].icon,'chests/wood.png');
  ui.offline=false;await ui.load();assert.equal(ui.get('cloud-restore').hidden,false);
  await ui.get('cloud-restore').listeners.click();assert.equal(ui.get('enum-label').value,'待保存宝箱');
  await ui.get('enum-save').listeners.click();assert.equal(ui.server.enums[0].label,'待保存宝箱');
  assert.equal(ui.values.has(key),false);
  ui.get('project-select').value='two';await ui.get('project-select').listeners.change();assert.deepEqual(ui.navigation,['/?project=two']);
});

test('枚举保存版本冲突保留含图标的草稿, 备份并重新加载后显示远端配置',async t=>{
  const ui=await browser(t);
  ui.get('enum-label').value='冲突草稿';await ui.get('enum-label').listeners.input();ui.bumpRevision();
  await ui.get('enum-save').listeners.click();assert.match(ui.get('cloud-title').textContent,/冲突/);
  await ui.get('cloud-reload').listeners.click();
  const backup=await (await fetch(ui.link.href)).json();URL.revokeObjectURL(ui.link.href);
  assert.equal(backup.current.enumeration.draft.label,'冲突草稿');
  assert.equal(backup.current.enumeration.draft.items[1].icon,'chests/wood.png');
  assert.equal(ui.get('enum-label').value,'宝箱类型');
});

test('枚举单独导出包含图片, 全量摘要不再计算独立外观表',async t=>{
  const ui=await browser(t);assert.match(ui.get('export-summary').textContent,/3 个 YAML/);
  const written=[];
  window.showDirectoryPicker=async()=>({name:'cfg',requestPermission:async()=>'granted',getFileHandle:async name=>({createWritable:async()=>({write:async content=>written.push({name,content}),close:async()=>{},abort:async()=>{}})})});
  await ui.get('choose-directory').listeners.click();ui.get('export-scope').value='__enums__';
  await ui.get('export-now').listeners.click();
  assert.deepEqual(written.map(file=>file.name),['asset-enums.yaml']);assert.match(written[0].content,/chests\/wood.png/);
});

test('新包必须明确选择非零宝箱类型, 预览和列表使用枚举图标',async t=>{
  const previous=globalThis.document;t.after(()=>globalThis.document=previous);
  const elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
  let workspace=enableDrops(fixture(),{start:20,end:29},{start:30,end:39});
  const editor=mountDropEditor({getWorkspace:()=>workspace,canEdit:()=>true,onDirty(){},notify(){},commit:async next=>{workspace=next;return true;}});
  const action=data=>elements.get('drops-view').listeners.click(click(data));
  await action({dropAction:'new'});
  assert.match(elements.get('drop-chest-type').innerHTML,/木箱/);
  assert.doesNotMatch(elements.get('drop-chest-type').innerHTML,/value="0"/);
  assert.equal(editor.snapshot().pack.chest_type,'');
  elements.get('drops-view').listeners.input(input({dropPackField:'name'},'测试包'));
  await action({dropAction:'add-entry'});elements.get('drops-view').listeners.input(input({dropEntry:'0',rewardIndex:'0',rewardProperty:'asset_id'},'1'));
  await action({dropAction:'save'});assert.equal(workspace.tables.drop_package.rows.length,0);
  elements.get('drops-view').listeners.input(input({dropPackField:'chest_type'},'1'));
  assert.match(elements.get('drop-chest-preview').innerHTML,/chests%2Fwood.png/);
  const draft=editor.snapshot();editor.reset();editor.restore(draft);assert.equal(editor.snapshot().pack.chest_type,'1');
  await action({dropAction:'save'});assert.equal(workspace.tables.drop_package.rows[0].chest_type,1);
  assert.match(elements.get('drop-packages').innerHTML,/chests%2Fwood.png/);
  await action({dropAction:'new'});assert.equal(editor.snapshot().pack.chest_type,'');
});
