import test from 'node:test';
import assert from 'node:assert/strict';
import {load as parse} from 'js-yaml';
import {normalizeWorkspace,workspaceFiles} from '../public/editor/workspace.mjs';
import {emptyAssetTable} from '../public/editor/assets.mjs';
const drops=await import('../public/editor/drops.mjs').catch(()=>({}));
export function fixture() {
  return {chestAppearances:[{id:1,name:'木箱',icon:'icons/chests/wood.png'}],categories:[{key:'item',name:'道具',start:0,end:99},{key:'equipment',name:'装备',start:100,end:199}],enums:[],tables:{item:{...emptyAssetTable(),rows:[{id:0},{id:1}]},equipment:{...emptyAssetTable(),rows:[{id:100}]}}};
}
export function enabled() {
  assert.equal(typeof drops.enableDrops,'function','explicit drop setup is missing');
  return normalizeWorkspace(drops.enableDrops(fixture(),{start:200,end:209},{start:210,end:299}));
}
export function populated() {
  const w=enabled();
  return normalizeWorkspace(drops.saveDropPackage(w,{id:200,chest_appearance_id:1,name:'宝箱'},[
    {id:210,package_id:200,weight:60,rewards:[{asset_id:0,count:3}]},
    {id:211,package_id:200,weight:30,rewards:[{asset_id:100,count:1}]},
    {id:212,package_id:200,weight:10,rewards:[{asset_id:0,count:5},{asset_id:100,count:1}]}
  ]));
}
test('drop setup is explicit, ranges independent, and never overwrites existing tables',()=>{
  const w=enabled();assert.equal(w.categories.length,4);assert.equal(w.categories[2].system,'drop_package');
  const old=fixture();old.categories.push({key:'drop_entry',name:'旧掉落表',start:300,end:399});old.tables.drop_entry=emptyAssetTable();
  assert.throws(()=>drops.enableDrops(old,{start:200,end:209},{start:210,end:299}),/冲突|已存在/);
  assert.throws(()=>normalizeWorkspace(drops.enableDrops(fixture(),{start:90,end:209},{start:210,end:299})),/重叠/);
  const legacy=fixture();legacy.categories[0].key='drop_package';legacy.tables.drop_package=legacy.tables.item;delete legacy.tables.item;
  assert.doesNotThrow(()=>normalizeWorkspace(legacy),'names alone must not activate drop validation');
});
test('pure and mixed rewards round trip as actual YAML arrays, including asset ID zero',()=>{
  const w=populated(),reloaded=normalizeWorkspace(JSON.parse(JSON.stringify(w)));
  assert.deepEqual(reloaded,w);
  const yaml=workspaceFiles(w,'asset-categories.yaml').find(file=>file.name==='drop_entry.yaml').content;
  assert.deepEqual(parse(yaml).rows,w.tables.drop_entry.rows);
  assert.match(yaml,/rewards:\n\s+- asset_id: 0/);
  assert.equal(parse(yaml).fields.find(field=>field.key==='rewards').type,'asset_list');
});
test('invalid aggregates, references, reward duplicates, and integer bounds are rejected',()=>{
  const cases=[
    w=>w.tables.drop_entry.rows=[],
    w=>w.tables.drop_entry.rows[0].rewards=[],
    w=>w.tables.drop_entry.rows[0].rewards.push({asset_id:0,count:1}),
    w=>w.tables.drop_entry.rows[0].rewards[0].asset_id=90,
    w=>w.tables.drop_entry.rows[0].rewards[0].asset_id=210,
    w=>w.tables.drop_entry.rows[0].package_id=201,
    w=>w.tables.drop_entry.rows[0].weight=0,
    w=>w.tables.drop_entry.rows[0].weight=4294967296,
    w=>w.tables.drop_entry.rows[0].rewards[0].count=0,
    w=>w.tables.drop_entry.rows[0].rewards[0].count=4294967296,
    w=>w.tables.drop_entry.rows[0].rewards='0:3',
    w=>w.tables.item.rows=[],
    w=>w.tables.drop_entry.fields.find(f=>f.key==='weight').required=false,
    w=>w.tables.drop_entry.fields.find(f=>f.key==='rewards').type='string',
    w=>w.categories[2].key='renamed'
  ];
  for(const change of cases){const w=populated();change(w);assert.throws(()=>normalizeWorkspace(w));}
  const w=populated();w.tables.drop_entry.rows[0].rewards[0].count=4294967295;assert.doesNotThrow(()=>normalizeWorkspace(w));
});
test('one weighted selection returns the whole reward combination with exact wide totals',()=>{
  const entries=populated().tables.drop_entry.rows;
  for(const [roll,id] of [[0n,210],[59n,210],[60n,211],[89n,211],[90n,212],[99n,212]])assert.equal(drops.selectDropEntry(entries,roll).id,id);
  assert.deepEqual(drops.selectDropEntry(entries,99n).rewards,[{asset_id:0,count:5,probability:10000},{asset_id:100,count:1,probability:10000}]);
  assert.throws(()=>drops.selectDropEntry(entries,100n));
  const wide=entries.map(row=>({...row,weight:4294967295}));
  assert.equal(drops.totalWeight(wide),12884901885n);
  assert.equal(drops.selectDropEntry(wide,12884901884n).id,212);
  assert.equal(drops.selectDropEntry([...entries].reverse(),90n).id,212,'selection contract uses stable entry IDs, not display order');
});
test('aggregate replacement and deletion do not mutate the original or leave entries',()=>{
  const w=populated(),before=JSON.stringify(w);
  const next=normalizeWorkspace(drops.saveDropPackage(w,{id:200,chest_appearance_id:1,name:'新版'},w.tables.drop_entry.rows.slice(0,1)));
  assert.equal(next.tables.drop_entry.rows.length,1);assert.equal(JSON.stringify(w),before);
  const deleted=normalizeWorkspace(drops.deleteDropPackage(w,200));
  assert.equal(deleted.tables.drop_package.rows.length,0);assert.equal(deleted.tables.drop_entry.rows.length,0);
  const unmarked=structuredClone(w);delete unmarked.categories[2].system;delete unmarked.categories[3].system;
  assert.throws(()=>drops.assertDropTransition(w,unmarked),/掉落/);
});

