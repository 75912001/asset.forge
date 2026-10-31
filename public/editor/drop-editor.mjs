import {nextAssetId} from './assets.mjs';
import {normalizeWorkspace} from './workspace.mjs';
import {enableDrops,migrateLootBag,isDropCategory,saveDropPackage,deleteDropPackage,totalWeight} from './drops.mjs';
import {rewardAssets,rewardListHtml,updateRewardProbability,rewardProbabilityText} from './rewards.mjs';
import {pngCellHtml} from './png.mjs';
import {openRewardPicker} from './reward-picker.mjs';

export function mountDropEditor({getWorkspace,commit,onDirty,notify,canEdit,onBackup,onSelectPng}) {
  const $=id=>document.getElementById(id),clone=value=>JSON.parse(JSON.stringify(value));
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let pack=null,entries=[],dirty=false,uploading=false;
  const enabled=()=>getWorkspace().categories.some(isDropCategory);
  const category=key=>getWorkspace().categories.find(category=>category.key===key);
  function error(message=''){$('drop-error').textContent=message;$('drop-error').hidden=!message;}
  function setDirty(value){dirty=value;$('drop-save-state').textContent=value?'有未保存的修改':'已保存到本地';onDirty();}
  function probabilities() {
    if(pack?.selection_mode==='probability') {
      $('drop-total').textContent=`每条组合独立判定 · 可命中 0-${entries.length} 个组合`;
      entries.forEach((entry,index)=>{$(`drop-probability-${index}`).textContent=`组合概率: ${rewardProbabilityText(entry.probability)}`;});return;
    }
    const valid=entries.every(entry=>/^\d+$/.test(String(entry.weight))&&Number(entry.weight)>0&&Number(entry.weight)<=4294967295);
    const sum=valid?totalWeight(entries):0n;
    $('drop-total').textContent=sum?`总权重 ${sum} · 每次选中一个组合`:'填写大于 0 的 uint32 权重';
    entries.forEach((entry,index)=>{$(`drop-probability-${index}`).textContent=sum?`${entry.weight} / ${sum} ≈ ${(Number(BigInt(entry.weight)*1000000n/sum)/10000).toFixed(4)}%`:'权重无效';});
  }
  function scalar(field,value,attrs) {
    if(field.type==='png')return pngCellHtml(value,attrs,field.label);
    if(field.type==='asset_list')return rewardListHtml(value,rewardAssets(getWorkspace()),attrs);
    if(field.type==='bool')return `<select ${attrs}><option value="" ${value===null||value===''?'selected':''}>—</option>${[true,false].map(v=>`<option value="${v}" ${String(value)===String(v)?'selected':''}>${v}</option>`).join('')}</select>`;
    if(field.type==='enum') {
      const items=getWorkspace().enums.find(definition=>definition.key===field.enum)?.items||[],text=String(value??'');
      return `<select ${attrs}>${text!==''&&!items.some(item=>String(item.value)===text)?`<option value="${esc(text)}" selected>无效值: ${esc(text)}</option>`:''}<option value="" ${text===''?'selected':''}>请选择...</option>${items.map(item=>`<option value="${item.value}" ${text===String(item.value)?'selected':''}>${esc(item.label)} · ${item.value}</option>`).join('')}</select>`;
    }
    return `<input ${attrs} value="${esc(value??'')}" ${field.type!=='string'?'inputmode="numeric"':''}>`;
  }
  function custom(key,record,attrs) {
    const core=key==='drop_package'?['id','name','selection_mode']:['id','package_id','weight','probability','rewards'];
    return getWorkspace().tables[key].fields.filter(field=>!core.includes(field.key)).map(field=>{
      const tag=field.type==='png'?'div':'label';
      return `<${tag} class="drop-custom-field">${esc(field.label)} ${field.required?'<b>*</b>':''}${scalar(field,record[field.key],attrs+` ${key==='drop_package'?'data-drop-pack-field':'data-drop-field'}="${esc(field.key)}"`)}</${tag}>`;
    }).join('');
  }
  function render() {
    $('drop-workspace').inert=uploading;
    const active=enabled();$('drop-setup').hidden=active;$('drop-workspace').hidden=!active;
    if(!active){
      const legacy=category('loot_bag'),count=legacy?getWorkspace().tables.loot_bag.rows.length:0;
      $('drop-setup-title').textContent=legacy?'迁移现有掉落包分类':'启用掉落包结构';
      $('drop-package-range').hidden=!!legacy;$('drop-enable').hidden=!!legacy;$('drop-migrate').hidden=!legacy;
      $('drop-migration-summary').hidden=!legacy;
      $('drop-migration-summary').textContent=legacy?`复用 loot_bag: ID ${legacy.start}-${legacy.end}, ${count} 行已保存数据. 原分类位置、名称、说明和自定义字段保留, 标识改为 drop_package. 只新增 drop_entry, 请配置其独立范围.${count?' 当前旧表非空, 需要明确奖励条目映射后才能迁移, 不会猜测转换.':''}`:'';
      $('drop-migrate').disabled=count>0;
      return;
    }
    const workspace=getWorkspace(),packages=workspace.tables.drop_package.rows;
    $('drop-packages').innerHTML=packages.map(row=>`<button class="drop-package-item ${pack?.id===row.id?'selected':''}" data-drop-action="open" data-drop-id="${row.id}"><strong>${esc(row.name)}</strong><small>${row.id} · ${workspace.tables.drop_entry.rows.filter(entry=>entry.package_id===row.id).length} 个组合</small></button>`).join('')||'<p class="field-help">还没有掉落包. 创建一个包并添加奖励组合.</p>';
    $('drop-package-editor').hidden=!pack;$('drop-placeholder').hidden=!!pack;
    if(!pack)return;
    $('drop-package-id').textContent=pack.id;$('drop-package-name').value=pack.name;
    $('drop-mode-weight').checked=pack.selection_mode!=='probability';$('drop-mode-probability').checked=pack.selection_mode==='probability';
    $('drop-mode-help').textContent=pack.selection_mode==='probability'?'组合概率使用万分率, 10000 = 100%, 5000 = 50%.':'权重无需合计为 10000, 只比较相对大小.';
    $('drop-package-custom').innerHTML=custom('drop_package',pack,'');
    $('drop-delete').hidden=!packages.some(row=>row.id===pack.id);
    const assets=rewardAssets(workspace);
    const probabilityMode=pack.selection_mode==='probability',property=probabilityMode?'probability':'weight',label=probabilityMode?'组合概率 / 万分率':'权重';
    $('drop-entries').innerHTML=entries.map((entry,index)=>`<details class="drop-entry" open><summary><span>组合 ${index+1} <small>ID ${entry.id}</small></span><span id="drop-probability-${index}" class="drop-probability"></span></summary><div class="drop-entry-body"><div class="drop-entry-heading"><label>${label} <b>*</b><input data-drop-entry="${index}" data-drop-field="${property}" value="${esc(entry[property]??'')}" ${probabilityMode?'type="number" min="0" max="10000" step="1"':''} inputmode="numeric" aria-label="组合 ${index+1} ${probabilityMode?'概率(万分率)':'权重'}"></label><span class="field-help">${probabilityMode?'此组合独立判定, 10000 = 必定命中.':'按权重选中此组合.'} 命中后再独立判定下方各奖励项.</span><button class="delete-button" data-drop-action="remove-entry" data-drop-entry="${index}">删除组合</button></div>${rewardListHtml(entry.rewards,assets,`data-drop-entry="${index}"`)}<div class="drop-custom">${custom('drop_entry',entry,`data-drop-entry="${index}"`)}</div></div></details>`).join('')||'<div class="empty">至少添加一个非空奖励组合后才能保存.</div>';
    probabilities();
  }
  function load(id) {
    const workspace=getWorkspace();pack=clone(workspace.tables.drop_package.rows.find(row=>row.id===id)||null);
    entries=clone(workspace.tables.drop_entry.rows.filter(row=>row.package_id===id));setDirty(false);error();render();
  }
  function refresh() {
    if(!enabled()){if(!dirty){pack=null;entries=[];}render();return;}
    if(!dirty&&!uploading)load(pack&&getWorkspace().tables.drop_package.rows.some(row=>row.id===pack.id)?pack.id:getWorkspace().tables.drop_package.rows[0]?.id);
    else render();
  }
  const initial=key=>Object.fromEntries(getWorkspace().tables[key].fields.map(field=>[field.key,field.type==='bool'?false:field.type==='asset_list'?[]:'']));
  $('drops-view').addEventListener('input',event=>{
    const input=event.target,data=input.dataset;
    if(input.type==='file'||data.pngClear!==undefined)return;
    if(!canEdit()){render();return;}
    if(data.dropSetup!==undefined){setDirty(true);error();return;}
    const record=data.dropEntry!==undefined?entries[Number(data.dropEntry)]:pack;
    if(!record)return;
    const field=data.dropPackField||data.dropField;
    if(data.rewardProperty)record[field||'rewards'][Number(data.rewardIndex)][data.rewardProperty]=input.value;
    else if(field)record[field]=input.value;else return;
    setDirty(true);error();if(!data.rewardProperty&&['weight','probability'].includes(field))probabilities();
    if(field==='selection_mode')render();
    if(data.rewardProperty==='probability')updateRewardProbability(input);
  });
  $('drops-view').addEventListener('error',event=>{if(event.target.matches('.reward-asset-thumb img'))event.target.hidden=true;},true);
  $('drops-view').addEventListener('change',async event=>{
    const input=event.target,data=input.dataset;
    if(input.tagName==='SELECT')input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  $('drops-view').addEventListener('click',async event=>{
    if(uploading){error('正在选择 PNG, 请稍候');return;}
    const png=event.target.closest('[data-png-select]');
    if(png?.dataset.pngSelect!==undefined){
      if(!canEdit())return;
      const data=png.dataset,record=data.dropEntry!==undefined?entries[Number(data.dropEntry)]:pack,field=data.dropPackField||data.dropField;
      uploading=true;onDirty();error();
      try{const selected=await onSelectPng();if(selected!==null&&(record===pack||entries.includes(record))){record[field]=selected;setDirty(true);notify('已选择 PNG, 请保存掉落包');}}
      catch(cause){error(cause.message);}finally{uploading=false;setDirty(dirty);render();}return;
    }
    const picker=event.target.closest('[data-reward-picker]');
    if(picker?.dataset.rewardPicker!==undefined){if(canEdit())openRewardPicker(picker,rewardAssets(getWorkspace()));return;}
    const button=event.target.closest('[data-drop-action],[data-reward-add],[data-reward-remove],[data-png-clear]');if(!button)return;
    const data=button.dataset,action=data.dropAction;
    if(action==='discard'){if(dirty&&!confirm('放弃掉落包的未保存修改?'))return;dirty=false;refresh();setDirty(false);return;}
    if(!canEdit())return;
    try {
      if(data.pngClear!==undefined){const record=data.dropEntry!==undefined?entries[Number(data.dropEntry)]:pack;record[data.dropPackField||data.dropField]=null;setDirty(true);error();render();return;}
      if(action==='migrate') {
        const next=normalizeWorkspace(migrateLootBag(getWorkspace(),{start:$('drop-entry-start').value,end:$('drop-entry-end').value}));
        await onBackup();
        if(await commit(next)){setDirty(false);refresh();notify('loot_bag 已迁移为 drop_package, 原 ID 范围已保留');}return;
      }
      if(action==='enable') {
        const next=normalizeWorkspace(enableDrops(getWorkspace(),{start:$('drop-package-start').value,end:$('drop-package-end').value},{start:$('drop-entry-start').value,end:$('drop-entry-end').value}));
        if(await commit(next)){setDirty(false);refresh();notify('掉落包结构已启用, 原有表未改写');}return;
      }
      if(action==='open'||action==='new') {
        if(dirty&&!confirm('当前掉落包尚未保存, 放弃修改并切换?'))return;
        if(action==='open'){load(Number(data.dropId));return;}
        const id=nextAssetId(category('drop_package'),getWorkspace().tables.drop_package.rows);
        if(id===null)throw new Error('掉落包 ID 范围已用满');
        pack={...initial('drop_package'),id,name:'',selection_mode:'weight'};entries=[];setDirty(true);error();render();return;
      }
      if(!pack)return;
      if(action==='save') {
        const normalizedPack={...pack,id:Number(pack.id)},normalizedEntries=entries.map(entry=>({...entry,package_id:normalizedPack.id}));
        const next=normalizeWorkspace(saveDropPackage(getWorkspace(),normalizedPack,normalizedEntries));
        if(await commit(next)){setDirty(false);load(normalizedPack.id);notify('掉落包与全部条目已保存到本地');}return;
      }
      if(action==='delete') {
        const count=getWorkspace().tables.drop_entry.rows.filter(entry=>entry.package_id===pack.id).length;
        if(!confirm(`删除掉落包 "${pack.name}" 及其 ${count} 条已保存的所属条目?${dirty?' 当前包未保存的修改也将放弃.':''}`))return;
        if(await commit(normalizeWorkspace(deleteDropPackage(getWorkspace(),pack.id)))){pack=null;setDirty(false);refresh();notify('掉落包与所属条目已整体删除');}return;
      }
      if(action==='add-entry') {
        const used=[...getWorkspace().tables.drop_entry.rows.filter(row=>row.package_id!==pack.id),...entries];
        const id=nextAssetId(category('drop_entry'),used);if(id===null)throw new Error('掉落条目 ID 范围已用满');
        entries.push({...initial('drop_entry'),id,package_id:pack.id,weight:1,probability:10000,rewards:[{asset_id:'',count:1,probability:10000}]});
      } else if(action==='remove-entry')entries.splice(Number(data.dropEntry),1);
      else if(data.rewardAdd!==undefined||data.rewardRemove!==undefined) {
        const record=data.dropEntry!==undefined?entries[Number(data.dropEntry)]:pack,field=data.dropPackField||data.dropField||'rewards';
        if(!Array.isArray(record[field]))record[field]=[];
        if(data.rewardAdd!==undefined)record[field].push({asset_id:'',count:1,probability:10000});else record[field].splice(Number(data.rewardRemove),1);
      } else return;
      setDirty(true);error();render();
    }catch(cause){error(cause.message);}
  });
  refresh();
  return {refresh,open:id=>{if(uploading){error('正在选择 PNG, 请稍候');return;}if(dirty&&!confirm('当前掉落包尚未保存, 放弃修改并切换?'))return;load(id);},hasUnsaved:()=>dirty||uploading,reset:()=>{pack=null;entries=[];dirty=false;refresh();setDirty(false);},
    snapshot:()=>({pack:clone(pack),entries:clone(entries),dirty,setup:['package-start','package-end','entry-start','entry-end'].map(key=>$("drop-"+key).value)}),
    restore:snapshot=>{pack=snapshot.pack?{selection_mode:'weight',...clone(snapshot.pack)}:null;entries=clone(snapshot.entries).map(entry=>({probability:10000,...entry}));snapshot.setup?.forEach((value,index)=>{$('drop-'+['package-start','package-end','entry-start','entry-end'][index]).value=value;});setDirty(snapshot.dirty);render();}
  };
}
