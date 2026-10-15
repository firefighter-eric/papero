import type { ResearchDocument } from '../types'
import { resolvePaperDataUrl } from '../lib/paper-data'
import { buildResearchDownload } from '../lib/research-download'

export function ResearchDownload({ report }: { report: ResearchDocument & { html: string } }) {
  return <a className="source-link research-download" href={resolvePaperDataUrl(report.dataPath.replace(/report\.json$/, 'zh.html'))}
    download={`${report.id}-zh.html`} title="下载可离线阅读的 HTML，保留交互图示"
    onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      const url = URL.createObjectURL(new Blob([buildResearchDownload(report)], { type: 'text/html;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `${report.id}-zh.html`; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>下载 HTML</a>
}
