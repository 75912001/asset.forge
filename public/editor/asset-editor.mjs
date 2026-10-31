import {FIELD_TYPES,emptyAssetTable,normalizeAssetTable,nextAssetId,changeAssetField,moveAssetField,assetTableYaml} from './assets.mjs';

import {isDropCategory,isDropCore} from './drops.mjs';
import {rewardAssets,rewardListHtml,updateRewardProbability} from './rewards.mjs';
import {pngCellHtml} from './png.mjs';
import {openRewardPicker} from './reward-picker.mjs';

export function mountAssetEditor({getWorkspace,commit,onDirty,onOpen,onExport,onDownload,notify,onOpenDrops=()=>{},canEdit=()=>true,onSelectPng}) {
  const $=id=>document.getElementById(id);
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value));
  let key=null,draft=emptyAssetTable(),dirty=false,tab='data',uploading=false;
  let draggedField=null;
  const category=()=>getWorkspace().categories.find(row=>row.key===key);
  function error(message='') {$('asset-error').textContent=message;$('asset-error').hidden=!message;}
  function setDirty(value) {
    dirty=value;$('asset-save-state').textContent=value?'有未保存的修改':'已保存到本地';
    $('asset-save-state').classList.toggle('unsaved',value);onDirty();
  }
  function render() {
    draggedField=null;
    const cat=category();
    $('asset-empty').hidden=!!cat;$('asset-controls').hidden=!cat;
    $('asset-controls').inert=uploading;
    if(!cat) return;
    $('asset-title').textContent=`${cat.name}资产表`;
    $('asset-subtitle').textContent=`${cat.key}.yaml · ID ${cat.start.toLocaleString('en-US')} – ${cat.end.toLocaleString('en-US')}`;
    $('asset-table-select').value=key;
    $('asset-add-row').disabled=isDropCategory(cat);
    $('asset-row-count').textContent=draft.rows.length;
    $('asset-field-count').textContent=draft.fields.length;
    $('asset-data-panel').hidden=tab!=='data';$('asset-fields-panel').hidden=tab!=='fields';
    document.querySelectorAll('[data-asset-tab]').forEach(button=>button.classList.toggle('active',button.dataset.assetTab===tab));
    document.querySelectorAll('[data-asset-key]').forEach(button=>button.classList.toggle('selected',button.dataset.assetKey===key));
    $('asset-columns').innerHTML=`<th class="row-number">#</th>${draft.fields.map(field=>`<th>${esc(field.label)}${field.required?' <b>*</b>':''}<small>${esc(field.key)} <span>${field.type}</span></small></th>`).join('')}<th class="row-actions"></th>`;
    $('asset-data-rows').innerHTML=draft.rows.map((record,index)=>`<tr><td class="row-number">${index+1}</td>${draft.fields.map((field,column)=>{
      const value=Object.hasOwn(record,field.key)?record[field.key]:'';
      const label=`${field.label} · 第 ${index+1} 行`;
      const attrs=`data-record="${index}" data-column="${column}" aria-label="${esc(label)}"`;
      let input;
      if(isDropCategory(cat)&&isDropCore(cat,field.key))input=`<button class="text-button" data-open-drops="${cat.system==='drop_package'?record.id:record.package_id}">${field.type==='asset_list'?`${Array.isArray(value)?value.length:0} 项奖励 · 在掉落包中编辑`:esc(value??'')} ↗</button>`;
      else if(field.type==='asset_list')input=rewardListHtml(value,rewardAssets(getWorkspace()),`data-record="${index}" data-column="${column}"`);
      else if(field.type==='png')input=pngCellHtml(value,`data-record="${index}" data-column="${column}"`,label);
      else if(field.type==='bool') {
        const text=value===null||value===undefined?'':String(value);
        input=`<select ${attrs}>${!['','true','false'].includes(text)?`<option value="${esc(text)}" selected>无效值: ${esc(text)}</option>`:''}<option value="" ${text===''?'selected':''}>—</option><option value="true" ${text==='true'?'selected':''}>true</option><option value="false" ${text==='false'?'selected':''}>false</option></select>`;
      } else if(field.type==='enum') {
        const items=getWorkspace().enums.find(entry=>entry.key===field.enum)?.items||[];
        const text=String(value??'');
        const invalid=text!==''&&!items.some(item=>String(item.value)===text);
        input=`<select ${attrs} ${invalid?'class="invalid-cell" aria-invalid="true"':''}>${invalid?`<option value="${esc(text)}" selected>无效值: ${esc(text)}</option>`:''}<option value="" ${text===''?'selected':''}>请选择...</option>${items.map(item=>`<option value="${item.value}" ${text===String(item.value)?'selected':''}>${esc(item.label)} · ${item.value}</option>`).join('')}</select>`;
      } else input=`<input ${attrs} value="${esc(value??'')}" ${field.type!=='string'?'inputmode="numeric" class="mono"':''} placeholder="${field.required?'必填':'—'}" autocomplete="off">`;
      return `<td>${input}</td>`;
    }).join('')}<td class="row-actions"><button class="table-icon-button" data-remove-record="${index}" ${isDropCategory(cat)?'disabled':''} aria-label="删除第 ${index+1} 行">×</button></td></tr>`).join('');
    $('asset-no-data').hidden=!!draft.rows.length;
    $('asset-field-rows').innerHTML=draft.fields.map((field,index)=>`<tr data-field-row="${index}"><td class="row-number">${index===0?'<span class="locked-label">1</span>':`<button class="field-drag-handle" data-move-field="${index}" draggable="true" aria-label="拖动排列字段 ${esc(field.key)}" title="拖动排序, 或使用上下方向键">⠿</button>`}</td><td><input data-field="${index}" data-property="key" value="${esc(field.key)}" aria-label="字段 ${index+1} 标识" class="mono" ${index===0||isDropCore(cat,field.key)?'disabled':''}></td><td><input data-field="${index}" data-property="label" value="${esc(field.label)}" aria-label="字段 ${index+1} 名称"></td><td><select data-field="${index}" data-property="type" aria-label="字段 ${index+1} 类型" ${index===0||isDropCore(cat,field.key)?'disabled':''}>${FIELD_TYPES.map(type=>`<option ${type===field.type?'selected':''}>${type}</option>`).join('')}</select>${field.type==='enum'?`<select class="enum-reference" data-field="${index}" data-property="enum" aria-label="字段 ${index+1} 枚举引用">${getWorkspace().enums.map(entry=>`<option value="${esc(entry.key)}" ${entry.key===field.enum?'selected':''}>${esc(entry.label)} · ${esc(entry.key)}</option>`).join('')}</select>`:''}</td><td><input type="checkbox" data-field="${index}" data-property="required" aria-label="字段 ${index+1} 必填" ${field.required?'checked':''} ${index===0||isDropCore(cat,field.key)?'disabled':''}></td><td>${index===0||isDropCore(cat,field.key)?'<span class="locked-label">固定列</span>':`<button class="table-icon-button" data-remove-field="${index}" aria-label="删除字段 ${esc(field.key)}">×</button>`}</td></tr>`).join('');
    const saved=getWorkspace().tables[key];
    $('asset-yaml').textContent=assetTableYaml(cat,saved,getWorkspace().enums);
    $('asset-yaml-filename').textContent=`${key}.yaml`;
    $('asset-download').title='仅下载 YAML. PNG 仅保存原资源相对路径, 导出不会复制图片.';
  }
  function open(keyToOpen,nextTab='data') {
    if(uploading){error('正在选择 PNG, 请稍候');return false;}
    if(keyToOpen!==key && dirty && !confirm('当前资产表尚未保存，是否放弃修改并切换？')) return false;
    if(!getWorkspace().categories.some(cat=>cat.key===keyToOpen)) return false;
    if(keyToOpen!==key) {key=keyToOpen;draft=clone(getWorkspace().tables[key]);setDirty(false);error();}
    tab=nextTab;onOpen();render();return true;
  }
  function refresh() {
    const workspace=getWorkspace();
    $('asset-table-select').innerHTML=workspace.categories.map(cat=>`<option value="${esc(cat.key)}">${esc(cat.name)} · ${esc(cat.key)}</option>`).join('');
    $('asset-table-nav').innerHTML=workspace.categories.map(cat=>`<button class="table-nav-item" data-asset-key="${esc(cat.key)}"><span>▦</span>${esc(cat.name)}<small>${workspace.tables[cat.key].rows.length}</small></button>`).join('');
    if(!workspace.categories.some(cat=>cat.key===key)) {
      key=workspace.categories[0]?.key||null;draft=key?clone(workspace.tables[key]):emptyAssetTable();setDirty(false);error();
    }
    if(!dirty&&!uploading&&key)draft=clone(workspace.tables[key]);
    render();
  }
  $('asset-table-nav').addEventListener('click',event=>{const button=event.target.closest('[data-asset-key]');if(button)open(button.dataset.assetKey);});
  $('asset-table-select').addEventListener('change',event=>{if(!open(event.target.value))event.target.value=key;});
  document.querySelectorAll('[data-asset-tab]').forEach(button=>button.addEventListener('click',()=>{tab=button.dataset.assetTab;render();}));
  $('asset-add-field').addEventListener('click',()=>{
    if(!category()||!canEdit())return;
    let suffix=1;while(draft.fields.some(field=>field.key===`field_${suffix}`))suffix++;
    draft.fields.push({key:`field_${suffix}`,label:'新字段',type:'string',required:false});
    setDirty(true);error();tab='fields';render();
  });
  function fieldPatch(input) {
    const property=input.dataset.property;
    const patch={[property]:property==='required'?input.checked:input.value.trim()};
    if(property==='type'&&patch.type==='enum') {
      const current=draft.fields[Number(input.dataset.field)];
      patch.enum=current.enum||getWorkspace().enums[0]?.key;
    }
    return patch;
  }
  function clearFieldDrop() {
    $('asset-field-rows').querySelectorAll('.field-drop-before,.field-drop-after').forEach(row=>row.classList.remove('field-drop-before','field-drop-after'));
  }
  function fieldDrop(event) {
    const row=event.target.closest('[data-field-row]');
    if(draggedField===null||!row||Number(row.dataset.fieldRow)===0)return null;
    const bounds=row.getBoundingClientRect();
    const after=event.clientY>=bounds.top+bounds.height/2;
    const insertion=Number(row.dataset.fieldRow)+(after?1:0);
    return {row,after,to:insertion-(draggedField<insertion?1:0)};
  }
  $('asset-field-rows').addEventListener('dragstart',event=>{
    draggedField=null;
    const handle=event.target.closest('[data-move-field]');
    if(!handle||!canEdit()||Number(handle.dataset.moveField)===0){event.preventDefault();return;}
    draggedField=Number(handle.dataset.moveField);
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',draft.fields[draggedField].key);
  });
  $('asset-field-rows').addEventListener('dragover',event=>{
    clearFieldDrop();
    if(draggedField===null)return;
    event.preventDefault();event.dataTransfer.dropEffect='none';
    const target=fieldDrop(event);if(!target)return;
    event.dataTransfer.dropEffect='move';
    if(target.to!==draggedField)target.row.classList.add(target.after?'field-drop-after':'field-drop-before');
  });
  $('asset-field-rows').addEventListener('drop',event=>{
    const target=fieldDrop(event),from=draggedField;
    draggedField=null;clearFieldDrop();
    if(from!==null)event.preventDefault();
    if(!target||target.to===from)return;
    if(!canEdit())return;
    draft=moveAssetField(draft,from,target.to);setDirty(true);error();render();
  });
  $('asset-field-rows').addEventListener('dragend',()=>{draggedField=null;clearFieldDrop();});
  $('asset-field-rows').addEventListener('keydown',event=>{
    const handle=event.target.closest('[data-move-field]');
    if(!handle||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();if(!canEdit())return;
    const from=Number(handle.dataset.moveField),to=from+(event.key==='ArrowUp'?-1:1);
    if(to<1||to>=draft.fields.length)return;
    draft=moveAssetField(draft,from,to);setDirty(true);error();render();
    $('asset-field-rows').querySelector(`[data-move-field="${to}"]`)?.focus();
  });
  $('asset-field-rows').addEventListener('change',event=>{
    const input=event.target.closest('[data-field]');if(!input)return;
    if(!canEdit()){render();return;}
    try {
      draft=changeAssetField(draft,Number(input.dataset.field),fieldPatch(input),getWorkspace().enums);
      setDirty(true);error();render();
    } catch(cause) {error(cause.message);render();}
  });
  $('asset-field-rows').addEventListener('input',event=>{
    const input=event.target.closest('[data-field]');if(!input)return;
    if(!canEdit()){render();return;}
    try {
      draft=changeAssetField(draft,Number(input.dataset.field),fieldPatch(input),getWorkspace().enums);
      error();
    } catch(cause) {error(cause.message);}
    setDirty(true);
  });
  $('asset-field-rows').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-field]');if(!button)return;
    if(!canEdit())return;
    const index=Number(button.dataset.removeField);if(index===0||isDropCore(category(),draft.fields[index].key))return;
    const field=draft.fields[index];
    if(draft.rows.some(row=>row[field.key]!==undefined&&row[field.key]!==null&&row[field.key]!=='') && !confirm(`删除字段「${field.label}」也会删除这一列的数据。未保存前可放弃修改。是否继续？`))return;
    draft.fields.splice(index,1);draft.rows.forEach(row=>delete row[field.key]);setDirty(true);error();render();
  });
  $('asset-add-row').addEventListener('click',()=>{
    const cat=category();if(!cat||!canEdit())return;
    if(isDropCategory(cat)){onOpenDrops();return;}
    const id=nextAssetId(cat,draft.rows);
    if(id===null){error('此分类的 ID 范围已用满，请先调整分类范围。');return;}
    draft.rows.push(Object.fromEntries(draft.fields.map(field=>[field.key,field.key==='id'?id:field.type==='bool'?false:''])));
    setDirty(true);error();tab='data';render();
    $('asset-data-rows').querySelector('tr:last-child input')?.focus();
  });
  $('asset-data-rows').addEventListener('input',event=>{
    const input=event.target.closest('[data-record]');if(!input)return;
    if(input.type==='file'||input.dataset.pngClear!==undefined)return;
    if(!canEdit()){render();return;}
    const field=draft.fields[Number(input.dataset.column)];
    if(isDropCore(category(),field.key))return;
    if(input.dataset.rewardProperty)draft.rows[Number(input.dataset.record)][field.key][Number(input.dataset.rewardIndex)][input.dataset.rewardProperty]=input.value;
    else draft.rows[Number(input.dataset.record)][field.key]=input.value;
    if(input.dataset.rewardProperty==='probability')updateRewardProbability(input);
    setDirty(true);error();
  });
  $('asset-data-rows').addEventListener('error',event=>{if(event.target.matches('.reward-asset-thumb img'))event.target.hidden=true;},true);
  $('asset-data-rows').addEventListener('change',async event=>{
    const input=event.target;
    if(event.target.tagName==='SELECT')event.target.dispatchEvent(new Event('input',{bubbles:true}));
  });
  $('asset-data-rows').addEventListener('click',async event=>{
    const png=event.target.closest('[data-png-select]');
    if(png?.dataset.pngSelect!==undefined){
      if(uploading||!canEdit())return;
      const record=draft.rows[Number(png.dataset.record)],field=draft.fields[Number(png.dataset.column)];
      uploading=true;onDirty();error();
      try{const selected=await onSelectPng();if(selected!==null&&draft.rows.includes(record)&&draft.fields.includes(field)){record[field.key]=selected;setDirty(true);notify('已选择 PNG, 请保存资产表');}}
      catch(cause){error(cause.message);}finally{uploading=false;setDirty(dirty);render();}return;
    }
    const picker=event.target.closest('[data-reward-picker]');
    if(picker?.dataset.rewardPicker!==undefined){if(canEdit())openRewardPicker(picker,rewardAssets(getWorkspace()));return;}
    const clear=event.target.closest('[data-png-clear]');
    if(clear){if(!canEdit()||uploading)return;draft.rows[Number(clear.dataset.record)][draft.fields[Number(clear.dataset.column)].key]=null;setDirty(true);error();render();return;}
    const openDrop=event.target.closest('[data-open-drops]');if(openDrop){onOpenDrops(Number(openDrop.dataset.openDrops));return;}
    const reward=event.target.closest('[data-reward-add],[data-reward-remove]');
    if(reward&&(reward.dataset.rewardAdd!==undefined||reward.dataset.rewardRemove!==undefined)){
      if(!canEdit())return;
      const field=draft.fields[Number(reward.dataset.column)],record=draft.rows[Number(reward.dataset.record)];
      if(isDropCore(category(),field.key))return;
      if(!Array.isArray(record[field.key]))record[field.key]=[];
      if(reward.dataset.rewardAdd!==undefined)record[field.key].push({asset_id:'',count:1,probability:10000});else record[field.key].splice(Number(reward.dataset.rewardRemove),1);
      setDirty(true);error();render();return;
    }
    const button=event.target.closest('[data-remove-record]');if(!button)return;
    if(!canEdit())return;
    if(isDropCategory(category()))return;
    const id=Number(draft.rows[Number(button.dataset.removeRecord)].id);
    if(Object.values(getWorkspace().tables).some(table=>table.fields.some(field=>field.type==='asset_list'&&table.rows.some(row=>Array.isArray(row[field.key])&&row[field.key].some(reward=>reward.asset_id===id))))){error(`资产 ${id} 被奖励列表引用, 请先移除引用`);return;}
    draft.rows.splice(Number(button.dataset.removeRecord),1);setDirty(true);error();render();
  });
  $('asset-save').addEventListener('click',async()=>{
    if(uploading){error('正在选择 PNG, 请稍候再保存');return;}
    if(!canEdit())return;
    try {
      const saved=normalizeAssetTable(category(),draft,getWorkspace().enums);
      if(!await commit(key,saved))return;
      draft=clone(saved);setDirty(false);error();refresh();notify('资产表已保存到本地');
    } catch(cause) {error(cause.message);}
  });
  $('asset-discard').addEventListener('click',()=>{
    if(dirty&&!confirm('放弃当前资产表的未保存修改？'))return;
    if(key)draft=clone(getWorkspace().tables[key]);setDirty(false);error();render();
  });
  $('asset-export').addEventListener('click',()=>{if(key)onExport(key);});
  $('asset-download').addEventListener('click',()=>{if(key)onDownload(key);});
  refresh();
  return {open,refresh,hasUnsaved:()=>dirty||uploading,
    reset:()=>{key=null;setDirty(false);refresh();},
    snapshot:()=>({key,draft:clone(draft),dirty,tab}),
    restore:snapshot=>{if(!getWorkspace().categories.some(cat=>cat.key===snapshot.key))return;key=snapshot.key;draft=clone(snapshot.draft);tab=snapshot.tab;setDirty(snapshot.dirty);render();}
  };
}
