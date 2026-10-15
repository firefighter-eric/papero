import { createHash } from 'node:crypto'

// Identifier versions are already protected as whole strings. Listing their
// hyphenated suffixes as negative scores asks the model to duplicate them.
export function sourceNumericTokens(text, identifiers = []) {
  let prose = text.normalize('NFKC')
  for (const identifier of identifiers) prose = prose.replace(identifier, ' ')
  prose = prose.replace(/(?<=\d)-(?=\d)/g, ' ')
  return prose.match(/(?<![\w.])[+-]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?%?/g) || []
}

export function validateConcurrency(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4) throw new Error('Translation concurrency must be an integer from 1 to 4')
  return value
}

const literalPrefix = '⟪PAPERO_LITERAL_'
const sourceDelimiters = ['<think>', '</think>', '<|im_start|>', '<|im_end|>']
const delimiterNames = ['THINK_OPEN', 'THINK_CLOSE', 'IM_START', 'IM_END']

// arXiv bibliography nodes can contain thousands of layout-only newlines.
// Normalize only the request copy, keeping the exact original text in receipts.
// Code, equations and source HTML remain outside this prose transport step.
export function normalizeProseRequestWhitespace(records) {
  return records.map(record => ({ ...record, text: record.text.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim() }))
}

export function protectSourceDelimiters(records, contexts = []) {
  if ([...records.map(record => record.text), ...contexts.map(context => context.context)].some(text => text.includes(literalPrefix))) throw new Error('Source collides with reserved literal transport placeholder')
  const specs = new Map()
  const hash = id => createHash('sha256').update(id).digest('hex').slice(0, 16)
  const preparedRecords = records.map(record => {
    const literals = sourceDelimiters.map((literal, index) => ({ literal, token: `${literalPrefix}${delimiterNames[index]}_${hash(record.id)}⟫`, count: record.text.split(literal).length - 1 })).filter(item => item.count)
    const order = (record.text.match(/<\/?think>|<\|im_(?:start|end)\|>/g) || []).map(literal => literals.find(item => item.literal === literal).token)
    specs.set(record.id, { literals, order })
    let text = record.text
    for (const { literal, token } of literals) text = text.split(literal).join(token)
    return { ...record, text, mustPreserve: [...(record.mustPreserve || []), ...literals.flatMap(item => Array(item.count).fill(item.token))] }
  })
  const preparedContexts = contexts.map(context => {
    let text = context.context
    for (const record of preparedRecords.filter(record => record.block === context.block)) {
      const start = `⟦${record.id}⟧`, end = `⟦/${record.id}⟧`, at = text.indexOf(start), until = text.indexOf(end)
      if (at >= 0 && until >= at) text = text.slice(0, at + start.length) + record.text + text.slice(until)
    }
    for (let index = 0; index < sourceDelimiters.length; index++) text = text.split(sourceDelimiters[index]).join(`${literalPrefix}CONTEXT_${delimiterNames[index]}_${hash(context.block)}⟫`)
    return { ...context, context: text }
  })
  return { records: preparedRecords, contexts: preparedContexts, restore(id, translated) {
    const spec = specs.get(id)
    if (!spec) throw new Error('Unknown literal transport translation unit')
    const { literals, order } = spec
    const tokens = translated.match(/⟪PAPERO_LITERAL_[^⟫]*⟫/g) || []
    if (tokens.some(token => !literals.some(item => item.token === token)) || translated.includes(literalPrefix) && !tokens.length) throw new Error(`Added or moved literal transport placeholder in ${id}`)
    if (tokens.length !== order.length || tokens.some((token, index) => token !== order[index])) throw new Error(`Literal transport placeholder order or multiplicity changed in ${id}`)
    let text = translated
    for (const { literal, token, count } of literals) {
      if (text.split(token).length - 1 !== count) throw new Error(`Literal transport placeholder multiplicity changed in ${id}`)
      text = text.split(token).join(literal)
    }
    if (text.includes(literalPrefix)) throw new Error(`Malformed literal transport placeholder in ${id}`)
    return text
  } }
}

export function translationRequestBudget(contextLength, batchCharacters = 6000) {
  if (!Number.isInteger(batchCharacters) || batchCharacters < 1) throw new Error('Translation batch character limit must be a positive integer')
  const limitedContext = Number.isInteger(contextLength) && contextLength > 0 && contextLength <= 8192
  return {
    maxTokens: limitedContext ? 4096 : 7000,
    batchSourceCharacters: limitedContext ? Math.min(batchCharacters, 3000) : batchCharacters,
    maximumCharacters: limitedContext ? Math.min(batchCharacters, 3000) : 6000,
    maximumRecords: limitedContext ? 40 : 80,
    maximumUnitCharacters: 6000,
    maximumContextCharacters: limitedContext ? 1200 : 4000,
    maximumContextPerBlock: 1200,
    maximumSingleLongUnitContext: limitedContext ? 300 : 1200,
  }
}

