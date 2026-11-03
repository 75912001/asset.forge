const RELEASE_SOUNDS={
  shoot:{wave:'triangle',from:720,to:240,duration:.06,peak:.022},
  thrust:{wave:'triangle',from:180,to:80,duration:.06,peak:.025},
  slash:{wave:'sawtooth',from:360,to:110,duration:.08,peak:.018},
  cast:{wave:'sine',from:540,to:1080,duration:.12,peak:.025},
  strike:{wave:'triangle',from:130,to:60,duration:.07,peak:.03},
};
const HIT_SOUNDS={
  normal:{wave:'triangle',from:190,to:65,duration:.075,peak:.035},
  armored:{wave:'square',from:1100,to:320,duration:.09,peak:.022},
  critical:{wave:'sawtooth',from:700,to:130,duration:.14,peak:.04},
};
const DEATH_SOUND={wave:'sine',from:180,to:45,duration:.18,peak:.028};

function browserAudioContext() {
  const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Context)throw new Error('当前浏览器不支持 Web Audio');
  return new Context();
}

export function createBattleAudio(projectId,{onWarning=()=>{},createContext=browserAudioContext,storage}={}) {
  if(typeof projectId!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(projectId))throw new Error('音效项目标识无效');
  if(typeof onWarning!=='function'||typeof createContext!=='function')throw new Error('音效初始化参数无效');
  const key='asset-forge-game-audio:'+projectId+':v1',voices=new Set(),lastPlayed=new Map(),warnings=new Set();
  let enabled=true,context=null;
  function warn(message){if(warnings.has(message))return;warnings.add(message);onWarning(message);}
  try {
    if(storage===undefined)storage=globalThis.localStorage;
    const raw=storage.getItem(key);
    if(raw!==null){const saved=JSON.parse(raw);if(typeof saved?.enabled!=='boolean')throw new Error('开关格式无效');enabled=saved.enabled;}
  } catch(error){warn('音效偏好读取失败, 本次使用默认设置: '+error.message);}

  function release(voice,cut=false) {
    voices.delete(voice);
    if(voice.source) {
      voice.source.onended=null;
      if(cut&&voice.started)try{voice.source.stop(context.currentTime);}catch(error){warn('音效停止失败: '+error.message);}
      voice.source.disconnect();
    }
    voice.gain?.disconnect();
  }
  function stop() {
    for(const voice of voices)release(voice,true);
    lastPlayed.clear();
  }
  function setEnabled(value) {
    if(typeof value!=='boolean')throw new Error('音效开关必须是布尔值');
    enabled=value;if(!enabled)stop();
    try{storage.setItem(key,JSON.stringify({enabled}));}
    catch(error){warn('音效偏好保存失败, 当前开关仍然有效: '+error.message);}
    return enabled;
  }
  async function enableFromGesture() {
    if(!enabled)return false;
    try {
      // 仅在点击处理函数内创建或恢复声卡, 避免浏览器自动播放限制.
      if(!context||context.state==='closed'){stop();context=createContext();}
      if(context.state!=='running')await context.resume();
      if(context.state!=='running')throw new Error('浏览器尚未允许播放, 请再次点击音效开关');
      return enabled;
    } catch(error){warn('音效无法启用: '+error.message);return false;}
  }
  function play(event) {
    if(!enabled||context?.state!=='running'||!event||typeof event!=='object')return false;
    let sound,kind;
    if(event.type==='release') {
      const style=event.style??'strike';
      if(typeof style!=='string'||!Object.hasOwn(RELEASE_SOUNDS,style))return false;
      sound=RELEASE_SOUNDS[style];kind='release:'+style;
    }
    else if(event.type==='hit'){const impact=event.critical===true?'critical':event.armored===true?'armored':'normal';sound=HIT_SOUNDS[impact];kind='hit:'+impact;}
    else if(event.type==='death'){sound=DEATH_SOUND;kind='death';}
    if(!sound)return false;
    const now=context.currentTime;
    if(now-(lastPlayed.get(kind)??-Infinity)<.05)return false;
    for(const voice of voices)if(voice.end<=now)release(voice);
    if(voices.size>=8)return false;
    const voice={source:null,gain:null,started:false,end:now+sound.duration+.005};
    try {
      voice.source=context.createOscillator();voice.gain=context.createGain();
      const oscillator=voice.source,gain=voice.gain;
      oscillator.type=sound.wave;oscillator.frequency.setValueAtTime(sound.from,now);oscillator.frequency.exponentialRampToValueAtTime(sound.to,now+sound.duration);
      // 每组峰值不超过 0.04, 最多 8 组. 短渐入和归零包络抑制点击声与叠加峰值.
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(sound.peak,now+.004);
      gain.gain.exponentialRampToValueAtTime(.0001,now+sound.duration-.004);gain.gain.linearRampToValueAtTime(0,now+sound.duration);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.onended=()=>release(voice);voices.add(voice);
      oscillator.start(now);voice.started=true;oscillator.stop(voice.end);lastPlayed.set(kind,now);
      return true;
    } catch(error){release(voice,true);warn('音效播放失败: '+error.message);return false;}
  }
  return {enableFromGesture,setEnabled,stop,play,get enabled(){return enabled;}};
}
