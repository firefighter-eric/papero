import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { parsePaper, sanitizeHtml, sanitizeSvg, translationUnits, normalizeHeadingNumber, assertTranslationFidelity, technicalIdentifiers, isTechnicalLabelOnly, sha256, safeId, validArxivId, visibleProseText, scientificSignature, isLiteralChatTemplateNode, isLiteralFencedCodeNode } from './paper-lib.mjs'

test('explicit LaTeXML verbatim table samples preserve split JSON lines while surrounding descriptions translate', () => {
  const html = '<table><tr><td>Data instance</td><td><span class="ltx_verbatim ltx_font_typewriter"><span>{</span></span><span class="ltx_verbatim ltx_font_typewriter"><span>"url": "http://example.com/24758",</span></span><span class="ltx_verbatim ltx_font_typewriter"><span>"text": "Original training sample."</span></span><span class="ltx_verbatim ltx_font_typewriter"><span>}</span></span><p>This sample comes from a web crawl.</p></td></tr></table>'
  const prepared = translationUnits(html, 'table')
  assert.deepEqual(prepared.units.map(unit => unit.text), ['Data instance', 'This sample comes from a web crawl.'])
  const translated = prepared.render(['数据样例', '该样例来自网页抓取。'])
  assert.deepEqual(scientificSignature(load(html, {}, false)), scientificSignature(load(translated, {}, false)))
  assert.ok(translated.includes('Original training sample.'))
  assert.ok(translated.includes('该样例来自网页抓取。'))
})

test('unambiguous US slash dates retain calendar identity without licensing changed dates or extra scores', () => {
  assertTranslationFidelity('09/30/2024 dump', '2024年9月30日转储')
  assert.throws(() => assertTranslationFidelity('09/30/2024 dump', '2024年9月29日转储'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity('09/30/2024 dump', '2024年9月30日转储，得分96'), /added/)
  assert.throws(() => assertTranslationFidelity('09/31/2024 dump', '2024年9月30日转储'))
})
import { parseUnitResponse, translateWithSplitting, compactRequestContexts } from './translate-paper.mjs'
import { importArxiv, updateCatalog } from './import-paper.mjs'
import { translatedAbstractText } from './paper-lib.mjs'
import { assertBlockTranslationFidelity } from './paper-lib.mjs'

test('joined blocks reject a percentage copied across preserved math after fragments pass', () => {
  const source = '<p>The model is 10<math><mo>×</mo></math> smaller.</p>'
  assertTranslationFidelity(' smaller.', '%更小。')
  assert.throws(() => assertBlockTranslationFidelity(source, '<p>模型规模缩小 10<math><mo>×</mo></math>%。</p>'), /Numeric value/)
  assertBlockTranslationFidelity(source, '<p>模型规模缩小 10<math><mo>×</mo></math>。</p>')
  assertBlockTranslationFidelity('<p>We improve 50<math><mo>%</mo></math>.</p>', '<p>我们提升 50<math><mo>%</mo></math>。</p>')
  assert.throws(() => assertBlockTranslationFidelity(source, '<p>模型规模缩小 10<math><mo>%</mo></math>。</p>'), /Scientific markup/)
})

test('taking advantage of reward weaknesses is exploitation rather than a model advantage', () => {
  assertTranslationFidelity('The model is taking advantage of weaknesses in our reward.', '模型利用了奖励中的弱点。')
  assert.throws(() => assertTranslationFidelity('The model takes advantage of a weakness, but we discuss its advantages over other models.', '模型利用了一个弱点，我们讨论它与其他模型。'), /advantages/)
})

test('plain MBPP assertion spans preserve executable source and existing fragment boundaries', () => {
  const code = 'assert heap_queue_largest([25, 35, 22, 85, 14, 65, 75, 22, 58], 5) == [85, 75, 65, 58, 35]'
  const html = `<p>Run the test:</p><span class="ltx_text">${code}</span>`
  assert.ok(isTechnicalLabelOnly(code))
  assert.deepEqual(translationUnits(html, 'table').units.map(unit => unit.text), ['Run the test:', code])
  assertTranslationFidelity(code, code)
  assert.throws(() => assertTranslationFidelity(code, `断言：${code}`), /Literal Python assertion/)
  assert.throws(() => assertTranslationFidelity(code, code.replace('==', '!=')), /Literal Python assertion/)
  assertBlockTranslationFidelity(html, `<p>运行测试：</p><span class="ltx_text">${code}</span>`)
  assert.throws(() => assertBlockTranslationFidelity(html, `<p>运行测试：</p><span class="ltx_text">断言：${code}</span>`), /Scientific markup/)
})

test('complete SacreBLEU configuration signatures are preserved without translating their fields', () => {
  const signature = '[SacreBLEU signature: BLEU+case.mixed+numrefs.1+smooth.exp+tok.intl+version.1.2.20]'
  assert.ok(isTechnicalLabelOnly(signature))
  assertTranslationFidelity(signature, signature)
  assert.throws(() => assertTranslationFidelity(signature, signature.replace('tok.intl', 'tok.zh')), /Literal SacreBLEU/)
  assert.throws(() => assertTranslationFidelity(signature, `评分配置：${signature}`), /Literal SacreBLEU/)
  assert.equal(isTechnicalLabelOnly(`We use ${signature} to evaluate our translations.`), false)
})

test('decimal dataset versions followed by modal may are not invented calendar dates', () => {
  assertTranslationFidelity('OSCAR-22.01 may be distributed without deduplication.', 'OSCAR-22.01 可能未经去重就被分发。')
  assert.throws(() => assertTranslationFidelity('OSCAR-22.01 may be distributed without deduplication.', 'OSCAR-22.02 可能未经去重就被分发。'), /Numeric value/)
  assertTranslationFidelity('We released it on 1 May.', '我们在5月1日发布。')
  assert.throws(() => assertTranslationFidelity('We released it on 1 May.', '我们在5月2日发布。'), /Calendar date/)
})

test('derived translated abstract excludes front matter and duplicate LaTeX annotations', () => {
  const blocks = [
    {sourceId:'abstract1.1',kind:'paragraph',zh:'<p>摘要 <math><semantics><mi>x</mi><annotation>x_latex</annotation></semantics></math>。</p>'},
    {sourceId:'abstract1.2',kind:'paragraph',zh:'<p>第二段。</p>'},
    {sourceId:'p1.1',kind:'paragraph',sectionId:'abstract1',zh:'<p>Technical Report</p>'},
    {sourceId:'S0.F1',kind:'figure',sectionId:'abstract1',zh:'<figure><figcaption>图1</figcaption></figure>'},
  ]
  const before = structuredClone(blocks)
  assert.equal(translatedAbstractText(blocks), '摘要 x。 第二段。')
  assert.deepEqual(blocks, before)
})

test('sanitizer removes executable markup and retains scientific MathML and safe local assets', () => {
  const sanitized = sanitizeHtml('<p onclick="alert(1)">Text<script>alert(2)</script><a href="javascript:alert(3)">link</a><img src="assets/figure.svg" onerror="alert(4)"><math><semantics><mfrac><mi>x</mi><mn>2</mn></mfrac><annotation encoding="application/x-tex">x/2</annotation></semantics></math></p><iframe src="https://example.org"></iframe>')
  assert.doesNotMatch(sanitized, /script|onclick|onerror|javascript|iframe/)
  assert.match(sanitized, /<mfrac>/)
  assert.match(sanitized, /encoding="application\/x-tex"/)
  assert.match(sanitized, /src="assets\/figure.svg"/)
})

test('parser extracts nested sections, atomic tables and individual references without duplication', () => {
  const html = '<article class="ltx_document"><h1 class="ltx_title_document">Example</h1><span class="ltx_personname">Ada</span><section id="S1"><h2>1 Introduction</h2><p id="p1">Text</p><section id="S1.1"><h3>1.1 Methods</h3><figure id="t1" class="ltx_table"><table><tr><td>Data</td></tr></table><figcaption>Caption</figcaption></figure></section></section><section id="bib"><h2>References</h2><ul class="ltx_biblist"><li id="bib1" class="ltx_bibitem">Reference</li></ul></section></article>'
  const paper = parsePaper(html, { id: 'example', arxivId: '1706.03762v7', htmlUrl: 'https://arxiv.org/html/1706.03762v7' })
  assert.equal(paper.title, 'Example')
  assert.deepEqual(paper.authors, ['Ada'])
  assert.deepEqual(paper.blocks.map(block => block.kind), ['heading', 'paragraph', 'heading', 'table', 'heading', 'reference'])
  assert.equal(paper.blocks[3].sectionId, 'S1.1')
  assert.equal(paper.blocks[5].sourceId, 'bib1')
  assert.throws(() => parsePaper('<p>Unavailable</p>', { id: 'example', arxivId: '1706.03762v7' }), /no substitute/)
})

test('title publication notes stay readable as front matter without polluting the paper identity', () => {
  const html = '<article class="ltx_document"><h1 class="ltx_title_document">Generative Adversarial Nets<span class="ltx_pubnotes"><span class="ltx_pubnotes_content"><span class="ltx_pubnote"><span class="ltx_note_name">Thanks:</span><span id="id3">Sherjil Ozair is a visiting researcher.</span></span></span></span></h1><div class="ltx_authors"><span class="ltx_personname">Ian Goodfellow</span></div><section id="S1"><h2>Introduction</h2><p>Source body.</p></section></article>'
  const paper = parsePaper(html, { id: 'gan', arxivId: '1406.2661v1', htmlUrl: 'https://arxiv.org/html/1406.2661v1' })
  assert.equal(paper.title, 'Generative Adversarial Nets')
  assert.equal(paper.blocks[0].sectionId, 'frontmatter')
  assert.equal(paper.blocks[0].kind, 'paragraph')
  assert.match(paper.blocks[0].en, /id="id3"/)
  assert.equal(paper.blocks.filter(b => b.en.includes('visiting researcher')).length, 1)
  assert.deepEqual(paper.authors, ['Ian Goodfellow'])
  assert.equal(paper.blocks.at(-1).sectionId, 'S1')
})

test('translation edits only narrative text and preserves formula, citation and structural markup', () => {
  const source = '<p id="p1">The value <math><mi>x</mi></math> is large <cite>[<a href="#bib1">1</a>]</cite>.</p>'
  const prepared = translationUnits(source)
  assert.deepEqual(prepared.units.map(unit => unit.text), ['The value ', ' is large '])
  const result = prepared.render(['数值 ', ' 很大 '])
  assert.equal(load(result)('math').html(), '<mi>x</mi>')
  assert.equal(load(result)('a').attr('href'), '#bib1')
  assert.match(result, /数值/)
  assert.throws(() => prepared.render(['缺失']), /count mismatch/)
})

test('model response rejects omitted units, wrong ids, copied prose and injected empty fields', () => {
  const records = [{ id: 'block-1', text: 'A long English sentence about self-attention, neural networks, and machine translation.' }]
  assert.equal(parseUnitResponse('{"translations":{"block-1":"这是一段关于自注意力、神经网络和机器翻译的长句。"}}', records)[0].id, 'block-1')
  assert.throws(() => parseUnitResponse('{"translations":[]}', records), /expected 1/)
  assert.throws(() => parseUnitResponse('{"translations":{"wrong":"中文"}}', records), /Missing/)
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { 'block-1': records[0].text } }), records), /No Chinese/)
})

test('identifiers reject traversal and fingerprints are deterministic', () => {
  assert.equal(safeId('../secret'), false)
  assert.equal(validArxivId('1706.03762v7'), true)
  assert.equal(validArxivId('1706.03762/../../secret'), false)
  assert.equal(sha256('paper'), sha256('paper'))
  assert.equal(parsePaper('<article class="ltx_document"><h1 class="ltx_title_document">Old paper</h1></article>', { id: 'old', arxivId: 'hep-th/9901001v1' }).year, 1999)
})

test('SVG sanitation retains vector content and removes active elements and external resources', () => {
  const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><defs><linearGradient id="g"/></defs><path d="M0 0L1 1" fill="url(#g)"/><script>bad()</script><foreignObject><p>bad</p></foreignObject><use href="https://evil.test/a.svg"/><animate attributeName="href" to="javascript:bad()"/><text>Attention</text></svg>')
  assert.doesNotMatch(result, /script|foreignObject|onload|evil|animate/)
  assert.match(result, /<path/)
  assert.match(result, /url\(#g\)/)
  assert.match(result, /Attention/)
  const namespaced = sanitizeSvg('<?xml-stylesheet href="https://evil.test/a.css"?><svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>bad()</svg:script><path d="M0 0"/></svg>')
  assert.doesNotMatch(namespaced, /xml-stylesheet|svg:script|evil/)
})

test('individually identified text units can be returned out of order but none may be lost', () => {
  const records = [{ id: 'block:0', text: 'First' }, { id: 'block:1', text: 'Second' }]
  const results = parseUnitResponse('{"translations":[{"id":"block:1","text":"第二"},{"id":"block:0","text":"第一"}]}', records)
  assert.equal(results[0].text, '第一')
  assert.throws(() => parseUnitResponse('{"translations":[{"id":"block:0","text":"第一"},{"id":"block:0","text":"第二"}]}', records), /Duplicate/)
})

test('failed large requests split down to individual text units without losing alignment', async () => {
  const records = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }]
  const requestedSeeds = []
  const results = await translateWithSplitting(records, async (items, attempt) => {
    requestedSeeds.push(attempt)
    if (items.length > 1) throw new Error('larger request rejected')
    return items.map(item => ({ id: item.id, text: '中文' }))
  })
  assert.deepEqual(results.map(item => item.id), ['a', 'b', 'c'])
  assert.ok(requestedSeeds.includes(3))
  await assert.rejects(() => translateWithSplitting([records[0]], async () => { throw new Error('single unit rejected') }), /single unit rejected/)
})

