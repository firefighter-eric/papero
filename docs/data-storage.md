# 论文数据与前端分离

Papero 是静态前端。浏览器读取目录 `catalog.json`，打开一篇论文时才读取该篇的轻量 `paper.json` 元数据，以及独立的 `en.html`、`zh.html` 正文；LM Studio 只参与本机导入与翻译，线上读者无需连接本机模型。

## 本地目录

```text
data/                                # 整体被 Git 忽略
  catalog.json
  papers/attention-is-all-you-need/
    paper.json                       # 本机翻译检查点，包含双语段落、章节、来源及翻译记录
    assets/                          # 论文图片
    source.html                      # 原始下载内容，不进入前端发布产物
    ...                              # 导入记录、翻译检查点等本地材料
```

`DATA_DIR` 可以覆盖本机数据位置；例如 `DATA_DIR=/Volumes/Papers/papero npm run dev`。开发服务器在 `/paper-data` 提供处理后的 JSON、固定文件名 `en.html`/`zh.html` 和图片，检查实际文件路径，不提供原始来源 HTML、检查点或任意目录文件。

用户已明确允许初版使用 Git LFS。仓库中的 `paper-data/` 是经过验证后生成的公开发布快照，整体由 `.gitattributes` 的 LFS 规则管理；它与持续导入、翻译的本机 `data/` 分开。`data/` 和 `.cache/` 继续被 Git 忽略。只有完整翻译和本地来源验证结束后才生成、提交发布快照，不提交翻译过程中的中间版本。

自定义数据目录优先放在代码仓库之外。如果使用仓库内的其他目录，应先将该目录加入 `.gitignore`；默认忽略规则覆盖 `data/` 与 `.cache/`。

目录记录 `dataPath: "papers/attention-is-all-you-need/paper.json"`。发布正文与元数据位于同一目录；HTML 中 `assets/figure.png` 之类的相对路径也以此目录为基准。浏览器在显示前对两种语言都进行 DOMPurify 清理，保留表格、图片、MathML 公式，移除脚本、样式、表单及危险 URL。本机开发读取旧的检查点 JSON 时仍可直接阅读。

## 最终正文采用 HTML

```text
paper-data/                         # 经过验证的公开发布快照，可由 Git LFS 管理
  catalog.json                      # 列表元数据
  papers/<id>/
    paper.json                      # 文档、段落索引与来源信息，不含正文 HTML 字符串
    en.html                         # 完整英文阅读文档
    zh.html                         # 完整中文阅读文档
    assets/                         # 原图与清理后的 SVG
```

两个 HTML 都是可直接打开的完整文档，保留原有 MathML、公式源注释、表格、代码、图片、引文和锚点。正文按同一顺序包在带 `data-block-id`、`data-block-kind`、`data-source-id`、`data-section-id` 的块容器中，阅读器据此恢复双语对齐。HTML 的基础样式只用于独立阅读；页面应用通过惰性读取和清理显示正文。

发布元数据使用 `schemaVersion: 1` 和 `content.format: "html"`。`content.en`、`content.zh` 分别记录固定文件名 `en.html`、`zh.html` 及完整文件的 SHA-256/UTF-8 字节数；`blocks` 只保存段落索引、翻译来源记录、`contentSha256` 和 `contentOffsets`，不保存 `en`、`zh` 正文字符串。每种语言的 `{start,end}` 是正文在完整 HTML 文件中的 UTF-8 字节位置，包含起点、排除终点。浏览器直接读取这些原始字节、核对哈希后再显示，避免浏览器重新序列化 MathML 时改变公式标记。位置同时绑定到对应块容器的边界，不能挪用相同文本的另一个段落。

用户已确认模型临时响应仍可采用 JSON；本机 `data/` 中的 JSON 检查点也继续保留。导出时才生成公开 HTML，已经发布的 HTML 再构建时按字节复制，避免重编码改变公式或指纹。部分翻译可导出供本地调试，空中文容器和 `null` 哈希表示缺失译文；生产发布仍要求完整翻译。

## 初版通过 Git LFS 部署

发布前先对本机完整数据执行来源及翻译检查，再导出处理文件：

```sh
npm run paper:verify -- --strict-translation --require-data
npm run data:export
```

