import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt', '.xml'])
const forbidden = [
  { label: 'IGC asset reference', pattern: /(?:https?:\/\/|(?:^|["'`(=])(?:\.{0,2}\/|assets\/|public\/))[^\s"'`?]*\.igc(?:[?\s"'`)]|$)/iu },
  { label: 'IGC A/B record sequence', pattern: /(?:^|[\r\n])A[A-Z0-9]{3,}(?:[\r\n]+H[^\r\n]*)*(?:[\r\n]+B\d{6}\d{7}[NS]\d{8}[EW][AV])/u },
  { label: 'XCTrack device payload', pattern: /LXCTDEVICE\s*:/iu },
]

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? files(path) : [path]
    }),
  )
  return nested.flat()
}

const builtFiles = await files(root)
const igcAssets = builtFiles.filter((path) => extname(path).toLowerCase() === '.igc')
if (igcAssets.length > 0) {
  throw new Error(`Privacy check failed: IGC asset found: ${igcAssets.map((path) => relative(root, path)).join(', ')}`)
}

for (const path of builtFiles) {
  if (!textExtensions.has(extname(path).toLowerCase())) continue
  const text = await readFile(path, 'utf8')
  for (const { label, pattern } of forbidden) {
    if (pattern.test(text)) {
      throw new Error(`Privacy check failed: ${label} in ${relative(root, path)}`)
    }
  }
}

console.log(`Privacy check passed: ${builtFiles.length} distribution files scanned.`)
