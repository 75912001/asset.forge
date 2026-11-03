import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, open, unlink, rmdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';

// Only native browser boundaries are replaced. The real app handlers, model,
// YAML serializer, Blob and object URLs run unchanged.
class Element {
  constructor(attributes = '') {
    this.value = /\bvalue="([^"]*)"/.exec(attributes)?.[1] || '';
    this.textContent = ''; this.hidden = /\bhidden\b/.test(attributes);
    this.listeners = {}; this.disabled = false;this.classList={toggle:()=>{}};
  }
  addEventListener(name,handler) { this.listeners[name] = handler; }
  remove() {}
  querySelector() {return null;}
  querySelectorAll() {return [];}
  focus() {}
}
const html = await readFile(new URL('../public/editor/index.html',import.meta.url),'utf8');
const elements = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(match=>[match[1],new Element(match[0])]));
let clickedLink;
globalThis.document = {
  getElementById:id=>elements.get(id), querySelectorAll:()=>[],
  createElement:()=>{ const link=new Element();link.click=()=>{clickedLink={href:link.href,download:link.download};};return link; },
  body:{append:()=>{}}
};
globalThis.window={location:{href:'http://localhost/'},addEventListener:()=>{},showDirectoryPicker:async()=>{throw new DOMException('The user aborted a request.','AbortError');}};
const savedValues=new Map();
let serverWorkspace=normalizeWorkspace({categories:[
  {key:'role',name:'角色',start:10000,end:19999,description:''},
  {key:'item',name:'道具',start:20000,end:29999,description:''},
  {key:'skill',name:'技能',start:30000,end:39999,description:''},
  {key:'level',name:'关卡',start:40000,end:49999,description:''}
],tables:{}}),serverRevision=1,saveMode='ok';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(typeof url!=='string'||!url.startsWith('/api/workspace'))return nativeFetch(url,options);
  if(options?.method){
    if(saveMode==='offline')throw new TypeError('offline');
    const body=JSON.parse(options.body);
    if(body.expectedRevision!==serverRevision)return Response.json({error:'本地版本已更新'},{status:409});
    serverWorkspace=normalizeWorkspace(body.workspace);serverRevision++;
  }
  return Response.json({workspace:serverWorkspace,revision:serverRevision,user:{id:'ui-user',name:'UI User'}});
};
globalThis.confirm=()=>true;
globalThis.localStorage={getItem:key=>savedValues.get(key)??null,setItem:(key,value)=>savedValues.set(key,value),removeItem:key=>savedValues.delete(key)};
globalThis.indexedDB={open:()=>{const request={error:new Error('Storage unavailable')};queueMicrotask(()=>request.onerror());return request;}};
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms)=>nativeSetTimeout(fn,ms).unref();
await import('../public/editor/app.mjs');

test('an immediately aborted native picker displays an actionable result',async()=>{
  await elements.get('choose-directory').listeners.click();
  const error=elements.get('export-error');
  assert.equal(error.hidden,false,'picker cancellation was silently ignored');
  assert.match(error.textContent,/Chrome|Edge/);
  assert.equal(elements.get('choose-directory').disabled,false);
});
test('download fallback contains the saved YAML and configured filename',async()=>{
  const download=elements.get('download-yaml');
  assert.ok(download?.listeners.click,'no usable YAML download fallback');
  elements.get('export-filename').value='game-assets.yml';
  await download.listeners.click();
  assert.equal(clickedLink.download,'game-assets.yml');
  const contents=await (await fetch(clickedLink.href)).text();
  assert.match(contents,/id_start: 10000\n/);
  assert.match(contents,/name: "角色"/);
  URL.revokeObjectURL(clickedLink.href);
});

