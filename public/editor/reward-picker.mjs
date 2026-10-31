import {pngUrl,isPngReference} from './png.mjs';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function filterRewardAssets(assets,query) {
  const text=query.trim().toLowerCase();
  return assets.filter(asset=>`${asset.name} ${asset.category} ${asset.id}`.toLowerCase().includes(text));
}
export function rewardPickerHtml(asset) {
  const image=isPngReference(asset?.icon);
  return `<span class="reward-asset-thumb" aria-hidden="true">▦${image?`<img src="${pngUrl(asset.icon)}" alt="" width="36" height="36" loading="lazy">`:''}</span><span class="reward-asset-text"><strong>${esc(asset?.name??'选择道具或装备...')}</strong><small>${asset?`${esc(asset.category)} · ${esc(asset.id)}`:'搜索名称 / 分类 / ID'}</small></span>`;
}
let activePicker=null,pickerId=0;
export function openRewardPicker(button,assets) {
  activePicker?.();
  const select=button.parentElement.querySelector('select[data-reward-property="asset_id"]');
  const popup=document.createElement('div');
  popup.id=`reward-picker-${++pickerId}`;popup.className='reward-picker-popup';popup.popover='auto';
  popup.setAttribute('role','dialog');popup.setAttribute('aria-label','选择奖励资产');
  popup.innerHTML='<div class="reward-picker-heading"><strong>选择奖励资产</strong><button type="button" class="table-icon-button" data-picker-close aria-label="关闭资产选择">×</button></div><div class="reward-picker-search"><input type="search" aria-label="搜索奖励资产" placeholder="搜索名称、分类或 ID" autocomplete="off"></div><p class="reward-picker-count" role="status"></p><div class="reward-picker-options" role="listbox" aria-label="道具和装备"></div><div class="reward-picker-footer"><span>↑ ↓ 选择 · Enter 确认 · Esc 关闭</span><button type="button" class="text-button" data-picker-clear>清空选择</button></div>';
  const input=popup.querySelector('input'),list=popup.querySelector('[role="listbox"]');
  let closed=false;
  function close(focus=false) {
    if(closed)return;closed=true;
    popup.remove();button.setAttribute('aria-expanded','false');button.removeAttribute('aria-controls');
    window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',dismiss);
    if(activePicker===dismiss)activePicker=null;
    if(focus&&button.isConnected)button.focus();
  }
  function dismiss(){close();}
  function render() {
    const matches=filterRewardAssets(assets,input.value);
    popup.querySelector('.reward-picker-count').textContent=`${matches.length} 个资产${matches.length>100?' · 显示前 100 个, 请搜索缩小范围':''}`;
    list.innerHTML=matches.slice(0,100).map(asset=>`<button type="button" class="reward-picker-option" role="option" aria-selected="${String(asset.id)===select.value}" data-picker-id="${asset.id}">${rewardPickerHtml(asset)}<span class="reward-picker-check" aria-hidden="true">${String(asset.id)===select.value?'✓':''}</span></button>`).join('')||'<p class="reward-picker-empty">没有找到匹配的资产</p>';
    list.scrollTop=0;
  }
  function choose(value) {
    if(!button.isConnected){close();return;}
    select.value=value;
    button.innerHTML=rewardPickerHtml(assets.find(asset=>String(asset.id)===value))+'<span class="reward-picker-chevron" aria-hidden="true">⌄</span>';
    close(true);select.dispatchEvent(new Event('input',{bubbles:true}));
  }
  input.addEventListener('input',render);
  popup.addEventListener('click',event=>{
    const option=event.target.closest('[data-picker-id]');
    if(option){choose(option.dataset.pickerId);return;}
    if(event.target.closest('[data-picker-clear]'))choose('');
    else if(event.target.closest('[data-picker-close]'))close(true);
  });
  popup.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close(true);return;}
    const options=[...list.querySelectorAll('[role="option"]')],index=options.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const next=index<0?(event.key==='ArrowDown'?0:options.length-1):(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      options[next]?.focus();
    }else if(index>=0&&['Home','End'].includes(event.key)){event.preventDefault();options[event.key==='Home'?0:options.length-1]?.focus();}
  });
  popup.addEventListener('focusout',event=>{if(event.relatedTarget&&!popup.contains(event.relatedTarget)&&event.relatedTarget!==button)close();});
  popup.addEventListener('toggle',event=>{if(event.newState==='closed')close();});
  popup.addEventListener('error',event=>{if(event.target.tagName==='IMG')event.target.hidden=true;},true);
  document.body.append(popup);render();
  const rect=button.getBoundingClientRect(),width=Math.min(Math.max(rect.width,360),window.innerWidth-24);
  const below=window.innerHeight-rect.bottom-12,above=rect.top-12,up=below<280&&above>below;
  popup.style.width=`${width}px`;popup.style.left=`${Math.max(12,Math.min(rect.left,window.innerWidth-width-12))}px`;
  popup.style.maxHeight=`${Math.max(160,Math.min(460,up?above:below))}px`;
  if(up){popup.style.bottom=`${window.innerHeight-rect.top+6}px`;}else popup.style.top=`${rect.bottom+6}px`;
  button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',popup.id);
  popup.showPopover();input.focus();activePicker=dismiss;
  window.addEventListener('resize',dismiss);window.addEventListener('scroll',dismiss);
}
