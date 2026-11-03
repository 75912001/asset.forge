import test from 'node:test';
import assert from 'node:assert/strict';
import {gameWorkspace} from './fixtures/hero-td-workspace.mjs';
const model=await import('../projects/hero-td/game/model.mjs').catch(()=>({}));

function config(edit=()=>{}) {
  assert.equal(typeof model.parseGameConfig,'function','游戏必须提供配置校验入口');
  const workspace=gameWorkspace();edit(workspace);
  return model.parseGameConfig(workspace);
}
function singleWave(edit=()=>{}) {
  return config(workspace=>{
    workspace.tables.td_spawns.rows=workspace.tables.td_levels.rows.map((level,i)=>({id:4001+i,level_id:level.id,time_ms:0,lane:2,enemy_id:2001,count:1,spacing_ms:0}));
    edit(workspace);
  });
}

test('读取已保存整数配置并转换为战斗时间和格子单位',()=>{
  const parsed=config();
  assert.equal(parsed.units[3].interval,1.2);
  assert.equal(parsed.units[3].range,1.25);
  assert.equal(parsed.units[4].slow_factor,.5);
  assert.equal(parsed.units[4].slow_duration,2.5);
  assert.equal(parsed.enemies[1].speed,.45);
  assert.equal(parsed.levels[0].duration,120);
  assert.equal(parsed.spawns.find(spawn=>spawn.id===4002).spacing,3);
  const source=gameWorkspace(),copied=model.parseGameConfig(source);
  source.tables.td_units.rows[1].damage=999;
  assert.equal(copied.units[1].damage,25,'模型不能持有外部可变配置引用');
});

test('游戏接受编辑器合法的中文PNG路径与空武器, 拒绝文件系统非法字符',()=>{
  const parsed=config(w=>{
    w.tables.td_units.rows[1].icon='heroes/黄忠 #1 50%.PNG';
    w.tables.td_units.rows[1].weapon=null;
  });
  assert.equal(parsed.units[1].icon,'heroes/黄忠 #1 50%.PNG');
  assert.equal(parsed.units[1].weapon,'');
  for(const icon of ['heroes/黄忠*.png','heroes/黄忠|.png','heroes/黄忠<.png','heroes/黄忠".png','/heroes/黄忠.png','heroes//黄忠.png','heroes/./黄忠.png','C:/黄忠.png','heroes/'+ 'a'.repeat(2048)+'.png']) {
    assert.throws(()=>config(w=>w.tables.td_units.rows[1].icon=icon));
  }
});

test('近战射程必须覆盖接触距离, 畸形出兵和通关记录不能跳过前置规则',()=>{
  for(const edit of [
    w=>w.tables.td_units.rows[2].range_percent=20,
    w=>w.tables.td_units.rows[0].production_interval_ms=0,
    w=>w.tables.td_units.rows.forEach(unit=>unit.unlock_level=3001),
    w=>w.tables.td_enemies.rows[1].id=2001,
    w=>w.tables.td_levels.rows[1].id=3001,
    w=>w.tables.td_spawns.rows[1].id=4001,
    w=>w.tables.td_spawns.rows[0].level_id=999,
    w=>w.tables.td_spawns.rows[0].count=1000000,
    w=>{w.tables.td_spawns.rows[0].time_ms=119000;w.tables.td_spawns.rows[0].count=2;w.tables.td_spawns.rows[0].spacing_ms=2000;},
  ])assert.throws(()=>config(edit));
  const parsed=config();
  for(const completed of [null,[999],[3002],[3001,3003]]) {
    assert.throws(()=>model.availableLevels(parsed,completed));
    assert.throws(()=>model.createBattle(parsed,3001,completed));
  }
});

test('拒绝非法数值, 图片路径, 重复ID和无法执行的关卡引用',()=>{
  assert.equal(typeof model.parseGameConfig,'function');
  for(const edit of [
    w=>w.tables.td_units.rows[1].cost=-1,
    w=>w.tables.td_units.rows[1].interval_ms=0,
    w=>w.tables.td_units.rows[1].range_percent=NaN,
    w=>w.tables.td_units.rows[1].role=9,
    w=>w.tables.td_units.rows[1].icon='../other/hero.png',
    w=>w.tables.td_units.rows[1].id=1001,
    w=>w.tables.td_units.rows[4].slow_percent=100,
    w=>w.tables.td_units.rows[4].unlock_level=999,
    w=>w.tables.td_enemies.rows[0].speed_percent=0,
    w=>w.tables.td_spawns.rows[0].enemy_id=999,
    w=>w.tables.td_spawns.rows[0].lane=5,
    w=>w.tables.td_spawns.rows[0].count=0,
    w=>w.tables.td_spawns.rows[0].time_ms=120001,
    w=>w.tables.td_spawns.rows=w.tables.td_spawns.rows.filter(row=>row.level_id!==3002),
  ])assert.throws(()=>config(edit));
});

