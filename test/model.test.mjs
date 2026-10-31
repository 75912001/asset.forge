import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCategories, toYaml } from '../public/editor/model.mjs';

const category = (key, start, end) => ({key, name:key, start, end, description:''});

test('accepts both uint32 endpoints and single-ID ranges', () => {
  assert.deepEqual(validateCategories([category('zero',0,0),category('max',4294967295,4294967295)]),[]);
});
test('rejects values outside uint32 and malformed integer inputs', () => {
  for (const value of [-1,4294967296,1.5,'','1e3',NaN,Infinity]) {
    assert.ok(validateCategories([category('role',value,4294967295)]).length, `accepted ${value}`);
  }
});
test('rejects descending ranges', () => {
  assert.ok(validateCategories([category('role',200,100)]).length);
});
test('inclusive endpoints overlap while consecutive ranges do not', () => {
  assert.ok(validateCategories([category('role',1,100),category('item',100,200)]).length);
  assert.deepEqual(validateCategories([category('role',1,100),category('item',101,200)]),[]);
});
test('requires names and unique machine-readable keys', () => {
  assert.ok(validateCategories([{...category('role',1,10),name:''}]).length);
  assert.ok(validateCategories([category('../role',1,10)]).length);
  assert.ok(validateCategories([category('role',1,10),category('role',20,30)]).length);
});
test('exports numeric bounds and safely quotes YAML-sensitive text', () => {
  const rows=[{key:'role',name:'角色: "英雄"',start:0,end:4294967295,description:'第一行\n第二行'}];
  assert.equal(toYaml(rows),'version: 1\ncategories:\n  - key: "role"\n    name: "角色: \\"英雄\\""\n    id_start: 0\n    id_end: 4294967295\n    description: "第一行\\n第二行"\n');
});
test('invalid ranges cannot be exported', () => {
  assert.throws(()=>toYaml([category('role',100,1)]));
});