test('reusing a paper slug for a different identity fails before overwriting source or translations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-import-'))
  try {
    const paperDir = path.join(directory, 'papers', 'existing')
    await mkdir(paperDir, { recursive: true })
    const source = 'original source preserved'
    const paper = JSON.stringify({ id: 'existing', arxivId: '1706.03762v7', blocks: [{ zh: '已有译文' }] })
    await writeFile(path.join(paperDir, 'source.html'), source)
    await writeFile(path.join(paperDir, 'paper.json'), paper)
    await assert.rejects(() => importArxiv({ arxivId: '2401.00001v1', id: 'existing', dataDir: directory, force: true }), /Choose a fresh --id/)
    assert.equal(await readFile(path.join(paperDir, 'source.html'), 'utf8'), source)
    assert.equal(await readFile(path.join(paperDir, 'paper.json'), 'utf8'), paper)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('heading normalization removes only a repeated model-generated structural number', () => {
  const en = '<h2 id="heading"><span class="ltx_tag ltx_tag_section">7 </span>Conclusion</h2>'
  const duplicated = '<h2 id="heading"><span class="ltx_tag ltx_tag_section">7 </span>7结论</h2>'
  const normalized = normalizeHeadingNumber(en, duplicated)
  assert.equal(load(normalized).text(), '7 结论')
  assert.equal(load(normalized)('.ltx_tag').text(), '7 ')
  assert.equal(load(normalized)('h2').attr('id'), 'heading')
  assert.equal(normalizeHeadingNumber(en, normalized), normalized)
  const legitimate = '<h2><span class="ltx_tag">7 </span>7 reasons to use attention</h2>'
  const legitimateZh = '<h2><span class="ltx_tag">7 </span>7 个使用注意力的理由</h2>'
  assert.equal(normalizeHeadingNumber(legitimate, legitimateZh), legitimateZh)
  const differentNumber = '<h2><span class="ltx_tag">7 </span>7.1 子章节</h2>'
  assert.equal(normalizeHeadingNumber(en, differentNumber), differentNumber)
  const subsection = '<h3><span class="ltx_tag">3.2.1 </span>Scaled Dot-Product Attention</h3>'
  const subsectionZh = '<h3><span class="ltx_tag">3.2.1 </span>3.2.1 缩放点积注意力</h3>'
  assert.equal(load(normalizeHeadingNumber(subsection, subsectionZh)).text(), '3.2.1 缩放点积注意力')
})

test('translation fidelity catches dropped scores and altered model ids while allowing lexical numerals', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('Qwen2.5-72B scores 91.2% using eight GPUs and 32,768 tokens.', 'Qwen2.5-72B 使用 8 块 GPU 和 32,768 个 token，得分 91.2%。'))
  assert.throws(() => assertTranslationFidelity('Qwen2.5-72B scores 91.2%.', 'Qwen2.5-72B 得分 90.2%。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('Qwen2.5-72B scores 91.2%.', 'Qwen2.5-7B 得分 91.2%。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('The score is 91.2%.', '两个得分均为 91.2% 和 91.2%。'), /added/)
  assert.doesNotThrow(() => assertTranslationFidelity('Eight GPUs.', '8 块 GPU。'))
  assert.doesNotThrow(() => assertTranslationFidelity('From 2023–2024, -0.5% changed.', '从 2023 至 2024 年，变化为 -0.5%。'))
  assert.doesNotThrow(() => assertTranslationFidelity('72 billion parameters', '720 亿参数'))
  assert.doesNotThrow(() => assertTranslationFidelity('0.5 billion parameters', '0.5B 参数'))
  assert.throws(() => assertTranslationFidelity('0.5 billion parameters', '0.5 亿参数'), /Numeric value/)
  assert.doesNotThrow(() => assertTranslationFidelity('0.5 to 72 billion parameters', '0.5B 到 72B 参数'))
  assert.throws(() => assertTranslationFidelity('0.5 to 72 billion parameters', '0.5 到 720 亿参数'), /Numeric value/)
  assert.doesNotThrow(() => assertTranslationFidelity('GPT-4-level performance', 'GPT-4 级别的性能'))
  assert.throws(() => assertTranslationFidelity('and discuss its advantages over models such as', '并讨论其相对于诸如'), /Core concepts/)
  assert.doesNotThrow(() => assertTranslationFidelity('and discuss its advantages over models such as', '并讨论其相比以下模型的优势，例如'))
})

test('new report model families retain full version and checkpoint identifiers', () => {
  const identifiers = [
    'DeepSeek-V3', 'DeepSeek-R1-Zero-Qwen-32B', 'DeepSeek-R1-Distill-Qwen-1.5B',
    'DeepSeek-V3.2-Speciale', 'DeepSeek-V4-Pro-Max', 'DeepSeek V3', 'deepseekV3.2',
    'Kimi K2.5', 'Kimi-K2.5', 'KimiK3', 'Kimi K2-Thinking',
    'MiniMax-M3', 'MiniMax M3', 'MiniMaxM3-230B', 'MiniMax-M3-0125',
    'K1.5', 'K2', 'K2.5', 'K2.6-Thinking', 'K3',
  ]
  for (const identifier of identifiers) {
    assert.deepEqual(technicalIdentifiers(`The ${identifier} model scores 91.2%.`), [identifier])
    assert.doesNotThrow(() => assertTranslationFidelity(`The ${identifier} model scores 91.2%.`, `${identifier} 模型得分91.2%。`))
    assert.throws(() => assertTranslationFidelity(`The ${identifier} model scores 91.2%.`, '其他模型得分91.2%。'), /Technical identifier/)
  }
  assert.deepEqual(technicalIdentifiers('DeepSeek and Kimi work on models, while MiniMax studies attention.'), [])
  assert.deepEqual(technicalIdentifiers('K9, K2.7 and a physical M3 label.'), [])
  assert.deepEqual(technicalIdentifiers('The Qwen2.5-72B and Llama-3-70B models.'), ['Qwen2.5-72B', 'Llama-3-70B'])
})

test('new family fidelity rejects variant changes, omitted repetitions and invented models or values', () => {
  assert.throws(() => assertTranslationFidelity('DeepSeek-V3.2-Speciale scores 91.2%.', 'DeepSeek-V3.2 得分91.2%。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('DeepSeek-R1-Distill-Qwen-1.5B scores 91.2%.', 'DeepSeek-R1-Distill-Qwen-7B 得分91.2%。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('Kimi K2.5 scores 91.2%.', 'Kimi K2.6 得分91.2%。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('MiniMax-M3-230B scores 91.2%.', 'MiniMax-M3-23B 得分91.2%。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('MiniMax-M3-0125 scores 91.2%.', 'MiniMax-M3-0126 得分91.2%。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('K2.5 improves K2.5.', 'K2.5 得到提升。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('The model scores 91.2%.', 'MiniMax-M3 模型得分91.2%。'), /Technical identifiers added/)
  assert.throws(() => assertTranslationFidelity('DeepSeek-V4 scores 91.2%.', 'DeepSeek-V4 和 Kimi-K2.5 得分91.2%。'), /Technical identifiers added/)
  assert.throws(() => assertTranslationFidelity('Kimi-K2.5 scores 91.2%.', 'Kimi-K2.5 得分91.2%和99.9%。'), /Numeric values added/)
  assert.doesNotThrow(() => assertTranslationFidelity('Kimi-K2.5 has 1 million parameters.', 'Kimi-K2.5 有1000000个参数。'))
})

test('model versions next to modal may are not calendar dates, while actual dates remain exact', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('All Gemma 2 users should test scenarios in which Gemma 2 may be used.', '所有 Gemma 2 用户都应测试可能使用 Gemma 2 的场景。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Gemma 3 may improve. The release is May 2.', 'Gemma 3 可能有所改进。发布于5月2日。'))
  assert.throws(() => assertTranslationFidelity('Gemma 3 may improve. The release is May 2.', 'Gemma 3 可能有所改进。发布于5月3日。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity('Gemma 2 may be used.', 'Gemma 2 可在5月2日使用。'), /Calendar dates added/)
})

test('numbered equations followed by modal may retain numeric identity without becoming dates', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('In practice, equation 1 may not provide sufficient gradient.', '在实践中，方程 1 可能无法提供足够的梯度。'))
  assert.throws(() => assertTranslationFidelity('Equation 1 may be useful.', '方程 2 可能有用。'), /Numeric value/)
  assert.doesNotThrow(() => assertTranslationFidelity('Equation 1 may be useful. Published on 1 May.', '方程 1 可能有用。发表于5月1日。'))
  assert.throws(() => assertTranslationFidelity('Equation 1 may be useful. Published on 1 May.', '方程 1 可能有用。发表于5月2日。'), /Calendar date/)
})

test('shared-month day ranges preserve both ordered endpoints and unrelated scores', () => {
  const source = 'Over 5–9 October 2015 AlphaGo won 5 games to 0.'
  for (const range of ['2015年10月5–9日', '2015年10月5日至9日']) {
    assert.doesNotThrow(() => assertTranslationFidelity(source, `${range}，AlphaGo 以5比0获胜。`))
  }
  assert.doesNotThrow(() => assertTranslationFidelity('October 5–9, 2015.', '2015年10月5日至9日。'))
  for (const changed of ['2015年10月5日至8日', '2015年10月6日至9日', '2015年10月9日', '2015年11月5日至9日', '2015年10月9日至5日']) {
    assert.throws(() => assertTranslationFidelity(source, `${changed}，AlphaGo 以5比0获胜。`), /Calendar date|calendar date/)
  }
  assert.throws(() => assertTranslationFidelity(source, '2015年10月5日至9日，AlphaGo 以6比0获胜。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('Over 28–29 February 2015.', '2015年2月28日至29日。'), /Invalid calendar date range/)
})

test('Chinese paired em dashes before a multiplier never change its sign', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('We evaluate 152 layers—8 times deeper.', '我们评估 152 层——8 倍深。'))
  assert.throws(() => assertTranslationFidelity('A score of 8.', '得分为 −8。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('A score of -8.', '得分为——8。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('A score of 8.', '得分为 --8。'), /Numeric value/)
})

test('Gemini report names retain spaced tiers, version aliases and complete checkpoint suffixes', () => {
  // Observed in 2312.11805v5, 2403.05530v5 and 2507.06261v6.
  const names = [
    'Gemini 1.0', 'Gemini Ultra', 'Gemini Pro', 'Gemini Nano',
    'Gemini 1.0 Ultra', 'Gemini 1.0 Pro', 'Gemini 1.0 Nano',
    'Gemini 1.5', 'Gemini 1.5 Pro', 'Gemini 1.5 Flash', 'Gemini 1.5 Flash-8B',
    'Gemini 2.X', 'Gemini 2.0', 'Gemini 2.0 Pro', 'Gemini 2.0 Flash', 'Gemini 2.0 Flash-Lite',
    'Gemini 2.5', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.5 Flash-Lite',
    'gemini-2.5-flashlite-preview-06-17', 'Gemini-1.5-Pro', 'Gemini-2.5-Flash-Lite',
    '1.0 Ultra', '1.5 Pro', '1.5 Flash', '2.0 Flash-Lite', '2.5 Pro', '2.5 Flash',
  ]
  for (const name of names) {
    assert.deepEqual(technicalIdentifiers(`We evaluate ${name} on 57 tasks.`), [name])
    assert.doesNotThrow(() => assertTranslationFidelity(`We evaluate ${name} on 57 tasks.`, `我们在57项任务上评估${name}。`))
    assert.throws(() => assertTranslationFidelity(`We evaluate ${name} on 57 tasks.`, '我们在57项任务上评估该模型。'), /Technical identifier/)
  }
})

test('Gemini fidelity rejects changed tiers, versions, suffixes and occurrence counts', () => {
  const changes = [
    ['Gemini 1.5 Pro', 'Gemini 1.5 Flash'],
    ['Gemini Ultra', 'Gemini Nano'],
    ['Gemini 2.0 Flash-Lite', 'Gemini 2.0 Flash'],
    ['Gemini 2.5 Pro', 'Gemini 2.0 Pro'],
    ['Gemini 2.X', 'Gemini 2.5'],
    ['Gemini 1.5 Flash-8B', 'Gemini 1.5 Flash'],
    ['Gemini 1.5 Flash-8B', 'Gemini 1.5 Flash-7B'],
    ['gemini-2.5-flashlite-preview-06-17', 'gemini-2.5-flashlite-preview-06-18'],
    ['1.5 Pro', '1.5 Flash'],
  ]
  for (const [source, changed] of changes) {
    assert.throws(() => assertTranslationFidelity(`${source} scores 95%.`, `${changed} 得分95%。`), /Technical identifier/)
  }
  assert.throws(() => assertTranslationFidelity('Gemini 1.5 Pro improves Gemini 1.5 Pro.', 'Gemini 1.5 Pro 得到改进。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('Gemini 1.5 Pro performs well.', 'Gemini 1.5 Pro 和 Gemini 1.5 Flash 表现良好。'), /Technical identifiers added/)
  assert.throws(() => assertTranslationFidelity('The model performs well.', 'Gemini 2.5 Flash 模型表现良好。'), /Technical identifiers added/)
  assert.throws(() => assertTranslationFidelity('Gemini 2.5 Pro scores 95%.', 'Gemini 2.5 Pro 得分95%与99%。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('Gemini 2.5 Pro has -0.5% change.', 'Gemini 2.5 Pro 变化为0.5%。'), /Numeric value/)
})

test('Gemini names never consume neighboring prose or turn a prose dash into a numeric minus', () => {
  assert.deepEqual(technicalIdentifiers('Gemini models use flash memory and ultra-low-latency serving.'), [])
  assert.deepEqual(technicalIdentifiers('A pro evaluates Gemini research and Pro style.'), [])
  assert.deepEqual(technicalIdentifiers('Gemini 1.5 Pro now supports audio.'), ['Gemini 1.5 Pro'])
  assert.deepEqual(technicalIdentifiers('Gemini 2.5 Flash-Lite is faster.'), ['Gemini 2.5 Flash-Lite'])
  assert.equal(isTechnicalLabelOnly('flash memory'), false)
  assert.equal(isTechnicalLabelOnly('Gemini 1.5 Pro now supports audio.'), false)
  for (const dash of ['–', '—', '―']) {
    assert.deepEqual(technicalIdentifiers(`Gemini 2.5 Pro${dash}1 million tokens.`), ['Gemini 2.5 Pro'])
    assert.doesNotThrow(() => assertTranslationFidelity(`Gemini 2.5 Pro${dash}1 million tokens.`, 'Gemini 2.5 Pro支持1M个token。'))
  }
})

test('Gemini table tiers remain exact within their own source DOM text fragment', () => {
  for (const label of ['Gemini', 'Ultra', 'Pro', 'Nano', 'Nano-1', 'Nano-2', 'Flash', 'Flash-Lite']) {
    assert.deepEqual(technicalIdentifiers(` ${label} `), [label])
    assert.equal(isTechnicalLabelOnly(label), true)
    assert.doesNotThrow(() => assertTranslationFidelity(label, label))
  }
  const source = '<table><tr><th><span>Flash-Lite</span><br><span>Gemini 2.0</span></th><th><span>Pro</span><br><span>Gemini 2.5</span></th></tr></table>'
  const prepared = translationUnits(source, 'table')
  const records = prepared.units.map((unit, index) => ({ id: `header:${index}`, text: unit.text }))
  assert.deepEqual(records.map(record => record.text), ['Flash-Lite', 'Gemini 2.0', 'Pro', 'Gemini 2.5'])
  const exact = Object.fromEntries(records.map(record => [record.id, record.text]))
  const accepted = parseUnitResponse(JSON.stringify({ translations: exact }), records)
  assert.equal(prepared.render(accepted.map(result => result.text)), sanitizeHtml(source))
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { ...exact, 'header:0': 'Flash' } }), records), /Technical identifier/)
  // A correct neighbor cannot repair an omitted tier, nor may a full name
  // borrow the version from the following immutable source text fragment.
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { ...exact, 'header:0': 'Gemini 2.0 Flash-Lite', 'header:1': 'Gemini 2.0' } }), records), /Technical identifier/)
})

