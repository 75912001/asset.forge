let current=null;
export const isLocalEditor=()=>globalThis.window?.assetForgeLocal===true;
export const currentProject=()=>isLocalEditor()?current:null;
// 页面导航时重新初始化项目上下文. 每个标签页都有自己的上下文, 不共享服务端选中状态.
export function projectApi(path) {
  if(!isLocalEditor())return '/api'+path;
  if(!current)throw new Error('请先选择或新建项目');
  return '/api/projects/'+encodeURIComponent(current.id)+path;
}
export const projectStorageKey=key=>isLocalEditor()?`${key}:project:${current?.id||'none'}`:key;
export function projectNavigationBlocked({unsaved,recovery,phase}) {
  return unsaved||recovery||['saving','loading'].includes(phase);
}
export async function mountProjects({canSwitch,notify}) {
  if(!isLocalEditor())return;
  current=null;
  const $=id=>document.getElementById(id),esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  $('project-controls').hidden=false;$('project-placeholder').hidden=true;
  const selector=$('project-select'),dialog=$('project-dialog'),form=$('project-form'),testButton=$('project-test');
  let gameUrl=null;
  testButton.disabled=true;testButton.title='请先选择已配置游戏入口的项目';
  const showError=message=>{$('project-error').textContent=message;$('project-error').hidden=!message;};
  function remember(id){try{localStorage.setItem('asset-forge-last-project',id);}catch{/* 记忆偏好失败不影响项目数据. */}}
  function navigate(id){remember(id);window.location.assign('/?project='+encodeURIComponent(id));}
  function allowed(){if(canSwitch())return true;notify('请先保存或放弃当前项目的修改, 并处理待恢复草稿, 再切换或新建项目.');return false;}
  selector.addEventListener('change',()=>{const next=selector.value;selector.value=current?.id||'';if(next&&next!==current?.id&&allowed())navigate(next);});
  let editing=false;
  function open(rename) {
    if(!rename&&!allowed())return;
    editing=rename;$('project-dialog-title').textContent=rename?'修改项目名称':'新建项目';
    $('project-id').value=rename?current.id:'';$('project-id').readOnly=rename;
    $('project-name').value=rename?current.name:'';
    $('project-form-error').hidden=true;dialog.showModal();(rename?$('project-name'):$('project-id')).focus();
  }
  $('project-new').addEventListener('click',()=>open(false));
  $('project-rename').addEventListener('click',()=>open(true));
  testButton.addEventListener('click',()=>{
    if(!current||!gameUrl)return;
    if(!canSwitch()){notify('请先保存或放弃当前项目的修改, 并处理待恢复草稿, 再测试游戏.');return;}
    // 入口提前检查, 点击时同步打开窗口, 保留浏览器的用户操作授权.
    const popup=window.open(gameUrl,'asset-forge-game-'+current.id,'popup=yes,width=1280,height=900,resizable=yes,scrollbars=yes');
    if(!popup){notify('游戏弹窗被浏览器拦截, 请允许本站弹窗后再点击测试.');return;}
    popup.opener=null;popup.focus();
  });
  $('project-cancel').addEventListener('click',()=>dialog.close());
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!editing&&!allowed())return;
    const button=$('project-submit');button.disabled=true;
    try {
      const response=await fetch(editing?'/api/projects/'+encodeURIComponent(current.id):'/api/projects',{method:editing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(editing?{name:$('project-name').value}:{id:$('project-id').value,name:$('project-name').value})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'项目保存失败');
      if(editing) {
        current=data.project;selector.querySelector(`option[value="${current.id}"]`).textContent=current.name;
        document.title=current.name+' · Asset Forge';dialog.close();notify('项目名称已保存');
      } else navigate(data.project.id);
    } catch(error){$('project-form-error').textContent=error.message;$('project-form-error').hidden=false;}
    finally{button.disabled=false;}
  });
  try {
    const response=await fetch('/api/projects',{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'无法读取项目列表');
    const requested=new URL(window.location.href).searchParams.get('project');
    let remembered;try{remembered=localStorage.getItem('asset-forge-last-project');}catch{}
    const id=requested||data.projects.find(project=>project.id===remembered)?.id||data.projects[0]?.id;
    selector.innerHTML='<option value="">选择项目</option>'+data.projects.map(project=>`<option value="${esc(project.id)}">${esc(project.name)}</option>`).join('');
    current=data.projects.find(project=>project.id===id)||null;
    if(!current) {
      selector.value='';$('project-rename').disabled=true;$('local-settings-toggle').hidden=true;
      showError(requested?'项目不存在, 请从项目列表重新选择.':'暂无项目, 点击"新建项目"开始管理资产.');return;
    }
    selector.value=current.id;$('project-current-id').textContent=current.id;
    remember(current.id);
    window.history.replaceState(null,'','/?project='+encodeURIComponent(current.id));
    document.title=current.name+' · Asset Forge';
    try {
      const response=await fetch(projectApi('/game'),{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'无法检查游戏入口');
      gameUrl=data.available?data.url:null;
      testButton.disabled=!gameUrl;
      testButton.title=gameUrl?'打开当前项目的游戏, 使用已保存配置':'当前项目尚未添加 game/index.html 游戏入口';
    } catch(error){testButton.title=error.message;notify('游戏入口检查失败: '+error.message);}
    // 旧浏览器草稿仅映射到迁移得到的 mmorpg. 原存储保持不变, 不自动提交数据.
    if(current.legacyMigration===1)try {
      const importMarker=projectStorageKey('asset-forge-legacy-browser-imported');
      if(!localStorage.getItem(importMarker)) {
        for(const key of ['asset-forge-draft:local-workspace','asset-forge-filename']) {
          const old=localStorage.getItem(key),target=projectStorageKey(key);if(old&&!localStorage.getItem(target))localStorage.setItem(target,old);
        }
        localStorage.setItem(importMarker,'1');
      }
    }catch{notify('旧浏览器草稿读取失败, 请保留原浏览器数据并下载备份.');}
    showError('');
  } catch(error){showError(error.message);$('project-rename').disabled=true;}
}
