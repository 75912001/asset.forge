import {DatabaseSync} from 'node:sqlite';
import {mkdir,lstat,realpath,readFile,copyFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {normalizeWorkspace,workspaceFiles} from '../public/editor/workspace.mjs';
import {pngReferences,inspectPng} from '../public/editor/png.mjs';
import {DROP_FIELDS} from '../public/editor/drops.mjs';
import {LOCAL_OWNER} from './store.mjs';
import {within,writeAtomic} from './projects.mjs';

async function existingFile(path) {
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('需要普通文件: '+path);return await readFile(path);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// 仅合并已明确对应的外观与枚举. 所有数据、资源检查在备份及状态写入之前完成.
export async function migrateChestTypes({filename,resourcesRoot,backupDir,exportRoot}) {
  if(!filename||!resourcesRoot||!backupDir||!exportRoot)throw new Error('迁移需要数据库、资源、备份及导出目录');
  filename=resolve(filename);backupDir=resolve(backupDir);exportRoot=resolve(exportRoot);
  if(!await existingFile(filename))throw new Error('迁移源数据库不存在');
  for(const folder of [resourcesRoot,exportRoot])if(await realpath(folder)!==resolve(folder))throw new Error('迁移目录不能使用符号链接');
  resourcesRoot=await realpath(resourcesRoot);
  const db=new DatabaseSync(filename);
  try {
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('数据库完整性检查失败');
    const meta=db.prepare('SELECT revision FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER);
    if(!meta)throw new Error('项目缺少本地工作区');
    const records=db.prepare('SELECT kind,entry_key,position,payload FROM workspace_records WHERE owner_id=? ORDER BY position').all(LOCAL_OWNER);
    const workspace={categories:[],tables:{},enums:[]},rows=[],appearances=[];
    for(const record of records) {
      const value=JSON.parse(record.payload);
      if(record.kind==='category')workspace.categories.push(value);
      else if(record.kind==='table')workspace.tables[record.entry_key]={fields:value,rows:[]};
      else if(record.kind==='row')rows.push([record.entry_key.split(':')[0],value]);
      else if(record.kind==='enum')workspace.enums.push(value);
      else if(record.kind==='chest_appearance')appearances.push(value);
      else if(record.kind==='hero_motion')workspace.heroMotion=value;
      else throw new Error('未知工作区记录类型: '+record.kind);
    }
    for(const [key,row] of rows){if(!workspace.tables[key])throw new Error('项目含孤立资产记录');workspace.tables[key].rows.push(row);}
    const table=workspace.tables.drop_package,oldField=table?.fields.find(field=>field.key==='chest_appearance_id');
    if(table&&!oldField&&!table.fields.some(field=>field.key==='chest_type'))throw new Error('需要先完成宝箱外观版本的前置升级, 不会猜测分配宝箱类型');
    const changed=!!oldField||appearances.length>0;
    if(changed) {
      if(table&&!oldField||oldField&&(oldField.type!=='uint32'||!oldField.required)||table?.fields.some(field=>field.key==='chest_type'))throw new Error('宝箱字段处于冲突或部分迁移状态');
      const definition=workspace.enums.find(entry=>entry.key==='chest_type');
      if(!definition)throw new Error('缺少对应的 chest_type 枚举, 请先明确外观到枚举的映射');
      const ids=new Set();
      for(const appearance of appearances) {
        if(!Number.isInteger(appearance.id)||appearance.id<=0||ids.has(appearance.id))throw new Error('宝箱外观 ID 必须为唯一的非零数值');
        ids.add(appearance.id);
        const item=definition.items.find(item=>item.value===appearance.id);
        if(!item)throw new Error(`外观 ${appearance.id} 缺少对应的枚举项`);
        if(item.label!==appearance.name)throw new Error(`外观 ${appearance.id} 名称与枚举冲突`);
        if(item.icon&&item.icon!==appearance.icon)throw new Error(`外观 ${appearance.id} 图标与枚举冲突`);
        item.icon=appearance.icon;
      }
      if(table) {
        table.fields=table.fields.map(field=>field===oldField?{...DROP_FIELDS.drop_package.find(field=>field.key==='chest_type')}:field);
        for(const pack of table.rows) {
          if(!ids.has(pack.chest_appearance_id))throw new Error(`掉落包 ${pack.id} 的宝箱外观引用无效`);
          if(Object.hasOwn(pack,'chest_type'))throw new Error(`掉落包 ${pack.id} 存在冲突的 chest_type`);
          pack.chest_type=pack.chest_appearance_id;delete pack.chest_appearance_id;
        }
      }
    }
    const saved=normalizeWorkspace(workspace),files=workspaceFiles(saved,'asset-categories.yaml');
    for(const path of pngReferences(saved)) {
      const file=join(resourcesRoot,...path.split('/'));
      if(!within(resourcesRoot,await realpath(file)))throw new Error('PNG 超出资源目录: '+path);
      const bytes=await existingFile(file);if(!bytes)throw new Error('PNG 不存在: '+path);inspectPng(bytes);
    }
    const oldYaml='chest-appearances.yaml',originals=new Map();
    for(const name of [...files.map(file=>file.name),oldYaml])originals.set(name,await existingFile(join(exportRoot,name)));
    const pending=files.filter(file=>originals.get(file.name)?.toString('utf8')!==file.content);
    if(!changed&&!pending.length&&!originals.get(oldYaml))return {changed:false,revision:meta.revision};
    const backup=join(backupDir,`before-chest-types-r${meta.revision}-${crypto.randomUUID()}`);
    await mkdir(join(backup,'cfg'),{recursive:true});
    // VACUUM INTO 备份包含已提交 WAL 的一致性快照, 不复制仍打开的数据库文件.
    db.exec(`VACUUM INTO '${join(backup,'workspace.sqlite').replaceAll("'","''")}'`);
    for(const [name,contents] of originals)if(contents!==null)await copyFile(join(exportRoot,name),join(backup,'cfg',name));
    if(changed) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if(db.prepare('SELECT revision FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER).revision!==meta.revision)throw new Error('迁移期间版本变化, 请停服后重试');
        const update=db.prepare('UPDATE workspace_records SET payload=? WHERE owner_id=? AND kind=? AND entry_key=?');
        const definition=saved.enums.find(entry=>entry.key==='chest_type');
        update.run(JSON.stringify(definition),LOCAL_OWNER,'enum','chest_type');
        if(table) {
          update.run(JSON.stringify(table.fields),LOCAL_OWNER,'table','drop_package');
          for(const pack of table.rows)update.run(JSON.stringify(pack),LOCAL_OWNER,'row',`drop_package:${pack.id}`);
        }
        db.prepare("DELETE FROM workspace_records WHERE owner_id=? AND kind='chest_appearance'").run(LOCAL_OWNER);
        db.prepare('UPDATE workspaces SET revision=revision+1,updated_at=? WHERE owner_id=?').run(new Date().toISOString(),LOCAL_OWNER);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw new Error(`迁移事务已回滚. 备份: ${backup}. ${error.message}`);}
    }
    try {
      for(const file of pending)await writeAtomic(join(exportRoot,file.name),file.content);
      if(originals.get(oldYaml)!==null)await unlink(join(exportRoot,oldYaml));
    }catch(error){throw new Error(`数据库迁移已完成, YAML 导出未完成. 请保持停服并重跑迁移; 如需恢复, 从 ${backup} 恢复 workspace.sqlite 和 cfg 中原有文件, 移除本轮新增 YAML 后再启动. ${error.message}`);}
    return {changed,revision:meta.revision+(changed?1:0),backup,files:files.map(file=>file.name)};
  }finally{db.close();}
}
