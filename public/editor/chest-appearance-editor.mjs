import {normalizeWorkspace} from './workspace.mjs';
import {pngCellHtml,pngUrl,isPngReference} from './png.mjs';

export function mountChestAppearanceEditor({getWorkspace,commit,onDirty,notify,canEdit,onSelectPng}) {
  const $=id=>document.getElementById(id),clone=value=>JSON.parse(JSON.stringify(value));
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let draft=null,originalId=null,dirty=false,selecting=false;
  const appearances=()=>getWorkspace().chestAppearances||[];
  function error(message=''){$('chest-error').textContent=message;$('chest-error').hidden=!message;}
  function setDirty(value){dirty=value;$('chest-save-state').textContent=value?'有未保存的修改':'已保存到本地';onDirty();}
  function render() {
    $('chest-controls').inert=selecting;
    $('chest-list').innerHTML=appearances().map(row=>`<button type="button" class="chest-list-item ${originalId===row.id?'selected':''}" data-chest-action="open" data-chest-id="${row.id}">${isPngReference(row.icon)?`<img src="${pngUrl(row.icon)}" alt="" width="48" height="48">`:''}<span><strong>${esc(row.name)}</strong><small>ID ${row.id}</small></span></button>`).join('')||'<p class="field-help">还没有宝箱外观, 点击新建开始配置.</p>';
    $('chest-form').hidden=!draft;$('chest-empty').hidden=!!draft;
    if(!draft)return;
    for(const key of ['id','name','icon'])$('chest-'+key).value=draft[key];
    $('chest-png').innerHTML=pngCellHtml(draft.icon,'','宝箱外观');
    $('chest-delete').hidden=originalId===null;
    const count=getWorkspace().tables.drop_package?.rows.filter(row=>row.chest_appearance_id===originalId).length||0;
    $('chest-references').textContent=`${count} 个掉落包共用此外观. 外观不占用资产 ID, 不作为奖励.`;
  }
  function load(id) {
    const row=appearances().find(row=>row.id===id);
    draft=row?clone(row):null;originalId=row?.id??null;setDirty(false);error();render();
  }
  function refresh(){if(!dirty&&!selecting)load(appearances().some(row=>row.id===originalId)?originalId:appearances()[0]?.id);else render();}
  for(const key of ['id','name','icon'])$('chest-'+key).addEventListener('input',()=>{
    if(selecting||!canEdit()){render();return;}
    if(!draft)return;draft[key]=$('chest-'+key).value;setDirty(true);error();
    if(key==='icon')$('chest-png').innerHTML=pngCellHtml(draft.icon,'','宝箱外观');
  });
  $('chest-new').addEventListener('click',()=>{
    if(selecting||!canEdit())return;
    if(dirty&&!confirm('放弃当前宝箱外观的未保存修改并新建?'))return;
    draft={id:'',name:'',icon:''};originalId=null;setDirty(true);error();render();$('chest-id').focus();
  });
  $('chest-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-chest-action="open"]');if(!button||selecting)return;
    if(dirty&&!confirm('放弃当前宝箱外观的未保存修改并切换?'))return;
    load(Number(button.dataset.chestId));
  });
  $('chest-discard').addEventListener('click',()=>{
    if(selecting)return;
    if(dirty&&!confirm('放弃宝箱外观的未保存修改?'))return;
    dirty=false;refresh();setDirty(false);
  });
  $('chest-png').addEventListener('click',async event=>{
    if(selecting||!draft||!canEdit())return;
    if(event.target.closest('[data-png-clear]')){draft.icon='';setDirty(true);error();render();return;}
    if(!event.target.closest('[data-png-select]'))return;
    const target=draft;
    selecting=true;onDirty();error();render();
    try{const path=await onSelectPng();if(path!==null&&draft===target){draft.icon=path;setDirty(true);notify('已选择 PNG, 请保存宝箱外观');}}
    catch(cause){error(cause.message);}
    finally{selecting=false;setDirty(dirty);render();}
  });
  $('chest-save').addEventListener('click',async()=>{
    if(selecting||!draft||!canEdit())return;
    try {
      // 工作区统一校验 ID, 必填字段及引用, 失败时保留原草稿和已保存状态.
      const nextRows=appearances().map(row=>row.id===originalId?{...draft}:row);
      if(originalId===null)nextRows.push({...draft});
      const next=normalizeWorkspace({...getWorkspace(),chestAppearances:nextRows});
      if(await commit(next)){const id=Number(draft.id);setDirty(false);load(id);notify('宝箱外观已保存到本地');}
    }catch(cause){error(cause.message);}
  });
  $('chest-delete').addEventListener('click',async()=>{
    if(selecting||originalId===null||!canEdit())return;
    if(!confirm('删除此宝箱外观? 仍被掉落包引用的外观不能删除.'))return;
    try {
      const next=normalizeWorkspace({...getWorkspace(),chestAppearances:appearances().filter(row=>row.id!==originalId)});
      if(await commit(next)){originalId=null;draft=null;setDirty(false);refresh();notify('宝箱外观已删除');}
    }catch(cause){error(cause.message);}
  });
  refresh();
  return {refresh,hasUnsaved:()=>dirty||selecting,
    reset:()=>{load(appearances()[0]?.id);},
    snapshot:()=>({draft:clone(draft),originalId,dirty}),
    restore:snapshot=>{draft=clone(snapshot.draft);originalId=snapshot.originalId??null;setDirty(!!snapshot.dirty);error();render();}
  };
}
