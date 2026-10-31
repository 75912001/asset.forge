import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyAssetTable,normalizeAssetTable,nextAssetId,changeAssetField,assetTableYaml} from '../public/editor/assets.mjs';
const category={key:'role',name:'角色',start:100,end:102};
const id={key:'id',label:'ID',type:'uint32',required:true};
const name={key:'name',label:'名称',type:'string',required:true};
const table=rows=>({fields:[{...id},{...name}],rows});

test('a new category table has a required uint32 ID column and no fabricated data',()=>{
  assert.deepEqual(emptyAssetTable(),{fields:[id],rows:[]});
});
test('normalizes valid typed values while preserving zero and false',()=>{
  const cat={...category,start:0};
  const draft={fields:[id,{key:'count',label:'数量',type:'uint64',required:true},{key:'enabled',label:'启用',type:'bool',required:true}],rows:[{id:'0',count:'18446744073709551615',enabled:false}]};
  assert.deepEqual(normalizeAssetTable(cat,draft).rows,[{id:0,count:'18446744073709551615',enabled:false}]);
});
test('rejects IDs outside the category range and IDs duplicated after number conversion',()=>{
  assert.throws(()=>normalizeAssetTable(category,table([{id:99,name:'A'}])),/范围/);
  assert.throws(()=>normalizeAssetTable(category,table([{id:'100',name:'A'},{id:100,name:'B'}])),/重复/);
});
test('rejects malformed numbers, uint32 and uint64 overflow and non-boolean values',()=>{
  for(const [type,value] of [['uint32',4294967296],['uint32',-1],['uint32','1.5'],['uint64','18446744073709551616'],['uint64','-1'],['uint64',9007199254740992],['bool','yes']]) {
    assert.throws(()=>normalizeAssetTable(category,{fields:[id,{key:'value',label:'值',type,required:true}],rows:[{id:100,value}]}));
  }
});
test('requires unique safe field identifiers, a fixed ID column and required cells',()=>{
  assert.throws(()=>normalizeAssetTable(category,{fields:[id,{...name,key:'bad-key'}],rows:[]}),/标识/);
  assert.throws(()=>normalizeAssetTable(category,{fields:[id,name,name],rows:[]}),/重复/);
  assert.throws(()=>normalizeAssetTable(category,{fields:[{...id,type:'string'}],rows:[]}),/id/);
  assert.throws(()=>normalizeAssetTable(category,table([{id:100,name:''}])) ,/必填/);
});
test('optional numeric blanks become null while quoted strings stay strings',()=>{
  const result=normalizeAssetTable(category,{fields:[id,{...name,required:false},{key:'hp',label:'生命',type:'uint32',required:false}],rows:[{id:100,name:'001',hp:''}]});
  assert.deepEqual(result.rows,[{id:100,name:'001',hp:null}]);
});
test('allocates the first available ID, including gaps, without exceeding the range',()=>{
  assert.equal(nextAssetId(category,[{id:100},{id:102}]),101);
  assert.equal(nextAssetId(category,[{id:100},{id:101},{id:102}]),null);
  assert.equal(nextAssetId({...category,start:0,end:0},[]),0);
});
test('renaming a field preserves its data and rejects collisions or ID changes',()=>{
  const old=table([{id:100,name:'英雄'}]);
  const changed=changeAssetField(old,1,{key:'title'});
  assert.deepEqual(changed.rows,[{id:100,title:'英雄'}]);
  assert.deepEqual(old.rows,[{id:100,name:'英雄'}]);
  assert.throws(()=>changeAssetField(old,1,{key:'id'}));
  assert.throws(()=>changeAssetField(old,0,{key:'other'}));
});
test('exports field definitions and rows with numeric IDs and safely quoted text',()=>{
  const yaml=assetTableYaml(category,table([{id:'100',name:'角色: "A"'}]));
  assert.equal(yaml,'version: 1\ncategory: "role"\nfields:\n  - key: "id"\n    label: "ID"\n    type: "uint32"\n    required: true\n  - key: "name"\n    label: "名称"\n    type: "string"\n    required: true\nrows:\n  - id: 100\n    name: "角色: \\"A\\""\n');
});
test('exports uint64 as an exact YAML number without passing through Number',()=>{
  const value={fields:[id,{key:'amount',label:'数量',type:'uint64',required:true}],rows:[{id:100,amount:'18446744073709551615'}]};
  assert.match(assetTableYaml(category,value),/amount: 18446744073709551615\n/);
});
test('keeps YAML boolean and null words as string field keys',()=>{
  const value={fields:[id,{key:'true',label:'开关',type:'bool',required:true},{key:'null',label:'文本',type:'string',required:false}],rows:[{id:100,true:false,null:'text'}]};
  const yaml=assetTableYaml(category,value);
  assert.match(yaml,/    "true": false\n/);
  assert.match(yaml,/    "null": "text"\n/);
});
