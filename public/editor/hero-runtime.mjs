// 面板和网页共用此模块. 逻辑画布固定为 256 像素, 不包含场景移动或编辑器 API.
const PARTS=['head','weapon'];
const ACTIONS=new Set(['idle','walk-left','walk-right','attack','hit']);
const STYLES=new Set(['shoot','thrust','slash','cast','strike']);
const combatDefaults=()=>({anticipation:.1,strike:.05,recovery:.15,attackStrength:1,hitStrength:1,hitStop:.05});
const transform=(dx=0,dy=0,sx=0,sy=0)=>({dx,dy,sx,sy});
const defaults=()=>({version:1,amplitude:.35,
  slots:{head:{x:146,y:108,size:184},weapon:{x:52,y:154,size:100}},
  actions:{
    walk:{duration:.5,head:transform(0,-1.8,.007,-.007),weapon:transform(.6,2)},
    attack:{duration:.7,head:transform(-.8,0,0,-.008),weapon:transform(-5,-1.2,.04,.025)},
    hit:{duration:.55,head:transform(1.8,0,-.012,.008),weapon:transform(2),recoil:3,flash:.3},
  }});

function numeric(value,min,max,label) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`${label}必须为 ${min} 到 ${max} 之间的数值`);
  return value;
}
export function normalizeHeroMotion(value) {
  if(value===undefined)return defaults();
  if(!value||typeof value!=='object'||![1,2].includes(value.version))throw new Error('英雄动作配置版本或格式无效');
  const result={version:value.version,amplitude:numeric(value.amplitude,0,1,'全局幅度'),slots:{},actions:{}};
  for(const part of PARTS) {
    const slot=value.slots?.[part];
    result.slots[part]={x:numeric(slot?.x,0,256,'挂点 X'),y:numeric(slot?.y,0,256,'挂点 Y'),size:numeric(slot?.size,1,256,'显示大小')};
  }
  for(const action of value.version===1?['walk','attack','hit']:['walk']) {
    const source=value.actions?.[action],target={duration:numeric(source?.duration,.1,5,'动作周期/时长')};
    for(const part of PARTS)target[part]=Object.fromEntries(['dx','dy','sx','sy'].map(key=>[key,numeric(source?.[part]?.[key],key[0]==='d'?-5:-.05,key[0]==='d'?5:.05,'部件位移/缩放')]));
    if(action==='hit'){target.recoil=numeric(source.recoil,0,5,'受伤后退');target.flash=numeric(source.flash,0,.3,'受伤闪烁');}
    result.actions[action]=target;
  }
  if(value.version===2) {
    const combat=value.combat;
    result.combat={anticipation:numeric(combat?.anticipation,0,.5,'蓄力时间'),strike:numeric(combat?.strike,.05,.3,'出手时间'),recovery:numeric(combat?.recovery,0,1,'收招时间'),attackStrength:numeric(combat?.attackStrength,0,2,'攻击力度'),hitStrength:numeric(combat?.hitStrength,0,2,'受击力度'),hitStop:numeric(combat?.hitStop,0,.05,'重击局部停顿')};
  }
  return result;
}
export function upgradeHeroMotion(value) {
  const current=normalizeHeroMotion(value);
  if(current.version===2)return current;
  return {version:2,amplitude:current.amplitude,slots:current.slots,actions:{walk:current.actions.walk},combat:combatDefaults()};
}