// A known LM Studio MLX routing bug can place a schema-constrained final JSON
// document in reasoning_content. Never promote free-form reasoning to an answer.
export function extractCompletionText(output, { expectedModel, expectedIds, allowEmptyTranslations = false } = {}) {
  if (output?.model !== expectedModel) throw new Error(`Completion model mismatch: expected ${expectedModel}, received ${output?.model || 'unknown'}`)
  const choice = output.choices?.[0]
  if (choice?.finish_reason === 'length') throw new Error('Model output was truncated; reduce TRANSLATION_BATCH_CHARACTERS')
  if (choice?.finish_reason !== 'stop') throw new Error(`Completion did not finish successfully: ${choice?.finish_reason || 'unknown'}`)
  if (output.choices.length !== 1 || choice.message?.tool_calls?.length || choice.message?.function_call) throw new Error('Translation completion contains unexpected choices or tool calls')
  const content = choice.message?.content
  if (typeof content === 'string' && content.trim()) return { content, responseChannel: 'content' }
  if (expectedModel !== 'qwen3.6-35b-a3b' || content !== '') throw new Error('Translation completion has no final content')
  if (!Array.isArray(expectedIds) || !expectedIds.length || expectedIds.some(id => typeof id !== 'string' || !id) || new Set(expectedIds).size !== expectedIds.length) throw new Error('Reasoning-channel routing requires unique expected translation IDs')
  const reasoning = choice.message?.reasoning_content
  if (typeof reasoning !== 'string' || !reasoning.trim()) throw new Error('Translation completion has no final content')
  let parsed
  try { parsed = JSON.parse(reasoning) } catch { throw new Error('Reasoning channel is not an entire plain translation JSON object') }
  // JSON.parse would silently retain the last duplicate key. Reject duplicate
  // IDs before the object can hide contradictory translations.
  const tokens = reasoning.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|[^\s{}\[\],:"]+/g) || []
  const scopes = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === '{') scopes.push(new Set())
    else if (token === '[') scopes.push(null)
    else if (token === '}' || token === ']') scopes.pop()
    else if (token.startsWith('"') && tokens[index + 1] === ':' && scopes.at(-1)) {
      const key = JSON.parse(token), scope = scopes.at(-1)
      if (scope.has(key)) throw new Error('Reasoning channel contains duplicate JSON fields')
      scope.add(key)
    }
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'translations')) throw new Error('Reasoning channel contains unexpected top-level fields')
  const translations = parsed.translations
  if (!translations || Array.isArray(translations) || typeof translations !== 'object') throw new Error('Reasoning channel translations must be a plain object')
  const actualIds = Object.keys(translations)
  if (actualIds.length !== expectedIds.length || actualIds.some(id => !expectedIds.includes(id)) || expectedIds.some(id => !Object.hasOwn(translations, id))) throw new Error('Reasoning channel translation IDs do not match the requested IDs')
  if (actualIds.some(id => typeof translations[id] !== 'string' || (!allowEmptyTranslations && !translations[id].trim()))) throw new Error('Reasoning channel contains an empty or non-string translation')
  return { content: reasoning, responseChannel: 'reasoning_content' }
}

export function createRequestGate(concurrency = 1) {
  validateConcurrency(concurrency)
  const queue = []
  let active = 0
  const dispatch = () => {
    while (active < concurrency && queue.length) {
      const { action, resolve, reject } = queue.shift()
      active++
      Promise.resolve().then(action).then(resolve, reject).finally(() => { active--; dispatch() })
    }
  }
  return action => new Promise((resolve, reject) => { queue.push({ action, resolve, reject }); dispatch() })
}

export async function runBoundedTasks(items, worker, { concurrency = 1, onError = () => {} } = {}) {
  validateConcurrency(concurrency)
  const results = Array(items.length)
  let cursor = 0, firstError
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!firstError && cursor < items.length) {
      const index = cursor++
      try { results[index] = await worker(items[index], index) } catch (error) {
        if (!firstError) {
          firstError = error
          await onError(error)
        }
      }
    }
  })
  // All dispatched tasks finish before the error is returned; their accepted
  // checkpoints are retained. No new item is dispatched after the first error.
  await Promise.all(runners)
  if (firstError) throw firstError
  return results
}

export function createSerialWriter() {
  let tail = Promise.resolve()
  return action => {
    const result = tail.then(action)
    tail = result.catch(() => {})
    return result
  }
}