test('selects a directory before requesting write access and writes only after an explicit grant',async()=>{
  const folder = await mkdtemp(join(tmpdir(),'asset-forge-export-'));
  const target = join(folder,'selected-export.yaml');
  let permission='denied',requests=0;const written=[];
  const handle={
    name:'cfg',
    queryPermission:async()=>permission,
    requestPermission:async options=>{assert.equal(options.mode,'readwrite');requests++;return permission;},
    getFileHandle:async(filename,options)=>{
      assert.ok(['selected-export.yaml','asset-enums.yaml','hero-motion.yaml','role.yaml','item.yaml','skill.yaml','level.yaml'].includes(filename)); assert.equal(options.create,true);
      written.push(filename);
      return {createWritable:async()=>{
        const file=await open(join(folder,filename),'w');
        return {write:content=>file.writeFile(content,'utf8'),close:()=>file.close(),abort:()=>file.close()};
      }};
    }
  };
  window.showDirectoryPicker=async options=>{
    if(options.mode!=='read') throw new DOMException('Write access not granted during selection','AbortError');
    return handle;
  };
  try {
    await elements.get('choose-directory').listeners.click();
    assert.equal(elements.get('directory-name').textContent,'cfg','selection must not depend on write access');
    assert.equal(requests,0,'write permission must wait for the Export click');
    elements.get('export-filename').value='selected-export.yaml';
    await elements.get('export-now').listeners.click();
    assert.equal(elements.get('directory-name').textContent,'cfg','denied write access must keep the selected directory');
    assert.equal(elements.get('export-error').hidden,false);
    await assert.rejects(access(target));
    permission='granted';
    await elements.get('export-now').listeners.click();
    assert.ok(requests>=1);
    assert.deepEqual(written,['selected-export.yaml','asset-enums.yaml','hero-motion.yaml','role.yaml','item.yaml','skill.yaml','level.yaml']);
    assert.match(await readFile(target,'utf8'),/id_start: 10000\n/);
    assert.equal(elements.get('export-error').hidden,true);
  } finally { for(const file of written)await unlink(join(folder,file)).catch(()=>{});await rmdir(folder); }
});

test('an aborted file write reports the failed stage and native error while keeping the directory',async()=>{
  window.showDirectoryPicker=async()=>({
    name:'cfg',queryPermission:async()=>'granted',requestPermission:async()=>'granted',
    getFileHandle:async()=>({createWritable:async()=>{throw new DOMException('Write interrupted','AbortError');}})
  });
  await elements.get('choose-directory').listeners.click();
  await elements.get('export-now').listeners.click();
  assert.equal(elements.get('directory-name').textContent,'cfg');
  assert.equal(elements.get('export-error').hidden,false);
  assert.match(elements.get('export-error').textContent,/AbortError/);
  assert.match(elements.get('export-error').textContent,/Write interrupted/);
});
test('field text input is retained when the asset table is saved',async()=>{
  await elements.get('asset-add-field').listeners.click();
  for(const [property,value] of [['key','title'],['label','名称']]) {
    const input={dataset:{field:'1',property},value};input.closest=()=>input;
    await elements.get('asset-field-rows').listeners.input({target:input});
  }
  await elements.get('asset-save').listeners.click();
  assert.match(elements.get('asset-yaml').textContent,/key: "title"\n    label: "名称"/);
});

function inputEvent(dataset,value,extra={}) {
  const input={dataset,value,...extra};input.closest=()=>input;return {target:input};
}
const savedWorkspace=()=>serverWorkspace;

test('creates and saves an enum with fixed zero and blocks export of an unsaved enum draft',async()=>{
  assert.ok(elements.get('enum-new')?.listeners.click,'enum management is unavailable');
  await elements.get('enum-new').listeners.click();
  elements.get('enum-key').value='rarity';elements.get('enum-label').value='品质';
  await elements.get('enum-key').listeners.input();
  await elements.get('enum-label').listeners.input();
  await elements.get('enum-add-item').listeners.click();
  for(const [property,value] of [['key','rare'],['label','稀有'],['value','10']]) {
    await elements.get('enum-items').listeners.input(inputEvent({enumItem:'1',property},value));
  }
  await elements.get('export-now').listeners.click();
  assert.equal(elements.get('export-error').hidden,false);
  await elements.get('enum-save').listeners.click();
  const definition=savedWorkspace().enums.find(entry=>entry.key==='rarity');
  assert.deepEqual(definition.items,[{key:'undefined',label:'未定义',value:0},{key:'rare',label:'稀有',value:10}]);
  assert.equal(elements.get('enum-error').hidden,true);
});

