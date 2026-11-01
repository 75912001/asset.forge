import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalServer} from '../local/server.mjs';
import {projectApi,projectStorageKey,currentProject,projectNavigationBlocked} from '../public/editor/projects.mjs';
import {pngUrl,pngCellHtml} from '../public/editor/png.mjs';

class Element {
  constructor(attributes='') {
    this.value=/\bvalue="([^"]*)"/.exec(attributes)?.[1]||'';this.hidden=/\bhidden\b/.test(attributes);
    this.textContent='';this.listeners={};this.classList={toggle(){}};this.disabled=false;this.option={};
  }
  addEventListener(name,handler){this.listeners[name]=handler;}
  querySelector(selector){return selector.startsWith('option')?this.option:null;}
  querySelectorAll(){return [];}
  focus(){}
  remove(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
test('the local editor binds navigation, drafts, images, exports and metadata to the selected project',async t=>{
  const root=await mkdtemp(join(tmpdir(),'asset-forge-ui-'));
  const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch,confirm:globalThis.confirm,setTimeout:globalThis.setTimeout,innerWidth:globalThis.innerWidth};
  let app;
  t.after(async()=>{Object.assign(globalThis,previous);await app?.close();await rm(root,{recursive:true,force:true});});
  await cp(resolve('drizzle'),join(root,'drizzle'),{recursive:true});await cp(resolve('public','editor'),join(root,'public','editor'),{recursive:true});
  await mkdir(join(root,'assets'));await mkdir(join(root,'cfg'));await writeFile(join(root,'assets','hat.png'),Uint8Array.from([137,80,78,71]));
  const category={key:'equipment',name:'装备',start:1,end:9,description:''};
  const seed={revision:13,workspace:{categories:[category],enums:[],tables:{equipment:{fields:[{key:'id',label:'ID',type:'uint32',required:true}],rows:[{id:1}]}}}};
  app=await createLocalServer({root,seed});await app.listen(0);
  assert.equal((await previous.fetch(app.url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'sa',name:'SA'})})).status,201);
  const html=await readFile(join(root,'public','editor','index.html'),'utf8'),values=new Map(),requests=[],navigation=[];
  const originalDraft=JSON.stringify({version:1,revision:13,workspace:seed.workspace,category:{selected:0,dirty:false,form:category}});
  values.set('asset-forge-draft:local-workspace',originalDraft);values.set('asset-forge-filename','legacy.yaml');
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  globalThis.confirm=()=>true;
  globalThis.innerWidth=1280;
  globalThis.setTimeout=(fn,ms)=>previous.setTimeout(fn,ms).unref();
  let holdSave=false,releaseSave;
  globalThis.fetch=async(url,options)=>{
    if(typeof url==='string'&&url.startsWith('/api/')) {
      requests.push({url,options});
      if(holdSave&&options?.method==='PUT')await new Promise(resolve=>releaseSave=resolve);
      return previous.fetch(new URL(url,app.url),options);
    }
    return previous.fetch(url,options);
  };
  let elements,clickedLink,loadCount=0;
  const element=id=>elements.get(id);
  async function load(id) {
    elements=new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(match=>[match[1],new Element(match[0])]));
    globalThis.document={getElementById:element,querySelectorAll:()=>[],body:{append(){}},createElement:()=>{const item=new Element();item.click=()=>clickedLink={href:item.href,download:item.download};return item;}};
    const location={href:app.url+'/?project='+id,assign:url=>navigation.push(url)};
    globalThis.window={assetForgeLocal:true,location,history:{replaceState:(_,__,url)=>location.href=app.url+url},addEventListener(){}};
    await import('../public/editor/app.mjs?local-project-ui-'+(++loadCount));
  }
  const changeProject=async id=>{element('project-select').value=id;await element('project-select').listeners.change();};

  await load('mmorpg');
  assert.equal(element('project-select').value,'mmorpg');assert.equal(element('cloud-restore').hidden,false);assert.equal(element('workspace-content').inert,true);
  assert.equal(values.get('asset-forge-draft:local-workspace:project:mmorpg'),originalDraft);
  await changeProject('sa');assert.equal(navigation.length,0,'pending recovery must block navigation');
  await element('cloud-backup').listeners.click();
  const backup=await (await previous.fetch(clickedLink.href)).json();assert.equal(backup.project.id,'mmorpg');assert.equal(backup.current.projectId,'mmorpg');assert.match(clickedLink.download,/mmorpg/);URL.revokeObjectURL(clickedLink.href);
  await element('cloud-restore').listeners.click();assert.equal(element('cloud-restore').hidden,true);
  assert.equal(values.has('asset-forge-draft:local-workspace:project:mmorpg'),false);
  await load('mmorpg');assert.equal(element('cloud-restore').hidden,true,'old drafts must not be reimported after recovery or discard');
  assert.equal(values.get('asset-forge-draft:local-workspace'),originalDraft);
  element('category-name').value='MMORPG 装备';await element('category-form').listeners.input();
  await changeProject('sa');assert.equal(navigation.length,0);assert.equal(element('project-select').value,'mmorpg');
  await element('project-new').listeners.click();assert.notEqual(element('project-dialog').open,true,'new project must also respect unsaved edits');
  await element('category-form').listeners.submit({preventDefault(){}});
  await changeProject('sa');assert.equal(navigation.at(-1),'/?project=sa');

  await load('sa');assert.equal(element('cloud-restore').hidden,true);assert.equal(element('local-settings-save').hidden,true);assert.equal(element('local-resource-root').readOnly,true);
  assert.equal(element('local-resource-root').value,join(root,'projects','sa','assets'));
  assert.equal(projectApi('/workspace'),'/api/projects/sa/workspace');assert.equal(pngUrl('hat.png'),'/api/projects/sa/images?file=hat.png');
  assert.match(pngCellHtml('hat.png','','帽子'),/\/api\/projects\/sa\/images/);
  assert.notEqual(element('export-filename').value,'legacy.yaml');
  element('export-filename').value='sa-categories.yaml';await element('export-filename').listeners.input();assert.equal(values.get(projectStorageKey('asset-forge-filename')),'sa-categories.yaml');assert.equal(values.get('asset-forge-filename:project:mmorpg'),'legacy.yaml');
  await element('add-category').listeners.click();
  for(const [key,value] of Object.entries(category))element('category-'+key).value=value;
  await element('category-form').listeners.input();await element('category-form').listeners.submit({preventDefault(){}});
  await element('asset-add-row').listeners.click();holdSave=true;
  const saving=element('asset-save').listeners.click();assert.equal(typeof releaseSave,'function');
  const priorNavigation=navigation.length;await changeProject('mmorpg');assert.equal(navigation.length,priorNavigation,'saving must block navigation');
  holdSave=false;releaseSave();await saving;
  element('export-scope').value='__all__';await element('export-now').listeners.click();assert.equal(element('export-error').hidden,true);
  assert.match(await readFile(join(root,'projects','sa','cfg','sa-categories.yaml'),'utf8'),/equipment/);
  assert.match(await readFile(join(root,'projects','sa','cfg','equipment.yaml'),'utf8'),/id: 1/);
  await assert.rejects(access(join(root,'projects','mmorpg','cfg','sa-categories.yaml')));
  assert.ok(values.has('asset-forge-cloud:local-workspace:project:sa'));assert.ok(values.has('asset-forge-cloud:local-workspace:project:mmorpg'));

  await element('project-rename').listeners.click();assert.equal(element('project-id').readOnly,true);element('project-name').value='石器时代';await element('project-form').listeners.submit({preventDefault(){}});
  assert.equal(currentProject().id,'sa');assert.equal(currentProject().name,'石器时代');assert.equal(document.title,'石器时代 · Asset Forge');
  assert.equal(JSON.parse(await readFile(join(root,'projects','sa','project.json'),'utf8')).id,'sa');
  await element('project-new').listeners.click();element('project-id').value='third';element('project-name').value='第三项目';await element('project-form').listeners.submit({preventDefault(){}});assert.equal(navigation.at(-1),'/?project=third');

  await load('missing');assert.equal(currentProject(),null);assert.match(element('project-error').textContent,/项目不存在/);assert.equal(element('workspace-content').hidden,true);await changeProject('sa');assert.equal(navigation.at(-1),'/?project=sa');
  assert.ok(requests.every(({url})=>url==='/api/projects'||url.startsWith('/api/projects/')),'local UI must never call unqualified business APIs');
  for(const phase of ['loading','saving'])assert.equal(projectNavigationBlocked({unsaved:false,recovery:false,phase}),true);
});
