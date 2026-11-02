import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {normalizeWorkspace} from '../public/editor/workspace.mjs';
export const LOCAL_OWNER='local-workspace';
export function openStore(filename,root,seed,{initialize=true}={}) {
  mkdirSync(dirname(filename),{recursive:true});
  const sqlite=new DatabaseSync(filename);
  try {
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspaces'").get()) {
    if(!initialize)throw new Error('项目数据库缺少工作区表');
    for(const name of readdirSync(join(root,'drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(join(root,'drizzle',name),'utf8'));
  }
  const db={prepare(sql){return {bind(...values){return {sql,values};}};},async batch(statements){
    sqlite.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(({sql,values=[]})=>({results:sqlite.prepare(sql).all(...values),meta:{changes:sqlite.prepare('SELECT changes() n').get().n}}));sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  if(!sqlite.prepare('SELECT 1 FROM workspaces WHERE owner_id=?').get(LOCAL_OWNER)) {
    if(!initialize)throw new Error('项目数据库缺少本地工作区');
    const workspace=normalizeWorkspace(seed?.workspace||{categories:[],enums:[],tables:{}}),records=[];
    const add=(kind,key,position,value)=>records.push([LOCAL_OWNER,kind,key,position,JSON.stringify(value)]);
    workspace.categories.forEach((cat,index)=>{add('category',cat.key,index,cat);add('table',cat.key,index,workspace.tables[cat.key].fields);workspace.tables[cat.key].rows.forEach((row,position)=>add('row',`${cat.key}:${row.id}`,position,row));});
    workspace.enums.forEach((entry,index)=>add('enum',entry.key,index,entry));
    sqlite.exec('BEGIN');
    try{sqlite.prepare('INSERT INTO workspaces(owner_id,revision,updated_at) VALUES(?,?,?)').run(LOCAL_OWNER,Math.max(1,seed?.revision||1),seed?.updatedAt||new Date().toISOString());const insert=sqlite.prepare('INSERT INTO workspace_records(owner_id,kind,entry_key,position,payload) VALUES(?,?,?,?,?)');for(const values of records)insert.run(...values);sqlite.exec('COMMIT');}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
  return {db,close:()=>sqlite.close()};
  } catch(error){sqlite.close();throw error;}
}
