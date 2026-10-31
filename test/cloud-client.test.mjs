import test from 'node:test';
import assert from 'node:assert/strict';
const client=await import('../public/editor/cloud.mjs').catch(()=>({}));
const empty={categories:[],tables:{},enums:[]};
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
test('opening an empty account never initializes cloud data from browser defaults',async()=>{
  assert.equal(typeof client.createCloudWorkspace,'function','cloud client is missing');
  let writes=0;const cloud=client.createCloudWorkspace({storage:storage(),request:async(url,options)=>{if(options?.method)writes++;return Response.json({workspace:null,revision:0,user:{id:'a',name:'A'}});}});
  await cloud.load();assert.equal(cloud.state.phase,'waiting');assert.equal(writes,0);
  await assert.rejects(cloud.save(empty),/迁移/);assert.equal(writes,0);
});
test('failed saves and conflicts retain the accepted revision and legacy browser data',async()=>{
  assert.equal(typeof client.createCloudWorkspace,'function','cloud client is missing');
  const store=storage();store.setItem('asset-forge-workspace-v2','original-backup');
  let mode='ok',body;
  const cloud=client.createCloudWorkspace({storage:store,request:async(url,options)=>{
    if(options?.method){body=JSON.parse(options.body);if(mode==='offline')throw new TypeError('offline');if(mode==='conflict')return Response.json({error:'version conflict'},{status:409});}
    return Response.json({workspace:empty,revision:options?.method?2:1,user:{id:'a',name:'A'}});
  }});
  await cloud.load();mode='offline';await assert.rejects(cloud.save(empty));
  assert.equal(cloud.state.revision,1);assert.equal(cloud.state.phase,'error');
  mode='conflict';await assert.rejects(cloud.save(empty));assert.equal(cloud.state.phase,'conflict');
  assert.equal(body.expectedRevision,1);assert.equal(Object.hasOwn(body,'ownerId'),false);
  assert.equal(store.getItem('asset-forge-workspace-v2'),'original-backup');
  mode='ok';await cloud.load();await cloud.save(empty);assert.equal(cloud.state.revision,2);
});
test('migration retries reuse their request ID and account caches are isolated',async()=>{
  assert.equal(typeof client.createCloudWorkspace,'function','cloud client is missing');
  const store=storage(),requests=[];let user='a',offline=true;
  const cloud=client.createCloudWorkspace({storage:store,request:async(url,options)=>{
    if(options?.method){requests.push(JSON.parse(options.body));if(offline)throw new TypeError('offline');return Response.json({workspace:empty,revision:1,user:{id:user,name:user}});}
    return Response.json({workspace:null,revision:0,user:{id:user,name:user}});
  }});
  await cloud.load();await assert.rejects(cloud.migrate(empty));offline=false;await cloud.migrate(empty);
  assert.equal(requests[0].requestId,requests[1].requestId);
  assert.ok(store.getItem('asset-forge-cloud:a'));
  user='b';await cloud.load();assert.equal(cloud.state.workspace,null);assert.equal(cloud.state.phase,'waiting');
});
