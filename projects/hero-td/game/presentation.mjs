// 模型只负责结算. 本模块按事件时间播放动作, 保留已死亡实体直到视觉收尾结束.
export function createBattlePresentation({runtime,heroMotion,config,onSound=()=>{},onBattleEnd=()=>{}}) {
  const motionConfig=runtime.normalizeHeroMotion(heroMotion),entities=new Map(),effects=[];
  const units=new Map(config.units.map(unit=>[unit.id,unit]));
  const producerConfig=structuredClone(motionConfig);
  // 法阵是独立图标, 使用居中布局, 受击公式仍由同一个运行时计算.
  producerConfig.slots.head={x:128,y:128,size:76*256/102};
  let time=0,finishAt=null;
  function ensure(entity) {
    if(!entity)return null;
    let entry=entities.get(entity.id);
    if(!entry) {
      const producer=!entity.isEnemy&&units.get(entity.unitId)?.role===1;
      const motion=runtime.createHeroMotion(producer?producerConfig:motionConfig);
      if(entity.isEnemy)motion.setAction('walk-left');
      else if(!producer){motion.setAction('walk-right');motion.setAction('idle');}
      entry={entity:{...entity},motion,deadAt:null,deathDirection:0,damageIndex:0};entities.set(entity.id,entry);
    }
    return entry;
  }
  function advanceMotions(seconds) {
    if(seconds<=0)return;
    for(const entry of entities.values())entry.motion.advance(seconds);
  }
  function effect(event,type,duration,extra={}) {effects.push({...event,...extra,type,time:event.time,duration});}
  function consume(event) {
    const source=ensure(event.source),target=ensure(event.target);
    if(event.type==='attack'&&source)source.motion.setAction('attack',{style:event.style,interval:event.interval});
    else if(event.type==='release') {
      source?.motion.setAction('release',{style:event.style});
      if(event.flightDuration>0)effect(event,'projectile',event.flightDuration);
      else effect(event,'slash',.16);
      onSound(event);
    } else if(event.type==='hit'&&target) {
      target.entity={...event.target};
      const armored=event.target.isEnemy&&event.target.enemyId===2003;
      const heavy=event.role===4||event.critical;
      target.motion.setAction('hit',{direction:event.direction,critical:event.critical,heavy,armored});
      if(heavy&&source&&source.deadAt===null)source.motion.setAction('impact');
      for(let i=effects.length-1;i>=0;i--)if(effects[i].type==='projectile'&&effects[i].attackId===event.attackId)effects.splice(i,1);
      effect(event,'hit',event.critical?.22:.16,{armored});
      effect(event,'damage',event.critical?.75:.55,{offset:target.damageIndex++%2?10:-10});
      onSound({...event,armored});
    } else if(event.type==='death'&&target) {
      target.entity={...event.target};target.deadAt=event.time;target.deathDirection=event.direction;
      target.motion.setAction('death');onSound(event);
    } else if(event.type==='produce'&&source) {
      effect(event,'produce',.8,{x:event.source.x,lane:event.source.lane,amount:units.get(event.source.unitId).production});
    } else if(event.type==='leak')effect(event,'leak',.5);
  }
  function sync(state) {
    const alive=new Set();
    for(const [list,isEnemy] of [[state.units,false],[state.enemies,true]])for(const entity of list) {
      alive.add(entity.id);
      const entry=ensure({...entity,isEnemy});
      if(isEnemy)entry.motion.setAction(entity.moving===false?'idle':'walk-left');
      entry.entity={...entity,isEnemy};
    }
    for(const [id,entry] of entities)if(!alive.has(id)&&entry.deadAt===null)entities.delete(id);
  }
  function advance(seconds,state,events=[]) {
    if(!Number.isFinite(seconds)||seconds<0)throw new Error('表现推进时间必须是非负有限数值');
    const nextTime=time+seconds;
    let cursor=time;
    // 一帧可收到多个模拟步的事件, 必须依次补齐动作时间, 不能统一标记为帧末.
    for(const event of events) {
      if(!Number.isFinite(event.time)||event.time<time-1e-8||event.time>nextTime+1e-8)throw new Error('战斗事件时间超出当前表现帧');
      const at=Math.max(cursor,event.time);
      advanceMotions(at-cursor);cursor=at;consume(event);
    }
    advanceMotions(nextTime-cursor);time=nextTime;sync(state);
    if(state.status!=='running'&&finishAt===null){finishAt=Number.isFinite(state.elapsed)?state.elapsed:time;onBattleEnd(state);}
    for(let i=effects.length-1;i>=0;i--)if(time-effects[i].time>=effects[i].duration-1e-8)effects.splice(i,1);
    for(const [id,entry] of entities)if(entry.deadAt!==null&&time-entry.deadAt>=.25-1e-8)entities.delete(id);
    if(finishAt!==null&&time-finishAt>=.75-1e-8) {
      effects.length=0;
      for(const [id,entry] of entities)if(entry.deadAt!==null)entities.delete(id);
    }
  }
  return {entities,effects,advance,get time(){return time;},get settled(){return finishAt!==null&&!effects.length&&![...entities.values()].some(entry=>entry.deadAt!==null);}};
}
