# 完整皮肤格式 v1

以 `export` 导出的皮肤为完整模板。格式标识 `format: "doustyle.skin"`，`schemaVersion: 1`。每个文件最大 1 MB，库中最多保存 20 套自定义皮肤，总数据上限 3 MB。

必填信息：`id`（小写字母开头，字母/数字/连字符，2–64 字符）、`name`、`author`、`version`、`description`、`baseMode`（light 或 dark）。改编时增加 `basedOn: { "id": "windows-xp", "version": "1.0.0" }`。

## 设计内容

- `tokens`：语义配色、字体。颜色采用 `#RRGGBB`；RGB 通道自动从对应色值生成。必须保留模板的全部基础令牌。字体可使用系统字体及豆Style已有字体。
- `layout`：`uiFontSize` 12–18、`chatFontSize` 13–20、`chatLineHeight` 1.4–1.9、`contentGutter` 12–360；`uniformChatTypography` 与 `showConversationIcons` 是布尔值。未声明时使用格式默认值。这些是作者设计的一部分，不开放成用户滑块。
- `welcome`：`text` 最多 40 字；`image` 为 `none` 或 `asset:素材ID`。
- `decoration`：`title` 是工作区标题栏的装饰标题；`emblem` 为 `computer`（复古电脑图标）或 `none`。
- `assets`：素材 ID 到 `data:image/png;base64,...` 等内嵌图片的映射。允许 PNG、JPEG、WebP、GIF。只打包这套皮肤需要的素材。
- `rules`：最多 150 组组件样式。`target` 使用 `schema` 返回的组件名，`state` 可省略或为 hover / active / focus-visible / disabled，`style` 是允许的 CSS 属性到字符串值的映射。

例如：

```json
{
  "target": "titlebar",
  "style": {
    "background": "linear-gradient(180deg, #EEEEF6, #8B8FA8)",
    "border-bottom": "1px solid #606477",
    "color": "#FFFFFF"
  }
}
```

图片用于背景时写 `"background-image": "asset:wallpaper"`。不能写远程 URL、任意选择器、脚本、CSS 转义、`!important` 或 at-rule；优先级和作用域由运行时生成。尺寸和排列通过 `schema` 返回的属性集合调整，不能增加格式之外的行为。

主要组件有 shell / main / titlebar / sidebar / sidebarGroup / navigation / conversation / composer / editor / userMessage / menu / menuItem / dialog / settings 及对应细分组件。调用 `schema` 查看最新完整列表。生成内容中的 HTML 预览不在皮肤作用域中。

## 改编与分发

完全相同的文件重复导入时复用已有皮肤；同一个 ID 的不同设计不会被覆盖。一次新改编用一个新 ID；调试继续修改时可移除自己的未发布版本后再导入，或继续用新 ID。内置原作不可删除、不可覆盖。导出内容包含完整规则和素材，不包含当前聊天、用户调色记录或其他皮肤。

当前 v1 保存元信息但不验证作者身份；`basedOn` 是来源记录，不代表已取得外部作品素材的授权。
