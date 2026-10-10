# Papero

一个静态前端论文阅读器：从 arXiv HTML 离线导入论文，通过 LM Studio 生成中文译文，在浏览器中逐段对照阅读。前端使用 React、TypeScript 和 Vite，可部署到 Vercel。

支持多篇论文、标题与作者搜索、章节目录、中英双栏、交换左右、单语言阅读、双向段落同步滚动、字号调整和阅读位置保存。拖动任意一栏都能带动另一栏；也可关闭同步，分别阅读。提供白色、黑色和淡橙色三种主题，主题与阅读设置会保存在当前浏览器。公式、图表和参考文献随论文保留。移动端也可以切换阅读模式。

## 本地运行

使用 Node.js 24 LTS（`.nvmrc`）与 Git LFS。正式发布的处理后论文库位于 `paper-data/`，克隆后先还原 LFS 文件：

```sh
git lfs install
git lfs pull
npm ci
DATA_DIR=paper-data npm run dev
```

阅读器通过 `/paper-data` 加载论文。每篇文章的英文与中文正文分别保存为 `en.html` 和 `zh.html`，可以单独打开；公式使用原生 MathML，图表与正文放在一起。小型 `paper.json` 只保存标题、目录、段落定位和来源记录，不保存正文字符串。阅读器按相同段落标记对齐两份 HTML。

发布库包括 **Attention Is All You Need**，arXiv `1706.03762v7`，以及 Qwen2、Qwen2.5、Qwen2.5-VL、Qwen3、Qwen3-VL 技术报告。Qwen3.5 收入官方发布文章，明确标注为官方文章。论文来源和固定版本见 [论文来源记录](docs/paper-sources.md)。

需要导入或重新翻译论文时，使用下面的流程。开发服务器默认读取被 Git 忽略的原始工作目录 `data/`；运行 `npm run dev` 即可阅读该目录中的处理结果。本地处理时保留 JSON 检查点，便于中断后继续翻译；发布时导出 HTML 正文。原始下载的 HTML、检查点和模型权重不属于发布库。

## 导入与翻译

论文下载与翻译是本机执行的离线处理步骤，浏览器和 Vercel 都不会直接调用本机模型。使用已有的 LM Studio 模型，不下载或提交模型权重。

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

本次发布包含七篇完整机器译文，共 2327 个对齐内容块。早期段落由 Splash 翻译，后续由 MoE 完成；四段中的八个片段使用 GPT-6 Luna 辅助校正，另一段使用 Luna 草稿作为本地重译参考。实际贡献分别记录在 `assistedCorrections`，不伪造 Luna 的 API 参数或 token 用量。19 处已知问题已复核修复，仍不代表整库经过人工逐句审校。独立的八组首轮翻译比较基本打平，见 [翻译质量比较](docs/translation-comparison.md)。

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
paper-data/          经验证的公开处理数据（整树 Git LFS 跟踪）
  catalog.json       发布目录
  papers/<id>/
    paper.json       轻量元数据、目录、段落定位、HTML 哈希（无正文）
    en.html          完整英文正文与 MathML 公式
    zh.html          完整中文正文与 MathML 公式
    assets/          经整理的本地图像
data/                原始 HTML、目录、论文 JSON、图像（本地，Git 忽略）
  catalog.json       论文目录
  papers/<id>/       每篇论文的数据与素材
```

`data/`、`dist/`、环境变量文件和缓存均被 Git 忽略。`paper-data/**` 使用 Git LFS 保存公开的 HTML 正文、轻量元数据和图片；普通 Git 提交保存的是指针。默认 `npm run build` 只构建前端；发布构建必须显式选择论文库。

```sh
npm run check        # 类型检查、数据安全与处理器测试
npm run build        # 前端代码构建，不包含本地论文
npm run build:local  # 明确选择：把处理后的论文一起放入本机构建产物
npm run build:library # 验证并构建 paper-data/ 发布库，输出 dist/paper-data/
npm run preview      # 预览最近一次构建
```

所有翻译完成后，先验证本地源数据，再导出发布快照：

```sh
npm run paper:verify -- --strict-translation --require-data
node scripts/prepare-data.mjs --include --out-dir .
node scripts/verify-release-data.mjs --data-dir paper-data
npm run check
npm run build:library
```

导出仅包含目录、轻量论文元数据、中英文 HTML 正文和允许的图片，不包含原始下载的 HTML、日志、翻译检查点或模型。元数据记录两份 HTML 的 UTF-8 字节数、整文件哈希与每个段落的哈希；阅读器会检查文件身份、段落顺序和内容完整性，避免混用不同版本。核对显式文件清单后提交代码、`.gitattributes` 与 `paper-data/` 的 LFS 指针，通过 PR 的 CI 验证再合并。CI 使用 `lfs: true` 还原对象，验证处理数据与实际构建产物；未还原的 LFS 指针、缺失图片或未完成译文会阻止发布构建。

## Vercel 与独立数据存储

`vercel.json` 使用 Vite preset、`npm run build:library` 和 `dist`，部署前端与公开的处理后论文库。在 Vercel 项目的 **Settings → Git → Git Large File Storage (LFS)** 中启用 LFS，启用后重新部署，构建时才能读取真实对象。[Vercel Git 设置](https://vercel.com/docs/project-configuration/git-settings)

`.vercelignore` 排除原始 `data/`、缓存、模型所在缓存目录、环境变量和本地构建输出，保留经过验证的 `paper-data/`。Vercel 与浏览器都不调用本机 LM Studio。

论文数据增长后，也可以独立部署。把 `catalog.json`、每篇论文的 `paper.json`、`en.html`、`zh.html` 和 `assets/` 上传至独立的 HTTPS 对象存储或 CDN，并保持目录结构；在 Vercel 项目中设置：

```text
VITE_PAPER_DATA_URL=https://your-data-host.example/papero
```

然后部署前端。前端先读取小型目录，打开某篇论文时才加载元数据与两份 HTML，图像随阅读加载。数据服务需允许阅读器来源的 CORS GET 请求，并使用正确的 JSON、HTML 和图像 MIME 类型。新增或更新数据不需要重新构建前端；切换数据根地址需要重新构建，因为 Vite 环境变量在构建时生效。

使用独立数据服务时，将 Vercel 构建命令改为 `npm run build`，让部署产物只包含前端。如果没有发布库或可读取的数据地址，页面会显示数据配置说明。

公开读取的数据会对访问者可见。需要私有论文或按用户控制访问时，应加入认证数据服务和访问授权，不能把存储密钥放进 `VITE_*` 环境变量。

详细结构、CORS 配置和数据迁移见 [数据存储说明](docs/data-storage.md)。

参考：[Vercel Storage](https://vercel.com/docs/storage)、[Vite 环境变量](https://vite.dev/guide/env-and-mode)、[原论文](https://arxiv.org/abs/1706.03762)。
