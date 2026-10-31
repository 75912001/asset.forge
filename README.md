# Asset Forge 本地版

项目位置: F:/asset.forge.

## 启动与停止

- 双击 start.cmd, 启动本机服务并打开配置的本机地址.
- 双击 stop.cmd 停止服务.
- npm start 可在前台启动, Ctrl+C 停止.
- 需要 Node.js 22.13+. 本机已验证 Node.js 24.15.

端口统一在 local/config.mjs 中配置, 默认 4173. 修改后重新启动, 启动器、服务和停止器会使用同一端口. 修改前请先用 stop.cmd 停止旧服务. 如使用 PORT 环境变量覆盖端口, 启动和停止时需保持该变量一致.

日常运行无需安装依赖、构建、ChatGPT 登录或 Cloudflare. 服务只监听本机回环地址, 不加载外部字体.

## 数据和备份

- data/workspace.sqlite: 本地 SQLite, 点击保存写入此文件.
- data/cloud-export.json: 本次迁移的完整云端表备份.
- data/seed-workspace.json: 首次初始化快照, 云端版本 13.
- data/local-config.json: 资源目录和 YAML 导出目录配置.
- data/server.log 和 data/server-error.log: 运行日志.

已迁移 4 个分类、1 个枚举、3 条基础数值、4 条装备、2 个掉落包和 2 条掉落条目. 已核对字段顺序、引用及全部数值. 当前已保存图标为空, 没有云端 PNG 需要搬运.

以后修改保存到本机. 原云端网站的数据保留. 原网页尚未点击保存的草稿不在云端快照内, 需要时可在原网页下载草稿备份.

备份时先停止服务, 再备份 data/ 和实际 PNG 资源目录. 原 Sites 工程及 node_modules 已保留, 原说明见 docs/SITES-README.md.

## PNG 相对路径

默认资源根目录为 F:/asset.forge/assets. 在页面的目录设置中也可以直接指定已有游戏工程资源文件夹.

原文件 F:/asset.forge/assets/equipment/hat.png, 表中只保存 icon: "equipment/hat.png".

点击图标列的选择 PNG, 从资源目录中选择文件. 页面读取原图预览, 不上传、不重命名、不生成副本. 掉落奖励选择器也显示同一图标. 移动原文件后需更新相对路径.

## YAML 导出

默认写入 F:/asset.forge/cfg, 可在目录设置中修改. 点击导出此表或导出 YAML 直接保存. 只导出 YAML, 不复制 PNG. 同名 YAML 会被覆盖.

## 开发验证

- npm test
- node node_modules/typescript/bin/tsc --noEmit

local/server.mjs 提供 HTTP 服务, local/store.mjs 负责 SQLite, public/editor/ 为界面和共享数据校验. 本地启动不使用 Sites 构建链.
