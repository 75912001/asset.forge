import {inspectPng,pngUrl} from './png.mjs';

export function validateHeroPixels(pixels,width,height,size) {
  if(width!==size||height!==size)throw new Error(`资源必须为 ${size} x ${size} 像素`);
  if(pixels.length!==width*height*4)throw new Error('图片像素数据无效');
  let transparent=false,visible=false;
  for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)transparent=true;if(pixels[i]>0)visible=true;}
  if(!visible)throw new Error('图片必须包含可见内容');
  if(!transparent)throw new Error('图片必须具有真实透明背景');
}

// 先验证实际 PNG 字节, 再解码检查 alpha. Blob URL 始终释放, 不更改原资源.
export async function loadHeroImage(path,size,resourceUrl=pngUrl(path)) {
  const response=await fetch(resourceUrl,{cache:'no-store'});
  if(!response.ok)throw new Error('无法读取 PNG 资源');
  const bytes=new Uint8Array(await response.arrayBuffer()),info=inspectPng(bytes);
  if(info.width!==size||info.height!==size)throw new Error(`资源必须为 ${size} x ${size} 像素`);
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  try {
    const image=new Image();image.src=url;await image.decode();
    const probe=document.createElement('canvas');probe.width=probe.height=size;
    const context=probe.getContext('2d');context.drawImage(image,0,0);
    validateHeroPixels(context.getImageData(0,0,size,size).data,image.naturalWidth,image.naturalHeight,size);
    return image;
  }finally{URL.revokeObjectURL(url);}
}
