import {chestEnum} from './chest-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalServer} from '../local/server.mjs';
import {enableDrops,saveDropPackage} from '../public/editor/drops.mjs';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';

async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'asset-forge-chests-'));
  await cp(resolve('drizzle'),join(root,'drizzle'),{recursive:true});
  await cp(resolve('public/editor'),join(root,'public/editor'),{recursive:true});
  let app;
  t.after(async()=>{await app?.close();await rm(root,{recursive:true,force:true});});
  const start=async()=>{app=await createLocalServer({root});await app.listen(0);return app;};
  await start();
  const send=(path,method='GET',body)=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  await send('/api/projects','POST',{id:'game',name:'游戏'});
  await mkdir(join(root,'projects/game/assets/chests'));
  await writeFile(join(root,'projects/game/assets/chests/wood.png'),Buffer.from([137,80,78,71,13,10,26,10]));
  const base=enableDrops({categories:[{key:'item',name:'道具',start:1,end:99}],enums:[chestEnum('chests/wood.png')],tables:{item:{fields:[{key:'id',label:'ID',type:'uint32',required:true}],rows:[{id:1}]}}},{start:200,end:209},{start:210,end:299});
  let workspace=saveDropPackage(base,{id:200,name:'新手包',selection_mode:'weight',chest_type:1},[{id:210,package_id:200,weight:1,rewards:[{asset_id:1,count:1}]}]);
  workspace=normalizeWorkspace(saveDropPackage(workspace,{id:201,name:'活动包',selection_mode:'probability',chest_type:1},[{id:211,package_id:201,weight:1,probability:10000,rewards:[{asset_id:200,count:2}]}]));
  return {root,send,workspace,restart:async()=>{await app.close();await start();}};
}

test('编辑器主样式包含枚举图标和掉落包预览样式',async t=>{
  const f=await setup(t),page=await(await f.send('/')).text();
  const href=/<link[^>]+href="([^"]*style\.css)"/.exec(page)?.[1];assert.ok(href);
  const response=await f.send('/'+href.replace(/^\//,''));assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/css/);
  const css=await response.text();assert.match(css,/enum-grid/);assert.match(css,/drop-chest-preview/);assert.doesNotMatch(page,/chest-appearances-view/);
});

test('项目保存和重启保留枚举图标与奖励, 导出使用宝箱类型',async t=>{
  const f=await setup(t),endpoint='/api/projects/game/workspace';
  const response=await f.send(endpoint,'PUT',{workspace:f.workspace,expectedRevision:1});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).workspace,f.workspace);
  await f.restart();
  const loaded=await (await f.send(endpoint)).json();assert.equal(loaded.revision,2);assert.deepEqual(loaded.workspace,f.workspace);
  const exportResponse=await f.send('/api/projects/game/export','POST',{scope:'__enums__',filename:'asset-categories.yaml',expectedRevision:2});
  assert.equal(exportResponse.status,200);assert.deepEqual((await exportResponse.json()).files,['asset-enums.yaml']);
  assert.match(await readFile(join(f.root,'projects/game/cfg/asset-enums.yaml'),'utf8'),/icon: "chests\/wood.png"/);
  const all=await f.send('/api/projects/game/export','POST',{scope:'__all__',filename:'asset-categories.yaml',expectedRevision:2});
  assert.equal(all.status,200);assert.equal((await all.json()).files.includes('chest-appearances.yaml'),false);
});

test('server rejects missing appearance images, dangling references and empty-outcome configurations without changing revision',async t=>{
  const f=await setup(t),endpoint='/api/projects/game/workspace';
  assert.equal((await f.send(endpoint,'PUT',{workspace:f.workspace,expectedRevision:1})).status,200);
  const cases=[
    [w=>w.enums[0].items[1].icon='missing.png',/PNG/],
    [w=>w.enums[0].items.splice(1,1),/宝箱类型/],
    [w=>{w.tables.drop_package.rows.pop();w.tables.drop_entry.rows[0].rewards=[{asset_id:201,count:1,probability:10000}];w.tables.drop_entry.rows.pop();},/201/],
    [w=>w.tables.drop_entry.rows[0].rewards[0].probability=9999,/200.*210.*100%/],
    [w=>w.tables.drop_entry.rows[1].probability=9999,/201.*100%/]
  ];
  for(const [change,message] of cases) {
    const draft=structuredClone(f.workspace);change(draft);
    const rejected=await f.send(endpoint,'PUT',{workspace:draft,expectedRevision:2});
    assert.equal(rejected.status,400);assert.match((await rejected.json()).error,message);
    const current=await (await f.send(endpoint)).json();assert.equal(current.revision,2);assert.deepEqual(current.workspace,f.workspace);
  }
  const changed=structuredClone(f.workspace);changed.enums[0].items[1].label='活动木箱';
  const results=await Promise.all([changed,f.workspace].map(workspace=>f.send(endpoint,'PUT',{workspace,expectedRevision:2})));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
});
