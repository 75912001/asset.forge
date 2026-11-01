import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
import {enableDrops} from '../public/editor/drops.mjs';
import {mountDropEditor} from '../public/editor/drop-editor.mjs';
import {mountChestAppearanceEditor} from '../public/editor/chest-appearance-editor.mjs';

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
const appearance={id:1,name:'木箱',icon:'chests/wood.png'};
function fixture(){return {categories:[{key:'item',name:'道具',start:1,end:9,description:''}],tables:{item:{fields:[{key:'id',label:'ID',type:'uint32',required:true}],rows:[{id:1}]}},enums:[],chestAppearances:[{...appearance}]};}
function input(dataset,value){return {target:{dataset,value}};}
function click(dataset){return {target:{closest:selector=>selector.includes('data-drop-action')||selector.includes('data-chest-action')?{dataset}:null}};}
async function browser(t,{local=false,workspace=fixture()}={}) {
  const names=['document','window','fetch','localStorage','confirm','indexedDB','setTimeout','innerWidth'];
  const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
  t.after(()=>Object.assign(globalThis,previous));
  const values=new Map(),navigation=[],unload=[];let elements,server=workspace,revision=1,offline=false,link;
  const nativeFetch=previous.fetch;
  globalThis.fetch=async(url,options)=>{
    if(typeof url!=='string'||!url.startsWith('/api/'))return nativeFetch(url,options);
    if(url==='/api/projects')return Response.json({projects:[{id:'one',name:'项目一'},{id:'two',name:'项目二'}]});
    if(url.endsWith('/local-config'))return new Response('',{status:404});
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
    globalThis.document={getElementById:id=>{if(!elements.has(id)&&/^drop-probability-\d+$/.test(id))elements.set(id,new Element());return elements.get(id);},querySelectorAll:()=>[],body:{append(){}},createElement:()=>{const element=new Element();element.click=()=>link={href:element.href,download:element.download};return element;}};
    globalThis.window={assetForgeLocal:local,location:{href:'http://localhost/?project='+project,assign:url=>navigation.push(url)},history:{replaceState(){}},addEventListener:(type,fn)=>{if(type==='beforeunload')unload.push(fn);}};
    await import('../public/editor/app.mjs?chest-ui-'+(++loadId));
  }
  await load();
  return {get:id=>elements.get(id),values,navigation,unload,load,get server(){return server;},set offline(value){offline=value;},bumpRevision(){revision++;},get link(){return link;}};
}

test('独立外观编辑可增改保存, 普通分类保存不会丢失外观或生成资产',async t=>{
  const ui=await browser(t);
  assert.equal(typeof ui.get('chest-new')?.listeners.click,'function','缺少独立宝箱外观配置入口');
  assert.match(ui.get('chest-list').innerHTML,/木箱/);
  await ui.get('chest-new').listeners.click();
  for(const [key,value] of [['id','9'],['name','金箱'],['icon','chests/gold.png']]) {
    ui.get('chest-'+key).value=value;await ui.get('chest-'+key).listeners.input();
  }
  await ui.get('chest-save').listeners.click();
  assert.deepEqual(ui.server.chestAppearances,[appearance,{id:9,name:'金箱',icon:'chests/gold.png'}]);
  assert.deepEqual(ui.server.tables.item.rows,[{id:1}]);assert.equal(ui.server.categories.length,1);
  ui.get('category-name').value='新道具';await ui.get('category-form').listeners.input();
  await ui.get('category-form').listeners.submit({preventDefault(){}});
  assert.deepEqual(ui.server.chestAppearances,[appearance,{id:9,name:'金箱',icon:'chests/gold.png'}]);
});

