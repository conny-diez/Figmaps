// Bundles and runs the fixture preparation CLI (A-2). See scripts/eval.mjs.
import { rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const OUT = 'build/fixtures.mjs'

await esbuild.build({
  entryPoints: ['eval/fixtures-cli.ts'],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  logLevel: 'warning',
})

const { main } = await import(pathToFileURL(OUT).href)
const code = await main(process.argv.slice(2))

await rm(OUT, { force: true })
process.exit(code)
