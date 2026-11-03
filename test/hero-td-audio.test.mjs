import test from 'node:test';
import assert from 'node:assert/strict';
import {lstat} from 'node:fs/promises';

async function audioFactory() {
  const url=new URL('../projects/hero-td/game/audio.mjs',import.meta.url);
  let exists=true;try{await lstat(url);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
  assert.equal(exists,true,'需要实现独立战斗音效模块');
  return (await import(url)).createBattleAudio;
}

function memoryStorage() {
  const values=new Map();
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
}

// 只替换浏览器声卡边界, 记录真实模块向音频图提交的声源, 包络和生命周期.
function audioContext(state='suspended') {
  const context={state,currentTime:0,destination:{},sources:[],gains:[],resumeCalls:0};
  const parameter=()=>({value:1,events:[],setValueAtTime(value,time){this.events.push(['set',value,time]);},linearRampToValueAtTime(value,time){this.events.push(['linear',value,time]);},exponentialRampToValueAtTime(value,time){this.events.push(['exponential',value,time]);},cancelScheduledValues(time){this.events.push(['cancel',null,time]);}});
  const node=()=>({connections:new Set(),connect(destination){this.connections.add(destination);},disconnect(){this.connections.clear();}});
  context.resume=async()=>{context.resumeCalls++;context.state='running';};
  context.createGain=()=>{const gain={...node(),gain:parameter()};context.gains.push(gain);return gain;};
  context.createOscillator=()=>{
    const source={...node(),type:'sine',frequency:parameter(),stops:[],onended:null,start(time){this.startedAt=time;},stop(time){this.stops.push(time);},finish(){this.onended?.();}};
    context.sources.push(source);return source;
  };
  return context;
}

test('音效默认启用但只有用户操作后才创建声卡, 关闭后立即静音且项目偏好隔离',async()=>{
  const createBattleAudio=await audioFactory(),context=audioContext(),storage=memoryStorage();let created=0;
  const audio=createBattleAudio('hero-td',{storage,createContext:()=>{created++;return context;}});
  assert.equal(audio.enabled,true);assert.equal(audio.play({type:'release',style:'shoot'}),false);assert.equal(created,0);
  assert.equal(await audio.enableFromGesture(),true);assert.equal(created,1);
  assert.equal(audio.play({type:'release',style:'shoot'}),true);assert.equal(context.sources.length,1);
  audio.setEnabled(false);assert.equal(audio.enabled,false);
  assert.equal(context.sources[0].connections.size,0);assert.equal(audio.play({type:'hit'}),false);
  const restored=createBattleAudio('hero-td',{storage,createContext:()=>{throw new Error('disabled audio must not open');}});
  assert.equal(restored.enabled,false);assert.equal(await restored.enableFromGesture(),false);
  assert.equal(createBattleAudio('another-game',{storage}).enabled,true);
  audio.setEnabled(true);assert.equal(created,1);assert.equal(await audio.enableFromGesture(),true);
  assert.equal(audio.play({type:'release',style:'shoot'}),true);
});

test('出手, 普通命中, 重甲命中, 暴击与死亡生成不同且短促的低增益声音',async()=>{
  const createBattleAudio=await audioFactory(),context=audioContext('running');
  const audio=createBattleAudio('hero-td',{storage:memoryStorage(),createContext:()=>context});await audio.enableFromGesture();
  const events=[{type:'release',style:'shoot'},{type:'hit'},{type:'hit',armored:true},{type:'hit',critical:true},{type:'death'}];
  for(const event of events)assert.equal(audio.play(event),true);
  assert.equal(context.sources.length,5);
  const signatures=context.sources.map(source=>JSON.stringify([source.type,source.frequency.events]));
  assert.equal(new Set(signatures).size,5,'关键战斗反馈不能退化为相同声音');
  for(const source of context.sources) {
    assert.equal(source.startedAt,0);assert.ok(source.stops[0]>0&&source.stops[0]<=.25,'单个声包必须及时结束');
    const gain=[...source.connections][0];assert.ok(gain?.connections.has(context.destination),'声源必须经音量包络接入输出');
    const values=gain.gain.events.filter(event=>event[1]!==null).map(event=>event[1]);
    assert.equal(values[0],0);assert.equal(values.at(-1),0);assert.ok(Math.max(...values)>0&&Math.max(...values)<=.05,'8组叠加仍需保留足够音量余量');
    assert.ok(source.frequency.events.every(event=>Number.isFinite(event[1])&&event[1]>0));
  }
});

test('50毫秒内合并同类音效, 不合并不同出手方式或命中等级',async()=>{
  const createBattleAudio=await audioFactory(),context=audioContext('running');
  const audio=createBattleAudio('hero-td',{storage:memoryStorage(),createContext:()=>context});await audio.enableFromGesture();
  assert.equal(audio.play({type:'release',style:'slash'}),true);
  context.currentTime=.049;assert.equal(audio.play({type:'release',style:'slash'}),false);
  assert.equal(audio.play({type:'release',style:'thrust'}),true);
  assert.equal(audio.play({type:'hit',armored:true}),true);assert.equal(audio.play({type:'hit',critical:true}),true);
  context.currentTime=.05;assert.equal(audio.play({type:'release',style:'slash'}),true);
  assert.equal(context.sources.length,5);
});

test('同时最多8组音, 声包结束后恢复容量, 不无限积累音频节点',async()=>{
  const createBattleAudio=await audioFactory(),context=audioContext('running');
  const audio=createBattleAudio('hero-td',{storage:memoryStorage(),createContext:()=>context});await audio.enableFromGesture();
  const events=['shoot','thrust','slash','cast','strike'].map(style=>({type:'release',style}));
  events.push({type:'hit'},{type:'hit',armored:true},{type:'hit',critical:true});
  for(const event of events)assert.equal(audio.play(event),true);
  assert.equal(audio.play({type:'death'}),false);assert.equal(context.sources.length,8);
  context.currentTime=.25;
  assert.equal(audio.play({type:'death'}),true);assert.equal(context.sources.length,9);
  for(const source of context.sources.slice(0,8))assert.equal(source.connections.size,0,'过期声源必须释放连接');
  context.sources.at(-1).finish();assert.equal(context.sources.at(-1).connections.size,0,'结束事件也必须清理节点');
});

test('stop清理声源及合并窗口, 暂停后可立刻重新播放同类音效',async()=>{
  const createBattleAudio=await audioFactory(),context=audioContext('running');
  const audio=createBattleAudio('hero-td',{storage:memoryStorage(),createContext:()=>context});await audio.enableFromGesture();
  audio.play({type:'release',style:'cast'});audio.play({type:'hit',critical:true});
  context.currentTime=.01;audio.stop();audio.stop();
  for(const source of context.sources){assert.equal(source.connections.size,0);assert.equal(source.stops.at(-1),.01);assert.equal(source.onended,null);}
  assert.ok(context.gains.every(gain=>gain.connections.size===0));
  assert.equal(audio.play({type:'release',style:'cast'}),true);
});

test('浏览器音频创建或恢复失败会提示且不抛出至战斗, 后续用户操作可重试',async()=>{
  const createBattleAudio=await audioFactory(),warnings=[];
  const unsupported=createBattleAudio('hero-td',{storage:memoryStorage(),onWarning:message=>warnings.push(message),createContext:()=>{throw new Error('Web Audio unavailable');}});
  assert.equal(await unsupported.enableFromGesture(),false);assert.equal(unsupported.play({type:'hit'}),false);assert.match(warnings.at(-1),/音效/);
  const context=audioContext(),audio=createBattleAudio('hero-td',{storage:memoryStorage(),onWarning:message=>warnings.push(message),createContext:()=>context});
  context.resume=async()=>{throw new Error('gesture denied');};
  assert.equal(await audio.enableFromGesture(),false);assert.match(warnings.at(-1),/gesture denied/);assert.equal(audio.play({type:'hit'}),false);
  context.resume=async()=>{context.state='running';};assert.equal(await audio.enableFromGesture(),true);assert.equal(audio.play({type:'hit'}),true);
  context.createOscillator=()=>{throw new Error('audio device failed');};context.currentTime=.1;
  assert.equal(audio.play({type:'death'}),false);assert.match(warnings.at(-1),/audio device failed/);
});

test('存储读取或写入失败只影响偏好持久化, 音效开关仍可使用',async()=>{
  const createBattleAudio=await audioFactory(),context=audioContext('running'),warnings=[];
  const audio=createBattleAudio('hero-td',{createContext:()=>context,onWarning:message=>warnings.push(message),storage:{getItem(){throw new Error('blocked read');},setItem(){throw new Error('quota');}}});
  assert.equal(audio.enabled,true);assert.match(warnings.at(-1),/读取|存储/);
  assert.equal(await audio.enableFromGesture(),true);assert.equal(audio.play({type:'hit'}),true);
  audio.setEnabled(false);assert.equal(audio.enabled,false);assert.match(warnings.at(-1),/保存|存储/);
  assert.equal(audio.play({type:'hit'}),false);
});

test('无效音效事件不会创建声源, 项目标识和开关参数会明确拒绝',async()=>{
  const createBattleAudio=await audioFactory(),context=audioContext('running');
  assert.throws(()=>createBattleAudio('../other'),/项目标识/);
  const audio=createBattleAudio('hero-td',{storage:memoryStorage(),createContext:()=>context});
  assert.throws(()=>audio.setEnabled('false'),/布尔/);await audio.enableFromGesture();
  for(const event of [null,{}, {type:'spawn'},{type:'release',style:'constructor'},{type:'release',style:Symbol('invalid')}])assert.equal(audio.play(event),false);
  assert.equal(context.sources.length,0);
});
