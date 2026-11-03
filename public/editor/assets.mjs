import {UINT32_MAX} from './model.mjs';
import {normalizeRewards} from './rewards.mjs';
import {upgradeDropTable} from './drops.mjs';
import {normalizePngReference} from './png.mjs';
import {enumItemForValue} from './enums.mjs';
export const FIELD_TYPES = ['string','uint32','uint64','bool','enum','asset_list','png'];
export function emptyAssetTable() {
  return {fields:[{key:'id',label:'ID',type:'uint32',required:true}],rows:[]};
}
function checkFields(fields,enums=[]) {
  if (!Array.isArray(fields) || fields[0]?.key !== 'id' || fields[0]?.type !== 'uint32' || fields[0]?.required !== true) throw new Error('id 列必须是必填的 uint32，且位于第一列');
  const seen = new Set();
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field.key)) throw new Error('字段标识需以小写字母开头，仅含小写字母、数字和下划线');
    if (seen.has(field.key)) throw new Error(`字段标识 ${field.key} 重复`);
    seen.add(field.key);
    if (!field.label?.trim()) throw new Error(`${field.key}：请填写字段名称`);
    if (!FIELD_TYPES.includes(field.type)) throw new Error(`${field.key}：不支持的字段类型`);
    if (field.type === 'enum' && !enums.some(definition=>definition.key===field.enum)) throw new Error(`${field.key}: 请选择有效的枚举引用`);
    if (typeof field.required !== 'boolean') throw new Error(`${field.key}：必填设置无效`);
  }
}
function typedValue(field,value,enums) {
  if (value === '' || value === null || value === undefined) {
    if (field.required) throw new Error('必填项不能为空');
    return field.type === 'string' ? '' : null;
  }
  if (field.type === 'string') {
    if (field.required && !String(value).trim()) throw new Error('必填项不能为空');
    return String(value);
  }
  if (field.type === 'bool') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error('必须为 true 或 false');
  }
  if(field.type==='asset_list')return normalizeRewards(value,field.required);
  if(field.type==='png')return normalizePngReference(value);
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('必须为精确的非负整数');
  const integer = BigInt(text);
  if(field.type==='enum') {
    if(integer>BigInt(UINT32_MAX)||!enumItemForValue(enums.find(definition=>definition.key===field.enum),Number(integer)))throw new Error(`数值 ${text} 不属于枚举 ${field.enum}`);
    return Number(integer);
  }
  const max = field.type === 'uint32' ? BigInt(UINT32_MAX) : 18446744073709551615n;
  if (integer > max) throw new Error(`超出 ${field.type} 范围`);
  return field.type === 'uint32' ? Number(integer) : integer.toString();
}
export function normalizeAssetTable(category,table,enums=[]) {
  table=upgradeDropTable(category,table);
  checkFields(table.fields,enums);
  if (!Array.isArray(table.rows)) throw new Error('资产表数据格式无效');
  const ids = new Set();
  const rows = table.rows.map((record,index)=>{
    const normalized = {};
    for (const field of table.fields) {
      try { normalized[field.key] = typedValue(field,Object.hasOwn(record,field.key) ? record[field.key] : undefined,enums); }
      catch(error) { throw new Error(`第 ${index+1} 行 · ${field.label}：${error.message}`); }
    }
    if (normalized.id < category.start || normalized.id > category.end) throw new Error(`第 ${index+1} 行：ID 不在分类范围 ${category.start}–${category.end} 内`);
    if (ids.has(normalized.id)) throw new Error(`第 ${index+1} 行：ID ${normalized.id} 重复`);
    ids.add(normalized.id);
    return normalized;
  });
  return {fields:table.fields.map(field=>{const next={...field};if(next.type!=='enum')delete next.enum;return next;}),rows};
}
export function nextAssetId(category,rows) {
  const used = new Set(rows.map(row=>Number(row.id)));
  let next = Number(category.start);
  while (used.has(next) && next <= category.end) next++;
  return next <= category.end ? next : null;
}
export function moveAssetField(table,from,to) {
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<1||from>=table.fields.length||to>=table.fields.length)throw new Error('只能调整 id 之后的字段顺序');
  const fields=[...table.fields];
  fields.splice(to,0,fields.splice(from,1)[0]);
  return {...table,fields};
}
export function changeAssetField(table,index,patch,enums=[]) {
  const previous = table.fields[index];
  if (!previous) throw new Error('字段不存在');
  if (index === 0 && (patch.key && patch.key !== 'id' || patch.type && patch.type !== 'uint32' || patch.required === false)) throw new Error('id 列不可修改标识、类型或必填设置');
  const fields = table.fields.map((field,i)=>i === index ? {...field,...patch} : {...field});
  if(fields[index].type!=='enum')delete fields[index].enum;
  checkFields(fields,enums);
  const key = fields[index].key;
  const rows = table.rows.map(row=>{
    const next = {...row};
    if (key !== previous.key) {
      if (Object.hasOwn(next,previous.key)) next[key] = next[previous.key];
      delete next[previous.key];
    }
    return next;
  });
  return {fields,rows};
}
export function assetTableYaml(category,table,enums=[]) {
  const saved = normalizeAssetTable(category,table,enums);
  const fields = saved.fields.map(field=>`  - key: ${JSON.stringify(field.key)}\n    label: ${JSON.stringify(field.label)}\n    type: ${JSON.stringify(field.type)}\n${field.type==='enum'?`    enum: ${JSON.stringify(field.enum)}\n`:''}    required: ${field.required}\n`).join('');
  const rows = saved.rows.map(row=>saved.fields.map((field,index)=>{
    const value = row[field.key];
    const key=/^(true|false|null|yes|no|on|off)$/.test(field.key)?JSON.stringify(field.key):field.key;
    if(field.type==='asset_list'&&value!==null) {
      const prefix=index===0?'  - ':'    ';
      return value.length?`${prefix}${key}:\n`+value.map(reward=>`      - asset_id: ${reward.asset_id}\n        count: ${reward.count}\n        probability: ${reward.probability}\n`).join(''):`${prefix}${key}: []\n`;
    }
    const literal = value === null ? 'null' : ['string','png'].includes(field.type) ? JSON.stringify(value) : String(value);
    return `${index === 0 ? '  - ' : '    '}${key}: ${literal}\n`;
  }).join('')).join('');
  return `version: 1\ncategory: ${JSON.stringify(category.key)}\nfields:\n${fields}${saved.rows.length ? 'rows:\n'+rows : 'rows: []\n'}`;
}
