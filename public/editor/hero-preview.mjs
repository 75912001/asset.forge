import {createHeroMotion,createAttackTiming,normalizeHeroMotion} from './hero-runtime.mjs';

const roles={shoot:2,thrust:3,slash:4,cast:5,strike:0};

// 两个预览入口共用事件时序. 游戏仍由战斗模型提供真实攻击/释放/命中事件.
export function createHeroPreview(initial) {
  let config=normalizeHeroMotion(initial),elapsed=0,events=[];
  const motion=createHeroMotion(config);
  function setAction(action,{style='thrust',critical=false,...options}={}) {
    elapsed=0;events=[];
    if(config.version===1)return motion.setAction(action);
    if(action==='attack'||action==='combo') {
      const interval=options.interval??1,timing=createAttackTiming(config)(roles[style],interval);
      motion.setAction('attack',{style,interval});
      if(action==='combo')events.push({at:Math.min(.08,timing.releaseDelayTicks*.025),action:'hit',options:{direction:-motion.snapshot().facing,critical,heavy:critical}});
      events.push({at:timing.releaseDelayTicks*.05,action:'release',options:{style}});
      advance(0);return true;
    }
    return motion.setAction(action,action==='hit'?{...options,direction:options.direction??-motion.snapshot().facing,critical,heavy:critical}:{...options,style});
  }
  function advance(seconds) {
    if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw new Error('预览时间增量无效');
    const target=elapsed+seconds;
    while(events.length&&events[0].at<=target+1e-9) {
      const event=events.shift();motion.advance(Math.max(0,event.at-elapsed));elapsed=event.at;motion.setAction(event.action,event.options);
    }
    motion.advance(Math.max(0,target-elapsed));elapsed=target;
  }
  return {setAction,advance,snapshot:()=>motion.snapshot(),reset(){events=[];elapsed=0;motion.reset();},setConfig(value){config=normalizeHeroMotion(value);motion.setConfig(config);events=[];elapsed=0;}};
}