// 与战斗模型共享50ms时基. 模型注入本函数结果, 不依赖编辑器的文件路径.
export function createAttackTiming(value) {
  const config=normalizeHeroMotion(value),combat=config.version===2?config.combat:combatDefaults();
  const ticks=seconds=>Math.ceil(seconds/.05-1e-9);
  return (role,intervalSeconds,distance=0)=>{
    if(!Number.isInteger(role)||role<0||role>5)throw new Error('攻击角色无效');
    numeric(intervalSeconds,.001,60,'攻击周期');numeric(distance,0,Number.MAX_VALUE,'目标距离');
    const cycleTicks=Math.max(1,ticks(intervalSeconds));
    const releaseDelayTicks=Math.min(ticks(combat.anticipation)+ticks(combat.strike),cycleTicks-1);
    const strikeTicks=Math.min(ticks(combat.strike),releaseDelayTicks),anticipationTicks=releaseDelayTicks-strikeTicks;
    const recoveryTicks=Math.max(1,Math.min(ticks(combat.recovery),cycleTicks-releaseDelayTicks));
    const flightTicks=role===2||role===5?Math.max(1,Math.min(6,ticks(distance/(role===2?32:24)))):0;
    return {cycleTicks,releaseDelayTicks,flightTicks,anticipation:anticipationTicks/20,strike:strikeTicks/20,recovery:recoveryTicks/20,duration:(releaseDelayTicks+recoveryTicks)/20};
  };
}
export function heroMotionYaml(value) {
  const config=normalizeHeroMotion(value);
  const lines=[];
  function visit(object,depth){for(const [key,value] of Object.entries(object)){const prefix='  '.repeat(depth)+key+':';if(typeof value==='object'){lines.push(prefix);visit(value,depth+1);}else lines.push(prefix+' '+value);}}
  visit(config,0);return lines.join('\n')+'\n';
}
export function heroFiles(paths) {
  if(!Array.isArray(paths))throw new Error('英雄资源列表无效');
  return paths.filter(path=>typeof path==='string'&&/^heroes\/[^/]+\.png$/i.test(path)&&path.startsWith('heroes/')).map(path=>({id:path.slice(7,-4),path}));
}
function freeze(object){Object.values(object).filter(value=>value&&typeof value==='object').forEach(freeze);return Object.freeze(object);}

function createLegacyMotion(initial) {
  let config=freeze(normalizeHeroMotion(initial));
  let state,intent,facing,time,actionTime;
  function reset(){state=intent='idle';facing=-1;time=actionTime=0;}
  reset();
  function setConfig(value){config=freeze(normalizeHeroMotion(value));}
  function setAction(action) {
    if(!ACTIONS.has(action))throw new Error('英雄动作无效');
    if(action==='attack'||action==='hit') {
      if(action==='attack'&&state==='hit')return false;
      state=action;actionTime=0;
    }else {
      intent=action==='idle'?'idle':'walk';
      if(action!=='idle')facing=action==='walk-left'?-1:1;
      if(state!=='attack'&&state!=='hit')state=intent;
    }
    return true;
  }
  function advance(seconds) {
    numeric(seconds,0,Number.MAX_VALUE,'时间增量');time+=seconds;
    if(state==='attack'||state==='hit') {
      actionTime+=seconds;
      if(actionTime+1e-9>=config.actions[state].duration){state=intent;actionTime=0;}
    }
  }
  function snapshot() {
    const pose={parts:{head:{dx:0,dy:0,sx:1,sy:1},weapon:{dx:0,dy:0,sx:1,sy:1}},alpha:1,hurtOffset:0};
    const transient=state==='attack'||state==='hit';
    const phase=transient?Math.min(1,actionTime/config.actions[state].duration):0;
    const amplitude=config.amplitude;
    if(state!=='idle'&&amplitude>0) {
      const action=config.actions[state],step=Math.sin(time*Math.PI*2/action.duration),reach=Math.sin(phase*Math.PI);
      for(const part of PARTS) {
        const source=action[part],target=pose.parts[part];
        for(const key of ['dx','dy','sx','sy']) {
          let wave=reach;
          if(state==='walk')wave=key==='dy'?(part==='head'?Math.abs(step):Math.sin(time*Math.PI*2/action.duration+.4)):step;
          target[key]=(key[0]==='s'?1:0)+source[key]*wave*amplitude;
        }
      }
      if(state==='hit') {
        pose.hurtOffset=-facing*reach*action.recoil*amplitude;
        pose.alpha=phase<.8&&Math.floor(actionTime/.07)%2===0?1-action.flash*amplitude:1;
      }
    }
    return {state,intent,facing,time,phase,config,pose};
  }
  return {setConfig,setAction,advance,snapshot,reset};
}

