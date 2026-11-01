import {projectApi} from './projects.mjs';
export const PNG_MAX_BYTES=2*1024*1024;
export function normalizePngReference(value) {
  if(typeof value!=='string'||value.length>2048||!value||!value.toLowerCase().endsWith('.png')||/[\\:*?"<>|\u0000-\u001f]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('请使用资源目录内 PNG 的相对路径, 例如 equipment/hat.png');
  return value;
}
export function isPngReference(value){try{normalizePngReference(value);return true;}catch{return false;}}
export function inspectPng(bytes) {
  if(bytes.byteLength>PNG_MAX_BYTES)throw new Error('PNG 图片不能超过 2 MB');
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.length<45||!signature.every((byte,i)=>bytes[i]===byte))throw new Error('文件不是有效的 PNG 图片');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset=8,width,height,hasData=false;
  while(offset+12<=bytes.length) {
    const length=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(offset+12+length>bytes.length)break;
    if(offset===8) {
      if(type!=='IHDR'||length!==13)break;
      width=view.getUint32(offset+8);height=view.getUint32(offset+12);
      if(!width||!height||width>4096||height>4096)throw new Error('PNG 尺寸需在 1-4096 像素之间');
    }
    if(type==='IDAT'&&length)hasData=true;
    if(type==='IEND'&&length===0&&offset+12===bytes.length&&hasData)return {width,height};
    offset+=12+length;
  }
  throw new Error('PNG 文件不完整或格式无效');
}
export const pngUrl=path=>projectApi('/images')+'?file='+encodeURIComponent(normalizePngReference(path));
export function pngCellHtml(value,attrs,label) {
  const valid=isPngReference(value);
  const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<div class="png-cell">${valid?`<img src="${pngUrl(value)}" alt="${esc(label)}" width="48" height="48" loading="lazy">`:'<span class="png-placeholder" aria-hidden="true">PNG</span>'}<div class="png-actions"><button type="button" class="png-upload" data-png-select ${attrs} aria-label="${esc(label)} - 选择 PNG">${valid?'更换图片':'选择 PNG'}</button>${value?`<button class="text-button" data-png-clear ${attrs} aria-label="${esc(label)} - 清空引用">清空引用</button>`:''}<small class="png-path" title="${esc(value||'')}">${esc(value||'引用原文件, 不复制')}</small></div></div>`;
}
export function pngReferences(workspace,keys=workspace.categories.map(cat=>cat.key)) {
  const paths=new Set();
  for(const key of keys) {
    const table=workspace.tables[key];
    for(const field of table.fields.filter(field=>field.type==='png'))for(const row of table.rows)if(row[field.key])paths.add(normalizePngReference(row[field.key]));
  }
  for(const appearance of workspace.chestAppearances||[])paths.add(normalizePngReference(appearance.icon));
  return [...paths];
}
