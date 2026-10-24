# Artificial Analysis 基准论文收录记录

完成日期：2026-10-24（Asia/Shanghai）。用户批准的 22 篇已完成本地中英文全文收录，原有 120 个全文条目的文件保持不变；本地库现有 142 个条目。以上为本地收录时的验收快照；本次发布范围见下段。

## 本次发布范围

2026-10-24 按用户“发布”指令，将本批 22 篇完整双语论文、分类与系列菜单整理、Benchmark 选型地图 v2 及 120 个自拟教学示例发布到既有 GitHub／Vercel 项目。正式库由原有 113 篇增至 135 篇，研究由 2 篇增至 3 篇；其他本地论文和研究不在此发布范围。原有论文与两篇研究的非目录文件逐字节保留。下文 142 条、66 组等数字记录此前完整本地库的验证，不能作为此次正式库的条目数。

## 正文与来源

本批次包含 5254 个对齐内容块、360 个正文素材。每篇都有可独立阅读的 `en.html` 与 `zh.html`，轻量 JSON 仅保存元数据、来源、目录、定位和处理记录。阅读器搜索 `Artificial Analysis` 可找到本批次。

22 篇均使用已批准的固定 arXiv 版本和官方英文 HTML。另从对应固定版本的 PDF、TeX 核对并恢复 CritPt 第 20 页的空白代码模板，以及 Global MMLU 第 1 页的作者与机构信息。独立脚注、转换成 span 的表格/列表、提示框标题与图像均已核对；原始来源、PDF、TeX、SVG 和模型响应保留在被 Git 忽略的 `.cache/aa-benchmarks-intake/`。

中英文的块 ID、锚点、顺序、公式、代码、数值、引用与图像保持对应。作者姓名、文献出版信息、字面代码、纯数据选项和图中嵌入文字按来源保留。独立 HTML 的长来源链接在窄屏下可换行，恢复的透明图像保留白色画布以确保深色背景下可读。来源结构修复前后的块指纹有连续记录，可以追溯重组后的表格、列表和脚注。

## 翻译与失败恢复

主译及辅助修正均实际调用本地 `qwen3.6-35b-a3b`（mlx-community，MLX 4bit，35B/A3B），未下载或替换模型。使用不超过 8 个同时请求；实际模型身份、上下文、温度、top_p、max_tokens、seed、请求提示词哈希和响应通道分别记录。请求使用 reasoning_effort=none，保留服务实际返回的 usage，不把请求设置当作运行时行为保证。

失败片段经过单独复查与重试，已通过的实际模型响应按原文逐块复用。处理了数值/日期/单位、模型与基准标识符、跨公式年份与章节链接、文献姓名、长主题清单及文档 grounding 术语问题。复用的每个片段都绑定真实响应文件哈希、原文哈希、模型身份和参数。最终 27545 个机器译文片段的实际响应来源核验通过，未完成译文和未解决的校验失败均为 0。

所有译文仍为机器翻译，`humanReviewed: false`，没有标作人工审校。

## 22 篇与固定版本

表中的中文题名来自实际模型输出；品牌名称可保留原文。AA 的评测协议版本、数据集版本和 arXiv 修订号分别记录，不能把 Terminal-Bench 原论文称作 4.0 论文，也不能把上游 Global MMLU/MATH 论文称作另一篇 Lite/MATH-500 论文。

