import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkspace,writeWorkspace,replaceCategories,workspaceFiles} from '../public/editor/workspace.mjs';
import {emptyAssetTable} from '../public/editor/assets.mjs';
const role={key:'role',name:'角色',start:100,end:199,description:''};
function storage(initial={}) {const map=new Map(Object.entries(initial));return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};}
const populated=()=>({categories:[role],tables:{role:{fields:[...emptyAssetTable().fields,{key:'amount',label:'数量',type:'uint64',required:true}],rows:[{id:100,amount:'18446744073709551615'}]}}});
test('migrates existing categories to corresponding empty tables without changing old saved data',()=>{
  const old=JSON.stringify([role]); const store=storage({'asset-forge-categories-v1':old});
  const workspace=readWorkspace(store,[]);
  assert.deepEqual(workspace.categories,[role]); assert.deepEqual(workspace.tables.role,emptyAssetTable());
  writeWorkspace(store,workspace); assert.equal(store.getItem('asset-forge-categories-v1'),old);
});
test('one save preserves the schema, records and exact uint64 across reload',()=>{
  const store=storage(); const result=writeWorkspace(store,populated());
  assert.deepEqual(readWorkspace(store,[]),result);
  assert.equal(readWorkspace(store,[]).tables.role.rows[0].amount,'18446744073709551615');
});
test('renaming a category preserves its table and adding a category creates its table',()=>{
  const next=replaceCategories(populated(),[{...role,key:'hero'},{key:'item',name:'道具',start:200,end:299}],{from:'role',to:'hero'});
  assert.equal(next.tables.hero.rows[0].id,100); assert.equal(Object.hasOwn(next.tables,'role'),false);
  assert.deepEqual(next.tables.item,emptyAssetTable());
});
test('changing a category range cannot invalidate existing saved IDs',()=>{
  assert.throws(()=>replaceCategories(populated(),[{...role,start:101}]),/范围/);
});
test('deleting a category removes only its matching table',()=>{
  const existing=replaceCategories(populated(),[role,{key:'item',name:'道具',start:200,end:299}]);
  assert.deepEqual(Object.keys(existing.tables),['role','item']);
  const next=replaceCategories(existing,[role]); assert.deepEqual(Object.keys(next.tables),['role']);
  assert.equal(next.tables.role.rows[0].amount,'18446744073709551615');
});
test('invalid values cannot replace an already saved workspace',()=>{
  const store=storage();writeWorkspace(store,populated());
  const invalid=populated();invalid.tables.role.rows[0].id=99;
  assert.throws(()=>writeWorkspace(store,invalid));
  assert.equal(readWorkspace(store,[]).tables.role.rows[0].id,100);
});
test('exports a category file plus each category table and rejects filename collisions',()=>{
  const files=workspaceFiles(populated(),'asset-categories.yaml');
  assert.deepEqual(files.map(file=>file.name),['asset-categories.yaml','asset-enums.yaml','chest-appearances.yaml','role.yaml']);
  assert.match(files[3].content,/amount: 18446744073709551615\n/);
  assert.throws(()=>workspaceFiles(populated(),'ROLE.yaml'),/冲突/);
});
