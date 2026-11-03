import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '../public/editor/hero-runtime.mjs';

const combat=()=>{assert.equal(typeof runtime.upgradeHeroMotion,'function');return runtime.upgradeHeroMotion(runtime.normalizeHeroMotion());};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('显式升级保留旧挂点与行走, 旧默认配置仍是v1且不被改写',()=>{
  const old=runtime.normalizeHeroMotion();old.slots.head.x=120;old.actions.walk.head.dy=-3;
  const copy=structuredClone(old),next=combat();assert.equal(next.version,2);
  const upgraded=runtime.upgradeHeroMotion(old);
  assert.deepEqual(old,copy);assert.deepEqual(upgraded.slots,old.slots);assert.deepEqual(upgraded.actions.walk,old.actions.walk);
  assert.equal(runtime.normalizeHeroMotion().version,1);assert.equal(upgraded.actions.attack,undefined);
  assert.deepEqual(runtime.normalizeHeroMotion(upgraded),upgraded);
  for(const mutate of [c=>c.combat.anticipation=-1,c=>c.combat.strike=NaN,c=>c.combat.hitStop=.051,c=>c.combat.hitStrength=3]){const invalid=structuredClone(upgraded);mutate(invalid);assert.throws(()=>runtime.normalizeHeroMotion(invalid));}
});

test('攻击时序给出前摇与出手结束的真实释放tick, 飞行与短周期共同量化',()=>{
  const config=combat();assert.equal(typeof runtime.createAttackTiming,'function');const timing=runtime.createAttackTiming(config);
  assert.deepEqual(timing(2,1,8),{cycleTicks:20,releaseDelayTicks:3,flightTicks:5,anticipation:.1,strike:.05,recovery:.15,duration:.3});
  assert.equal(timing(5,1,8).flightTicks,6);assert.equal(timing(2,1,0).flightTicks,1);assert.equal(timing(4,1,8).flightTicks,0);
  const short=timing(3,.05);assert.equal(short.cycleTicks,1);assert.equal(short.releaseDelayTicks,0);near(short.duration,.05);
  const rapid=timing(4,.1);assert.equal(rapid.releaseDelayTicks,1);near(rapid.anticipation+rapid.strike,.05);near(rapid.duration,.1);
  assert.throws(()=>timing(2,0));assert.throws(()=>timing(2,1,-1));
  config.combat.recovery=0;assert.ok(runtime.createAttackTiming(config)(3,.05).duration>0);
});

test('连续同向与反向命中从当前姿态衔接, 重击冻结不吞掉冲击过渡也不累加时长',()=>{
  const motion=runtime.createHeroMotion(combat());
  motion.setAction('hit',{direction:1});motion.advance(.05);const before=motion.snapshot().pose;
  motion.setAction('hit',{direction:1});near(motion.snapshot().pose.hurtOffset,before.hurtOffset);near(motion.snapshot().pose.body.sx,before.body.sx);
  motion.advance(.01);assert.ok(motion.snapshot().pose.hurtOffset>before.hurtOffset);
  const current=motion.snapshot().pose.hurtOffset;motion.setAction('hit',{direction:-1,critical:true,heavy:true});near(motion.snapshot().pose.hurtOffset,current);
  motion.advance(.02);assert.ok(motion.snapshot().pose.hurtOffset<0);assert.equal(motion.snapshot().frozen,true);
  motion.advance(.031);assert.equal(motion.snapshot().frozen,false);assert.ok(Math.abs(motion.snapshot().pose.hurtOffset)<=9*256/102);
  motion.advance(1);assert.equal(motion.snapshot().pose.hurtOffset,0);assert.deepEqual(motion.snapshot().pose.body,{sx:1,sy:1});
  motion.setAction('hit',{direction:1});motion.advance(.01);motion.setAction('hit',{direction:-1,heavy:true});motion.setAction('release',{style:'shoot'});motion.advance(.025);assert.equal(motion.snapshot().frozen,false);
});

test('固定攻击轨迹区分武器, 受击独立叠加而不拒绝或吞掉攻击',()=>{
  const config=combat(),slash=runtime.createHeroMotion(config),thrust=runtime.createHeroMotion(config);
  slash.setAction('attack',{style:'slash',interval:1});thrust.setAction('attack',{style:'thrust',interval:1});slash.advance(.15);thrust.advance(.15);
  assert.notEqual(slash.snapshot().pose.parts.weapon.rotation,thrust.snapshot().pose.parts.weapon.rotation);
  slash.setAction('hit',{direction:1});assert.equal(slash.snapshot().state,'attack');assert.ok(slash.snapshot().pose.flash>0);
  assert.equal(slash.setAction('attack',{style:'shoot',interval:1}),true);assert.equal(slash.snapshot().state,'attack');assert.equal(slash.snapshot().hit.active,true);
});

