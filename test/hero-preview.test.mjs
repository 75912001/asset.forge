import test from 'node:test';
import assert from 'node:assert/strict';
import {upgradeHeroMotion,normalizeHeroMotion} from '../public/editor/hero-runtime.mjs';
const preview=await import('../public/editor/hero-preview.mjs').catch(()=>({}));

test('编辑器与网页预览在真实释放时刻触发后坐, 攻击中受击不会吞掉后续释放',()=>{
  assert.equal(typeof preview.createHeroPreview,'function');
  const motion=preview.createHeroPreview(upgradeHeroMotion());
  motion.setAction('combo',{style:'shoot',critical:true});motion.advance(.1);
  assert.equal(motion.snapshot().state,'attack');assert.equal(motion.snapshot().hit.active,true);assert.equal(motion.snapshot().pose.recoilOffset,0);
  motion.advance(.05);assert.ok(motion.snapshot().pose.recoilOffset>0);assert.equal(motion.snapshot().frozen,false);
  motion.advance(.5);assert.equal(motion.snapshot().state,'idle');assert.equal(motion.snapshot().pose.recoilOffset,0);
});

test('组合预览在跨越事件的大步推进与多帧推进下生成同一姿态, 重置清除待执行事件',()=>{
  assert.equal(typeof preview.createHeroPreview,'function');
  const one=preview.createHeroPreview(upgradeHeroMotion()),many=preview.createHeroPreview(upgradeHeroMotion());
  for(const motion of [one,many])motion.setAction('combo',{style:'slash'});
  one.advance(.19);for(let i=0;i<19;i++)many.advance(.01);
  const a=one.snapshot().pose,b=many.snapshot().pose;
  assert.ok(Math.abs(a.hurtOffset-b.hurtOffset)<1e-8);assert.ok(Math.abs(a.parts.weapon.rotation-b.parts.weapon.rotation)<1e-8);
  one.reset();one.advance(.2);assert.equal(one.snapshot().state,'idle');assert.equal(one.snapshot().hit.active,false);
  const old=preview.createHeroPreview(normalizeHeroMotion());old.setAction('attack');old.setAction('hit');assert.equal(old.setAction('attack'),false);
});
