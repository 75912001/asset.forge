import {chestEnum} from './chest-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {rewardAssets,rewardListHtml} from '../public/editor/rewards.mjs';
const picker=await import('../public/editor/reward-picker.mjs').catch(()=>({}));
const icon='images/'+'a'.repeat(64)+'.png';
const workspace={enums:[chestEnum()],categories:[{key:'base',name:'基础数值'},{key:'equipment',name:'装备'},{key:'drop_package',name:'掉落包',system:'drop_package'},{key:'drop_entry',name:'掉落条目',system:'drop_entry'}],tables:{
  base:{fields:[{key:'icon',type:'png'}],rows:[{id:0,name:'金币',icon}]},
  equipment:{fields:[{key:'icon',type:'png'}],rows:[{id:1000000,name:'草帽',icon},{id:1000001,name:'布衣',icon:null}]},
  drop_package:{fields:[],rows:[{id:2000000,name:'包',chest_type:1}]},
  drop_entry:{fields:[],rows:[{id:2100000,package_id:2000000}]}
}};
test('reward choices include asset PNGs and package appearance icons, keep zero IDs and exclude drop entries',()=>{
  const choices=rewardAssets(workspace);
  assert.deepEqual(choices.map(a=>({id:a.id,name:a.name,category:a.category,icon:a.icon})),[
    {id:0,name:'金币',category:'基础数值',icon},{id:1000000,name:'草帽',category:'装备',icon},{id:1000001,name:'布衣',category:'装备',icon:null},
    {id:2000000,name:'包',category:'掉落包',icon:'icons/chests/wood.png'}
  ]);
  const strings=structuredClone(workspace);strings.tables.equipment.fields[0].type='string';
  assert.equal(rewardAssets(strings).find(a=>a.id===1000000).icon,null,'a string column must not become an image URL');
});
test('reward picker searches asset names, category names and exact ID fragments without altering source order',()=>{
  assert.equal(typeof picker.filterRewardAssets,'function','searchable reward picker is missing');
  const choices=rewardAssets(workspace),before=structuredClone(choices);
  assert.deepEqual(picker.filterRewardAssets(choices,' 帽 ').map(a=>a.id),[1000000]);
  assert.deepEqual(picker.filterRewardAssets(choices,'装备').map(a=>a.id),[1000000,1000001]);
  assert.deepEqual(picker.filterRewardAssets(choices,'1000001').map(a=>a.id),[1000001]);
  assert.deepEqual(picker.filterRewardAssets(choices,'不存在'),[]);
  assert.deepEqual(picker.filterRewardAssets(choices,''),choices);assert.deepEqual(choices,before);
});
test('selected rewards show a private PNG thumbnail with name/category/ID and retain canonical ID inputs',()=>{
  const html=rewardListHtml([{asset_id:0,count:3,probability:5000}],rewardAssets(workspace),'data-drop-entry="2"');
  assert.match(html,/<img[^>]+src="\/api\/images\?file=images%2F/);
  assert.match(html,/金币/);assert.match(html,/基础数值/);assert.match(html,/data-reward-picker/);
  assert.match(html,/<select hidden[^>]+data-drop-entry="2"[^>]+data-reward-property="asset_id"/);
  assert.match(html,/<option value="0" selected>/);assert.match(html,/value="3"/);assert.match(html,/value="5000"/);
});
test('image-free or invalid rewards have readable placeholders and escaped names, never external image sources',()=>{
  assert.equal(typeof picker.rewardPickerHtml,'function','reward picker rendering is missing');
  assert.doesNotMatch(picker.rewardPickerHtml({id:1,name:'<img src=x>',category:'装备',icon:'https://evil.test/x.png'}),/<img /);
  assert.match(picker.rewardPickerHtml({id:1,name:'<img src=x>',category:'装备',icon:null}),/&lt;img src=x&gt;/);
  assert.match(rewardListHtml([{asset_id:999,count:1}],rewardAssets(workspace)),/无效资产: 999/);
});
