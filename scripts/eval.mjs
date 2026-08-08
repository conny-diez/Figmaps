// Bundles the eval harness with esbuild and runs it.
//
// The harness is TypeScript that imports the engine straight out of `src/`, so
// it cannot simply be `node`-ed. esbuild is already the project's only build
// tool; adding ts-node or tsx for this would be a second one.
import { rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const OUT = 'build/eval.mjs'

await esbuild.build({
  entryPoints: ['eval/cli.ts'],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Node built-ins stay external; everything else is inlined so the harness is
  // a single file that cannot pick up a stale module.
  packages: 'external',
  logLevel: 'warning',
  sourcemap: 'inline',
})

const { main } = await import(pathToFileURL(OUT).href)
const code = await main(process.argv.slice(2))

await rm(OUT, { force: true })
process.exit(code)
