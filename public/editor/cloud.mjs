import {normalizeWorkspace} from './workspace.mjs';
import {projectApi,projectStorageKey} from './projects.mjs';
export function createCloudWorkspace({storage,request=(...args)=>fetch(...args),onChange=()=>{}}) {
  const state={phase:'loading',workspace:null,revision:0,user:null,error:''};
  const change=patch=>{Object.assign(state,patch);onChange(state);};
  async function send(path,options) {
    let response;
    try {response=await request(path,{credentials:'same-origin',cache:'no-store',...options});}
    catch {throw new Error('无法连接本地. 本机草稿已保留, 请检查网络后重试.');}
    let data;try{data=await response.json();}catch{throw new Error('本地返回异常, 本机草稿已保留. 请刷新登录后重试.');}
    if(!response.ok){const error=new Error(data.error||'本地保存失败');error.status=response.status;throw error;}
    return data;
  }
  function accept(data) {
    if(!data.user?.id||!Number.isSafeInteger(data.revision))throw new Error('本地账号或版本信息无效');
    const workspace=data.workspace===null?null:normalizeWorkspace(data.workspace);
    if(workspace) {
      try {storage.setItem(projectStorageKey(`asset-forge-cloud:${data.user.id}`),JSON.stringify({...data,workspace}));}catch{/* Cloud save remains valid if browser cache is full. */}
    }
    change({...data,workspace,error:'',phase:workspace?'ready':'waiting'});
    return workspace;
  }
  function failed(error) {
    change({error:error.message,phase:error.status===401?'signed-out':error.status===409?'conflict':'error'});
    throw error;
  }
  async function write(workspace,migrate) {
    if(!state.user||(!migrate&&!state.workspace))throw new Error('请先在原浏览器完成旧数据迁移');
    if(state.phase==='saving'||state.phase==='loading')throw new Error('正在连接本地, 请稍候');
    if(state.phase==='conflict')throw new Error('请先备份本机草稿并加载最新本地版本');
    const body={workspace:normalizeWorkspace(workspace),expectedRevision:migrate?0:state.revision,expectedUserId:state.user.id};
    if(migrate) {
      const key=projectStorageKey(`asset-forge-migration:${state.user.id}`);
      body.requestId=storage.getItem(key)||crypto.randomUUID();storage.setItem(key,body.requestId);
    }
    change({phase:'saving',error:''});
    try {
      const data=await send(projectApi(migrate?'/workspace/migrate':'/workspace'),{method:migrate?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(data.user?.id!==state.user.id)throw new Error('登录账号发生变化, 请备份草稿并重新加载');
      return accept(data);
    } catch(error) {return failed(error);}
  }
  return {state,
    async load(){change({phase:'loading',error:''});try{return accept(await send(projectApi('/workspace')));}catch(error){return failed(error);}},
    save:workspace=>write(workspace,false),migrate:workspace=>write(workspace,true)
  };
}