导出目录是 `.cache/export/paper-data/`。最终发布流程将这个目录作为仓库中的 `paper-data/` 快照；它只含 `catalog.json`、每篇的元数据 `paper.json`、`en.html`、`zh.html` 和 `assets/` 图片。`source.html`、`source-assets/`、模型响应、检查点、锁和缓存不进入快照。先检查 `.gitattributes` 已覆盖 `paper-data/**`，再提交快照；LFS 在 Git 历史中存储指针，在 LFS 服务中保存实际内容。

从 GitHub 克隆后，用 `git lfs pull` 取得真实文件。仅下载 ZIP 或仅有 LFS 指针不能作为已下载的论文数据。需要在克隆目录本地阅读时：

```sh
DATA_DIR=paper-data npm run dev
```

发布快照与生产构建使用独立的严格检查：

```sh
node scripts/verify-release-data.mjs --data-dir paper-data
npm run build:library
```

`build:library` 先检查快照，再执行 `DATA_DIR=paper-data PAPERO_INCLUDE_LOCAL_DATA=1 npm run build`。严格检查要求独立 HTML 正文、全部段落已翻译、标题存在，核对 HTML 文件和段落指纹、容器身份与顺序、目录与文档身份及计数、机器翻译来源元数据、段落英文 SHA-256、公式/代码/引用与原文锚点不变，两种语言分别验证内部链接目标，并检查图片引用闭包和所有图片的 SHA-256/字节数。机器翻译继续明确标记 `humanReviewed: false`，通过自动检查不能宣称人工审校完成。快照中出现正文 JSON、原始来源、调试材料、未知文件或符号链接时会被拒绝。

此检查验证的是**处理后的发布快照**，只保留原始 HTML 的来源哈希及抓取记录，不会重新验证被排除的原始 HTML。完整来源哈希验证仍由前面的 `paper:verify` 在本机 `data/` 上执行。

