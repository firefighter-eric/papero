const copy = value => structuredClone(value)
const emptyUsage = () => ({ promptTokens: 0, completionTokens: 0 })

export function assertModelContinuation(paper, model, allowModelChange = false) {
  if (typeof allowModelChange !== 'boolean') throw new Error('allowModelChange must be an explicit boolean')
  if (paper.translation.model && paper.translation.model !== model && paper.blocks.some(block => block.zh) && !allowModelChange) {
    throw new Error(`Existing translation used ${paper.translation.model}; pass --allow-model-change only when an explicit model change is authorized.`)
  }
}

export function beginModelRun(paper, { model, modelIdentity, provider, parameters, promptSha256, startedAt, requestBudget }) {
  const prior = paper.translation
  const history = copy(prior.modelHistory || [])
  if (!history.length && prior.model) {
    history.push({ model: prior.model, modelIdentity: copy(prior.modelIdentity || { apiModelId: prior.model }), provider: prior.provider || provider, parameters: copy(prior.parameters || parameters), promptSha256: prior.promptSha256 || promptSha256, startedAt: prior.createdAt || startedAt, reason: 'legacy-provenance', coverageAtStart: { complete: 0, total: paper.blocks.length } })
  }
  // Historical block fields are copied before the active model/settings change.
  for (const block of paper.blocks) {
    if (!block.zh || !block.translation?.model) continue
    const entry = [...history].reverse().find(item => item.model === block.translation.model && (!block.translation.translatedAt || item.startedAt <= block.translation.translatedAt))
    if (!entry) throw new Error(`Historical model provenance missing for ${block.id}`)
    block.translation.parameters ??= copy(entry.parameters)
    block.translation.modelIdentity ??= copy(entry.modelIdentity)
    block.translation.provider ??= entry.provider
  }
  history.push({ model, modelIdentity: copy(modelIdentity), provider, parameters: copy(parameters), promptSha256, startedAt, ...(requestBudget ? { requestBudget: copy(requestBudget) } : {}), reason: !prior.model ? 'initial-model' : prior.model === model ? 'resume-model' : 'explicit-model-change', ...(prior.model && prior.model !== model ? { previousModel: prior.model } : {}), coverageAtStart: { complete: paper.blocks.filter(block => block.zh).length, total: paper.blocks.length } })
  const modelsUsed = [...new Set([...history.map(entry => entry.model), ...paper.blocks.map(block => block.translation?.model).filter(Boolean)])]
  const modelIdentities = { ...(prior.modelIdentities || {}) }
  for (const entry of history) modelIdentities[entry.model] = copy(entry.modelIdentity)
  const usageByModel = copy(prior.usageByModel || {})
  if (!Object.keys(usageByModel).length && prior.model && prior.usage) usageByModel[prior.model] = copy(prior.usage)
  for (const usedModel of modelsUsed) usageByModel[usedModel] ??= emptyUsage()
  Object.assign(prior, { modelHistory: history, modelsUsed, modelIdentities, usageByModel })
}

export function recordModelUsage(translation, model, usage = {}) {
  const count = value => {
    if (value === undefined) return 0
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Model usage counters must be nonnegative safe integers')
    return value
  }
  const promptTokens = count(usage.prompt_tokens), completionTokens = count(usage.completion_tokens)
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const observedReasoningTokens = reasoning === undefined ? undefined : count(reasoning)
  const item = translation.usageByModel[model] ??= emptyUsage()
  item.promptTokens += promptTokens
  item.completionTokens += completionTokens
  if (reasoning !== undefined) {
    item.observedReasoningTokens = (item.observedReasoningTokens || 0) + observedReasoningTokens
    item.reasoningUsageResponses = (item.reasoningUsageResponses || 0) + 1
  }
  const aggregate = emptyUsage()
  for (const value of Object.values(translation.usageByModel)) {
    aggregate.promptTokens += value.promptTokens
    aggregate.completionTokens += value.completionTokens
    if (value.reasoningUsageResponses !== undefined) {
      aggregate.observedReasoningTokens = (aggregate.observedReasoningTokens || 0) + value.observedReasoningTokens
      aggregate.reasoningUsageResponses = (aggregate.reasoningUsageResponses || 0) + value.reasoningUsageResponses
    }
  }
  translation.usage = aggregate
}