test('外观草稿阻止导出和跨项目切换, 离线失败后可恢复并重试',async t=>{
  const ui=await browser(t,{local:true});
  assert.ok(ui.get('chest-name')?.listeners.input,'缺少外观草稿输入');
  ui.get('chest-name').value='待保存木箱';await ui.get('chest-name').listeners.input();
  await ui.get('export-now').listeners.click();assert.equal(ui.get('export-error').hidden,false);
  let prevented=false;ui.unload.at(-1)({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  ui.get('project-select').value='two';await ui.get('project-select').listeners.change();assert.deepEqual(ui.navigation,[]);
  ui.offline=true;await ui.get('chest-save').listeners.click();
  const key='asset-forge-draft:chest-ui:project:one';
  const saved=JSON.parse(ui.values.get(key));assert.equal(saved.chestAppearance.draft.name,'待保存木箱');
  ui.offline=false;await ui.load();assert.equal(ui.get('cloud-restore').hidden,false);
  await ui.get('cloud-restore').listeners.click();assert.equal(ui.get('chest-name').value,'待保存木箱');
  await ui.get('chest-save').listeners.click();assert.equal(ui.server.chestAppearances[0].name,'待保存木箱');
  assert.equal(ui.values.has(key),false);
  ui.get('project-select').value='two';await ui.get('project-select').listeners.change();assert.deepEqual(ui.navigation,['/?project=two']);
});

test('外观保存版本冲突保留草稿, 备份并重新加载后显示远端外观',async t=>{
  const ui=await browser(t);
  assert.ok(ui.get('chest-name')?.listeners.input,'缺少外观编辑器');
  ui.get('chest-name').value='冲突草稿';await ui.get('chest-name').listeners.input();ui.bumpRevision();
  await ui.get('chest-save').listeners.click();assert.match(ui.get('cloud-title').textContent,/冲突/);
  await ui.get('cloud-reload').listeners.click();
  const backup=await (await fetch(ui.link.href)).json();URL.revokeObjectURL(ui.link.href);
  assert.equal(backup.current.chestAppearance.draft.name,'冲突草稿');
  assert.equal(ui.get('chest-name').value,'木箱');
});

test('外观导出范围只写外观 YAML, 全量摘要包含独立外观配置',async t=>{
  const ui=await browser(t);
  assert.match(ui.get('export-scope').innerHTML,/__chest_appearances__/,'缺少外观导出范围');
  assert.match(ui.get('export-summary').textContent,/4 个 YAML/);
  const written=[];
  window.showDirectoryPicker=async()=>({name:'cfg',requestPermission:async()=>'granted',getFileHandle:async name=>({createWritable:async()=>({write:async content=>written.push({name,content}),close:async()=>{},abort:async()=>{}})})});
  await ui.get('choose-directory').listeners.click();ui.get('export-scope').value='__chest_appearances__';
  await ui.get('export-now').listeners.click();
  assert.deepEqual(written.map(file=>file.name),['chest-appearances.yaml']);assert.match(written[0].content,/chests\/wood.png/);
});

test('外观删除经过工作区引用校验, 共用外观不可删除, 无引用外观可以删除',async t=>{
  const workspace=enableDrops(fixture(),{start:20,end:29},{start:30,end:39});
  workspace.tables.drop_package.rows=[{id:20,name:'箱一',selection_mode:'weight',chest_appearance_id:1},{id:21,name:'箱二',selection_mode:'weight',chest_appearance_id:1}];
  workspace.tables.drop_entry.rows=[{id:30,package_id:20,weight:1,probability:10000,rewards:[{asset_id:1,count:1,probability:10000}]},{id:31,package_id:21,weight:1,probability:10000,rewards:[{asset_id:1,count:1,probability:10000}]}];
  workspace.chestAppearances.push({id:2,name:'未使用',icon:'chests/unused.png'});
  const ui=await browser(t,{workspace:normalizeWorkspace(workspace)});
  assert.match(ui.get('chest-references').textContent,/2 个掉落包/,ui.get('cloud-error').textContent);
  await ui.get('chest-delete').listeners.click();assert.equal(ui.get('chest-error').hidden,false);
  assert.equal(ui.server.chestAppearances.length,2);
  await ui.get('chest-list').listeners.click(click({chestId:'2'}));await ui.get('chest-delete').listeners.click();
  assert.deepEqual(ui.server.chestAppearances,[appearance]);assert.equal(ui.server.tables.drop_package.rows.length,2);
});

test('PNG 选择与取消使用现有选择器结果, 只有明确选择才产生外观草稿',async t=>{
  const previous=globalThis.document;t.after(()=>globalThis.document=previous);
  const elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
  let workspace=fixture(),path=null;
  const editor=mountChestAppearanceEditor({getWorkspace:()=>workspace,commit:async next=>{workspace=next;return true;},onDirty(){},notify(){},canEdit:()=>true,onSelectPng:async()=>path});
  const select=()=>elements.get('chest-png').listeners.click({target:{closest:selector=>selector==='[data-png-select]'?{}:null}});
  await select();assert.equal(editor.hasUnsaved(),false);
  path='chests/selected.png';await select();assert.equal(editor.hasUnsaved(),true);
  assert.equal(elements.get('chest-icon').value,'chests/selected.png');await elements.get('chest-save').listeners.click();
  assert.equal(workspace.chestAppearances[0].icon,'chests/selected.png');assert.equal(editor.hasUnsaved(),false);
});

test('PNG 选择结果不能写入重载后另一个外观草稿',async t=>{
  const previous=globalThis.document;t.after(()=>globalThis.document=previous);
  const elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
  let workspace=fixture(),resolvePng;
  const editor=mountChestAppearanceEditor({getWorkspace:()=>workspace,commit:async()=>true,onDirty(){},notify(){},canEdit:()=>true,onSelectPng:()=>new Promise(resolve=>resolvePng=resolve)});
  const selecting=elements.get('chest-png').listeners.click({target:{closest:selector=>selector==='[data-png-select]'?{}:null}});
  assert.equal(editor.hasUnsaved(),true,'资源选择期间必须阻止跨项目切换');
  workspace={...fixture(),chestAppearances:[{id:2,name:'新项目外观',icon:'chests/new.png'}]};editor.reset();
  resolvePng('chests/old-project.png');await selecting;
  assert.equal(elements.get('chest-icon').value,'chests/new.png');
  assert.equal(editor.hasUnsaved(),false);
});

test('新包必须明确选择外观, 下拉预览与列表图标来自可共用的外观',async t=>{
  const previous=globalThis.document;t.after(()=>globalThis.document=previous);
  const elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
  let workspace=enableDrops(fixture(),{start:20,end:29},{start:30,end:39});
  const editor=mountDropEditor({getWorkspace:()=>workspace,canEdit:()=>true,onDirty(){},notify(){},commit:async next=>{workspace=next;return true;}});
  const action=data=>elements.get('drops-view').listeners.click(click(data));
  await action({dropAction:'new'});
  assert.match(elements.get('drop-chest-appearance')?.innerHTML||'',/木箱/,'未提供必选外观下拉');
  assert.equal(editor.snapshot().pack.chest_appearance_id,'','新包不能自动选用首个外观');
  elements.get('drops-view').listeners.input(input({dropPackField:'name'},'测试包'));
  await action({dropAction:'add-entry'});elements.get('drops-view').listeners.input(input({dropEntry:'0',rewardIndex:'0',rewardProperty:'asset_id'},'1'));
  await action({dropAction:'save'});assert.equal(workspace.tables.drop_package.rows.length,0);
  elements.get('drops-view').listeners.input(input({dropPackField:'chest_appearance_id'},'1'));
  assert.match(elements.get('drop-chest-preview').innerHTML,/chests%2Fwood.png/);
  const draft=editor.snapshot();editor.reset();editor.restore(draft);
  assert.equal(editor.snapshot().pack.chest_appearance_id,'1','掉落包草稿恢复不能丢失用户已选外观');
  assert.match(elements.get('drop-chest-preview').innerHTML,/chests%2Fwood.png/);
  await action({dropAction:'save'});assert.equal(workspace.tables.drop_package.rows[0].chest_appearance_id,1);
  assert.match(elements.get('drop-packages').innerHTML,/chests%2Fwood.png/);
  await action({dropAction:'new'});assert.equal(editor.snapshot().pack.chest_appearance_id,'');
});
