import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProjectId} from '../local/projects.mjs';
import {migrateChestAppearances} from '../local/chest-migration.mjs';

// 先停止编辑器, 再显式指定项目. 不隐式修改其他项目或旧数据备份.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try {
  const id=validateProjectId(process.argv[2]),folder=join(root,'projects',id);
  const result=await migrateChestAppearances({filename:join(folder,'workspace.sqlite'),resourcesRoot:join(folder,'assets'),backupDir:join(folder,'backups')});
  console.log(JSON.stringify({project:id,...result},null,2));
}catch(error){console.error(`失败: ${error.message}`);process.exitCode=1;}