const clamp=value=>Math.max(0,Math.min(1,value));
const roleForStyle={shoot:2,thrust:3,slash:4,cast:5,strike:0};
const bodyGeometry=pose=>({parts:structuredClone(pose.parts),body:{...pose.body},hurtOffset:pose.hurtOffset,recoilOffset:pose.recoilOffset});
const attackTrajectories={thrust:{back:12,forward:34,backAngle:.08,angle:-.08,lift:0},slash:{back:16,forward:28,backAngle:.75,angle:-1.05,lift:-12},shoot:{back:8,forward:4,backAngle:.08,angle:0,lift:-3},cast:{back:8,forward:17,backAngle:.25,angle:-.35,lift:-15},strike:{back:9,forward:21,backAngle:.15,angle:-.18,lift:-3}};

function createCombatMotion(initial) {
  let config=freeze(normalizeHeroMotion(initial)),timing=createAttackTiming(config);
  let state,intent,facing,time,attackAge,attackTiming,attackStyle,hit,releaseAge,releaseStyle,frozenUntil,frozenPose,deathPose,pendingFreezeAt;
  function reset(){state=intent='idle';facing=-1;time=0;attackAge=0;attackTiming=null;attackStyle='strike';hit=null;releaseAge=Infinity;releaseStyle='strike';frozenUntil=0;pendingFreezeAt=Infinity;frozenPose=deathPose=null;}
  reset();
  function setConfig(value){config=freeze(normalizeHeroMotion(value));timing=createAttackTiming(config);}
  function style(value){if(!STYLES.has(value))throw new Error('攻击动作类型无效');return value;}
  function freezePose(delay=0){if(config.amplitude===0||config.combat.hitStop<=delay)return;frozenUntil=time+config.combat.hitStop;if(delay){pendingFreezeAt=time+delay;frozenPose=null;}else{pendingFreezeAt=Infinity;frozenPose=bodyGeometry(livePose());}}
  function setAction(action,options={}) {
    if(!ACTIONS.has(action)&&!['release','impact','death'].includes(action))throw new Error('英雄动作无效');
    if(!options||typeof options!=='object')throw new Error('动作参数无效');
    if(deathPose)return false;
    if(action==='attack') {
      const nextStyle=style(options.style??'strike'),nextTiming=timing(roleForStyle[nextStyle],options.interval??1);
      state='attack';attackAge=0;attackStyle=nextStyle;attackTiming=nextTiming;
    }else if(action==='release') {
      const nextStyle=style(options.style??attackStyle);
      frozenUntil=0;pendingFreezeAt=Infinity;frozenPose=null;releaseStyle=nextStyle;releaseAge=0;
      if(state==='attack')attackAge=Math.max(attackAge,attackTiming.anticipation+attackTiming.strike);
    }else if(action==='hit') {
      const direction=options.direction??-facing;
      if(direction!==-1&&direction!==1)throw new Error('受击方向必须为 -1 或 1');
      for(const key of ['critical','heavy','armored'])if(options[key]!==undefined&&typeof options[key]!=='boolean')throw new Error('受击标记必须为布尔值');
      const from=hit||frozenPose?bodyGeometry(snapshot().pose):null;
      frozenUntil=0;pendingFreezeAt=Infinity;frozenPose=null;
      hit={age:0,direction,critical:options.critical===true,heavy:options.heavy===true,armored:options.armored===true,from};
      // 连击先用20ms从当前显示姿态接到新冲击峰值. 停顿窗口总长仍不超过50ms.
      if(hit.heavy)freezePose(from?.02:0);
    }else if(action==='impact')freezePose();
    else if(action==='death'){deathPose=bodyGeometry(livePose());frozenUntil=0;pendingFreezeAt=Infinity;frozenPose=null;state='dead';}
    else {
      intent=action==='idle'?'idle':'walk';
      if(action!=='idle')facing=action==='walk-left'?-1:1;
      if(state!=='attack')state=intent;
    }
    return true;
  }
  function advanceClocks(seconds) {
    time+=seconds;releaseAge+=seconds;
    if(hit){hit.age+=seconds;if(hit.age+1e-9>=(hit.critical?.22:.18))hit=null;}
    if(state==='attack'){attackAge+=seconds;if(attackAge+1e-9>=attackTiming.duration){state=intent;attackAge=0;}}
  }
  function advance(seconds) {
    numeric(seconds,0,Number.MAX_VALUE,'时间增量');const target=time+seconds;
    if(pendingFreezeAt<=target+1e-9){advanceClocks(Math.max(0,pendingFreezeAt-time));pendingFreezeAt=Infinity;frozenPose=bodyGeometry(livePose());}
    advanceClocks(Math.max(0,target-time));
    if(time+1e-9>=frozenUntil){frozenUntil=0;frozenPose=null;}
  }
  function livePose() {
    const pose={parts:{head:{dx:0,dy:0,sx:1,sy:1,rotation:0},weapon:{dx:0,dy:0,sx:1,sy:1,rotation:0}},alpha:1,hurtOffset:0,recoilOffset:0,body:{sx:1,sy:1},flash:0,criticalGlow:0};
    const amplitude=config.amplitude;if(amplitude===0)return pose;
    if(state==='walk') {
      const action=config.actions.walk,step=Math.sin(time*Math.PI*2/action.duration);
      for(const part of PARTS)for(const key of ['dx','dy','sx','sy']){const wave=key==='dy'?(part==='head'?Math.abs(step):Math.sin(time*Math.PI*2/action.duration+.4)):step;pose.parts[part][key]=(key[0]==='s'?1:0)+action[part][key]*wave*amplitude;}
    }
    const attackScale=amplitude/.35*config.combat.attackStrength,hitScale=amplitude/.35*config.combat.hitStrength;
    if(state==='attack') {
      const {anticipation,strike,recovery}=attackTiming,release=anticipation+strike;
      let windup=0,reach=0;
      if(attackAge<anticipation)windup=clamp(attackAge/anticipation);
      else if(attackAge<release){const p=clamp((attackAge-anticipation)/strike);windup=1-p*p;reach=p*p;}
      else reach=recovery>0?(1-clamp((attackAge-release)/recovery))**2:0;
      const profile=attackTrajectories[attackStyle],weapon=pose.parts.weapon,head=pose.parts.head;
      weapon.dx=(profile.back*windup-profile.forward*reach)*attackScale;weapon.dy=profile.lift*reach*attackScale;
      weapon.rotation=(profile.backAngle*windup+profile.angle*reach)*attackScale;
      head.dx=(3*windup-5*reach)*attackScale;head.dy=-2*reach*attackScale;head.rotation=-.035*reach*attackScale;
      if(attackStyle==='shoot')weapon.sx-=.06*windup*attackScale;
    }
    if(releaseAge<.12&&(releaseStyle==='shoot'||releaseStyle==='cast')) {
      const p=releaseAge/.12,envelope=(1-p)**2,kick=(releaseStyle==='shoot'?3:1.5)*256/102*attackScale*envelope;
      pose.recoilOffset=-facing*kick*.5;pose.parts.weapon.dx+=kick*.5;
    }
    if(hit) {
      const duration=hit.critical?.22:.18,hold=Math.max(hit.from?.02:0,hit.heavy?Math.min(config.combat.hitStop,duration/2):0);
      const p=clamp((hit.age-hold)/(duration-hold));
      const envelope=p<.7?(1-p/.7)**2:-.06*Math.sin((p-.7)/.3*Math.PI);
      pose.hurtOffset=hit.direction*(hit.critical?9:5)*256/102*(hit.armored?.5:1)*hitScale*envelope;
      pose.body.sx=Math.max(.5,1-(hit.critical?.14:.08)*hitScale*envelope);pose.body.sy=1+(hit.critical?.10:.06)*hitScale*envelope;
      if(hit.from&&hit.age<.02){const blend=clamp(hit.age/.02);pose.hurtOffset=hit.from.hurtOffset+(pose.hurtOffset-hit.from.hurtOffset)*blend;for(const key of ['sx','sy'])pose.body[key]=hit.from.body[key]+(pose.body[key]-hit.from.body[key])*blend;}
      pose.flash=clamp((hit.critical?1:.7)*hitScale*(1-clamp(hit.age/(hit.critical?.09:.06))));
      pose.criticalGlow=hit.critical?clamp(hitScale*(1-hit.age/.22)):0;
    }
    return pose;
  }
  function snapshot() {
    const pose=livePose(),frozen=Boolean(frozenPose&&time<frozenUntil);
    if(config.amplitude>0&&(deathPose||frozen))Object.assign(pose,structuredClone(deathPose||frozenPose));
    return {state,intent,facing,time,phase:state==='attack'?clamp(attackAge/attackTiming.duration):0,config,pose,attackStyle,hit:{active:!!hit,critical:hit?.critical??false,heavy:hit?.heavy??false,armored:hit?.armored??false,age:hit?.age??0},frozen};
  }
  return {setConfig,setAction,advance,snapshot,reset};
}