test('enum table cells save numeric selections, reject blank required cells and preserve unknown conversions',async()=>{
  await elements.get('asset-add-field').listeners.click();
  for(const [property,value] of [['key','slot'],['label','部位'],['type','enum'],['required','']]) {
    await elements.get('asset-field-rows').listeners.change(inputEvent({field:'2',property},value,{checked:true}));
  }
  await elements.get('asset-add-row').listeners.click();
  await elements.get('asset-save').listeners.click();
  assert.equal(elements.get('asset-error').hidden,false);
  await elements.get('asset-data-rows').listeners.input(inputEvent({record:'0',column:'2'},'0'));
  await elements.get('asset-save').listeners.click();
  assert.equal(savedWorkspace().tables.role.rows[0].slot,0);
  assert.equal(savedWorkspace().tables.role.fields[2].enum,'equipment_slot');
  assert.match(elements.get('asset-data-rows').innerHTML,/未定义 · 0/);
  await elements.get('asset-data-rows').listeners.input(inputEvent({record:'0',column:'2'},'9'));
  await elements.get('asset-field-rows').listeners.change(inputEvent({field:'2',property:'enum'},'rarity'));
  assert.match(elements.get('asset-data-rows').innerHTML,/无效值: 9/);
  await elements.get('asset-save').listeners.click();
  assert.equal(elements.get('asset-error').hidden,false);
  await elements.get('asset-data-rows').listeners.input(inputEvent({record:'0',column:'2'},'10'));
  await elements.get('asset-save').listeners.click();
  assert.equal(savedWorkspace().tables.role.rows[0].slot,10);
});

test('enum rename refreshes a previously open table and later table saves retain the new reference',async()=>{
  elements.get('enum-key').value='item_rarity';await elements.get('enum-key').listeners.input();
  await elements.get('enum-save').listeners.click();
  assert.equal(savedWorkspace().tables.role.fields[2].enum,'item_rarity');
  await elements.get('asset-save').listeners.click();
  assert.equal(savedWorkspace().tables.role.fields[2].enum,'item_rarity');
  assert.equal(savedWorkspace().tables.role.rows[0].slot,10);
  await elements.get('enum-delete').listeners.click();
  assert.equal(elements.get('enum-error').hidden,false);
  await elements.get('enum-download').listeners.click();
  assert.equal(clickedLink.download,'asset-enums.yaml');
  assert.match(await (await fetch(clickedLink.href)).text(),/key: "item_rarity"/);
  URL.revokeObjectURL(clickedLink.href);
});

test('selected enum and table exports write only the requested file',async()=>{
  const written=[];
  window.showDirectoryPicker=async()=>({name:'cfg',requestPermission:async()=>'granted',
    getFileHandle:async name=>({createWritable:async()=>({write:async content=>written.push({name,content}),close:async()=>{},abort:async()=>{}})})});
  await elements.get('choose-directory').listeners.click();
  elements.get('export-scope').value='__enums__';
  await elements.get('export-now').listeners.click();
  assert.deepEqual(written.map(file=>file.name),['asset-enums.yaml']);
  assert.match(written[0].content,/key: "item_rarity"/);
  written.length=0;elements.get('export-scope').value='role';
  await elements.get('export-now').listeners.click();
  assert.deepEqual(written.map(file=>file.name),['role.yaml']);
  assert.match(written[0].content,/enum: "item_rarity"/);
  assert.match(written[0].content,/slot: 10\n/);
});

test('unsaved table and enum drafts cannot overwrite each other',async()=>{
  await elements.get('asset-data-rows').listeners.input(inputEvent({record:'0',column:'2'},'0'));
  elements.get('enum-key').value='ignored';await elements.get('enum-key').listeners.input();
  assert.equal(elements.get('enum-key').value,'item_rarity');
  await elements.get('asset-save').listeners.click();
  elements.get('enum-label').value='装备品质';await elements.get('enum-label').listeners.input();
  await elements.get('asset-add-row').listeners.click();
  await elements.get('enum-save').listeners.click();
  assert.equal(savedWorkspace().enums.find(entry=>entry.key==='item_rarity').label,'装备品质');
  assert.deepEqual(savedWorkspace().tables.role.rows,[{id:10000,title:'',slot:0}]);
});

