# 开发与版本管理

公开仓库为 `kid-shane/DouStyle-Community`，由旧版工作区整理后建立独立历史。旧私有仓库、本机未提交内容和分发服务单独保留。

`main` 保存已合入的代码。贡献者通过 Fork 和 PR 参与；维护者合入前查看自动检查与实际客户端适配结果。

运行 `npm ci && npm test && npm run validate` 检查模型、更新桥接、皮肤、Windows 启动器及主题配置；界面回归运行 `npm run test:ui`。完整贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

`VERSION` 使用 `x.y.z`。功能版本变化时同步更新 `package.json` 的版本和 lockfile。每次合入仍会通过独立的 GitHub run number 生成唯一社区预览发布标签。

不提交 `build/`、`dist/`、`qa/`、真实客户端截图、依赖缓存、本机配置、账号与签名密钥。

macOS 本地打包：

```sh
./build-app.sh
```

输出为 `build/app/豆Style.app`，默认社区构建：临时签名、不使用原正式版应用内更新源。运行前保存工作，启动器可能重启豆包。

Windows 构建说明见 [WINDOWS.md](WINDOWS.md)，GitHub 自动发布见 [DISTRIBUTION.md](DISTRIBUTION.md)。
