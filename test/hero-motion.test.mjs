import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspace,workspaceFiles} from '../public/editor/workspace.mjs';
const runtime=await import('../public/editor/hero-runtime.mjs').catch(()=>({}));

test('旧工作区默认提供英雄动作, 导出独立配置并防止文件名覆盖',()=>{
  const workspace=normalizeWorkspace({categories:[],enums:[],tables:{}});
  assert.equal(workspace.heroMotion?.amplitude,0.35);
  const files=workspaceFiles(workspace,'asset-categories.yaml');
  assert.ok(files.some(file=>file.name==='hero-motion.yaml'));
  assert.throws(()=>workspaceFiles(workspace,'HERO-MOTION.yaml'),/冲突/);
});

test('动作参数拒绝超限, 非数值和不完整对象, 不静默回退',()=>{
  assert.equal(typeof runtime.normalizeHeroMotion,'function');
  const config=runtime.normalizeHeroMotion();
  for(const mutate of [c=>c.amplitude=NaN,c=>c.slots.head.size=0,c=>c.actions.walk.head.dx=6,c=>c.actions.attack.weapon.sx=.06,c=>c.actions.hit.duration=0]) {
    const invalid=structuredClone(config);mutate(invalid);
    assert.throws(()=>runtime.normalizeHeroMotion(invalid));
  }
  assert.throws(()=>runtime.normalizeHeroMotion({}));
});

test('静止和零幅度严格保持原始姿势, snapshot不能修改运行时内部配置',()=>{
  assert.equal(typeof runtime.createHeroMotion,'function');
  const motion=runtime.createHeroMotion();motion.advance(10);
  const identity={dx:0,dy:0,sx:1,sy:1};
  assert.deepEqual(motion.snapshot().pose.parts,{head:identity,weapon:identity});
  const config=runtime.normalizeHeroMotion();config.amplitude=0;motion.setConfig(config);
  for(const action of ['walk-left','walk-right','attack','hit']) {
    motion.setAction(action);motion.advance(.1);
    assert.deepEqual(motion.snapshot().pose.parts,{head:identity,weapon:identity});
    assert.equal(motion.snapshot().pose.alpha,1);
  }
});

test('动作按时间驱动, 受伤打断攻击并恢复原行走朝向',()=>{
  assert.equal(typeof runtime.createHeroMotion,'function');
  const one=runtime.createHeroMotion(),many=runtime.createHeroMotion();
  for(const motion of [one,many])motion.setAction('walk-right');
  one.advance(.125);for(let i=0;i<5;i++)many.advance(.025);
  assert.deepEqual(one.snapshot(),many.snapshot());
  assert.equal(one.snapshot().facing,1);
  assert.ok(one.snapshot().pose.parts.head.dy<0);
  one.setAction('attack');one.advance(.2);one.setAction('hit');
  assert.equal(one.setAction('attack'),false);
  one.advance(.55);assert.equal(one.snapshot().state,'walk');assert.equal(one.snapshot().facing,1);
  one.setAction('idle');assert.deepEqual(one.snapshot().pose.parts.head,{dx:0,dy:0,sx:1,sy:1});
  assert.throws(()=>one.advance(-1));assert.throws(()=>one.setAction('dance'));
});

test('头像发现只包含英雄目录直接子级, 更换图标不改变绘制头像和挂点',()=>{
  assert.equal(typeof runtime.heroFiles,'function');
  assert.deepEqual(runtime.heroFiles(['heroes/cao-cao.png','heroes/sub/a.png','icons/a.png','heroes/LB.PNG']),[
    {id:'cao-cao',path:'heroes/cao-cao.png'},{id:'LB',path:'heroes/LB.PNG'}]);
  const calls=[];
  const context={save(){},restore(){},translate(){},scale(){},globalAlpha:1,drawImage(...args){calls.push(args);}};
  const motion=runtime.createHeroMotion();const head={},sword={},axe={};
  runtime.drawHero(context,{head,weapon:sword},motion.snapshot());
  runtime.drawHero(context,{head,weapon:axe},motion.snapshot());
  assert.deepEqual(calls[0],calls[2]);assert.equal(calls[1][0],sword);assert.equal(calls[3][0],axe);
  assert.deepEqual(calls[0].slice(1),[-92,-92,184,184]);
});
