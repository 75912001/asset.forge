import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProgress,saveProgress} from '../projects/hero-td/game/progress.mjs';
import {availableLevels,availableUnits} from '../projects/hero-td/game/model.mjs';

const levels=[{id:3001},{id:3002},{id:3003}];
function storageFixture(t) {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))}});
  t.after(()=>descriptor?Object.defineProperty(globalThis,'localStorage',descriptor):delete globalThis.localStorage);
  return values;
}

test('首次游玩没有进度, 通关保存后刷新恢复, 不影响另一项目',t=>{
  const values=storageFixture(t);
  assert.deepEqual(loadProgress('hero-td',levels),{completed:[],canSave:true,warning:''});
  assert.equal(saveProgress('hero-td',[3001,3002]),true);
  assert.deepEqual(loadProgress('hero-td',levels),{completed:[3001,3002],canSave:true,warning:''});
  assert.deepEqual(loadProgress('another-game',levels),{completed:[],canSave:true,warning:''});
  assert.deepEqual(JSON.parse(values.get('asset-forge-game-progress:hero-td:v1')),{version:1,completed:[3001,3002]});
});

test('异常存档不会解锁后续关卡, 禁止后续覆盖且保留原内容',t=>{
  const values=storageFixture(t),key='asset-forge-game-progress:hero-td:v1';
  for(const raw of ['bad json',JSON.stringify({version:2,completed:[]}),JSON.stringify({version:1,completed:[3002]}),JSON.stringify({version:1,completed:[3001,3001]}),JSON.stringify({version:1,completed:[9999]})]) {
    values.set(key,raw);const progress=loadProgress('hero-td',levels);
    assert.deepEqual(progress.completed,[]);assert.equal(progress.canSave,false);assert.ok(progress.warning.length>0);
    assert.equal(values.get(key),raw);
  }
});

test('刷新恢复的进度驱动游戏关卡与英雄解锁, 不解锁尚未完成的奖励',t=>{
  storageFixture(t);
  const config={levels,units:[{id:1001,unlock_level:0},{id:1004,unlock_level:3001},{id:1005,unlock_level:3002}]};
  saveProgress('hero-td',[3001]);
  const restored=loadProgress('hero-td',levels);
  assert.deepEqual(availableLevels(config,restored.completed).map(level=>level.id),[3001,3002]);
  assert.deepEqual(availableUnits(config,restored.completed).map(unit=>unit.id),[1001,1004]);
});

test('浏览器禁止读取存储时仍可开始第一关, 并明确返回存档警告',t=>{
  storageFixture(t);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('blocked');}});
  const progress=loadProgress('hero-td',levels);
  assert.deepEqual(progress.completed,[]);assert.equal(progress.canSave,false);assert.match(progress.warning,/存档读取失败/);
});

test('浏览器写入失败不会报告保存成功, 已保存进度保持不变',t=>{
  const values=storageFixture(t),key='asset-forge-game-progress:hero-td:v1';
  values.set(key,JSON.stringify({version:1,completed:[3001]}));
  globalThis.localStorage.setItem=()=>{throw new Error('quota');};
  assert.equal(saveProgress('hero-td',[3001,3002]),false);
  assert.deepEqual(JSON.parse(values.get(key)).completed,[3001]);
});
