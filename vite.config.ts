import { realpath, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'])
const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

function allowedDataFile(relative: string): boolean {
  if (relative === 'catalog.json') return true
  if (relative === 'research/catalog.json' || /^research\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:report\.json|zh\.html)$/.test(relative)) return true
  if (/^papers\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/(?:paper\.json|en\.html|zh\.html)$/.test(relative)) return true
  return /^papers\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/assets\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(relative)
    && ASSET_EXTENSIONS.has(path.extname(relative).toLowerCase())
}

/** Expose the local processed data in development without adding it to public/. */
function localPaperData(dataDir: string): Plugin {
  return {
    name: 'papero-local-paper-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/paper-data', async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405
          response.end('Method not allowed')
          return
        }
        let relative: string
        try {
          relative = decodeURIComponent((request.url ?? '').split('?')[0]).replace(/^\//, '')
        } catch {
          response.statusCode = 400
          response.end('Invalid data path')
          return
        }
        if (!allowedDataFile(relative)) {
          response.statusCode = 404
          response.end('Paper data not found')
          return
        }
        try {
          const root = await realpath(dataDir)
          const file = await realpath(path.resolve(root, relative))
          if (!file.startsWith(`${root}${path.sep}`) || !(await stat(file)).isFile()) {
            response.statusCode = 404
            response.end('Paper data not found')
            return
          }
          response.statusCode = 200
          response.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.setHeader('Cache-Control', 'no-cache')
          if (path.extname(file).toLowerCase() === '.svg') {
            response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
          } else if (path.extname(file).toLowerCase() === '.html') {
            response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
          }
          if (request.method === 'HEAD') response.end()
          else createReadStream(file).on('error', next).pipe(response)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            response.statusCode = 404
            response.end('Paper data not found')
          } else next(error)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const dataDir = path.resolve(process.env.DATA_DIR || env.DATA_DIR || 'data')
  return {
    plugins: [react(), localPaperData(dataDir)],
    test: {
      environment: 'jsdom',
      globals: false,
      include: ['tests/**/*.test.{ts,tsx,mjs}'],
      restoreMocks: true,
    },
  }
})
