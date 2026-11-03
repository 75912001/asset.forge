import {drawHero,normalizeHeroMotion,createAttackTiming} from './hero-runtime.mjs';
import {createHeroPreview} from './hero-preview.mjs';
import {loadHeroImage} from './hero-assets.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const project=params.get('project'),headPath=params.get('hero'),weaponPath=params.get('weapon');
const canvas=$('example-stage'),context=canvas.getContext('2d');
let config,motion,images,paused=false,lastTime=null;
function render() {
  context.clearRect(0,0,512,512);
  if(!motion)return;
  context.save();context.scale(2,2);drawHero(context,images,motion.snapshot());context.restore();
  const snapshot=motion.snapshot(),action=snapshot.state==='walk'?(snapshot.facing===-1?'walk-left':'walk-right'):snapshot.state;
  for(const button of document.querySelectorAll('[data-action]'))button.setAttribute('aria-pressed',String(button.dataset.action===action));
}
async function load() {
  try {
    if(!project||!headPath)throw new Error('请从英雄动作面板选择头像后打开此示例');
    const base='/api/projects/'+encodeURIComponent(project),response=await fetch(base+'/workspace',{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'读取配置失败');
    const resource=path=>base+'/images?file='+encodeURIComponent(path);
    const [head,weapon]=await Promise.all([loadHeroImage(headPath,256,resource(headPath)),weaponPath?loadHeroImage(weaponPath,128,resource(weaponPath)):null]);
    config=normalizeHeroMotion(data.workspace.heroMotion);images={head,weapon};motion=createHeroPreview(config);lastTime=null;
    $('example-combat').hidden=config.version!==2;
    if(['shoot','thrust','slash','cast','strike'].includes(params.get('style')))$('example-style').value=params.get('style');
    $('example-impact').value=params.get('critical')==='true'?'critical':'normal';
    $('example-status').textContent=`已读取 ${project} / ${headPath} / 已保存版本 v${data.revision}, 动作 v${config.version}. 全局幅度 ${Math.round(config.amplitude*100)}%.`;
    $('example-check-result').textContent='';render();
  }catch(cause){motion=null;context.clearRect(0,0,512,512);$('example-status').textContent='读取失败: '+cause.message;}
}
function play(event){const button=event.target.closest('[data-action]');if(button&&motion){motion.setAction(button.dataset.action,{style:$('example-style').value,critical:$('example-impact').value==='critical'});paused=false;lastTime=null;render();}}
$('example-controls').addEventListener('click',play);$('example-combat').addEventListener('click',play);
$('example-style').addEventListener('change',()=>{if(motion){motion.reset();render();}});
$('example-pause').addEventListener('click',()=>{paused=!paused;lastTime=null;$('example-pause').textContent=paused?'继续':'暂停';});
$('example-reload').addEventListener('click',load);
// 使用真实 Canvas 比较单次和多次时间推进, 同时检查动作计算和透明像素渲染.
$('example-check').addEventListener('click',()=>{
  if(!motion)return;
  try {
    let checks=0;
    const cases=config.version===1?['idle','walk-left','walk-right','attack','hit'].map(action=>({action,options:{},duration:config.actions[action.startsWith('walk')?'walk':action]?.duration||1})):
      ['shoot','thrust','slash','cast','strike'].flatMap(style=>[false,true].flatMap(critical=>['attack','hit','combo'].map(action=>({action,options:{style,critical},duration:action==='hit'?(critical?.22:.18):createAttackTiming(config)(0,1).duration}))));
    for(const {action,options,duration} of cases)for(const fraction of [.25,.5,.9]) {
      const seconds=duration*fraction,a=createHeroPreview(config),b=createHeroPreview(config);
      a.setAction(action,options);b.setAction(action,options);a.advance(seconds);
      for(let i=0;i<8;i++)b.advance(seconds/8);
      const snapshots=[a.snapshot(),b.snapshot()];
      const compare=(left,right)=>{for(const key of Object.keys(left)){if(typeof left[key]==='object')compare(left[key],right[key]);else if(Math.abs(left[key]-right[key])>1e-10)throw new Error(`${action}: 姿势不同`);}};
      compare(snapshots[0].pose,snapshots[1].pose);
      const pixels=snapshots.map(snapshot=>{const output=document.createElement('canvas');output.width=output.height=256;const ctx=output.getContext('2d');drawHero(ctx,images,snapshot);return ctx.getImageData(0,0,256,256).data;});
      if(!pixels[0].every((value,index)=>value===pixels[1][index]))throw new Error(`${action}: 画布像素不同`);
      checks++;
    }
    $('example-check-result').textContent=`通过: ${checks} 个动作时间点的姿势及 256 x 256 RGBA 像素一致. 面板与本页共用 hero-runtime.mjs.`;
  }catch(cause){$('example-check-result').textContent='检查失败: '+cause.message;}
});
function frame(now){if(motion&&!paused&&!document.hidden&&lastTime!==null)motion.advance(Math.min(.05,(now-lastTime)/1000));lastTime=now;if(!document.hidden)render();requestAnimationFrame(frame);}
document.addEventListener('visibilitychange',()=>{lastTime=null;});
await load();requestAnimationFrame(frame);
