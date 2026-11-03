# 英雄动作与网页接入

## 文件和配置

头像为 `projects/<id>/assets/heroes/<英雄标识>.png`, 256 x 256 透明 PNG. 只发现 heroes/ 的直接子级, 不递归, 不建立英雄资料表. 武器建议放在 `assets/icons/weapons/`, 为 128 x 128 透明 PNG. 两者只保存原文件, PNG 不包含挂点或动作.

工作区的 `heroMotion` 是当前项目所有英雄共用的配置, 经统一工作区校验, SQLite 保存, revision 冲突保护和浏览器草稿恢复. 缺失时只读默认值, 首次显式保存才持久化. `hero_motion / shared` 是现有 workspace_records 中的一条记录, 无需数据库表迁移.

`hero-motion.yaml` 导出同一个配置对象. 通过现有导出接口选择 `scope: "__hero_motion__"`, 全量导出也包含它. 导出仍检查 expectedRevision, 不复制 PNG. 不允许分类标识或分类配置文件名覆盖保留配置文件名.

## 数值约定 (v1)

面板和网页示例按 100% 逻辑比例居中显示: 256 x 256 逻辑画布对应 256 x 256 CSS 像素, 不随面板宽度放大头像或武器. 容器不足 256 像素时等比缩小. 图片的实际显示大小仍遵循共享挂点的 `size` 参数, 画布内部的 512 x 512 分辨率仅用于细化绘制, 不作为页面显示尺寸.

- `version: 1`, `amplitude` 范围 0-1, 默认 0.35. 面板以百分比显示.
- `slots.head` 与 `slots.weapon`: `x`, `y` 是 256 x 256 逻辑画布中的图片中心, 范围 0-256; `size` 是正方形显示大小, 范围 1-256. 图片透明边距保留, 不按非透明包围盒重新定位. 挂点超出可见区域的内容按画布裁切.
- 默认头像挂点 `{x:146,y:108,size:184}`, 武器挂点 `{x:52,y:154,size:100}`. 更换资源不自动改变挂点.
- `actions.walk`, `attack`, `hit` 均有 `duration`, 范围 0.1-5 秒. 行走为完整周期, 默认 0.5 秒; 攻击默认 0.7 秒, 受伤默认 0.55 秒.
- 每个动作的 `head`, `weapon` 有 `dx`, `dy`, `sx`, `sy`. 位移系数范围 -5 到 5 像素, 缩放变化系数范围 -0.05 到 0.05. 面板将缩放系数乘 100 显示. 实际变换为曲线系数乘全局幅度, 缩放从 1 开始变化.
- 受伤的 `recoil` 是整体后退, 范围 0-5 像素, 默认 3; `flash` 是透明度减少强度, 范围 0-0.3, 默认 0.3. 它们也乘全局幅度.
- 行走使用正弦曲线, 头像 Y 使用绝对正弦, 武器 Y 错相 0.4 弧度. 攻击与受伤使用半个正弦波, 不加入旋转. 静止始终恒等, 全局幅度为 0 时所有局部变换及闪烁均关闭.

非法数值, 不完整配置和不支持的版本明确报错, 不静默回退为默认配置. 表单非法输入保留为草稿并显示错误, 预览保留最后一份有效参数, 不能保存或导出非法配置.

## 战斗反馈配置 (v2)

`upgradeHeroMotion(value)` 显式生成 v2 配置, 保留原全局幅度, 挂点和行走参数. 未传配置的默认值仍为 v1, 旧项目不会因读取而升级或写库. 当前仅 hero-td 使用 v2. SQLite 仍保存同一条 `hero_motion/shared` JSON, 无需数据库结构迁移. v2 恢复默认参数仍保持 v2.

v2 保留 `version`, `amplitude`, `slots`, `actions.walk`, 将攻击与受击改为 `combat`:

| 字段 | 单位 / 范围 | 默认值 |
| --- | --- | --- |
| anticipation | 秒, 0-0.5 | 0.1 |
| strike | 秒, 0.05-0.3 | 0.05 |
| recovery | 秒, 0-1 | 0.15 |
| attackStrength | 倍率, 0-2 | 1 |
| hitStrength | 倍率, 0-2 | 1 |
| hitStop | 秒, 0-0.05 | 0.05 |

攻击类型为 `shoot`, `thrust`, `slash`, `cast`, `strike`, 是调用时选择的固定轨迹, 不建立逐英雄档案. v2 战斗强度按 `amplitude / 0.35` 缩放, 因此默认全局幅度对应战场设计强度, 0 仍关闭所有局部变换及闪亮. 行走继续沿用 v1 公式. 编辑器与网页示例中的类型, 普通/暴击及组合动作选择仅为预览状态, 不作为英雄装备或属性保存.

```js
const motion = createHeroMotion(savedHeroMotion);
motion.setAction('walk-right');
motion.setAction('idle');
motion.setAction('attack', {style: 'shoot', interval: 1.5});
motion.advance(0.15);
motion.setAction('release', {style: 'shoot'});
motion.setAction('hit', {direction: 1, critical: true, heavy: true, armored: false});
```

