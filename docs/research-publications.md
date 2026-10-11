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