test('Gemini fragment validation rejects moving a correct model name to a neighboring node', () => {
  const prepared = translationUnits('<p><span>Gemini 1.5 Pro</span> outperforms <span>Gemini 1.5 Flash</span> by 5%.</p>')
  const records = prepared.units.map((unit, index) => ({ id: `comparison:${index}`, text: unit.text }))
  assert.deepEqual(records.map(record => record.text), ['Gemini 1.5 Pro', ' outperforms ', 'Gemini 1.5 Flash', ' by 5%.'])
  const translations = { 'comparison:0': 'Gemini 1.5 Pro', 'comparison:1': ' 优于 ', 'comparison:2': 'Gemini 1.5 Flash', 'comparison:3': ' 5%。' }
  assert.doesNotThrow(() => parseUnitResponse(JSON.stringify({ translations }), records))
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { ...translations, 'comparison:0': '该模型', 'comparison:1': 'Gemini 1.5 Pro 优于 ' } }), records), /Technical identifier/)
})

test('Gemma report names preserve versions, sizes, effective sizes and checkpoint training stages', () => {
  const names = [
    'Gemma 2B', 'Gemma 7B', 'Gemma 7B IT', 'Gemma 1.0 IT', 'Gemma 1.1 IT 7B',
    'Gemma 2', 'Gemma 2 27B', 'Gemma-1 7B', 'Gemma 2.6B', 'Gemma 2 IT 9B',
    'gemma-2-27b-it', 'Gemma3-4B-IT', 'Gemma2-27B-IT', 'Gemma-3-27B-IT',
    'Gemma 3 27B IT', 'Gemma 3 PT', 'Gemma 3 IT', 'Gemma IT',
    'Gemma 4 12B', 'Gemma 4 31B', 'Gemma 4 26B-A4B', 'Gemma 4 E2B', 'Gemma 4 E4B',
    'Gemma 3n', 'Gemma 3n E2B', 'Gemma 3n E4B',
  ]
  for (const name of names) {
    assert.deepEqual(technicalIdentifiers(`We evaluate ${name} on 57 tasks.`), [name])
    assert.doesNotThrow(() => assertTranslationFidelity(`We evaluate ${name} on 57 tasks.`, `我们在57项任务上评估${name}。`))
    assert.throws(() => assertTranslationFidelity(`We evaluate ${name} on 57 tasks.`, '我们在57项任务上评估该模型。'), /Technical identifier/)
  }
  for (const [source, changed] of [
    ['Gemma3-4B-IT', 'Gemma3-4B-PT'], ['Gemma 3n E2B', 'Gemma 3 E2B'],
    ['Gemma 4 E2B', 'Gemma 4 E4B'], ['Gemma 4 26B-A4B', 'Gemma 4 26B-A2B'],
    ['Gemma 2 IT 27B', 'Gemma 2 IT 9B'], ['Gemma 3 27B IT', 'Gemma 3 27B'],
  ]) assert.throws(() => assertTranslationFidelity(`${source} scores 95%.`, `${changed} 得分95%。`), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('Gemma 4 E2B improves Gemma 4 E2B.', 'Gemma 4 E2B 得到改进。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('The model performs well.', 'Gemma 4 E2B 模型表现良好。'), /Technical identifiers added/)
  assert.deepEqual(technicalIdentifiers('Gemma models use IT infrastructure and PT methods.'), [])
  assert.deepEqual(technicalIdentifiers('Gemma Team, Gemini Research, and effective parameter counts.'), [])
  assert.deepEqual(technicalIdentifiers('Gemma 3 27B scores 95% across 57 tasks.'), ['Gemma 3 27B'])
  assert.deepEqual(technicalIdentifiers('Gemma 3 2B 9B 27B'), ['Gemma 3 2B'])
  assert.equal(isTechnicalLabelOnly('Gemma 3 27B IT improves instruction following.'), false)
  assert.throws(() => assertTranslationFidelity('Gemma 3 2B 9B 27B', 'Gemma 3 2B 9B'), /Numeric value/)
})

test('Gemma split table brands and PT/IT stages remain exact within the source fragment', () => {
  for (const label of ['Gemma', 'PT', 'IT']) {
    assert.deepEqual(technicalIdentifiers(` ${label} `), [label])
    assert.equal(isTechnicalLabelOnly(label), true)
    assert.doesNotThrow(() => assertTranslationFidelity(label, label))
  }
  for (const prose of ['it', 'it works', 'IT infrastructure', 'PT methods', 'Gemma models']) {
    assert.deepEqual(technicalIdentifiers(prose), [])
    assert.equal(isTechnicalLabelOnly(prose), false)
  }
  // Actual 2408.00118v3 Table 17 compares separate PT and IT cells for 2B,
  // 9B and 27B. Numeric size cells are already immutable translation markup.
  const source = '<table><tr><th colspan="2">2B</th><th colspan="2">9B</th><th colspan="2">27B</th></tr><tr><td><span>PT</span></td><td><span>IT</span></td><td><span>PT</span></td><td><span>IT</span></td><td><span>PT</span></td><td><span>IT</span></td></tr></table>'
  const prepared = translationUnits(source, 'table')
  const records = prepared.units.map((unit, index) => ({ id: `stage:${index}`, text: unit.text }))
  assert.deepEqual(records.map(record => record.text), ['PT', 'IT', 'PT', 'IT', 'PT', 'IT'])
  const exact = Object.fromEntries(records.map(record => [record.id, record.text]))
  const accepted = parseUnitResponse(JSON.stringify({ translations: exact }), records)
  assert.equal(prepared.render(accepted.map(result => result.text)), sanitizeHtml(source))
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { ...exact, 'stage:0': 'IT' } }), records), /Technical identifier/)
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { ...exact, 'stage:0': 'PT PT' } }), records), /Technical identifier/)
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { ...exact, 'stage:0': '预训练', 'stage:1': 'PT IT' } }), records), /Technical identifier/)
})

function observedGemmaFrontMatter(table = '', markId = 'id1') {
  return `<article class="ltx_document"><div id="p1" class="ltx_para"><span id="p1.1" class="ltx_ERROR undefined">\\authfootnotetext</span><p id="p1.2" class="ltx_p">1See Contributions and Acknowledgments section for full author list. Please send correspondence to <span id="p1.2.1" class="ltx_text ltx_font_typewriter">gemma-2-report@google.com</span>.</p></div><h1 class="ltx_title_document">Gemma 2: Improving Open Language Models at a Practical Size</h1><div class="ltx_authors"><span class="ltx_personname">Gemma Team\n</span><span class="ltx_personname">Google DeepMind<span id="${markId}" class="ltx_ERROR undefined">\\authfootnotemark</span>1\n</span></div><section id="S1"><h2>1 Introduction</h2><p id="S1.p1">A model <math><msub><mi>x</mi><mn>1</mn></msub></math> uses a <cite><a href="#bib1">1</a></cite> reference.</p>${table}</section><section id="bib"><h2>References</h2><ul class="ltx_biblist"><li id="bib1" class="ltx_bibitem">Original reference.</li></ul></section></article>`
}

test('only observed pinned Gemma author macros become a linked footnote without changing source hashes or prose', () => {
  for (const arxivId of ['2403.08295v4', '2408.00118v3', '2503.19786v1', '2607.02770v2']) {
    const raw = observedGemmaFrontMatter('', arxivId === '2408.00118v3' ? '1' : 'id1')
    const paper = parsePaper(raw, { id: 'gemma-test', arxivId, htmlUrl: `https://arxiv.org/html/${arxivId}` })
    assert.deepEqual(paper.authors, ['Gemma Team', 'Google DeepMind'])
    assert.deepEqual(paper.authorCredits, ['Gemma Team', 'Google DeepMind'])
    assert.equal(paper.source.sha256, sha256(raw))
    assert.equal(paper.source.repairs.length, 1)
    assert.match(raw, /\\authfootnotetext|\\authfootnotemark/)
    const note = load(paper.blocks[0].en, {}, false), authors = load(paper.blocks[1].en, {}, false)
    assert.equal(note('sup.ltx_note_mark').text(), '1')
    assert.equal(note.text(), '1 See Contributions and Acknowledgments section for full author list. Please send correspondence to gemma-2-report@google.com.')
    assert.equal(authors('sup.ltx_note_mark a').attr('href'), '#p1.2')
    assert.equal(authors('sup.ltx_note_mark a').text(), '1')
    assert.doesNotMatch(paper.blocks.map(block => block.en).join(''), /authfootnote|ltx_ERROR/)
    assert.deepEqual(translationUnits(paper.blocks[0].en).units.map(unit => unit.text), [' See Contributions and Acknowledgments section for full author list. Please send correspondence to '])
    assert.equal(translationUnits(paper.blocks[1].en).units.length, 0)
    assert.match(paper.blocks.find(block => block.sourceId === 'S1.p1').en, /<msub><mi>x<\/mi><mn>1<\/mn><\/msub>/)
    assert.match(paper.blocks.find(block => block.sourceId === 'S1.p1').en, /href="#bib1"/)
  }
  const unknown = parsePaper(observedGemmaFrontMatter(), { id: 'unknown', arxivId: '2408.00118v4' })
  assert.match(unknown.authors[1], /authfootnotemark/)
  assert.equal(unknown.source.repairs, undefined)
  const gemini = parsePaper(observedGemmaFrontMatter().replace('Gemma 2:', 'Gemini 1.5:'), { id: 'gemini-test', arxivId: '2408.00118v3' })
  assert.match(gemini.authors[1], /authfootnotemark/)
  assert.equal(gemini.source.repairs, undefined)
})

function observedGemma2BrokenTable(id) {
  const first = id === 'S8.T21'
  const headers = first
    ? [['', 'Challenges', '', '', ''], ['passed', '', '', '', ''], ['end-to-end', 'Challenges', '', '', ''], ['with success on', '', '', '', ''], ['all milestones', 'Total successful', '', '', ''], ['milestones over', '', '', '', ''], ['all challenges', 'Expert bits', '', '', ''], ['required to', '', '', '', ''], ['solve all tasks', '', '', '', '']]
    : [['', 'Personal', '', '', '', '', '', ''], ['connection', 'Speak', '', '', '', '', '', ''], ['again', 'Funny', 'Interesting', 'Kind', 'Trustworthy', 'Good', '', ''], ['listener', '', '', '', '', '', '', '']]
  const broken = new Set(first ? ['0:1', '2:1', '4:1', '6:1'] : ['0:1', '1:1', '2:5'])
  const data = first
    ? [['Gemini 1.0 Ultra', '0/10', '1/10', '16/45 (36%)', '13,026'], ['Gemini 1.5 Pro', '0/10', '2/10', '25/45 (56%)', '11,046'], ['Gemma 2 27B', '0/10', '1/10', '22/45 (49%)', '12,462']]
    : [['Gemini 1.0 Pro', '65%', '53%', '32%', '68%', '78%', '66%', '81%'], ['Gemini 1.0 Ultra', '69%', '65%', '38%', '65%', '86%', '63%', '74%'], ['Gemini 1.5 Pro', '82%', '70%', '69%', '81%', '95%', '69%', '90%'], ['Gemma 2 27B', '80%', '75%', '60%', '81%', '87%', '65%', '83%']]
  return `<figure id="${id}" class="ltx_table"><table id="${id}.2">${[...headers, ...data].map((row, index) => `<tr id="${id}.2.${index + 1}">${row.map((value, column) => `<td id="${id}.2.${index + 1}.${column + 1}">${broken.has(`${index}:${column}`) ? `<span id="${id}.2.${index + 1}.${column + 1}.1" class="ltx_ERROR undefined">\\CellWithForceBreak</span>` : ''}${value}</td>`).join('')}</tr>`).join('')}</table><figcaption id="${id}.caption">Table ${first ? '21' : '22'}: Original caption with <a href="#bib1">1</a>.</figcaption></figure>`
}

