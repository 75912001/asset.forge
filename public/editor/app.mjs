import { validateCategories, toYaml, UINT32_MAX } from './model.mjs';
import {assetTableYaml} from './assets.mjs';
import {readWorkspace,replaceCategories,replaceEnum,workspaceFiles} from './workspace.mjs';
import {mountAssetEditor} from './asset-editor.mjs';
import {enumsYaml} from './enums.mjs';
import {mountEnumEditor} from './enum-editor.mjs';
import {createCloudWorkspace} from './cloud.mjs';
import {mountDropEditor} from './drop-editor.mjs';
import {mountChestAppearanceEditor} from './chest-appearance-editor.mjs';
import {isDropCategory,assertDropTransition} from './drops.mjs';
import {selectPngResource} from './resource-picker.mjs';
import {mountProjects,currentProject,isLocalEditor,projectApi,projectStorageKey,projectNavigationBlocked} from './projects.mjs';

const $ = id => document.getElementById(id);
const colors = ['#6b9470','#c39860','#7c8ab6','#b58b94','#6d9e9a','#a49363'];
let rows=[],selected=0,dirty=false,directory=null,toastTimer;
let tables={};
let assetEditor=null,enumEditor=null,dropEditor=null,chestAppearanceEditor=null,enums=[],chestAppearances=[],workspaceReadFailed=false;
let localConfig=null;
let cloud=null,legacyWorkspace=null,legacyRaw=null,recovery=null,suspendDraft=true,draftTimer;
const getWorkspace=()=>({categories:rows,tables,enums,chestAppearances});
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(value).toLocaleString('en-US');

