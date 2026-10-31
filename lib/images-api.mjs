import {normalizePngReference,inspectPng,PNG_MAX_BYTES} from '../public/editor/png.mjs';
export const imageStorageKey=(owner,path)=>encodeURIComponent(owner)+'/'+normalizePngReference(path);
export async function handleImageRequest(request,bucket) {
  const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
  const json=(data,status)=>Response.json(data,{status,headers});
  const owner=request.headers.get('oai-authenticated-user-id');
  if(!owner)return json({error:'请先使用 ChatGPT 登录'},401);
  if(!bucket)return json({error:'图片存储暂不可用, 请稍后重试'},503);
  try {
    const url=new URL(request.url);
    if(request.method==='GET') {
      let path;try{path=normalizePngReference(url.searchParams.get('file'));}catch{return json({error:'图片路径无效'},400);}
      const image=await bucket.get(imageStorageKey(owner,path));
      return image?new Response(image.body,{headers:{...headers,'Content-Type':'image/png'}}):json({error:'图片不存在或无权访问'},404);
    }
    if(request.method!=='POST')return json({error:'不支持此请求方法'},405);
    if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'仅允许本站上传'},403);
    if(request.headers.get('x-expected-user-id')&&request.headers.get('x-expected-user-id')!==owner)return json({error:'登录账号发生变化, 请重新加载云端'},409);
    if(request.headers.get('content-type')!=='image/png')return json({error:'只支持 PNG 图片'},400);
    if(Number(request.headers.get('content-length'))>PNG_MAX_BYTES)return json({error:'PNG 图片不能超过 2 MB'},413);
    const parts=[];let size=0;
    if(!request.body)return json({error:'请选择 PNG 图片'},400);
    const reader=request.body.getReader();
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>PNG_MAX_BYTES){await reader.cancel();return json({error:'PNG 图片不能超过 2 MB'},413);}parts.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    try{inspectPng(bytes);}catch(error){return json({error:error.message},400);}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const path=`images/${hash}.png`;
    await bucket.put(imageStorageKey(owner,path),bytes,{httpMetadata:{contentType:'image/png'}});
    return json({path},200);
  }catch(error){console.error('PNG storage failed',error);return json({error:'图片存储失败, 请重试. 原图片未修改.'},503);}
}