test('custom fields, their order, uint64 and optional structured lists survive aggregate saves',()=>{
  const w=populated();
  w.tables.drop_entry.fields.push({key:'enabled',label:'启用',type:'bool',required:false},{key:'amount',label:'精确数值',type:'uint64',required:false},{key:'null',label:'额外奖励',type:'asset_list',required:false});
  for(const row of w.tables.drop_entry.rows){row.enabled=false;row.amount='18446744073709551615';row.null=[{asset_id:1,count:1}];}
  const saved=normalizeWorkspace(drops.saveDropPackage(normalizeWorkspace(w),{id:200,chest_appearance_id:1,name:'自定义包'},w.tables.drop_entry.rows));
  assert.equal(saved.tables.drop_entry.rows[0].amount,'18446744073709551615');assert.equal(saved.tables.drop_entry.rows[0].enabled,false);
  const yaml=workspaceFiles(saved,'asset-categories.yaml').find(file=>file.name==='drop_entry.yaml').content;
  assert.deepEqual(parse(yaml).rows[0].null,[{asset_id:1,count:1,probability:10000}]);
  assert.deepEqual(saved.tables.drop_entry.fields.map(field=>field.key),['id','package_id','weight','probability','rewards','enabled','amount','null']);
});

test('migrates the existing empty loot_bag in place with the original range and custom schema',()=>{
  assert.equal(typeof drops.migrateLootBag,'function','legacy category migration is missing');
  const w=fixture();w.categories.push({key:'loot_bag',name:'我的掉落包',start:200,end:209,description:'原说明'});
  w.tables.loot_bag={...emptyAssetTable(),fields:[...emptyAssetTable().fields,{key:'note',label:'备注',type:'string',required:false}]};
  const before=JSON.stringify(w),next=normalizeWorkspace(drops.migrateLootBag(w,{start:210,end:299}));
  assert.equal(JSON.stringify(w),before);assert.equal(next.categories.length,w.categories.length+1);
  assert.deepEqual(next.categories[2],{...w.categories[2],key:'drop_package',system:'drop_package'});
  assert.equal(Object.hasOwn(next.tables,'loot_bag'),false);assert.deepEqual(next.tables.drop_package.rows,[]);
  assert.deepEqual(next.tables.drop_package.fields.slice(0,2),w.tables.loot_bag.fields);
  assert.equal(next.tables.drop_package.fields[w.tables.loot_bag.fields.length].key,'name');
  assert.equal(next.tables.drop_package.fields.at(-1).key,'selection_mode');
  assert.deepEqual(next.tables.item,w.tables.item);assert.deepEqual(next.tables.equipment,w.tables.equipment);
  assert.throws(()=>drops.migrateLootBag(next,{start:300,end:399}),/已存在|冲突/);
  assert.throws(()=>normalizeWorkspace(drops.migrateLootBag(w,{start:205,end:299})),/重叠/);
  assert.deepEqual(workspaceFiles(next,'asset-categories.yaml').filter(file=>/drop|loot/.test(file.name)).map(file=>file.name),['drop_package.yaml','drop_entry.yaml']);
});

test('migration blocks populated legacy tables and incompatible name fields instead of inventing rewards or dropping data',()=>{
  const w=fixture();w.categories.push({key:'loot_bag',name:'旧包',start:200,end:209});w.tables.loot_bag={...emptyAssetTable(),rows:[{id:200}]};
  const before=JSON.stringify(w);assert.throws(()=>drops.migrateLootBag(w,{start:210,end:299}),/已有.*1.*行/);assert.equal(JSON.stringify(w),before);
  w.tables.loot_bag.rows=[];w.tables.loot_bag.fields.push({key:'name',label:'数值',type:'uint64',required:false});
  assert.throws(()=>drops.migrateLootBag(w,{start:210,end:299}),/name/);
  const missing=fixture();assert.throws(()=>drops.migrateLootBag(missing,{start:210,end:299}),/loot_bag/);
});
