# 研究产出

研究产出与原始论文分别维护。它是带来源的中文专题调研、综述和研究判断，不使用论文的机器翻译状态，也不加入 `catalog.json` 的论文列表。

当前首篇是《LLM 视觉三条路线：分开预训练、原生预训练与 ViT-free》，以 Gemma 4 12B 为重点，核对截至 2026-10-12 的 7 个来源。v2 按用户要求压缩为 TL;DR、简短对照、三条路线和研究判断，共 7 节（含参考文献）；第三条明确作为原生预训练的特殊架构分支。它未经人工审校，没有声称完成本次模型实验或穷尽文献。原 v1 保存在被忽略的 `.cache/vision-research/revisions/v1/`，供复查。

```text
paper-data/research/
  catalog.json
  vision-pretraining-survey/
    report.json       # 元数据、目录、来源、版本、来源快照与正文指纹
    zh.html           # 可独立阅读和下载的中文正文
```

沿用 `paper-data/**` 的 Git LFS 规则。正文不存入 JSON，不伪造英文原文或翻译记录。原始查阅快照与整理脚本保存在被忽略的 `.cache/vision-research/`；本地工作数据目录 `data/research/` 保留同一报告副本。

阅读器在“论文库 / 研究产出”之间切换，以 `?research=vision-pretraining-survey` 定位报告。支持桌面及移动端目录、引用跳转及返回引用位置、关联论文跳转、主题、字号和按报告修订号保存阅读位置；独立 HTML 也带目录和引用回链。“下载 HTML”使用数据存储地址，跨域存储时浏览器可能打开文档而不直接下载。

`research/catalog.json` 的路径必须是 `research/<id>/report.json`。正文限定同目录 `zh.html`，加载时核对 SHA-256、字节数、文档身份与引用锚点，再经 DOMPurify 清理。没有研究目录的旧数据源仍可提供论文阅读。

`prepare-data.mjs` 自动检查并导出存在的研究目录：核对正文指纹、章节顺序、全部引用及回链、官方来源 URL 和允许的内容；不导出来源快照或任意额外文件。严格论文发布验证也会通过导出检查校验研究文件，但不会再次读取被忽略的来源快照。`sourceSnapshotsReverified: false` 明确区分正文校验与来源快照复核。

```sh
npm run research:verify
npm run check
npm run build:library
DATA_DIR=paper-data npm run dev -- --port 5180
```

后续报告应记录研究范围、时间、生成来源、人工审校状态、事实与推断的区别，以及每个来源的固定版本、定位、查询时间和快照 SHA-256。既有论文的 `snapshotKind: papero-processed-en-html` 指纹指向处理后英文 HTML，另保留 `upstreamSha256`；补充来源记录官方 HTML 或固定提交文件的快照。这两种指纹不能混用。

调研可以引用项目外的论文；需要补充到论文库时，先向用户列出候选论文、官方来源、版本和补充价值，获得明确同意后再完整导入。引用清单不代表论文库已经收录。