// 版本切换只发生于显式配置更新, 保留旧接口以便所有调用方共用一个入口.
export function createHeroMotion(initial) {
  const create=value=>value.version===1?createLegacyMotion(value):createCombatMotion(value);
  let motion=create(normalizeHeroMotion(initial));
  return {setAction:(...args)=>motion.setAction(...args),advance:seconds=>motion.advance(seconds),snapshot:()=>motion.snapshot(),reset:()=>motion.reset(),
    setConfig(value){const next=normalizeHeroMotion(value);if(next.version!==motion.snapshot().config.version)motion=create(next);else motion.setConfig(next);}};
}

const whiteMasks=new WeakMap();
function whiteMask(image) {
  if(whiteMasks.has(image))return whiteMasks.get(image);
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  const mask=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):document.createElement('canvas');mask.width=width;mask.height=height;
  const context=mask.getContext('2d');context.drawImage(image,0,0);context.globalCompositeOperation='source-in';context.fillStyle='#fff';context.fillRect(0,0,width,height);whiteMasks.set(image,mask);return mask;
}

// 调用方负责清理画布和场景坐标变换, 此函数只绘制固定挂点及局部动作.
export function drawHero(context,images,snapshot,{reference=false}={}) {
  if(!context||!images||!snapshot?.config||!snapshot.pose)throw new Error('英雄绘制参数无效');
  context.save();
  context.translate(reference?0:snapshot.pose.hurtOffset+(snapshot.pose.recoilOffset||0),0);
  if(!reference&&snapshot.pose.body){context.translate(128,128);context.scale(snapshot.pose.body.sx,snapshot.pose.body.sy);context.translate(-128,-128);}
  if(snapshot.facing===1){context.translate(256,0);context.scale(-1,1);}
  context.globalAlpha*=reference?1:snapshot.pose.alpha;
  for(const part of PARTS) {
    if(!images[part])continue;
    const slot=snapshot.config.slots[part],pose=reference?{dx:0,dy:0,sx:1,sy:1}:snapshot.pose.parts[part];
    context.save();context.translate(slot.x+pose.dx,slot.y+pose.dy);if(pose.rotation)context.rotate(pose.rotation);context.scale(pose.sx,pose.sy);
    if(!reference&&snapshot.pose.criticalGlow){context.shadowColor='#ffac32';context.shadowBlur=12*snapshot.pose.criticalGlow;}
    context.drawImage(images[part],-slot.size/2,-slot.size/2,slot.size,slot.size);
    if(!reference&&snapshot.pose.flash){context.shadowBlur=0;context.globalAlpha*=snapshot.pose.flash;context.drawImage(whiteMask(images[part]),-slot.size/2,-slot.size/2,slot.size,slot.size);}
    context.restore();
  }
  context.restore();
}
