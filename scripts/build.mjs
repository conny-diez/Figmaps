// Build script: emits build/main.js (Figma main thread) and build/ui.html (iframe).
//
// The iframe bundle is inlined into a single HTML file because Figma's manifest
// `ui` field is loaded as a document — a bare .js file would not boot.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const dev = watch || process.argv.includes('--dev')

await mkdir('build', { recursive: true })

/** Shared esbuild settings. */
const common = {
  bundle: true,
  target: 'es2020',
  logLevel: 'info',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
}

const mainOptions = {
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'build/main.js',
  format: 'iife',
  // The Figma main thread has no DOM and no module loader.
  platform: 'neutral',
}

/** Wraps the compiled iframe bundle + CSS into one self-contained HTML document. */
const htmlPlugin = {
  name: 'inline-html',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const file = result.outputFiles?.find((f) => f.path.endsWith('.js'))
      if (!file) return
      const css = await readFile('src/ui/styles.css', 'utf8')
      // A literal `</script>` inside the bundle would terminate the tag early.
      const js = file.text.replace(/<\/script/gi, '<\\/script')
      const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Attention Maps</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`
      await writeFile('build/ui.html', html)
      console.log(`[ui] build/ui.html (${(html.length / 1024).toFixed(1)} kB)`)
    })
  },
}

const uiOptions = {
  ...common,
  entryPoints: ['src/ui.tsx'],
  outfile: 'build/ui.js',
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  write: false,
  plugins: [htmlPlugin],
}

/**
 * Guards the realm split of PRD §6.3 — the single most common failure mode in
 * this project. The main thread has no DOM; the iframe has no `figma`.
 */
async function assertRealmSeparation() {
  const main = await readFile('build/main.js', 'utf8')
  const html = await readFile('build/ui.html', 'utf8')
  const uiJs = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))

  const problems = []
  const domLeaks = main.match(/\b(document|window|createElement|XMLHttpRequest|OffscreenCanvas)\s*\.|\bfetch\s*\(/g)
  if (domLeaks) problems.push(`build/main.js uses DOM APIs that do not exist in the Figma main thread: ${[...new Set(domLeaks)].join(', ')}`)

  const figmaLeaks = uiJs.match(/\bfigma\s*\.\s*[A-Za-z_$]/g)
  if (figmaLeaks) problems.push(`build/ui.html calls figma.* from the iframe: ${[...new Set(figmaLeaks)].join(', ')}`)

  if (problems.length > 0) {
    console.error(`\n✖ Realm separation violated:\n  - ${problems.join('\n  - ')}\n`)
    process.exitCode = 1
  }
}

if (watch) {
  const contexts = await Promise.all([esbuild.context(mainOptions), esbuild.context(uiOptions)])
  await Promise.all(contexts.map((c) => c.watch()))
  console.log('watching…')
} else {
  await Promise.all([esbuild.build(mainOptions), esbuild.build(uiOptions)])
  await assertRealmSeparation()
}