用户于 2026-10-12 明确要求“补充并发布”后，R14 对应的 *Scaling Laws for Native Multimodal Models* `2504.07951v1` 已按全文流程加入本轮发布快照。该来源的 `localPaperId` 指向 `scaling-laws-native-multimodal-models`，可从“关联论文”进入中英正文；官方来源快照指纹保持原值，不冒充处理后 HTML 指纹。导入、翻译和图表修复记录见 [论文来源](paper-sources.md#原生多模态缩放定律补充)。

新增或修改研究报告仍遵循项目发布规则：本地实现与验证不自动授权 GitHub 或 Vercel 发布。

## 优化器专题：AdamW 与 Muon

《从 AdamW 到 Muon：原理、证据与训练选型》（2026-10-16，v4）已加入研究目录，路径为 `?research=adamw-muon-optimizers`。共 12 节，以 AdamW 的逐坐标自适应、解耦衰减与 Muon 的矩阵更新为主线，区分理想极因子和有限步数的数值近似，并核对更新尺度、参数分组、优化器状态内存及分布式成本。v2 新增 SGD／Momentum、LAMB 独立章节与四组对照；v3 增加二维更新轨迹、逐层相对步长、矩阵奇异值三组交互原理图。v4 新增“Muon 应用证据表”章节（锚点 `s12`），用 18 条模型／实验记录说明实际应用阶段、配方、对照条件、收益与局限，区分 token、训练 FLOPs、batch、同预算质量、稳定性及整套系统收益；保留不占优的对照和无法量化的采用记录。架构复训不冒充原始发布 checkpoint 已使用 Muon，推理性能不冒充训练优化器收益。

报告使用 16 项既有论文／作者文章和 5 项外部引用，没有新增论文条目。外部 R14 是 LAMB 原论文 `1904.00962v5`；v4 新增 Essential AI `2505.02222v4`、GLM-4.5 `2508.06471v1`、INTELLECT-3 `2512.16144v1`、Trinity `2602.17004v1`，均已向用户列明标题、作者、官方版本及补充价值，只作为研究引用，未导入论文库或伪造双语全文。逐项核对库内处理后英文 HTML 的字节数与 SHA-256，并归档外部官方 HTML。来源、快照类型和复查定位记录于 `report.json`；21 份英文快照、清单、章节生成源码与证据核对材料位于被忽略的 `.cache/optimizer-research/`。v1／v2／v3 正文与元数据保留于其 `revisions/` 子目录。上游原件指纹和原始抓取时间与本次本地核对时间分别记录；未声称穷尽后续修订。

中文正文为独立 `zh.html`，含 11 个 MathML 公式、参考文献及引用回链；沿用研究阅读器和本地工作数据副本。报告明确区分来源实验、公式推导和研究建议，标记未经人工审校、未运行本次训练实验。用户于 2026-10-16 明确要求仅发布本研究及其必需的阅读器支持；本轮不新增或更新论文库条目，不导出其他本地论文工作数据。

## 可交互研究图示

研究正文使用声明式占位，不携带可执行脚本；每个图保留静态默认结果和来源。阅读器净化正文后，由应用自身的 `src/lib/research-visuals.mjs` 挂载 SVG、可键盘操作的滑块／选项、动态数值表与重置按钮。滚动与字号更新不会重置当前输入；离开报告会移除监听器。图形颜色适配白色、黑色和暖色主题；窄屏将控制项纵向排列，并让图表在自身区域横向滚动。

新增图使用下列结构，`id` 在报告内唯一，`data-research-visual` 必须是代码登记的 `optimizer-trajectory`、`layer-trust` 或 `matrix-spectrum`。浏览器加载和数据导出都会校验标记，原有禁止正文脚本、事件属性和任意表单控件的规则继续生效。

```html
<figure id="fig-layer-trust" data-research-visual="layer-trust">
  <figcaption>逐层相对步长演示 <!-- 来源引用及回链同其他正文 --></figcaption>
  <div data-visual-mount><p>默认参数、计算结果与假设；无 JavaScript 时仍可阅读。</p></div>
</figure>
```

“下载 HTML”由 `research-download.ts` 将已净化正文、内嵌样式和同一套应用自有运行时代码组装为独立文档。没有 CDN、模块加载或数据请求，离线可操作；不把数据源提供的脚本写入下载文件。直接访问原始 `paper-data/.../zh.html` 仍是静态正文，含默认值表格；通过阅读器下载则含交互。报告元数据另记录生成默认值时的运行时源码 SHA-256，v1／v2 文本与元数据均保留在工作缓存中。

后续研究可按概念复用或增补登记的图示，仍须提供来源、计算定义、单位与假设。论文实测点、公式推导及合成演示应分别标识；不能用自造曲线冒充论文实验。
