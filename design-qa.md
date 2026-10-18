# Papero 折页 p 标识验证

final result: passed

本记录是折页 p 品牌接入时的历史本地验收快照；以下论文数量、测试数量和发布状态对应当时的检查，不代表当前论文库规模或本次发布状态。

## 范围与视觉来源

- 用户选定第一张「折页 p」；本次只接入品牌图标，不重做阅读器布局或字标。
- 视觉来源：`.cache/brand/folded-p-concept.png`（1536 × 1024）；独立生成稿：`.cache/brand/folded-p-generated.png`（1254 × 1254，透明 PNG）。
- 使用真实生成资源 `public/brand/papero-mark.png`，裁去透明边距后导出为 256 × 256；没有手工 SVG／CSS 重绘。
- 本地页面：`http://127.0.0.1:5190/?paper=attention-is-all-you-need`。

## 浏览器与证据

- Codex In-app Browser；桌面 1280 × 720，手机 390 × 844，截图为 1 × CSS 像素。
- 浅色：`/private/tmp/papero-logo-light.png`；深色：`/private/tmp/papero-logo-dark.png`；暖色：`/private/tmp/papero-logo-warm.png`；手机抽屉：`/private/tmp/papero-logo-mobile.png`。
- 合并对照：`/private/tmp/papero-logo-comparison.png`。上半部分是方案板与实际页面的场景对照；下半部分将来源主图标与实际 34 px 图标归一到 34 px 后放大，另列深色、暖色和原尺寸 16／32 px 网站图标。
- 方案板是标识展示图而非整个网站的布局目标；聚焦比较图标的 p 轮廓、内孔、竖干、斜切角及主题下的可读性。

## 必需视觉检查

- 字体与文字：保留现有 papero 字标，26 px、680 字重、-1.2 px 字距；页面沿用既有副标题。方案板自动生成的营销文案没有进入产品。
- 间距与布局：图标槽 34 × 34，图标与字标间距 12 px，副标题缩进保持 46 px；手机抽屉无遮挡、无横向溢出，关闭操作正常。
- 颜色：浅色图标 `#333333`，深色 `#dfdfdf`，暖色 `#9f5237`；没有绿色。favicon 与 Apple 图标使用浅米色不透明背景，兼顾深浅浏览器标签栏。
- 图片质量：透明内孔和纸张斜切轮廓保留；页面通过实际 PNG alpha 蒙版沿用主题色。为保证小尺寸清晰，将方案板的折角阴影化为单色轮廓，是预期简化。
- 内容：只有选定的折页 p；没有引入其他候选标识或新增阅读功能。

## 行为与资源检查

- 浅色 → 深色 → 暖色 → 浅色，真实点击主题按钮并核对标识颜色。
- 手机尺寸下打开／关闭论文库抽屉，标识可见且操作不受影响；完成后恢复原桌面视口与浅色主题。
- 页面标题、论文正文和工具栏正常，无 Vite 错误遮罩，浏览器 error／warn 日志为空。
- 页面已声明 ICO、16／32 px PNG favicon 和 180 × 180 Apple touch icon；全部资源 HTTP 200，响应类型和实际图像尺寸正确。
- `npm run check`：97 项前端测试与 133 项脚本测试通过；`npm run build:library` 通过，14 篇论文随现有流程导出。

## Findings 与比较历史

- 首次有效视觉比较没有可操作的 P0／P1／P2 差异，无需视觉修正循环。
- 本地 Vite 在创建 public 目录前启动，曾返回旧组件和 HTML 回退；重启本任务的开发服务后重新加载，确认实际图标与正确资源响应，再执行以上比较。
- 范围限制：未在其他浏览器检查实际标签栏，也未在 iOS 主屏幕安装；Apple 图标的尺寸、背景与安全边距已检查。
- Implementation checklist：图标接入、主题适配、手机抽屉、favicon 导出、构建及浏览器检查均完成；没有执行 GitHub 或 Vercel 发布。
