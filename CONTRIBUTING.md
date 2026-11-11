# 参与豆Style

欢迎修复豆包新版兼容问题、改进 Style、补充皮肤和完善测试。小修复可以直接提交 PR；涉及入口、数据存储或整体交互的调整，先开 Issue 描述场景。

## 提交改动

1. Fork 本仓库，在自己的仓库创建分支。
2. 修改代码，运行对应检查。
3. 向本仓库的 `main` 发起 Pull Request，写清触发场景、变化和验证结果；视觉修改附脱敏截图。
4. 自动检查通过后，由维护者决定是否合入。合入后 GitHub Actions 自动打包并发布社区预览版。

仅维护者管理上游主分支。Fork 和提交 PR 无需上游写权限。请勿在提交中放入聊天内容、账号信息、本地设置、访问令牌、签名证书或来源授权缺失的素材。

## 开发检查

需要 Node.js 24 或更新版本：

```sh
npm ci
npm test
npm run validate
```

隔离界面测试需要 Chrome：

```sh
npx playwright install chrome
npm run test:ui
```

这些界面测试使用临时浏览器配置与构造页面，覆盖主题、设置面板、清爽输入、图片库、皮肤及快捷键。它们通过后，涉及客户端结构的修复还需在对应版本的豆包桌面端检查，并在 PR 中填写版本。

历史 `qa-*.mjs`、`capture-*.mjs`、`inspect*.mjs` 中部分脚本会连接真实豆包客户端。仅按脚本用途单独运行，不要批量执行；测试会话通过 `DOUBAO_QA_CHAT_URL` 传入，截图和生成结果保留在被 Git 忽略的 `qa/`。

运行 macOS 源码：先保存正在处理的工作，再执行 `./launch.sh`。首次连接时启动器可能重启豆包。退出豆包并等待约 15 秒，再从原来的豆包图标打开即可恢复原生外观。

## 适配位置

- `themes/*.json`、`appearance.json`：配色与可调项定义。
- `theme.css`、`injector.mjs`：页面结构适配与设置界面。
- `composer-clean-input.mjs`：清爽输入与原生菜单协作。
- `skin-*.mjs`、`skins/`：完整皮肤及皮肤工坊。
- `windows/`：Windows 启动器，尚需实机反馈。

提交到本仓库的自有代码沿用 MIT 许可证；第三方内容需保留许可声明。
