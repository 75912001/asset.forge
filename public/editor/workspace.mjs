import {validateCategories,toYaml} from './model.mjs';
import {emptyAssetTable,normalizeAssetTable,assetTableYaml} from './assets.mjs';
import {normalizeEnums,seedEnums,enumsYaml,enumItemForValue} from './enums.mjs';
import {validateDrops,assertDropTransition} from './drops.mjs';
import {normalizeChestAppearances,chestAppearancesYaml} from './chest-appearances.mjs';
import {normalizeHeroMotion,heroMotionYaml} from './hero-runtime.mjs';
const workspaceKey='asset-forge-workspace-v2';
export function normalizeWorkspace(workspace) {
  if (!Array.isArray(workspace.categories)) throw new Error('分类数据格式无效');
  const errors=validateCategories(workspace.categories);
  if(errors.length) throw new Error(errors.join('\n'));
  const categories=workspace.categories.map(category=>({...category,start:Number(category.start),end:Number(category.end)}));
  const enums=normalizeEnums(workspace.enums===undefined?seedEnums():workspace.enums);
  const tables=Object.fromEntries(categories.map(category=>[category.key,normalizeAssetTable(category,Object.hasOwn(workspace.tables||{},category.key)?workspace.tables[category.key]:emptyAssetTable(),enums)]));
  const chestAppearances=normalizeChestAppearances(workspace.chestAppearances);
  const heroMotion=normalizeHeroMotion(workspace.heroMotion);
  const saved={categories,tables,enums,chestAppearances,heroMotion};validateDrops(saved);return saved;
}
export function readWorkspace(storage,fallbackCategories) {
  const saved=storage.getItem(workspaceKey);
  if(saved) return normalizeWorkspace(JSON.parse(saved));
  const legacy=storage.getItem('asset-forge-categories-v1');
  return normalizeWorkspace({categories:legacy?JSON.parse(legacy):fallbackCategories,tables:{}});
}
export function writeWorkspace(storage,workspace) {
  const saved=normalizeWorkspace(workspace);
  storage.setItem(workspaceKey,JSON.stringify(saved));
  return saved;
}
export function replaceCategories(workspace,categories,rename) {
  assertDropTransition(workspace,{categories});
  const tables={...workspace.tables};
  if(rename && rename.from!==rename.to && Object.hasOwn(tables,rename.from)) {
    tables[rename.to]=tables[rename.from];delete tables[rename.from];
  }
  return normalizeWorkspace({...workspace,categories,tables});
}
export function replaceEnum(workspace,previousKey,definition) {
  const saved=normalizeWorkspace(workspace);
  const previous=saved.enums.find(entry=>entry.key===previousKey);
  if(previousKey&&!previous)throw new Error('枚举不存在');
  const enums=normalizeEnums([...saved.enums.filter(entry=>entry.key!==previousKey),...(definition?[definition]:[])]);
  if(previous) {
    const references=Object.values(saved.tables).flatMap(table=>table.fields.filter(field=>field.type==='enum'&&field.enum===previousKey).map(field=>({table,field})));
    if(!definition&&references.length)throw new Error('此枚举仍被资产表字段引用, 请先移除引用');
    const used=new Set(references.flatMap(({table,field})=>table.rows.map(row=>row[field.key]).filter(value=>value!==null)));
    const next=enums.find(entry=>entry.key===definition?.key);
    for(const value of used) {
      const item=enumItemForValue(previous,value);
      const sameKey=next?.items.find(entry=>entry.key===item.key);
      const matched=next&&enumItemForValue(next,value);
      if(!matched||(sameKey&&matched!==sameKey))throw new Error(`枚举项"${item.label}"已被数据使用, 不能删除或修改已使用数值的归属`);
    }
  }
  const tables=Object.fromEntries(Object.entries(saved.tables).map(([key,table])=>[key,{...table,fields:table.fields.map(field=>field.type==='enum'&&field.enum===previousKey?{...field,enum:definition.key}:{...field})}]));
  // Keep the edited enum in its original position.
  if(previous&&definition)enums.splice(saved.enums.findIndex(entry=>entry.key===previousKey),0,enums.pop());
  return normalizeWorkspace({...saved,enums,tables});
}
export function workspaceFiles(workspace,categoryFilename) {
  const saved=normalizeWorkspace(workspace);
  const names=saved.categories.map(category=>`${category.key}.yaml`);
  if([...names,'asset-enums.yaml','chest-appearances.yaml','hero-motion.yaml'].includes(categoryFilename.toLowerCase())||names.some(name=>['hero-motion.yaml','chest-appearances.yaml','asset-enums.yaml'].includes(name.toLowerCase()))) throw new Error('配置文件名冲突, 请修改分类标识或分类配置文件名');
  return [{name:categoryFilename,content:toYaml(saved.categories)},{name:'asset-enums.yaml',content:enumsYaml(saved.enums)},{name:'chest-appearances.yaml',content:chestAppearancesYaml(saved.chestAppearances)},{name:'hero-motion.yaml',content:heroMotionYaml(saved.heroMotion)},...saved.categories.map(category=>({name:`${category.key}.yaml`,content:assetTableYaml(category,saved.tables[category.key],saved.enums)}))];
}
