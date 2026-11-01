import {UINT32_MAX} from './model.mjs';
import {normalizePngReference} from './png.mjs';

// 外观 ID 属于独立的展示配置空间, 不占用资产 ID 段, 也不进入奖励列表.
export function normalizeChestAppearances(value=[]) {
  if(!Array.isArray(value))throw new Error('宝箱外观必须是数组');
  const ids=new Set();
  return value.map(appearance=>{
    if(!appearance||typeof appearance!=='object'||Array.isArray(appearance))throw new Error('宝箱外观数据格式无效');
    const raw=appearance.id;
    if(!['number','string'].includes(typeof raw)||!/^\d+$/.test(String(raw))||!Number.isSafeInteger(Number(raw))||Number(raw)>UINT32_MAX)throw new Error('宝箱外观 ID 必须是 uint32');
    const id=Number(raw);
    if(ids.has(id))throw new Error(`宝箱外观 ID ${id} 重复`);
    ids.add(id);
    if(typeof appearance.name!=='string'||!appearance.name.trim())throw new Error(`宝箱外观 ${id}: 名称不能为空`);
    let icon;try{icon=normalizePngReference(appearance.icon);}catch(error){throw new Error(`宝箱外观 ${id}: ${error.message}`);}
    return {id,name:appearance.name.trim(),icon};
  });
}
export function chestAppearancesYaml(appearances) {
  const rows=normalizeChestAppearances(appearances);
  return 'version: 1\n'+(rows.length?'chest_appearances:\n'+rows.map(row=>`  - id: ${row.id}\n    name: ${JSON.stringify(row.name)}\n    icon: ${JSON.stringify(row.icon)}\n`).join(''):'chest_appearances: []\n');
}
