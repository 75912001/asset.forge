import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
const editorModule=await import('../public/editor/hero-editor.mjs').catch(()=>({}));
const assets=await import('../public/editor/hero-assets.mjs').catch(()=>({}));

test('头像与武器验证实际像素, 拒绝无透明背景和全透明素材',()=>{
  assert.equal(typeof assets.validateHeroPixels,'function');
  assert.throws(()=>assets.validateHeroPixels(new Uint8ClampedArray(16),2,2,256),/256/);
  const pixels=new Uint8ClampedArray(128*128*4);pixels.fill(255);
  assert.throws(()=>assets.validateHeroPixels(pixels,128,128,128),/透明背景/);
  pixels.fill(0);assert.throws(()=>assets.validateHeroPixels(pixels,128,128,128),/可见/);
  pixels[3]=255;assert.doesNotThrow(()=>assets.validateHeroPixels(pixels,128,128,128));
});

test('调参草稿只在显式保存后更新工作区, 保存失败保留草稿, 可恢复与放弃',async t=>{
  assert.equal(typeof editorModule.mountHeroEditor,'function');
  const previous={document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,fetch:globalThis.fetch,confirm:globalThis.confirm};
  t.after(()=>Object.assign(globalThis,previous));
  const elements=new Map();
  const context={clearRect(){},save(){},restore(){},translate(){},scale(){},drawImage(){}};
  const element=()=>({value:'',hidden:false,checked:false,listeners:{},classList:{toggle(){}},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll(){return [];},getContext(){return context;},setAttribute(){}});
  globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},addEventListener(){}};
  globalThis.requestAnimationFrame=()=>0;globalThis.confirm=()=>true;
  globalThis.fetch=async()=>Response.json({root:'assets',paths:[]});
  let workspace=normalizeWorkspace({categories:[],tables:{},enums:[]}),allowSave=false;
  const editor=editorModule.mountHeroEditor({getWorkspace:()=>workspace,onDirty(){},notify(){},canEdit:()=>true,onSelectPng:async()=>null,commit:async next=>{if(!allowSave)return false;workspace=next;return true;}});
  const input={dataset:{heroParam:'amplitude'},value:'65'};
  elements.get('hero-parameters').listeners.input({target:input});
  assert.equal(workspace.heroMotion.amplitude,.35);assert.equal(editor.snapshot().draft.amplitude,.65);assert.equal(editor.hasUnsaved(),true);
  await elements.get('hero-save').listeners.click();assert.equal(editor.hasUnsaved(),true);
  const snapshot=editor.snapshot();editor.reset();editor.restore(snapshot);
  assert.equal(editor.hasUnsaved(),true);assert.equal(editor.snapshot().draft.amplitude,.65);
  allowSave=true;await elements.get('hero-save').listeners.click();assert.equal(workspace.heroMotion.amplitude,.65);assert.equal(editor.hasUnsaved(),false);
  input.value='100';elements.get('hero-parameters').listeners.input({target:input});
  await elements.get('hero-discard').listeners.click();assert.equal(editor.snapshot().draft.amplitude,.65);assert.equal(editor.hasUnsaved(),false);
});
