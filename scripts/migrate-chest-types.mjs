import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProjectId} from '../local/projects.mjs';
import {migrateChestTypes} from '../local/chest-type-migration.mjs';

// 调用前停止编辑器. 只修改显式指定的项目, 不自动转换旧备份.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try {
  const id=validateProjectId(process.argv[2]),folder=join(root,'projects',id);
  const result=await migrateChestTypes({filename:join(folder,'workspace.sqlite'),resourcesRoot:join(folder,'assets'),exportRoot:join(folder,'cfg'),backupDir:join(folder,'backups')});
  console.log('\x1b[32m成功: 宝箱类型迁移与 YAML 导出已检查完成\x1b[0m');
  console.log(JSON.stringify({project:id,...result},null,2));
}catch(error){console.error(`\x1b[31m失败: ${error.message}\x1b[0m`);process.exitCode=1;}
