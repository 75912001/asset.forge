// 战斗以格子和秒为内部单位. 编辑器保存整数毫秒/百分格, 在配置边界统一转换.
const STEP=.05,CONTACT=.45,EPSILON=1e-8;
export const BOARD={rows:5,cols:8};
const integer=(value,min,max,label)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${label}必须是 ${min}-${max} 的整数`);
  return value;
};
const text=(value,label)=>{
  if(typeof value!=='string'||!value.trim())throw new Error(`${label}不能为空`);
  return value.trim();
};
function image(value,label,optional=false) {
  if(optional&&(value===''||value===null||value===undefined))return '';
  // 与编辑器 PNG 引用规则一致, URL 转义由资源加载边界负责.
  if(typeof value!=='string'||value.length>2048||!value.toLowerCase().endsWith('.png')||/[\\:*?"<>|\x00-\x1f]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error(`${label}必须是项目内的 PNG 相对路径`);
  return value;
}
function rows(workspace,key,label) {
  const input=workspace?.tables?.[key]?.rows;
  if(!Array.isArray(input)||!input.length)throw new Error(`${label}缺少数据`);
  const seen=new Set();
  return input.map(row=>{
    if(!row||typeof row!=='object')throw new Error(`${label}记录无效`);
    const id=integer(row.id,1,4294967295,`${label} ID`);
    if(seen.has(id))throw new Error(`${label} ID ${id} 重复`);
    seen.add(id);return {...row,id};
  });
}
export function parseGameConfig(workspace) {
  const units=rows(workspace,'td_units','防守单位').map(row=>{
    const role=integer(row.role,1,5,`${row.id} 角色`),producer=role===1;
    return {...row,role,name:text(row.name,'单位名称'),icon:image(row.icon,'单位图标'),weapon:image(row.weapon,'武器',true),
      cost:integer(row.cost,1,100000,'部署费用'),hp:integer(row.hp,1,1000000,'单位生命'),
      damage:integer(row.damage,producer?0:1,100000,'单位伤害'),
      interval:integer(row.interval_ms,producer?0:50,60000,'攻击间隔')/1000,
      range:integer(row.range_percent,producer?0:45,800,'攻击范围')/100,
      slow_factor:integer(row.slow_percent,role===5?1:0,role===5?99:100,'减速后速度')/100,
      slow_duration:integer(row.slow_duration_ms,role===5?50:0,60000,'减速时长')/1000,
      production:integer(row.production,producer?1:0,100000,'灵气产量'),
      production_interval:integer(row.production_interval_ms,producer?50:0,60000,'生产间隔')/1000,
      unlock_level:integer(row.unlock_level,0,4294967295,'解锁关卡'),
      crit_chance_percent:integer(row.crit_chance_percent??0,0,100,'暴击概率'),
    };
  });
  const enemies=rows(workspace,'td_enemies','敌人').map(row=>({...row,name:text(row.name,'敌人名称'),icon:image(row.icon,'敌人图标'),
    hp:integer(row.hp,1,1000000,'敌人生命'),damage:integer(row.damage,1,100000,'敌人伤害'),
    interval:integer(row.interval_ms,50,60000,'敌人攻击间隔')/1000,speed:integer(row.speed_percent,1,1000,'敌人移动速度')/100,
  }));
  const levels=rows(workspace,'td_levels','关卡').map(row=>({...row,name:text(row.name,'关卡名称'),description:text(row.description,'关卡说明'),
    duration:integer(row.duration_ms,1000,900000,'关卡预计时长')/1000,
    starting_energy:integer(row.starting_energy,1,100000,'初始灵气'),energy_per_second:integer(row.energy_per_second,1,1000,'自然灵气恢复'),
  })).sort((a,b)=>a.id-b.id);
  const levelIds=new Set(levels.map(level=>level.id)),enemyIds=new Set(enemies.map(enemy=>enemy.id));
  for(const unit of units)if(unit.unlock_level&&!levelIds.has(unit.unlock_level))throw new Error(`${unit.name} 的解锁关卡不存在`);
  if(!units.some(unit=>unit.role!==1&&unit.unlock_level===0))throw new Error('首关至少需要一名初始可用的攻击英雄');
  const spawns=rows(workspace,'td_spawns','出兵波次').map(row=>{
    if(!levelIds.has(row.level_id)||!enemyIds.has(row.enemy_id))throw new Error(`波次 ${row.id} 引用了不存在的关卡或敌人`);
    const entry={...row,lane:integer(row.lane,0,4,'出兵路线'),count:integer(row.count,1,100,'出兵数量'),
      time:integer(row.time_ms,0,900000,'出兵时间')/1000,spacing:integer(row.spacing_ms,0,60000,'出兵间隔')/1000};
    if(entry.time+(entry.count-1)*entry.spacing>levels.find(level=>level.id===entry.level_id).duration)throw new Error(`波次 ${row.id} 超过关卡预计时长`);
    return entry;
  }).sort((a,b)=>a.time-b.time||a.id-b.id);
  for(const level of levels) {
    const total=spawns.filter(spawn=>spawn.level_id===level.id).reduce((sum,spawn)=>sum+spawn.count,0);
    if(total<1||total>1000)throw new Error(`${level.name} 的敌人数必须在 1-1000 之间`);
  }
  return {units,enemies,levels,spawns};
}

function completed(config,values) {
  if(!Array.isArray(values)||values.some(value=>!Number.isSafeInteger(value)||!config.levels.some(level=>level.id===value)))throw new Error('通关记录包含无效关卡');
  const result=new Set(values);
  // 解锁必须按章节顺序推进, 畸形存档不能跳过前置关卡.
  for(let i=1;i<config.levels.length;i++)if(result.has(config.levels[i].id)&&!result.has(config.levels[i-1].id))throw new Error('通关记录缺少前置关卡');
  return result;
}
export function availableLevels(config,completedLevels=[]) {
  const done=completed(config,completedLevels);
  return config.levels.filter((level,index)=>index===0||done.has(config.levels[index-1].id));
}
export function availableUnits(config,completedLevels=[]) {
  const done=completed(config,completedLevels);
  return config.units.filter(unit=>!unit.unlock_level||done.has(unit.unlock_level));
}

export function createBattle(config,levelId,completedLevels=[],{timing,random=Math.random}={}) {
  if(timing!==undefined&&typeof timing!=='function'||typeof random!=='function')throw new Error('攻击时序与随机来源必须是函数');
  const level=config.levels.find(item=>item.id===levelId);
  if(!level)throw new Error('关卡不存在');
  if(!availableLevels(config,completedLevels).some(item=>item.id===levelId))throw new Error('关卡尚未解锁');
  const unitTypes=new Map(config.units.map(unit=>[unit.id,unit])),enemyTypes=new Map(config.enemies.map(enemy=>[enemy.id,enemy]));
  const unlocked=new Set(availableUnits(config,completedLevels).map(unit=>unit.id));
  const schedule=config.spawns.filter(spawn=>spawn.level_id===levelId).flatMap(spawn=>Array.from({length:spawn.count},(_,index)=>({time:spawn.time+index*spawn.spacing,lane:spawn.lane,enemyId:spawn.enemy_id}))).sort((a,b)=>a.time-b.time);
  const state={levelId,elapsed:0,energy:level.starting_energy,gateHp:3,status:'running',units:[],enemies:[],events:[],spawned:0,totalSpawns:schedule.length};
  // 时序由共享动作运行时注入. 省略时只保留旧调用的即时出手, 不复制 v2 动作公式.
  const resolveTiming=timing||((role,interval)=>({cycleTicks:Math.max(1,Math.ceil(interval/STEP)),releaseDelayTicks:0,flightTicks:0}));
  const windups=new Map();let projectiles=[];
  let nextId=1,nextAttackId=1,ticks=0,remainder=0;
  const styles={0:'strike',2:'shoot',3:'thrust',4:'slash',5:'cast'};
  const definition=entity=>entity.enemyId===undefined?unitTypes.get(entity.unitId):enemyTypes.get(entity.enemyId);
  const entityById=id=>state.units.find(entity=>entity.id===id)||state.enemies.find(entity=>entity.id===id);
  function snapshot(entity) {
    const type=definition(entity),isEnemy=entity.enemyId!==undefined,role=isEnemy?0:type.role;
    return Object.freeze({...entity,isEnemy,role,style:styles[role]||'',name:type.name,icon:type.icon,weapon:type.weapon||''});
  }
  function attackTiming(role,interval,distance=0) {
    const value=resolveTiming(role,interval,distance);
    const cycleTicks=integer(value?.cycleTicks,1,1200,'攻击周期步数');
    return {cycleTicks,releaseDelayTicks:integer(value?.releaseDelayTicks,0,cycleTicks-1,'出手延迟步数'),flightTicks:integer(value?.flightTicks,0,1200,'飞行步数')};
  }
  function emit(type,data) {state.events.push({type,time:state.elapsed,attackId:null,...data});}
  const ensureRunning=()=>{if(state.status!=='running')throw new Error('战斗已经结束');};
  function position(lane,col) {integer(lane,0,4,'路线');integer(col,0,7,'格子');}
  function deploy(unitId,lane,col) {
    ensureRunning();position(lane,col);
    const type=unitTypes.get(unitId);
    if(!type)throw new Error('防守单位不存在');
    if(!unlocked.has(unitId))throw new Error('英雄尚未解锁');
    if(state.units.some(unit=>unit.lane===lane&&unit.col===col))throw new Error('这个格子已有单位');
    if(state.energy+EPSILON<type.cost)throw new Error('灵气不足');
    const unit={id:nextId++,unitId,lane,col,x:col+.5,hp:type.hp,maxHp:type.hp,nextAttackTick:ticks,nextAttackAt:state.elapsed,nextProductionAt:state.elapsed+type.production_interval,lastAttackAt:-1,lastHitAt:-1};
    state.energy-=type.cost;state.units.push(unit);return unit;
  }
  function remove(lane,col) {
    ensureRunning();position(lane,col);
    const index=state.units.findIndex(unit=>unit.lane===lane&&unit.col===col);
    if(index===-1)throw new Error('这个格子没有可撤除的单位');
    const removed=state.units.splice(index,1)[0];windups.delete(removed.id);
    return removed;
  }
  function attackEvent(attack,source,target,extra={}) {
    return {attackId:attack.id,sourceId:source.id,targetId:target.id,targetIds:[target.id],source,target,
      // 弹体离手后目标可能越过原起点. 同点命中固定向右, 不依赖阵营或显示朝向.
      role:attack.role,style:styles[attack.role],direction:Math.sign(target.x-source.x)||1,lane:source.lane,x:source.x,
      fromX:source.x,toX:target.x,interval:attack.interval,releaseAt:attack.releaseTick*STEP,impactAt:null,flightDuration:0,critical:false,...extra};
  }
  function hurt(target,shot) {
    const amount=shot.damage;
    target.hp=Math.max(0,target.hp-amount);target.lastHitAt=state.elapsed;
    if(shot.role===5&&target.hp>0){target.slowFactor=shot.slowFactor;target.slowUntil=state.elapsed+shot.slowDuration;}
    const targetSnapshot=snapshot(target);
    const event=attackEvent(shot,shot.source,targetSnapshot,{targetIds:shot.targetIds,amount,critical:shot.critical,
      lane:target.lane,x:target.x,impactAt:shot.impactTick*STEP,flightDuration:shot.flightDuration});
    emit('hit',event);
    if(target.hp===0)emit('death',event);
  }
  function targetsFor(source,contacts) {
    if(source.enemyId!==undefined) {
      const blocker=contacts.get(source.id);
      return blocker?.hp>0?[blocker]:[];
    }
    const type=unitTypes.get(source.unitId);
    return state.enemies.filter(enemy=>enemy.hp>0&&enemy.lane===source.lane&&enemy.x>=source.x&&enemy.x-source.x<=type.range+EPSILON).sort((a,b)=>a.x-b.x||a.id-b.id);
  }
  function tick() {
    state.elapsed=++ticks*STEP;
    state.energy=Math.round((state.energy+level.energy_per_second*STEP)*1e8)/1e8;
    while(state.spawned<schedule.length&&schedule[state.spawned].time<=state.elapsed+EPSILON) {
      const entry=schedule[state.spawned++],type=enemyTypes.get(entry.enemyId);
      const enemy={id:nextId++,enemyId:entry.enemyId,lane:entry.lane,x:8.4,hp:type.hp,maxHp:type.hp,moving:true,nextAttackTick:ticks,nextAttackAt:state.elapsed,slowUntil:0,slowFactor:1,lastAttackAt:-1,lastHitAt:-1};
      state.enemies.push(enemy);emit('spawn',{targetId:enemy.id,target:snapshot(enemy),lane:enemy.lane,x:enemy.x});
    }
    for(const unit of state.units) {
      if(unit.hp<=0)continue;
      const type=unitTypes.get(unit.unitId);
      if(type.role===1) {
        if(state.elapsed+EPSILON>=unit.nextProductionAt) {
          state.energy+=type.production;unit.nextProductionAt+=type.production_interval;
          emit('produce',{sourceId:unit.id,source:snapshot(unit),amount:type.production,lane:unit.lane,x:unit.x});
        }
      }
    }
    const contacts=new Map();
    for(const enemy of state.enemies) {
      const type=enemyTypes.get(enemy.enemyId);
      const factor=state.elapsed<enemy.slowUntil?enemy.slowFactor:1;
      const nextX=enemy.x-type.speed*factor*STEP;
      // 先找沿途最靠右的防守单位, 再截断移动, 大时间步也不能穿过前排.
      const blocker=state.units.filter(unit=>unit.hp>0&&unit.lane===enemy.lane&&unit.x<=enemy.x&&unit.x+CONTACT>=nextX).sort((a,b)=>b.x-a.x)[0];
      if(blocker) {
        enemy.x=Math.min(enemy.x,blocker.x+CONTACT);enemy.moving=false;contacts.set(enemy.id,blocker);
      } else {enemy.x=nextX;enemy.moving=true;}
    }
    // 同一 tick 先收集全部起手与出手, 再按攻击编号结算. 同时出手的双方可以互相命中.
    for(const source of [...state.units,...state.enemies].sort((a,b)=>a.id-b.id)) {
      const type=definition(source),role=source.enemyId===undefined?type.role:0;
      if(role===1||ticks<source.nextAttackTick||windups.has(source.id))continue;
      const targets=targetsFor(source,contacts);if(!targets.length)continue;
      const schedule=attackTiming(role,type.interval);
      const attack={id:nextAttackId++,sourceId:source.id,targetId:targets[0].id,role,interval:type.interval,releaseTick:ticks+schedule.releaseDelayTicks};
      source.nextAttackTick=ticks+schedule.cycleTicks;source.nextAttackAt=source.nextAttackTick*STEP;source.lastAttackAt=state.elapsed;
      windups.set(source.id,attack);
      emit('attack',attackEvent(attack,snapshot(source),snapshot(targets[0])));
    }
    for(const attack of [...windups.values()].sort((a,b)=>a.id-b.id)) {
      if(attack.releaseTick>ticks)continue;
      windups.delete(attack.sourceId);
      const source=entityById(attack.sourceId);if(!source||source.hp<=0)continue;
      const eligible=targetsFor(source,contacts);
      const targets=attack.role===4?eligible:eligible.filter(target=>target.id===attack.targetId);
      if(!targets.length)continue;
      const type=definition(source),sourceSnapshot=snapshot(source),targetSnapshot=snapshot(targets[0]);
      const flight=attackTiming(attack.role,type.interval,Math.abs(targets[0].x-source.x)).flightTicks;
      let critical=false;
      if(!sourceSnapshot.isEnemy) {
        const roll=random();if(typeof roll!=='number'||!Number.isFinite(roll)||roll<0||roll>=1)throw new Error('随机来源必须返回 0 到 1 之间的数值, 不包含 1');
        critical=roll<type.crit_chance_percent/100;
      }
      const shot={...attack,source:sourceSnapshot,targetIds:targets.map(target=>target.id),damage:type.damage*(critical?2:1),critical,
        slowFactor:type.slow_factor,slowDuration:type.slow_duration,impactTick:ticks+flight,flightDuration:flight*STEP};
      projectiles.push(shot);
      emit('release',attackEvent(attack,sourceSnapshot,targetSnapshot,{targetIds:shot.targetIds,amount:shot.damage,critical,impactAt:shot.impactTick*STEP,flightDuration:shot.flightDuration}));
    }
    for(const shot of projectiles.filter(shot=>shot.impactTick<=ticks).sort((a,b)=>a.id-b.id)) {
      for(const targetId of shot.targetIds) {
        const target=entityById(targetId);
        if(target?.hp>0)hurt(target,shot);
      }
    }
    for(const enemy of state.enemies) {
      if(enemy.hp>0&&enemy.x<0) {
        enemy.hp=0;state.gateHp--;
        emit('leak',{enemyId:enemy.id,targetId:enemy.id,target:snapshot(enemy),lane:enemy.lane,x:enemy.x});
        if(state.gateHp===0){state.status='lost';break;}
      }
    }
    state.units=state.units.filter(unit=>unit.hp>0);state.enemies=state.enemies.filter(enemy=>enemy.hp>0);
    // 已离手的攻击不依赖来源存活. 目标死亡/漏怪后立即失效, 不换目标也不拖延胜利.
    projectiles=projectiles.filter(shot=>shot.impactTick>ticks&&shot.targetIds.some(id=>entityById(id)?.hp>0));
    for(const [sourceId,attack] of windups)if(!entityById(sourceId)||attack.role!==4&&!entityById(attack.targetId))windups.delete(sourceId);
    if(state.status==='running'&&state.spawned===schedule.length&&!state.enemies.length)state.status='won';
    if(state.status!=='running'){windups.clear();projectiles=[];}
  }
  function advance(seconds) {
    if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>3600)throw new Error('推进时间必须是 0-3600 秒的有限数值');
    if(state.status!=='running')return [];
    state.events=[];remainder+=seconds;
    while(remainder+EPSILON>=STEP&&state.status==='running'){tick();remainder-=STEP;}
    return state.events;
  }
  return {state,deploy,remove,advance};
}
