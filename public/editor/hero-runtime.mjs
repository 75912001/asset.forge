// 面板和网页共用此模块. 逻辑画布固定为 256 像素, 不包含场景移动或编辑器 API.
const PARTS=['head','weapon'];
const ACTIONS=new Set(['idle','walk-left','walk-right','attack','hit']);
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
  if(!value||typeof value!=='object'||value.version!==1)throw new Error('英雄动作配置版本或格式无效');
  const result={version:1,amplitude:numeric(value.amplitude,0,1,'全局幅度'),slots:{},actions:{}};
  for(const part of PARTS) {
    const slot=value.slots?.[part];
    result.slots[part]={x:numeric(slot?.x,0,256,'挂点 X'),y:numeric(slot?.y,0,256,'挂点 Y'),size:numeric(slot?.size,1,256,'显示大小')};
  }
  for(const action of ['walk','attack','hit']) {
    const source=value.actions?.[action],target={duration:numeric(source?.duration,.1,5,'动作周期/时长')};
    for(const part of PARTS)target[part]=Object.fromEntries(['dx','dy','sx','sy'].map(key=>[key,numeric(source?.[part]?.[key],key[0]==='d'?-5:-.05,key[0]==='d'?5:.05,'部件位移/缩放')]));
    if(action==='hit'){target.recoil=numeric(source.recoil,0,5,'受伤后退');target.flash=numeric(source.flash,0,.3,'受伤闪烁');}
    result.actions[action]=target;
  }
  return result;
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

export function createHeroMotion(initial) {
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

// 调用方负责清理画布和场景坐标变换, 此函数只绘制固定挂点及局部动作.
export function drawHero(context,images,snapshot,{reference=false}={}) {
  if(!context||!images||!snapshot?.config||!snapshot.pose)throw new Error('英雄绘制参数无效');
  context.save();
  context.translate(reference?0:snapshot.pose.hurtOffset,0);
  if(snapshot.facing===1){context.translate(256,0);context.scale(-1,1);}
  context.globalAlpha*=reference?1:snapshot.pose.alpha;
  for(const part of PARTS) {
    if(!images[part])continue;
    const slot=snapshot.config.slots[part],pose=reference?{dx:0,dy:0,sx:1,sy:1}:snapshot.pose.parts[part];
    context.save();context.translate(slot.x+pose.dx,slot.y+pose.dy);context.scale(pose.sx,pose.sy);
    context.drawImage(images[part],-slot.size/2,-slot.size/2,slot.size,slot.size);context.restore();
  }
  context.restore();
}
