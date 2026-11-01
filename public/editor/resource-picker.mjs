import {pngUrl} from './png.mjs';
import {projectApi,isLocalEditor} from './projects.mjs';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function selectPngResource() {
  const response=await fetch(projectApi('/resources'),{cache:'no-store'}),data=await response.json();
  if(!response.ok)throw new Error(data.error||'无法读取资源目录');
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='resource-dialog';dialog.setAttribute('aria-label','选择 PNG 资源');
    dialog.innerHTML=`<div class="resource-heading"><div><h2>选择 PNG 资源</h2><p></p></div><button class="table-icon-button" aria-label="关闭资源选择">×</button></div><input type="search" aria-label="搜索 PNG 资源" placeholder="搜索文件名或相对路径"><p class="resource-count"></p><div class="resource-options" role="listbox" aria-label="PNG 文件"></div><p class="field-help">只保存相对路径, 直接读取原文件. 不上传、不复制资源.</p>`;
    dialog.querySelector('.resource-heading p').textContent=data.root;
    const input=dialog.querySelector('input'),list=dialog.querySelector('.resource-options');
    function close(value=null){dialog.close();dialog.remove();resolve(value);}
    function render(){const matches=data.paths.filter(path=>path.toLowerCase().includes(input.value.trim().toLowerCase()));dialog.querySelector('.resource-count').textContent=`${matches.length} 个 PNG${matches.length>100?' · 显示前 100 个, 请搜索缩小范围':''}`;list.innerHTML=matches.slice(0,100).map(path=>`<button type="button" role="option" class="resource-option" data-resource-path="${esc(path)}"><img src="${pngUrl(path)}" alt="" width="48" height="48" loading="lazy"><span>${esc(path)}</span></button>`).join('')||`<p class="empty">未找到 PNG. 请将原资源放入上方目录${isLocalEditor()?'.':', 或在目录设置中指定已有资源文件夹.'}</p>`;}
    input.addEventListener('input',render);
    dialog.addEventListener('click',event=>{const option=event.target.closest('[data-resource-path]');if(option)close(option.dataset.resourcePath);else if(event.target.closest('[aria-label="关闭资源选择"]'))close();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('keydown',event=>{const choices=[...list.querySelectorAll('[role="option"]')],index=choices.indexOf(document.activeElement);if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();choices[index<0?0:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length]?.focus();}});
    document.body.append(dialog);render();dialog.showModal();input.focus();
  });
}
