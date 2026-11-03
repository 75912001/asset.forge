import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGameConfig,createBattle} from '../projects/hero-td/game/model.mjs';
import {gameWorkspace} from './fixtures/hero-td-workspace.mjs';
import {createAttackTiming,upgradeHeroMotion} from '../public/editor/hero-runtime.mjs';

// 固定输入测试模型如何消费共享时序, 不在测试中复刻运行时的换算公式.
const stagedTiming=role=>({cycleTicks:20,releaseDelayTicks:3,flightTicks:[2,5].includes(role)?2:0});
function setup(edit=()=>{},options={},levelId=3001) {
  const workspace=gameWorkspace();
  workspace.tables.td_spawns.rows=workspace.tables.td_levels.rows.map((level,index)=>({id:4001+index,level_id:level.id,time_ms:0,lane:2,enemy_id:2001,count:1,spacing_ms:0}));
  workspace.tables.td_enemies.rows[0].speed_percent=1;
  edit(workspace);
  const config=parseGameConfig(workspace);
  const battle=createBattle(config,levelId,config.levels.filter(level=>level.id<levelId).map(level=>level.id),{timing:stagedTiming,random:()=>.9,...options});
  return {battle,config,state:battle.state};
}
const events=(battle,type)=>battle.state.events.filter(event=>event.type===type);

test('远程起手不扣血, 出手后到达约定落点时刻才命中',()=>{
  const {battle,state}=setup();battle.deploy(1002,2,0);
  battle.advance(.05);
  const attack=events(battle,'attack')[0];
  assert.equal(state.enemies[0].hp,100);
  assert.equal(attack.time,.05);assert.equal(attack.releaseAt,.2);assert.equal(attack.impactAt,null);
  assert.equal(attack.source.isEnemy,false);assert.equal(attack.target.isEnemy,true);assert.equal(attack.style,'shoot');
  battle.advance(.1);assert.equal(events(battle,'release').length,0);assert.equal(state.enemies[0].hp,100);
  battle.advance(.05);
  const release=events(battle,'release')[0];
  assert.equal(release.attackId,attack.attackId);assert.equal(release.time,.2);assert.ok(Math.abs(release.impactAt-.3)<1e-8);assert.equal(release.flightDuration,.1);
  assert.equal(state.enemies[0].hp,100);
  battle.advance(.05);assert.equal(state.enemies[0].hp,100);
  battle.advance(.05);
  const hit=events(battle,'hit')[0];
  assert.equal(state.enemies[0].hp,75);assert.equal(hit.amount,25);assert.equal(hit.critical,false);
  assert.equal(hit.direction,1);assert.equal(hit.lane,2);assert.equal(hit.x,hit.target.x);
  assert.ok(Math.abs(hit.time-.3)<1e-8);
  assert.equal(attack.target.hp,100,'事件快照不能随实体后续扣血发生变化');
});

test('近战在有效出手时命中, 敌人阻挡状态稳定提供给表现层',()=>{
  const {battle,state}=setup(w=>w.tables.td_enemies.rows[0].speed_percent=1000);
  battle.deploy(1003,2,7);battle.advance(.05);
  assert.equal(state.enemies[0].moving,false);assert.equal(state.enemies[0].hp,100);
  const spawn=events(battle,'spawn')[0];assert.equal(spawn.target.moving,true);
  battle.advance(.15);
  assert.equal(state.enemies[0].hp,90);
  const release=events(battle,'release').find(event=>!event.source.isEnemy);
  assert.equal(release.flightDuration,0);assert.equal(release.impactAt,release.time);assert.equal(release.style,'thrust');
  assert.equal(events(battle,'hit').find(event=>!event.source.isEnemy).time,release.time);
  battle.remove(2,7);battle.advance(.05);assert.equal(state.enemies[0].moving,true);
});

test('暴击率可选但必须合法, 群攻每次有效出手只判定一次且整组共用结果',()=>{
  assert.equal(setup().config.units[1].crit_chance_percent,0);
  for(const chance of [-1,101,.5,'10',NaN])assert.throws(()=>setup(w=>w.tables.td_units.rows[1].crit_chance_percent=chance));
  let rolls=0;
  const {battle,state}=setup(w=>{
    w.tables.td_units.rows[3].crit_chance_percent=50;
    w.tables.td_enemies.rows[0].hp=200;
    w.tables.td_spawns.rows[1].count=3;
  },{random:()=>[.1,.9][rolls++]},3002);
  battle.deploy(1004,2,7);battle.advance(.2);
  assert.equal(rolls,1);assert.deepEqual(state.enemies.map(enemy=>enemy.hp),[120,120,120]);
  assert.ok(events(battle,'hit').every(event=>event.critical&&event.amount===80));
  battle.advance(1);
  assert.equal(rolls,2);assert.deepEqual(state.enemies.map(enemy=>enemy.hp),[80,80,80]);
  assert.ok(events(battle,'hit').every(event=>!event.critical&&event.amount===40));
});

