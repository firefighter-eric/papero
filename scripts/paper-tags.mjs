import registry from '../paper-metadata/tags.json' with { type: 'json' }

// Labels are reader metadata, separate from frozen source and translation checkpoints.
if (registry.schemaVersion !== 1 || !registry.papers || typeof registry.papers !== 'object' || Array.isArray(registry.papers)
  || Object.entries(registry.papers).some(([id, tags]) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
    || !Array.isArray(tags) || !tags.length || tags.some(tag => typeof tag !== 'string' || !tag.trim())
    || new Set(tags).size !== tags.length)) throw new Error('Invalid paper tag registry')

/** Merge evidenced classification labels with existing topic labels without changing the checkpoint. */
export function mergePaperTags(id, existingTags = []) {
  const classification = Object.hasOwn(registry.papers, id) ? registry.papers[id] : []
  const retained = id === 'muon-original-design' ? existingTags.filter(tag => tag !== '官方文章') : existingTags
  return [...new Set([...classification, ...retained])]
}