test('通关记录只解锁后续关卡和英雄, 新关卡重新计算资源',()=>{
  const parsed=config();
  assert.deepEqual(model.availableLevels(parsed,[]).map(x=>x.id),[3001]);
  assert.deepEqual(model.availableLevels(parsed,[3001]).map(x=>x.id),[3001,3002]);
  assert.deepEqual(model.availableUnits(parsed,[]).map(x=>x.id),[1001,1002,1003]);
  assert.deepEqual(model.availableUnits(parsed,[3001]).map(x=>x.id),[1001,1002,1003,1004]);
  assert.throws(()=>model.createBattle(parsed,3002,[]),/解锁/);
  const first=model.createBattle(parsed,3001,[]);
  assert.throws(()=>first.deploy(1004,0,0),/解锁/);
  const next=model.createBattle(parsed,3002,[3001]);
  assert.equal(next.state.energy,300);
  assert.equal(next.state.units.length,0);
  assert.equal(next.deploy(1004,0,0).maxHp,300);
});

test('部署校验先于扣费, 同名英雄可重复部署, 撤除没有返费',()=>{
  const battle=model.createBattle(config(),3001);
  const first=battle.deploy(1002,0,0),second=battle.deploy(1002,0,1);
  assert.notEqual(first.id,second.id);
  assert.equal(battle.state.energy,50);
  for(const args of [[1002,0,0],[1002,-1,2],[1002,5,2],[1002,0,8],[1002,.5,2],[999,1,1],[1002,1,1]])assert.throws(()=>battle.deploy(...args));
  assert.equal(battle.state.energy,50);
  assert.equal(battle.state.units.length,2);
  assert.equal(battle.remove(0,0).id,first.id);
  assert.equal(battle.state.energy,50);
  assert.throws(()=>battle.remove(0,0));
  battle.advance(10);
  assert.equal(battle.state.energy,100);
  battle.deploy(1002,0,0);
  assert.equal(battle.state.energy,0);
});

test('自然灵气与聚灵阵按时间累积, 聚灵阵被毁后停止生产',()=>{
  const battle=model.createBattle(singleWave(w=>{
    w.tables.td_enemies.rows[0].speed_percent=1000;
    w.tables.td_enemies.rows[0].damage=1000;
    w.tables.td_spawns.rows[0].time_ms=11000;
    w.tables.td_spawns.rows[0].count=2;
    w.tables.td_spawns.rows[0].spacing_ms=60000;
  }),3001);
  battle.deploy(1001,2,7);
  battle.advance(10);
  assert.equal(battle.state.energy,275);
  battle.advance(2);
  assert.equal(battle.state.units.length,0,'敌人必须能摧毁生产单位');
  const after=battle.state.energy;
  battle.advance(.5);
  assert.equal(battle.state.energy,after+2.5,'阵亡后只能获得自然恢复');
});

test('敌人被前排阻挡, 阵亡后继续前进, 同路后排不会被越过攻击',()=>{
  const battle=model.createBattle(singleWave(w=>{
    w.tables.td_enemies.rows[0].speed_percent=1000;
    w.tables.td_enemies.rows[0].damage=50;
    w.tables.td_units.rows[0].hp=100;
  }),3001);
  const rear=battle.deploy(1001,2,5),front=battle.deploy(1001,2,7);
  battle.advance(.2);
  assert.equal(front.hp,50);
  assert.equal(rear.hp,100,'尚未接触的后排不能受伤');
  assert.equal(battle.state.enemies[0].x,7.95);
  battle.advance(1);
  assert.equal(battle.state.units.some(unit=>unit.id===front.id),false);
  assert.equal(rear.hp,100,'前排死亡的同一时间步不能跳过后排距离');
  battle.advance(1.1);
  assert.ok(rear.hp<100,'下一次接触后攻击后排');
});