test('敌人不消耗暴击随机数, 无效出手也不消耗随机数',()=>{
  const {battle,state}=setup(w=>w.tables.td_enemies.rows[0].speed_percent=1000,{random:()=>{throw new Error('不应判定暴击');}});
  battle.deploy(1001,2,7);battle.advance(.2);
  const hit=events(battle,'hit')[0];assert.equal(hit.source.isEnemy,true);assert.equal(hit.critical,false);assert.equal(hit.direction,-1);
  assert.equal(state.units[0].hp,130);
  const cancelled=setup(()=>{},{random:()=>{throw new Error('不应判定暴击');}}).battle;
  cancelled.deploy(1002,2,0);cancelled.advance(.05);cancelled.remove(2,0);cancelled.advance(.5);
  assert.equal(events(cancelled,'release').length,0);
});

test('出手前撤除取消攻击, 弹体离手后撤除来源不撤回伤害',()=>{
  for(const releaseFirst of [false,true]) {
    const {battle,state}=setup();const unit=battle.deploy(1002,2,0);
    battle.advance(releaseFirst?.2:.05);battle.remove(2,0);battle.advance(.4);
    assert.equal(state.enemies[0].hp,releaseFirst?75:100);
    if(releaseFirst) {
      const hit=events(battle,'hit')[0];assert.equal(hit.sourceId,unit.id);assert.equal(hit.source.unitId,1002);assert.equal(hit.source.isEnemy,false);
    }else assert.equal(events(battle,'release').length,0);
  }
});

test('出手前阵亡取消准备, 出手后阵亡的弹体仍会命中',()=>{
  for(const released of [false,true]) {
    const timing=role=>({cycleTicks:20,releaseDelayTicks:role===0?(released?3:0):(released?0:3),flightTicks:role===2?4:0});
    const {battle,state}=setup(w=>{
      w.tables.td_units.rows[1].hp=1;
      w.tables.td_enemies.rows[0].speed_percent=1000;
    },{timing});
    const source=battle.deploy(1002,2,7);battle.advance(.3);
    assert.equal(state.units.length,0);assert.equal(state.enemies[0].hp,released?75:100);
    const death=events(battle,'death').find(event=>event.targetId===source.id);
    assert.equal(death.target.hp,0);assert.equal(death.target.unitId,1002);assert.equal(death.target.isEnemy,false);
    assert.equal(death.source.isEnemy,true);assert.equal(death.style,'strike');
  }
});

test('受击方向由发射起点指向实际落点, 来源阵亡后目标越过起点也会改变方向',()=>{
  const timing=role=>({cycleTicks:20,releaseDelayTicks:0,flightTicks:role===2?6:0});
  const {battle,state}=setup(w=>{
    w.tables.td_units.rows[1].hp=1;
    w.tables.td_enemies.rows[0].speed_percent=1000;
  },{timing});
  battle.advance(.2);const archer=battle.deploy(1002,2,4);battle.advance(.05);
  const release=events(battle,'release').find(event=>event.sourceId===archer.id);
  assert.equal(release.direction,1);assert.equal(release.fromX,4.5);
  battle.advance(.3);
  assert.equal(state.units.length,0,'来源在弹体命中前已经阵亡');
  const hit=events(battle,'hit').find(event=>event.sourceId===archer.id);
  assert.ok(hit.target.x<hit.source.x,'高速敌人已经越过原发射位置');
  assert.equal(hit.direction,-1);assert.equal(hit.source.isEnemy,false);
  assert.equal(hit.fromX,4.5);assert.equal(hit.toX,hit.target.x);
});

test('命中点与原发射位置重合时固定使用向右方向',()=>{
  const timing=role=>({cycleTicks:20,releaseDelayTicks:0,flightTicks:role===2?4:0});
  const {battle}=setup(w=>{
    w.tables.td_units.rows[1].hp=1;
    w.tables.td_enemies.rows[0].speed_percent=900;
  },{timing});
  battle.advance(.2);const archer=battle.deploy(1002,2,4);battle.advance(.25);
  const hit=events(battle,'hit').find(event=>event.sourceId===archer.id);
  assert.equal(hit.source.x,hit.target.x);assert.equal(hit.direction,1);
});

