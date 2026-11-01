import test from 'node:test';
import assert from 'node:assert/strict';
import * as workspace from '../public/editor/workspace.mjs';
import {emptyAssetTable,normalizeAssetTable,changeAssetField,assetTableYaml} from '../public/editor/assets.mjs';
const category={key:'item',name:'装备',start:100,end:199};
const zero={key:'undefined',label:'未定义',value:0};
const slot=()=>({key:'equipment_slot',label:'装备部位',items:[zero,{key:'head',label:'头部',value:1},{key:'body',label:'身体',value:2}]});
const field={key:'slot',label:'部位',type:'enum',enum:'equipment_slot',required:true};
const table=(value=1)=>({fields:[...emptyAssetTable().fields,field],rows:[{id:100,slot:value}]});
const data=()=>({categories:[category],enums:[slot()],tables:{item:table()}});
const normalizeEnums=value=>workspace.writeWorkspace(storage(),{categories:[],tables:{},enums:value}).enums;
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};

test('enum definitions require the fixed zero and unique uint32 values and identifiers',()=>{
  assert.deepEqual(workspace.writeWorkspace(storage(),{categories:[],tables:{},enums:[slot()]}).enums,[slot()]);
  for(const item of [{key:'extra',label:'重复数值',value:1},{key:'head',label:'重复标识',value:3},{key:'large',label:'溢出',value:'4294967296'},{key:'negative',label:'负数',value:-1}]) {
    assert.throws(()=>normalizeEnums([{...slot(),items:[...slot().items,item]}]));
  }
  assert.throws(()=>normalizeEnums([{...slot(),items:slot().items.slice(1)}]),/未定义/);
  assert.throws(()=>normalizeEnums([{...slot(),items:[{...zero,label:'其他'}]}]),/未定义/);
  assert.equal(normalizeEnums([{...slot(),items:[zero,{key:'max',label:'最大',value:'4294967295'}]}])[0].items[1].value,4294967295);
});

test('enum cells normalize to numbers, allow zero, and reject unknown values and missing references',()=>{
  assert.equal(normalizeAssetTable(category,table('1'),[slot()]).rows[0].slot,1);
  assert.equal(normalizeAssetTable(category,table(0),[slot()]).rows[0].slot,0);
  for(const value of [3,-1,'head','',false,'4294967296'])assert.throws(()=>normalizeAssetTable(category,table(value),[slot()]));
  assert.throws(()=>normalizeAssetTable(category,{...table(),rows:[]},[]),/枚举/);
  const optional=table('');optional.fields[1]={...field,required:false};
  assert.equal(normalizeAssetTable(category,optional,[slot()]).rows[0].slot,null);
});

test('changing a field to enum preserves values and invalid values block saving',()=>{
  const numeric=table(9);numeric.fields[1]={...field,type:'uint32'};
  const changed=changeAssetField(numeric,1,{type:'enum',enum:'equipment_slot'},[slot()]);
  assert.equal(changed.rows[0].slot,9);
  assert.throws(()=>normalizeAssetTable(category,changed,[slot()]),/部位/);
});

test('enum definitions and references survive save, reload, and category edits',()=>{
  const store=storage();workspace.writeWorkspace(store,data());
  const saved=workspace.readWorkspace(store,[]);
  assert.equal(saved.enums[0].items[1].label,'头部');
  assert.equal(saved.tables.item.fields[1].enum,'equipment_slot');
  assert.equal(workspace.replaceCategories(saved,[{...category,name:'物品'}]).enums[0].key,'equipment_slot');
});

test('old workspaces gain the equipment enum without changing tables or exact uint64 values',()=>{
  const store=storage();const original={categories:[category],tables:{item:{fields:[...emptyAssetTable().fields,{key:'n',label:'数值',type:'uint64',required:true}],rows:[{id:100,n:'18446744073709551615'}]}}};
  store.setItem('asset-forge-workspace-v2',JSON.stringify(original));
  const saved=workspace.readWorkspace(store,[]);
  assert.equal(saved.enums[0].key,'equipment_slot');
  assert.deepEqual(saved.enums[0].items.map(item=>item.value),[0,1,2,3,4]);
  assert.deepEqual(saved.tables,original.tables);
});

test('renaming an enum updates every reference atomically and preserves row numbers',()=>{
  const original=data();const saved=workspace.replaceEnum(original,'equipment_slot',{...slot(),key:'equip_slot'});
  assert.equal(saved.tables.item.fields[1].enum,'equip_slot');
  assert.equal(saved.tables.item.rows[0].slot,1);
  assert.equal(original.tables.item.fields[1].enum,'equipment_slot');
});

test('used enum items cannot be removed or renumbered; labels and item keys can change',()=>{
  assert.throws(()=>workspace.replaceEnum(data(),'equipment_slot',null),/引用/);
  assert.throws(()=>workspace.replaceEnum(data(),'equipment_slot',{...slot(),items:[zero,slot().items[2]]}),/使用/);
  assert.throws(()=>workspace.replaceEnum(data(),'equipment_slot',{...slot(),items:[zero,{...slot().items[1],value:3},slot().items[2]]}),/使用/);
  const changed=workspace.replaceEnum(data(),'equipment_slot',{...slot(),items:[zero,{key:'helmet',label:'头盔部位',value:1}]});
  assert.equal(changed.enums[0].items[1].key,'helmet');
  assert.equal(changed.tables.item.rows[0].slot,1);
});

test('unreferenced enums can be deleted and an explicit empty library remains empty on reload',()=>{
  const original={categories:[category],enums:[slot()],tables:{item:emptyAssetTable()}};
  const next=workspace.replaceEnum(original,'equipment_slot',null);
  const store=storage();workspace.writeWorkspace(store,next);
  assert.deepEqual(workspace.readWorkspace(store,[]).enums,[]);
});

test('YAML exports references and numeric values with the independent enum file',()=>{
  const files=workspace.workspaceFiles(data(),'asset-categories.yaml');
  assert.deepEqual(files.map(file=>file.name),['asset-categories.yaml','asset-enums.yaml','chest-appearances.yaml','item.yaml']);
  assert.match(files[1].content,/key: "equipment_slot"\n/);
  assert.match(files[1].content,/key: "undefined"\n\s+label: "未定义"\n\s+value: 0\n/);
  const yaml=assetTableYaml(category,table(),[slot()]);
  assert.match(yaml,/type: "enum"\n\s+enum: "equipment_slot"\n/);
  assert.match(yaml,/slot: 1\n/);
  assert.throws(()=>workspace.workspaceFiles(data(),'ASSET-ENUMS.yaml'),/冲突/);
});
