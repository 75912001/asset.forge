import {UINT32_MAX} from './model.mjs';
export function emptyEnum() {
  return {key:'',label:'',items:[{key:'undefined',label:'未定义',value:0}]};
}
export function seedEnums() {
  return [{...emptyEnum(),key:'equipment_slot',label:'装备部位',items:[...emptyEnum().items,
    {key:'head',label:'头部',value:1},{key:'body',label:'身体',value:2},
    {key:'legs',label:'腿部',value:3},{key:'feet',label:'脚部',value:4}]}];
}
export function normalizeEnums(definitions) {
  if(!Array.isArray(definitions))throw new Error('枚举配置格式无效');
  const keys=new Set();
  function identifier(key,seen) {
    if(!/^[a-z][a-z0-9_]*$/.test(key))throw new Error('枚举标识需以小写字母开头, 仅含小写字母, 数字和下划线');
    if(seen.has(key))throw new Error(`枚举标识 ${key} 重复`);
    seen.add(key);
  }
  return definitions.map(definition=>{
    identifier(definition.key,keys);
    if(!definition.label?.trim())throw new Error('请填写枚举名称');
    if(!Array.isArray(definition.items))throw new Error('枚举项格式无效');
    const itemKeys=new Set();
    const items=definition.items.map(item=>{
      identifier(item.key,itemKeys);
      if(!item.label?.trim())throw new Error('请填写枚举项名称');
      if(!/^\d+$/.test(String(item.value))||Number(item.value)>UINT32_MAX)throw new Error('枚举值必须为 uint32(0-4294967295)');
      const value=Number(item.value);
      const hasMax=item.max!==undefined&&item.max!=='';
      if(hasMax&&(!/^\d+$/.test(String(item.max))||Number(item.max)>UINT32_MAX||Number(item.max)<value))throw new Error('范围终值必须为不小于起值的 uint32');
      return {key:item.key,label:item.label.trim(),value,...(hasMax?{max:Number(item.max)}:{})};
    });
    if(!items.some(item=>item.key==='undefined'&&item.label==='未定义'&&item.value===0&&(item.max??0)===0))throw new Error('每个枚举必须保留 undefined=0"未定义"');
    const ordered=[...items].sort((a,b)=>a.value-b.value);
    for(let i=1;i<ordered.length;i++)if(ordered[i].value<=(ordered[i-1].max??ordered[i-1].value))throw new Error('枚举数值重复或范围重叠');
    return {key:definition.key,label:definition.label.trim(),items};
  });
}
// 使用已规范化的枚举定义匹配闭区间, 单值项等价于起止值相同的范围.
export function enumItemForValue(definition,value) {
  return definition.items.find(item=>value>=item.value&&value<=(item.max??item.value));
}
export function enumsYaml(definitions) {
  const saved=normalizeEnums(definitions);
  return 'version: 1\n'+(saved.length?'enums:\n'+saved.map(definition=>`  - key: ${JSON.stringify(definition.key)}\n    label: ${JSON.stringify(definition.label)}\n    items:\n${definition.items.map(item=>`      - key: ${JSON.stringify(item.key)}\n        label: ${JSON.stringify(item.label)}\n        value: ${item.value}\n${item.max===undefined?'':`        max: ${item.max}\n`}`).join('')}`).join(''):'enums: []\n');
}
