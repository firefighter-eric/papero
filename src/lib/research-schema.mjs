const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const hashPattern = /^[a-f0-9]{64}$/
const text = (v, max = 4000) => typeof v === 'string' && !!v.trim() && v.length <= max
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const unique = values => new Set(values).size === values.length
function assert(condition, message) { if (!condition) throw new Error(`研究数据无效：${message}`) }
function https(value) {
  try { const u = new URL(value); return text(value, 8192) && !/[\s\\]/.test(value) && u.protocol === 'https:' && !u.username && !u.password } catch { return false }
}
function entry(e) {
  assert(object(e) && text(e.id, 160) && idPattern.test(e.id), '文档 ID')
  assert(text(e.title) && text(e.summary) && /^\d{4}-\d{2}-\d{2}$/.test(e.date), '文档标题、摘要或日期')
  assert(Array.isArray(e.tags) && e.tags.length <= 30 && e.tags.every(v => text(v, 100)), '研究标签')
  assert(e.dataPath === `research/${e.id}/report.json`, '文档路径')
}
export function validateResearchCatalog(value) {
  assert(object(value) && value.schemaVersion === 1 && Array.isArray(value.reports) && value.reports.length <= 500, '目录格式')
  value.reports.forEach(entry)
  assert(unique(value.reports.map(e => e.id)), '重复文档 ID')
  return value
}
export function validateResearchDocument(value, expected) {
  entry(value)
  assert(value.schemaVersion === 1 && value.kind === 'research' && value.language === 'zh-CN', '研究报告格式')
  if (expected) for (const key of ['id', 'title', 'summary', 'date', 'dataPath', 'tags']) {
    assert(JSON.stringify(value[key]) === JSON.stringify(expected[key]), `目录不一致：${key}`)
  }
  assert(Number.isSafeInteger(value.revision) && value.revision >= 1, '报告修订号')
  assert(object(value.authorship) && text(value.authorship.agent) && text(value.authorship.model)
    && text(value.authorship.method) && value.authorship.humanReviewed === false, '生成来源与审校状态')
  assert(Array.isArray(value.sections) && value.sections.length > 0 && value.sections.length <= 200, '章节列表')
  value.sections.forEach(s => assert(object(s) && text(s.id, 160) && idPattern.test(s.id) && text(s.title)
    && Number.isSafeInteger(s.level) && s.level >= 1 && s.level <= 3, '章节条目'))
  assert(unique(value.sections.map(s => s.id)), '重复章节')
  assert(Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 500, '引用列表')
  value.sources.forEach(s => assert(object(s) && /^R\d{2,3}$/.test(s.id) && text(s.title)
    && Array.isArray(s.authors) && s.authors.every(a => text(a)) && Number.isSafeInteger(s.year)
    && https(s.url) && text(s.version) && text(s.locator) && text(s.snapshotKind)
    && !Number.isNaN(Date.parse(s.verifiedAt)) && hashPattern.test(s.snapshotSha256)
    && (s.localPaperId === undefined || idPattern.test(s.localPaperId))
    && (s.upstreamSha256 === undefined || hashPattern.test(s.upstreamSha256)), '引用来源或指纹'))
  assert(unique(value.sources.map(s => s.id)), '重复引用')
  assert(object(value.content) && value.content.path === 'zh.html' && hashPattern.test(value.content.sha256)
    && Number.isSafeInteger(value.content.bytes) && value.content.bytes > 0 && value.content.bytes <= 3 * 1024 * 1024, '正文指纹')
  return value
}