test('单体起手锁定目标, 原目标死亡后不转移到后来出现的敌人',()=>{
  const timing=role=>({cycleTicks:1200,releaseDelayTicks:role===2?3:0,flightTicks:0});
  const {battle,state}=setup(w=>{
    w.tables.td_units.rows[2].damage=100;
    w.tables.td_spawns.rows[0].count=2;w.tables.td_spawns.rows[0].spacing_ms=100;
  },{timing});
  const archer=battle.deploy(1002,2,0);battle.deploy(1003,2,7);
  battle.advance(.4);
  assert.equal(state.enemies.length,1);assert.equal(state.enemies[0].hp,100);
  assert.equal(events(battle,'release').filter(event=>event.sourceId===archer.id).length,0);
});

test('关羽出手时重新收集范围内目标, 包括起手后才到达的敌人',()=>{
  const timing=role=>({cycleTicks:1200,releaseDelayTicks:role===4?3:0,flightTicks:0});
  const {battle,state}=setup(w=>{
    w.tables.td_units.rows[1].damage=100;
    w.tables.td_spawns.rows[1].count=2;w.tables.td_spawns.rows[1].spacing_ms=100;
  },{timing},3002);
  const guan=battle.deploy(1004,2,7);battle.deploy(1002,2,0);battle.advance(.2);
  assert.equal(state.enemies.length,1);assert.equal(state.enemies[0].hp,60);
  const started=events(battle,'attack').find(event=>event.sourceId===guan.id),released=events(battle,'release').find(event=>event.sourceId===guan.id);
  assert.notEqual(started.targetId,released.targetId);assert.equal(released.style,'slash');
});

test('目标在飞行中死亡使弹体失效, 不损伤下一名敌人',()=>{
  const timing=role=>({cycleTicks:1200,releaseDelayTicks:role===2?0:3,flightTicks:role===2?6:0});
  const {battle,state}=setup(w=>{
    w.tables.td_units.rows[2].damage=100;
    w.tables.td_spawns.rows[0].count=2;w.tables.td_spawns.rows[0].spacing_ms=250;
  },{timing});
  const archer=battle.deploy(1002,2,0);battle.deploy(1003,2,7);battle.advance(.5);
  assert.equal(state.enemies.length,1);assert.equal(state.enemies[0].hp,100);
  assert.equal(events(battle,'hit').filter(event=>event.sourceId===archer.id).length,0);
});

test('目标漏怪使在途弹体失效, 不转移给后续敌人',()=>{
  const timing=()=>({cycleTicks:20,releaseDelayTicks:0,flightTicks:6});
  const {battle,state}=setup(w=>{
    w.tables.td_enemies.rows[0].speed_percent=1000;
    w.tables.td_spawns.rows[0].count=2;w.tables.td_spawns.rows[0].spacing_ms=1000;
  },{timing});
  battle.advance(.7);battle.deploy(1002,2,0);battle.advance(.05);battle.remove(2,0);battle.advance(.4);
  assert.equal(state.gateHp,2);assert.equal(state.enemies.length,1);assert.equal(state.enemies[0].hp,100);
  assert.equal(events(battle,'hit').length,0);
  const leak=events(battle,'leak')[0];assert.equal(leak.target.isEnemy,true);assert.equal(typeof leak.time,'number');
});

test('同tick到达的致命弹体先于漏怪结算, 可以在城门边缘救下防线',()=>{
  const timing=()=>({cycleTicks:20,releaseDelayTicks:0,flightTicks:2});
  const {battle,state}=setup(w=>{
    w.tables.td_enemies.rows[0].speed_percent=1000;
    w.tables.td_enemies.rows[0].hp=25;
  },{timing});
  battle.advance(.7);battle.deploy(1002,2,0);battle.advance(.05);battle.remove(2,0);battle.advance(.1);
  assert.equal(state.status,'won');assert.equal(state.gateHp,3);assert.equal(events(battle,'leak').length,0);
  assert.equal(events(battle,'death').length,1);assert.ok(events(battle,'death')[0].target.x<0);
});

test('替换阻挡单位不会让敌人的旧前摇命中新部署的英雄',()=>{
  const {battle,state}=setup(w=>w.tables.td_enemies.rows[0].speed_percent=1000);
  battle.deploy(1001,2,7);battle.advance(.1);battle.remove(2,7);
  const replacement=battle.deploy(1001,2,7);battle.advance(.3);
  assert.equal(replacement.hp,150);assert.equal(events(battle,'hit').length,0);
  assert.equal(state.enemies[0].moving,false);
});

test('同tick先收集出手再结算命中, 双方可换血且死亡快照不丢失',()=>{
  const timing=()=>({cycleTicks:20,releaseDelayTicks:0,flightTicks:0});
  const {battle,state}=setup(w=>{
    w.tables.td_units.rows[2].damage=100;w.tables.td_units.rows[2].hp=20;
    w.tables.td_enemies.rows[0].speed_percent=1000;
  },{timing});
  battle.deploy(1003,2,7);battle.advance(.05);
  assert.equal(state.units.length,0);assert.equal(state.enemies.length,0);assert.equal(state.status,'won');
  const releases=events(battle,'release'),deaths=events(battle,'death');
  assert.equal(releases.length,2);assert.equal(deaths.length,2);
  assert.deepEqual(deaths.map(event=>event.target.isEnemy),[true,false]);
  assert.ok(deaths.every(event=>event.time===.05&&event.target.hp===0&&Number.isInteger(event.attackId)));
});