| 论文 | 中文题名 | 固定版本 | 本地全文 |
| --- | --- | --- | --- |
| GDPval: Evaluating AI Model Performance on Real-World Economically Valuable Tasks | GDPval：评估AI模型在真实世界高经济价值任务上的表现 | [2510.04374v1](https://arxiv.org/abs/2510.04374v1) | [EN](../paper-data/papers/gdpval/en.html) · [中文](../paper-data/papers/gdpval/zh.html) |
| AutomationBench | AutomationBench | [2604.18934v1](https://arxiv.org/abs/2604.18934v1) | [EN](../paper-data/papers/automationbench/en.html) · [中文](../paper-data/papers/automationbench/zh.html) |
| Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces | Terminal-Bench：在命令行界面的困难、现实任务中评估智能体 | [2601.11868v1](https://arxiv.org/abs/2601.11868v1) | [EN](../paper-data/papers/terminal-bench/en.html) · [中文](../paper-data/papers/terminal-bench/zh.html) |
| SciCode: A Research Coding Benchmark Curated by Scientists | SciCode：由科学家策划的研究编码基准 | [2407.13168v1](https://arxiv.org/abs/2407.13168v1) | [EN](../paper-data/papers/scicode/en.html) · [中文](../paper-data/papers/scicode/zh.html) |
| AA-Omniscience: Evaluating Cross-Domain Knowledge Reliability in Large Language Models | AA-Omniscience：评估大语言模型跨领域知识可靠性 | [2511.13029v1](https://arxiv.org/abs/2511.13029v1) | [EN](../paper-data/papers/aa-omniscience/en.html) · [中文](../paper-data/papers/aa-omniscience/zh.html) |
| GDP.pdf: Benchmarking Grounded Multimodal Reasoning over Professional PDF Documents | GDP.pdf：基于专业 PDF 文档的推理与文档证据对应多模态基准测试 | [2607.11192v3](https://arxiv.org/abs/2607.11192v3) | [EN](../paper-data/papers/gdp-pdf/en.html) · [中文](../paper-data/papers/gdp-pdf/zh.html) |
| Humanity's Last Exam | Humanity's Last Exam | [2501.14249v2](https://arxiv.org/abs/2501.14249v2) | [EN](../paper-data/papers/humanitys-last-exam/en.html) · [中文](../paper-data/papers/humanitys-last-exam/zh.html) |
| Probing the Critical Point (CritPt) of AI Reasoning: a Frontier Physics Research Benchmark | 探究人工智能推理的临界点（CritPt）：一项前沿物理学研究基准 | [2509.26574v4](https://arxiv.org/abs/2509.26574v4) | [EN](../paper-data/papers/critpt/en.html) · [中文](../paper-data/papers/critpt/zh.html) |
| APEX-Agents | APEX-Agents | [2601.14242v3](https://arxiv.org/abs/2601.14242v3) | [EN](../paper-data/papers/apex-agents/en.html) · [中文](../paper-data/papers/apex-agents/zh.html) |
| EnterpriseOps-Gym: Environments and Evaluations for Stateful Agentic Planning and Tool Use in Enterprise Settings | EnterpriseOps-Gym：面向企业环境中状态感知智能体规划与工具使用的环境及评估 | [2603.13594v1](https://arxiv.org/abs/2603.13594v1) | [EN](../paper-data/papers/enterpriseops-gym/en.html) · [中文](../paper-data/papers/enterpriseops-gym/zh.html) |
| ITBench: Evaluating AI Agents across Diverse Real-World IT Automation Tasks | ITBench：跨多样化现实世界 IT 自动化任务评估 AI 智能体 | [2502.05352v1](https://arxiv.org/abs/2502.05352v1) | [EN](../paper-data/papers/itbench/en.html) · [中文](../paper-data/papers/itbench/zh.html) |
| Generalizing Verifiable Instruction Following | 泛化可验证指令遵循 | [2507.02833v3](https://arxiv.org/abs/2507.02833v3) | [EN](../paper-data/papers/ifbench/en.html) · [中文](../paper-data/papers/ifbench/zh.html) |
| HealthBench: Evaluating Large Language Models Towards Improved Human Health | HealthBench：评估大型语言模型以改善人类健康 | [2505.08775v1](https://arxiv.org/abs/2505.08775v1) | [EN](../paper-data/papers/healthbench/en.html) · [中文](../paper-data/papers/healthbench/zh.html) |
| HealthBench Professional: Evaluating Large Language Models on Real Clinician Chats | HealthBench Professional：评估大型语言模型在真实医生对话中的表现 | [2604.27470v1](https://arxiv.org/abs/2604.27470v1) | [EN](../paper-data/papers/healthbench-professional/en.html) · [中文](../paper-data/papers/healthbench-professional/zh.html) |
| MMMU-Pro: A More Robust Multi-discipline Multimodal Understanding Benchmark | MMMU-Pro：一个更鲁棒的多学科多模态理解基准 | [2409.02813v3](https://arxiv.org/abs/2409.02813v3) | [EN](../paper-data/papers/mmmu-pro/en.html) · [中文](../paper-data/papers/mmmu-pro/zh.html) |
| Global MMLU: Understanding and Addressing Cultural and Linguistic Biases in Multilingual Evaluation | Global MMLU：理解与应对多语言评估中的文化与语言偏见 | [2412.03304v2](https://arxiv.org/abs/2412.03304v2) | [EN](../paper-data/papers/global-mmlu/en.html) · [中文](../paper-data/papers/global-mmlu/zh.html) |
| GPQA: A Graduate-Level Google-Proof Q&A Benchmark | GPQA：研究生级别的防 Google 问答基准 | [2311.12022v1](https://arxiv.org/abs/2311.12022v1) | [EN](../paper-data/papers/gpqa/en.html) · [中文](../paper-data/papers/gpqa/zh.html) |
| τ-Knowledge: Evaluating Conversational Agents over Unstructured Knowledge | τ-Knowledge：评估非结构化知识上的对话代理 | [2603.04370v1](https://arxiv.org/abs/2603.04370v1) | [EN](../paper-data/papers/tau-knowledge/en.html) · [中文](../paper-data/papers/tau-knowledge/zh.html) |
| τ²-Bench: Evaluating Conversational Agents in a Dual-Control Environment | τ²-Bench：在双控制环境中评估对话代理 | [2506.07982v1](https://arxiv.org/abs/2506.07982v1) | [EN](../paper-data/papers/tau2-bench/en.html) · [中文](../paper-data/papers/tau2-bench/zh.html) |
| MMLU-Pro: A More Robust and Challenging Multi-Task Language Understanding Benchmark | MMLU-Pro：一个更稳健且具有挑战性的多任务语言理解基准 | [2406.01574v6](https://arxiv.org/abs/2406.01574v6) | [EN](../paper-data/papers/mmlu-pro/en.html) · [中文](../paper-data/papers/mmlu-pro/zh.html) |
| LiveCodeBench: Holistic and Contamination Free Evaluation of Large Language Models for Code | LiveCodeBench：针对代码的大语言模型全面且无污染的评估 | [2403.07974v2](https://arxiv.org/abs/2403.07974v2) | [EN](../paper-data/papers/livecodebench/en.html) · [中文](../paper-data/papers/livecodebench/zh.html) |
| Measuring Mathematical Problem Solving With the MATH Dataset | 使用 MATH 数据集衡量数学问题解决能力 | [2103.03874v2](https://arxiv.org/abs/2103.03874v2) | [EN](../paper-data/papers/math-dataset/en.html) · [中文](../paper-data/papers/math-dataset/zh.html) |

完整作者、AA 关联关系和官方链接见 [收录清单](../paper-metadata/collections/artificial-analysis-benchmarks-22.json)；调研范围与未确认正式论文的项目见 [来源调研](artificial-analysis-benchmark-candidates-2026-10-24.md)。

## 验证记录

- 官方来源和正文结构对照、原始 HTML 与素材指纹、严格正文校验、逐片段完整性、实际模型响应与连续来源指纹核验通过。
- 新增 22 篇和完整 142 条本地库的处理数据严格校验通过；合并前的 6346 个非目录文件保持 SHA-256 一致，包括原有论文和研究资料。
- 项目类型检查、15 个前端测试文件的 160 项测试及 271 项脚本测试通过，带完整数据的本地构建通过；22 篇阅读器桌面双语与手机中文共 66 组正文检查、检索、引用、目录、双向同步滚动与交换双栏检查通过。SciCode、Global MMLU 的独立中英文 HTML 在桌面/手机及深色系统主题下的 8 组抽查通过。这里只记录本地验证，不代表线上发布。

工作证据：`local-data-merge-verification.json`、`model-receipt-audit.json`、`complete-source-audit.json`、`final-translation-unit-audit.json` 与 `completion.json` 均位于 `.cache/aa-benchmarks-intake/`。