function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').hidden = true, 4200);
}
function errorAt(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function canLeave() { return !dirty || confirm('当前分类尚未保存，是否放弃这些修改？'); }
function draftState(value) {
  dirty = value;
  updateDraftStatus();
}
function anyUnsaved() {return dirty || !!assetEditor?.hasUnsaved() || !!enumEditor?.hasUnsaved() || !!dropEditor?.hasUnsaved() || !!chestAppearanceEditor?.hasUnsaved();}
function canEditAssets() {
  if(!canUseCloud())return false;
  if(chestAppearanceEditor?.hasUnsaved()){notify('请先保存宝箱外观或放弃其修改.');return false;}
  if(dropEditor?.hasUnsaved()){notify('请先保存掉落包或放弃其修改.');return false;}
  if(enumEditor?.hasUnsaved()){notify('请先保存枚举或放弃其修改, 再编辑分类或资产表.');return false;}
  return true;
}
function canUseCloud() {
  if(recovery){notify('发现本机未保存草稿, 请先恢复草稿或备份并加载本地');return false;}
  if(!cloud?.state.workspace||['saving','loading','signed-out','conflict'].includes(cloud.state.phase)){notify('请先完成本地连接、迁移或处理版本冲突');return false;}
  return true;
}
function draftSnapshot() {
  return {version:1,...(currentProject()?{projectId:currentProject().id}:{}),revision:cloud?.state.revision||0,workspace:getWorkspace(),category:{selected,dirty,form:formRow()},asset:assetEditor?.snapshot(),enumeration:enumEditor?.snapshot(),drops:dropEditor?.snapshot(),chestAppearance:chestAppearanceEditor?.snapshot()};
}
function rememberDraft(immediate=false) {
  if(suspendDraft||!cloud?.state.user)return;
  clearTimeout(draftTimer);
  if(!anyUnsaved()&&!recovery){try{localStorage.removeItem(projectStorageKey(`asset-forge-draft:${cloud.state.user.id}`));}catch{}return;}
  const write=()=>{try {
    const key=projectStorageKey(`asset-forge-draft:${cloud.state.user.id}`);
    if(anyUnsaved())localStorage.setItem(key,JSON.stringify(draftSnapshot()));else if(!recovery)localStorage.removeItem(key);
  }catch{notify('浏览器无法保存草稿副本, 请下载完整备份后再关闭页面.');}};
  if(immediate)write();else draftTimer=setTimeout(write,300);
}
function updateDraftStatus() {$('draft-status').innerHTML=`<i></i>${anyUnsaved()?'有未保存的修改':'已保存到本地'}`;rememberDraft();cloudStatus();}
function formRow() {
  return {name:$('category-name').value.trim(),key:$('category-key').value.trim(),start:$('category-start').value,end:$('category-end').value,description:$('category-description').value};
}
function updateCapacity() {
  const row = formRow();
  const valid = /^\d+$/.test(row.start) && /^\d+$/.test(row.end) && Number(row.start) <= Number(row.end) && Number(row.end) <= UINT32_MAX;
  $('capacity-hint').textContent = valid ? `可容纳 ${number(Number(row.end) - Number(row.start) + 1)} 个资产 ID` : '输入有效的起始与结束 ID 后显示容量';
}
function loadForm(index) {
  selected = index;
  const row = rows[index] || {name:'',key:'',start:'',end:'',description:''};
  for (const field of ['name','key','start','end','description']) $(`category-${field}`).value = row[field];
  $('form-title').textContent = index < 0 ? '新建分类' : '编辑分类';
  $('inspector-icon').textContent = row.key ? row.key[0].toUpperCase() : '+';
  $('delete-category').hidden = index < 0;
  $('delete-category').disabled=isDropCategory(row);$('category-key').disabled=isDropCategory(row);
  errorAt('form-error'); draftState(false); updateCapacity(); render();
}
function yamlMarkup(yaml) {
  return yaml.split('\n').map(line => {
    const match = /^(\s*(?:- )?\w+:)(.*)$/.exec(line);
    if (!match) return escapeHtml(line);
    const style = /^\s*\d+\s*$/.test(match[2]) ? 'yaml-number' : 'yaml-string';
    return `<span class="yaml-key">${escapeHtml(match[1])}</span><span class="${style}">${escapeHtml(match[2])}</span>`;
  }).join('\n');
}
function render() {
  const filter = $('search').value.trim().toLowerCase();
  const visible = rows.map((row,index)=>({row,index})).filter(({row})=>row.name.toLowerCase().includes(filter) || row.key.includes(filter));
  $('category-rows').innerHTML = visible.map(({row,index})=>`<tr class="category-row ${index === selected ? 'selected' : ''}" data-index="${index}"><td><div class="category-name"><span class="category-symbol" style="--color:${colors[index%colors.length]};--tint:${colors[index%colors.length]}15">${escapeHtml(row.key[0].toUpperCase())}</span><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.key)}</small></div></div></td><td class="id-range">${number(row.start)}<span>—</span>${number(row.end)}</td><td class="capacity">${number(row.end-row.start+1)}</td><td><button class="category-table-link" data-open-table="${escapeHtml(row.key)}" aria-label="打开${escapeHtml(row.name)}资产表">资产表</button><button class="row-chevron" aria-label="编辑${escapeHtml(row.name)}">›</button></td></tr>`).join('');
  $('empty').hidden = !!visible.length;
  for(const id of ['nav-count','list-count']) $(id).textContent = rows.length;
  $('stat-count').innerHTML = `${rows.length} <small>个分类</small>`;
  $('stat-allocated').innerHTML = `${number(rows.reduce((sum,row)=>sum+row.end-row.start+1,0))} <small>个 ID</small>`;
  const sorted = rows.map((row,index)=>({row,index})).sort((a,b)=>a.row.start-b.row.start);
  $('range-track').innerHTML = sorted.map(({row,index})=>`<div style="--color:${colors[index%colors.length]}" title="${escapeHtml(row.name)}: ${row.start}–${row.end}"></div>`).join('');
  $('range-legend').innerHTML = sorted.map(({row,index})=>`<span class="legend-item" style="--color:${colors[index%colors.length]}"><i></i>${escapeHtml(row.name)}</span>`).join('');
  $('yaml-preview').innerHTML = yamlMarkup(toYaml(rows));
  const scope=$('export-scope').value;
  $('export-scope').innerHTML='<option value="__all__">全部配置与资产表</option><option value="__enums__">枚举配置 · asset-enums.yaml</option><option value="__chest_appearances__">宝箱外观 · chest-appearances.yaml</option>'+rows.map(row=>`<option value="${escapeHtml(row.key)}">${escapeHtml(row.name)} · ${escapeHtml(row.key)}.yaml</option>`).join('');
  $('export-scope').value=['__enums__','__chest_appearances__'].includes(scope)||rows.some(row=>row.key===scope)?scope:'__all__';
  updateExportSummary();assetEditor?.refresh();enumEditor?.refresh();dropEditor?.refresh();chestAppearanceEditor?.refresh();
}
function updateExportSummary() {
  const cat=rows.find(row=>row.key===$('export-scope').value);
  $('export-summary').textContent=$('export-scope').value==='__chest_appearances__'?`chest-appearances.yaml / ${chestAppearances.length} 个外观`:$('export-scope').value==='__enums__'?`asset-enums.yaml / ${enums.length} 个枚举`:cat?`${cat.key}.yaml / ${tables[cat.key].rows.length} 行数据`:`${rows.length+3} 个 YAML 文件 / ${rows.reduce((sum,row)=>sum+tables[row.key].rows.length,0)} 行数据 / ${chestAppearances.length} 个宝箱外观`;
}
async function commitWorkspace(next) {
  try {
    if(!canUseCloud())return false;
    assertDropTransition(getWorkspace(),next);
    const saved=await cloud.save(next);rows=saved.categories;tables=saved.tables;enums=saved.enums;chestAppearances=saved.chestAppearances;return true;
  } catch(error) {rememberDraft(true);notify(`保存失败: ${error.message}`);errorAt('form-error',error.message);return false;}
}
async function persist(nextRows,rename) {
  if(!canEditAssets())return false;
  if(assetEditor?.hasUnsaved()){notify('请先保存资产表或放弃其修改，再修改分类。');return false;}
  try {return commitWorkspace(replaceCategories(getWorkspace(),nextRows,rename));}
  catch(error) {errorAt('form-error',error.message);notify(error.message);return false;}
}
function showView(view) {
  $('categories-view').hidden = view !== 'categories'; $('export-view').hidden = view !== 'export';$('assets-view').hidden=view!=='assets';
  $('enums-view').hidden=view!=='enums';
  $('drops-view').hidden=view!=='drops';
  $('chest-appearances-view').hidden=view!=='chest-appearances';
  $('breadcrumb').textContent = view === 'categories' ? '资产分类' : view==='assets'?'资产表':view==='enums'?'枚举管理':view==='drops'?'掉落包':view==='chest-appearances'?'宝箱外观':'导出配置';
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view === view));
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
$('category-rows').addEventListener('click', event => {
  const tableButton=event.target.closest('[data-open-table]');
  if(tableButton){assetEditor?.open(tableButton.dataset.openTable);return;}
  const row = event.target.closest('[data-index]');
  if (row && Number(row.dataset.index) !== selected && canLeave()) loadForm(Number(row.dataset.index));
});
$('search').addEventListener('input',render);
$('add-category').addEventListener('click',()=>{
  if(!canEditAssets())return;
  if (!canLeave()) return;
  loadForm(-1); $('category-name').focus();
  if (innerWidth < 980) $('category-form').scrollIntoView({behavior:'smooth',block:'center'});
});
$('category-form').addEventListener('input',()=>{if(!canEditAssets()){loadForm(selected);return;}draftState(true); updateCapacity(); errorAt('form-error');});
$('category-form').addEventListener('submit', async event => {
  event.preventDefault();
  const row = formRow();
  const next = [...rows];
  const index = selected < 0 ? rows.length : selected;
  next[index] = {...(selected<0?{}:rows[selected]),...row};
  const errors = validateCategories(next);
  if (errors.length) { errorAt('form-error',[...new Set(errors)].join('\n')); return; }
  next[index] = {...next[index],start:Number(row.start),end:Number(row.end)};
  const isNew=selected<0;
  const previousKey=isNew?null:rows[selected].key;
  if (!await persist(next,previousKey?{from:previousKey,to:row.key}:undefined)) return;
  loadForm(index); notify(isNew?'分类已保存，对应资产表已创建':'分类已保存，资产表数据已保留');
  if(isNew)assetEditor?.open(row.key,'fields');
});
$('delete-category').addEventListener('click',async()=>{
  if(!canEditAssets())return;
  if(isDropCategory(rows[selected])){notify('掉落分类是固定结构, 请在掉落包页面删除包及所属条目.');return;}
  if(assetEditor?.hasUnsaved()){notify('请先保存资产表或放弃其修改，再删除分类。');return;}
  if (selected < 0 || !confirm(`确定删除「${rows[selected].name}」分类及对应资产表（${tables[rows[selected].key].rows.length} 行数据）？`)) return;
  const next = rows.filter((_,index)=>index !== selected);
  if (!await persist(next)) return;
  loadForm(rows.length ? 0 : -1); notify('分类及对应资产表已删除');
});
$('copy-yaml').addEventListener('click',async()=>{
  if (anyUnsaved()) { notify('请先保存修改，再复制 YAML'); return; }
  try { await navigator.clipboard.writeText(toYaml(rows)); notify('YAML 已复制'); }
  catch { notify('复制未成功，请从 YAML 预览中手动复制。'); }
});

