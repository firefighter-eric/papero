import type { ResearchDocument } from '../types'
import { sanitizePaperHtml } from './paper-data'
import { createResearchVisualRuntime } from './research-visuals.mjs'
import visualStyles from './research-visuals.css?inline'

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Only the application-owned visual runtime becomes executable in this export. */
export function buildResearchDownload(report: ResearchDocument & { html: string }) {
  const body = sanitizePaperHtml(report.html, report.dataPath)
  const runtime = `(${createResearchVisualRuntime.toString()})().mount(document);`.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(report.title)}</title><style>
:root{color-scheme:light;--text:#242424;--muted:#666;--secondary-text:#595959;--paper-bg:#fff;--surface-bg:#fafafa;--border:#ddd;--control-border:#ccc;--selected-bg:#eee;--green:#333}
body{margin:0;background:var(--paper-bg);color:var(--text);font:18px/1.95 Georgia,"Songti SC",serif}article{max-width:940px;margin:auto;padding:32px 24px 80px}h1{font-size:1.8em}h2{font-size:1.3em;border-top:1px solid var(--border);padding-top:24px;margin-top:36px}a{color:inherit;text-underline-offset:3px}.report-meta{font:13px/1.8 system-ui;color:var(--muted)}.table-scroll{overflow:auto}table{border-collapse:collapse;min-width:600px;width:100%;font:14px/1.7 system-ui}td,th{padding:10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}th{background:var(--surface-bg)}.callout{background:var(--surface-bg);border-left:3px solid var(--green);padding:16px 20px}.reference-list{font-size:14px;overflow-wrap:anywhere}.reference-list code{word-break:break-all}math[display=block]{display:block;overflow:auto;margin:18px 0}annotation,annotation-xml{display:none}.standalone-toc{font-size:14px}.standalone-toc li{margin:3px 0}.katex-mathml{display:block;max-width:100%;overflow:auto}
@media(max-width:600px){article{padding:24px 16px}h1{font-size:1.5em}}@media print{article{padding:0}h2{break-after:avoid}}
${visualStyles}</style></head><body><article class="research-prose paper-block" data-research-id="${escape(report.id)}">${body}</article>
<script>${runtime}</script></body></html>`
}
