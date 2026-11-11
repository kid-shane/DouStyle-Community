---
name: doustyle-skin-workshop
description: 豆Style 皮肤工坊：为本机豆包工作制作、修改、应用和导出完整皮肤。用户说换成 XP 风格、魔改豆包界面、修改某套皮肤、导入或分享 .style.json 时使用。需要本地电脑模式和支持完整皮肤的豆Style；不用于修改豆包生成的网页内容。
---

# 豆Style 皮肤工坊

完整皮肤是一份固定的界面设计，包含字体、配色、控件造型和布局；应用时与「可调 Style」的个人设置分开保存。使用本 Skill 配套的本地命令操作，不修改豆包或豆Style安装包。

## 连接与使用

通过本 Skill 目录下的脚本调用。脚本自动查找豆Style内置运行环境，不要求安装 Node.js：

```bash
bash <SKILL_DIR>/scripts/doustyle.sh status
bash <SKILL_DIR>/scripts/doustyle.sh list
bash <SKILL_DIR>/scripts/doustyle.sh apply windows-xp
bash <SKILL_DIR>/scripts/doustyle.sh restore
```

`status` 返回当前皮肤 ID；`null` 表示使用可调 Style。`restore` 恢复之前的可调 Style，包括个人排版、配色和跟随系统设置。`open` 打开皮肤选择面板。

连接失败时说明需要在本地电脑模式下启动支持完整皮肤的豆Style；不要尝试云端访问本机或自行更改调试端口、系统设置、安装包。

## 制作或修改

用户明确要改皮肤时，先读取当前作品和 [皮肤格式](references/skin-format.md)，再围绕要求设计一套协调的样式。可以从内置 XP 导出作为可运行起点，也可按相同格式独立制作。

```bash
bash <SKILL_DIR>/scripts/doustyle.sh export windows-xp ./windows-xp-original.style.json
bash <SKILL_DIR>/scripts/doustyle.sh schema
```

修改时使用新的 `id` 和名称；填写 `basedOn` 保留来源 ID 和版本。作者由用户提供，未提供时可写「本地创作」，不要借用原作者署名。不要覆盖原作。只调整目标皮肤文件，其他用户设置保留。

组件通过 `rules[].target` 定位，具体支持列表以 `schema` 为准。不要写豆包页面的临时类名、任意 CSS 选择器、JavaScript 或远程素材地址。页面结构的兼容由豆Style负责。素材嵌入文件，导出时不夹带聊天记录和其他个人配置。

```bash
bash <SKILL_DIR>/scripts/doustyle.sh validate ./my-skin.style.json
bash <SKILL_DIR>/scripts/doustyle.sh import ./my-skin.style.json
bash <SKILL_DIR>/scripts/doustyle.sh apply my-skin
bash <SKILL_DIR>/scripts/doustyle.sh capture ./my-skin-preview.png
```

`import` 只加入皮肤库，`apply` 才会应用。原作和已有同 ID 皮肤不能覆盖；继续迭代使用新的 ID。只有用户要求制作并应用、修改当前外观时才应用；只要文件或草稿则止于验证和交付。

应用后查看真实截图，检查标题栏、侧栏、输入区、菜单和设置面板的可读性与遮挡。不要发送测试消息。截图可能包含用户的会话列表，仅作本地检查，不随皮肤分享。若新皮肤遮挡入口，使用 `restore` 恢复；修复后再试，不反复覆盖个人设置。

## 交付

输出可导入的 `.style.json`，说明已应用还是仅生成文件。需要分享时用 `export <id> <新文件路径>` 导出。导出与截图不覆盖现有文件，请使用新路径。`remove <id>` 可移除已导入皮肤，内置皮肤不可移除。网络发布和给别人发消息不包含在皮肤制作中。
