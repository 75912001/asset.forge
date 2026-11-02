import {UINT32_MAX} from './model.mjs';
import {normalizePngReference} from './png.mjs';
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
    const itemKeys=new Set(),values=new Set();
    const items=definition.items.map(item=>{
      identifier(item.key,itemKeys);
      if(!item.label?.trim())throw new Error('请填写枚举项名称');
      if(!/^\d+$/.test(String(item.value))||Number(item.value)>UINT32_MAX)throw new Error('枚举值必须为 uint32(0-4294967295)');
      const value=Number(item.value);
      if(values.has(value))throw new Error(`枚举数值 ${value} 重复`);
      values.add(value);
      const icon=item.icon===undefined||item.icon===null||item.icon===''?undefined:normalizePngReference(item.icon);
      // 宝箱展示统一来自枚举, 零项不代表可用的宝箱类型.
      if(definition.key==='chest_type') {
        if(value===0&&icon)throw new Error('宝箱类型未定义项不能配置图标');
        if(value!==0&&!icon)throw new Error(`宝箱类型 ${item.label} 必须配置 PNG 图标`);
      }
      return {key:item.key,label:item.label.trim(),value,...(icon?{icon}:{})};
    });
    if(!items.some(item=>item.key==='undefined'&&item.label==='未定义'&&item.value===0))throw new Error('每个枚举必须保留 undefined=0"未定义"');
    return {key:definition.key,label:definition.label.trim(),items};
  });
}
export function enumsYaml(definitions) {
  const saved=normalizeEnums(definitions);
  return 'version: 1\n'+(saved.length?'enums:\n'+saved.map(definition=>`  - key: ${JSON.stringify(definition.key)}\n    label: ${JSON.stringify(definition.label)}\n    items:\n${definition.items.map(item=>`      - key: ${JSON.stringify(item.key)}\n        label: ${JSON.stringify(item.label)}\n        value: ${item.value}\n${item.icon?`        icon: ${JSON.stringify(item.icon)}\n`:''}`).join('')}`).join(''):'enums: []\n');
}
