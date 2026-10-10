import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from 'cheerio'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { parsePaper, sanitizeHtml, sanitizeSvg, translationUnits, normalizeHeadingNumber, assertTranslationFidelity, technicalIdentifiers, isTechnicalLabelOnly, sha256, safeId, validArxivId, visibleProseText, scientificSignature, isLiteralChatTemplateNode, isLiteralFencedCodeNode } from './paper-lib.mjs'
import { parseUnitResponse, translateWithSplitting, compactRequestContexts } from './translate-paper.mjs'
import { importArxiv, updateCatalog } from './import-paper.mjs'
import { translatedAbstractText } from './paper-lib.mjs'

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
