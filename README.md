# DouStyle · 豆Style

选择你的 Style。

一个由个人维护的豆包工作桌面端外观工具。调整配色、字体、排版与欢迎页，支持完整皮肤和本地皮肤工坊。豆包更新后，社区可以通过 Issue 和 Pull Request 一起适配。

[下载社区预览版](https://github.com/kid-shane/DouStyle-Community/releases) · [反馈问题](https://github.com/kid-shane/DouStyle-Community/issues) · [参与贡献](CONTRIBUTING.md)

[![Community](https://github.com/kid-shane/DouStyle-Community/actions/workflows/community.yml/badge.svg)](https://github.com/kid-shane/DouStyle-Community/actions/workflows/community.yml)

## 安装

先安装豆包工作桌面端，并保存正在处理的工作；豆Style首次连接时可能重启豆包。

- **macOS**：Apple 芯片，macOS 13.5+。从 Releases 下载 macOS ARM64 ZIP，解压后把「豆Style.app」移到「应用程序」，再打开。
- **Windows**：Windows 10/11 x64 便携测试版。完整解压 Windows ZIP，双击「豆Style.exe」，详见 [Windows 使用说明](docs/windows.md)。

GitHub 自动发布的社区包标记为 Pre-release。macOS 使用临时签名，尚无 Apple 公证；Windows 无代码签名。macOS 的来源检查可能阻止直接打开，请按系统提示自行决定是否允许运行。Windows 尚需实机反馈。包内自带运行环境，使用者无需安装 Node.js。

社区版本从 GitHub Releases 手动下载更新。旧版已经公证的安装包和应用内更新继续使用原有分发渠道；GitHub 社区包关闭该更新源。

## 使用

启动豆Style后，在侧栏「豆包 工作」标题右侧点击彩色花瓣打开设置。首次常驻显示；使用后在悬停或键盘聚焦时显示。快捷键：macOS `Command + Option + ,`，Windows `Ctrl + Alt + ,`；按 `Esc` 关闭。

内置七套可调 Style：豆包默认浅色、豆包默认深色、Trae、Mira、Aime、Claude 和 Linear。默认使用 Mira，可固定 Style 或跟随系统深浅色，分别保存每套 Style 的自定义颜色。

设置分为三个分页：

- **Style 配色**：调整强调色、背景、前景、我的消息底色与文字色。
- **排版布局**：调整界面与正文字号、行高、两侧边距；统一会话字号、隐藏任务图标、按需开启清爽输入。
- **欢迎页**：修改欢迎语，上传与裁剪本地图片；图片库最多保存 10 张 PNG、JPG、WebP、GIF 或 AVIF。

「完整皮肤」提供 Windows XP 风格，并支持导入、导出 `.style.json`。切回可调 Style 后恢复原来的外观设置。皮肤工坊的用法见 [技能说明](skills/doustyle-skin-workshop/SKILL.md)。

设置保存在本机。发送按键由豆包原生设置控制。生成的 HTML 图表与网页预览保留内容原有配色。

公开版使用 Inter 与系统字体，欢迎页支持用户上传图片；旧私有版本中的 Anthropic / Claude CJK 字体和 Mira 小猫动画未纳入公开源码。

## 恢复原样

退出豆包，等待约 15 秒让豆Style进程结束，再从原来的豆包图标打开。macOS 卸载时把「豆Style.app」移到废纸篓；Windows 删除解压目录。项目通过本机调试连接应用样式，不修改豆包安装包或网络代理。

## 开发与贡献

需要 Node.js 24+：

```sh
git clone https://github.com/kid-shane/DouStyle-Community.git
cd DouStyle-Community
npm ci
npm test
npm run validate
```

macOS 运行源码：保存工作后执行 `./launch.sh`。构建本地应用执行 `./build-app.sh`。

Fork 仓库，在自己的分支修改，然后向 `main` 提交 PR。自动检查覆盖主题、设置、清爽输入、图片库、完整皮肤和启动器；维护者决定合入后，Actions 自动生成可下载的社区预览版本。

- [贡献说明](CONTRIBUTING.md)
- [开发约定](docs/development.md)
- [Style 与皮肤结构](docs/themes.md)
- [自动打包与发布](docs/distribution.md)
- [测试范围与实机验收](docs/testing.md)

仓库按用途组织：

| 位置 | 内容 |
| --- | --- |
| 根目录的运行模块、`theme.css` | Style 注入、设置界面与启动入口 |
| `themes/`、`skins/`、`assets/` | 配色、完整皮肤与许可明确的素材 |
| `windows/`、`packaging/`、`scripts/` | 平台启动、应用资源与发布辅助脚本 |
| `tests/unit/`、`tests/ui/` | 自动单元测试与隔离界面回归 |
| `tools/` | 手动客户端检查与截图工具 |
| `docs/` | 开发、适配、测试与发布说明 |

豆包页面结构随版本变化，反馈问题时请提供豆Style版本、豆包版本、操作系统、复现步骤与脱敏截图。自动化界面测试采用构造页面，实际客户端适配结果请在 PR 中注明。

## 许可

自有代码采用 [MIT](LICENSE)，第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目由个人维护，与豆包及各 Style 参考产品的官方团队无隶属关系。