test('预定波次按时间出现, 不等待已有敌人清空',()=>{
  const battle=model.createBattle(singleWave(w=>{
    w.tables.td_spawns.rows[0].count=3;
    w.tables.td_spawns.rows[0].spacing_ms=1000;
  }),3001);
  battle.advance(2.05);
  assert.equal(battle.state.spawned,3);
  assert.equal(battle.state.enemies.length,3);
  assert.equal(battle.state.totalSpawns,3);
});

test('近战只攻击本路前方射程内敌人, 关羽群攻命中全部目标',()=>{
  const battle=model.createBattle(singleWave(w=>{
    w.tables.td_enemies.rows[0].speed_percent=1;
    w.tables.td_enemies.rows[0].hp=1000;
    w.tables.td_spawns.rows[1].count=3;
  }),3002,[3001]);
  battle.deploy(1004,2,7);
  battle.advance(.05);
  assert.deepEqual(battle.state.enemies.map(enemy=>enemy.hp),[960,960,960]);
  assert.equal(battle.state.events.filter(event=>event.type==='hit').length,3);
  const untouched=model.createBattle(singleWave(w=>{
    w.tables.td_enemies.rows[0].speed_percent=1;
  }),3002,[3001]);
  untouched.deploy(1004,2,5);untouched.deploy(1004,1,7);untouched.advance(.1);
  assert.equal(untouched.state.enemies[0].hp,100);
});

test('减速有明确到期时间, 到期后敌人恢复原速度',()=>{
  const battle=model.createBattle(singleWave(w=>{
    w.tables.td_enemies.rows[0].hp=1000;
    w.tables.td_units.rows[4].interval_ms=60000;
    w.tables.td_units.rows[4].slow_duration_ms=1000;
  }),3003,[3001,3002]);
  battle.deploy(1005,2,0);battle.advance(.05);
  const enemy=battle.state.enemies[0];
  assert.equal(enemy.slowFactor,.5);
  assert.ok(enemy.slowUntil>battle.state.elapsed);
  const x=enemy.x;battle.advance(.5);
  assert.ok(Math.abs(x-enemy.x-.05)<1e-8);
  battle.advance(1);
  const recovered=enemy.x;battle.advance(.5);
  assert.ok(Math.abs(recovered-enemy.x-.1)<1e-8);
});

test('清完全部预定敌人获胜, 战斗结束后不能继续部署或推进',()=>{
  const battle=model.createBattle(singleWave(w=>{
    w.tables.td_enemies.rows[0].hp=25;
    w.tables.td_spawns.rows[0].time_ms=1000;
  }),3001);
  battle.deploy(1002,2,0);battle.advance(.5);
  assert.equal(battle.state.status,'running','未来仍有波次时不能提前判胜');
  battle.advance(.6);
  assert.equal(battle.state.status,'won');
  assert.equal(battle.state.enemies.length,0);
  const frozen=structuredClone(battle.state);battle.advance(100);
  assert.deepEqual(battle.state,frozen);
  assert.throws(()=>battle.deploy(1001,1,1),/结束/);
  assert.throws(()=>battle.remove(2,0),/结束/);
});

test('漏怪逐个扣城门耐久, 第三个漏怪立即失败并停止后续生成',()=>{
  const battle=model.createBattle(singleWave(w=>{
    w.tables.td_enemies.rows[0].speed_percent=1000;
    w.tables.td_spawns.rows[0].count=4;
    w.tables.td_spawns.rows[0].spacing_ms=1000;
  }),3001);
  battle.advance(.9);assert.equal(battle.state.gateHp,2);assert.equal(battle.state.status,'running');
  battle.advance(1);assert.equal(battle.state.gateHp,1);
  battle.advance(1);assert.equal(battle.state.gateHp,0);assert.equal(battle.state.status,'lost');assert.equal(battle.state.spawned,3);
});

test('固定步长使一次推进与多帧推进的战斗结果一致, 非法时间不改变状态',()=>{
  const parsed=config(),one=model.createBattle(parsed,3001),many=model.createBattle(parsed,3001);
  for(const battle of [one,many]){battle.deploy(1001,0,0);battle.deploy(1002,2,0);}
  one.advance(12);for(let i=0;i<120;i++)many.advance(.1);
  assert.deepEqual({...one.state,events:[]},{...many.state,events:[]});
  const before=structuredClone(one.state);
  for(const time of [-1,NaN,Infinity,'1'])assert.throws(()=>one.advance(time));
  assert.deepEqual(one.state,before);
});
