const progressKey=projectId=>{
  if(typeof projectId!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(projectId))throw new Error('存档项目标识无效');
  return 'asset-forge-game-progress:'+projectId+':v1';
};

// 存档损坏时保留原内容, 调用方根据 canSave 停止写入, 本局仍可在内存推进.
export function loadProgress(projectId,levels) {
  const key=progressKey(projectId);
  try {
    const raw=globalThis.localStorage.getItem(key);
    if(raw===null)return {completed:[],canSave:true,warning:''};
    const value=JSON.parse(raw);
    if(value?.version!==1||!Array.isArray(value.completed)||new Set(value.completed).size!==value.completed.length)throw new Error('进度格式无效');
    const ids=value.completed;
    if(ids.some(id=>!levels.some(level=>level.id===id)))throw new Error('存档包含不存在的关卡');
    for(let i=1;i<levels.length;i++)if(ids.includes(levels[i].id)&&!ids.includes(levels[i-1].id))throw new Error('关卡进度不连续');
    return {completed:levels.filter(level=>ids.includes(level.id)).map(level=>level.id),canSave:true,warning:''};
  }catch(error) {
    return {completed:[],canSave:false,warning:`存档读取失败: ${error.message}. 本次从第一关开始, 进度仅在当前页面保留.`};
  }
}

export function saveProgress(projectId,completed) {
  const key=progressKey(projectId);
  if(!Array.isArray(completed)||completed.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(completed).size!==completed.length)throw new Error('待保存的通关记录无效');
  try{globalThis.localStorage.setItem(key,JSON.stringify({version:1,completed}));return true;}
  catch{return false;}
}
