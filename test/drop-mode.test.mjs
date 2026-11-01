import test from 'node:test';
import assert from 'node:assert/strict';
import {load as parse} from 'js-yaml';
import {normalizeWorkspace,workspaceFiles} from '../public/editor/workspace.mjs';
import {emptyAssetTable} from '../public/editor/assets.mjs';
import * as drops from '../public/editor/drops.mjs';
import {rollRewards} from '../public/editor/rewards.mjs';
import {mountDropEditor} from '../public/editor/drop-editor.mjs';
function fixture() {
  const w=normalizeWorkspace(drops.enableDrops({chestAppearances:[{id:1,name:'木箱',icon:'icons/chests/wood.png'}],categories:[{key:'item',name:'道具',start:1,end:99}],enums:[],tables:{item:{...emptyAssetTable(),rows:[{id:1},{id:2}]}}},{start:200,end:209},{start:210,end:299}));
  return normalizeWorkspace(drops.saveDropPackage(w,{id:200,chest_appearance_id:1,name:'模式测试',selection_mode:'weight'},[
    {id:210,package_id:200,weight:60,probability:10000,rewards:[{asset_id:1,count:1,probability:10000}]},
    {id:211,package_id:200,weight:30,probability:5000,rewards:[{asset_id:2,count:1,probability:0},{asset_id:1,count:1,probability:10000}]},
    {id:212,package_id:200,weight:10,probability:0,rewards:[{asset_id:1,count:3,probability:10000}]}
  ]));
}
test('legacy marked drop tables gain weight mode and per-entry probabilities without changing data or field order',()=>{
  const w=fixture();
  w.tables.drop_package.fields=w.tables.drop_package.fields.filter(f=>f.key!=='selection_mode');delete w.tables.drop_package.rows[0].selection_mode;
  w.tables.drop_entry.fields=w.tables.drop_entry.fields.filter(f=>f.key!=='probability');for(const entry of w.tables.drop_entry.rows)delete entry.probability;
  const before=structuredClone(w),saved=normalizeWorkspace(w);
  assert.equal(saved.tables.drop_package.rows[0].selection_mode,'weight');
  assert.deepEqual(saved.tables.drop_entry.rows.map(row=>row.probability),[10000,10000,10000]);
  assert.deepEqual(saved.tables.drop_entry.fields.slice(0,before.tables.drop_entry.fields.length),before.tables.drop_entry.fields);
  assert.deepEqual(w,before,'normalization must not mutate the old workspace');
  assert.deepEqual(saved.tables.drop_entry.rows[1].rewards,before.tables.drop_entry.rows[1].rewards);
});
test('weight mode picks exactly one, probability mode independently picks zero, one, or multiple combinations',()=>{
  assert.equal(typeof drops.selectDropEntries,'function','mode-aware selection contract is missing');
  const w=fixture(),pack=w.tables.drop_package.rows[0],entries=w.tables.drop_entry.rows;
  assert.deepEqual(drops.selectDropEntries(pack,entries,{weightRoll:60n}).map(e=>e.id),[211]);
  pack.selection_mode='probability';
  assert.deepEqual(drops.selectDropEntries(pack,entries,{probabilityRoll:()=>4999}).map(e=>e.id),[210,211]);
  assert.deepEqual(drops.selectDropEntries(pack,entries,{probabilityRoll:()=>5000}).map(e=>e.id),[210]);
  const all=entries.map(e=>({...e,probability:10000}));assert.equal(drops.selectDropEntries(pack,all,{probabilityRoll:()=>9999}).length,3);
  assert.deepEqual(drops.selectDropEntries(pack,entries.map(e=>({...e,probability:0})),{probabilityRoll:()=>0}),[]);
  const chosen=drops.selectDropEntries(pack,entries,{probabilityRoll:()=>0});
  assert.deepEqual(chosen.flatMap(e=>rollRewards(e.rewards,()=>0)).map(r=>r.asset_id),[1,1],'reward-level probability still applies after a combination is selected');
  const other={...entries[0],id:213,package_id:201};assert.equal(drops.selectDropEntries(pack,[...all,other],{probabilityRoll:()=>0}).length,3);
  for(const roll of [-1,10000,0.5])assert.throws(()=>drops.selectDropEntries(pack,entries,{probabilityRoll:()=>roll}),/判定值/);
});
test('mode and combination probability validation protects core fields, with separate YAML keys at each level',()=>{
  const w=fixture();assert.equal(w.tables.drop_package.rows[0].selection_mode,'weight');
  w.tables.drop_package.rows[0].selection_mode='probability';
  const saved=normalizeWorkspace(w),files=workspaceFiles(saved,'asset-categories.yaml');
  assert.equal(parse(files.find(f=>f.name==='drop_package.yaml').content).rows[0].selection_mode,'probability');
  const rows=parse(files.find(f=>f.name==='drop_entry.yaml').content).rows;
  assert.deepEqual(rows.map(e=>e.probability),[10000,5000,0]);assert.equal(rows[1].rewards[0].probability,0);
  for(const value of ['other','',null]){const bad=structuredClone(w);bad.tables.drop_package.rows[0].selection_mode=value;assert.throws(()=>normalizeWorkspace(bad));}
  for(const value of [-1,10001,0.5,'',null]){const bad=structuredClone(w);bad.tables.drop_entry.rows[0].probability=value;assert.throws(()=>normalizeWorkspace(bad));}
  const bad=structuredClone(w);bad.tables.drop_entry.fields.find(f=>f.key==='probability').type='string';assert.throws(()=>normalizeWorkspace(bad),/核心字段/);
});
test('mode switch changes the combination controls, preserves both inputs and reward probabilities, and saves together',async t=>{
  const oldDocument=globalThis.document,elements=new Map();t.after(()=>{globalThis.document=oldDocument;});
  globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',innerHTML:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return elements.get(id);}};
  let workspace=fixture(),calls=0;
  const editor=mountDropEditor({getWorkspace:()=>workspace,onDirty(){},notify(){},canEdit:()=>true,commit:async next=>{calls++;workspace=normalizeWorkspace(next);return true;}});
  const input=(dataset,value)=>elements.get('drops-view').listeners.input({target:{dataset,value}});
  input({dropPackField:'selection_mode'},'probability');
  assert.equal(elements.get('drop-mode-probability')?.checked,true);assert.equal(elements.get('drop-mode-weight')?.checked,false);
  assert.match(elements.get('drop-entries').innerHTML,/data-drop-field="probability"/);assert.doesNotMatch(elements.get('drop-entries').innerHTML,/data-drop-field="weight"/);
  input({dropEntry:'1',dropField:'probability'},'7500');input({dropPackField:'selection_mode'},'weight');
  assert.equal(elements.get('drop-mode-weight')?.checked,true);assert.equal(elements.get('drop-mode-probability')?.checked,false);
  assert.match(elements.get('drop-entries').innerHTML,/data-drop-field="weight"/);assert.equal(editor.snapshot().entries[0].weight,60);
  input({dropPackField:'selection_mode'},'probability');assert.equal(editor.snapshot().entries[1].probability,'7500');
  const backup=editor.snapshot();editor.reset();editor.restore(backup);assert.equal(editor.snapshot().pack.selection_mode,'probability');
  await elements.get('drops-view').listeners.click({target:{closest:()=>({dataset:{dropAction:'save'}})}});
  assert.equal(calls,1);assert.equal(workspace.tables.drop_package.rows[0].selection_mode,'probability');assert.equal(workspace.tables.drop_entry.rows[1].probability,7500);
  assert.equal(workspace.tables.drop_entry.rows[0].rewards[0].probability,10000);
});
