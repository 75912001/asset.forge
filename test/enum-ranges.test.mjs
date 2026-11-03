import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEnums,enumsYaml} from '../public/editor/enums.mjs';
import {normalizeWorkspace,replaceEnum,workspaceFiles} from '../public/editor/workspace.mjs';
import {mountEnumEditor} from '../public/editor/enum-editor.mjs';
import {mountAssetEditor} from '../public/editor/asset-editor.mjs';

const equipmentType=()=>({key:'equipment_type',label:'装备类型',items:[
  {key:'undefined',label:'未定义',value:0},
  {key:'weapon',label:'武器',value:1,max:999999},
  {key:'helmet',label:'头盔',value:1000000,max:1999999}
]});
const fixture=(value=500000)=>({categories:[{key:'item',name:'道具',start:10,end:20}],enums:[equipmentType()],tables:{item:{
  fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'type',label:'装备类型',type:'enum',enum:'equipment_type',required:true}],
  rows:[{id:10,type:value}]
}}});
function documentStub(t) {
  const previous=globalThis.document;t.after(()=>globalThis.document=previous);
  const elements=new Map();
  globalThis.document={getElementById(id){
    if(!elements.has(id))elements.set(id,{value:'',listeners:{},classList:{toggle(){}},addEventListener(name,fn){this.listeners[name]=fn;},querySelector:()=>null,querySelectorAll:()=>[],focus(){}});
    return elements.get(id);
  },querySelectorAll:()=>[]};
  return id=>globalThis.document.getElementById(id);
}

test('范围枚举保留闭区间, YAML 导出终值且单值格式兼容',()=>{
  const definition=equipmentType();
  assert.deepEqual(normalizeEnums([definition]),[definition]);
  const yaml=enumsYaml([definition]);
  assert.match(yaml,/value: 1\n\s+max: 999999\n/);
  assert.match(yaml,/value: 1000000\n\s+max: 1999999\n/);
  assert.doesNotMatch(yaml,/value: 0\n\s+max:/);
});

test('范围枚举拒绝倒置, 重叠, 非整数, 越界和扩展固定零项',()=>{
  for(const patch of [
    {value:1,max:0},{value:1,max:'1.5'},{value:1,max:4294967296},{value:1,max:null},
    {value:1,max:1000000},{value:0,max:999999}
  ]) {
    const definition=equipmentType();Object.assign(definition.items[1],patch);
    assert.throws(()=>normalizeEnums([definition]));
  }
  const definition=equipmentType();definition.items[0].max=1;
  assert.throws(()=>normalizeEnums([definition]));
  const max=equipmentType();max.items[2].max=4294967295;
  assert.equal(normalizeEnums([max])[0].items[2].max,4294967295);
});

test('枚举字段接受范围内部与边界数值, 拒绝空隙, 保存和导出保留原数值',()=>{
  for(const value of [0,1,999999,1000000,1500000,1999999])assert.equal(normalizeWorkspace(fixture(value)).tables.item.rows[0].type,value);
  for(const value of [-1,2000000,'weapon','1.5'])assert.throws(()=>normalizeWorkspace(fixture(value)));
  const gap=fixture(999999);gap.enums[0].items[1].max=999998;
  assert.throws(()=>normalizeWorkspace(gap));
  const saved=normalizeWorkspace(JSON.parse(JSON.stringify(normalizeWorkspace(fixture()))));
  assert.equal(saved.tables.item.rows[0].type,500000);
  assert.equal(saved.enums[0].items[1].max,999999);
  assert.match(workspaceFiles(saved,'asset-categories.yaml').find(file=>file.name==='item.yaml').content,/type: 500000\n/);
});

test('范围调整保护已使用的内部数值, 允许保留该值的范围扩大及重命名',()=>{
  const original=fixture(),changed=equipmentType();changed.items[1].max=499999;
  assert.throws(()=>replaceEnum(original,'equipment_type',changed),/使用/);
  changed.items[1].max=999999;changed.items[1].value=2;
  assert.equal(replaceEnum(original,'equipment_type',changed).tables.item.rows[0].type,500000);
  changed.items[1].key='arms';changed.items[1].label='兵器';
  assert.equal(replaceEnum(original,'equipment_type',changed).tables.item.rows[0].type,500000);
});

test('枚举面板同时保存范围与图标, 新增项跳过已占用的完整范围',async t=>{
  const $=documentStub(t);let workspace=normalizeWorkspace(fixture());
  const editor=mountEnumEditor({getWorkspace:()=>workspace,canEdit:()=>true,onDirty(){},notify(){},onSelectPng:async()=>'icons/weapon.png',commit:async(key,definition)=>{workspace=replaceEnum(workspace,key,definition);return true;}});
  assert.match($('enum-items').innerHTML,/data-property="max"[^>]*value="999999"/);
  await $('enum-items').listeners.click({target:{closest:selector=>selector==='[data-png-select]'?{dataset:{enumIcon:'1'}}:null}});
  const input={dataset:{enumItem:'1',property:'max'},value:'999998',closest:()=>input};
  $('enum-items').listeners.input({target:input});await $('enum-save').listeners.click();
  assert.equal(workspace.enums[0].items[1].max,999998);
  assert.equal(workspace.enums[0].items[1].icon,'icons/weapon.png');
  const saved=normalizeWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.equal(saved.enums[0].items[1].max,999998);
  assert.equal(saved.enums[0].items[1].icon,'icons/weapon.png');
  assert.match(enumsYaml(saved.enums),/max: 999998\n\s+icon: "icons\/weapon.png"\n/);
  assert.equal(editor.hasUnsaved(),false);
  // 恢复连续范围后, 新值必须跳过武器和头盔范围.
  input.value='999999';$('enum-items').listeners.input({target:input});
  $('enum-add-item').listeners.click();
  assert.equal(editor.snapshot().draft.items.at(-1).value,2000000);
});

test('资产表范围枚举可输入内部数值并保存, 展示对应类型名称',async t=>{
  const $=documentStub(t);let workspace=normalizeWorkspace(fixture());
  mountAssetEditor({getWorkspace:()=>workspace,canEdit:()=>true,onDirty(){},onOpen(){},notify(){},commit:async(key,table)=>{workspace={...workspace,tables:{...workspace.tables,[key]:table}};return true;}});
  const input={dataset:{record:'0',column:'1'},value:'1500000',closest:()=>input};
  $('asset-data-rows').listeners.input({target:input});await $('asset-save').listeners.click();
  assert.equal(workspace.tables.item.rows[0].type,1500000);
  assert.match($('asset-data-rows').innerHTML,/头盔/);
  assert.doesNotMatch($('asset-data-rows').innerHTML,/无效值/);
});
