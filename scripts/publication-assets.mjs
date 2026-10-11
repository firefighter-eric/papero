const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b))

/** Restore the frozen source asset metadata without publishing unused files. */
export function sourceAssetMetadata(paper) {
  const original = paper.publicationSourceAssets
  if (original === undefined) return paper.assets
  const ids = new Set()
  if (!Array.isArray(original) || !Array.isArray(paper.assets) || original.length <= paper.assets.length
    || original.some(asset => !asset || typeof asset !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(asset.filename)
      || ids.has(asset.filename) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0
      || !ids.add(asset.filename))
    || paper.assets.some(asset => !same(asset, original.find(item => item.filename === asset.filename)))) {
    throw new Error(`Invalid frozen source asset metadata: ${paper.id}.`)
  }
  return original
}