test('普通暴击受击方向不依赖镜像, 重甲位移减半, 连击有界且最后恢复基准',()=>{
  const config=combat(),normal=runtime.createHeroMotion(config),critical=runtime.createHeroMotion(config),armored=runtime.createHeroMotion(config);
  normal.setAction('walk-right');normal.setAction('idle');
  normal.setAction('hit',{direction:1});critical.setAction('hit',{direction:-1,critical:true});armored.setAction('hit',{direction:1,armored:true});
  near(normal.snapshot().pose.flash,.7);near(critical.snapshot().pose.flash,1);
  assert.ok(normal.snapshot().pose.hurtOffset>0);assert.ok(critical.snapshot().pose.hurtOffset<0);
  near(armored.snapshot().pose.hurtOffset,normal.snapshot().pose.hurtOffset/2);
  near(normal.snapshot().pose.body.sx,.92);near(normal.snapshot().pose.body.sy,1.06);
  near(critical.snapshot().pose.body.sx,.86);near(critical.snapshot().pose.body.sy,1.10);
  for(let i=0;i<20;i++){normal.advance(.01);normal.setAction('hit',{direction:1});assert.ok(normal.snapshot().pose.hurtOffset<=5*256/102+1e-8);}
  normal.advance(1);assert.equal(normal.snapshot().pose.hurtOffset,0);assert.deepEqual(normal.snapshot().pose.body,{sx:1,sy:1});assert.equal(normal.snapshot().pose.flash,0);
});

test('后坐只由释放触发且逆发射方向, 局部停顿不延迟内部动作, 新释放与死亡清除冻结',()=>{
  const motion=runtime.createHeroMotion(combat());motion.setAction('walk-right');motion.setAction('idle');motion.setAction('attack',{style:'shoot',interval:1});motion.advance(.15);
  assert.equal(motion.snapshot().pose.recoilOffset,0);motion.setAction('release',{style:'shoot'});assert.ok(motion.snapshot().pose.recoilOffset<0);
  motion.setAction('impact');assert.equal(motion.snapshot().frozen,true);const frozen=motion.snapshot().pose.parts.weapon;
  motion.advance(.025);assert.deepEqual(motion.snapshot().pose.parts.weapon,frozen);motion.advance(.04);assert.equal(motion.snapshot().frozen,false);
  motion.setAction('impact');motion.setAction('release',{style:'shoot'});assert.equal(motion.snapshot().frozen,false);
  motion.setAction('impact');motion.setAction('death');assert.equal(motion.snapshot().frozen,false);const dead=motion.snapshot().pose.parts;
  motion.advance(1);assert.deepEqual(motion.snapshot().pose.parts,dead);
});

test('零幅度关闭全部v2姿态和冲击效果, 组合事件按时间分帧保持一致',()=>{
  const config=combat();config.amplitude=0;const still=runtime.createHeroMotion(config);
  still.setAction('attack',{style:'slash',interval:1});still.setAction('hit',{direction:1,critical:true,heavy:true});still.setAction('release',{style:'shoot'});still.advance(.03);
  const pose=still.snapshot().pose;assert.equal(pose.hurtOffset,0);assert.equal(pose.recoilOffset,0);assert.equal(pose.flash,0);assert.equal(pose.criticalGlow,0);assert.deepEqual(pose.body,{sx:1,sy:1});
  for(const part of Object.values(pose.parts))assert.deepEqual(part,{dx:0,dy:0,sx:1,sy:1,rotation:0});
  const one=runtime.createHeroMotion(combat()),many=runtime.createHeroMotion(combat());
  for(const motion of [one,many]){motion.setAction('attack',{style:'thrust',interval:1});motion.advance(.15);motion.setAction('release',{style:'thrust'});motion.setAction('hit',{direction:-1,critical:true,heavy:true});}
  one.advance(.16);for(let i=0;i<8;i++)many.advance(.02);
  for(const field of ['hurtOffset','recoilOffset','flash','criticalGlow'])near(one.snapshot().pose[field],many.snapshot().pose[field]);
  for(const part of ['head','weapon'])for(const field of ['dx','dy','sx','sy','rotation'])near(one.snapshot().pose.parts[part][field],many.snapshot().pose.parts[part][field]);
});
