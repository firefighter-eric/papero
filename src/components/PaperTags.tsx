import { classificationTags, PAPER_FAMILIES, RESEARCH_TAGS, tagLabel } from '../lib/paper-tags'

export function PaperTags({ tags, compact = false }: { tags: string[]; compact?: boolean }) {
  const primary = classificationTags(tags)
  const visible = compact ? primary : [...new Set([...primary, ...tags])]
  if (!visible.length) return null
  return <span className={`paper-tags ${compact ? 'paper-tags-compact' : ''}`} role={compact ? undefined : 'list'} aria-label={compact ? undefined : '论文标签'}>
    {visible.map(tag => <span key={tag} role={compact ? undefined : 'listitem'} className="paper-tag"
      data-kind={PAPER_FAMILIES.some(family => family === tag) ? 'family' : RESEARCH_TAGS.some(research => research === tag) ? 'research' : 'topic'}>
      {tagLabel(tag)}
    </span>)}
  </span>
}
