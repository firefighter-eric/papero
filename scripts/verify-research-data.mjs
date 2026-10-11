import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { inspectResearchData } from './research-data.mjs'
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--data-dir')) throw new Error('Usage: node scripts/verify-research-data.mjs [--data-dir paper-data]')
const result = await inspectResearchData(await realpath(path.resolve(args[1] ?? 'paper-data')))
console.log(JSON.stringify({ type: 'research-data-verified', reports: result.reports.length, files: result.files.size, sourceSnapshotsReverified: false }))
