import {emptyEnum} from './enums.mjs';
export const DROP_FIELDS={
  drop_package:[{key:'id',label:'ID',type:'uint32',required:true},{key:'name',label:'包名称',type:'string',required:true},{key:'selection_mode',label:'组合抽取模式',type:'string',required:true},{key:'chest_type',label:'宝箱类型',type:'enum',enum:'chest_type',required:true}],
  drop_entry:[{key:'id',label:'ID',type:'uint32',required:true},{key:'package_id',label:'所属包',type:'uint32',required:true},{key:'weight',label:'权重',type:'uint32',required:true},{key:'probability',label:'组合概率(万分率)',type:'uint32',required:true},{key:'rewards',label:'奖励组合',type:'asset_list',required:true}]
};
export const isDropCategory=category=>Object.hasOwn(DROP_FIELDS,category?.system||'');
export const isDropCore=(category,key)=>isDropCategory(category)&&DROP_FIELDS[category.system].some(field=>field.key===key);
export function upgradeDropTable(category,table) {
  if(!isDropCategory(category)||!Array.isArray(table.fields)||!Array.isArray(table.rows))return table;
  const defaults=category.system==='drop_package'?{selection_mode:'weight'}:{probability:10000};
  const added=DROP_FIELDS[category.system].filter(field=>Object.hasOwn(defaults,field.key)&&!table.fields.some(existing=>existing.key===field.key));
  return {...table,fields:[...table.fields,...added.map(field=>({...field}))],rows:table.rows.map(row=>({...defaults,...row}))};
}
export function enableDrops(workspace,packageRange,entryRange) {
  if(workspace.categories.some(category=>isDropCategory(category)||Object.hasOwn(DROP_FIELDS,category.key)))throw new Error('掉落表已存在或同名结构冲突. 请先备份并处理旧表, 不会自动转换或覆盖.');
  const categories=[...workspace.categories],tables={...workspace.tables};
  for(const [key,range,name] of [['drop_package',packageRange,'掉落包'],['drop_entry',entryRange,'掉落条目']]) {
    categories.push({key,system:key,name,...range,description:'支持权重选一或概率独立判定, 命中后按各奖励项的万分率独立判定.'});
    tables[key]={fields:DROP_FIELDS[key].map(field=>({...field})),rows:[]};
  }
  return {...workspace,categories,tables,enums:chestEnums(workspace.enums)};
}
// 启用掉落仅建立空枚举, 不向新项目引入不存在的图片资源.
function chestEnums(enums=[]) {return enums.some(entry=>entry.key==='chest_type')?enums:[...enums,{...emptyEnum(),key:'chest_type',label:'宝箱类型'}];}
export function migrateLootBag(workspace,entryRange) {
  if(workspace.categories.some(category=>isDropCategory(category)||Object.hasOwn(DROP_FIELDS,category.key)))throw new Error('掉落结构已存在或同名冲突, 不能覆盖迁移');
  const legacy=workspace.categories.find(category=>category.key==='loot_bag'),table=workspace.tables.loot_bag;
  if(!legacy||!table)throw new Error('未找到 loot_bag 分类');
  if(table.rows.length)throw new Error(`loot_bag 已有 ${table.rows.length} 行数据. 需要先明确旧字段到奖励条目的映射, 不会自动改写或删除数据.`);
  const name=table.fields.find(field=>field.key==='name');
  if(name&&name.type!=='string')throw new Error('旧 name 字段不是 string, 请先处理字段冲突');
  const fields=table.fields.map(field=>field.key==='name'?{...field,required:true}:{...field});
  if(!name)fields.push({...DROP_FIELDS.drop_package.find(field=>field.key==='name')});
  fields.push({...DROP_FIELDS.drop_package.find(field=>field.key==='chest_type')});
  const tables={...workspace.tables,drop_package:{fields,rows:table.rows.map(row=>({...row}))},drop_entry:{fields:DROP_FIELDS.drop_entry.map(field=>({...field})),rows:[]}};
  delete tables.loot_bag;
  return {...workspace,categories:[...workspace.categories.map(category=>category===legacy?{...category,key:'drop_package',system:'drop_package'}:category),{key:'drop_entry',system:'drop_entry',name:'掉落条目',...entryRange,description:'支持权重选一或概率独立判定, 命中后按各奖励项的万分率独立判定.'}],tables,enums:chestEnums(workspace.enums)};
}
export function validateDrops(workspace) {
  const marked=workspace.categories.filter(category=>category.system);
  if(marked.some(category=>!isDropCategory(category)||category.key!==category.system)||marked.length!==0&&marked.length!==2||marked.length===2&&!Object.keys(DROP_FIELDS).every(key=>marked.some(category=>category.key===key)))throw new Error('掉落结构必须同时保留 drop_package 和 drop_entry 分类及其固定标识');
  for(const category of marked)for(const core of DROP_FIELDS[category.system]) {
    const field=workspace.tables[category.key].fields.find(field=>field.key===core.key);
    if(!field||field.type!==core.type||field.required!==true||field.enum!==core.enum)throw new Error(`掉落核心字段 ${category.key}.${core.key} 的标识、类型、枚举引用和必填规则不可修改`);
  }
  const assetIds=new Set(workspace.categories.filter(category=>!category.system||category.system==='drop_package').flatMap(category=>workspace.tables[category.key].rows.map(row=>row.id)));
  for(const [key,table] of Object.entries(workspace.tables))for(const field of table.fields.filter(field=>field.type==='asset_list'))for(const row of table.rows)for(const reward of row[field.key]||[]) {
    if(!assetIds.has(reward.asset_id))throw new Error(`${key} / ${row.id}: 奖励资产 ${reward.asset_id} 不存在或不是可发放资产/掉落包. 被引用的奖励不能删除.`);
  }
  if(!marked.length)return;
  const packages=workspace.tables.drop_package.rows,entries=workspace.tables.drop_entry.rows;
  const chestTypes=new Set(workspace.enums.find(entry=>entry.key==='chest_type').items.filter(item=>item.value!==0).map(item=>item.value));
  for(const pack of packages) {
    if(!['weight','probability'].includes(pack.selection_mode))throw new Error(`掉落包 ${pack.id}: 组合抽取模式必须为 weight 或 probability`);
    if(!chestTypes.has(pack.chest_type))throw new Error(`掉落包 ${pack.id}: 请选择有效的非零宝箱类型`);
  }
  const ids=new Set(packages.map(row=>row.id)),counts=new Map();
  for(const entry of entries) {
    if(!ids.has(entry.package_id))throw new Error(`条目 ${entry.id}: 所属掉落包 ${entry.package_id} 不存在`);
    if(entry.weight<=0)throw new Error(`条目 ${entry.id}: 权重必须大于 0`);
    if(entry.probability>10000)throw new Error(`条目 ${entry.id}: 组合概率必须是 0-10000 的整数`);
    if(!entry.rewards.some(reward=>reward.probability===10000))throw new Error(`掉落包 ${entry.package_id} / 组合 ${entry.id}: 至少需要一项概率为 100% 的奖励, 保证开启结果非空`);
    counts.set(entry.package_id,(counts.get(entry.package_id)||0)+1);
  }
  for(const pack of packages) {
    if(!counts.has(pack.id))throw new Error(`掉落包 ${pack.id} 至少需要一条有效条目`);
    if(pack.selection_mode==='probability'&&!entries.some(entry=>entry.package_id===pack.id&&entry.probability===10000))throw new Error(`掉落包 ${pack.id}: 概率模式至少需要一个命中概率为 100% 的组合, 保证开启结果非空`);
  }
}
export function assertDropTransition(previous,next) {
  for(const category of previous.categories.filter(isDropCategory))if(!next.categories.some(candidate=>candidate.key===category.key&&candidate.system===category.system))throw new Error('已启用的掉落分类不能删除、改标识或移除结构标记. 请在掉落包页面删除包及所属条目.');
}
export function saveDropPackage(workspace,pack,entries) {
  const tables={...workspace.tables};
  if(entries.some(entry=>Number(entry.package_id)!==Number(pack.id)))throw new Error('条目所属包与当前掉落包不一致');
  tables.drop_package={...tables.drop_package,rows:[...tables.drop_package.rows.filter(row=>row.id!==pack.id),pack]};
  tables.drop_entry={...tables.drop_entry,rows:[...tables.drop_entry.rows.filter(row=>row.package_id!==pack.id),...entries]};
  return {...workspace,tables};
}
export function deleteDropPackage(workspace,id) {
  return {...workspace,tables:{...workspace.tables,
    drop_package:{...workspace.tables.drop_package,rows:workspace.tables.drop_package.rows.filter(row=>row.id!==id)},
    drop_entry:{...workspace.tables.drop_entry,rows:workspace.tables.drop_entry.rows.filter(row=>row.package_id!==id)}
  }};
}
export const totalWeight=entries=>entries.reduce((sum,entry)=>sum+BigInt(entry.weight),0n);
// roll is uniformly chosen in [0, totalWeight). Stable IDs make display order irrelevant.
export function selectDropEntry(entries,roll) {
  if(typeof roll!=='bigint'||roll<0n||roll>=totalWeight(entries))throw new Error('抽取值超出权重范围');
  for(const entry of [...entries].sort((a,b)=>a.id-b.id)){roll-=BigInt(entry.weight);if(roll<0n)return entry;}
}
export function selectDropEntries(pack,entries,{weightRoll,probabilityRoll}={}) {
  const candidates=entries.filter(entry=>entry.package_id===pack.id),mode=pack.selection_mode??'weight';
  if(!candidates.length)throw new Error('掉落包至少需要一条有效条目');
  if(mode==='weight')return [selectDropEntry(candidates,weightRoll)];
  if(mode!=='probability')throw new Error('未知组合抽取模式');
  return candidates.filter(entry=>{
    const roll=probabilityRoll(entry.id);
    if(!Number.isInteger(roll)||roll<0||roll>=10000)throw new Error('组合判定值必须是 0-9999 的整数');
    return roll<(entry.probability??10000);
  });
}
