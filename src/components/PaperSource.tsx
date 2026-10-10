import { ArrowUpRight, BookOpen } from 'lucide-react'
import type { SourceOnlyCatalogPaper } from '../types'

export function PaperSource({ entry }: { entry: SourceOnlyCatalogPaper }) {
  return <section className="paper-source" aria-labelledby="paper-source-title">
    <BookOpen size={35} strokeWidth={1.3} aria-hidden="true" />
    <h2 id="paper-source-title">全文保留在本地</h2>
    {entry.tags.length > 0 && <p className="paper-source-tags" aria-label="资料标签">{entry.tags.join(' · ')}</p>}
    <p>这篇资料已收录来源信息，暂不公开全文与译文。原文与译文的公开范围遵循来源许可。</p>
    <div className="paper-source-links">
      <a className="primary-button" href={entry.sourceHtmlUrl} target="_blank" rel="noopener noreferrer">
        阅读官方原文<ArrowUpRight size={16} aria-hidden="true" />
      </a>
      {entry.sourceUrl !== entry.sourceHtmlUrl && <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
        查看论文信息<ArrowUpRight size={14} aria-hidden="true" />
      </a>}
    </div>
  </section>
}
