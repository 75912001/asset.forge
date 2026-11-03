import {DatabaseSync} from 'node:sqlite';
import {mkdir,stat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
import {DROP_FIELDS} from '../public/editor/drops.mjs';
import {LOCAL_OWNER} from './store.mjs';

const appearances=['wood','iron','copper','silver','gold'].map((key,index)=>({id:index+1,name:['木箱','铁箱','铜箱','银箱','金箱'][index],icon:`icons/chests/${key}.png`}));

// 显式、一次性迁移. 不猜测或修补奖励概率, 验证通过后才备份并提交配置.
export async function migrateChestAppearances({filename,resourcesRoot,backupDir}) {
  if(!filename||!resourcesRoot||!backupDir)throw new Error('迁移需要数据库、资源目录及备份目录');
  filename=resolve(filename);resourcesRoot=await realpath(resourcesRoot);backupDir=resolve(backupDir);
  if(!(await stat(filename)).isFile())throw new Error('迁移源数据库不是普通文件');
  const db=new DatabaseSync(filename,{readOnly:false});
  try {
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('数据库完整性检查失败');
    const meta=db.prepare('SELECT revision FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER);
    if(!meta)throw new Error('项目缺少本地工作区');
    const records=db.prepare('SELECT kind,entry_key,position,payload FROM workspace_records WHERE owner_id=? ORDER BY position').all(LOCAL_OWNER);
    const workspace={categories:[],tables:{},enums:[],chestAppearances:[]},rows=[];
    for(const record of records) {
      const value=JSON.parse(record.payload);
      if(record.kind==='category')workspace.categories.push(value);
      else if(record.kind==='table')workspace.tables[record.entry_key]={fields:value,rows:[]};
      else if(record.kind==='row')rows.push([record.entry_key.split(':')[0],value]);
      else if(record.kind==='enum')workspace.enums.push(value);
      else if(record.kind==='chest_appearance')workspace.chestAppearances.push(value);
      else if(record.kind==='hero_motion')workspace.heroMotion=value;
      else throw new Error(`未知工作区记录类型: ${record.kind}`);
    }
    for(const [key,row] of rows){if(!workspace.tables[key])throw new Error('项目含孤立资产记录');workspace.tables[key].rows.push(row);}
    const category=workspace.categories.find(category=>category.system==='drop_package');
    if(!category)return {changed:false,revision:meta.revision};
    const table=workspace.tables[category.key];
    if(table.fields.some(field=>field.key==='chest_appearance_id')) {
      normalizeWorkspace(workspace);
      return {changed:false,revision:meta.revision};
    }
    if(workspace.chestAppearances.length)throw new Error('已有宝箱外观但缺少掉落包引用字段, 请明确处理部分迁移状态');
    workspace.chestAppearances=appearances.map(appearance=>({...appearance}));
    const field={...DROP_FIELDS.drop_package.find(field=>field.key==='chest_appearance_id')};
    table.fields.push(field);
    for(const pack of table.rows)pack.chest_appearance_id=1;
    normalizeWorkspace(workspace);
    for(const appearance of appearances) {
      const file=join(resourcesRoot,...appearance.icon.split('/'));
      if(!(await stat(file)).isFile()||await realpath(file)!==file)throw new Error(`宝箱图片缺失或不是普通文件: ${appearance.icon}`);
    }
    await mkdir(backupDir,{recursive:true});
    const backup=join(backupDir,`before-chest-appearances-r${meta.revision}-${crypto.randomUUID()}.sqlite`);
    // VACUUM INTO 包含已提交的 WAL 数据; 只更新引用字段和外观记录, 原奖励字节保持不变.
    db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);
    db.exec('BEGIN IMMEDIATE');
    try {
      if(db.prepare('SELECT revision FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER).revision!==meta.revision)throw new Error('迁移期间项目版本变化, 已保留备份, 请停止服务后重试');
      const update=db.prepare('UPDATE workspace_records SET payload=? WHERE owner_id=? AND kind=? AND entry_key=?');
      update.run(JSON.stringify(table.fields),LOCAL_OWNER,'table',category.key);
      for(const pack of table.rows)update.run(JSON.stringify(pack),LOCAL_OWNER,'row',`${category.key}:${pack.id}`);
      const insert=db.prepare('INSERT INTO workspace_records(owner_id,kind,entry_key,position,payload) VALUES(?,?,?,?,?)');
      appearances.forEach((appearance,index)=>insert.run(LOCAL_OWNER,'chest_appearance',String(appearance.id),index,JSON.stringify(appearance)));
      db.prepare('UPDATE workspaces SET revision=revision+1,updated_at=? WHERE owner_id=?').run(new Date().toISOString(),LOCAL_OWNER);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw new Error(`宝箱外观迁移失败, 数据库事务已回滚. 备份: ${backup}. ${error.message}`);}
    return {changed:true,revision:meta.revision+1,backup};
  }finally{db.close();}
}
