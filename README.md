# Papero

一个静态前端论文阅读器：离线导入官方 HTML，或将官方 PDF 转成英文 HTML，通过本机 LM Studio 或实际 GPT-6 Luna 任务生成中文 HTML，在浏览器中逐段对照阅读。前端使用 React、TypeScript 和 Vite，可部署到 Vercel。

[在线阅读器](https://papero-omega.vercel.app) · [GitHub 仓库](https://github.com/firefighter-eric/papero)

支持多篇论文、标题与作者搜索、章节目录、中英双栏、交换左右、单语言阅读、双向段落同步滚动、字号调整和阅读位置保存。最左侧论文检索栏与本文目录栏可分别拖动调整宽度，支持键盘操作并保存设置；检索栏可折叠，目录子章节可展开。拖动任意正文栏都能带动另一栏；也可关闭同步，分别阅读。工具栏位于顶部，阅读向下滚动时标题区收起。提供白色、黑色和淡橙色三种主题，主题与阅读设置会保存在当前浏览器。公式、图表和参考文献随论文保留。移动端分别提供论文检索与目录抽屉。

论文列表与标题区显示模型系列和研究标签，可组合筛选 Qwen／千问、DeepSeek、Kimi、MiniMax、Gemini、Gemma、Chinchilla，以及预训练、后训练、缩放定律等研究标签。搜索“千问”也能匹配 Qwen，“Google／谷歌”可检索 Gemini、Gemma 和 Chinchilla，各自保持独立系列；“Chillchila”作为 Chinchilla 的检索别名。报告覆盖多个阶段时保留多个标签。分类依据与维护方式见 [论文标签](docs/paper-tags.md)。

## 本地运行

使用 Node.js 24 LTS（`.nvmrc`）与 Git LFS。正式发布的处理后论文库位于 `paper-data/`，克隆后先还原 LFS 文件：

```sh
git lfs install
git lfs pull
npm ci
DATA_DIR=paper-data npm run dev
```

阅读器通过 `/paper-data` 加载目录。全文条目的英文与中文正文分别保存为 `en.html` 和 `zh.html`，可以单独打开；公式使用原生 MathML，图表与正文放在一起。小型 `paper.json` 只保存标题、目录、段落定位和来源记录，不保存正文字符串。阅读器按相同段落标记对齐两份 HTML。仅来源条目提供官方原文与摘要页链接，不加载正文。

公开处理库 `paper-data/` 包含 **42 个中英全文条目**（41 篇论文及 Qwen3.5 官方文章），共 **16685 个对齐内容块、1032 个正文素材、1159 个处理后文件**。这次按用户明确要求，等新增二十篇完整翻译后一次发布；原有二十二个条目的 386 个正文、元数据和素材文件保持 SHA-256 一致。

已有报告涵盖 Attention、Qwen、DeepSeek、Kimi、MiniMax、Gemini、Gemma 和 Chinchilla。新增二十篇包括 Llama 1／2／3、OLMo 2／3、FineWeb、DataComp-LM、DoReMi、Scaling Laws、DeepSeekMoE、DeepSeek LLM、μP、GPT-2／3、BERT、T5、RefinedWeb、Dolma、Switch Transformers 和 CLIP。固定版本、来源及各系列记录见 [论文来源](docs/paper-sources.md)。Qwen3.5 明确标注为官方文章；GPT-2 来自官方 PDF，转换为完整英文 HTML 后翻译，标注为官方论文。

新增论文保留已验收的本机 Qwen3.6 35B A3B 译文，缺失部分由实际 GPT-6 Luna（低思考）任务补齐；每块记录实际贡献及来源指纹。Llama 3、OLMo 3、μP 和 GPT-2 使用 Luna；Llama 1 和 Scaling Laws 使用 Qwen 并保留定向辅助修正记录；其余新增论文逐块记录两个模型的贡献。全部译文标记为机器翻译、`humanReviewed: false`，未经全篇人工审校。有限抽查发现的限定词遗漏、数值和公式衔接问题已经定向修正。

Kimi 三篇中文全文的公开依据是用户于 2026-10-11 确认已获得作者授权；原许可标注及具体记录保留在 [来源记录](docs/paper-sources.md)。

需要导入或重新翻译论文时，使用下面的流程。开发服务器默认读取被 Git 忽略的原始工作目录 `data/`；运行 `npm run dev` 即可阅读该目录中的处理结果。本地处理时保留 JSON 检查点，便于中断后继续翻译；发布时导出 HTML 正文。原始下载的 HTML、检查点和模型权重不属于发布库。

## 导入与翻译

论文下载与翻译是本机执行的离线处理步骤，浏览器和 Vercel 都不会直接调用本机模型。使用已有的 LM Studio 模型，不下载或提交模型权重。

[项目协作规则](AGENTS.md)要求优先使用官方英文 HTML；固定版本只有 PDF 时，继续执行 **PDF → 英文 HTML → 中文 HTML**，保留结构、公式、图表、引用、页码对应和来源指纹，不能仅放 PDF 链接代替正文。GPT-2 已实现该路径：采用人工定位并经过程序覆盖验证的布局配方，转换 24 页官方 PDF，生成完整语义 HTML、17 个表格与 5 张局部图像。其他 PDF 需要自己的布局配方与核查，不能把 GPT-2 配方直接套用。

`scripts/convert-pdf.py` 使用 pdfplumber 0.11.9 和 pypdf 6.10.0；经核查的 GPT-2 配方为 `paper-metadata/pdf-recipes/gpt-2-technical-report.json`。将官方 PDF 保存至被忽略的工作目录后转换：

```sh
python scripts/convert-pdf.py --pdf data/imports/gpt-2/source.pdf \
  --recipe paper-metadata/pdf-recipes/gpt-2-technical-report.json \
  --out-dir data/imports/gpt-2/converted
npm run paper:import-pdf -- --help
```

PDF 导入器需要转换目录、原始 PDF、布局配方和来源身份元数据；核对 PDF／HTML／素材指纹、所有来源页和字符覆盖后才注册。随后使用相同翻译及 HTML 导出流程。原 PDF、模型响应和转换中间结果保留在本地工作目录。

```sh
# 下载官方 arXiv HTML，提取可对齐的内容块与本地图像。
npm run paper:import -- 1706.03762v7

# 在 LM Studio 启动本地 API，并加载需要的模型。
# 使用本机已安装的确切模型，先检查库存，避免重复下载权重。
# 本次后续翻译使用 Qwen3.6 35B A3B、MLX 4bit。
lms server start --port 1234
lms load qwen3.6-35b-a3b --context-length 8192

# 生成中文译文，可中断并再次执行以继续。
LM_STUDIO_MODEL=qwen3.6-35b-a3b npm run paper:translate -- attention-is-all-you-need

npm run paper:verify
```

导入其他论文使用同样的命令，通过 `--id` 指定阅读器内稳定的论文标识，例如：

```sh
npm run paper:import -- 2505.09388v1 --id qwen3-technical-report
npm run paper:translate -- qwen3-technical-report
```

可使用 `DATA_DIR` 指定独立数据目录；翻译 API 和模型通过 `LM_STUDIO_BASE_URL`、`LM_STUDIO_MODEL` 配置。处理器记录来源、版本、原文哈希、模型、参数和翻译覆盖情况。译文属于机器翻译，未经人工校对，阅读时可随时对照英文。翻译失败或中断会保留已完成的内容；再次运行相同命令继续处理。

翻译请求使用 `reasoning_effort: "none"` 和 `/no_think`，请求模型关闭思考。公式、代码与引用结构保持原样；数字、型号和文本片段数量由独立校验检查，失败片段单独重译。

Splash 可以自动批处理并发请求。增加请求数是否能加速，应在模型已加载、翻译队列空闲时用相同输入实测；无需重复加载模型权重：

```sh
npm run paper:benchmark -- --concurrency 1,2,4 --iterations 4
```

基准使用本地编写的短技术段落与结构化 JSON 输出，记录通过校验的任务吞吐量、API token 用量和耗时；它不代表整篇论文的翻译质量或预计完成时间。

一次翻译整个本地论文库，使用同一个脚本限制全部论文、重试和纠错请求的总并发数：

```sh
npm run library:translate -- --concurrency 2
# 也可只选择几篇；已完成的内容会复用。
npm run library:translate -- qwen3-technical-report qwen3-5-official-article --concurrency 2
```

早期 Splash 短段落实测中，2 路与 4 路分别约为串行吞吐量的 1.31 倍和 1.32 倍，脚本默认 2 路。后续 MoE 使用已测得的四路全局队列，可显式运行 `npm run library:translate -- --model qwen3.6-35b-a3b --concurrency 4`。并发数可设为 1 到 4；不需要为每个本地请求启动一个 Subagent，也不需要加载多份模型。完整测量与局限见 [验证记录](docs/verification.md)。

2026-10-11 首批发布验证记录包含七篇完整机器译文，共 2327 个对齐内容块；这不是新增批次的完成统计。首批早期段落由 Splash 翻译，后续由 MoE 完成；四段中的八个片段使用 GPT-6 Luna 辅助校正，另一段使用 Luna 草稿作为本地重译参考。实际贡献分别记录在 `assistedCorrections`，不伪造 Luna 的 API 参数或 token 用量。19 处已知问题已复核修复，仍不代表整库经过人工逐句审校。独立的八组首轮翻译比较基本打平，见 [翻译质量比较](docs/translation-comparison.md)。

Qwen3.5 当前的官方来源是 [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5)，此次核验未找到对应的基础系列 arXiv 技术报告，因此文章与 arXiv 论文使用不同的来源标记。

```sh
# 暂存官方文章，保留表格、公式、代码、图片和官方演示链接。
npm run article:import

# 注册到本地目录，再生成中文；同一篇文章不能同时导入和翻译。
# 此命令只写本地数据，不上传。
npm run article:import -- --publish-local
npm run paper:translate -- qwen3-5-official-article
```

不同论文可以并行处理，共享目录更新通过锁与原子写入保护；同一篇论文只允许一个导入或翻译进程，重复启动会停止并保留现有数据。建议用 `library:translate` 统一管理 API 请求数。完整性验证使用 `npm run paper:verify -- --strict-translation --require-data`；只在所有文章中文内容齐全时通过。

## 代码与数据

```text
src/                 阅读器与数据访问层（代码）
scripts/             离线导入、翻译、验证与构建脚本（代码）
docs/                设计与数据部署说明（代码）
paper-metadata/      经核验的分类、固定版本作者与 PDF 布局配方
paper-data/          经验证的公开处理数据（整树 Git LFS 跟踪）
  catalog.json       全文与仅来源条目的发布目录
  papers/<id>/
    paper.json       轻量元数据、目录、段落定位、HTML 哈希（无正文）
    en.html          完整英文正文与 MathML 公式
    zh.html          完整中文正文与 MathML 公式
    assets/          经整理的本地图像
data/                原始 HTML、目录、论文 JSON、图像（本地，Git 忽略）
  catalog.json       论文目录
  papers/<id>/       每篇论文的数据与素材
.cache/local-library/ 本地 HTML 导出（Git 忽略）
```

仅来源条目使用 `access: "source-only"`、`dataPath: null`、`blockCount: 0`、`sectionCount: 0`、`titleZh: null`、空的 `abstract`／`abstractZh` 和 `translationStatus: "pending"`；其下没有 `papers/<id>/` 目录。这个状态表示没有公开译文，不代表本地翻译进度。读取端在发送正文请求前拒绝加载此类条目。

`data/`、`dist/`、环境变量文件和缓存均被 Git 忽略。`paper-data/**` 使用 Git LFS 保存公开目录、全文条目的 HTML 正文、轻量元数据和图片；普通 Git 提交保存的是指针。默认 `npm run build` 只构建前端；发布构建必须显式选择论文库。

```sh
npm run check        # 类型检查、数据安全与处理器测试
npm run build        # 前端代码构建，不包含本地论文
npm run build:local  # 把本地处理数据放入本机构建产物；不上传
npm run build:library # 验证并构建 paper-data/ 发布库，输出 dist/paper-data/
npm run preview      # 预览最近一次构建
```

本地完整库单独导出到被 Git 忽略的目录，供本机阅读；部分译文也可导出，完整性仍以验证结果为准：

```sh
node scripts/prepare-data.mjs --include --data-dir data --out-dir .cache/local-library
DATA_DIR=.cache/local-library/paper-data npm run dev
# 本地库全部翻译完成后执行：
npm run paper:verify -- --strict-translation --require-data
```

该命令生成 `.cache/local-library/paper-data/`，不会上传或更新公开库。公共库使用显式审查的目录，本次公开快照包含 42 个全文条目。添加论文、修改界面和构建本地库不等于发布授权；只有用户明确要求发布时才推送 GitHub 或部署 Vercel。用于组装的公共元数据暂存目录属于被忽略的临时材料，不是自动发布本地全文的通道。校验处理后快照再构建：

```sh
node scripts/verify-release-data.mjs --data-dir paper-data
npm run check
npm run build:library
```

导出器不读取或复制仅来源条目的本地正文与素材；严格发布校验拒绝这些条目对应的任何正文目录，也拒绝未知文件、原始来源和检查点。全文元数据记录两份 HTML 的 UTF-8 字节数、整文件哈希与每个段落的哈希；阅读器会检查文件身份、段落顺序和内容完整性，避免混用不同版本。核对显式文件清单后提交代码、`.gitattributes` 与 `paper-data/` 的 LFS 指针，通过 PR 的 CI 验证再合并。CI 使用 `lfs: true` 还原对象，验证处理数据与实际构建产物；未还原的 LFS 指针、缺失图片或全文条目的未完成译文会阻止发布构建。

## Vercel 与独立数据存储

`vercel.json` 使用 Vite preset、`npm run build:library` 和 `dist`，部署前端与公开的处理后论文库。在 Vercel 项目的 **Settings → Git → Git Large File Storage (LFS)** 中启用 LFS，启用后重新部署，构建时才能读取真实对象。[Vercel Git 设置](https://vercel.com/docs/project-configuration/git-settings)

`.vercelignore` 排除原始 `data/`、缓存、模型所在缓存目录、环境变量和本地构建输出，保留经过验证的 `paper-data/`。Vercel 与浏览器都不调用本机 LM Studio。

论文数据增长后，也可以独立部署。把已通过公开发布校验的 `catalog.json` 和全文条目的 `paper.json`、`en.html`、`zh.html`、`assets/` 上传至独立的 HTTPS 对象存储或 CDN，并保持目录结构；仅来源条目继续只存在于目录。在 Vercel 项目中设置：

```text
VITE_PAPER_DATA_URL=https://your-data-host.example/papero
```

然后部署前端。前端先读取小型目录，打开全文条目时才加载元数据与两份 HTML，图像随阅读加载；仅来源条目直接提供官方链接。数据服务需允许阅读器来源的 CORS GET 请求，并使用正确的 JSON、HTML 和图像 MIME 类型。新增或更新数据不需要重新构建前端；切换数据根地址需要重新构建，因为 Vite 环境变量在构建时生效。

使用独立数据服务时，将 Vercel 构建命令改为 `npm run build`，让部署产物只包含前端。如果没有发布库或可读取的数据地址，页面会显示数据配置说明。

公开读取的数据会对访问者可见。需要私有论文或按用户控制访问时，应加入认证数据服务和访问授权，不能把存储密钥放进 `VITE_*` 环境变量。

详细结构、CORS 配置和数据迁移见 [数据存储说明](docs/data-storage.md)。

参考：[Vercel Storage](https://vercel.com/docs/storage)、[Vite 环境变量](https://vite.dev/guide/env-and-mode)、[原论文](https://arxiv.org/abs/1706.03762)。