test('dragging field handles reorders the draft, preserves values and saves the new column order',async()=>{
  const grid=elements.get('asset-field-rows');
  assert.equal(typeof grid.listeners.dragstart,'function','field dragging is unavailable');
  const transfer={setData:()=>{}};
  const start=index=>({target:{closest:selector=>selector==='[data-move-field]'?{dataset:{moveField:String(index)}}:null},dataTransfer:transfer,preventDefault:()=>{}});
  const drop=(index,y)=>({target:{closest:()=>({dataset:{fieldRow:String(index)},getBoundingClientRect:()=>({top:100,height:40}),classList:{add:()=>{}}})},clientY:y,dataTransfer:transfer,preventDefault:()=>{}});
  await grid.listeners.dragstart(start(2));
  await grid.listeners.drop(drop(1,105));
  assert.match(elements.get('asset-save-state').textContent,/未保存/);
  assert.deepEqual(savedWorkspace().tables.role.fields.map(field=>field.key),['id','title','slot']);
  await elements.get('asset-save').listeners.click();
  assert.deepEqual(savedWorkspace().tables.role.fields.map(field=>field.key),['id','slot','title']);
  assert.deepEqual(savedWorkspace().tables.role.rows,[{id:10000,slot:0,title:''}]);
  assert.match(elements.get('asset-yaml').textContent,/key: "slot"[\s\S]*key: "title"/);
  await grid.listeners.dragstart(start(1));
  await grid.listeners.drop(drop(2,135));
  await elements.get('asset-save').listeners.click();
  assert.deepEqual(savedWorkspace().tables.role.fields.map(field=>field.key),['id','title','slot']);
  await grid.listeners.dragstart(start(2));
  const fixedDrop=drop(0,105);let prevented=false;
  fixedDrop.preventDefault=()=>{prevented=true;};
  await grid.listeners.drop(fixedDrop);
  assert.equal(prevented,true,'a rejected field drop must not insert drag text into an input');
  assert.equal(elements.get('asset-save-state').textContent,'已保存到本地');
});

test('field handles support keyboard ordering while keeping ID first',async()=>{
  const grid=elements.get('asset-field-rows');
  const key=(index,value)=>({target:{closest:()=>({dataset:{moveField:String(index)}})},key:value,preventDefault:()=>{}});
  assert.equal(typeof grid.listeners.keydown,'function');
  await grid.listeners.keydown(key(2,'ArrowUp'));
  await elements.get('asset-save').listeners.click();
  assert.deepEqual(savedWorkspace().tables.role.fields.map(field=>field.key),['id','slot','title']);
  await grid.listeners.keydown(key(1,'ArrowUp'));
  assert.equal(elements.get('asset-save-state').textContent,'已保存到本地');
});

test('network failure keeps table drafts, retry saves to cloud, and conflict reload first backs up local edits',async()=>{
  saveMode='offline';
  await elements.get('asset-data-rows').listeners.input(inputEvent({record:'0',column:'1'},'10'));
  await elements.get('asset-save').listeners.click();
  assert.equal(savedWorkspace().tables.role.rows[0].slot,0);
  assert.match(elements.get('asset-save-state').textContent,/未保存/);
  const draft=JSON.parse(savedValues.get('asset-forge-draft:ui-user'));
  assert.equal(draft.asset.draft.rows[0].slot,'10');
  assert.equal(savedValues.has('asset-forge-workspace-v2'),false,'cloud saves must not replace the original migration source');
  saveMode='ok';await elements.get('asset-save').listeners.click();
  assert.equal(savedWorkspace().tables.role.rows[0].slot,10);
  serverRevision++;
  await elements.get('asset-data-rows').listeners.input(inputEvent({record:'0',column:'1'},'0'));
  await elements.get('asset-save').listeners.click();
  assert.match(elements.get('cloud-title').textContent,/冲突/);
  await elements.get('cloud-reload').listeners.click();
  const backup=JSON.parse(await (await fetch(clickedLink.href)).text());
  assert.equal(backup.current.asset.draft.rows[0].slot,'0');
  assert.equal(savedWorkspace().tables.role.rows[0].slot,10);
  assert.equal(elements.get('asset-save-state').textContent,'已保存到本地');
  URL.revokeObjectURL(clickedLink.href);
});