Vercel 项目连接 GitHub 后，需要在项目 Git 设置启用 Git LFS，再使用 `npm run build:library` 构建；开启 LFS 后重新部署。构建将已取得的处理快照复制至 `dist/paper-data/`，读者通过同一站点的 `/paper-data` 读取，无需另外创建存储服务。GitHub Actions 的发布数据验证也需要 `actions/checkout` 的 `lfs: true`，以实际文件进行验证。[Vercel 官方 Git LFS 说明](https://vercel.com/docs/project-configuration/git-settings)

默认 `npm run build` 仍只构建前端，不包含任何本机或 LFS 论文数据。Vercel 的专用构建命令不会改变这个本地默认行为。显式构建/导出每次都核对图片元数据与实际文件，未下载的 LFS 指针、丢失图片或损坏文件会使构建失败；复制过程中数据发生变化也会拒绝这次输出。

Git LFS 每个修改版本存储整份文件，Vercel 构建和 CI 下载会计入仓库所有者的 LFS 带宽。持续翻译时不提交中间 JSON，能减少无用版本；论文规模增长后，可切换下面的独立存储方案。此流程不修改账户计费或额度。[GitHub LFS 使用计量](https://docs.github.com/en/billing/concepts/product-billing/git-lfs)

## 后续改用独立论文存储

也可以保持代码在 GitHub、论文数据在独立且浏览器可访问的 HTTPS 存储上，例如对象存储或其他静态文件服务。GitHub Actions 或 Vercel 无法自动读到开发电脑上被 Git 忽略的 `data/`，需要单独上传数据或用明确的数据发布流程同步。

在 Vercel 项目环境变量中设置：

```dotenv
VITE_PAPER_DATA_URL=https://papers.example.com/papero
```

这个地址下应有 `catalog.json`、`papers/<id>/paper.json`、同目录的 `en.html`、`zh.html` 和论文图片。环境变量是构建时配置，修改后要重新构建前端。URL 公开出现在浏览器中，不在其中放密钥或带签名的凭证；目前阅读器支持公开读取的数据，不包含私有论文鉴权。

跨域存储需要允许前端域名读取：

```text
Access-Control-Allow-Origin: https://your-app.vercel.app
Access-Control-Allow-Methods: GET, HEAD
```

若所有论文数据都可以公开访问，`Access-Control-Allow-Origin: *` 也可以，并能方便地支持 Vercel Preview 域名。请求不携带 Cookie。JSON 使用 `Content-Type: application/json`，正文使用 `text/html; charset=utf-8`，图片使用对应图片类型。SVG 使用 `image/svg+xml`，并建议设置 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` 与 `X-Content-Type-Options: nosniff`；导入器同时清理 SVG 脚本和外部引用。公开 CORS 只允许浏览器读取，不能代替存储对象本身的公开权限。目录建议短缓存或重新验证，版本化正文和图片可以长缓存。

阅读器对目录、论文元数据和正文 HTML 使用 `cache: no-cache`，每次读取时向存储重新验证缓存；存储配置 `ETag` 或 `Last-Modified` 可以让未改变的文件返回 `304`。存储的代理/CDN 也应遵循重新验证规则。

更新多篇论文时，推荐把整套处理数据发布到新版本目录（例如 `https://papers.example.com/papero/2026-10-10-v1`），所有元数据 JSON、正文 HTML 与图片上传完成后再让新前端构建指向这个地址。这样已打开的阅读器继续使用原版本，新读者使用完整的新版本；不要先覆盖目录，再慢慢上传对应论文。读取端会检查目录与论文的 ID、arXiv ID、块数和章节数，遇到不一致时明确报错，避免显示另一篇或缺失部分的论文。

## 构建与导出

默认 `npm run build` **不包含本地论文数据**，即使开发电脑存在完整 `data/`。这样初始化 GitHub、部署代码时不会顺带上传论文。目录不可用时，阅读器显示数据配置说明。

需要明确将处理后的论文一起部署时：

```sh
PAPERO_INCLUDE_LOCAL_DATA=1 npm run build
```

构建后的 `dist/paper-data/` 仅包含目录、轻量元数据、最终双语正文 HTML 与论文图片（PNG、JPEG、GIF、WebP、AVIF、经过导入器清理的 SVG），原始来源 HTML、日志及翻译检查点不会被复制。这个开关只改变本机构建产物，不会自动提交 Git 或上传任何服务。

准备独立存储的上传目录：

```sh
node scripts/prepare-data.mjs --include --out-dir .cache/export
```

把 `.cache/export/paper-data/` 的**内容**上传到数据地址的对应目录。此命令同样只生成本地文件；用户确认发布范围后再上传。

## 来源与翻译质量

每篇 `paper.json` 保留来源页面 URL、HTML 来源 URL、抓取时间和原始 HTML 的 SHA-256；段落可保留源锚点 `sourceId`。arXiv 论文使用 `source.kind: "arxiv"` 与固定版本 `arxivId`。用户明确选入的官方发布文章使用 `source.kind: "official-article"`、`arxivId: null`，阅读器明确显示“官方文章”；目录中的 `sourceKind` 对应这个类型。旧的 arXiv 数据未填写 `kind` 时仍按 arXiv 读取。

官方 Qwen3.5 文章的公开 API 地址、精确发布时间、原文语言与视频外链记录保存在来源元数据中。原始 HTML、公开字段组成的来源记录以及下载图片暂存于 `.cache/staging/`；默认 `article:import` 不更改 `data/catalog.json`，只有显式 `--publish-local` 才注册本地文章。暂存与注册目录均被 Git 忽略，导出规则与论文一致：仅元数据 JSON、最终中英文正文 HTML 与图片进入发布产物。视频和 PDF 示例保留官方外链，不能离线播放，也不打包到 Vercel。详见 [来源核验与导入命令](paper-sources.md)。

翻译记录实际模型名称、参数和覆盖数，支持检查点续跑。数据的机器翻译状态 `machine` 不表示人工审校完成，缺少的中文段落保持 `null`。读者可随时切到英文核对公式、术语和结论。

用户明确允许用另一个模型继续未完成的翻译时，已经完成的段落继续保留原模型、参数、模型身份与翻译时间，不能把旧译文统一改标为新模型。文档通过 `modelHistory` 保存每次运行的模型、身份、参数、提示词哈希、开始时间与起始覆盖数；`modelsUsed`、`modelIdentities` 声明实际模型，`usageByModel` 分别累计调用计量。文档顶层的模型信息描述当前运行，发布校验按段落检查它所属的历史运行，核对模型身份、参数、时间与原文哈希，并要求总计量与各模型计量之和一致。历史接口未返回推理 token 数时保持未知，不补造零值。`reasoning_effort: "none"` 记录请求参数，不能据此断言后端关闭了推理；接口实际报告的推理 token 数照实保留。未发生模型切换的旧单模型完整数据仍可发布。

当前 JSON 的 `schemaVersion` 为 `1`。读取端核对数据结构、论文身份、目录计数与章节引用，对缺失文件、格式不兼容、网络失败和超时给出可区分的错误。论文越多时，可以继续保留轻量目录并按篇加载；需要搜索全部正文时，再增加独立搜索索引或服务。
