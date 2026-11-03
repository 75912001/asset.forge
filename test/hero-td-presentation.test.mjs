import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '../public/editor/hero-runtime.mjs';
const presentation=await import('../projects/hero-td/game/presentation.mjs').catch(()=>({}));

const source={id:1,unitId:1002,isEnemy:false,role:2,style:'shoot',x:1.5,lane:2,hp:160,maxHp:160};
const target={id:2,enemyId:2001,isEnemy:true,role:0,style:'strike',x:5,lane:2,hp:0,maxHp:40};
const config={units:[{id:1002,role:2,icon:'heroes/黄忠.png',weapon:'icons/长弓.png',interval:1.5}],enemies:[{id:2001,icon:'enemies/步卒.png'}]};
function create(onSound=()=>{}) {
  assert.equal(typeof presentation.createBattlePresentation,'function','游戏需要可验证的命中与退场生命周期');
  return presentation.createBattlePresentation({runtime,heroMotion:runtime.upgradeHeroMotion(),config,onSound});
}
const empty=status=>({status,units:[source],enemies:[]});
const hit=(critical=true,time=.05)=>({type:'hit',time,attackId:1,sourceId:1,targetId:2,source,target,amount:critical?40:20,critical,direction:1,lane:2,x:5,role:2,style:'shoot'});

test('最后一击保留死亡快照与真实暴击数字, 收尾完成后才允许结算',()=>{
  const sounds=[],view=create(event=>sounds.push(event.type));
  const events=[hit(),{...hit(),type:'death'}];
  view.advance(.05,empty('won'),events);
  assert.equal(view.entities.get(2).entity.hp,0);
  assert.equal(view.entities.get(2).deadAt,.05);
  const number=view.effects.find(effect=>effect.type==='damage');
  assert.equal(number.amount,40);
  assert.equal(number.critical,true);
  assert.equal(view.settled,false);
  assert.deepEqual(sounds,['hit','death']);
  view.advance(.3,empty('won'));
  assert.equal(view.entities.has(2),false,'死亡残影应按期消失');
  assert.equal(view.settled,false,'暴击数字仍应显示');
  view.advance(.46,empty('won'));
  assert.equal(view.effects.length,0);
  assert.equal(view.settled,true);
});

test('普通伤害显示事件原值, 不按数字大小猜测暴击, 撤除不残留角色',()=>{
  const view=create();
  const alive={...target,hp:100,maxHp:140};
  view.advance(.05,{status:'running',units:[source],enemies:[alive]},[{...hit(false),amount:90,target:alive}]);
  const number=view.effects.find(effect=>effect.type==='damage');
  assert.equal(number.amount,90);
  assert.equal(number.critical,false);
  view.advance(.2,{status:'running',units:[],enemies:[alive]});
  assert.equal(view.entities.has(1),false,'撤除单位不能成为死亡残影');
  assert.equal(view.entities.get(2).entity.x,5,'视觉受击不写回逻辑位置');
});

test('出手才产生弹道, 命中时移除对应弹体并产生受击反馈',()=>{
  const view=create(),alive={...target,hp:40};
  const state={status:'running',units:[source],enemies:[alive]};
  const attack={type:'attack',time:.05,attackId:7,source,target:alive,sourceId:1,targetId:2,role:2,style:'shoot',interval:1.5,fromX:1.5,toX:5,lane:2};
  view.advance(.05,state,[attack]);
  assert.equal(view.effects.some(effect=>effect.type==='projectile'),false);
  view.advance(.15,state,[{...attack,type:'release',time:.2,impactAt:.35,flightDuration:.15,critical:true}]);
  assert.equal(view.effects.filter(effect=>effect.type==='projectile').length,1);
  view.advance(.15,empty('won'),[{...hit(),time:.35,attackId:7},{...hit(),type:'death',time:.35,attackId:7}]);
  assert.equal(view.effects.some(effect=>effect.type==='projectile'),false);
  assert.equal(view.effects.filter(effect=>effect.type==='damage').length,1);
});

test('事件按逻辑时间推进姿势, 一次追帧与分帧播放保持一致',()=>{
  const one=create(),many=create(),alive={...target,hp:100,maxHp:140};
  const state={status:'running',units:[source],enemies:[alive]};
  const event={...hit(false,.05),target:alive};
  one.advance(.2,state,[event]);
  many.advance(.05,state,[event]);many.advance(.05,state);many.advance(.1,state);
  const a=one.entities.get(2).motion.snapshot(),b=many.entities.get(2).motion.snapshot();
  assert.ok(Math.abs(a.pose.hurtOffset-b.pose.hurtOffset)<1e-8);
  assert.equal(one.effects[0].time,many.effects[0].time);
  assert.ok(Math.abs(one.time-many.time)<1e-8);
});

test('模型胜利立即通知保存, 不能等到可被重开打断的视觉收尾结束',()=>{
  const victories=[];
  const view=presentation.createBattlePresentation({runtime,heroMotion:runtime.upgradeHeroMotion(),config,onBattleEnd:state=>victories.push(state.status)});
  view.advance(.05,empty('won'),[hit(),{...hit(),type:'death'}]);
  assert.equal(view.settled,false);
  assert.deepEqual(victories,['won'],'胜利必须在死亡/飘字仍播放时就通知游戏保存');
  view.advance(.1,empty('won'));view.advance(.7,empty('won'));
  assert.deepEqual(victories,['won'],'后续收尾帧不能重复发放通关奖励');
});

test('同一目标的伤害数字交替两侧, 不被其他目标的命中打乱',()=>{
  const view=create(),alive={...target,hp:100},other={...target,id:3,hp:100,lane:1};
  const state={status:'running',units:[source],enemies:[alive,other]};
  view.advance(.05,state,[{...hit(false),target:alive},{...hit(false),target:other,targetId:3,lane:1},{...hit(false),target:other,targetId:3,lane:1},{...hit(),target:alive}]);
  assert.deepEqual(view.effects.filter(effect=>effect.type==='damage'&&effect.targetId===2).map(effect=>effect.offset),[-10,10]);
});
