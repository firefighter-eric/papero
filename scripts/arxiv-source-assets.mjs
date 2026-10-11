import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { sha256, validArxivId } from './paper-lib.mjs'

const maxArchiveBytes = 64 * 1024 * 1024
const maxExpandedBytes = 256 * 1024 * 1024
const maxAssetBytes = 32 * 1024 * 1024
const archiveFilename = 'source-archive.tar.gz'
const metadataFilename = 'source-archive.json'

function memberForUrl(urlValue, arxivId) {
  if (!validArxivId(arxivId) || !/v\d+$/.test(arxivId)) throw new Error('Asset recovery requires a fixed arXiv version')
  const url = new URL(urlValue)
  const prefix = `/html/${arxivId}/`
  if (url.origin !== 'https://arxiv.org' || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) {
    throw new Error('Asset recovery URL does not belong to the fixed official arXiv HTML')
  }
  const member = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!member || member.includes('\\') || /[\u0000-\u001f\u007f]/.test(member) || path.posix.isAbsolute(member)
    || member.split('/').some(component => component === '.' || component === '..' || !component)
    || !/\.(?:png|jpe?g|gif|webp|svg)$/i.test(member)) throw new Error('Unsafe or unsupported source archive member')
  return { url: url.href, member }
}

function tarString(header, start, length) {
  return header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
}

/** Read one exact regular member into memory; never extract archive paths to disk. */
export function extractTarAsset(archive, requestedMember) {
  if (!Buffer.isBuffer(archive) || archive.length > maxArchiveBytes) throw new Error('Source archive exceeds the recovery size limit')
  const tar = gunzipSync(archive, { maxOutputLength: maxExpandedBytes })
  let longName = null
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const sizeField = tarString(header, 124, 12).trim()
    const checksumField = tarString(header, 148, 8).trim()
    if (!/^[0-7]+$/.test(sizeField) || !/^[0-7]+$/.test(checksumField)) throw new Error('Invalid source archive header')
    const size = Number.parseInt(sizeField, 8)
    const expectedChecksum = Number.parseInt(checksumField, 8)
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (checksum !== expectedChecksum || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) {
      throw new Error('Corrupt source archive entry')
    }
    const prefix = tarString(header, 345, 155)
    const shortName = tarString(header, 0, 100)
    const type = String.fromCharCode(header[156])
    const body = tar.subarray(offset + 512, offset + 512 + size)
    let name = longName || (prefix ? `${prefix}/${shortName}` : shortName)
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '').replace(/\n$/, '')
    else if (type === 'x') {
      const paxName = body.toString('utf8').match(/(?:^|\n)\d+ path=([^\n]+)\n/)
      if (paxName) longName = paxName[1]
    } else {
      longName = null
      name = name.replace(/^(?:\.\/)+/, '')
      if (name === requestedMember) {
        if (type !== '0' && type !== '\0') throw new Error('Requested source archive asset is not a regular file')
        if (size === 0 || size > maxAssetBytes) throw new Error('Source asset exceeds the recovery size limit')
        return Buffer.from(body)
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error(`Exact asset member is absent from the fixed arXiv source archive: ${requestedMember}`)
}

function assertAssetBytes(bytes, member) {
  const extension = path.posix.extname(member).toLowerCase()
  const valid = extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ['.jpg', '.jpeg'].includes(extension) ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : extension === '.gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
        : extension === '.webp' ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          : extension === '.svg' && /<svg(?:\s|>)/i.test(bytes.toString('utf8'))
  if (!valid) throw new Error('Recovered source member is not the requested image format')
}

async function saveMetadata(directory, metadata) {
  const temporary = path.join(directory, `${metadataFilename}.${process.pid}.tmp`)
  await writeFile(temporary, JSON.stringify(metadata, null, 2) + '\n')
  await rename(temporary, path.join(directory, metadataFilename))
}

async function cachedArchive(directory, arxivId) {
  let metadata
  try { metadata = JSON.parse(await readFile(path.join(directory, metadataFilename), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const bytes = await readFile(path.join(directory, archiveFilename))
  if (metadata.arxivId !== arxivId || metadata.url !== `https://arxiv.org/src/${arxivId}` || metadata.sha256 !== sha256(bytes)
    || metadata.bytes !== bytes.length || !metadata.recoveries || typeof metadata.recoveries !== 'object') {
    throw new Error('Cached arXiv source archive fingerprint or identity mismatch')
  }
  return { metadata, bytes }
}

export async function readArxivSourceAssetRecovery({ directory, arxivId, url, bytes }) {
  const { url: requestedUrl, member } = memberForUrl(url, arxivId)
  const cached = await cachedArchive(directory, arxivId)
  const recovery = cached?.metadata.recoveries[requestedUrl]
  if (!recovery) return null
  if (recovery.archiveMember !== member || recovery.archiveSha256 !== cached.metadata.sha256 || recovery.archiveUrl !== cached.metadata.url
    || recovery.assetSha256 !== sha256(bytes)) throw new Error('Cached arXiv asset recovery fingerprint mismatch')
  return recovery
}

/** Recover only missing official HTML images from the exact version's original source. */
export async function recoverArxivSourceAsset({ directory, arxivId, url, status, fetchImpl = fetch }) {
  if (status !== 404 && status !== 410) throw new Error('Source archive recovery is limited to missing official HTML assets')
  const { url: requestedUrl, member } = memberForUrl(url, arxivId)
  await mkdir(directory, { recursive: true })
  let cached = await cachedArchive(directory, arxivId)
  if (!cached) {
    const archiveUrl = `https://arxiv.org/src/${arxivId}`
    const response = await fetchImpl(archiveUrl, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`Fixed arXiv source archive request failed (${response.status}): ${archiveUrl}`)
    const contentLength = Number(response.headers.get('content-length'))
    if (contentLength > maxArchiveBytes) throw new Error('Source archive exceeds the recovery size limit')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxArchiveBytes) throw new Error('Source archive exceeds the recovery size limit')
    // Validate the required member before storing the source archive or receipt.
    assertAssetBytes(extractTarAsset(bytes, member), member)
    const metadata = { arxivId, url: archiveUrl, sha256: sha256(bytes), bytes: bytes.length, fetchedAt: new Date().toISOString(), recoveries: {} }
    await writeFile(path.join(directory, archiveFilename), bytes)
    await saveMetadata(directory, metadata)
    cached = { metadata, bytes }
  }
  const bytes = extractTarAsset(cached.bytes, member)
  assertAssetBytes(bytes, member)
  const recovery = {
    method: 'arxiv-source-archive', requestedUrl, requestedHttpStatus: status,
    archiveUrl: cached.metadata.url, archiveSha256: cached.metadata.sha256, archiveMember: member,
    assetSha256: sha256(bytes),
    tool: { name: 'papero-arxiv-source-assets', version: 1, parameters: { compression: 'gzip', format: 'tar', member } },
    recoveredAt: new Date().toISOString(),
  }
  cached.metadata.recoveries[requestedUrl] = recovery
  await saveMetadata(directory, cached.metadata)
  return { bytes, recovery }
}
