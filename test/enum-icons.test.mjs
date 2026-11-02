import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEnums,enumsYaml,emptyEnum} from '../public/editor/enums.mjs';
import {normalizeWorkspace,replaceEnum,workspaceFiles} from '../public/editor/workspace.mjs';
import {enableDrops,saveDropPackage} from '../public/editor/drops.mjs';
import {pngReferences} from '../public/editor/png.mjs';
import {rewardAssets} from '../public/editor/rewards.mjs';

const zero=emptyEnum().items[0];
const chest=()=>({key:'chest_type',label:'宝箱类型',items:[zero,{key:'wood',label:'木箱',value:1,icon:'icons/chests/wood.png'}]});
function fixture() {
  const w=enableDrops({categories:[],tables:{},enums:[chest()]},{start:200,end:209},{start:210,end:299});
  return saveDropPackage(w,{id:200,name:'木箱包',selection_mode:'weight',chest_type:1},[{id:210,package_id:200,weight:1,probability:10000,rewards:[{asset_id:200,count:1,probability:10000}]}]);
}

test('枚举图标保存、资源引用和 YAML 导出保持相对路径, 未填时省略',()=>{
  const definition={key:'slot',label:'部位',items:[zero,{key:'head',label:'头部',value:1,icon:'icons/head.png'},{key:'body',label:'身体',value:2,icon:''}]};
  const [saved]=normalizeEnums([definition]);
  assert.equal(saved.items[1].icon,'icons/head.png');
  assert.equal(Object.hasOwn(saved.items[2],'icon'),false);
  assert.deepEqual(pngReferences({categories:[],tables:{},enums:[saved]}),['icons/head.png']);
  assert.match(enumsYaml([definition]),/icon: "icons\/head.png"/);
  assert.equal(enumsYaml([definition]).match(/icon:/g).length,1);
  for(const icon of ['../bad.png','C:\\bad.png','https://example.com/a.png','icons/a.jpg'])assert.throws(()=>normalizeEnums([{...definition,items:[zero,{...definition.items[1],icon}]}]),/PNG|相对路径/);
});

test('宝箱类型有效项必须有图标, 零项无图标',()=>{
  assert.deepEqual(normalizeEnums([chest()]),[chest()]);
  assert.throws(()=>normalizeEnums([{...chest(),items:[zero,{key:'wood',label:'木箱',value:1}]}]),/图标/);
  assert.throws(()=>normalizeEnums([{...chest(),items:[{...zero,icon:'icons/zero.png'}]}]),/未定义/);
});

test('新项目启用掉落只补零项, 复用已有宝箱枚举',()=>{
  const blank=enableDrops({categories:[],tables:{},enums:[]},{start:1,end:9},{start:10,end:19});
  assert.deepEqual(blank.enums,[{key:'chest_type',label:'宝箱类型',items:[zero]}]);
  assert.deepEqual(normalizeWorkspace(blank).enums,blank.enums);
  assert.deepEqual(fixture().enums,[chest()]);
});

test('掉落包引用枚举并复用图标, 引用保护与核心字段锁定生效',()=>{
  const w=normalizeWorkspace(fixture());
  assert.deepEqual(w.tables.drop_package.fields.find(f=>f.key==='chest_type'),{key:'chest_type',label:'宝箱类型',type:'enum',enum:'chest_type',required:true});
  assert.equal(Object.hasOwn(w,'chestAppearances'),false);
  assert.equal(rewardAssets(w)[0].icon,'icons/chests/wood.png');
  assert.throws(()=>replaceEnum(w,'chest_type',{...chest(),key:'other'}),/chest_type|标识/);
  assert.throws(()=>replaceEnum(w,'chest_type',{...chest(),items:[zero]}),/使用/);
  assert.throws(()=>replaceEnum(w,'chest_type',{...chest(),items:[zero,{...chest().items[1],value:2}]}),/使用/);
  assert.throws(()=>normalizeWorkspace(saveDropPackage(w,{...w.tables.drop_package.rows[0],chest_type:0},w.tables.drop_entry.rows)),/宝箱类型/);
  const other=structuredClone(w);other.enums.push({...chest(),key:'other'});other.tables.drop_package.fields.find(f=>f.key==='chest_type').enum='other';
  assert.throws(()=>normalizeWorkspace(other),/核心字段/);
  assert.deepEqual(workspaceFiles(w,'asset-categories.yaml').map(f=>f.name),['asset-categories.yaml','asset-enums.yaml','drop_package.yaml','drop_entry.yaml']);
  assert.match(workspaceFiles(w,'asset-categories.yaml')[2].content,/chest_type: 1/);
});
