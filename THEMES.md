# Style 配置

组件样式只引用 `--db-theme-*` 语义令牌。启动器会读取 `themes/` 下的全部配置并自动放进 Style 列表。每套新 Style 只需复制 `themes/linear.json`、填写唯一的 `id` 并修改令牌值。

当前 Style 顺序为豆包默认-浅色、豆包默认-深色、Trae、Mira、Aime、Claude 和 Linear。豆包两套默认 Style 的基础颜色直接取自豆包原生浅色/深色变量；Trae 与 Mira 使用用户参考截图中的主背景、表面、边框、文字和强调色建立语义色阶；Aime 提取近白暖灰外壳、清透浅灰层级、鲜绿色状态、柠檬绿选中反馈与蓝色链接，保留参考界面的双重强调关系；Claude 使用 Clay 品牌色、暖灰层级，界面使用 Inter 与系统无衬线字体，正文使用系统衬线字体；Linear 作为更鲜明的深色外观放在列表末尾。

## 令牌分组

- 品牌与交互：`accent`、`accentHover`、`accentPressed`、`link`、`linkHover`
- 背景层级：`background`、`sidebar`、`surface`、`surfaceElevated`、`surfaceHover`、`selectionBackground`
- 文字：`foreground`、`foregroundRgb`
- 用户消息：`userMessageBackground`、`userMessageText`
- 边框与滚动条：`border`、`borderStrong`、`scrollbar`、`scrollbarHover`
- 内容边界：`contentCanvas` 仅用于生成的 HTML/CSS 回复画布，不对画布内部重新着色
- 字体：`fontUi` 用于界面，`fontChat` 用于助手回复正文

`theme.css` 负责把这些语义令牌映射到豆包现有变量和组件状态；Style 文件不写组件选择器。

## 可调外观

`appearance.json` 是所有 Style 共用的设置模型。`colorControls` 声明可被用户覆盖的主要语义色；`controls` 声明排版项；`toggles` 声明布尔型显示选项。每个排版项同时声明：

- 面板名称和说明
- CSS 变量
- 最小值、最大值、步长和推荐默认值
- 显示单位

当前颜色项包含强调色、背景、前景、我的消息底色和我的消息文字；排版项包含界面字号、正文字号、正文行高和两侧边距；布尔选项包含“统一会话字号”和“隐藏任务图标”。“统一会话字号”默认开启，会让 Markdown 标题、普通段落、列表内嵌段落、思考过程与标签和用户消息共同跟随正文字号与行高，同时保留标题字重与思考标签的弱化样式；如需保留豆包原生字号层级可手动关闭。已有用户明确保存的关闭状态会继续保留，缺少该设置的旧数据与“恢复 Style 默认”均按开启处理。“隐藏任务图标”默认开启，只隐藏置顶与最近列表中的单会话来源图标，不影响项目文件夹图标。“界面字号”会覆盖侧边栏导航、项目和会话文字中的原生固定字号；“两侧边距”是唯一的会话宽度控件，它会根据当前主区域宽度生成一个共享内容网格，由助手回复、我的消息和输入框同时引用。旧版的“内容宽度”会在首次升级时换算成等效边距，随后从本地设置中移除。面板由配置自动生成；后续新增 Style 只改颜色令牌，新增可调项只扩展 `appearance.json`，不需要重写面板结构。

自定义强调色时，系统会自动派生链接、悬停和按下状态；自定义背景时，会自动派生侧边栏、表面、边框和滚动条层级。这样主要色可以自由调整，同时不会把组件状态拆散成彼此无关的色值。

用户调整值保存在豆包页面自己的本地存储中，只影响本机外观与输入偏好。发送按键由豆包原生设置控制，豆Style不再保存或接管发送快捷键。Style 启动器不会写入豆包账户数据。

`cleanInput` 是“清爽输入”布局开关，默认 `false`。通过限制原生溢出列表可用宽度收纳工具，并在原生“更多”菜单补充电脑入口；不搬移 React 管理的节点、不重写项目或权限选择逻辑。临时标记、菜单项和事件在关闭或重新注入时清理；当前 Style 的“恢复默认”会同时按布局默认值关闭它。

`themeMode` 为 `fixed` 或 `system`；`themePair.light/dark` 保存两种系统外观各自使用的 Style，仅接受对应 `baseMode` 的预设，默认搭配由 `appearance.json` 的 `systemTheme` 定义。运行时 `themeId` 始终是实际生效的 Style。`customColorsByTheme` 按 Style 保存颜色，`customColors` 保留为当前 Style 的兼容字段；旧数据的颜色迁移至原 Style。恢复当前 Style 默认不会清除其他 Style 的颜色，也不会关闭自动模式或忘记搭配。系统外观来自 `prefers-color-scheme`，不从被注入样式修改的页面 `data-theme` 反推。

完成修改后运行：

```bash
node validate-theme.mjs all
```

校验会逐套检查缺失或闲置的颜色令牌、主要色控件对应的 Style 值、缺失或非法的设置定义，以及散落在组件 CSS 里的十六进制颜色。

## 完整皮肤

完整皮肤保存在 `skins/*.style.json`，独立于 `themes/*.json` 的可调 Style。`skin-model.mjs` 负责格式校验与组件到豆包页面的映射；`skin-runtime.mjs` 负责独立存储、应用与恢复；`skin-ui.mjs` / `skin-ui.css` 负责皮肤库界面。

皮肤声明固定的 `tokens`、`layout`、`welcome`、`rules` 和内嵌 `assets`。作者通过语义组件和允许的 CSS 属性创作，无需了解豆包临时类名。运行时限定作用域，不载入皮肤脚本或远程素材，不移动豆包管理的业务节点，不修改发送方式或权限。新增结构性行为应由适配层统一实现。

导入库使用独立的 `doustyle-skins-v1`，内置皮肤从应用资源加载。单个文件上限 1 MB、20 个自定义皮肤、库数据总上限 3 MB；保存失败时保留原状态。相同 ID 不覆盖，导出包含完整规则和素材。`schemaVersion` 独立于皮肤作者的 `version`。

验证：

```bash
node --test qa-skins.test.mjs
node qa-skins-runtime.mjs
```

界面测试使用隔离 Chrome，覆盖固定皮肤、原设置恢复、系统外观、重载、文件导入导出、非法文件和窄窗口。真实客户端检查不得向会话发送测试消息。
