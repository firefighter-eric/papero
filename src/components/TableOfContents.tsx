import { ChevronDown, ListTree, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import type { CatalogPaper, PaperSection } from '../types'
import { useNavigationDrawer } from '../hooks/useNavigationDrawer'

interface SectionNode {
  section: PaperSection
  children: SectionNode[]
}

function sectionTree(sections: PaperSection[]): SectionNode[] {
  const roots: SectionNode[] = []
  const stack: SectionNode[] = []
  for (const section of sections) {
    const node = { section, children: [] }
    while (stack.length && (stack.at(-1)!.section.level ?? 1) >= (section.level ?? 1)) stack.pop()
    if (stack.length) stack.at(-1)!.children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

function ancestorsOf(nodes: SectionNode[], id: string | null): string[] | null {
  for (const node of nodes) {
    if (node.section.id === id) return []
    const path = ancestorsOf(node.children, id)
    if (path) return [node.section.id, ...path]
  }
  return null
}

interface Props {
  entry?: Pick<CatalogPaper, 'title' | 'year'> & { titleZh?: string | null; access?: 'source-only' }
  sections: PaperSection[]
  activeSection: string | null
  mobile: boolean
  open: boolean
  loading: boolean
  onClose: () => void
  onNavigate: (id: string) => void
}

export function TableOfContents({ entry, sections, activeSection, mobile, open, loading, onClose, onNavigate }: Props) {
  const drawer = useNavigationDrawer(mobile && open, onClose)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const tree = useMemo(() => sectionTree(sections), [sections])
  const prefix = useId()

  useEffect(() => {
    const ancestors = ancestorsOf(tree, activeSection) ?? []
    setCollapsed(previous => {
      if (!ancestors.some(id => previous.has(id))) return previous
      return new Set([...previous].filter(id => !ancestors.includes(id)))
    })
  }, [tree, activeSection])

  function renderNodes(nodes: SectionNode[], depth = 0) {
    return nodes.map(({ section, children }) => {
      const label = section.titleZh || section.title
      const expanded = !collapsed.has(section.id)
      const childrenId = `${prefix}-${section.id}`
      return <li key={section.id}>
        <div className={`toc-row${section.id === activeSection ? ' is-active' : ''}`} style={{ paddingLeft: `${depth * 12}px` }}>
          {children.length > 0 ? <button className="toc-disclosure" aria-label={`${expanded ? '折叠' : '展开'}${label}的子章节`}
            aria-expanded={expanded} aria-controls={childrenId} onClick={() => setCollapsed(previous => {
              const next = new Set(previous)
              if (next.has(section.id)) next.delete(section.id)
              else next.add(section.id)
              return next
            })}><ChevronDown size={14} aria-hidden="true" /></button> : <span className="toc-disclosure-spacer" />}
          <button className="toc-link" title={section.title} aria-current={section.id === activeSection ? 'location' : undefined}
            onClick={() => { onNavigate(section.id); if (mobile) onClose() }}>{label}</button>
        </div>
        {children.length > 0 && <ul id={childrenId} hidden={!expanded}>{renderNodes(children, depth + 1)}</ul>}
      </li>
    })
  }

  return <>
    {mobile && open && <button className="sidebar-backdrop" aria-label="关闭本文目录" onClick={onClose} tabIndex={-1} />}
    <aside ref={drawer.ref} id="paper-toc" className={`sidebar toc-sidebar${open ? ' is-open' : ''}`}
      aria-label="本文目录" aria-hidden={mobile && !open ? true : undefined} inert={mobile && !open}
      role={mobile ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined} onKeyDown={drawer.onKeyDown}>
      <div className="toc-header"><h2><ListTree size={18} aria-hidden="true" />本文目录</h2>
        {mobile && <button className="icon-button drawer-close" onClick={onClose} aria-label="关闭本文目录"><X size={21} /></button>}
      </div>
      {entry && <div className="toc-paper-info"><p title={entry.title}>{entry.titleZh || entry.title}</p>
        <span>{entry.year} · {sections.length} 个章节</span></div>}
      <nav className="toc" aria-label="章节导航"><ul>{renderNodes(tree)}</ul>
        {sections.length === 0 && <p className="sidebar-hint">{entry?.access === 'source-only'
          ? '全文保留在本地，本站展示来源信息。' : loading ? '正在读取目录…' : '当前暂无可用目录。'}</p>}
      </nav>
    </aside>
  </>
}
