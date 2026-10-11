import type { CatalogPaper, PaperDocument } from '../types'
import { useEffect, useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { PaperTags } from './PaperTags'

export function PaperHeader({ entry, paper, collapsed = false }: { entry: CatalogPaper; paper: PaperDocument | null; collapsed?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const compact = collapsed && !expanded
  useEffect(() => { setExpanded(false) }, [entry.id, collapsed])
  const title = paper?.title || entry.title
  const titleZh = paper?.titleZh || entry.titleZh
  const authors = paper?.authors || entry.authors
  const authorNames = authors.join(', ')
  const manyAuthors = authors.length > 12 || authorNames.length > 230
  const translated = paper?.blocks.filter((block) => block.zh !== null).length ?? 0
  const total = paper?.blocks.length ?? entry.blockCount
  const complete = paper ? translated === total : entry.translationStatus === 'machine'
  return <header className={`paper-heading${compact ? ' is-compact' : ''}${collapsed ? ' can-toggle' : ''}`}>
    <span className="paper-heading-compact-title" aria-hidden="true" title={title}>{title}</span>
    <div className="paper-heading-body"><div className="paper-heading-body-inner">
    <h1 title={compact ? title : undefined}>{title}</h1>
    <div id={detailsId} className="paper-heading-details" aria-hidden={compact} inert={compact}>
    {titleZh && <p className="paper-title-zh" lang="zh-CN">{titleZh}</p>}
    {manyAuthors ? <div className="paper-authors paper-authors-expandable">
      <p className="author-preview" lang="en">{authorNames}</p>
      <details className="author-disclosure" key={entry.id} onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.open = false
      }}>
        <summary>{authors.length > 1 ? `查看全部署名（${authors.length}）` : '查看完整署名'}<ChevronDown size={12} aria-hidden="true" /></summary>
        <div className="author-full-list" tabIndex={0} aria-label="完整署名名单"><p lang="en">{authorNames}</p></div>
      </details>
    </div> : <p className="paper-authors" lang="en">{authorNames}</p>}
    <p className="paper-metadata"><span>{paper?.year || entry.year}</span><span aria-hidden="true">·</span>
      <span>{entry.arxivId === null ? '官方文章' : `arXiv:${entry.arxivId}`}</span><span aria-hidden="true">·</span>
      <span>{entry.access === 'source-only' ? '来源条目' : complete ? '机器翻译' : translated > 0 ? `机器翻译 · ${Math.round(translated / Math.max(1, total) * 100)}% 已完成` : '中文翻译待生成'}</span>
    </p>
    <PaperTags tags={entry.tags} />
    </div>
    </div></div>
    {collapsed && <button className="paper-heading-toggle" onClick={() => setExpanded((value) => !value)}
      aria-expanded={!compact} aria-controls={detailsId} aria-label={compact ? '展开论文信息' : '收起论文信息'}
      title={compact ? '展开论文信息' : '收起论文信息'}>
      <ChevronDown size={18} aria-hidden="true" />
    </button>}
  </header>
}
