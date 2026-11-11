# 手动客户端工具

这些工具用于豆包升级后的实机排查。先保存工作，通过豆Style启动豆包，并打开专用测试会话；默认连接本机 `9237` 调试端口，可用 `DOUBAO_THEME_PORT` 指定其他端口。

从仓库根目录运行：

| 命令 | 用途与影响 |
| --- | --- |
| `node tools/inspect-client.mjs` | 输出页面结构、颜色、字体与运行错误；默认读取当前页面，输出可能包含页面文字 |
| `node tools/open-settings.mjs` | 打开 Style 设置；可指定关闭、花瓣点击和目标分页 |
| `node tools/capture-settings.mjs` | 在当前会话依次打开三个设置分页并截图，结束后停留在欢迎页 |

截图保存在 `qa/settings-panel-audit/`。该目录被 Git 忽略；对外提交截图或诊断输出前请移除聊天正文、账号和个人信息。工具不会作为自动测试运行。

## 设置操作

```sh
DOUBAO_SETTINGS_TAB=layout node tools/open-settings.mjs
DOUBAO_SETTINGS_ACTION=close node tools/open-settings.mjs
DOUBAO_SETTINGS_CAPTURE_PHASE=current node tools/capture-settings.mjs
```

`DOUBAO_SETTINGS_ACTION` 接受 `open`、`close`、`click-trigger`，默认 `open`。`DOUBAO_SETTINGS_TAB` 接受 `colors`、`layout`、`welcome`。

## 结构排查选项

`inspect-client.mjs` 支持以下显式环境变量：

| 变量 | 行为 |
| --- | --- |
| `DOUBAO_NAVIGATE_URL` | 导航到指定豆包测试会话 |
| `DOUBAO_VIEWPORT=宽,高` | 临时模拟窗口尺寸，正常结束后清除 |
| `DOUBAO_EMULATE_DARK=1` | 模拟系统深色外观 |
| `DOUBAO_DATA_THEME` | 修改页面的原生主题属性 |
| `DOUBAO_HOVER=x,y` | 移动鼠标以检查悬停状态 |

涉及主题、导航和悬停的选项会改变当前页面状态；排查后刷新测试页面或重新启动豆包。新增问题的长期回归用例放在 `tests/`，测试说明见 [测试与验收](../docs/testing.md)。
