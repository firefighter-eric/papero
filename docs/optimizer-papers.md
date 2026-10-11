# 优化器论文与作者文章

本轮按用户选定的 12 个条目导入。固定版本只使用对应的官方全文；Adam v9 的官方 HTML 是转换失败页，因此保存原始 PDF，转换为完整英文 HTML，再翻译中文 HTML。最终正文继续采用独立 `en.html` / `zh.html`，不以 JSON 存储阅读正文。

| 条目 | 固定来源 | 分类依据 |
| --- | --- | --- |
| AdamW · Decoupled Weight Decay Regularization | [1711.05101v3](https://arxiv.org/abs/1711.05101v3) | 解耦权重衰减与自适应更新；AdamW、优化器、训练优化。 |
| Muon is Scalable for LLM Training | [2502.16982v1](https://arxiv.org/abs/2502.16982v1) | Muon 扩展、Moonlight 语言模型预训练与分布式实现；Muon、预训练、矩阵优化、分布式训练。 |
| Muon: An optimizer for hidden layers in neural networks | [Keller Jordan 作者原文](https://kellerjordan.github.io/posts/muon/) | 原始算法设计、Newton–Schulz 正交化、代码与经验；Muon、矩阵优化。发布日按页面记录为 2024-12-08，当前快照保留文中注明的 2025 年补充内容。 |
| Adam: A Method for Stochastic Optimization | [1412.6980v9](https://arxiv.org/abs/1412.6980v9) | 一阶、二阶矩估计与随机优化算法；Adam、优化器、训练优化。 |
| Shampoo: Preconditioned Stochastic Tensor Optimization | [1802.09568v2](https://arxiv.org/abs/1802.09568v2) | 张量预条件与矩阵统计量；Shampoo、矩阵优化。 |
| SOAP: Improving and Stabilizing Shampoo using Adam | [2409.11321v2](https://arxiv.org/abs/2409.11321v2) | 预条件器基底中的 Adam 更新及语言模型训练实验；SOAP、预训练、矩阵优化。 |
| Old Optimizer, New Norm: An Anthology | [2409.20325v2](https://arxiv.org/abs/2409.20325v2) | 优化更新与范数的理论关联；优化器、训练优化、矩阵优化。不是被引用算法的专属系列报告。 |
| SOAP, Muon, and Beyond: Pushing LLM Pretraining Scales | [2607.20548v1](https://arxiv.org/abs/2607.20548v1) | 比较 SOAP 与 Muon 的大规模语言模型预训练；SOAP、Muon、预训练、矩阵优化、分布式训练。 |
| The Polar Express: Optimal Matrix Sign Methods and Their Application to the Muon Algorithm | [2505.16932v5](https://arxiv.org/abs/2505.16932v5) | 矩阵符号函数迭代及 Muon 的正交化；Muon、矩阵优化。 |
| Adafactor: Adaptive Learning Rates with Sublinear Memory Cost | [1804.04235v1](https://arxiv.org/abs/1804.04235v1) | 因子化统计量减少优化器内存成本；Adafactor、显存优化。 |
| Symbolic Discovery of Optimization Algorithms（Lion） | [2302.06675v4](https://arxiv.org/abs/2302.06675v4) | 符号搜索发现 Lion，符号更新与状态内存成本；Lion、显存优化。 |
| Dion: Distributed Orthonormalized Updates | [2504.05295v3](https://arxiv.org/abs/2504.05295v3) | 分布式低秩正交化更新、通信与优化器内存成本；Dion、预训练、矩阵优化、分布式训练、显存优化。使用 v3 当前标题，未沿用 v1 旧标题。 |

统一增加“优化器”研究类别，既能筛选全部 12 项，也能组合算法系列。算法系列采用显式登记；引用 AdamW 或 Muon 不会自动获得该系列标签。研究阶段按实际实验登记，不将所有优化算法论文一律标成预训练或后训练。

## 来源与翻译记录

- arXiv 全文固定版本、原始 HTML、图片及各自 SHA-256 保存在被忽略的 `data/`；Adam 保留原始 PDF、布局转换记录、英文 HTML 指纹与逐块 PDF 页码。
- Muon 博客使用专门的作者文章导入器，核对作者、canonical URL、题目和发布日期；记录原始完整 HTML 与正文提取指纹。阅读器显示“作者文章”，不显示为 arXiv 论文。
- 官方 HTML 的数学表达保留为 MathML，代码与算法中的受保护内容保持原样；英文和中文使用同一内容块 ID、锚点与顺序。Lion 原文不同目录中的同名图片使用完整来源 URL 的稳定哈希后缀，避免覆盖。
- Adam 固定 v9 的源码包只含 PDF 包装器，没有数学 TeX。初次布局重建发现上下标、根号及求和范围错位，修正后保留原 PDF 数学字形为 342 个局部 SVG，并保留 4 张图表；15 页正文转为 160 个语义 HTML 内容块，源字符覆盖没有遗漏或重复。数学 SVG 经过净化，分别记录原始与净化后指纹、PDF 页码与字形索引；全页矢量仅作本地核查，不进入正文。这个回退确保原始字形显示，但没有 MathML 的语义或公式文本检索。布局配方见 `paper-metadata/pdf-recipes/adam-stochastic-optimization.json`。
- The Polar Express v5 官方 HTML 漏掉一个图面板。按固定 v5 的源码 TeX 图引用定位原始 PDF，转换该单个面板并记录归档、TeX 成员、PDF 与图片指纹；没有替换其他原图。
- 本机模型复用 LM Studio 已有的 `mlx-community/Qwen3.6-35B-A3B-4bit`，API 标识 `qwen3.6-35b-a3b`，8192 上下文，最多 4 个并发请求，`reasoning_effort: none`；每篇记录实际参数、身份与接收的响应。
- GPT-6 Luna 部分由实际 `gpt-6-luna` Codex 子代理生成，`reasoning_effort: low`。临时 JSON 只承担文本片段响应和冻结任务身份，不改公式 DOM；最终生成完整中文 HTML。逐块记录实际模型，不捏造 API token 消耗或费用。
- 阅读抽查发现的 Muon 迭代次数与系数衔接，以及 Adam 算法梯度注释、遗憾界说明和变量定义衔接，已由实际 GPT-6 Luna 定向修正。修正记录保留原文、前后译文与草稿指纹，公式和素材没有随译文改动。
- 机器翻译始终标记 `humanReviewed: false`。完整性与公式一致性自动校验不等于全篇人工审校。

完整公开库为 54 个条目、19272 个对齐内容块、1561 个正文素材和 1724 个处理后文件。新增 12 项均有完整英文和中文正文；处理后 HTML、轻量元数据及素材加入 `paper-data/` 并沿用 Git LFS，原始下载、转换材料和模型响应保留在被忽略的工作目录。完整工作库与 HTML 导出分别通过严格数据校验；原有 42 项的 1158 个正文、元数据和素材文件指纹保持一致，公共目录更新为 54 项。阅读器核验覆盖优化器及算法系列筛选、作者原文链接、单栏与双栏切换、双向同步滚动、字号调整和三种主题下的公式显示。

用户在完成本地导入后明确要求“发布”，本轮按该授权将十二个新增条目与相关导入、验证和阅读器改动一起发布到 GitHub / Vercel。公开分发保留来源及原文许可信息；原始下载与许可记录不作为发布许可的替代。
