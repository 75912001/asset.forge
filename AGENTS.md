# 项目技能

项目共享技能保存在 `.agents/skills/` 中, 使用标准的 `SKILL.md` 入口和相对路径资源, 不依赖个人技能目录. 执行匹配任务前先读取对应技能, 再按需查看其引用资源.

| 技能 | 适用任务 | 入口 |
| --- | --- | --- |
| create-character | 创建 Tiny Kingdom 式胶囊小人角色, 包括单角色、批量独立角色图及提示词. 不用于写实立绘、纯人物小传或角色代码. | [.agents/skills/create-character/SKILL.md](.agents/skills/create-character/SKILL.md) |
| create-icon | 按参考图创建粗黑描边, 圆润造型和鲜亮色块的技能, 道具与资产图标, 支持单张, 批量独立图及提示词, 默认交付 128 x 128 透明 PNG. | [.agents/skills/create-icon/SKILL.md](.agents/skills/create-icon/SKILL.md) |
| 推送git (push-git) | 提交并推送本项目代码, 资源与已保存数据, 在独立副本中验证 clone 后可运行. | [.agents/skills/push-git/SKILL.md](.agents/skills/push-git/SKILL.md) |

技能中的资源路径相对于该技能目录解析. 图像生成使用当前 AI 工具实际可用的能力; 不具备出图能力时按技能交付提示词并说明限制, 不声称已生成图片.

新增或调整项目技能时, 同步维护此表和 README 中的技能说明及 Git 忽略规则, 确保技能文件纳入版本管理. 保持 `.agents/skills/` 为共享源, 避免在不同工具的配置目录复制多份后分别维护.

## 图片资源规格

| 资源类型 | 画布尺寸 | 文件格式 |
| --- | --- | --- |
| 图标 (icon) | 128 x 128 像素 | PNG (`.png`) |
| 角色 | 256 x 256 像素 | PNG (`.png`) |

生成或导出后检查文件的实际格式和宽高, 不仅依靠文件扩展名或提示词声明.
