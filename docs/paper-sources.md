# 示例论文的官方来源

## 原生多模态缩放定律补充

核验日期：2026-10-12。用户同意补充并发布 *Scaling Laws for Native Multimodal Models*，作者为 Mustafa Shukor、Enrico Fini、Victor Guilherme Turrisi da Costa、Matthieu Cord、Joshua Susskind、Alaaeldin El-Nouby。固定为 [arXiv 2504.07951v1](https://arxiv.org/abs/2504.07951v1)，正文来自 [官方 v1 HTML](https://arxiv.org/html/2504.07951v1)，没有改用后续修订版。论文许可为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；原始作者、英文标题、固定来源与许可记录随正文保留。

本地 ID 为 `scaling-laws-native-multimodal-models`，包含 238 个中英对齐内容块、42 个目录项及 90 个正文图像文件。原始 HTML SHA-256 为 `17ecca9e3f28a219d4e5fb8079e45f2485d61e10fcf0be98cec3cd587c94ed45`，抓取时间为 `2026-10-11T17:09:19.714Z`；UTC 与上述本地核验日期对应。它补充了综述 R14 的原生 early/late fusion 受控缩放实验，不作为所有模型和预算下的普遍能力排名。

官方 HTML 的 84 个图表面板使用内嵌 SVG。原导入器的正文清理会移除 SVG 路径，仅留下脱离图形的文字，因此本轮从同一固定来源渲染完整面板为 2 倍像素的 PNG，另保留 6 个官方图像文件。使用 Chromium `154.0.8037.98`，视口 `1440×1000`、`deviceScaleFactor: 2`、等待字体就绪后按 SVG 元素边界渲染；不是整页截图。图中文字保留官方英文，图注翻译中文。原始 SVG 与其 MathML 保存在被忽略的 `source-assets/inline-svg/`；每张来源 SVG 与输出 PNG 的指纹、尺寸、浏览器参数、来源 HTML 指纹以及修改的正文块记录在 `source.repairs` 和资产元数据中。原始 `source.html` 未修改。官方 HTML 在附录前有一个空的 `ltx_title_part`；目录标签补为“Appendices / 附录”，双语正文仍保留原空标题，修复记录明确限定为目录元数据。

主译与定向重译均实际调用已安装的 `qwen3.6-35b-a3b`：`mlx-community`、MLX `4bit`、35B/A3B、8192 token 上下文；没有下载新模型。API 参数为 `temperature: 0.1`、`top_p: 0.9`、`max_tokens: 4096`、基础 `seed: 42`、`reasoning_effort: none`、`stream: false`。正常与纠错运行采用并发 1–2；实际批次预算、重试 seed、模型身份、用量、响应通道与指导指纹分别保留。摘要、融合优劣、参数与数据比例、MoE 饱和与公式变量对应等处做过定向核对和修正，不能据此声称全篇人工审校；公开译文仍为 `humanReviewed: false`。

原始来源与处理后双语 HTML 分别经过严格校验，检查图像指纹、数值、公式、内部引用、内容块对应和模型记录。新增条目单独导出，再追加到公共目录；原有 54 个全文条目的文件保持原指纹。综述和论文的实际阅读器与线上验证在发布后另行执行。

核验日期：2026-10-10。导入固定的 arXiv 版本，保留该版本 HTML 的来源 URL、抓取时间、SHA-256 和图片指纹。以下 HTML 地址均已实际请求，返回 `200 text/html`，包含 LaTeXML 论文正文、匹配的论文标题与 arXiv 版本水印。

| 论文 | 固定版本与官方摘要页 | 官方 HTML | 本地论文 ID |
| --- | --- | --- | --- |
| Attention Is All You Need | [1706.03762v7](https://arxiv.org/abs/1706.03762v7) | [HTML](https://arxiv.org/html/1706.03762v7) | `attention-is-all-you-need` |
| Qwen2 Technical Report | [2407.10671v4](https://arxiv.org/abs/2407.10671v4) | [HTML](https://arxiv.org/html/2407.10671v4) | `qwen2-technical-report` |
| Qwen2.5 Technical Report | [2412.15115v2](https://arxiv.org/abs/2412.15115v2) | [HTML](https://arxiv.org/html/2412.15115v2) | `qwen2-5-technical-report` |
| Qwen2.5-VL Technical Report | [2502.13923v1](https://arxiv.org/abs/2502.13923v1) | [HTML](https://arxiv.org/html/2502.13923v1) | `qwen2-5-vl-technical-report` |
| Qwen3 Technical Report | [2505.09388v1](https://arxiv.org/abs/2505.09388v1) | [HTML](https://arxiv.org/html/2505.09388v1) | `qwen3-technical-report` |
| Qwen3-VL Technical Report | [2511.21631v2](https://arxiv.org/abs/2511.21631v2) | [HTML](https://arxiv.org/html/2511.21631v2) | `qwen3-vl-technical-report` |

这五篇 Qwen 技术报告的论文编号也可在官方仓库的引用部分交叉核对：[Qwen2 / Qwen2.5 / Qwen3 的当前官方仓库](https://github.com/QwenLM/Qwen3#citation)、[Qwen2.5-VL / Qwen3-VL 的当前官方仓库](https://github.com/QwenLM/Qwen3-VL#citation)。旧仓库链接可能随着后续模型发布重定向，因此导入始终使用上表的固定 arXiv HTML。

## Qwen3.5 的核验状态

截至 2026-10-10，未在官方仓库引用与 arXiv 标题搜索中找到 **Qwen3.5 基础系列**的官方技术报告。官方资料是 [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5)，官方仓库仍用 `@misc` 引用这篇 2026 年 2 月的博客。博客提到更多实验结果将在后续技术报告中公开。

[官方仓库原地址](https://github.com/QwenLM/Qwen3.5) 目前重定向到后续模型的仓库，但引用部分保留 Qwen3.5 博客记录；[arXiv 的 Qwen3.5 标题搜索](https://arxiv.org/search/?query=Qwen3.5&searchtype=title&abstracts=show&order=-announced_date_first&size=50) 当前没有对应的基础系列报告。这个结论只描述此次核验结果，后续发布时应重新检查。

[Qwen3.5-Omni Technical Report](https://arxiv.org/abs/2604.15804) 是独立的 Omni 系列论文，不能代替所请求的 Qwen3.5 基础系列报告。当前没有为 Qwen3.5 编造 arXiv ID。

用户已明确选择加入 Qwen3.5 官方发布文章全文。阅读器标注为**官方文章**，`arxivId: null`、`source.kind: "official-article"`，目录中的 `sourceKind` 同样明确标识此类型；它不计作 arXiv 技术报告。

其公开英文正文来自 [Qwen 官方文章 API](https://qwen.ai/api/v2/article/?language=en-US&path=qwen3.5&type=qwen_ai)，这是官网公开页面使用的无鉴权接口。官网文章地址仍是 [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5)，slug 为 `qwen3-5-official-article`。来源 payload 给出的发布时间为 `2026-02-16T04:00:00+08:00`；搜索页面的日期可能不同，导入记录采用这个明确发布时间。

导入器保存原始 HTML 与其 SHA-256，保留完整段落、性能表格、图示、示例代码和模型演示文字。源 LaTeX 在翻译前转为 MathML，并保留原始 LaTeX 注释；不能渲染的源公式仍保存为不可被机器翻译改写的 MathML 文本。18 个官方视频示例保留原始外链及来源记录，不下载视频文件；官方 PDF 示例保留下载链接。图片下载到文章自己的 `assets/`，重复图片只存一份。原始 API 中与正文无关的内部元数据不会保存。

## 可复现的本地导入

```sh
npm run paper:import -- 1706.03762v7 --id attention-is-all-you-need
npm run paper:import -- 2407.10671v4 --id qwen2-technical-report
npm run paper:import -- 2412.15115v2 --id qwen2-5-technical-report
npm run paper:import -- 2502.13923v1 --id qwen2-5-vl-technical-report
npm run paper:import -- 2505.09388v1 --id qwen3-technical-report
npm run paper:import -- 2511.21631v2 --id qwen3-vl-technical-report
```

官方文章先暂存，不改动正在工作的论文目录：

```sh
npm run article:import
```

输出默认为被 Git 忽略的 `.cache/staging/qwen3-5-official-article/`。`--refresh` 明确重新抓取来源与图片；`--stage-dir <path>` 覆盖暂存位置。

该文章没有正在运行的导入或翻译任务时，显式注册到本机 `DATA_DIR`，再交给同一模型翻译：

```sh
npm run article:import -- --publish-local
npm run paper:translate -- qwen3-5-official-article
```

`--publish-local` 只注册本地目录，不上传到远端。同一篇的注册、导入和翻译使用排他锁；已有任务持有该篇锁时，新任务在写入数据前失败。不同篇可以并行，各自只有一个检查点写入者，目录更新通过跨进程锁串行合并，保持已有论文顺序。锁记录 PID、主机名和唯一标识；只回收同主机已经退出的进程锁，活跃或其他主机的锁等待到期限后失败，不覆盖数据。锁文件也位于被 Git 忽略的 `DATA_DIR`。本地模型是否能从并发获得加速，应先运行实际基准测量，再选择有界客户端数量。

重复注册相同来源且相同块与章节结构时保留已有译文。来源 SHA 改变，或相同来源经过新版提取器得到不同块与章节时，均在写入目录或文件前停止替换，需要明确迁移旧译文，避免保留不完整的旧提取结果或覆盖现有翻译。

随后按篇翻译，例如：

```sh
npm run paper:translate -- qwen3-technical-report
npm run paper:verify -- --strict-translation --require-data
```

整个本地目录可以交给一个脚本处理，所有论文共享同一个请求上限：

```sh
npm run library:translate -- --concurrency 2
```

`--concurrency` 允许 1–4，库队列默认为 2；单篇命令默认为 1。论文内部的批次和超大段落分块可以并行，但正常请求、单片段纠错和重试都计入同一上限。客户端只请求 `reasoning_effort: none` 并使用 `/no_think`，是否真正没有推理 token 以模型返回值为准。`translation.parameters` 记录实际 API 参数，`translation.concurrency` 记录该次客户端并发数；`translation.usage.observedReasoningTokens` 与 `reasoningUsageResponses` 仅统计实际返回了该字段的响应，历史缺失值仍未知。

当原生模型清单确认上下文不超过 8192 token 时，新运行把最大输出限制设为 4096 token，每次请求最多 40 个文本片段、目标原文长度不超过 3000 字符、上下文合计不超过 1200 字符。不能改变 DOM 边界的单个长片段可独立请求，最多 6000 字符，附加上下文最多 300 字符。更大或未确认的上下文保持原有 7000/80/6000/4000 限制。实际配置保存在运行历史与新块的 `requestBudget`，完整性与截断校验仍执行；字符预算不是模型 tokenizer 的精确 token 计数。

脚本接口为 `translatePaper({ concurrency, requestGate })`。可选 `requestGate(fn)` 必须返回一个 Promise，并在完整读取响应正文后释放请求槽；库脚本提供共享 FIFO gate。其可选 `stop(error)` 在终止错误出现时拒绝尚未发送及后续请求，已经发送的请求仍读取并校验结果。每篇只有一个排他持有者和串行检查点写入者；数据与目录使用同一个不可变快照保存。终止错误会停止新批次，并等待在途的合格结果保存后返回。

定点纠错可调用 `translatePaper({ retranslateSourceIds, correctionInstructions })`。`correctionInstructions` 最长 3000 字符，必须同时显式指定待重译的块；仅这些块的正常请求和隔离纠错请求会收到指导。普通队列的 system prompt 与 API 参数保持原样。指导原文和旧译文保存在本地纠错历史，公开纠错元数据只记录指导 SHA-256；机器译文仍标记为未经全篇人工校对。

更换已有译文的模型默认会被拒绝。得到明确授权后，可使用 `--model <精确 API 模型 ID> --allow-model-change` 或脚本选项 `allowModelChange: true` 继续待译内容。已完成且未要求重译的论文保持原有来源记录；同一篇的旧块保留实际旧模型、配置和身份，新块记录新模型。`modelHistory` 保存各次运行，`modelsUsed` 和 `modelIdentities` 声明涉及的模型，`usageByModel` 分别统计 token，`translation.usage` 是各模型统计的合计。重试的实际 seed 另存于本地响应记录；块上的 `parameters` 是该次运行的基础配置。

精确模型 `qwen3.6-35b-a3b` 曾出现 LM Studio MLX 的结构化结果通道路由问题：最终 `content` 为空，完整 JSON 位于 `reasoning_content`。兼容处理只在实际模型精确匹配、成功结束且没有工具调用时启用，要求整个内容是唯一 `translations` 对象，包含全部且仅包含请求的 ID，每个值是非空字符串；解释文字、围栏、重复 ID 或其他字段均被拒绝。随后仍执行原有数字、型号、译文和 HTML 校验。新块的 `translation.responseChannels` 与本地响应日志记录实际通道，模型返回的推理 token 继续照实统计。这不会证明模型实际关闭了思考。[官方问题记录](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1971)

论文中已出现的字面 `<think>`、`</think>`、`<|im_start|>` 和 `<|im_end|>` 在 API 传输时使用每个片段独有的占位符，避免服务器把 JSON 字符串中的原文标签误当作模型通道边界。片段与上下文中的这些标签都经过保护；解析响应后检查占位符身份、顺序和次数，再恢复原字符并执行完整性校验。独立节点中的 `<|im_start|>user`、`<|im_start|>assistant` 和 `<|im_end|>` 是原始模板示例，保留其协议角色标签；包含这些标签的叙述仍需翻译。占位符缺失、额外出现、移到其他片段或与原文冲突时均失败。来源 HTML 和英文块保持原样，最终 HTML 不包含传输占位符；相关新块记录 `literalTransport: opaque-model-delimiters-v2`，历史 `opaque-think-delimiters-v1` 记录继续保留。

命令使用 `.env` 中明确指定的 LM Studio 模型，不自动替换模型。导入只在本地 `DATA_DIR` 中保存数据；重复导入相同来源时保留已有译文，翻译支持从已有进度继续。原始工作目录中的论文数据、原始 HTML、图片及翻译检查点均被 Git 忽略，默认前端构建也不包含这些文件。经验证的处理后 HTML、元数据和图片单独导出到 `paper-data/`，通过 Git LFS 发布。

`paper:verify --strict-translation` 只有在目录内所有论文都翻译完整时通过。需要发布数据时，另行使用 [独立存储与导出说明](data-storage.md) 的显式流程。

## DeepSeek、Kimi 与 MiniMax 扩充批次

核验日期：2026-10-11。这一批下载固定版本的 arXiv HTML，采用同样的来源、正文结构与资产指纹校验；保留原始标题，不以相近模型或后续版本替换用户指定的系列。

本批七篇均有可用的官方英文 HTML，无需从 PDF 转换。[项目协作规则](../AGENTS.md)已记录后续只有 PDF 时必须执行 **PDF → 英文 HTML → 中文 HTML**，保留完整正文结构、公式、图表、引用、来源指纹与 PDF 页码对应，不能仅保留 PDF 链接。当时尚未实现 PDF 转换；后续 GPT-2 的完整转换路径见文末“预训练论文扩充批次”。

| 用户指定系列 | 报告原题 | 固定版本 | 本地论文 ID | 正文块 / 资产 |
| --- | --- | --- | --- | --- |
| DeepSeek V3 | DeepSeek-V3 Technical Report | [2412.19437v2](https://arxiv.org/html/2412.19437v2) | `deepseek-v3-technical-report` | 396 / 15 |
| DeepSeek R1 | DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning | [2501.12948v2](https://arxiv.org/html/2501.12948v2) | `deepseek-r1-technical-report` | 446 / 20 |
| DeepSeek V4 | DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence | [2606.19348v1](https://arxiv.org/html/2606.19348v1) | `deepseek-v4-technical-report` | 447 / 16 |
| Kimi K2 | Kimi K2: Open Agentic Intelligence | [2507.20534v2](https://arxiv.org/html/2507.20534v2) | `kimi-k2-technical-report` | 415 / 19 |
| Kimi K2.5 | Kimi K2.5: Visual Agentic Intelligence | [2602.02276v2](https://arxiv.org/html/2602.02276v2) | `kimi-k2-5-technical-report` | 334 / 13 |
| Kimi K3 | Kimi K3: Open Frontier Intelligence | [2607.24653v2](https://arxiv.org/html/2607.24653v2) | `kimi-k3-technical-report` | 593 / 16 |
| MiniMax M3 关联架构论文 | MiniMax Sparse Attention | [2606.13392v2](https://arxiv.org/html/2606.13392v2) | `minimax-m3-technical-report` | 251 / 17 |

MiniMax M3 的 [官方仓库](https://github.com/MiniMax-AI/MiniMax-M3)和[模型卡](https://huggingface.co/MiniMaxAI/MiniMax-M3)将 technical report 链接到 *MiniMax Sparse Attention*。这篇报告主要介绍稀疏注意力架构与 109B 实验，不能将其原标题改成完整 M3 模型训练报告。目录使用 `MiniMax M3`、`MiniMax-M3` 和 `M3 关联架构论文` 标签，检索 M3 能找到它。完整模型的官方发布介绍另见 [MiniMax M3 发布文章](https://www.minimax.io/blog/minimax-m3)。

DeepSeek V4 的[官方模型卡](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro)链接到上述固定报告。[arXiv 摘要页](https://arxiv.org/abs/2606.19348v1)的提交历史、`citation_date` 与 HTML 页头显示 2026-04-26，与编号 `2606` 的月份不一致；本地保存实际源 HTML，不从编号推断或改写具体发布日期。

三份 Kimi HTML 明确标注 **CC BY-NC-ND 4.0**。该许可中的 ND 条款限制公开分发改编内容，见 [Creative Commons 许可原文](https://creativecommons.org/licenses/by-nc-nd/4.0/)。用户于 **2026-10-11** 在本次对话中确认已获得作者授权公开 Kimi K2 `2507.20534v2`、Kimi K2.5 `2602.02276v2`、Kimi K3 `2607.24653v2` 的中文全文。本次公开这三篇固定版本的依据为该用户确认，未独立核验书面授权文件；来源中的原始许可标注继续保留。

用户于 **2026-10-11** 进一步明确要求将剩余 DeepSeek V3／R1／V4 与 MiniMax Sparse Attention 全部上线。本轮按该指示公开这四篇固定版本的完整英文与中文 HTML，共 1540 个对齐内容块、68 个正文引用素材，并保留已有十篇全文。上述 Kimi 作者授权确认仍只记录三篇 Kimi 固定版本；本轮发布指示不作为其他报告的作者授权确认，也未独立核验额外书面授权文件。原始来源和许可记录不变。

该次已发布快照共有 14 篇中英全文、5209 个对齐内容块、191 个正文引用素材和 234 个发布文件；扩充七篇共 2882 块。所有译文仍标记 `humanReviewed: false`，保留实际主译与辅助校正模型，自动校验与定向校正不代表全篇人工审校。本地导入与公开发布继续分开处理；下文的 Gemini／Gemma 七篇与 Chinchilla 根据用户后续明确发布指示纳入 22 条目快照。

可重复的固定版本导入：

```sh
npm run paper:import -- 2412.19437v2 --id deepseek-v3-technical-report
npm run paper:import -- 2501.12948v2 --id deepseek-r1-technical-report
npm run paper:import -- 2606.19348v1 --id deepseek-v4-technical-report
npm run paper:import -- 2507.20534v2 --id kimi-k2-technical-report
npm run paper:import -- 2602.02276v2 --id kimi-k2-5-technical-report
npm run paper:import -- 2607.24653v2 --id kimi-k3-technical-report
npm run paper:import -- 2606.13392v2 --id minimax-m3-technical-report
```

本次 DeepSeek V3、Kimi K2.5 和 MiniMax Sparse Attention 全文由实际 GPT-6 Luna 子任务生成；DeepSeek R1／V4 和 Kimi K2／K3 使用本机 Qwen3.6，并对发现的具体片段采用 Luna 校正。来源记录分别保留主译模型与辅助片段，不把不同模型的贡献合并改标。Luna 使用 `reasoning_effort: low`，未提供的 API token 用量保持未知。

续跑本地模型处理的报告时，显式指定论文 ID 与已安装的精确模型：

```sh
npm run library:translate -- \
  kimi-k3-technical-report deepseek-v4-technical-report \
  deepseek-r1-technical-report kimi-k2-technical-report \
  --model qwen3.6-35b-a3b --concurrency 4 --batch-characters 3000
```

本批核验的本地实例为 `mlx-community` 的 MLX `4bit`、35B/A3B MoE，API ID 为 `qwen3.6-35b-a3b`，上下文 8192 token、服务并发 4。请求和纠错共享 4 个请求槽，实际输出预算由已确认上下文设为 4096 token；返回模型身份、参数、用量与响应通道照实记入每篇来源记录。最终可阅读正文仍导出为 HTML，公式保留原 MathML。

## Gemini 与 Gemma 核心报告

核验日期：2026-10-11。本地新增以下七篇固定版本。每篇已取得官方英文 HTML 及正文图表，来源 URL、原始 HTML SHA-256 与素材指纹保存在处理记录中。论文均标注 CC BY 4.0；Gemma 论文作者为 Gemma Team / Google DeepMind。这里记录的是论文许可，与模型权重许可分别处理。

| 系列 | 报告原题 | 固定官方 HTML | 本地论文 ID |
| --- | --- | --- | --- |
| Gemini 1.0 | Gemini: A Family of Highly Capable Multimodal Models | [2312.11805v5](https://arxiv.org/html/2312.11805v5) | `gemini-1-0-technical-report` |
| Gemini 1.5 | Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context | [2403.05530v5](https://arxiv.org/html/2403.05530v5) | `gemini-1-5-technical-report` |
| Gemini 2.5 | Gemini 2.5: Pushing the Frontier with Advanced Reasoning, Multimodality, Long Context, and Next Generation Agentic Capabilities. | [2507.06261v6](https://arxiv.org/html/2507.06261v6) | `gemini-2-5-technical-report` |
| Gemma 1 | Gemma: Open Models Based on Gemini Research and Technology | [2403.08295v4](https://arxiv.org/html/2403.08295v4) | `gemma-1-technical-report` |
| Gemma 2 | Gemma 2: Improving Open Language Models at a Practical Size | [2408.00118v3](https://arxiv.org/html/2408.00118v3) | `gemma-2-technical-report` |
| Gemma 3 | Gemma 3 Technical Report | [2503.19786v1](https://arxiv.org/html/2503.19786v1) | `gemma-3-technical-report` |
| Gemma 4 | Gemma 4 Technical Report | [2607.02770v2](https://arxiv.org/html/2607.02770v2) | `gemma-4-technical-report` |

Gemini 2.5 报告同时介绍 Gemini 2.0，因此只收录一份完整报告。用户明确选择只收录 Gemini 核心论文，Gemini 3.x 模型卡未纳入本批；Gemma 也只收录主系列四篇技术报告。Gemma 4 的身份已与 [Google 官方模型卡的技术报告引用](https://ai.google.dev/gemma/docs/core/model_card_4)交叉核对。

本批所有正文均来自官方 HTML。Gemma 顶部的作者脚注宏及 Gemma 2 表 21／22 的表头转换错误，在解析副本中定向修复；原始来源文件保持不变，修复依据记录在 `source.repairs`。表头以固定版本 [Gemma 2 PDF](https://arxiv.org/pdf/2408.00118v3)第 12／13 页为准，原数值行、图注与全部锚点保留。

这些报告最初仅加入本地阅读库；用户于 2026-10-11 明确要求先发布已完成的 22 个条目，再继续新增 20 篇预训练论文，本次据此纳入公开快照。公开授权规则见 [AGENTS.md](../AGENTS.md)。

七篇共 2600 个对齐内容块、115 个正文素材，已全部完成中英 HTML 导出。原始工作库通过来源 SHA-256、素材、公式、引用、内部链接和全文翻译严格校验；处理后本地快照共 21 篇、7809 块、306 素材和 370 文件。原有 14 篇的 233 个正文、元数据与素材文件逐文件哈希保持不变，目录仅增加本批条目。

Gemini 1.0／2.5 全文由实际 GPT-6 Luna 子任务生成，使用 `reasoning_effort: low`。Gemini 1.5 与 Gemma 1／2／3／4 先由本机 `qwen3.6-35b-a3b`（MLX 4bit，8192 上下文，四路共享 API 队列，`reasoning_effort: none`）处理，保留已验收内容，再由实际 Luna 续译。更换模型必须显式传入 `allowModelChange: true`，冻结既有 Qwen 块、原标题和完整 API 来源；后续 Luna 仅处理缺失内容。每块保留实际模型，`codexFallback` 记录这次明确续译的来源指纹与历史。

Luna 子任务不提供 API token 用量，本批不填造假的零值或借用 Qwen 参数。混合译文的 `usageScope: observed-api-models-only` 表示仅保留实际观测到的 Qwen API 统计；其原请求预算、重试和传输参数保存在 Qwen 历史中。定向检查修正了少数漏译、片段边界与图像块维度表述，仍标记 `humanReviewed: false`，不代表全篇人工审校。

## Chinchilla

核验日期：2026-10-11。用户输入的“Chillchila”按 Chinchilla 模型对应的 **Training Compute-Optimal Large Language Models** 导入，保留论文原题，别名用于检索。

| 项目 | 固定来源 |
| --- | --- |
| 论文与版本 | [arXiv:2203.15556v1](https://arxiv.org/abs/2203.15556v1)，2022-03-29，Jordan Hoffmann 等 22 位作者 |
| 英文正文 | [官方 HTML](https://arxiv.org/html/2203.15556v1)，含参考文献及附录 A–J |
| 官方关联说明 | [Google DeepMind 的 Chinchilla 研究文章](https://deepmind.google/blog/an-empirical-analysis-of-compute-optimal-large-language-model-training/) |
| 本地 ID | `chinchilla-training-compute-optimal` |
| 标签 | Chinchilla、预训练、缩放定律；支持 Chillchila、DeepMind、Google／谷歌检索 |

原始来源标注 **arXiv.org perpetual non-exclusive license**，按源页面如实记录，不沿用 Gemini／Gemma 的 CC BY 4.0 标记。最初用于本地阅读，后根据用户 2026-10-11 的明确发布指示纳入本次公开快照。

原始英文 HTML 的 SHA-256 为 `69d724082e37672a65d292c60c84962aab430aba6cb3618b35477fe9829dd3cf`。导入包含 244 个内容块、52 个目录项、19 张表、11 个独立公式块、212 个 MathML 公式及 14 个图表素材。SVG 保留原始下载副本与指纹，供阅读的副本经过既有清洗流程；公式、代码与英文原文的科学数据保持固定版本来源。

244 个内容块已全部生成对齐的中文 HTML。正文和标题由实际 GPT-6 Luna 子任务生成，记录 `provider: Codex subagent`、`reasoning_effort: low`、实际完成时间和来源／译文指纹；原样保留的公式、作者和参考文献块不虚构翻译模型。没有可核验的 Luna API 用量，记录中不填造 token 数或费用。关键结果、公式变量及表格单元格经过有限语义抽查，24 个内容块保留定向修订的模型、时间和前一版译文指纹；额外检查所有片段中的 Chinchilla／Gopher／SentencePiece 专名是否保留。机器译文仍标记 `humanReviewed: false`，未作全文人工审校。

原始工作库与最终中英 HTML 均通过严格数据校验，构建后库共 22 个全文条目、8053 块、320 素材和 387 文件。添加前 21 个条目的 369 个正文、元数据和素材文件逐文件哈希不变。实际阅读器已检查桌面／手机显示、公式单份渲染、目录跳转、中英双向同步滚动、交换／单栏和标签检索；页面无加载错误，手机页面宽度未超出视口。此完整快照纳入用户明确授权的本次发布，新增 20 篇预训练论文仍在本地工作目录中处理。

## 预训练论文扩充批次

来源核验日期：2026-10-11。本批增加二十篇完整论文，十九篇来自实际请求并验证版本水印的官方 arXiv HTML；GPT-2 使用 OpenAI 官方 PDF。年份采用首发年份；固定版本可能是后续修订，不能据版本修订日期改写论文首发年。

| 论文原题 | 首发年份 | 固定英文来源 | 本地论文 ID |
| --- | --- | --- | --- |
| The Llama 3 Herd of Models | 2024 | [2407.21783v3](https://arxiv.org/html/2407.21783v3) | `llama-3-technical-report` |
| 2 OLMo 2 Furious | 2024 | [2501.00656v3](https://arxiv.org/html/2501.00656v3) | `olmo-2-technical-report` |
| The FineWeb Datasets: Decanting the Web for the Finest Text Data at Scale | 2024 | [2406.17557v2](https://arxiv.org/html/2406.17557v2) | `fineweb-datasets` |
| DataComp-LM: In search of the next generation of training sets for language models | 2024 | [2406.11794v4](https://arxiv.org/html/2406.11794v4) | `datacomp-lm` |
| DoReMi: Optimizing Data Mixtures Speeds Up Language Model Pretraining | 2023 | [2305.10429v4](https://arxiv.org/html/2305.10429v4) | `doremi-data-mixtures` |
| Scaling Laws for Neural Language Models | 2020 | [2001.08361v1](https://arxiv.org/html/2001.08361v1) | `scaling-laws-neural-language-models` |
| DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models | 2024 | [2401.06066v1](https://arxiv.org/html/2401.06066v1) | `deepseek-moe` |
| Tensor Programs V: Tuning Large Neural Networks via Zero-Shot Hyperparameter Transfer | 2022 | [2203.03466v2](https://arxiv.org/html/2203.03466v2) | `tensor-programs-v-mup` |
| Olmo 3 | 2025 | [2512.13961v2](https://arxiv.org/html/2512.13961v2) | `olmo-3-technical-report` |
| LLaMA: Open and Efficient Foundation Language Models | 2023 | [2302.13971v1](https://arxiv.org/html/2302.13971v1) | `llama-1-technical-report` |
| Llama 2: Open Foundation and Fine-Tuned Chat Models | 2023 | [2307.09288v2](https://arxiv.org/html/2307.09288v2) | `llama-2-technical-report` |
| DeepSeek LLM Scaling Open-Source Language Models with Longtermism | 2024 | [2401.02954v1](https://arxiv.org/html/2401.02954v1) | `deepseek-llm` |
| Language Models are Unsupervised Multitask Learners | 2019 | [官方 PDF](https://cdn.openai.com/better-language-models/language-models.pdf) | `gpt-2-technical-report` |
| Language Models are Few-Shot Learners | 2020 | [2005.14165v4](https://arxiv.org/html/2005.14165v4) | `gpt-3-technical-report` |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding | 2018 | [1810.04805v2](https://arxiv.org/html/1810.04805v2) | `bert-pretraining` |
| Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer | 2019 | [1910.10683v4](https://arxiv.org/html/1910.10683v4) | `t5-text-to-text-transformer` |
| The RefinedWeb Dataset for Falcon LLM: Outperforming Curated Corpora with Web Data, and Web Data Only | 2023 | [2306.01116v1](https://arxiv.org/html/2306.01116v1) | `refinedweb-dataset` |
| Dolma: an Open Corpus of Three Trillion Tokens for Language Model Pretraining Research | 2024 | [2402.00159v2](https://arxiv.org/html/2402.00159v2) | `dolma-pretraining-corpus` |
| Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity | 2021 | [2101.03961v3](https://arxiv.org/html/2101.03961v3) | `switch-transformers` |
| Learning Transferable Visual Models From Natural Language Supervision | 2021 | [2103.00020v1](https://arxiv.org/html/2103.00020v1) | `clip-pretraining` |

GPT-3 官方 HTML 中缺失的十二张 PNG，按相同固定版本原始 TeX 归档的准确成员路径恢复，记录归档 URL、SHA-256、成员名与原图指纹；不能以其他论文或近似图片替代。SVG 保留原始文件，并分别验证原图和净化后发布图的指纹。

GPT-2 原始 PDF 为 24 页、582775 字节。转换器采用 pdfplumber 0.11.9 与 pypdf 6.10.0，生成 209 个语义块、17 个 HTML 表格、5 张局部图像和 27 个目录节，保留 156 个内部目标锚点以及 78 个参考文献。英文来源 HTML、原始 PDF、转换参数及页码/字符覆盖映射分别保留指纹。公式使用 MathML，英文与中文正文沿用相同块 ID；数据样例、公式和代码保留原文。PDF 字符覆盖验证和定向视觉核查不代表人工逐句审校。

十九篇 arXiv 报告的官方引文作者名单另存于 `paper-metadata/bibliography.json`，包含准确固定版本、来源 URL 与核验时间。前端仅在论文 ID 和 arXiv 版本同时匹配时使用该名单显示及检索作者，避免 HTML 提取中出现 `arXiv`、邮箱或不完整姓氏。该独立阅读元数据不改写原始 HTML、来源指纹及冻结的翻译清单。

GPT-2 的式 (1) 沿用原 PDF 的 `s_n` 项和乘积索引 `i`，包括原论文中记号不一致之处，未作为转换错误擅自改写。完整布局配方保存在 `paper-metadata/pdf-recipes/gpt-2-technical-report.json`。转换要求每个非页眉来源字符恰好覆盖一次；未覆盖、重复覆盖、缺页、错误素材指纹或失效内部引用都会阻止导入。


本批二十篇现在已全部生成中文正文，共 8632 个对齐块。十九篇 arXiv 的固定版本、首发年份、本地来源 HTML 指纹和版本水印与官方预检一致；GPT-2 的 PDF、转换英文 HTML 与布局配方均有指纹。十八份真实 Luna 冻结任务清单对应 233 份分块草稿，逐份核对八键格式、精确 job ID、模型身份、低思考参数与完成时间；Luna 未提供的 API 用量继续保持未知。

OLMo 2／3 的原 HTML 作者提取为空，冻结的原作者数组保持不变。发布元数据另外保存 `publicationBibliography`，逐字段对应已核验的固定版本官方引用记录；独立 HTML 头部显示这份完整署名。未知版本、错误来源、空或伪造名单仍会被发布校验拒绝。μP 和 Dolma 的未引用图像只保留原始素材元数据 `publicationSourceAssets` 以复现冻结的翻译来源，不发布这些未引用文件；发布素材仍由正文引用闭包决定。
