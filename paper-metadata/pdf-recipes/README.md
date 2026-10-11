# PDF 转换配方

配方只记录布局、表格网格、公式覆盖和引用目标，用于重现完整英文 HTML；原始 PDF、图像、转换结果和译文均位于本地数据工作目录。每个配方必须核对完整 PDF 页面和字符覆盖，不能将配方用于其他版本。

GPT-2 配方绑定官方 PDF SHA-256 `d9d852e2894556e73f53cb22b7c605a9643d6f0b19bf604b429ed6192fa24f4e`，配方 SHA-256 `e6d2598594ebfb2171856a659e10173953722f3b474c543a275260d27afc1c40`。使用 pdfplumber 0.11.9、pypdf 6.10.0 与 `scripts/convert-pdf.py` 1.2.0；原文符号不一致也保留并记录。

先下载固定官方 PDF 至本地缓存，再运行：

```sh
python scripts/convert-pdf.py --pdf data/input/source.pdf --recipe paper-metadata/pdf-recipes/gpt-2-technical-report.json --out-dir data/input/converted
npm run paper:import-pdf -- --converted-dir data/input/converted --pdf data/input/source.pdf --recipe paper-metadata/pdf-recipes/gpt-2-technical-report.json --metadata data/input/identity.json
```

identity.json 需记录实际的 id、title、authors、year、sourceUrl、pdfUrl、publishedAt、fetchedAt 和固定 version；抓取时间必须为这次实际下载时间。导入器检查 PDF、配方、英文 HTML、全页字符覆盖和链接目标，已有不同版本或转换结果会被拒绝，已有相同来源的译文保留。其他论文需要先制作并核验各自配方；扫描 PDF 还需 OCR 与阅读顺序校验。
