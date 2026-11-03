import {drawHero,heroFiles,normalizeHeroMotion,upgradeHeroMotion} from './hero-runtime.mjs';
import {createHeroPreview} from './hero-preview.mjs';
import {loadHeroImage} from './hero-assets.mjs';
import {projectApi,currentProject} from './projects.mjs';
import {pngUrl} from './png.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(object,path)=>path.split('.').reduce((value,key)=>value[key],object);
function write(object,path,value){const keys=path.split('.');read(object,keys.slice(0,-1).join('.'))[keys.at(-1)]=value;}
const percent=path=>path==='amplitude'||/\.(sx|sy|flash)$/.test(path);

export function mountHeroEditor({getWorkspace,commit,onDirty,notify,canEdit,onSelectPng}) {
  const $=id=>document.getElementById(id),view=$('heroes-view'),canvas=$('hero-stage'),context=canvas.getContext('2d');
  let draft=normalizeHeroMotion(getWorkspace().heroMotion),dirty=false,selecting=false;
  const motion=createHeroPreview(draft);
  let library=[],selectedPath='',weapon=null,weaponPath='',generation=0,weaponGeneration=0;
  let paused=false,lastTime=null,activeAction='idle',previewStyle='thrust',previewCritical=false;
  const labels={idle:'静止',walk:'行走',attack:'攻击',hit:'受伤'};
  function error(message=''){$('hero-error').textContent=message;$('hero-error').hidden=!message;}
  function setDirty(value){dirty=value;$('hero-save-state').textContent=value?'有未保存的动作修改':'已保存到本地';onDirty();}
  function applyDraft(){try{motion.setConfig(normalizeHeroMotion(draft));error();return true;}catch(cause){error(cause.message);return false;}}
  function field(path,label,min,max,step) {
    const value=read(draft,path)*(percent(path)?100:1);
    return `<label class="hero-field"><span>${label}</span><input type="range" data-hero-param="${path}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}滑杆"><input type="number" data-hero-param="${path}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"></label>`;
  }
  function renderParameters() {
    let html='<details open><summary>共享幅度与固定挂点</summary>'+field('amplitude','全局幅度 (%)',0,100,1);
    for(const [part,name] of [['head','头像'],['weapon','武器']]) {
      html+=`<h3>${name}挂点</h3>`;
      for(const [key,label,min,max] of [['x','X',0,256],['y','Y',0,256],['size','显示大小',1,256]])html+=field(`slots.${part}.${key}`,`${name}${label} (px)`,min,max,1);
    }
    html+='</details>';
    for(const [action,name] of draft.version===1?[['walk','行走'],['attack','攻击'],['hit','受伤']]:[['walk','行走']]) {
      html+=`<details><summary>${name}参数</summary>`+field(`actions.${action}.duration`,action==='walk'?'行走周期 (秒)':`${name}时长 (秒)`,.1,5,.01);
      for(const [part,partName] of [['head','头像'],['weapon','武器']]) {
        html+=`<h3>${partName}</h3>`;
        for(const [key,label] of [['dx','X 位移 (px)'],['dy','Y 位移 (px)'],['sx','X 缩放变化 (%)'],['sy','Y 缩放变化 (%)']])html+=field(`actions.${action}.${part}.${key}`,`${name}${partName}${label}`,-5,5,.1);
      }
      if(action==='hit')html+=field('actions.hit.recoil','整体后退 (px)',0,5,.1)+field('actions.hit.flash','闪烁强度 (%)',0,30,1);
      html+='</details>';
    }
    if(draft.version===2) {
      html+='<details open><summary>v2 战斗时序与冲击</summary>';
      for(const [key,label,min,max,step] of [['anticipation','蓄力时间 (秒)',0,.5,.05],['strike','出手时间 (秒)',.05,.3,.05],['recovery','收招时间 (秒)',0,1,.05],['attackStrength','攻击力度倍率',0,2,.05],['hitStrength','受击力度倍率',0,2,.05],['hitStop','重击局部停顿 (秒)',0,.05,.01]])html+=field('combat.'+key,label,min,max,step);
      html+='<p class="field-help">默认35%幅度对应战场的标准冲击强度. 时序按50ms量化, 修改后可重播查看.</p></details>';
      html+=`<details open><summary>战斗预览</summary><label class="hero-toolbar">攻击样式<select data-hero-style aria-label="攻击样式">${[['thrust','突刺'],['slash','横斩'],['shoot','射击'],['cast','施法'],['strike','打击']].map(([value,name])=>`<option value="${value}" ${previewStyle===value?'selected':''}>${name}</option>`).join('')}</select></label><label class="hero-toolbar">受击类型<select data-hero-impact aria-label="受击类型"><option value="normal" ${!previewCritical?'selected':''}>普通</option><option value="critical" ${previewCritical?'selected':''}>暴击重击</option></select></label><div class="hero-toolbar"><button type="button" class="button secondary" data-hero-preview="combo">攻击中受击</button><button type="button" class="button secondary" data-hero-preview="release">开火后坐</button></div><p class="field-help">样式和受击类型只控制预览, 不改动项目配置. 游戏根据单位职责选择同一套固定轨迹.</p></details>`;
    }else html+='<div class="hero-toolbar"><button type="button" class="button secondary" data-hero-upgrade>启用 v2 战斗动作</button></div><p class="field-help">仅将当前项目切换为 v2 草稿, 保存后生效. 旧项目不会自动升级.</p>';
    $('hero-parameters').innerHTML=html;
  }
  function renderList() {
    const filter=$('hero-search').value.trim().toLowerCase(),matches=library.filter(row=>row.id.toLowerCase().includes(filter));
    $('hero-count').textContent=`${library.length} 个头像`;
    $('hero-list').innerHTML=matches.map(row=>`<button type="button" class="hero-list-item ${row.path===selectedPath?'selected':''}" data-hero-path="${esc(row.path)}" aria-pressed="${row.path===selectedPath}">${row.image?`<img src="${pngUrl(row.path)}" alt="" width="56" height="56">`:'<span class="hero-invalid">!</span>'}<span><strong>${esc(row.id)}</strong><small>${esc(row.error||'256 x 256 · 透明 PNG')}</small></span></button>`).join('')||'<p class="field-help">没有匹配的头像. 将 256 x 256 透明 PNG 放入当前项目 assets/heroes/ 后刷新.</p>';
  }
  function render() {
    context.clearRect(0,0,canvas.width,canvas.height);
    const row=library.find(row=>row.path===selectedPath),snapshot=motion.snapshot();
    if(row?.image) {
      context.save();context.scale(canvas.width/256,canvas.height/256);
      const images={head:row.image,weapon};
      if($('hero-reference').checked){context.save();context.globalAlpha=.2;drawHero(context,images,snapshot,{reference:true});context.restore();}
      drawHero(context,images,snapshot);context.restore();
    }
    $('hero-selected').textContent=row?.id||'选择英雄';
    $('hero-resource-state').textContent=row?.error||(!row?'还没有可预览的头像':'头像 256 x 256 / 武器 '+(weapon?'128 x 128':'未装备'));
    $('hero-state').textContent=`${labels[snapshot.state]||snapshot.state} · ${snapshot.facing===-1?'向左':'向右'}${snapshot.hit?.active?' · 受击叠加':''}${snapshot.frozen?' · 局部停顿':''}${paused?' · 已暂停':''}`;
    for(const button of view.querySelectorAll('[data-hero-action]'))button.setAttribute('aria-pressed',String(button.dataset.heroAction===(snapshot.state==='walk'?(snapshot.facing===-1?'walk-left':'walk-right'):snapshot.state)));
    $('hero-weapon-path').textContent=weaponPath||'不装备';
    $('hero-pause').textContent=paused?'继续':'暂停';
    const params=new URLSearchParams({project:currentProject()?.id||'',hero:selectedPath,weapon:weaponPath,style:previewStyle,critical:String(previewCritical)});
    $('hero-example').href='/editor/hero-example.html?'+params;
  }
  async function refreshLibrary() {
    const token=++generation;$('hero-library-state').textContent='正在检查头像...';
    try {
      const response=await fetch(projectApi('/resources'),{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'资源目录读取失败');
      const rows=heroFiles(data.paths);
      for(const row of rows) {
        if(token!==generation)return;
        try{row.image=await loadHeroImage(row.path,256);}catch(cause){row.error=cause.message;}
      }
      if(token!==generation)return;
      library=rows;
      if(!rows.some(row=>row.path===selectedPath))selectedPath=rows.find(row=>row.image)?.path||rows[0]?.path||'';
      $('hero-library-state').textContent='目录: assets/heroes/';renderList();render();
    }catch(cause){if(token===generation){$('hero-library-state').textContent=cause.message;error(cause.message);}}
  }
  function frame(now) {
    if(!document.hidden&&!view.hidden) {
      if(!paused&&lastTime!==null)motion.advance(Math.min(.05,(now-lastTime)/1000)*Number($('hero-speed').value||1));
      render();
    }
    lastTime=now;requestAnimationFrame(frame);
  }
  $('hero-parameters').addEventListener('input',event=>{
    const path=event.target.dataset.heroParam;if(!path)return;
    if(selecting||!canEdit()){renderParameters();return;}
    const number=event.target.value===''?NaN:Number(event.target.value),value=number/(percent(path)?100:1);
    if(path==='amplitude')draft.amplitude=value;else write(draft,path,value);
    for(const field of $('hero-parameters').querySelectorAll('[data-hero-param]'))if(field!==event.target&&field.dataset.heroParam===path)field.value=event.target.value;
    setDirty(true);applyDraft();render();
  });
  $('hero-parameters').addEventListener('change',event=>{
    if('heroStyle' in event.target.dataset)previewStyle=event.target.value;
    else if('heroImpact' in event.target.dataset)previewCritical=event.target.value==='critical';
    else return;
    motion.reset();activeAction='idle';render();
  });
  $('hero-parameters').addEventListener('click',event=>{
    if(event.target.closest('[data-hero-upgrade]')) {
      if(selecting||!canEdit())return;
      draft=upgradeHeroMotion(draft);setDirty(true);applyDraft();motion.reset();activeAction='idle';renderParameters();render();return;
    }
    const button=event.target.closest('[data-hero-preview]');if(!button)return;
    activeAction=button.dataset.heroPreview;motion.setAction(activeAction,{style:previewStyle,critical:previewCritical});paused=false;lastTime=null;render();
  });
  view.addEventListener('click',event=>{
    const button=event.target.closest('[data-hero-action]');if(!button)return;
    activeAction=button.dataset.heroAction;motion.setAction(activeAction,{style:previewStyle,critical:previewCritical});render();
  });
  $('hero-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-hero-path]');if(!button)return;
    selectedPath=button.dataset.heroPath;motion.reset();activeAction='idle';renderList();render();
  });
  $('hero-search').addEventListener('input',renderList);
  $('hero-refresh').addEventListener('click',refreshLibrary);
  $('hero-reference').addEventListener('change',render);
  $('hero-pause').addEventListener('click',()=>{paused=!paused;lastTime=null;render();});
  $('hero-reset').addEventListener('click',()=>{motion.reset();activeAction='idle';paused=false;render();});
  $('hero-replay').addEventListener('click',()=>{motion.setAction(activeAction,{style:previewStyle,critical:previewCritical});paused=false;lastTime=null;render();});
  $('hero-defaults').addEventListener('click',()=>{if(selecting||!canEdit())return;draft=draft.version===2?upgradeHeroMotion():normalizeHeroMotion();setDirty(true);applyDraft();renderParameters();render();});
  $('hero-discard').addEventListener('click',()=>{if(selecting||dirty&&!confirm('放弃未保存的英雄动作修改?'))return;reset();});
  $('hero-save').addEventListener('click',async()=>{
    if(selecting||!canEdit()||!applyDraft())return;
    if(await commit({...getWorkspace(),heroMotion:normalizeHeroMotion(draft)})){setDirty(false);notify('英雄动作已保存, 所有英雄共用此配置');}
  });
  $('hero-weapon-select').addEventListener('click',async()=>{
    if(selecting)return;
    const token=++weaponGeneration;selecting=true;onDirty();error();
    try {
      const path=await onSelectPng();if(path===null)return;
      const image=await loadHeroImage(path,128);
      if(token!==weaponGeneration)return;
      weapon=image;weaponPath=path;render();notify('已替换武器 icon, 头像和挂点保持不变');
    }catch(cause){if(token===weaponGeneration)error(cause.message);}
    finally{if(token===weaponGeneration){selecting=false;onDirty();}}
  });
  $('hero-weapon-clear').addEventListener('click',()=>{if(selecting)return;weapon=null;weaponPath='';render();});
  document.addEventListener('visibilitychange',()=>{lastTime=null;});
  function reset(){draft=normalizeHeroMotion(getWorkspace().heroMotion);weaponGeneration++;selecting=false;setDirty(false);applyDraft();motion.reset();renderParameters();render();}
  renderParameters();render();refreshLibrary();requestAnimationFrame(frame);
  return {refresh:()=>{if(!dirty){draft=normalizeHeroMotion(getWorkspace().heroMotion);applyDraft();renderParameters();}render();},
    hasUnsaved:()=>dirty||selecting,reset,
    snapshot:()=>({draft:clone(draft),dirty}),
    restore:snapshot=>{if(!snapshot||typeof snapshot.draft!=='object'||!snapshot.draft)throw new Error('英雄动作草稿无效');draft=clone(snapshot.draft);setDirty(!!snapshot.dirty);applyDraft();renderParameters();render();}
  };
}
