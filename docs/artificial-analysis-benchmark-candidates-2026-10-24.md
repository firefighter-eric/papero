# Artificial Analysis benchmark 论文来源与收录清单

核查日期：2026-10-24（Asia/Shanghai）。用户已同意将本清单的 22 篇全部收录；22 篇完整中英文正文与本地校验已完成，详见[收录记录](artificial-analysis-benchmark-intake-2026-10-24.md)。

## 范围、现状与来源

- 范围是 Artificial Analysis 的[模型 Evaluations 目录](https://artificialanalysis.ai/evaluations)，涵盖综合指数、独立展示和历史评测；不包含图像/视频竞技场或另一个 Coding Agents 产品下所有评测。
- 调研时对照工作区 `paper-data/catalog.json` 的 120 篇记录，以下 22 篇均未收录；已按去除版本号后的 arXiv ID 去重，并检查现有题名。
- 下列固定版本的官方英文 HTML 均在来源核查中返回 HTTP 200。完整作者与固定版本登记在 [22 篇收录清单](../paper-metadata/collections/artificial-analysis-benchmarks-22.json)，正文、公式、图表、参考文献、素材和翻译另行校验。
- 表中的中文题名是调研工作译名；阅读器采用实际翻译模型生成并通过校验的题名。
- 原始映射以 AA 的[Intelligence Benchmarking Methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking)各同名小节为主；作者、英文题名、论文版本以官方 arXiv 记录为准。表中作者使用首位作者加“等”，完整作者见官方页面。

## 第一批建议：与当前综合指数相关的 8 篇

AA 当前方法页列出 Intelligence Index v4.3.2。以下 8 篇能补足该指数多数评测的论文背景；AA-Briefcase 与 AA-LCR 暂未核到可单独列入此表的正式论文。Terminal-Bench 原论文与当前 4.0 不是同一个版本，详见表中说明。

| AA 评测及对应关系 | 英文论文题名 | 中文工作题名 | 作者 | 建议固定版本 / 官方来源 | 补充的证据 |
| --- | --- | --- | --- | --- | --- |
| GDPval-AA v2.1 的上游数据集论文；AA 的执行和 Elo 方法另行记录 | GDPval: Evaluating AI Model Performance on Real-World Economically Valuable Tasks | GDPval：评估 AI 模型完成现实世界高经济价值任务的表现 | Tejal Patwardhan 等 | [2510.04374v1](https://arxiv.org/abs/2510.04374v1) · [英文 HTML](https://arxiv.org/html/2510.04374v1) | 以职业工作任务和实际交付物衡量模型能力。 |
| AutomationBench-AA 的上游论文 | AutomationBench | AutomationBench：自动化任务评测基准 | Daniel Shepard、Robin Salimans | [2604.18934v1](https://arxiv.org/abs/2604.18934v1) · [英文 HTML](https://arxiv.org/html/2604.18934v1) | SaaS 工具调用、工作流完成与约束遵守。 |
| Terminal-Bench 系列的原始论文；AA 的 Hard、2.1 和当前 4.0 应作为不同评测版本保留 | Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces | Terminal-Bench：在命令行环境中用困难且真实的任务评测智能体 | Mike A. Merrill 等 | [2601.11868v1](https://arxiv.org/abs/2601.11868v1) · [英文 HTML](https://arxiv.org/html/2601.11868v1) | 真实终端任务、执行环境和可运行验证器；不能将本文标作“4.0 论文”。 |
| SciCode | SciCode: A Research Coding Benchmark Curated by Scientists | SciCode：由科学家构建的科研编程评测基准 | Minyang Tian 等 | [2407.13168v1](https://arxiv.org/abs/2407.13168v1) · [英文 HTML](https://arxiv.org/html/2407.13168v1) | 将领域科学知识与可执行科研代码结合的评测。 |
| AA-Omniscience | AA-Omniscience: Evaluating Cross-Domain Knowledge Reliability in Large Language Models | AA-Omniscience：评估大语言模型跨领域知识的可靠性 | Declan Jackson 等 | [2511.13029v1](https://arxiv.org/abs/2511.13029v1) · [英文 HTML](https://arxiv.org/html/2511.13029v1) | 区分知识正确性、幻觉和拒答行为。 |
| GDP.pdf | GDP.pdf: Benchmarking Grounded Multimodal Reasoning over Professional PDF Documents | GDP.pdf：专业 PDF 文档的有据多模态推理评测 | Suhaas Garre 等 | [2607.11192v3](https://arxiv.org/abs/2607.11192v3) · [英文 HTML](https://arxiv.org/html/2607.11192v3) | 对真实专业长文档进行跨页、图表与文本推理。 |
| Humanity's Last Exam；本次按 AA 显式引用的 v2 提议，而不是自动改成最新修订 | Humanity's Last Exam | 人类最后的考试 | Long Phan 等 | [2501.14249v2](https://arxiv.org/abs/2501.14249v2) · [英文 HTML](https://arxiv.org/html/2501.14249v2) | 跨学科专家级学术问题与高难度能力边界。 |
| CritPt / CritPt v2 的论文背景；评测集及执行协议的版本仍须分别记录 | Probing the Critical Point (CritPt) of AI Reasoning: a Frontier Physics Research Benchmark | 探索 AI 推理的临界点：前沿物理研究评测基准 CritPt | Minhui Zhu 等 | [2509.26574v4](https://arxiv.org/abs/2509.26574v4) · [英文 HTML](https://arxiv.org/html/2509.26574v4) | 研究级物理推理、数值计算和复杂科学问题求解。 |

## 第二批建议：独立展示及领域补充的 8 篇

| AA 评测及对应关系 | 英文论文题名 | 中文工作题名 | 作者 | 建议固定版本 / 官方来源 | 补充的证据 |
| --- | --- | --- | --- | --- | --- |
| APEX-Agents-AA 的上游论文 | APEX-Agents | APEX-Agents：专业服务智能体评测 | Bertie Vidgen 等 | [2601.14242v3](https://arxiv.org/abs/2601.14242v3) · [英文 HTML](https://arxiv.org/html/2601.14242v3) | 跨应用、长流程的专业服务任务。 |
| EnterpriseOps-Gym-AA 的上游论文 | EnterpriseOps-Gym: Environments and Evaluations for Stateful Agentic Planning and Tool Use in Enterprise Settings | EnterpriseOps-Gym：企业场景中有状态智能体规划与工具使用的环境和评测 | Shiva Krishna Reddy Malay 等 | [2603.13594v1](https://arxiv.org/abs/2603.13594v1) · [英文 HTML](https://arxiv.org/html/2603.13594v1) | 企业工作流中状态变化、规划和工具操作的联合评测。 |
| ITBench-AA 的上游论文；AA 具体任务子集需与原论文区分 | ITBench: Evaluating AI Agents across Diverse Real-World IT Automation Tasks | ITBench：多种真实 IT 自动化任务上的 AI 智能体评测 | Saurabh Jha 等 | [2502.05352v1](https://arxiv.org/abs/2502.05352v1) · [英文 HTML](https://arxiv.org/html/2502.05352v1) | 运维、故障分析和企业 IT 自动化。 |
| IFBench；论文题名与 benchmark 名称不同 | Generalizing Verifiable Instruction Following | 可验证指令遵循能力的泛化 | Valentina Pyatkin 等 | [2507.02833v3](https://arxiv.org/abs/2507.02833v3) · [英文 HTML](https://arxiv.org/html/2507.02833v3) | 对新约束的指令遵循泛化及程序化判分。 |
| HealthBench | HealthBench: Evaluating Large Language Models Towards Improved Human Health | HealthBench：面向改善人类健康的大语言模型评测 | Rahul K. Arora 等 | [2505.08775v1](https://arxiv.org/abs/2505.08775v1) · [英文 HTML](https://arxiv.org/html/2505.08775v1) | 由医疗专家制定细粒度标准的健康对话评测。 |
| HealthBench Professional；与 HealthBench 是两篇论文 | HealthBench Professional: Evaluating Large Language Models on Real Clinician Chats | HealthBench Professional：真实临床医生对话上的大语言模型评测 | Rebecca Soskin Hicks 等 | [2604.27470v1](https://arxiv.org/abs/2604.27470v1) · [英文 HTML](https://arxiv.org/html/2604.27470v1) | 临床专业咨询、写作和研究工作。 |
| MMMU-Pro | MMMU-Pro: A More Robust Multi-discipline Multimodal Understanding Benchmark | MMMU-Pro：更稳健的多学科多模态理解评测基准 | Xiang Yue 等 | [2409.02813v3](https://arxiv.org/abs/2409.02813v3) · [英文 HTML](https://arxiv.org/html/2409.02813v3) | 减少文本捷径和猜测，更严格评估视觉与文本理解。 |
| Global-MMLU-Lite 的上游 Global MMLU 论文；Lite 不是另一篇独立论文 | Global MMLU: Understanding and Addressing Cultural and Linguistic Biases in Multilingual Evaluation | Global MMLU：理解与缓解多语言评测中的文化及语言偏差 | Shivalika Singh 等 | [2412.03304v2](https://arxiv.org/abs/2412.03304v2) · [英文 HTML](https://arxiv.org/html/2412.03304v2) | 多语言知识评测、翻译质量和文化偏差。 |

Global-MMLU-Lite 与该论文的关联也由[官方数据集卡](https://huggingface.co/datasets/CohereLabs/Global-MMLU-Lite)的 arXiv 字段确认。AA 的方法页和目录卡片对部分项目的现行/历史标签可能不同，本表不将这些论文一概称为当前综合指数成分。

## 第三批建议：历史评测及基础数据集的 6 篇

| AA 评测及对应关系 | 英文论文题名 | 中文工作题名 | 作者 | 建议固定版本 / 官方来源 | 补充的证据 |
| --- | --- | --- | --- | --- | --- |
| GPQA Diamond 是 GPQA 的子集 | GPQA: A Graduate-Level Google-Proof Q&A Benchmark | GPQA：研究生级、难以靠搜索直接解答的问答评测基准 | David Rein 等 | [2311.12022v1](https://arxiv.org/abs/2311.12022v1) · [英文 HTML](https://arxiv.org/html/2311.12022v1) | 高难度科学知识、领域专家与非专家表现的差异。 |
| τ³-Banking 对应 τ-Knowledge 框架的银行任务 | τ-Knowledge: Evaluating Conversational Agents over Unstructured Knowledge | τ-Knowledge：基于非结构化知识的对话智能体评测 | Quan Shi 等 | [2603.04370v1](https://arxiv.org/abs/2603.04370v1) · [英文 HTML](https://arxiv.org/html/2603.04370v1) | 知识库检索与多步业务工具调用。 |
| τ²-Bench Telecom | τ²-Bench: Evaluating Conversational Agents in a Dual-Control Environment | τ²-Bench：双控制环境中的对话智能体评测 | Victor Barres 等 | [2506.07982v1](https://arxiv.org/abs/2506.07982v1) · [英文 HTML](https://arxiv.org/html/2506.07982v1) | 用户与智能体共同改变环境时的协作和工具使用。 |
| MMLU-Pro | MMLU-Pro: A More Robust and Challenging Multi-Task Language Understanding Benchmark | MMLU-Pro：更稳健、更具挑战性的多任务语言理解评测基准 | Yubo Wang 等 | [2406.01574v6](https://arxiv.org/abs/2406.01574v6) · [英文 HTML](https://arxiv.org/html/2406.01574v6) | 多学科知识和推理，对既有 MMLU 评测方式的改进。 |
| LiveCodeBench | LiveCodeBench: Holistic and Contamination Free Evaluation of Large Language Models for Code | LiveCodeBench：全面且注重避免数据污染的大语言模型代码评测 | Naman Jain 等 | [2403.07974v2](https://arxiv.org/abs/2403.07974v2) · [英文 HTML](https://arxiv.org/html/2403.07974v2) | 动态更新代码题、污染控制及多种代码任务。 |
| MATH-500 的基础 MATH 数据集论文；不是题为 MATH-500 的独立论文 | Measuring Mathematical Problem Solving With the MATH Dataset | 使用 MATH 数据集衡量数学问题求解能力 | Dan Hendrycks 等 | [2103.03874v2](https://arxiv.org/abs/2103.03874v2) · [英文 HTML](https://arxiv.org/html/2103.03874v2) | 竞赛数学问题、详细解答和数学推理评测的基础。 |

## 暂不计入 22 篇论文的项目

“未核到”表示本轮通过 AA 官方关联来源没有确认到可单独列出的正式论文，不代表断言永远不存在相关论文。官方文章可另行作为双语官方资料提出，但不能改称论文。

| 项目 | 本轮核到的来源与处理建议 |
| --- | --- |
| AA-Briefcase、AA-LCR、AA-AnalystAgent、AA-3D、AA-PersonalityBench | AA 的评测页、方法说明及部分公开数据；本轮不计作独立正式论文。参见[评测目录](https://artificialanalysis.ai/evaluations)。 |
| Harvey LAB-AA | [Harvey 官方介绍文章](https://www.harvey.ai/blog/introducing-harveys-legal-agent-benchmark)及[AA 评测页](https://artificialanalysis.ai/evaluations/harvey-lab-aa)；本轮未确认独立论文。 |
| FrontierCode 1.1 | [Cognition 官方版本文章](https://cognition.com/blog/frontier-code-1.1)及[AA 评测页](https://artificialanalysis.ai/evaluations/frontiercode)；本轮未确认独立论文。 |
| MLCR-AA | [Wisedocs 官方技术文章](https://www.wisedocs.ai/blogs/medical-long-context-reasoning)及[AA 评测页](https://artificialanalysis.ai/evaluations/mlcr-aa)；本轮未确认独立论文。 |
| Terminal-Bench-Science 0.1 | [AA 页面](https://artificialanalysis.ai/evaluations/terminal-bench-science)指向项目、仓库及 Zenodo DOI 引用；本轮不把软件/数据集引用当作已确认的论文。 |
| AIME 2025 | 数学竞赛试题集，不是研究论文；无需虚构一篇同名论文。 |

## 选择后执行的导入边界

- 用户选定后，再导入所选固定版本的完整英文正文并翻译中文正文；同名 benchmark 的数据集版本、AA 评测协议版本与 arXiv 论文修订号分别保留。
- 本次 22 篇均存在可访问的官方英文 HTML，优先使用该来源；如果后续检查发现特定固定版本正文或素材不可用，按项目规则继续使用 PDF → 英文 HTML → 中文 HTML 流程。
- 翻译时先核对并实际使用指定的本地 Qwen3.6-35B-A3B；仅在没有该模型时按项目规则使用 GPT-6 Luna。记录实际模型、参数及贡献，保留机器翻译和 `humanReviewed: false` 标记。
- 用户已授权完整收录，已完成本地正文导入、翻译和校验。本次没有 GitHub/Vercel 发布授权。
