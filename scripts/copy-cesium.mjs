import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'node_modules', 'cesium', 'Build', 'Cesium')
const destination = join(root, 'public', 'cesium')
const directories = ['Workers', 'ThirdParty', 'Assets', 'Widgets']

await rm(destination, { force: true, recursive: true })
await mkdir(destination, { recursive: true })
await Promise.all(
  directories.map((directory) =>
    cp(join(source, directory), join(destination, directory), { recursive: true }),
  ),
)