`interval` 为秒, `direction` 是世界水平方向 -1 或 1. `release` 触发后坐, `hit` 独立叠加, 不覆盖攻击. `impact` 仅让攻击者产生局部姿态停顿, 不把攻击者当成受伤者. `death` 清除冻结并锁定几何姿态, 调用方继续推进闪亮衰减并绘制死亡淡出. 后缩和后坐在镜像前施加; 世界位置由场景控制, 运行时不改碰撞或射程.

`snapshot()` 的 v2 姿势增加 `body`, `recoilOffset`, `flash`, `criticalGlow`, 部件 `rotation`(弧度), 以及受击叠加与冻结状态. `drawHero` 统一应用缩放, 旋转和只覆盖图片不透明像素的白色遮罩, 遮罩按图片缓存. 暴击金橙光边同样由共享绘制完成. 零幅度和 `reference:true` 保持原始姿态.

`createAttackTiming(config)` 返回 `(role, intervalSeconds, distance=0) => timing`. 角色职责与塔防的 0-5 对应, 距离以格为单位. 结果包含 `cycleTicks`, `releaseDelayTicks`, `flightTicks` 和以秒表示的 `anticipation`, `strike`, `recovery`, `duration`. 时基为 50ms, 默认在蓄力与出手结束的第 3 步出手. 模型由调用方注入此纯函数, 不导入编辑器路径, 不用动画回调扣血. 局部停顿不改变这份逻辑时间.

## 共用运行时

运行时位于 `public/editor/hero-runtime.mjs`, 原生 ESM, 不依赖编辑器, 本地服务或第三方库. 网页发布时将该文件, 同版本的导出配置和需要的 PNG 一起交付, 不重写动作公式或绘制代码. YAML 由网页已有配置加载链路解析成对象, 运行时不内置 YAML 解析器.

```js
import {createHeroMotion, drawHero} from './hero-runtime.mjs';

const motion = createHeroMotion(config);
motion.setAction('walk-right');
motion.advance(deltaSeconds);

ctx.clearRect(0, 0, 256, 256);
drawHero(ctx, {head: decodedHead, weapon: decodedWeapon}, motion.snapshot());
```

- `normalizeHeroMotion(value)` 验证并返回独立的规范化配置. 只有 undefined 使用默认值.
- `createHeroMotion(config)` 返回 `setAction`, `setConfig`, `advance`, `snapshot`, `reset`. `setConfig` 验证并替换配置, 不重置时间. `reset` 回到向左静止, 保留配置.
- v1 `setAction` 接受 `idle`, `walk-left`, `walk-right`, `attack`, `hit`. 受伤期间发起攻击返回 false, 其他有效输入返回 true. 受伤打断攻击, 瞬时动作完成后恢复先前静止或行走意图. v2 的额外事件及受击叠加规则见上文.
- `advance(seconds)` 以非负秒数推进. `snapshot()` 返回动作状态, 意图, 朝向, 时间, 动作进度, 只读配置及姿势. 场景世界坐标由调用方控制.
- `drawHero(ctx, images, snapshot, {reference:false})` 在 256 逻辑坐标绘制, 不清空画布. 不提供 weapon 时只绘头像. reference 为 true 时忽略动作变换, 供静止对照使用. 右向整体镜像, 图层顺序为头像后武器. 绘制会恢复调用方 Canvas 状态.
- 改变装备只替换 `images.weapon`, 不修改头像, motion 或配置. 预览英雄, 装备, 播放动作, 暂停和倍速均属于面板临时状态, 不保存在 heroMotion 中.

示例 `/editor/hero-example.html?project=<id>&hero=heroes%2F<英雄>.png&weapon=icons%2Fweapons%2Fsword.png` 读取工作区中已保存的配置. 省略 weapon 时不装备. 页面无写入操作, 保存新参数后手动重新读取. 项目和资源地址由示例调用方明确传入, 运行时不隐式访问编辑器 API.

## 验证

`npm test` 覆盖动作状态, 限幅, 零幅度, 按时间推进, 原图引用, 草稿和保存失败, 重启, 项目隔离, 并发冲突及导出. 测试在临时项目执行, 不修改用户工作区数据.

示例的"检查同帧一致性"在同一浏览器中使用真实 PNG, 检查静止, 左右行走, 攻击, 受伤各 3 个时间点, 比较单次与多次时间推进的姿势及 256 x 256 RGBA 像素. 面板和示例调用同一 drawHero. 静止像素对齐指同一共享挂点布局, 不以早期全身角色图为基准. 不承诺跨浏览器, 设备缩放或不同画布分辨率的截图逐像素相同.

v2 另外验证四种武器轨迹, 出手后坐, 普通/暴击受击, 攻击中受击, 局部停顿和死亡清冻结. 编辑器与网页示例通过同一预览调度模块驱动共享运行时; 测试覆盖大步追帧与分帧回放一致, 参数保存/重启, 草稿, 项目隔离和 v1 原有行为.
