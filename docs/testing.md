# 测试与客户端验收

从仓库根目录运行命令，需要 Node.js 24+。首次安装开发依赖使用 `npm ci`。

## 自动检查

| 命令 | 范围 | 环境 |
| --- | --- | --- |
| `npm test` | 6 个单元测试文件，33 个用例 | Node.js；使用临时目录与本机测试服务 |
| `npm run validate` | 7 套主题、颜色令牌与外观配置 | Node.js |
| `npm run test:ui` | 10 组界面回归 | Playwright 与 Chrome；使用隔离浏览器配置和构造页面 |

GitHub Actions 通过相同的 npm 命令发现测试，界面套件依次执行。新增 `.test.mjs` 文件后会自动纳入对应目录的检查。本地已有 Chrome 时可以直接运行；尚未安装时执行 `npx playwright install chrome`。

## 覆盖范围

| 测试文件 | 验证的行为 |
| --- | --- |
| `tests/unit/doubao-target.test.mjs` | 允许的客户端页面、无关页面拒绝 |
| `tests/unit/theme-appearance.test.mjs` | 主题切换、系统深浅色配对、偏好迁移与保存 |
| `tests/unit/skins.test.mjs` | 皮肤校验、导入导出、独立存储与失败恢复 |
| `tests/unit/update-bridge.test.mjs` | 更新请求来源、命令限制、忙碌与断开恢复 |
| `tests/unit/workshop.test.mjs` | 技能安装、已有文件保护、平台目录与安装状态 |
| `tests/unit/windows-launcher.test.mjs` | 启动路径、调试连接、等待时限与日志脱敏 |
| `tests/ui/theme-appearance.test.mjs` | 配色选择、系统外观变化、重载与保存失败 |
| `tests/ui/client-compatibility.test.mjs` | 侧栏入口、键盘与焦点、原生控件配色、收起与重新挂载 |
| `tests/ui/client-2.36.test.mjs` | 新旧欢迎图替换、页面重新挂载、旧图片迁移期间的选择、新版原生设置背景与文字对比度 |
| `tests/ui/clean-input.test.mjs` | 原生工具菜单、首次宽度测量、隐藏占位按钮、键盘操作、草稿保留与未知结构回退 |
| `tests/ui/collapsed-messages.test.mjs` | 长消息折叠、展开、背景、文字与渐隐 |
| `tests/ui/settings.test.mjs` | 七套主题、设置分页、拖动、图片库、裁剪、重载与恢复默认 |
| `tests/ui/updates.test.mjs` | 检查更新入口、忙碌、失败重试与连接中断 |
| `tests/ui/skins.test.mjs` | 皮肤选择、导入导出、偏好隔离与窄窗口 |
| `tests/ui/platform-shortcuts.test.mjs` | macOS / Windows 快捷键与原生组合键保留 |
| `tests/ui/workshop.test.mjs` | 从面板安装技能、安装进度、状态回读、复制用法与工作区缺失恢复 |

单独运行示例：

```sh
node --test tests/unit/skins.test.mjs
node --test tests/ui/clean-input.test.mjs
```

构造页面固定了需要覆盖的结构，其中客户端适配用例包含豆包工作 2.33.7 和 2.36.15 的结构。升级适配时，把新增结构加入对应套件，并保留仍需支持的旧结构。Windows 快捷键使用浏览器平台信息模拟，Windows 启动与运行还需要真实系统验收。

## 实机验收

客户端结构变更的 PR 请记录豆包版本、系统版本和以下结果：

1. 花瓣入口、快捷键、侧栏收起及设置面板能正常使用。
2. 涉及的浅色与深色 Style、原生弹层、消息及输入框显示正常。
3. 修改偏好后重启，设置继续保留；关闭清爽输入或切回可调 Style 后恢复预期外观。
4. 涉及原生菜单时检查项目、电脑等入口，保留未发送草稿。
5. 使用空白或已脱敏的测试会话截图，在 PR 中说明尚待验证的场景。

需要采集客户端状态时使用 [手动工具](../tools/README.md)。`qa/` 保存本地截图、导出文件和报告，被 Git 忽略，不放测试源码。

## 构建验证

`./build-app.sh` 构建 macOS 应用并检查签名结构与内置 Node.js；Windows 构建见 [Windows 说明](windows.md)。主分支合入后的发布任务执行两端构建及发布文件校验。社区版本的应用内更新当前关闭；更新桥接测试保留其请求与界面逻辑的覆盖。
