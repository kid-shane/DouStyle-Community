# Windows 便携测试版

适用于 Windows 10/11 x64，尚需 Windows 实机验证。它使用共享的主题注入与皮肤代码，启动器负责查找豆包工作并启动本机调试连接。

1. 从 GitHub Releases 下载 Windows ZIP，完整解压。
2. 保存工作，从系统托盘退出豆包。
3. 双击 `豆Style.exe`；如未自动找到豆包，选择已安装豆包的主程序 EXE。
4. 在侧栏标题右侧点击花瓣，或按 `Ctrl + Alt + ,` 打开设置。

退出并恢复原样：先从托盘退出豆包，等待约 15 秒，再使用原来的豆包入口。卸载只需删除解压目录。更新时下载并完整解压新的测试包。

包内含 Node.js，使用者无需安装开发环境。测试版没有 Windows 代码签名。日志位于 `%LOCALAPPDATA%\DouStyle\logs\windows-test.log`；反馈时请提供 Windows 版本、豆包版本、问题步骤和脱敏截图。

本地构建需要 Python 3.12+、curl 和 Go：

```sh
python3 build-windows.py --version 1.1.1-windows-test.1
```

脚本校验固定 Node.js 依赖，生成便携 ZIP、构建信息和 SHA-256 清单。输出保存在 `dist/`，不上传云存储。