async function directoryStore(mode, handle) {
  const db = await new Promise((resolve,reject)=>{
    const request = indexedDB.open('asset-forge-files',1);
    request.onupgradeneeded = ()=>request.result.createObjectStore('settings');
    request.onsuccess = ()=>resolve(request.result); request.onerror = ()=>reject(request.error);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const transaction = db.transaction('settings',mode);
      const store = transaction.objectStore('settings');
      const request = mode === 'readonly' ? store.get('directory') : store.put(handle,'directory');
      transaction.oncomplete = ()=>resolve(request.result);
      transaction.onerror = ()=>reject(transaction.error); transaction.onabort = ()=>reject(transaction.error);
    });
  } finally { db.close(); }
}
function directoryState(message) {
  if(localConfig){$('directory-name').textContent=localConfig.exportRoot;$('directory-status').textContent=message||'导出到当前项目 cfg 目录, 只导出 YAML, 不复制 PNG.';$('choose-directory').textContent='查看目录';return;}
  $('directory-name').textContent = directory ? directory.name : '尚未选择目录';
  $('directory-status').textContent = message || (directory ? '目录已选中，点击导出时申请写入权限。' : '首次使用时，选择一个本地文件夹。');
  $('choose-directory').textContent = directory ? '更换目录' : '选择目录';
}
$('choose-directory').addEventListener('click',async()=>{
  if(localConfig){$('local-settings').hidden=false;$('local-export-root').focus();return;}
  if(isLocalEditor()){errorAt('export-error','当前项目目录尚未加载, 请重新加载页面.');return;}
  errorAt('export-error');
  if (!('showDirectoryPicker' in window)) { errorAt('export-error','当前浏览器不支持目录写入。请在桌面版 Chrome 或 Edge 中打开本站并选择目录。'); return; }
  const button = $('choose-directory');
  button.disabled = true;
  directoryState('正在等待系统目录选择器…');
  button.textContent = '正在选择…';
  try {
    directory = await window.showDirectoryPicker({id:'asset-forge-export',mode:'read'});
    directoryState();
    try { await directoryStore('readwrite',directory); notify('目录已选择并记住，导出时会申请写入权限'); }
    catch { directoryState('目录已选中，导出时申请写入权限；下次需重新选择。'); notify('目录已选中，但浏览器未能记住目录。'); }
  } catch (error) {
    directoryState(directory ? '保留原来的导出目录。' : '尚未连接目录。');
    const message = error.name === 'AbortError'
      ? '浏览器中止了目录选择，尚未向网页返回目录。选中目录后授权未完成，也会出现此情况。可在桌面版 Chrome 或 Edge 中重试，或使用“下载 YAML”。'
      : '选择目录失败。可在桌面版 Chrome 或 Edge 中重试，或使用“下载 YAML”。';
    errorAt('export-error',`${message}\n${error.name}: ${error.message}`);
  } finally { button.disabled = false; button.textContent = directory ? '更换目录' : '选择目录'; }
});
function validFilename() {
  const filename = $('export-filename').value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.ya?ml$/.test(filename)) throw new Error('请填写以 .yaml 或 .yml 结尾的文件名，仅含英文字母、数字、点、下划线和连字符。');
  return filename;
}
$('export-filename').addEventListener('input',()=>{
  errorAt('export-error');
  try { const name = validFilename(); localStorage.setItem(projectStorageKey('asset-forge-filename'),name); $('preview-filename').textContent = name; }
  catch { /* Input is validated again before exporting. */ }
});
async function exportYaml() {
  showView('export'); errorAt('export-error');
  if (anyUnsaved()) { errorAt('export-error','有未保存的分类, 枚举, 资产表, 掉落包或宝箱外观修改, 请先保存, 再导出.'); return; }
  if(isLocalEditor()&&(!canUseCloud()||!localConfig)){errorAt('export-error','请先连接当前项目并处理待恢复草稿或版本冲突.');return;}
  const button = $('export-now');
  let stage = '检查导出配置';
  try {
    const filename = validFilename();
    const scope=rows.find(row=>row.key===$('export-scope').value);
    const files=$('export-scope').value==='__chest_appearances__'?workspaceFiles(getWorkspace(),filename).filter(file=>file.name==='chest-appearances.yaml'):$('export-scope').value==='__enums__'?[{name:'asset-enums.yaml',content:enumsYaml(enums)}]:scope?[{name:`${scope.key}.yaml`,content:assetTableYaml(scope,tables[scope.key],enums)}]:workspaceFiles(getWorkspace(),filename);
    if(localConfig){
      button.disabled=true;
      const response=await fetch(projectApi('/export'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:$('export-scope').value,filename,expectedRevision:cloud.state.revision})}),result=await response.json();
      if(!response.ok)throw new Error(result.error||'本地导出失败');directoryState('已导出 '+result.files.length+' 个 YAML 文件. 原 PNG 文件未复制.');notify('YAML 已保存到 '+result.directory);return;
    }
    if (!directory) { errorAt('export-error','请先选择并授权导出目录。'); return; }
    button.disabled = true;
    stage = '申请写入权限';
    if (await directory.requestPermission({mode:'readwrite'}) !== 'granted') {
      errorAt('export-error','目录已选中，但写入权限未获批准。请允许此站点编辑文件后重试导出；所选目录已保留。');
      directoryState('目录已选中，尚未获得写入权限。'); return;
    }
    let completed=0;

    for(const entry of files) {
      stage = `创建 ${entry.name}（已完成 ${completed}/${files.length}）`;
      const parts=entry.name.split('/');let target=directory;
      for(const folder of parts.slice(0,-1))target=await target.getDirectoryHandle(folder,{create:true});
      const file = await target.getFileHandle(parts.at(-1),{create:true});
      stage = `打开 ${entry.name} 写入流（已完成 ${completed}/${files.length}）`;
      const stream = await file.createWritable();
      try { stage = `写入 ${entry.name}（已完成 ${completed}/${files.length}）`; await stream.write(entry.content);stage = `完成 ${entry.name} 保存`;await stream.close(); }
      catch(error){await stream.abort().catch(()=>{});throw error;}
      completed++;
    }
    directoryState(`最近导出: ${new Date().toLocaleTimeString('zh-CN')} · ${files.length} 个 YAML, 不复制 PNG`);
    notify(`已将 ${files.length} 个文件保存到 ${directory.name}`);
  } catch (error) {
    errorAt('export-error',`${stage}失败。所选目录已保留。\n${error.name}: ${error.message}`);
  } finally { button.disabled = false; }
}
$('export-top').addEventListener('click',exportYaml);
$('export-now').addEventListener('click',exportYaml);
$('export-scope').addEventListener('change',updateExportSummary);
$('download-yaml').addEventListener('click',()=>{
  errorAt('export-error');
  if (anyUnsaved()) { errorAt('export-error','有未保存修改，请先保存，再下载。'); return; }
  try {
    const filename = validFilename();
    const url = URL.createObjectURL(new Blob([toYaml(rows)],{type:'application/yaml;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    notify('已发起 YAML 下载，保存位置由浏览器决定。');
  } catch (error) { errorAt('export-error',error.message); }
});
window.addEventListener('beforeunload',event=>{rememberDraft(true);if(anyUnsaved()){event.preventDefault(); event.returnValue='';}});
await mountProjects({notify,canSwitch:()=>!currentProject()||!projectNavigationBlocked({unsaved:anyUnsaved(),recovery:!!recovery,phase:cloud?.state.phase||'loading'})});
try {
  const canReadLegacy=!isLocalEditor()||currentProject()?.legacyMigration===1;
  const current=canReadLegacy?localStorage.getItem('asset-forge-workspace-v2'):null,legacy=canReadLegacy?localStorage.getItem('asset-forge-categories-v1'):null;
  legacyRaw={workspace:current,categories:legacy};
  if(current||legacy)legacyWorkspace=readWorkspace(localStorage,[]);
  const filename = localStorage.getItem(projectStorageKey('asset-forge-filename'));
  if (filename) { $('export-filename').value=filename; $('preview-filename').textContent=filename; }
} catch { workspaceReadFailed=true;notify('旧本地数据读取失败, 请先下载备份. 不会清除原数据.'); }
rows=[];tables={};enums=[];chestAppearances=[];
loadForm(rows.length ? 0 : -1);
assetEditor=mountAssetEditor({
  onSelectPng:selectPngResource,
  onOpenDrops:id=>{if(id!==undefined)dropEditor.open(id);showView('drops');},
  getWorkspace,onDirty:updateDraftStatus,onOpen:()=>showView('assets'),notify,canEdit:canEditAssets,
  commit:async(key,table)=>{const ok=await commitWorkspace({...getWorkspace(),tables:{...tables,[key]:table}});if(ok)render();return ok;},
  onExport:key=>{$('export-scope').value=key;updateExportSummary();exportYaml();},
  onDownload:key=>{
    if(anyUnsaved()){notify('请先保存修改，再下载资产表');return;}
    try {
      const cat=rows.find(row=>row.key===key);
      const url=URL.createObjectURL(new Blob([assetTableYaml(cat,tables[key],enums)],{type:'application/yaml;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`${key}.yaml`;link.hidden=true;document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);notify(`已发起 ${key}.yaml 下载`);
    } catch(error){notify(error.message);}
  }
});
enumEditor=mountEnumEditor({
  getWorkspace,onDirty:updateDraftStatus,notify,
  canEdit:()=>{if(!canUseCloud())return false;if(dirty||assetEditor.hasUnsaved()||dropEditor?.hasUnsaved()||chestAppearanceEditor?.hasUnsaved()){notify('请先保存分类, 资产表, 掉落包和宝箱外观或放弃其修改, 再编辑枚举.');return false;}return true;},
  commit:async(key,definition)=>{const ok=await commitWorkspace(replaceEnum(getWorkspace(),key,definition));if(ok)render();return ok;},
  onExport:()=>{$('export-scope').value='__enums__';updateExportSummary();exportYaml();},
  onDownload:()=>{
    if(anyUnsaved()){notify('请先保存修改, 再下载枚举配置');return;}
    const url=URL.createObjectURL(new Blob([enumsYaml(enums)],{type:'application/yaml;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='asset-enums.yaml';link.hidden=true;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);notify('已发起 asset-enums.yaml 下载');
  }
});
dropEditor=mountDropEditor({getWorkspace,onDirty:updateDraftStatus,notify,onBackup:downloadBackup,
  onSelectPng:selectPngResource,
  canEdit:()=>{if(!canUseCloud())return false;if(dirty||assetEditor.hasUnsaved()||enumEditor.hasUnsaved()||chestAppearanceEditor?.hasUnsaved()){notify('请先保存分类, 资产表, 枚举和宝箱外观或放弃其修改, 再编辑掉落包.');return false;}return true;},
  commit:async next=>{const ok=await commitWorkspace(next);if(ok)render();return ok;}
});
chestAppearanceEditor=mountChestAppearanceEditor({getWorkspace,onDirty:updateDraftStatus,notify,onSelectPng:selectPngResource,
  canEdit:()=>{if(!canUseCloud())return false;if(dirty||assetEditor.hasUnsaved()||enumEditor.hasUnsaved()||dropEditor.hasUnsaved()){notify('请先保存分类, 资产表, 枚举和掉落包或放弃其修改, 再编辑宝箱外观.');return false;}return true;},
  commit:async next=>{const ok=await commitWorkspace(next);if(ok)render();return ok;}
});
function downloadBackup() {
  rememberDraft(true);
  const backup={format:'asset-forge-backup',version:1,createdAt:new Date().toISOString(),...(currentProject()?{project:currentProject()}:{}),current:draftSnapshot(),recovery,legacy:legacyRaw,
    storedDraft:cloud?.state.user?localStorage.getItem(projectStorageKey(`asset-forge-draft:${cloud.state.user.id}`)):null};
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`asset-forge-backup-${currentProject()?currentProject().id+'-':''}${Date.now()}.json`;link.hidden=true;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function cloudStatus() {
  if(!cloud)return;
  const state=cloud.state;
  if(isLocalEditor()&&!currentProject()) {
    $('cloud-title').textContent='请先选择或新建项目';$('cloud-detail').textContent='项目列表位于侧栏, 每个项目的数据和资源独立保存.';
    for(const id of ['cloud-login','cloud-migrate','cloud-restore','cloud-reload','cloud-backup'])$(id).hidden=true;
    return;
  }
  const titles={loading:'正在连接本地...',waiting:'等待原电脑迁移',ready:'已连接本地工作区',saving:'正在保存到本地...',conflict:'本地版本冲突',error:'本地连接或保存失败','signed-out':'请先登录账号'};
  $('cloud-title').textContent=recovery?'发现本机未保存草稿':titles[state.phase];
  $('cloud-detail').textContent=state.phase==='waiting'?'当前账号还没有本地数据. 请在保留旧数据的原浏览器打开原网址, 备份后迁移.':`${currentProject()?.name||state.user?.name||'登录后按账号读取数据'}${state.revision?' · 版本 '+state.revision:''}${state.updatedAt?' · '+new Date(state.updatedAt).toLocaleString('zh-CN'):''}`;
  $('cloud-version').textContent=state.revision?`v${state.revision}`:'CLOUD';
  errorAt('cloud-error',state.error);
  $('cloud-login').hidden=state.phase!=='signed-out';
  $('cloud-migrate').hidden=!!state.workspace||!legacyWorkspace||!state.user;
  $('cloud-migrate').disabled=['saving','loading','conflict'].includes(state.phase)||workspaceReadFailed;
  $('cloud-reload').disabled=['saving','loading'].includes(state.phase);
  $('cloud-reload').textContent=state.phase==='conflict'||recovery||anyUnsaved()?'备份本机并加载本地':'加载最新本地';
  $('cloud-restore').hidden=!recovery;
  $('cloud-legacy-summary').hidden=!legacyWorkspace&&!workspaceReadFailed;
  $('cloud-legacy-summary').textContent=legacyWorkspace?`检测到本机旧数据: ${legacyWorkspace.categories.length} 个分类, ${legacyWorkspace.enums.length} 个枚举, ${Object.values(legacyWorkspace.tables).reduce((count,table)=>count+table.rows.length,0)} 行资产. 原数据将保留, 不会自动覆盖本地.`:'旧本地数据读取失败. 请先下载完整备份, 原数据不会删除.';
  $('workspace-content').hidden=!state.workspace||state.phase==='signed-out';
  $('workspace-content').inert=['saving','loading','conflict'].includes(state.phase)||!!recovery;
  if(localConfig||isLocalEditor()){$('cloud-legacy-summary').hidden=true;$('cloud-migrate').hidden=true;}
  if(state.phase!=='ready')$('draft-status').textContent=titles[state.phase];
  if(recovery)$('draft-status').textContent='本机草稿待处理';
}
function applyCloud(workspace) {
  suspendDraft=true;
  rows=workspace?.categories||[];tables=workspace?.tables||{};enums=workspace?.enums||[];chestAppearances=workspace?.chestAppearances||[];
  loadForm(rows.length?0:-1);assetEditor.reset();enumEditor.reset();dropEditor.reset();chestAppearanceEditor.reset();
  suspendDraft=false;cloudStatus();
}
async function reloadCloud(discard=false) {
  const previousUser=cloud.state.user?.id;
  if(discard&&(anyUnsaved()||recovery)) {
    downloadBackup();
    if(!confirm('已发起完整草稿备份下载. 确认放弃本机未保存修改并加载最新本地?'))return;
  }
  try {
    const workspace=await cloud.load();
    suspendDraft=true;
    if(discard&&previousUser===cloud.state.user.id){localStorage.removeItem(projectStorageKey(`asset-forge-draft:${previousUser}`));recovery=null;}
    else {try{recovery=JSON.parse(localStorage.getItem(projectStorageKey(`asset-forge-draft:${cloud.state.user.id}`))||'null');}catch{recovery={invalid:true};notify('本机草稿副本读取失败, 请下载完整备份.');}}
    applyCloud(workspace);
  } catch {cloudStatus();}
}
$('cloud-backup').addEventListener('click',()=>{downloadBackup();notify('已发起完整备份下载');});
$('cloud-reload').addEventListener('click',()=>reloadCloud(true));
$('cloud-migrate').addEventListener('click',async()=>{
  if(!legacyWorkspace||workspaceReadFailed||cloud.state.workspace)return;
  try {
    downloadBackup();
    const workspace=await cloud.migrate(legacyWorkspace);
    applyCloud(workspace);notify('旧工作区已迁移到本地. 原浏览器数据已保留.');
  } catch(error) {notify(error.message);cloudStatus();}
});
$('cloud-restore').addEventListener('click',()=>{
  if(!recovery)return;
  const snapshot=recovery,remoteRevision=cloud.state.revision;
  try {
    if(snapshot.invalid||isLocalEditor()&&snapshot.projectId&&snapshot.projectId!==currentProject().id)throw new Error('草稿项目或格式不一致');
    applyCloud(snapshot.workspace);suspendDraft=true;cloud.state.revision=snapshot.revision;
    loadForm(snapshot.category.selected);
    for(const [key,value] of Object.entries(snapshot.category.form))$(`category-${key}`).value=value;
    dirty=snapshot.category.dirty;
    if(snapshot.asset)assetEditor.restore(snapshot.asset);
    if(snapshot.enumeration)enumEditor.restore(snapshot.enumeration);
    if(snapshot.drops)dropEditor.restore(snapshot.drops);
    if(snapshot.chestAppearance)chestAppearanceEditor.restore(snapshot.chestAppearance);
    recovery=null;suspendDraft=false;
    if(snapshot.revision!==remoteRevision){cloud.state.phase='conflict';cloud.state.error='本机草稿基于旧版本. 请备份后加载最新本地, 手工重做需要保留的修改.';}
    updateDraftStatus();cloudStatus();
  }catch(error){suspendDraft=false;notify(`恢复失败: ${error.message}. 请先下载完整备份.`);}
});
cloud=createCloudWorkspace({storage:localStorage,onChange:cloudStatus});
if(!isLocalEditor()||currentProject())await reloadCloud();else cloudStatus();
if(!isLocalEditor())try {
  directory = await directoryStore('readonly');
  const permission = directory && await directory.queryPermission({mode:'readwrite'});
  directoryState(directory && permission !== 'granted' ? '已记住目录，导出时可能需要重新授权。' : undefined);
} catch { directoryState('浏览器无法读取已记住的目录，请重新选择。'); }

if(!isLocalEditor()||currentProject())try {
  const response=await fetch(projectApi('/local-config'));if(response.ok){localConfig=await response.json();$('local-resource-root').value=localConfig.resourcesRoot;$('local-export-root').value=localConfig.exportRoot;directoryState();cloudStatus();}
  else if(isLocalEditor())throw new Error('项目目录读取失败, 请重新加载页面.');
}catch(error){if(isLocalEditor())notify(error.message);}
$('local-settings-toggle').addEventListener('click',()=>{$('local-settings').hidden=!$('local-settings').hidden;});
$('local-settings-save').addEventListener('click',async()=>{
  if(isLocalEditor())return;
  if(anyUnsaved()){notify('请先保存或放弃未保存的修改, 再更换目录.');return;}
  try{const response=await fetch('/api/local-config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({resourcesRoot:$('local-resource-root').value,exportRoot:$('local-export-root').value})}),result=await response.json();if(!response.ok)throw new Error(result.error);localConfig=result;directoryState();render();notify('目录设置已保存');}catch(error){notify(error.message);}
});
if(isLocalEditor()) {
  $('local-settings-toggle').textContent='项目目录';$('local-settings-save').hidden=true;
  $('local-resource-root').readOnly=true;$('local-export-root').readOnly=true;
}
