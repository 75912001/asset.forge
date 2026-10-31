import test from 'node:test';
import assert from 'node:assert/strict';
import {load as parse} from 'js-yaml';
import * as rewards from '../public/editor/rewards.mjs';
import {assetTableYaml,normalizeAssetTable} from '../public/editor/assets.mjs';

test('reward probabilities use integer basis points and missing legacy values remain guaranteed',()=>{
  assert.deepEqual(rewards.normalizeRewards([{asset_id:0,count:1},{asset_id:'2',count:'3',probability:'5000'},{asset_id:3,count:1,probability:0}],true),[
    {asset_id:0,count:1,probability:10000},{asset_id:2,count:3,probability:5000},{asset_id:3,count:1,probability:0}
  ]);
  for(const probability of [-1,10001,0.5,'50%','',null,true,{},'10000.1','9007199254740993'])assert.throws(()=>rewards.normalizeRewards([{asset_id:1,count:1,probability}]),/概率/);
});

test('each reward rolls independently, including exact 0%, 50% and 100% boundaries',()=>{
  assert.equal(typeof rewards.rollRewards,'function','independent probability contract is missing');
  const all=[1,2,3].map(asset_id=>({asset_id,count:1,probability:10000}));
  assert.deepEqual(rewards.rollRewards(all,()=>9999),all);
  const mixed=[{asset_id:1,count:2,probability:10000},{asset_id:2,count:3,probability:5000},{asset_id:3,count:4,probability:0}];
  assert.deepEqual(rewards.rollRewards(mixed,()=>4999),mixed.slice(0,2));
  assert.deepEqual(rewards.rollRewards(mixed,()=>5000),mixed.slice(0,1));
  assert.deepEqual(rewards.rollRewards([{asset_id:2,count:3,probability:5000}],()=>5000),[]);
  assert.deepEqual(rewards.rollRewards(mixed,()=>0),mixed.slice(0,2));
  const calls=[];rewards.rollRewards(all,id=>{calls.push(id);return 0;});assert.deepEqual(calls,[1,2,3]);
  for(const roll of [-1,10000,0.5,NaN])assert.throws(()=>rewards.rollRewards(all,()=>roll),/判定值/);
});

test('probability survives table normalization and actual nested YAML round trips',()=>{
  const category={key:'drop_entry',start:10,end:19};
  const table={fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'rewards',label:'奖励',type:'asset_list',required:true}],rows:[{id:10,rewards:[{asset_id:1,count:3,probability:10000},{asset_id:2,count:1,probability:5000},{asset_id:3,count:1,probability:0}]}]};
  assert.deepEqual(normalizeAssetTable(category,table),table);
  assert.deepEqual(parse(assetTableYaml(category,table)).rows,table.rows);
});

test('structured reward controls expose editable basis points and default old drafts to 10000',()=>{
  const html=rewards.rewardListHtml([{asset_id:1,count:2},{asset_id:2,count:1,probability:5000},{asset_id:3,count:1,probability:0}],[]);
  assert.equal((html.match(/data-reward-property="probability"/g)||[]).length,3);
  assert.match(html,/value="10000"/);assert.match(html,/50%/);assert.match(html,/0%/);
});

test('empty reward lists explain how to restore the per-item probability controls',()=>{
  const html=rewards.rewardListHtml([],[]);
  assert.match(html,/尚未添加奖励项/);assert.match(html,/概率/);assert.match(html,/data-reward-add/);
});
