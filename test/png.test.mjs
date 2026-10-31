import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAssetTable,assetTableYaml} from '../public/editor/assets.mjs';
const png=await import('../public/editor/png.mjs').catch(()=>({}));
const api=await import('../lib/images-api.mjs').catch(()=>({}));
const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=','base64'));
const ref='images/'+'a'.repeat(64)+'.png';
const category={key:'base',name:'基础数值',start:0,end:9};
const table={fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'icon',label:'图标',type:'png',required:false}],rows:[{id:1,icon:ref},{id:2,icon:''}]};

test('PNG fields preserve references, optional blanks and quoted relative YAML paths',()=>{
  const saved=normalizeAssetTable(category,table);
  assert.deepEqual(saved.rows,[{id:1,icon:ref},{id:2,icon:null}]);
  assert.match(assetTableYaml(category,saved),new RegExp('icon: "'+ref+'"'));
  assert.match(assetTableYaml(category,saved),/icon: null/);
  for(const value of ['../secret.png','https://example.test/a.png','data:image/png;base64,abc','images/a.svg'])assert.throws(()=>normalizeAssetTable(category,{...table,rows:[{id:1,icon:value}]}));
  assert.throws(()=>normalizeAssetTable(category,{...table,fields:table.fields.map(f=>({...f,required:true})),rows:[{id:1,icon:null}]}),/必填/);
});

test('PNG uploads reject disguised or truncated images and enforce size/dimension bounds',()=>{
  assert.equal(typeof png.inspectPng,'function','PNG validation is missing');
  assert.deepEqual(png.inspectPng(bytes),{width:1,height:1});
  for(const bad of [new TextEncoder().encode('<svg/>'),bytes.slice(0,40),new Uint8Array(2*1024*1024+1)])assert.throws(()=>png.inspectPng(bad));
  const wide=bytes.slice();new DataView(wide.buffer).setUint32(16,4097);assert.throws(()=>png.inspectPng(wide),/4096/);
});

function bucket() {
  const files=new Map();
  return {async put(key,value){files.set(key,new Uint8Array(value));},async get(key){return files.has(key)?{body:files.get(key)}:null;},async head(key){return files.has(key)?{}:null;}};
}
function request(user,method='GET',body,path='/api/images',extra={}) {
  return new Request('https://forge.test'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),origin:'https://forge.test','content-type':'image/png',...extra},...(body?{body}: {})});
}
test('image API stores exact PNG bytes, deduplicates by content and isolates accounts',async()=>{
  assert.equal(typeof api.handleImageRequest,'function','image API is missing');
  const storage=bucket();
  assert.equal((await api.handleImageRequest(request(null,'POST',bytes),storage)).status,401);
  const response=await api.handleImageRequest(request('a','POST',bytes),storage);
  assert.equal(response.status,200,await response.clone().text());const data=await response.json();
  assert.match(data.path,/^images\/[a-f0-9]{64}\.png$/);
  const second=await (await api.handleImageRequest(request('a','POST',bytes),storage)).json();assert.equal(second.path,data.path);
  const path='/api/images?file='+encodeURIComponent(data.path);
  const downloaded=await api.handleImageRequest(request('a','GET',null,path),storage);
  assert.equal(downloaded.headers.get('Content-Type'),'image/png');
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);
  assert.equal((await api.handleImageRequest(request('b','GET',null,path),storage)).status,404);
  assert.equal((await api.handleImageRequest(request('a','POST',bytes,'/api/images',{origin:'https://evil.test'}),storage)).status,403);
  assert.equal((await api.handleImageRequest(request('b','POST',bytes,'/api/images',{'x-expected-user-id':'a'}),storage)).status,409);
  assert.equal((await api.handleImageRequest(request('a','POST',new TextEncoder().encode('fake png')),storage)).status,400);
});

