import {createHeroMotion,drawHero,normalizeHeroMotion} from './hero-runtime.mjs';
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
    config=normalizeHeroMotion(data.workspace.heroMotion);images={head,weapon};motion=createHeroMotion(config);lastTime=null;
    $('example-status').textContent=`已读取 ${project} / ${headPath} / 已保存版本 v${data.revision}. 全局幅度 ${Math.round(config.amplitude*100)}%.`;
    $('example-check-result').textContent='';render();
  }catch(cause){motion=null;context.clearRect(0,0,512,512);$('example-status').textContent='读取失败: '+cause.message;}
}
$('example-controls').addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button&&motion){motion.setAction(button.dataset.action);render();}});
$('example-pause').addEventListener('click',()=>{paused=!paused;lastTime=null;$('example-pause').textContent=paused?'继续':'暂停';});
$('example-reload').addEventListener('click',load);
// 使用真实 Canvas 比较单次和多次时间推进, 同时检查动作计算和透明像素渲染.
$('example-check').addEventListener('click',()=>{
  if(!motion)return;
  try {
    let checks=0;
    for(const action of ['idle','walk-left','walk-right','attack','hit'])for(const fraction of [.25,.5,.9]) {
      const duration=config.actions[action.startsWith('walk')?'walk':action]?.duration||1;
      const seconds=duration*fraction,a=createHeroMotion(config),b=createHeroMotion(config);
      a.setAction(action);b.setAction(action);a.advance(seconds);
      for(let i=0;i<8;i++)b.advance(seconds/8);
      const snapshots=[a.snapshot(),b.snapshot()];
      for(const part of ['head','weapon'])for(const key of ['dx','dy','sx','sy'])if(Math.abs(snapshots[0].pose.parts[part][key]-snapshots[1].pose.parts[part][key])>1e-10)throw new Error(`${action}: 姿势不同`);
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
