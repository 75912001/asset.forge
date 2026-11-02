import test from 'node:test';
import assert from 'node:assert/strict';
import {mountEnumEditor} from '../public/editor/enum-editor.mjs';
import {replaceEnum} from '../public/editor/workspace.mjs';

function browser(t,select) {
  const previous=globalThis.document,elements=new Map();t.after(()=>globalThis.document=previous);
  globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'',classList:{toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},focus(){}});return elements.get(id);}};
  let workspace={categories:[],tables:{},enums:[{key:'slot',label:'部位',items:[{key:'undefined',label:'未定义',value:0},{key:'head',label:'头部',value:1}]}]};
  const editor=mountEnumEditor({getWorkspace:()=>workspace,commit:async(key,definition)=>{workspace=replaceEnum(workspace,key,definition);return true;},canEdit:()=>true,onDirty(){},notify(){},onSelectPng:select});
  const click=(index,clear=false)=>elements.get('enum-items').listeners.click({target:{closest:selector=>selector==='[data-png-select]'&&!clear||selector==='[data-png-clear]'&&clear?{dataset:{enumIcon:String(index)}}:null}});
  return {editor,elements,click,get workspace(){return workspace;}};
}

test('枚举图标选择、取消、清空和草稿恢复使用真实编辑链路',async t=>{
  let path=null;const ui=browser(t,async()=>path);
  assert.match(ui.elements.get('enum-items').innerHTML,/data-png-select/);
  await ui.click(1);assert.equal(ui.editor.hasUnsaved(),false);
  path='icons/head.png';await ui.click(1);
  assert.equal(ui.editor.snapshot().draft.items[1].icon,path);
  const draft=ui.editor.snapshot();ui.editor.reset();ui.editor.restore(draft);
  assert.match(ui.elements.get('enum-items').innerHTML,/icons%2Fhead.png/);
  await ui.elements.get('enum-save').listeners.click();assert.equal(ui.workspace.enums[0].items[1].icon,path);
  await ui.click(1,true);await ui.elements.get('enum-save').listeners.click();
  assert.equal(Object.hasOwn(ui.workspace.enums[0].items[1],'icon'),false);
});

test('等待 PNG 时阻止跨项目切换, 重载后迟到的图片结果不会改写新草稿',async t=>{
  let resolve;const ui=browser(t,()=>new Promise(done=>resolve=done));
  const selecting=ui.click(1);
  assert.equal(ui.editor.hasUnsaved(),true);
  ui.editor.reset();resolve('icons/old.png');await selecting;
  assert.equal(ui.editor.snapshot().draft.items[1].icon,undefined);
  assert.equal(ui.editor.hasUnsaved(),false);
});
