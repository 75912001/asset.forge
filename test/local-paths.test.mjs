import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePngReference} from '../public/editor/png.mjs';
import {normalizeAssetTable,assetTableYaml} from '../public/editor/assets.mjs';
test('local PNG fields store original relative filenames including subfolders without converting or copying files',()=>{
  for(const path of ['equipment/hat.png','装备/草帽.PNG','icons/coin 01.png'])assert.equal(normalizePngReference(path),path);
  for(const path of ['F:/assets/hat.png','/hat.png','../hat.png','equipment/../../hat.png','equipment\\hat.png','https://example.test/hat.png','data:image/png;base64,abc','a//hat.png','equipment/hat.svg'])assert.throws(()=>normalizePngReference(path));
  const category={key:'equipment',start:1,end:9},table={fields:[{key:'id',label:'ID',type:'uint32',required:true},{key:'icon',label:'图标',type:'png',required:false}],rows:[{id:1,icon:'装备/草帽.PNG'}]};
  assert.equal(normalizeAssetTable(category,table).rows[0].icon,'装备/草帽.PNG');assert.match(assetTableYaml(category,table),/icon: "装备\/草帽.PNG"/);
});