test('Gemma 2 broken multiline headers recover exact PDF column bindings while every source ID and data row remains intact', () => {
  const expected = [
    { id: 'S8.T21', page: 12, rows: 4, columns: 5, headers: ['', 'Challenges passed end-to-end', 'Challenges with success on all milestones', 'Total successful milestones over all challenges', 'Expert bits required to solve all tasks'] },
    { id: 'S8.T22', page: 13, rows: 5, columns: 8, headers: ['', 'Personal connection', 'Speak again', 'Funny', 'Interesting', 'Kind', 'Trustworthy', 'Good listener'] },
  ]
  for (const spec of expected) {
    const rawTable = observedGemma2BrokenTable(spec.id), before = load(sanitizeHtml(rawTable), {}, false)
    const raw = observedGemmaFrontMatter(rawTable)
    const paper = parsePaper(raw, { id: 'gemma-2', arxivId: '2408.00118v3' })
    const block = paper.blocks.find(block => block.sourceId === spec.id), after = load(block.en, {}, false)
    assert.equal(after('tr').length, spec.rows)
    assert.equal(after('tr').first().children('th').length, spec.columns)
    assert.deepEqual(after('tr').first().children('th').toArray().map(cell => after(cell).text().replace(/\s+/g, ' ').trim()), spec.headers)
    assert.equal(after('td').length, (spec.rows - 1) * spec.columns)
    const ids = $ => $('[id]').map((_, node) => $(node).attr('id')).get().sort()
    assert.deepEqual(ids(after), ids(before))
    assert.equal(new Set(ids(after)).size, ids(after).length)
    assert.equal(after.html(after('figcaption')[0]), before.html(before('figcaption')[0]))
    const dataRows = before('tr').slice(-(spec.rows - 1)).toArray()
    for (const original of dataRows) {
      const current = after('tr').filter((_, row) => after(row).attr('id') === before(original).attr('id'))[0]
      assert.equal(after.html(current), before.html(original))
    }
    assert.doesNotMatch(block.en, /CellWithForceBreak|ltx_ERROR/)
    assert.equal(paper.source.sha256, sha256(raw))
    const repair = paper.source.repairs.find(item => item.sourceId === spec.id)
    assert.equal(repair.referencePdfPage, spec.page)
    assert.equal(repair.headerRowsAfter, 1)
  }
})

test('Gemma table repair refuses an unexpected observed layout and never rewrites another version or figure', () => {
  const rawTable = observedGemma2BrokenTable('S8.T21')
  assert.throws(() => parsePaper(observedGemmaFrontMatter(rawTable.replace('passed', 'changed')), { id: 'gemma-2', arxivId: '2408.00118v3' }), /Unrecognized Gemma 2 table-header structure/)
  const misplaced = load(rawTable, {}, false)
  misplaced('[id="S8.T21.2.1.2.1"]').appendTo(misplaced('[id="S8.T21.2.1.1"]'))
  assert.throws(() => parsePaper(observedGemmaFrontMatter(misplaced.html()), { id: 'gemma-2', arxivId: '2408.00118v3' }), /Unrecognized Gemma 2 table-header structure/)
  const otherVersion = parsePaper(observedGemmaFrontMatter(rawTable), { id: 'gemma-2', arxivId: '2408.00118v4' })
  assert.match(otherVersion.blocks.find(block => block.sourceId === 'S8.T21').en, /CellWithForceBreak/)
  const otherTable = rawTable.replaceAll('S8.T21', 'S8.T99')
  const untouched = parsePaper(observedGemmaFrontMatter(otherTable), { id: 'gemma-2', arxivId: '2408.00118v3' })
  assert.match(untouched.blocks.find(block => block.sourceId === 'S8.T99').en, /CellWithForceBreak/)
  assert.equal(untouched.source.repairs.length, 1)
})

test('long exact new-model table labels remain English but ordinary copied prose still fails', () => {
  const labels = 'DeepSeek-V4-Pro-Max, DeepSeek-V3.2-Speciale, Kimi-K2.5, MiniMax-M3-230B, K2.6-Thinking'
  assert.equal(isTechnicalLabelOnly(labels), true)
  assert.deepEqual(parseUnitResponse(JSON.stringify({ translations: { models: labels } }), [{ id: 'models', text: labels }]).map(item => item.text), [labels])
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { models: labels.replace('MiniMax-M3-230B', 'MiniMax-M3-23B') } }), [{ id: 'models', text: labels }]), /No Chinese|Technical identifier/)
  const prose = `We compare ${labels} using the same training data and explain their evaluation results.`
  assert.equal(isTechnicalLabelOnly(prose), false)
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { prose } }), [{ id: 'prose', text: prose }]), /No Chinese/)
})

test('prose dashes after every model-family alternative do not turn positive quantities negative', () => {
  for (const dash of ['–', '—', '―']) {
    assert.doesNotThrow(() => assertTranslationFidelity(`DeepSeek-V3${dash}671 billion parameters.`, 'DeepSeek-V3有671B参数。'))
    assert.doesNotThrow(() => assertTranslationFidelity(`Kimi-K2.5${dash}1 trillion parameters.`, 'Kimi-K2.5有1T参数。'))
    assert.doesNotThrow(() => assertTranslationFidelity(`MiniMax-M3${dash}230 billion parameters.`, 'MiniMax-M3有230B参数。'))
    assert.doesNotThrow(() => assertTranslationFidelity(`Qwen3${dash}32 billion parameters.`, 'Qwen3有32B参数。'))
  }
  assert.throws(() => assertTranslationFidelity('DeepSeek-V3 −671 billion parameters.', 'DeepSeek-V3有671B参数。'), /Numeric value/)
  assert.doesNotThrow(() => assertTranslationFidelity('DeepSeek-V3 −671 billion parameters.', 'DeepSeek-V3有-671B参数。'))
  assert.throws(() => assertTranslationFidelity('Kimi-K2.5—1 trillion parameters.', 'Kimi-K2.5有1T参数，得分99.9%。'), /Numeric values added/)
})