test('最后一名敌人死亡立即获胜, 不等待已经失效的远程弹体',()=>{
  const timing=role=>({cycleTicks:20,releaseDelayTicks:0,flightTicks:role===2?1:6});
  const {battle,state}=setup(w=>w.tables.td_enemies.rows[0].hp=25,{timing},3003);
  battle.deploy(1002,2,0);battle.deploy(1005,2,1);battle.advance(.1);
  assert.equal(state.status,'won');assert.equal(state.elapsed,.1);
  const frozen=structuredClone(state);assert.deepEqual(battle.advance(1),[]);assert.deepEqual(state,frozen);
});

test('暴击与事件时序在一次大步推进和多帧推进之间完全一致',()=>{
  const random=()=>{let calls=0;return ()=>[.1,.9,.3,.8][calls++%4];};
  const edit=w=>{w.tables.td_units.rows[1].crit_chance_percent=50;w.tables.td_enemies.rows[0].hp=10000;};
  const first=setup(edit,{random:random()}),second=setup(edit,{random:random()});
  for(const sample of [first,second])sample.battle.deploy(1002,2,0);
  const one=first.battle.advance(5),many=[];
  for(let i=0;i<50;i++)many.push(...second.battle.advance(.1));
  assert.deepEqual(one,many);assert.deepEqual({...first.state,events:[]},{...second.state,events:[]});
});

test('共享动作时序驱动实际暴击命中, 命中与死亡事件保留溢出伤害',()=>{
  const timing=createAttackTiming(upgradeHeroMotion());
  const {battle,state}=setup(w=>{
    w.tables.td_units.rows[1].crit_chance_percent=100;
    w.tables.td_enemies.rows[0].hp=10;
  },{timing,random:()=>.99});
  battle.deploy(1002,2,0);battle.advance(.2);
  const release=events(battle,'release')[0];
  assert.equal(release.time,.2);assert.equal(release.flightDuration,.25);assert.equal(release.impactAt,.45);
  assert.equal(state.enemies[0].hp,10);
  battle.advance(.25);
  const hit=events(battle,'hit')[0],death=events(battle,'death')[0];
  assert.equal(hit.time,.45);assert.equal(hit.amount,50);assert.equal(hit.target.hp,0);assert.equal(hit.critical,true);
  assert.equal(death.amount,50);assert.equal(death.target.hp,0);assert.equal(state.status,'won');
});

test('共享时序允许50毫秒攻击周期, 远程多发弹体可以同时在途',()=>{
  const timing=createAttackTiming(upgradeHeroMotion());
  const melee=setup(w=>{
    w.tables.td_units.rows[2].interval_ms=50;
    w.tables.td_enemies.rows[0].hp=1000;
  },{timing});
  melee.battle.deploy(1003,2,7);melee.battle.advance(.2);
  assert.equal(melee.state.enemies[0].hp,960);
  assert.deepEqual(events(melee.battle,'release').map(event=>+event.time.toFixed(2)),[.05,.1,.15,.2]);
  assert.ok(events(melee.battle,'release').every(event=>event.impactAt===event.time));
  const ranged=setup(w=>{
    w.tables.td_units.rows[1].interval_ms=50;
    w.tables.td_enemies.rows[0].hp=1000;
  },{timing});
  ranged.battle.deploy(1002,2,0);ranged.battle.advance(.25);
  assert.equal(events(ranged.battle,'release').length,5);assert.equal(ranged.state.enemies[0].hp,1000);
  ranged.battle.advance(.15);assert.equal(ranged.state.enemies[0].hp,925);
});

test('非法时序和随机输入明确报错, 不以无效配置启动战斗',()=>{
  assert.throws(()=>setup(()=>{},{timing:1}));
  assert.throws(()=>setup(()=>{},{random:null}));
  for(const timing of [()=>({cycleTicks:0,releaseDelayTicks:0,flightTicks:0}),()=>({cycleTicks:2,releaseDelayTicks:2,flightTicks:0}),()=>({cycleTicks:2,releaseDelayTicks:0,flightTicks:NaN})]) {
    const {battle}=setup(()=>{},{timing});battle.deploy(1002,2,0);assert.throws(()=>battle.advance(.05));
  }
  const {battle}=setup(()=>{},{random:()=>1});battle.deploy(1002,2,0);assert.throws(()=>battle.advance(.2));
});
