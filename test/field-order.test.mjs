import test from 'node:test';
import assert from 'node:assert/strict';
import * as assets from '../public/editor/assets.mjs';
import {seedEnums} from '../public/editor/enums.mjs';
import {readWorkspace,writeWorkspace,workspaceFiles} from '../public/editor/workspace.mjs';
const category={key:'item',name:'道具',start:100,end:199};
const table=()=>({fields:[...assets.emptyAssetTable().fields,
  {key:'name',label:'名称',type:'string',required:false},
  {key:'slot',label:'部位',type:'enum',enum:'equipment_slot',required:true},
  {key:'amount',label:'数量',type:'uint64',required:true}],
  rows:[{id:100,name:'头盔',slot:1,amount:'18446744073709551615'}]});

test('field moves reorder only the schema and preserve values, enum reference and uint64 precision',()=>{
  assert.equal(typeof assets.moveAssetField,'function','field ordering is unavailable');
  const original=table();
  const moved=assets.moveAssetField(original,3,1);
  assert.deepEqual(moved.fields.map(field=>field.key),['id','amount','name','slot']);
  assert.deepEqual(moved.rows,[{id:100,name:'头盔',slot:1,amount:'18446744073709551615'}]);
  assert.equal(moved.fields[3].enum,'equipment_slot');
  assert.deepEqual(original.fields.map(field=>field.key),['id','name','slot','amount']);
  assert.deepEqual(assets.moveAssetField(moved,1,3).fields.map(field=>field.key),['id','name','slot','amount']);
  assert.deepEqual(assets.moveAssetField(moved,2,2),moved);
});

test('ID cannot be moved or displaced and invalid field positions are rejected',()=>{
  assert.equal(typeof assets.moveAssetField,'function','field ordering is unavailable');
  for(const [from,to] of [[0,2],[1,0],[-1,1],[1,4],[1.5,2]])assert.throws(()=>assets.moveAssetField(table(),from,to));
});

test('saved field order survives reload and controls both schema and row order in YAML',()=>{
  assert.equal(typeof assets.moveAssetField,'function','field ordering is unavailable');
  const map=new Map();const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const moved=assets.moveAssetField(table(),3,1);
  writeWorkspace(storage,{categories:[category],tables:{item:moved},enums:seedEnums()});
  const saved=readWorkspace(storage,[]);
  assert.deepEqual(saved.tables.item.fields.map(field=>field.key),['id','amount','name','slot']);
  const yaml=workspaceFiles(saved,'asset-categories.yaml').find(file=>file.name==='item.yaml').content;
  assert.match(yaml,/key: "id"[\s\S]*key: "amount"[\s\S]*key: "name"[\s\S]*key: "slot"/);
  assert.match(yaml,/rows:\n  - id: 100\n    amount: 18446744073709551615\n    name: "头盔"\n    slot: 1\n/);
});