let migrationFixture;
test('a fresh browser waits for migration and never uploads seeded default categories',async()=>{
  migrationFixture=structuredClone(serverWorkspace);serverWorkspace=null;serverRevision=0;savedValues.clear();
  await import('../public/editor/app.mjs?fresh-browser');
  assert.equal(serverWorkspace,null);
  assert.equal(elements.get('cloud-title').textContent,'等待原电脑迁移');
  assert.equal(elements.get('cloud-migrate').hidden,true);
  assert.equal(elements.get('workspace-content').hidden,true);
});

test('the original browser downloads a full backup then migrates without changing the legacy storage key',async()=>{
  const original=JSON.stringify(migrationFixture);savedValues.set('asset-forge-workspace-v2',original);
  await import('../public/editor/app.mjs?original-browser');
  assert.equal(elements.get('cloud-migrate').hidden,false);
  await elements.get('cloud-migrate').listeners.click();
  assert.equal(serverRevision,1);assert.deepEqual(serverWorkspace,migrationFixture);
  assert.equal(savedValues.get('asset-forge-workspace-v2'),original);
  const backup=JSON.parse(await (await fetch(clickedLink.href)).text());
  assert.equal(backup.legacy.workspace,original);URL.revokeObjectURL(clickedLink.href);
  assert.equal(elements.get('workspace-content').hidden,false);
});

test('a failed-save draft survives page reopening and can be explicitly restored and saved',async()=>{
  await elements.get('asset-add-field').listeners.click();
  await elements.get('asset-field-rows').listeners.input(inputEvent({field:'3',property:'key'},'pending_field'));
  saveMode='offline';await elements.get('asset-save').listeners.click();
  assert.ok(savedValues.has('asset-forge-draft:ui-user'));
  saveMode='ok';await import('../public/editor/app.mjs?restore-pending');
  assert.equal(elements.get('cloud-restore').hidden,false);
  assert.equal(elements.get('workspace-content').inert,true);
  await elements.get('cloud-restore').listeners.click();
  assert.match(elements.get('asset-field-rows').innerHTML,/pending_field/);
  await elements.get('asset-save').listeners.click();
  assert.equal(serverWorkspace.tables.role.fields[3].key,'pending_field');
  assert.equal(savedValues.has('asset-forge-draft:ui-user'),false,'an acknowledged save must clear the stale draft before an immediate reload');
});

test('table export writes only YAML with the original relative PNG path and does not fetch or copy images',async t=>{
  const path='images/'+'e'.repeat(64)+'.png',bytes=Uint8Array.from([137,80,78,71,0,255]);
  serverWorkspace.tables.role.fields.push({key:'icon',label:'图标',type:'png',required:false});
  serverWorkspace.tables.role.rows[0].icon=path;serverRevision++;
  await elements.get('cloud-reload').listeners.click();
  const priorFetch=globalThis.fetch;t.after(()=>globalThis.fetch=priorFetch);
  globalThis.fetch=async(url,options)=>{assert.ok(!url.startsWith('/api/images?'),'export must not read or copy PNG resources');return priorFetch(url,options);};
  const written=[];
  const file=(folder,name)=>({createWritable:async()=>({write:async content=>written.push({name:folder+name,content}),close:async()=>{},abort:async()=>{}})});
  window.showDirectoryPicker=async()=>({name:'cfg',requestPermission:async()=>'granted',
    getDirectoryHandle:async(name,options)=>{assert.equal(name,'images');assert.equal(options.create,true);return {getFileHandle:async name=>file('images/',name)};},
    getFileHandle:async name=>file('',name)});
  await elements.get('choose-directory').listeners.click();elements.get('export-scope').value='role';
  await elements.get('export-now').listeners.click();
  assert.equal(elements.get('export-error').hidden,true);
  assert.deepEqual(written.map(file=>file.name),['role.yaml']);
  assert.ok(written[0].content.includes('icon: "'+path+'"'));
});