test('report hyphenated token and parameter quantities keep their complete numeric scale', () => {
  const source = ': DeepSeek-V4-Pro-Max delivers strong results on synthetic and real use cases with a 1-million-token context window, surpassing even Gemini-3.1-Pro on academic benchmarks.'
  for (const quantity of ['1M', '100万', '1000000']) {
    assert.doesNotThrow(() => assertTranslationFidelity(source, `：DeepSeek-V4-Pro-Max 在合成和真实用例中表现强劲，拥有${quantity} token上下文窗口，在学术基准上甚至超越Gemini-3.1-Pro。`))
  }
  for (const quantity of ['0.5B', '5亿', '500000000']) assert.doesNotThrow(() => assertTranslationFidelity('A 0.5-billion-parameter model.', `一个${quantity}参数模型。`))
  for (const quantity of ['2.8T', '28000亿', '2800000000000']) assert.doesNotThrow(() => assertTranslationFidelity('A 2.8-trillion-parameter model.', `一个${quantity}参数模型。`))
  assert.throws(() => assertTranslationFidelity(source, 'DeepSeek-V4-Pro-Max 拥有10万token上下文窗口，超越Gemini-3.1-Pro。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity(source, 'DeepSeek-V4-Pro-Max 拥有1个token上下文窗口，超越Gemini-3.1-Pro。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity(source, 'DeepSeek-V4-Pro-Max 拥有100万token上下文窗口，超越Gemini-3.1-Pro，得分99.9%。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('A 0.5-billion-parameter model.', '一个0.5亿参数模型。'), /Numeric value/)
})

test('quantity compounds do not relax identifier, sign, range or subtraction boundaries', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('An offset of -0.5-billion-parameter scale.', '偏移量为-0.5B参数规模。'))
  assert.throws(() => assertTranslationFidelity('An offset of -0.5-billion-parameter scale.', '偏移量为0.5B参数规模。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('A 1-million-token context.', '一个-100万token上下文。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('A 1−million-token context.', '一个100万token上下文。'), /Numeric value/)
  assert.doesNotThrow(() => assertTranslationFidelity('The offset is −0.5 billion parameters.', '偏移量为-0.5B参数。'))
  assert.doesNotThrow(() => assertTranslationFidelity('A 0.5-1 million token range.', '范围为0.5M至1M个token。'))
  assert.throws(() => assertTranslationFidelity('A 0.5-1-million-token range.', '范围为0.5M至1M个token。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('The difference is 2-1-million-token.', '差值为200万至100万token。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('The expression is 1-million.', '表达式为1000000。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('The expression is 1 - million-token.', '表达式为1000000。'), /Numeric value/)
  assert.doesNotThrow(() => assertTranslationFidelity('The Qwen3-1-million-token model.', 'Qwen3-1-million-token 模型。'))
  assert.throws(() => assertTranslationFidelity('The Qwen3-1-million-token model.', 'Qwen3-1000000-token 模型。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('The Prototype-1-million-token model.', 'Prototype-1000000-token 模型。'), /Numeric value/)
})

test('FineWeb spaced token compounds preserve their scale, snapshot count and occurrence counts', () => {
  const source = 'FineWeb is a 15-trillion token dataset derived from 96 Common Crawl snapshots.'
  for (const value of ['15T', '15 万亿', '15000000000000']) {
    assert.doesNotThrow(() => assertTranslationFidelity(source, `FineWeb 包含 ${value} token，来自 96 个 Common Crawl 快照。`))
  }
  assert.doesNotThrow(() => assertTranslationFidelity('FineWeb-Edu is a 1.3-trillion token collection.', 'FineWeb-Edu 包含 1.3 万亿 token。'))
  assert.doesNotThrow(() => assertTranslationFidelity('A 15-trillion-token dataset from 96 snapshots.', '包含15T token的数据集来自96个快照。'))
  for (const value of ['14T', '15 亿', '15', '-15T']) {
    assert.throws(() => assertTranslationFidelity(source, `FineWeb 包含 ${value} token，来自 96 个 Common Crawl 快照。`), /Numeric value/)
  }
  assert.throws(() => assertTranslationFidelity(source, 'FineWeb 包含15T token，来自Common Crawl快照。'), /Numeric value omitted or changed: 96/)
  assert.throws(() => assertTranslationFidelity(source, 'FineWeb 包含15T token，来自95个Common Crawl快照。'), /Numeric value omitted or changed: 96/)
  assert.throws(() => assertTranslationFidelity(source, 'FineWeb 包含15T token，来自96个Common Crawl快照，另有15T token。'), /Numeric values added/)
  assert.doesNotThrow(() => assertTranslationFidelity('Two 15-trillion token datasets.', '两个15T token数据集。'))
  assert.throws(() => assertTranslationFidelity('15-trillion token datasets and another 15-trillion token dataset.', '15T token数据集与另一个数据集。'), /Numeric value/)
})

test('shared-year month ranges preserve both ordered endpoints without licensing different dates or scores', () => {
  const source = 'We add Wikipedia dumps from the June-August 2022 period, covering 20 languages.'
  for (const interval of ['2022 年 6 月至 8 月', '2022年6月到8月', '2022年6月至2022年8月']) {
    assert.doesNotThrow(() => assertTranslationFidelity(source, `我们添加${interval}期间的维基百科转储，涵盖20种语言。`))
  }
  for (const interval of ['June–August 2022', 'Jun.-Aug. 2022', 'June 2022 to August 2022', 'June through August 2022']) {
    assert.doesNotThrow(() => assertTranslationFidelity(interval, '2022年6月至8月'))
  }
  for (const interval of ['2022年6月至9月', '2022年7月至8月', '2021年6月至8月', '2022年6月至2023年8月', '2022年8月', '2022年6月', '2022年8月至6月', '6月至8月', '2022年6月至8月19日']) {
    assert.throws(() => assertTranslationFidelity(source, `我们添加${interval}期间的维基百科转储，涵盖20种语言。`), /Calendar date/)
  }
  assert.throws(() => assertTranslationFidelity(source, '我们添加2022年6月至8月期间的维基百科转储，涵盖19种语言。'), /Numeric value omitted or changed: 20/)
  assert.throws(() => assertTranslationFidelity(source, '我们添加2022年6月至8月期间的维基百科转储，涵盖20种语言，得分99。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity(source, '我们添加2022年6月至8月、2022年6月至8月期间的维基百科转储，涵盖20种语言。'), /Calendar dates added/)
  assert.throws(() => assertTranslationFidelity('June 2022 and August 2022.', '2022年6月至8月。'), /Calendar date/)
})

test('explicit between month intervals retain ordered endpoints across years', () => {
  const source = 'Data collected between August 2024 and January 2025 includes 20 languages.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '2024年8月至2025年1月收集的数据包含20种语言。'))
  for (const interval of ['2024年7月至2025年1月', '2024年8月至2025年2月', '2025年1月至2024年8月', '2024年8月', '2025年1月']) {
    assert.throws(() => assertTranslationFidelity(source, `${interval}收集的数据包含20种语言。`), /Calendar date/)
  }
  assert.throws(() => assertTranslationFidelity(source, '2024年8月至2025年1月收集的数据包含19种语言。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity(source, '2024年8月至2025年1月收集的数据包含20种语言，得分99。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('August 2024 and January 2025.', '2024年8月至2025年1月。'), /Calendar date/)
})

test('space-separated pretraining sizes may precede or follow the protected version without changing values', () => {
  const source = 'Our 8B and 70B Llama 3 variants outperform others.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '我们的 Llama 3 8B 和70B变体优于其他模型。'))
  assert.doesNotThrow(() => assertTranslationFidelity('OLMo 2  7B improves by 10.6 points.', 'OLMo 2 7B 提升了10.6分。'))
  assert.throws(() => assertTranslationFidelity(source, '我们的 Llama 3 8B 和72B变体优于其他模型。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity(source, '我们的 Llama 4 8B 和70B变体优于其他模型。'), /identifier/)
  assert.throws(() => assertTranslationFidelity('Llama-3-8B scores 66%.', 'Llama-3-70B 得分66%。'), /identifier/)
})

test('explicit Stage and Phase references retain quantities across translated tables and shared labels', () => {
  const source = 'Stage 1 scores 5. Phase 3 scores 8. Cooldown (Phase 4 and 5).'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '阶段1得分5。阶段3得分8。冷却（Phase 4 和 Phase 5）。'))
  assert.doesNotThrow(() => assertTranslationFidelity(source, '第一阶段得分5。第三阶段得分8。冷却（第四阶段和第五阶段）。'))
  assert.throws(() => assertTranslationFidelity(source, '阶段5得分1。阶段3得分8。冷却（Phase 4 和 Phase 5）。'), /Stage reference/)
  assert.throws(() => assertTranslationFidelity(source, '阶段1得分5。阶段3得分8。冷却（Phase 4 和 Phase 6）。'), /Stage reference/)
  assert.throws(() => assertTranslationFidelity('Stage 2 has 5 layers.', '阶段5有2层。'), /Stage reference/)
})

test('a score following a shared Stage list cannot become an invented fractional stage', () => {
  const source = 'The value is 0.9 for stage 1 and 2, and 0.0 for stage 3.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '阶段1和阶段2的值为0.9，阶段3的值为0.0。'))
  assert.throws(() => assertTranslationFidelity(source, '阶段1和阶段2的值为0.9，阶段0的值为0.0。'), /Stage reference/)
  assert.throws(() => assertTranslationFidelity(source, '阶段1和阶段2的值为0.9，阶段3的值为0.1。'), /Numeric value/)
})

test('source listings are preserved and marker context has exact node boundaries and formulas', () => {
  const html = '<article class="ltx_document"><h1 class="ltx_title_document">Code example</h1><section id="S1"><h2>Code</h2><pre>model.generate(x)</pre><p>Even with <math alttext="k=n"><mi>k</mi><mo>=</mo><mi>n</mi></math> the score improves.</p></section></article>'
  const paper = parsePaper(html, { id: 'code', arxivId: '2505.09388v1' })
  assert.match(paper.blocks[1].en, /model.generate/)
  assert.equal(translationUnits(paper.blocks[1].en).units.length, 0)
  const context = translationUnits(paper.blocks[2].en).context('block')
  assert.match(context, /⟦block:0⟧Even with ⟦\/block:0⟧⟪FORMULA:k=n⟫⟦block:1⟧/)
})

test('LaTeXML listing divs preserve complete JSON, control syntax and math while figure captions translate', () => {
  const html = sanitizeHtml('<figure class="ltx_float ltx_lstlisting"><figcaption><span>Listing 1: </span>Prompt for a tool call.</figcaption><div id="LST1.2" class="ltx_listing ltx_lstlisting"><div class="ltx_listingline">  {"tool":"call", "args":{"x":3}}</div><div class="ltx_listingline">&lt;think&gt; literal reasoning &lt;/think&gt;</div><div class="ltx_listingline"><math alttext="x=3"><mi>x</mi><mo>=</mo><mn>3</mn><annotation>x=3</annotation></math><code>model.generate(x)</code></div></div></figure>')
  const prepared = translationUnits(html, 'figure')
  assert.deepEqual(prepared.units.map(unit => unit.text), ['Listing 1: ', 'Prompt for a tool call.'])
  const context = prepared.context('listing')
  assert.match(context, /⟦listing:1⟧Prompt for a tool call\./)
  assert.equal((context.match(/⟪CODE_PRESERVED⟫/g) || []).length, 1)
  assert.doesNotMatch(context, /literal reasoning|model\.generate|"args"/)
  const translated = prepared.render(['代码清单1：', '工具调用提示。'])
  const english = load(html, {}, false), chinese = load(translated, {}, false)
  assert.equal(chinese.html('.ltx_listing.ltx_lstlisting'), english.html('.ltx_listing.ltx_lstlisting'))
  assert.equal(chinese('figcaption').text(), '代码清单1：工具调用提示。')
  assert.doesNotMatch(visibleProseText(english), /literal reasoning|model\.generate|"args"/)
  assert.doesNotThrow(() => assertTranslationFidelity(visibleProseText(english), visibleProseText(chinese)))
})

test('inline LaTeXML listings stay literal without freezing framed algorithm narrative', () => {
  const html = sanitizeHtml('<p>Use this template: <span id="tools" class="ltx_listing ltx_lstlisting"><span class="ltx_listingline">  {"type":"function","name":"get_weather"}</span><span class="ltx_listingline">&lt;|im_start|&gt;assistant &lt;think&gt;</span><span class="ltx_listingline"><math alttext="y_1"><msub><mi>y</mi><mn>1</mn></msub></math><code>return tool(x)</code></span></span> Then call the tool.</p>')
  const prepared = translationUnits(html)
  assert.deepEqual(prepared.units.map(unit => unit.text), ['Use this template: ', ' Then call the tool.'])
  assert.equal((prepared.context('inline').match(/⟪CODE_PRESERVED⟫/g) || []).length, 1)
  const translated = prepared.render(['使用以下模板：', '然后调用工具。'])
  const english = load(html, {}, false), chinese = load(translated, {}, false)
  assert.equal(chinese.html('.ltx_listing.ltx_lstlisting'), english.html('.ltx_listing.ltx_lstlisting'))
  assert.equal(chinese('span.ltx_listingline').length, 3)
  assert.doesNotThrow(() => assertTranslationFidelity(visibleProseText(english), visibleProseText(chinese)))
  const algorithm = '<figure><figcaption>Algorithm 1</figcaption><div class="ltx_listing ltx_framed"><span>Return the selected indices </span><math alttext="I"><mi>I</mi></math></div></figure>'
  const algorithmUnits = translationUnits(algorithm, 'figure')
  assert.deepEqual(algorithmUnits.units.map(unit => unit.text), ['Algorithm 1', 'Return the selected indices '])
  assert.match(visibleProseText(load(algorithm, {}, false)), /Return the selected indices/)
  assert.match(algorithmUnits.render(['算法1', '返回选中的索引']), /返回选中的索引/)
})

test('whole XTML syntax and explicit typewriter fields stay literal while captions and prose translate', () => {
  const html = '<figure><span>[open]think[sep]</span><span class="ltx_font_typewriter">[open]message role="assistant"[sep]</span><span class="ltx_font_typewriter">[open]call tool="python" index="1"[sep]</span><span class="ltx_font_typewriter">{"timeout": 150}</span><figcaption>Use the <span class="ltx_font_typewriter">think</span> channel and the <span class="ltx_font_typewriter">messages</span> field.</figcaption><p>Set <span class="ltx_font_typewriter">type="tool-declare"</span> before input.</p></figure>'
  const prepared = translationUnits(html, 'figure')
  assert.deepEqual(prepared.units.map(unit => unit.text), ['Use the ', ' channel and the ', ' field.', 'Set ', ' before input.'])
  assert.equal((prepared.context('xtml').match(/⟪CODE_PRESERVED⟫/g) || []).length, 7)
  const translated = prepared.render(['使用', '通道和', '字段。', '在输入前设置', '。'])
  const english = load(html, {}, false), chinese = load(translated, {}, false)
  assert.deepEqual(scientificSignature(chinese), scientificSignature(english))
  assert.equal(chinese('figcaption').text(), '使用think通道和messages字段。')
  assert.doesNotMatch(visibleProseText(english), /\[open\]|messages|type=/)
  for (const replacement of [translated.replace('>messages<', '>消息<'), translated.replace('role="assistant"', 'role="user"'), translated.replace('>think<', '>response<'), translated.replace('"timeout"', '"超时"')]) {
    assert.notDeepEqual(scientificSignature(load(replacement, {}, false)), scientificSignature(english))
  }
  const example = load('<span class="ltx_font_typewriter">[open]tag attr="value"[sep] … [close]tag[sep]</span>', {}, false)
  assert.equal(isLiteralChatTemplateNode(example('span')[0]), true)
  const array = load('<span class="ltx_font_typewriter">[{"timeout": 150}]</span>', {}, false)
  assert.equal(isLiteralChatTemplateNode(array('span')[0]), true)
})

test('XTML protection does not freeze ordinary typewriter labels or prose surrounding token examples', () => {
  const html = '<p><span class="ltx_font_typewriter">ordinary narrative</span> <span class="ltx_font_typewriter">tools improve results</span> <span class="ltx_font_typewriter">indexing</span> <span>Use [open]think[sep] for thinking.</span> <span>response</span> <span class="ltx_font_typewriter">{"timeout": tomorrow}</span></p>'
  const prepared = translationUnits(html)
  assert.deepEqual(prepared.units.map(unit => unit.text), ['ordinary narrative', 'tools improve results', 'indexing', 'Use [open]think[sep] for thinking.', 'response', '{"timeout": tomorrow}'])
  assert.deepEqual(scientificSignature(load(html, {}, false)), [])
  assert.match(visibleProseText(load(html, {}, false)), /ordinary narrative/)
  assert.doesNotMatch(prepared.context('prose'), /CODE_PRESERVED/)
  assert.match(prepared.render(['普通叙述', '工具提高结果', '索引过程', '使用 [open]think[sep] 开启思考。', '回答', '{"timeout": 明天}']), /普通叙述/)
})

test('complete fenced SQL spans preserve syntax and numbers while prompts, explanations and captions translate', () => {
  for (const code of ['```sql\nSELECT *\nFROM table1\nLIMIT 10;\n```', '~~~sql\nSELECT code FROM table1 LIMIT 10;\n~~~', '````\nSELECT code FROM table1 LIMIT 10;\n`````', '“‘sql\nSELECT *\nFROM table1\nLIMIT 10;\n“‘']) {
    const html = `<figure><table><tbody><tr><td><p>Write a query for the top 10 rows.</p><span id="query" class="ltx_text">${code}</span><p>This query selects rows from table1.</p></td></tr></tbody></table><figcaption>Table 25: SQL evaluation example.</figcaption></figure>`
    const prepared = translationUnits(html, 'table')
    assert.deepEqual(prepared.units.map(unit => unit.text), ['Write a query for the top 10 rows.', 'This query selects rows from table1.', 'Table 25: SQL evaluation example.'])
    assert.equal((prepared.context('sql').match(/⟪CODE_PRESERVED⟫/g) || []).length, 1)
    assert.doesNotMatch(prepared.context('sql'), /SELECT|LIMIT/)
    const translated = prepared.render(['编写查询获取前 10 行。', '此查询从 table1 中选择行。', '表 25：SQL 评估示例。'])
    const english = load(html, {}, false), chinese = load(translated, {}, false)
    assert.equal(chinese('#query').text(), code)
    assert.deepEqual(scientificSignature(chinese), scientificSignature(english))
    assert.notDeepEqual(scientificSignature(load(translated.replace('LIMIT 10', 'LIMIT 11'), {}, false)), scientificSignature(english))
    assert.notDeepEqual(scientificSignature(load(translated.replace('FROM table1', 'FROM table2'), {}, false)), scientificSignature(english))
    assert.doesNotMatch(visibleProseText(english), /SELECT|LIMIT/)
    assert.match(visibleProseText(chinese), /此查询从 table1/)
    assert.doesNotThrow(() => assertTranslationFidelity(visibleProseText(english), visibleProseText(chinese)))
  }
})

test('fenced-code protection excludes ordinary quoted SQL prose, partial fences and mixed narrative spans', () => {
  const examples = ['“SQL selects the top 10 rows.”', '“‘sql\nSELECT *', '“‘sql\nSELECT *\n”’', '“‘\nSELECT *\n“‘', '```sql\nSELECT *\n~~~', '````sql\nSELECT *\n```', 'Explain this:\n```sql\nSELECT *\n```', '```sql\nSELECT *\n```\nThen explain the query.\n```sql\nSELECT *\n```']
  for (const text of examples) {
    const html = `<span class="ltx_text">${text}</span>`, $ = load(html, {}, false)
    assert.equal(isLiteralFencedCodeNode($('span')[0]), false)
    assert.equal(translationUnits(html).units.length, 1)
    assert.deepEqual(scientificSignature($), [])
    assert.match(visibleProseText($), /SQL|SELECT/)
    assert.doesNotMatch(translationUnits(html).context('prose'), /CODE_PRESERVED/)
  }
  const nested = load('<span>```sql\nSELECT <em>code</em>\n```</span>', {}, false)
  assert.equal(isLiteralFencedCodeNode(nested('span')[0]), false)
})

test('generated context markers cannot leak or multiply while authentic literal source markers remain exact', () => {
  for (const marker of ['⟪FORMULA:\\times⟫', '⟪CODE_PRESERVED⟫', '⟦block-242:0⟧', '⟦/block-242:0⟧']) {
    assert.throws(() => assertTranslationFidelity('The speedup is shown here.', `加速比为${marker}。`), /Generated context marker leaked/)
    assert.doesNotThrow(() => assertTranslationFidelity(`The literal marker is ${marker}.`, `字面标记为${marker}。`))
    assert.throws(() => assertTranslationFidelity(`The literal marker is ${marker}.`, '字面标记在这里。'), /Literal source context marker omitted/)
    assert.throws(() => assertTranslationFidelity(`The literal marker is ${marker}.`, `字面标记为${marker}和${marker}。`), /Generated context marker leaked/)
  }
  assert.throws(() => assertTranslationFidelity('The literal marker is ⟪FORMULA:x⟫.', '字面标记为⟪FORMULA:y⟫。'), /Literal source context marker omitted/)
  assert.doesNotThrow(() => assertTranslationFidelity('The literal pair is ⟦block-242:0⟧text⟦/block-242:0⟧.', '字面标记对为⟦block-242:0⟧文本⟦/block-242:0⟧。'))
})

test('catalog checkpoint updates preserve the position of every existing paper', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-catalog-'))
  try {
    await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ schemaVersion: 1, papers: [{ id: 'first' }, { id: 'middle' }, { id: 'last' }] }))
    const paper = { id: 'middle', arxivId: '1706.03762v7', title: 'Updated', authors: [], tags: [], source: {}, translation: { status: 'pending' }, blocks: [], sections: [] }
    await updateCatalog(directory, paper)
    const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json')))
    assert.deepEqual(catalog.papers.map(item => item.id), ['first', 'middle', 'last'])
    assert.equal(catalog.papers[1].title, 'Updated')
    await updateCatalog(directory, { ...paper, id: 'new' })
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'catalog.json'))).papers.map(item => item.id), ['first', 'middle', 'last', 'new'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('fidelity accepts context-size k units but rejects invented numbers and identifiers', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('The context length is 32k tokens.', '上下文长度为 32K 个 token。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Wang et al., 2024k', 'Wang 等人，2024k'))
  assert.doesNotThrow(() => assertTranslationFidelity('Eight GPUs.', '8 块 GPU。'))
  assert.throws(() => assertTranslationFidelity('Eight GPUs.', '8 块 GPU，以及999个额外参数。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('1 million parameters', '1000000 个参数，得分99.9%。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('The model is efficient.', 'Qwen9.9-999B 模型很高效。'), /Technical identifiers added/)
})

test('oversized source lists are split by both character count and record count before requests', async () => {
  const records = Array.from({ length: 367 }, (_, index) => ({ id: String(index), text: 'a'.repeat(90) }))
  const requests = []
  const results = await translateWithSplitting(records, async chunk => {
    requests.push(chunk)
    assert.ok(chunk.length <= 80)
    assert.ok(chunk.reduce((sum, record) => sum + record.text.length, 0) <= 6000)
    return chunk.map(record => ({ id: record.id, text: '译文' }))
  })
  assert.deepEqual(results.map(result => result.id), records.map(record => record.id))
  assert.equal(requests.length, 6)
})

test('literal source reasoning delimiters inside JSON are preserved rather than stripped', () => {
  const records = [{ id: 'a', text: '<think>' }, { id: 'b', text: 'Think carefully.' }, { id: 'c', text: '</think>' }]
  const json = JSON.stringify({ translations: { a: '<think>', b: '仔细思考。', c: '</think>' } })
  assert.deepEqual(parseUnitResponse(json, records).map(record => record.text), ['<think>', '仔细思考。', '</think>'])
  assert.deepEqual(parseUnitResponse('<think>Internal reasoning.</think>\n' + json, records).map(record => record.text), ['<think>', '仔细思考。', '</think>'])
  assert.equal(translationUnits('<p>&lt;think&gt;</p>').units.length, 0)
  assert.equal(translationUnits('<p>&lt;/think&gt;</p>').units.length, 0)
  assert.throws(() => assertTranslationFidelity('<think>Example reasoning.</think>', '思考：示例推理。'), /Literal source delimiter/)
})

test('validated response units remain separate from rejected comparison fragments', () => {
  const records = [{ id: 'a', text: 'A reliable model.' }, { id: 'b', text: 'Qwen2-72B outperforms Llama-3-70B in general ' }]
  const json = JSON.stringify({ translations: { a: '可靠的模型。', b: 'Qwen2-72B 在通用 ' } })
  const checked = parseUnitResponse(json, records, { collectFailures: true })
  assert.deepEqual(checked.results.map(result => result.id), ['a'])
  assert.deepEqual(checked.failures.map(failure => failure.record.id), ['b'])
  assert.match(checked.failures[0].error, /Llama-3-70B/)
  assert.throws(() => parseUnitResponse(json, records), /Llama-3-70B/)
})

test('context budget stays bounded and follows the requested unit in large source lists', () => {
  const records = Array.from({ length: 10 }, (_, index) => ({ id: `block-${index}:300`, block: `block-${index}`, text: 'Exact source text.' }))
  const contexts = records.map(record => ({ block: record.block, context: 'earlier '.repeat(1000) + `⟦${record.id}⟧${record.text}⟦/${record.id}⟧` + ' later'.repeat(1000) }))
  const compact = compactRequestContexts(contexts, records)
  assert.ok(compact.reduce((sum, item) => sum + item.context.length, 0) <= 4000)
  compact.forEach((item, index) => assert.ok(item.context.includes(`⟦${records[index].id}⟧`)))
  assert.deepEqual(records.map(record => record.text), Array(10).fill('Exact source text.'))
})

test('explicit multiplier ranges preserve positive endpoints and true mathematical negatives', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('These optimizations yield a 3×–5× end-to-end speedup.', '这些优化带来了3至5倍的端到端加速。'))
  assert.throws(() => assertTranslationFidelity('The offset is −5.', '偏移量为5。'), /Numeric value/)
  assert.doesNotThrow(() => assertTranslationFidelity('The offset is −5.', '偏移量为-5。'))
})

test('known annotation and section-pointer omissions cannot be accepted again', () => {
  assert.throws(() => assertTranslationFidelity('synthesize artificially annotated data', '合成人工标注数据'), /annotation/)
  assert.doesNotThrow(() => assertTranslationFidelity('synthesize artificially annotated data', '合成机器标注数据'))
  assert.throws(() => assertTranslationFidelity('Detailed KV head configurations for various model sizes are reported in Section ', '各种模型规模的详细 KV 头配置在第'), /Section reporting/)
  assert.doesNotThrow(() => assertTranslationFidelity('Detailed KV head configurations for various model sizes are reported in Section ', '各种模型规模的详细 KV 头配置详见章节 '))
})

test('offline Android Control evaluation retains its benchmark inside the same citation-delimited fragment', () => {
  const source = '. Offline evaluations are conducted on Android Control '
  assert.deepEqual(technicalIdentifiers(source), ['Android Control'])
  assert.throws(() => assertTranslationFidelity(source, '进行离线评估，'), /Android Control/)
  assert.throws(() => assertTranslationFidelity(source, '。离线评估在 android control 上进行'), /Android Control/)
  assert.doesNotThrow(() => assertTranslationFidelity(source, '。离线评估在 Android Control 上进行 '))
  const prepared = translationUnits('<p>ScreenSpot Pro <cite>Li et al., 2025a</cite>. Offline evaluations are conducted on Android Control <cite>Li et al., 2024f</cite>, while online evaluations are performed on AndroidWorld.</p>')
  const records = prepared.units.map((unit, index) => ({ id: 'block:' + index, text: unit.text }))
  const response = { translations: Object.fromEntries(records.map(record => [record.id, record.text === source ? '进行离线评估，' : record.text])) }
  assert.throws(() => parseUnitResponse(JSON.stringify(response), records), /Android Control/)
  // Neither an intact following citation nor an identifier in a neighbor can
  // repair the missing benchmark from this exact source text unit.
  response.translations['block:0'] = 'ScreenSpot Pro 和 Android Control '
  assert.throws(() => parseUnitResponse(JSON.stringify(response), records), /Technical identifiers added|Android Control/)
})

test('a scale word after a hierarchical section number cannot multiply its last component', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('5.2.4 Scaling RL for Million-Token Context', '5.2.4 百万Token上下文扩展RL框架'))
  assert.doesNotThrow(() => assertTranslationFidelity('3.4.2 Memory-efficient implementation', '3.4.2 内存高效的实现'))
  assert.doesNotThrow(() => assertTranslationFidelity('5.2.4 A model with 4 million tokens.', '5.2.4 一个拥有400万个token的模型。'))
  assert.throws(() => assertTranslationFidelity('5.2.4 A model with 4 million tokens.', '5.2.4 一个拥有40万个token的模型。'), /Numeric value/)
})

test('visible prose keeps nested section numbers and stage references in document order', () => {
  const english = load('<h4><span>3.2.1 </span>Training Details of the First RL Stage</h4>', {}, false)
  const chinese = load('<h4><span>3.2.1 </span>第一阶段 RL 的训练细节</h4>', {}, false)
  assert.doesNotThrow(() => assertTranslationFidelity(visibleProseText(english), visibleProseText(chinese)))
  assert.equal(visibleProseText(english).trim(), '3.2.1  Training Details of the First RL Stage')
  const markup = 'Root<p>Before <a href="#stage">Stage <span>2</span></a> after<math><mn>99</mn></math><code>98</code><pre>97</pre><sup>1</sup> end.</p>'
  const $ = load(markup, {}, false)
  assert.equal(visibleProseText($), 'Root Before  Stage  2  after 1  end.')
  assert.equal($.html(), load(markup, {}, false).html(), 'prose extraction must not alter the preserved scientific DOM')
  assert.throws(() => assertTranslationFidelity(visibleProseText(load('<p>Stage <span>2</span> scores 8.</p>', {}, false)), '第一阶段得分8。'), /Stage reference/)
})

test('3rd-party has its own exact lexical occurrences without relaxing other numbers', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('Support 3rd-party frameworks.', '支持第三方框架。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Support 3rd party frameworks.', '支持第三方框架。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Support 3rd-party frameworks.', '支持 third-party 框架。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Support 3rd-party frameworks and 3 tools.', '支持第三方框架和3个工具。'))
  assert.throws(() => assertTranslationFidelity('Support 3rd-party frameworks.', '支持第四方框架。'), /Third-party/)
  assert.throws(() => assertTranslationFidelity('Support 3rd-party frameworks.', '支持框架，数量为3。'), /Third-party/)
  assert.throws(() => assertTranslationFidelity('Support 3rd-party frameworks.', '支持第三方框架和第三方工具。'), /Third-party/)
  assert.throws(() => assertTranslationFidelity('Support 3rd-party frameworks and 3 tools.', '支持第三方框架和工具。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('Support 3rd-party frameworks and 3 tools.', '支持第三方框架和4个工具。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('The 3rd GPU handles 8 tokens.', '第三个GPU处理8个token。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('The Prototype-3rd-party module.', 'Prototype-third-party 模块。'), /Numeric value/)
})

test('explicit Stage labels accept matching Chinese ordinals only with their exact multiplicities', () => {
  const source = 'The Stage 2 model samples Stage 1 queries using the Stage 2 model itself.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '第二阶段模型使用第二阶段模型本身对第一阶段查询采样。'))
  assert.doesNotThrow(() => assertTranslationFidelity(source, '阶段 2 模型使用第2阶段模型本身对阶段 1 查询采样。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Stage 10 scores 91.2%. Stage 21 improves it.', '第十阶段得分91.2%。第二十一阶段提升了它。'))
  assert.throws(() => assertTranslationFidelity(source, '第二阶段模型对第一阶段查询采样。'), /Stage reference omitted/)
  assert.throws(() => assertTranslationFidelity(source, '第三阶段模型使用第二阶段模型本身对第一阶段查询采样。'), /Stage reference added or changed/)
  assert.throws(() => assertTranslationFidelity(source, '第二阶段模型使用第二阶段模型本身对第一阶段查询采样。第四阶段结束。'), /Stage reference added or changed/)
  assert.throws(() => assertTranslationFidelity(source, '第二阶段模型使用第二阶段模型本身对第一阶段查询采样，得分99.9%。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('Stage 2 has 2 layers.', '第二阶段有第二阶段层。'), /Stage reference added or changed/)
  assert.throws(() => assertTranslationFidelity('The model has 2 layers.', '模型有第二阶段层。'), /Numeric value omitted/)
  assert.throws(() => assertTranslationFidelity('Stage 2 scores 1 point.', '第一阶段得分2。'), /Stage reference added or changed/)
})

test('bibliography month dates preserve their exact disambiguation suffix across Chinese date order', () => {
  const source = 'Athene-70b: Redefining the boundaries of post-training for open models, July 2024a.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, 'Athene-70b：重新定义开放模型的后训练边界，2024年7月a。'))
  assert.doesNotThrow(() => assertTranslationFidelity(source, 'Athene-70b：重新定义开放模型的后训练边界，2024a 年 7 月。'))
  for (const date of ['2024年7月b', '2024年7月', '2024a年8月', '2025a年7月']) assert.throws(() => assertTranslationFidelity(source, 'Athene-70b：模型，' + date), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(source, 'Athene-70b：模型，2024a年7月，得分3。'), /Numeric values added/)
})

test('Gemini 2.5 Table 1 consecutive cutoff cells preserve all six complete year/month dates', () => {
  // Actual 2507.06261v6 S1.T1 values and split model headers. Preserve the
  // visibleProseText flattening used by strict public-release validation.
  const headers = [['Flash', 'Gemini 1.5'], ['Pro', 'Gemini 1.5'], ['Flash-Lite', 'Gemini 2.0'], ['Flash', 'Gemini 2.0'], ['Flash', 'Gemini 2.5'], ['Pro', 'Gemini 2.5']]
  const cells = ['November 2023', 'November 2023', 'June 2024', 'June 2024', 'January 2025', 'January 2025']
  const table = dates => `<figure id="S1.T1"><table><tbody><tr><th></th>${headers.map(([tier, version]) => `<th><span>${tier}</span><br><span>${version}</span></th>`).join('')}</tr><tr><td>Input length</td>${['1M', '2M', '1M', '1M', '1M', '1M'].map(value => `<td>${value}</td>`).join('')}</tr><tr><td>Knowledge cutoff</td>${dates.map(value => `<td>${value}</td>\n`).join('')}</tr></tbody></table></figure>`
  const en = table(cells), zh = table(['2023年11月', '2023年11月', '2024年6月', '2024年6月', '2025年1月', '2025年1月']).replace('Input length', '输入长度').replace('Knowledge cutoff', '知识截止时间')
  const prose = html => visibleProseText(load(html, {}, false))
  assert.doesNotThrow(() => assertTranslationFidelity(prose(en), prose(zh)))
  assert.throws(() => assertTranslationFidelity(prose(en), prose(zh.replace('2023年11月', '2023年12月'))), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(prose(en), prose(zh.replace('2024年6月', '2024年7月'))), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(prose(en), prose(zh.replace('2023年11月', ''))), /Calendar date omitted/)
  assert.throws(() => assertTranslationFidelity(prose(en), prose(zh.replace('2023年11月', '2023年11月 2023年11月'))), /Calendar dates added/)
  assert.throws(() => assertTranslationFidelity(prose(en), prose(zh.replace('2023年11月', '2023年11月15日'))), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(prose(en), prose(zh.replace('1M', '99M'))), /Numeric value/)
})

test('complete Chinese year/month dates do not absorb subsequent quantities or bibliography years', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('The cutoff is November 2023, with 15 layers.', '截止于2023年11月，有15层。'))
  assert.throws(() => assertTranslationFidelity('The cutoff is November 2023, with 15 layers.', '截止于2023年11月，有14层。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('The cutoff is November 2023, with 15 layers.', '截止于2023年11月15日。'), /Calendar date/)
  assert.doesNotThrow(() => assertTranslationFidelity('July 2024a August 2024b', '2024a年7月 2024b年8月'))
  assert.throws(() => assertTranslationFidelity('July 2024a August 2024b', '2024a年7月 2024b年9月'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity('July 2024a August 2024b', '2024a年7月 2024b年8月 99'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('February 28, 2025.', '2025年2月29日。'), /Calendar date/)
})

test('one extra per row permits only its corresponding Chinese single-column quantity', () => {
  const source = 'Row 1. 1(y). If 1 extra per row, then index 12 is correct.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '第1行。1(y)。如果每行多出一列，那么索引12是正确的。'))
  assert.throws(() => assertTranslationFidelity(source, '第1行。1(y)。如果每行多出两列，那么索引12是正确的。'), /Numeric value omitted/)
  assert.throws(() => assertTranslationFidelity(source, '第1行。1(y)。如果每行多出一列，那么索引12是正确的，得分99。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity(source, '第1行。如果每行多出一列，那么索引12是正确的。每行多一列。'), /quantity added/)
  assert.throws(() => assertTranslationFidelity('Row 1. 1(y). If 2 extra per row, then index 12 is correct.', '第1行。1(y)。如果每行多出一列，那么索引12是正确的。'), /Numeric value omitted/)
})

test('long comma-separated benchmark language codes are preserved while ordinary short-word prose is translated', () => {
  const source = 'ar, az, be, bg, bn, de, el, es, et, eu, fa, fi, fr, he, hi, hr, hu, hy, id, it, ja, ka,'
  assert.equal(isTechnicalLabelOnly(source), true)
  assert.doesNotThrow(() => parseUnitResponse(JSON.stringify({ translations: { languages: source } }), [{ id: 'languages', text: source }]))
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { languages: source.replace('ar,', 'zh,') } }), [{ id: 'languages', text: source }]), /No Chinese/)
  assert.equal(isTechnicalLabelOnly('it, is, to, be, in, we, do'), false)
})

test('all evidenced MT-AIME language rows retain exact IETF tags including script subtags', () => {
  const rows = [
    'af, ar, bg, bn, ca, cs, cy, da, de, el, en, es, et, fa, fi, fr, gu, he, hi, hr, hu, id,',
    'it, ja, kn, ko, lt, lv, mk, ml, mr, ne, nl, no, pa, pl, pt, ro, ru, sk, sl, so, sq, sv,',
    'sw, ta, te, th, tl, tr, uk, ur, vi, zh-Hans, zh-Hant',
  ]
  for (const [index, text] of rows.entries()) {
    const id = `languages:${index}`
    assert.equal(isTechnicalLabelOnly(text), true)
    assert.doesNotThrow(() => parseUnitResponse(JSON.stringify({ translations: { [id]: text } }), [{ id, text }]))
  }
  assert.throws(() => assertTranslationFidelity(rows[2], rows[2].replace('zh-Hant', 'zh-Hans')), /language tags changed/)
  assert.throws(() => assertTranslationFidelity(rows[2], rows[2].replace('zh-Hant', '繁体中文')), /language tags changed/)
  assert.throws(() => assertTranslationFidelity(rows[2], `${rows[2]}, ca`), /language tags changed/)
  assert.equal(isTechnicalLabelOnly('Use en, es and fr for the multilingual evaluation.'), false)
  assert.equal(isTechnicalLabelOnly('af, ar, unknown'), false)
})

test('observed ISO language-script lists stay immutable while ordinary prose and unknown tags are not exempt', () => {
  const source = 'por_Latn, deu_Latn, tgk_Cyrl, ces_Latn, nob_Latn, dan_Latn, snd_Arab, spa_Latn,'
  assert.equal(isTechnicalLabelOnly(source), true)
  assert.doesNotThrow(() => parseUnitResponse(JSON.stringify({ translations: { codes: source } }), [{ id: 'codes', text: source }]))
  const prepared = translationUnits(`<p><span>${source}</span><span>The benchmark covers these languages.</span></p>`)
  assert.deepEqual(prepared.units.map(unit => unit.text), ['The benchmark covers these languages.'])
  assert.equal(load(prepared.render(['该基准覆盖这些语言。']), {}, false).text(), `${source}该基准覆盖这些语言。`)
  assert.throws(() => assertTranslationFidelity(source, source.replace('tgk_Cyrl', 'rus_Cyrl')), /language tags changed/)
  assert.throws(() => assertTranslationFidelity(source, source.replace('tgk_Cyrl, ', '')), /language tags changed/)
  assert.throws(() => assertTranslationFidelity(source, `${source} 中文说明`), /language tags changed/)
  assert.throws(() => assertTranslationFidelity('zho_Hans, mya_Mymr, zho_Hant', 'zho_Hans, mya_Mymr, zho_Hans'), /language tags changed/)
  assert.equal(isTechnicalLabelOnly('por_Latn, deu_Latn, foo_Barr'), false)
  const prose = 'We evaluate these multilingual benchmark labels: por_Latn, deu_Latn and tgk_Cyrl.'
  assert.equal(isTechnicalLabelOnly(prose), false)
  assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { prose } }), [{ id: 'prose', text: prose }]), /No Chinese/)
})

test('exact whole-node ChatML examples retain syntax and role labels while surrounding prose translates', () => {
  const prepared = translationUnits('<p><span>&lt;|im_start|&gt;user</span><span>&lt;|im_end|&gt;</span><span>&lt;|im_start|&gt;assistant</span><span>&lt;|im_end|&gt;</span><span>The model answers the user.</span></p>')
  assert.deepEqual(prepared.units.map(unit => unit.text), ['The model answers the user.'])
  const rendered = load(prepared.render(['模型回答用户。']), {}, false).text()
  assert.equal(rendered, '<|im_start|>user<|im_end|><|im_start|>assistant<|im_end|>模型回答用户。')
  assert.throws(() => assertTranslationFidelity('Use <|im_start|>user for the user role.', '对用户角色使用 <|im_start|>用户。'), /protocol role/)
  assert.throws(() => assertTranslationFidelity('Use <|im_start|>assistant for the assistant role.', '对助手角色使用 <|im_start|>user。'), /protocol role/)
  assert.throws(() => assertTranslationFidelity('End with <|im_end|>.', '以 </think> 结束。'), /delimiter/)
  assert.equal(translationUnits('<p>Explain &lt;|im_start|&gt;user to the reader.</p>').units.length, 1)
})

test('prose dashes cannot join a model identifier to neighboring words or quantities', () => {
  for (const dash of ['—', '–']) {
    assert.deepEqual(technicalIdentifiers(`Qwen2.5-VL${dash}without human annotation.`), ['Qwen2.5-VL'])
    assert.doesNotThrow(() => assertTranslationFidelity(`Qwen2.5-VL${dash}without any human annotation.`, 'Qwen2.5-VL，无需任何人工标注。'))
    assert.doesNotThrow(() => assertTranslationFidelity(`Qwen2.5-VL${dash}10 samples.`, 'Qwen2.5-VL，10 个样本。'))
    assert.throws(() => assertTranslationFidelity(`Qwen2.5-VL${dash}10 samples.`, 'Qwen2.5-VL，9 个样本。'), /Numeric value/)
  }
  assert.deepEqual(technicalIdentifiers('Qwen3-VL-235B-A22B'), ['Qwen3-VL-235B-A22B'])
  assert.throws(() => assertTranslationFidelity('Qwen2.5-VL-72B is efficient.', 'Qwen2.5-VL 模型很高效。'), /Technical identifier/)
  assert.throws(() => assertTranslationFidelity('Qwen3-VL-235B-A22B performs well.', 'Qwen3-VL-235B-A17B 表现良好。'), /Technical identifier/)
})

test('named months match only the same valid calendar date and never license invented digits', () => {
  const source = 'The scores were corrected on March 15, 2026.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '分数于2026年3月15日修正。'))
  assert.doesNotThrow(() => assertTranslationFidelity(source, '分数于2026/03/15修正。'))
  assert.throws(() => assertTranslationFidelity(source, '分数于2026年4月15日修正。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(source, '分数于2026年3月16日修正。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(source, '分数于2026年3月15日修正，得分为3。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity(source, '分数于2026年15日修正，得分为3。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity('The model has 2026 parameters and a score of 15.', '该模型有2026个参数，分数为15，于3月发布。'), /Numeric values added/)
  assert.throws(() => assertTranslationFidelity('The model has 2026 parameters and a score of 15.', '该模型于2026年3月15日发布。'), /Calendar dates added/)
  assert.doesNotThrow(() => assertTranslationFidelity('Released in February 2024.', '于2024年2月发布。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Updated on 29 February 2024.', '于2024年2月29日更新。'))
  assert.throws(() => assertTranslationFidelity('Updated on February 28, 2025.', '于2025年2月29日更新。'), /Calendar date/)
})

test('yearless month-day dates match exact valid dates without absorbing years or quantities', () => {
  const source = 'Updated on July 19.'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '于7月19日更新。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Updated on 19th July.', '于7 月 19 号更新。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Updated on Jul. 19.', '于07月19日更新。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Updated on February 29.', '于2月29日更新。'))
  assert.throws(() => assertTranslationFidelity(source, '于8月19日更新。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(source, '于7月18日更新。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity(source, '于13月19日更新。'), /Invalid calendar date/)
  assert.throws(() => assertTranslationFidelity('Updated on February 30.', '于2月30日更新。'), /Invalid calendar date/)
  assert.throws(() => assertTranslationFidelity(source, '于7月32日更新。'), /Invalid calendar date/)
  assert.throws(() => assertTranslationFidelity(source, '于7月19日及7月19日更新。'), /Calendar dates added/)
  assert.throws(() => assertTranslationFidelity('July 19 and July 19.', '7月19日。'), /Calendar date omitted/)
  assert.doesNotThrow(() => assertTranslationFidelity('July 19 and 19 July.', '7月19日和7月19日。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Updated on July 19, 2026.', '于2026-07-19更新。'))
  assert.doesNotThrow(() => assertTranslationFidelity('Updated on 2026-07-19 and July 19.', '于2026年7月19日及7月19日更新。'))
  assert.throws(() => assertTranslationFidelity(source, '于2026年7月19日更新。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity('Updated on July 19, 2026.', '于7月19日更新。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity('July 19 with 2026 parameters.', '2026年7月19日，具有参数。'), /Calendar date/)
  assert.throws(() => assertTranslationFidelity('July 19 with 2026 parameters.', '2026a年7月19日，具有参数。'), /Calendar date/)
  assert.doesNotThrow(() => assertTranslationFidelity('July 19 with 7 participants.', '7月19日有7位参与者。'))
  assert.throws(() => assertTranslationFidelity('July 19 with 7 participants.', '7月19日有参与者。'), /Numeric value omitted/)
  assert.throws(() => assertTranslationFidelity('Scores of 7 and 19.', '日期为7月19日。'), /Calendar dates added/)
  assert.throws(() => assertTranslationFidelity('July 19.4 points.', '7月19日得分4。'), /Calendar dates added/)
})

test('long technical-label fragments preserve programming languages while real English prose still fails', () => {
  const source = ' (0-shot) (Python, C++, JAVA, PHP, TypeScript, C#, Bash, JavaScript), MBPP-3shot '
  assert.equal(isTechnicalLabelOnly(source), true)
  assert.equal(isTechnicalLabelOnly('The following programming languages were used to train the model: Python, JavaScript, TypeScript and Bash.'), false)
  const records = [{ id: 'block-033:31', text: source }]
  const json = text => JSON.stringify({ translations: { 'block-033:31': text } })
  assert.equal(parseUnitResponse(json('（0-shot）（Python、C++、JAVA、PHP、TypeScript、C#、Bash、JavaScript），MBPP-3shot'), records).length, 1)
  assert.throws(() => parseUnitResponse(json(source.replace('Python', 'Ruby')), records), /No Chinese/)
  const prose = 'The following programming languages were used to train the model: Python, JavaScript, TypeScript and Bash.'
  assert.throws(() => parseUnitResponse(json(prose), [{ id: 'block-033:31', text: prose }]), /No Chinese/)
})

test('from-scratch ViT training retains the action, model identity and initialization condition', () => {
  const source = 'We trained a Vision Transformer (ViT) from scratch using DataComp '
  assert.throws(() => assertTranslationFidelity(source, '我们使用 DataComp '), /From-scratch/)
  assert.throws(() => assertTranslationFidelity(source, '我们使用 DataComp 训练了 Vision Transformer（ViT）'), /From-scratch/)
  assert.throws(() => assertTranslationFidelity(source, '我们使用 DataComp 从零训练了模型'), /From-scratch/)
  assert.doesNotThrow(() => assertTranslationFidelity(source, '我们使用 DataComp 从零训练了视觉 Transformer（ViT） '))
})

test('section fragments retain description predicates and attach to the following immutable link', () => {
  assert.throws(() => assertTranslationFidelity(', the details of which are fully described in ', '，其细节在 '), /description predicate/)
  assert.doesNotThrow(() => assertTranslationFidelity(', the details of which are fully described in ', '，其详细内容已完整介绍于 '))
  const source = 'We provide a more detailed introduction to the vision encoder in Section '
  assert.throws(() => assertTranslationFidelity(source, '我们在第 节中对视觉编码器进行了更详细的介绍。'), /Section pointer misplaced/)
  assert.doesNotThrow(() => assertTranslationFidelity(source, '我们提供了视觉编码器的更详细介绍，详见章节 '))
})

test('tens of trillions retains its order-of-magnitude multiplier', () => {
  const source = 'The model scales stably to tens of trillions of tokens.'
  assert.throws(() => assertTranslationFidelity(source, '该模型可稳定扩展至数万亿 token。'), /quantity multiplier/)
  assert.doesNotThrow(() => assertTranslationFidelity(source, '该模型可稳定扩展至数十万亿 token。'))
  assert.doesNotThrow(() => assertTranslationFidelity(source, '该模型可稳定扩展至数十T token。'))
})

test('only explicitly labelled contributor name lists remain original, while labels and footnotes translate', () => {
  const names = ' Shuai Bai, Keqin Chen, Xuejing Liu, Junyang Lin'
  const source = `<p><span class="ltx_font_bold">Core Contributors:</span>${names}</p>`
  const prepared = translationUnits(source)
  assert.deepEqual(prepared.units.map(unit => unit.text), ['Core Contributors:'])
  assert.equal(load(prepared.render(['核心贡献者：'])).text(), `核心贡献者：${names}`)
  const withNote = `<p><span>Contributors<span class="ltx_note"><span>Alphabetical order.</span></span>:</span>${names}</p>`
  const noted = translationUnits(withNote)
  assert.deepEqual(noted.units.map(unit => unit.text), ['Contributors', 'Alphabetical order.'])
  assert.match(noted.render(['贡献者', '按字母顺序排列。']), /Shuai Bai, Keqin Chen, Xuejing Liu, Junyang Lin/)
  assert.equal(translationUnits(`<p><span>Examples:</span>${names}</p>`).units.length, 2)
  assert.equal(translationUnits('<p><span>Contributors:</span> These researchers trained a model, evaluated the result, and wrote this paper.</p>').units.length, 2)
})

test('fixed InstructGPT code repair preserves all published Python literals and rejects source drift', () => {
  const fragments = [
  {
    "id": "A6.F45.3.2.1.1.2.1",
    "text": "import math"
  },
  {
    "id": "A6.F45.3.2.1.1.3.1",
    "text": "def prime_sieve(num: int) -> list[int]:\nif num <= 0:\nraise ValueError(f\"\"num: Invalid input, please enter a positive integer.\"\")"
  },
  {
    "id": "A6.F45.3.2.1.1.4.1",
    "text": "sieve = [True] * (num + 1)\nprime = []\nstart = 2\nend = int(math.sqrt(num))"
  },
  {
    "id": "A6.F45.3.2.1.1.5.1",
    "text": "while start <= end:\nif sieve[start] is True:\nprime.append(start)\nfor i in range(start * start, num + 1, start):\nif sieve[i] is True:\nsieve[i] = False\nstart += 1"
  },
  {
    "id": "A6.F45.3.2.1.1.6.1",
    "text": "for j in range(end + 1, num + 1):\nif sieve[j] is True:\nprime.append(j)"
  },
  {
    "id": "A6.F45.3.2.1.1.7.1",
    "text": "return prime"
  },
  {
    "id": "A6.F45.3.4.1.1.4.1",
    "text": "def prime_sieve(num: int) -> list[int]:"
  },
  {
    "id": "A6.F45.3.4.1.1.6.1",
    "text": "if num <= 0: raise ValueError(f\"\"num: Invalid input, please enter a positive integer.\")"
  },
  {
    "id": "A6.F45.3.4.1.1.8.1",
    "text": "sieve = [True] * (num + 1)"
  }
]
  const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  const source = '<article class="ltx_document"><h1 class="ltx_title_document">InstructGPT</h1><figure id="A6.F45">' + fragments.map(f => '<span id="' + f.id + '" class="ltx_text">' + escape(f.text) + '</span>').join('') + '<figcaption>Describe the code.</figcaption></figure></article>'
  const paper = parsePaper(source, { id:'instructgpt', arxivId:'2203.02155v1', htmlUrl:'https://arxiv.org/html/2203.02155v1' })
  const block = paper.blocks[0]
  const $ = load(block.en, {}, false)
  assert.deepEqual($('span.ltx_verbatim').map((_,n) => $(n).text()).get(), fragments.map(f => f.text))
  const units = translationUnits(block.en, block.kind)
  assert.deepEqual(units.units.map(u => u.text), ['Describe the code.'])
  assertBlockTranslationFidelity(block.en, units.render(['描述代码。']))
  assert.throws(() => parsePaper(source.replace('import math','import os'), { id:'instructgpt', arxivId:'2203.02155v1' }), /code source changed/)
  const later = parsePaper(source, { id:'instructgpt', arxivId:'2203.02155v2' })
  assert.doesNotMatch(later.blocks[0].en, /ltx_verbatim/)
})

test('short narrative fragments cannot pass as untranslated technical labels', () => {
  for (const source of ['The most common approach is to use an RNN such that', 'Breakdown of VTAB performance in ', 'Results are presented in Table', ', since we pre-train only for ']) {
    const records = [{ id: 'fragment', text: source }]
    assert.throws(() => parseUnitResponse(JSON.stringify({ translations: { fragment: source } }), records), /No Chinese translation/)
  }
  assert.doesNotThrow(() => parseUnitResponse('{"translations":{"fragment":"CBOW"}}', [{ id: 'fragment', text: 'CBOW' }]))
})

test('heading translation rejects untranslated labels and paragraph substitutions while keeping literal model names', () => {
  const parse = (source, target) => parseUnitResponse(JSON.stringify({ translations: { heading: target } }), [{ id: 'heading', text: source, kind: 'heading' }])
  assert.throws(() => parse('Abstract', 'Abstract'), /No Chinese heading/)
  assert.throws(() => parse('Supervised learning of policy networks', '随后我们训练强化学习策略网络。'), /Supervised learning/)
  assert.throws(() => parse('Results on public NLP datasets', '其次，公共 NLP 数据集很难获得多样性的输入。'), /Results concept/)
  assert.throws(() => parse('Results', '这是一段正文。'.repeat(20)), /Paragraph substituted/)
  assert.doesNotThrow(() => parse('Dropout', 'Dropout'))
  assert.doesNotThrow(() => parse('Abstract', '摘要'))
})

test('letter-prefixed appendix section numbers are displayed once without changing original identifiers', () => {
  const en = '<h3><span class="ltx_tag">A.2.3 </span>Model Size</h3>'
  const zh = '<h3><span class="ltx_tag">A.2.3 </span>A.2.3 模型规模</h3>'
  const normalized = normalizeHeadingNumber(en, zh)
  assert.equal((normalized.match(/A\.2\.3/g) || []).length, 1)
  assertBlockTranslationFidelity(en, normalized)
})

test('fixed supplementary title defects retain the complete body and versioned identity receipt', () => {
  const html = '<article class="ltx_document"><h1 class="ltx_title_document">Supplementary Material</h1><h2>1 Introduction</h2><p>Original main body.</p><h2>Appendix</h2><p>Original appendix.</p></article>'
  const paper = parsePaper(html, { id: 'td3', arxivId: '1802.09477v3', htmlUrl: 'https://arxiv.org/html/1802.09477v3' })
  assert.equal(paper.title, 'Addressing Function Approximation Error in Actor-Critic Methods')
  assert.equal(paper.blocks.length, 4)
  assert.equal(paper.source.repairs[0].originalTitle, 'Supplementary Material')
  assert.equal(parsePaper(html, { id: 'other', arxivId: '1802.09477v2' }).title, 'Supplementary Material')
})

test('relative arXiv images resolve inside the pinned document version', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-relative-asset-'))
  const previousFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async url => {
    requested.push(String(url))
    if (String(url).endsWith('/html/2501.00001v2')) return new Response('<div id="watermark-tr">arXiv:2501.00001v2</div><article class="ltx_document"><h1 class="ltx_title_document">Example</h1><figure><img src="figures/image.png"><figcaption>Caption.</figcaption></figure></article>', { headers: { 'content-type': 'text/html' } })
    assert.equal(String(url), 'https://arxiv.org/html/2501.00001v2/figures/image.png')
    return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  try {
    const paper = await importArxiv({ arxivId: '2501.00001v2', id: 'relative-example', dataDir: directory })
    assert.equal(paper.assets[0].sourceUrl, 'https://arxiv.org/html/2501.00001v2/figures/image.png')
    assert.equal(requested.length, 2)
  } finally { globalThis.fetch = previousFetch; await rm(directory, { recursive: true, force: true }) }
})

test('an empty fragment is isolated while valid peers remain reusable and never accepted as a completed translation', () => {
  const records = [{id:'a',text:'The first method.'},{id:'b',text:'The second method.'}]
  const response = '{"translations":{"a":"第一种方法。","b":""}}'
  const checked = parseUnitResponse(response, records, {collectFailures:true})
  assert.deepEqual(checked.results.map(x=>x.id), ['a'])
  assert.deepEqual(checked.failures.map(x=>x.record.id), ['b'])
  assert.throws(()=>parseUnitResponse(response,records), /Empty translation unit/)
})

test('a theorem author-year credit remains bibliographic while the proposition heading translates', () => {
  assert.equal(isTechnicalLabelOnly('(Sobel, 1982)'), true)
  assert.equal(isTechnicalLabelOnly('Proposition 1'), false)
  assert.equal(isTechnicalLabelOnly('(An explanation of our model, 1982)'), false)
})
test('RL identifiers and citation-only heading fragments preserve proper labels while descriptive text still requires translation', () => {
  for (const label of ['DreamerV2', 'dqn', 'SAC', 'Syed et\u00a0al. [29]']) assert.equal(isTechnicalLabelOnly(label), true)
  for (const label of ['Quantile Regression', 'Double Q-learning', 'World Models']) assert.equal(isTechnicalLabelOnly(label), false)
  assert.doesNotThrow(() => assertTranslationFidelity('This has the advantage of allowing us to train our C model.', '这样做的好处是可以训练我们的 C 模型。'))
})

test('relationship ages in paired bracketed gender labels are not million-scale model quantities', () => {
  const source = 'The girl [26 F] I [22 M] have been seeing was with a friend [30? M].'
  assert.doesNotThrow(() => assertTranslationFidelity(source, '女孩[26岁女性]、我[22岁男性]和一位朋友[30?岁男性]。'))
  assert.throws(() => assertTranslationFidelity(source, '女孩[26岁女性]、我[23岁男性]和一位朋友[30?岁男性]。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('We use [32M] parameters.', '我们使用[32]个参数。'), /Numeric value/)
  assert.throws(() => assertTranslationFidelity('We train [26 F] and [22 M] parameter models.', '我们训练[26 F]和[22]参数模型。'), /Numeric value/)
})


test('DPO retains observed degenerate model outputs verbatim while translating its table caption', () => {
  const outputs = [{"id":"A3.T3.2.2.2.1.1","text":"girl when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when whenUB when when when when whenUB when when when whenUB"},{"id":"A3.T3.2.3.2.1.1","text":"when an old woman was tripping the when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when when"}]
  const html = '<article class="ltx_document"><h1 class="ltx_title_document">Fixture</h1><figure class="ltx_table" id="A3.T3"><table><tbody>' + outputs.map(o => '<tr><td><span id="'+o.id+'">'+o.text+'</span></td></tr>').join('') + '</tbody></table><figcaption>Unlikelihood samples from prompts.</figcaption></figure></article>'
  const p = parsePaper(html,{id:'dpo',arxivId:'2305.18290v3',htmlUrl:'https://arxiv.org/html/2305.18290v3'})
  const $ = load(p.blocks[0].en,{},false)
  assert.deepEqual($('code').map((_,e)=>$(e).text()).get(),outputs.map(o=>o.text))
  assert.deepEqual(translationUnits(p.blocks[0].en,'table').units.map(u=>u.text),['Unlikelihood samples from prompts.'])
  assert.equal(p.source.repairs[0].method,'preserve-observed-verbatim-model-outputs')
  assert.throws(()=>parsePaper(html.replace('girl when','girl altered'),{id:'dpo',arxivId:'2305.18290v3',htmlUrl:'https://arxiv.org/html/2305.18290v3'}),/model-output source changed/)
})

test('DreamerV3 removes only the byte-identical duplicated source caption and retains its anchor once', () => {
  const caption = "<figcaption class=\"ltx_caption\"><span class=\"ltx_tag ltx_tag_table\"><span class=\"ltx_text\" id=\"Ax1.SSx1.4.7.1.1\" style=\"font-size:90%;\">Table 1</span>: </span><span class=\"ltx_text\" id=\"Ax1.SSx1.4.8.2\" style=\"font-size:90%;\">PPO hyperparameters used across all benchmarks.\n</span></figcaption>"
  const html = '<article class="ltx_document"><h1 class="ltx_title_document">Fixture</h1><figure class="ltx_table" id="Ax1.SSx1.4">'+caption+'<table><tr><td>Score</td></tr></table>'+caption+'</figure></article>'
  const options = {id:'dreamerv3',arxivId:'2301.04104v2',htmlUrl:'https://arxiv.org/html/2301.04104v2'}
  const p = parsePaper(html,options), $=load(p.blocks[0].en,{},false)
  assert.equal($('figcaption').length,1)
  assert.equal($('[id="Ax1.SSx1.4.7.1.1"]').length,1)
  assert.equal($('td').text(),'Score')
  assert.equal(p.source.repairs[0].removedCopies,1)
  assert.throws(()=>parsePaper(html.replace('PPO hyperparameters','Different caption'),options),/duplicated DreamerV3 caption changed/)
})

test('thousand-step counts compare numeric values while preserving source publisher notices', () => {
  assert.doesNotThrow(() => assertTranslationFidelity('300 thousand steps and 3 million steps', '30万步和300万步'))
  assert.throws(() => assertTranslationFidelity('300 thousand steps', '300步'), /Numeric value/)
  const notice = '0004-3702/99/$ – see front matter © 1999 Published by Elsevier Science B.V. All rights reserved. PII: S0004-3702(99)0 00 52 -1'
  assert.equal(isTechnicalLabelOnly(notice), true)
  assert.doesNotThrow(() => parseUnitResponse(JSON.stringify({translations:{notice}}), [{id:'notice',text:notice}]))
  assert.throws(() => parseUnitResponse(JSON.stringify({translations:{prose:'This procedure learns a model and updates it using observations.'}}), [{id:'prose',text:'This procedure learns a model and updates it using observations.'}]), /No Chinese translation/)
})

test('table cell boundaries prevent label prefixes from multiplying scores and reject swapped scores', () => {
  const en = '<table><tr><td>Breakout</td><td>742</td></tr><tr><td>Centipede</td><td>100</td></tr></table>'
  const zh = '<table><tr><td>打砖块</td><td>742</td></tr><tr><td>千足虫</td><td>100</td></tr></table>'
  assert.doesNotThrow(() => assertBlockTranslationFidelity(en, zh))
  assert.throws(() => assertBlockTranslationFidelity(en, zh.replace('742', '101').replace('100', '742')), /Numeric value/)
  assert.throws(() => assertBlockTranslationFidelity(en, zh.replace('742', '100').replace('100</td></tr></table>', '742</td></tr></table>')), /Numeric value/)
})
