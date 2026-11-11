# 自动打包与发布

每个 PR 自动运行 `Checks`，包括单元测试、主题校验和隔离界面测试。检查通过后由维护者合入 `main`。

`main` 的每次推送会先运行同样的检查，再在 GitHub 托管的 macOS ARM64 和 Linux runner 上打包，最后创建一个 GitHub Release，标签为 `community-版本号-运行编号`。同一次运行重试会复用标签和草稿，附件全部上传后才公开发布。

发布页包含 macOS ARM64 应用 ZIP、Windows x64 便携测试 ZIP 和各自的 SHA-256 文件，以及 GitHub 自动提供的源码下载。也可以在 Actions 中手动运行同一流程。

社区版本标记为 **Pre-release**。macOS 包使用临时签名，尚无 Apple 公证；Windows 包无代码签名，实机适配仍需反馈。macOS 来源检查可能阻止直接打开，请按系统提示自行决定是否允许运行。现有已公证版本继续使用原有分发渠道。

## 版本与更新

合入普通修复无需手动创建标签，运行编号会区分每批社区构建。计划发布新功能版本时，在同一 PR 更新 `VERSION` 与 `package.json`，并运行 `npm install --package-lock-only` 同步锁文件。

社区包关闭原正式版的应用内更新，用户从 GitHub Releases 下载后手动覆盖。自动向正式版用户推送更新还需配置 Apple Developer ID、Apple 公证凭据和 Sparkle 更新签名；这些凭据未放入仓库，也未接入社区 CI。

`build-release.sh` 与 `scripts/create-appcast.mjs` 保留给具备相应凭据的维护者。正式更新使用 `DOUSTYLE_COMMUNITY_BUILD=0` 构建，校验签名和下载文件后发布；生产上传单独执行。

## 权限

PR 检查只有仓库读取权限；不向 Fork 的 PR 提供发布凭据。发布任务只在本仓库 `main` 运行，并使用 GitHub 提供的短期 `GITHUB_TOKEN` 写入 Release。无需配置个人访问令牌，也不上传到个人云存储。
