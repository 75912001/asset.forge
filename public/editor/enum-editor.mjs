import {emptyEnum,enumsYaml} from './enums.mjs';
import {pngCellHtml} from './png.mjs';

export function mountEnumEditor({getWorkspace,commit,canEdit,onDirty,notify,onExport,onDownload,onSelectPng}) {
  const $=id=>document.getElementById(id);
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value));
  let key=null,draft=emptyEnum(),dirty=false,creating=false,selecting=false;
  const references=()=>Object.entries(getWorkspace().tables).flatMap(([tableKey,table])=>table.fields.filter(field=>field.type==='enum'&&field.enum===key).map(field=>`${tableKey}.${field.key}`));
  function error(message='') {$('enum-error').textContent=message;$('enum-error').hidden=!message;}
  function setDirty(value) {
    dirty=value;$('enum-save-state').textContent=value?'有未保存的修改':'已保存到本地';
    $('enum-save-state').classList.toggle('unsaved',value);onDirty();
  }
  function render() {
    $('enum-controls').inert=selecting;$('enum-select').disabled=selecting;$('enum-new').disabled=selecting;
    const definitions=getWorkspace().enums;
    $('enum-select').innerHTML=(creating?'<option value="">新建枚举</option>':'')+definitions.map(entry=>`<option value="${esc(entry.key)}">${esc(entry.label)} · ${esc(entry.key)}</option>`).join('');
    $('enum-select').value=key||'';
    const visible=creating||!!key;
    $('enum-empty').hidden=visible;$('enum-controls').hidden=!visible;
    $('enum-save').disabled=!visible||selecting;$('enum-delete').hidden=!key;$('enum-discard').disabled=selecting;
    $('enum-key').disabled=key==='chest_type'&&getWorkspace().categories.some(category=>category.system==='drop_package');
    $('enum-key').value=draft.key;$('enum-label').value=draft.label;
    $('enum-items').innerHTML=draft.items.map((item,index)=>{
      const fixed=item.key==='undefined'&&Number(item.value)===0;
      return `<tr><td class="row-number">${index+1}</td><td><input data-enum-item="${index}" data-property="key" value="${esc(item.key)}" aria-label="枚举项 ${index+1} 标识" class="mono" ${fixed?'disabled':''}></td><td><input data-enum-item="${index}" data-property="label" value="${esc(item.label)}" aria-label="枚举项 ${index+1} 名称" ${fixed?'disabled':''}></td><td><input data-enum-item="${index}" data-property="value" value="${esc(item.value)}" aria-label="枚举项 ${index+1} 数值" inputmode="numeric" class="mono" ${fixed?'disabled':''}></td><td>${draft.key==='chest_type'&&fixed?'<span class="locked-label">无图标</span>':pngCellHtml(item.icon,`data-enum-icon="${index}"`,`枚举项 ${index+1} 图标`)}</td><td>${fixed?'<span class="locked-label">固定项</span>':`<button class="table-icon-button" data-remove-enum-item="${index}" aria-label="删除枚举项 ${esc(item.key)}">×</button>`}</td></tr>`;
    }).join('');
    const refs=references();
    $('enum-references').textContent=refs.length?`字段引用: ${refs.join(', ')}`:'尚无资产表字段引用此枚举';
    $('enum-yaml').textContent=enumsYaml(definitions);
  }
  function refresh(force=false) {
    if(force||!dirty&&!selecting) {
      const definitions=getWorkspace().enums;
      if(!definitions.some(entry=>entry.key===key))key=definitions[0]?.key||null;
      draft=key?clone(definitions.find(entry=>entry.key===key)):emptyEnum();creating=false;
    }
    render();
  }
  function leave() {return !selecting&&(!dirty||confirm('当前枚举尚未保存, 是否放弃修改?'));}
  $('enum-new').addEventListener('click',()=>{
    if(!canEdit()||!leave())return;
    key=null;creating=true;draft=emptyEnum();setDirty(true);error();render();$('enum-label').focus();
  });
  $('enum-select').addEventListener('change',event=>{
    if(!leave()){$('enum-select').value=key||'';return;}
    key=event.target.value;creating=false;setDirty(false);error();refresh();
  });
  for(const property of ['key','label'])$('enum-'+property).addEventListener('input',()=>{
    if(!canEdit()){render();return;}
    draft[property]=$('enum-'+property).value;setDirty(true);error();
  });
  $('enum-add-item').addEventListener('click',()=>{
    if(!canEdit())return;
    let value=1;while(draft.items.some(item=>Number(item.value)===value))value++;
    let suffix=1;while(draft.items.some(item=>item.key===`item_${suffix}`))suffix++;
    draft.items.push({key:`item_${suffix}`,label:'新枚举项',value});setDirty(true);error();render();
  });
  $('enum-items').addEventListener('input',event=>{
    const input=event.target.closest('[data-enum-item]');if(!input)return;
    if(!canEdit()){render();return;}
    const item=draft.items[Number(input.dataset.enumItem)];
    if(item.key==='undefined'&&Number(item.value)===0)return;
    item[input.dataset.property]=input.value;setDirty(true);error();
  });
  $('enum-items').addEventListener('click',async event=>{
    if(selecting||!canEdit())return;
    const image=event.target.closest('[data-png-select]')||event.target.closest('[data-png-clear]');
    if(image) {
      const item=draft.items[Number(image.dataset.enumIcon)];
      if(!item||draft.key==='chest_type'&&Number(item.value)===0)return;
      if(event.target.closest('[data-png-clear]')){delete item.icon;setDirty(true);error();render();return;}
      const target=draft;selecting=true;onDirty();error();render();
      try {
        const path=await onSelectPng();
        // 项目重载会替换草稿对象, 迟到的选择结果不能写入新的工作区.
        if(path!==null&&draft===target){item.icon=path;setDirty(true);notify('已选择 PNG, 请保存枚举');}
      }catch(cause){error(cause.message);}
      finally{selecting=false;onDirty();render();}
      return;
    }
    const button=event.target.closest('[data-remove-enum-item]');if(!button||!canEdit())return;
    const index=Number(button.dataset.removeEnumItem);
    if(draft.items[index].key==='undefined'&&Number(draft.items[index].value)===0)return;
    draft.items.splice(index,1);setDirty(true);error();render();
  });
  $('enum-save').addEventListener('click',async()=>{
    if(selecting||!canEdit())return;
    try {
      if(!await commit(key,{...draft,key:draft.key.trim(),label:draft.label.trim(),items:draft.items.map(item=>({...item,key:item.key.trim(),label:item.label.trim()}))}))return;
      key=draft.key.trim();setDirty(false);error();refresh();notify('枚举已保存, 字段引用已同步更新');
    } catch(cause) {error(cause.message);}
  });
  $('enum-discard').addEventListener('click',()=>{if(!leave())return;setDirty(false);error();refresh();});
  $('enum-delete').addEventListener('click',async()=>{
    if(!key||!canEdit())return;
    if(references().length){error('此枚举仍被资产表字段引用, 请先移除引用');return;}
    if(!confirm(`确定删除枚举"${draft.label}"?`))return;
    try {if(!await commit(key,null))return;key=null;setDirty(false);error();refresh();notify('枚举已删除');}
    catch(cause) {error(cause.message);}
  });
  $('enum-export').addEventListener('click',onExport);
  $('enum-download').addEventListener('click',onDownload);
  refresh();
  return {refresh,hasUnsaved:()=>dirty||selecting,
    reset:()=>{key=null;setDirty(false);refresh(true);},
    snapshot:()=>({key,draft:clone(draft),dirty,creating}),
    restore:snapshot=>{key=snapshot.key;draft=clone(snapshot.draft);creating=snapshot.creating;setDirty(snapshot.dirty);render();}
  };
}
