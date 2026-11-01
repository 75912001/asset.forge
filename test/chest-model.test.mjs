import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspace,workspaceFiles,replaceCategories} from '../public/editor/workspace.mjs';
import {enableDrops,saveDropPackage,deleteDropPackage,selectDropEntries} from '../public/editor/drops.mjs';
import {rewardAssets,rollRewards} from '../public/editor/rewards.mjs';
import {pngReferences} from '../public/editor/png.mjs';

function fixture() {
  const w=enableDrops({categories:[{key:'item',name:'道具',start:1,end:99}],enums:[],chestAppearances:[{id:1,name:'木箱',icon:'chests/wood.png'},{id:2,name:'金箱',icon:'chests/gold.png'}],tables:{item:{fields:[{key:'id',label:'ID',type:'uint32',required:true}],rows:[{id:1}]}}},{start:200,end:209},{start:210,end:299});
  return saveDropPackage(w,{id:200,name:'新手包',selection_mode:'weight',chest_appearance_id:1},[{id:210,package_id:200,weight:1,probability:10000,rewards:[{asset_id:1,count:1,probability:10000}]}]);
}

test('appearance records survive normalization independently of asset IDs and category edits',()=>{
  const raw=fixture(),before=structuredClone(raw),saved=normalizeWorkspace(raw);
  assert.deepEqual(saved.chestAppearances,[{id:1,name:'木箱',icon:'chests/wood.png'},{id:2,name:'金箱',icon:'chests/gold.png'}]);
  assert.equal(saved.tables.drop_package.rows[0].chest_appearance_id,1);
  assert.deepEqual(normalizeWorkspace(JSON.parse(JSON.stringify(saved))),saved);
  assert.deepEqual(replaceCategories(saved,saved.categories).chestAppearances,saved.chestAppearances);
  assert.deepEqual(raw,before,'normalization must not modify the input');
});

test('appearance definitions reject duplicate or invalid IDs, empty names and non-PNG references',()=>{
  for(const appearance of [{id:-1,name:'木箱',icon:'wood.png'},{id:4294967296,name:'木箱',icon:'wood.png'},{id:1,name:' ',icon:'wood.png'},{id:1,name:'木箱',icon:'../wood.png'},{id:1,name:'木箱',icon:''}]) {
    const w=fixture();w.chestAppearances=[appearance];assert.throws(()=>normalizeWorkspace(w));
  }
  const w=fixture();w.chestAppearances.push({...w.chestAppearances[0]});assert.throws(()=>normalizeWorkspace(w),/重复/);
});

test('every package requires an existing appearance and protects appearance deletion and ID changes',()=>{
  for(const id of [undefined,'',null,999]) {
    const w=fixture();w.tables.drop_package.rows[0].chest_appearance_id=id;assert.throws(()=>normalizeWorkspace(w),/外观/);
  }
  const removed=fixture();removed.chestAppearances.shift();assert.throws(()=>normalizeWorkspace(removed),/外观.*1|1.*外观/);
  const changed=fixture();changed.chestAppearances[0].id=3;assert.throws(()=>normalizeWorkspace(changed),/外观/);
  const core=fixture();core.tables.drop_package.fields=core.tables.drop_package.fields.filter(f=>f.key!=='chest_appearance_id');assert.throws(()=>normalizeWorkspace(core),/外观|核心/);
});

test('all combinations need guaranteed rewards, including zero-chance combinations',()=>{
  for(const mode of ['weight','probability']) {
    const w=fixture();w.tables.drop_package.rows[0].selection_mode=mode;
    w.tables.drop_entry.rows[0].rewards[0].probability=9999;
    assert.throws(()=>normalizeWorkspace(w),/200.*210.*100%/);
    w.tables.drop_entry.rows.push({id:211,package_id:200,weight:1,probability:0,rewards:[{asset_id:1,count:1,probability:5000}]});
    w.tables.drop_entry.rows[0].rewards[0].probability=10000;
    assert.throws(()=>normalizeWorkspace(w),/200.*211.*100%/);
  }
});

test('probability packages need a guaranteed combination while weight packages do not use combination probabilities',()=>{
  const w=fixture();w.tables.drop_entry.rows[0].probability=9999;
  assert.doesNotThrow(()=>normalizeWorkspace(w));
  w.tables.drop_package.rows[0].selection_mode='probability';
  assert.throws(()=>normalizeWorkspace(w),/200.*100%/);
  w.tables.drop_entry.rows[0].probability=10000;
  const valid=normalizeWorkspace(w),entries=selectDropEntries(valid.tables.drop_package.rows[0],valid.tables.drop_entry.rows,{probabilityRoll:()=>9999});
  assert.equal(entries.length,1);assert.equal(rollRewards(entries[0].rewards,()=>9999).length,1);
});

test('packages are rewards with inherited appearance icons and are not recursively opened',()=>{
  const w=fixture();w.tables.drop_package.rows.push({id:201,name:'活动包',selection_mode:'weight',chest_appearance_id:1});
  w.tables.drop_entry.rows.push({id:211,package_id:201,weight:1,probability:10000,rewards:[{asset_id:200,count:2,probability:10000}]});
  const saved=normalizeWorkspace(w),choices=rewardAssets(saved);
  assert.deepEqual(choices.map(row=>row.id),[1,200,201]);
  assert.equal(choices.find(row=>row.id===200).icon,'chests/wood.png');
  assert.deepEqual(rollRewards(saved.tables.drop_entry.rows[1].rewards,()=>9999),[{asset_id:200,count:2,probability:10000}]);
  assert.throws(()=>normalizeWorkspace(deleteDropPackage(saved,200)),/200/);
  const bad=structuredClone(saved);bad.tables.drop_entry.rows[1].rewards[0].asset_id=210;assert.throws(()=>normalizeWorkspace(bad),/210/);
  const appearanceReward=structuredClone(saved);appearanceReward.tables.drop_entry.rows[1].rewards[0].asset_id=2;assert.throws(()=>normalizeWorkspace(appearanceReward),/2/);
});

test('appearance icons participate in PNG existence checks and export with a dedicated configuration file',()=>{
  const saved=normalizeWorkspace(fixture());
  assert.deepEqual(pngReferences(saved),['chests/wood.png','chests/gold.png']);
  const files=workspaceFiles(saved,'asset-categories.yaml'),appearances=files.find(file=>file.name==='chest-appearances.yaml');
  assert.ok(appearances);assert.match(appearances.content,/id: 1/);assert.match(appearances.content,/icon: "chests\/wood.png"/);
  assert.match(files.find(file=>file.name==='drop_package.yaml').content,/chest_appearance_id: 1/);
  assert.throws(()=>workspaceFiles(saved,'chest-appearances.yaml'),/冲突/);
});
