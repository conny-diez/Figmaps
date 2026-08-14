<!-- Both delivered marks, unchanged: GitHub switches on the reader's colour
     scheme. `figmaps-mark-dark.svg` is drawn for a dark ground,
     `figmaps-mark-light.svg` for a light one — see DESIGN.md §5 and `logos/`. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logos/figmaps-mark-dark.svg">
  <img src="logos/figmaps-mark-light.svg" width="72" height="72" alt="Figmaps">
</picture>

# Figmaps — Figma Plugin

**1.0.0 Beta 1** (`1.0.0-beta.1`)

Figmaps takes a selected frame in Figma and places maps as images on the canvas
right next to it: a **contrast measurement per WCAG 2.1 AA** and a **prediction of
visual attention**. Everything runs locally inside the plugin — no backend, no
login, no network request. It ships with an evaluation harness that measures the
prediction engine offline in Node against a reference dataset.

## Key Features

- **Contrastmap** — text against its **actually measured** background, 4.5:1 or
  3:1 for large type (WCAG 1.4.3), controls against 3:1 (WCAG 1.4.11).
  Recomputable, not a prediction.
- **Heatmap** — predicted distribution of visual attention (Turbo colormap).
- **Focusmap** — the screen stays sharp where attention is predicted and is
  continuously darkened and blurred toward the quiet edges.
- **Above the Fold** — for long frames, an extra map of the first viewport alone.
- **Findings** — deterministic rules state what was measured, in whole German
  sentences; "Im Canvas zeigen" jumps to the affected layer and selects it.
- **Viewing duration** — three profiles: `glance` (1 s), `scan` (3 s, default),
  `read` (7 s).
- **Eval harness** — `npm run eval` measures the engine on AUC-Judd, CC, NSS and
  KL, always against image-independent baselines.
- **Clickmap** — implemented, but not offered in the panel (see the
  [development journal](docs/entwicklungsjournal.md#clickmap--warum-sie-nicht-im-panel-steht)).

> **Prediction and measurement are two different things, and the plugin keeps
> them apart.** Heatmap and Focusmap are algorithmic predictions; no real user
> behaviour data goes into them. The Contrastmap computes a standard. In the
> output both kinds are labelled separately, and the footer of every map says
> which of the two it carries.

> **The beta marker applies to the prediction, not to the stability of the code.**
> The engine is measured against a single public dataset, three of the six
> finding rules are switched off, and a validation set for our own screens is
> missing. The Contrastmap is explicitly not affected.

> **Attribution:** the plugin ships a location prior derived from the UEyes
> dataset (Jiang et al., CHI 2023), licensed under CC BY 4.0. Details and the
> places the attribution has to appear: **[`NOTICE.md`](NOTICE.md)**.

> **A note on language.** The plugin's user-facing output is German — panel
> labels, findings, map footers. Quoted strings in this README are therefore
> given verbatim in German. Code, comments and this document are English.

---

## Contents

- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Using the Plugin](#using-the-plugin)
- [Architecture](#architecture)
  - [Three Realms](#three-realms)
  - [Directory Structure](#directory-structure)
  - [Lifecycle of a Run](#lifecycle-of-a-run)
  - [Engine](#engine)
  - [Contrastmap](#contrastmap)
  - [Findings](#findings)
  - [Long Frames](#long-frames)
- [Environment Variables and State](#environment-variables-and-state)
- [npm Scripts](#npm-scripts)
- [Tests](#tests)
- [Eval Harness](#eval-harness)
- [CI](#ci)
- [Distribution](#distribution)
- [Troubleshooting](#troubleshooting)
- [Further Documentation](#further-documentation)
- [Licence and Attribution](#licence-and-attribution)

---

## Tech Stack

| | |
|---|---|
| **Language** | TypeScript 5.9, `strict` (`tsconfig.json`) |
| **Platform** | Figma Plugin API 1.0.0, `documentAccess: "dynamic-page"` |
| **Panel UI** | Preact 10 (JSX via `jsxImportSource`), plain CSS |
| **Bundler** | esbuild 0.28 — two bundles, no framework toolchain (`scripts/build.mjs`) |
| **Tests** | Vitest 4, `node` environment, 522 tests across 36 files |
| **Linting** | ESLint 9, `typescript-eslint` type-checked, `@figma/eslint-plugin-figma-plugins` |
| **Eval harness** | Node, TypeScript, no runtime dependencies (own PNG codec) |
| **Network** | none — `networkAccess: { allowedDomains: ["none"] }` in the manifest |
| **CI** | GitHub Actions (`.github/workflows/`) |
| **Distribution** | zip at a git tag; private publishing inside the organisation is the target path |

`package.json` has **no** `dependencies` field: everything sits under
`devDependencies`, because nothing is loaded at runtime. Preact is baked into the
panel bundle, fonts and the location prior travel as data — with
`networkAccess: none` there is no other way.

---

## Prerequisites

- **Node 24** — the workflows run `node-version: '24'` and development happens on
  the same line. The eval harness is bundled for `node20`, but older versions are
  not verified.
- **npm 11** (lockfile version 3). No Yarn, no pnpm — the lockfile is an npm one.
- **Figma desktop app** — plugins can only be imported from a manifest there, not
  in the browser.
- **Optional, for the eval harness only:** the UEyes dataset (the webpage subset
  takes about 420 MB). It is **not** in the repo, see
  [`eval/fixtures/README.md`](eval/fixtures/README.md). Without it, build, tests
  and plugin work in full; only `npm run eval` and the measurement commands need it.

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/conny-diez/Figmaps.git
cd Figmaps
```

### 2. Install dependencies

```bash
npm ci
```

`npm ci` rather than `npm install`: it installs exactly what the lockfile says and
**does not rewrite it**. `npm install` on a machine with an internal registry
writes that registry back into every `resolved` field — which makes the lockfile
useless outside the corporate network, and six consecutive CI runs have already
failed on exactly that. A test pins the invariant, see
[Troubleshooting](#troubleshooting).

### 3. Build the plugin

```bash
npm run build
```

Produces two artefacts in `build/`:

| File | What is in it |
|---|---|
| `build/main.js` | the main-thread half (IIFE, `platform: neutral` — there is no DOM there) |
| `build/ui.html` | the panel as **one** file: Preact bundle, CSS and both fonts inlined as base64 |

Why the panel is a single HTML file: Figma loads the manifest's `ui` field as a
document, a bare `.js` would not boot. And because `networkAccess` is `none`,
nothing can be fetched — Plus Jakarta Sans and JetBrains Mono (one latin subset
each, 58 KB together) have to travel inside the bundle.

The build finishes by checking **realm separation** on the built bundle and sets
`exitCode = 1` if one side reaches into the other (see [Three Realms](#three-realms)).

### 4. Import into Figma

In the **Figma desktop app**: `Plugins → Development → Import plugin from
manifest…` → pick the `manifest.json` from this directory.

The `id` in the manifest (`1000000000000000001`) is a local placeholder. On
publishing, Figma assigns a real one, which then goes in there.

### 5. During development

```bash
npm run watch      # esbuild in watch mode: unminified, inline sourcemaps
```

Restart the plugin in Figma after a build — watch mode writes the files, Figma
loads them when the plugin opens.

> **Only one entry per plugin id.** If a second "Figmaps" from an unpacked release
> sits next to the worktree import, two entries with the same id hang in the
> development menu and nobody can tell which one is running. That has already
> happened here.

### 6. Before every commit

```bash
npm run verify     # typecheck + tests + build (including the realm check)
npm run lint       # eslint across src, eval, scripts
```

`npm run verify` is the same command CI runs. If it is green locally, the PR check
is green except for the eval gates.

---

## Using the Plugin

1. Select a frame, component, instance, section or group — a multi-selection runs
   as a batch.
2. Toggle maps, set overlay opacity and, if needed, viewport height.
3. **"Maps erstellen".** The result lands in a new wrapper frame
   `[Figmaps 1.0.0 Beta 1] {frame name} — {viewing duration} — {timestamp}` to the
   right of the original.
4. Read the findings below it; **"Im Canvas zeigen"** jumps to the affected layer
   and selects it.

What the panel offers (`Settings` in `src/messages.ts`, defaults in `DEFAULT_SETTINGS`):

| Setting | Values | Default |
|---|---|---|
| `maps` | `heat`, `click`, `focus`, `contrast` | all on |
| `overlayOpacity` | 0–100 % | 65 |
| `profile` | `glance` (1 s), `scan` (3 s), `read` (7 s) | `scan` |
| `uiType` | location prior; `auto` derives it from frame geometry | `auto` |
| `viewportHeight` | frame pixels, or `null` for the derived value | `null` |
| `theme` | `dark`, `light` | `dark`, even when Figma is light |

Behaviour that tends to raise questions:

- **Repeated runs overwrite nothing** — every run creates a new wrapper.
- **Frames with an edge below 200 px are rejected** (too small for a meaningful analysis).
- **Export scale is fixed at 2×.** The engine is measured at that sampling
  density; 1× loses exactly the edge and text detail the features are made of.
  Only the API limit forces it down (see below).
- **The panel starts at 320 × 680** and can be dragged by the handle in the
  bottom-right corner to 320–720 × 420–2400; a double click restores the default.
  The size is remembered.
- **Nothing is painted onto the screenshot except the prediction itself.** Title,
  disclaimer, parameters and the CC BY attribution sit next to it as Figma text
  layers (`src/figma/place.ts`) — the frame name does not travel when someone
  exports a single map as PNG, the footer inside the image area does.

### Verified API limit

`figma.createImage()` accepts **at most 4096 px per edge**, otherwise
`Error: Image is too large`. The export always runs at 2×; the table says when the
API limit forces that down (`src/figma/export.ts`, `src/ui/pipeline.ts`):

| Frame | Export constraint | Notice in the panel |
|---|---|---|
| longer edge × 2 ≤ 4096 | `SCALE 2` | — |
| longer edge ≤ 4096, ×2 too large | `SCALE 1` | "Export auf 1× reduziert" |
| longer edge > 4096 | `WIDTH`/`HEIGHT` = 4096 | "wird auf 4096 px herunterskaliert" |

The image is placed on a rectangle at the frame's **original size**
(`scaleMode: "FILL"`), so the map still lines up exactly with the screen.

---

## Architecture

### Three Realms

The most common source of bugs in Figma plugins, so it comes first:

| | Main thread (`src/main.ts`, `src/figma/`) | iframe (`src/ui.tsx`, `src/render/`) | Node (`eval/`) |
|---|---|---|---|
| **may use** | `figma.*`, `exportAsync`, scene graph, `clientStorage` | DOM, Canvas 2D, `createImageBitmap` | `node:fs`, `node:zlib` |
| **must not** | `document`, `canvas`, `Image`, `fetch`, Node built-ins | `figma.*`, Node built-ins | `figma.*`, DOM |

`src/engine/` belongs to **no** realm: it knows neither Canvas nor `figma` nor
Node and runs in all three. The only platform-dependent pieces live in
`src/platform/` behind the `ImageOps` port.

`npm run build` verifies this on the built bundle (`assertRealmSeparation` in
`scripts/build.mjs`): DOM access in `main.js`, `figma.*` in the panel bundle, Node
built-ins in either. Comments are stripped before the check — otherwise every dev
build reports the documentation as a violation.

The message contract lives in `src/messages.ts` and is imported by both sides: a
discriminated union, no `any`.

### Directory Structure

```
src/
├─ main.ts                 main-thread entry: orchestrates the batch run
├─ ui.tsx                  iframe entry: Preact panel
├─ messages.ts             shared types (UiToMain / MainToUi / NodeSignal / Settings)
├─ version.ts              plugin version, build-time constant from package.json
├─ figma/                  everything that touches `figma.*`
│  ├─ selection.ts         valid selection, minimum size
│  ├─ export.ts            exportAsync incl. the 4096 px fallback
│  ├─ traverse.ts          layer tree → NodeSignal[]
│  ├─ place.ts             wrapper frame, image rects, titles, footers
│  └─ storage.ts           clientStorage
├─ engine/                 platform free — runs in the iframe and in Node
│  ├─ config.ts            ENGINE_CONFIG — every constant of the system
│  ├─ params.ts            named configurations + profiles (viewing duration)
│  ├─ tuned.ts             generated by `npm run tune`, do not edit by hand
│  ├─ priors/              data-estimated location prior (decoder + CC BY attribution)
│  ├─ analyze.ts           shared entry point for plugin and harness
│  ├─ segments.ts          viewport derivation, slicing, cross-fading
│  ├─ heuristic.ts         weighted sum + post-processing
│  ├─ imageops.ts          blur, Sobel, DoG, percentile clipping, rasterisation
│  ├─ features/            luminance · color · edges · structure · prior
│  └─ clickmap.ts          candidates + scoring
├─ contrast/               the measurement, not a prediction
│  ├─ wcag.ts              thresholds, contrast ratio, status
│  ├─ measure.ts           background estimation, text core, per-node measurement
│  ├─ measurable.ts        what is measurable — rotation, occlusion, text core
│  ├─ non-text.ts          WCAG 1.4.11 for controls
│  └─ system-chrome.ts     status bars and the like stay out
├─ platform/               the only platform-dependent building blocks
│  ├─ imageops-canvas.ts   ImageOps for the iframe
│  ├─ imageops-node.ts     ImageOps for Node
│  └─ png.ts               dependency-free PNG codec
├─ findings/               rule set → sentences
├─ render/                 colormap, heatmap, focusmap, contrastmap, fold markers
└─ ui/                     panel: pipeline, theme, marks, styles

eval/                      eval harness — runs offline in Node
├─ cli.ts                  every command, one entry point
├─ dataset.ts              load splits, resample onto the analysis grid
├─ metrics/                AUC-Judd · CC · NSS · KL (+ unit tests)
├─ predictors.ts           baselines: center bias, mean map, uniform, 1.0
├─ runner.ts               run across all images and engines
├─ crossval.ts             k-fold cross-validation, prior re-estimated per fold
└─ fixtures/               reference data — not in the repo, except the gate sets

scripts/
├─ build.mjs               the build, including the realm check
├─ eval.mjs                bundles eval/cli.ts and runs it
├─ check-release.mjs       checks the built bundle before packing
├─ check-published-release.mjs   checks the published release at the tag
├─ ci-lockfile.mjs         registry addresses out of the lockfile
├─ gate-coverage.mjs       package insert: what this CI run covers
└─ version-label.mjs       semver → human form, for YAML

docs/
├─ entwicklungsjournal.md               measurements, rejected approaches, open points
└─ entwicklungsiterationen-1.1-1.2.md   texts that presuppose a predecessor

DESIGN.md                  the panel's design system: tokens, typography, components
NOTICE.md                  CC BY obligations of the UEyes location prior
RELEASE.md                 release text — source of the download notice
logos/                     brand assets (DESIGN.md §5)
```

### Lifecycle of a Run

```
UI  ──GENERATE──────────────▶ Main
                              exportAsync + collectSignals   (per frame, sequentially)
UI  ◀─FRAME_DATA────────────  Main
    predict → render
UI  ──PLACE_RESULT─────────▶  Main
                              createImage + wrapper frame
UI  ◀─FRAME_DONE───────────   Main
                              … next frame …
UI  ◀─DONE─────────────────   Main   + figma.notify
```

The analysis runs in the iframe because that is where Canvas 2D lives; the main
thread exports, reads the layer tree and places. Between steps the iframe yields
to the event loop via `setTimeout(0)` so Figma's UI does not block.

**Performance.** Analysis always runs on a downscaled grid (longer edge 512 px),
never at original resolution. Measured for a 1440 × 3000 frame with 800 layers
(M-series MacBook, Node 24):

```
Grid 246 × 512   predict 116 ms   clickmap 1 ms
```

The rest of the time budget goes to PNG decode, compositing and PNG encode.

### Engine

The shipped engine is **`hybrid-v1`**: a location prior estimated from UEyes plus
additive image analysis. In 5-fold cross-validation over 495 images per category
it beats every image-independent baseline on all four metrics, in both categories
(webpage, mobile UI).

- **Every weight, sigma and threshold lives in `src/engine/config.ts`.** No
  algorithm code carries inline constants.
- **Bump `ENGINE_VERSION` on every change to the prediction** — it appears in layer
  names and in every map's label, and is therefore the statement of which
  prediction produced an image.
- The engine sits behind the `AttentionEngine` interface (`src/engine/types.ts`)
  and works only on `Float32Array` and `Bitmap`. An ML model (ONNX Runtime Web)
  could be dropped in as a second implementation without touching the pipeline —
  and would immediately be comparable via `npm run eval`.
- **The plugin version is separate from the engine version.** It comes from
  `package.json` and nowhere else: `scripts/build.mjs` and `vitest.config.ts`
  inject it as a build-time constant (`src/version.ts`).

### Contrastmap

The only output that is not a prediction — and the only one that says something on
**any** frame shape: it needs no folds, no segments, no candidates and no calibration.

| | Threshold | Source |
|---|---|---|
| Text, normal | 4.5:1 | WCAG 1.4.3 |
| Text, large (≥ 24 px, or ≥ 18.66 px from weight 700) | 3:1 | WCAG 1.4.3 |
| Controls against the adjacent colour | 3:1 | WCAG 1.4.11 |

Measurement runs against the **actual** background taken from the pixels, not an
assumed one. What cannot be measured is not guessed but skipped with a reason
(`src/contrast/measurable.ts`): rotated nodes, occluded nodes, missing text core,
operating-system chrome. The thresholds are **cited, not calibrated** — details
and limits in the
[development journal](docs/entwicklungsjournal.md#contrastmap-12-c).

### Findings

Six rules are implemented, **three ship** (`RULES` in `src/findings/rules.ts`
filters on `shipped`):

| Rule | State |
|---|---|
| `cta-rank` | shipped |
| `competition` | shipped, recalibrated onto the diagonal in 1.2 |
| `cold-fold` | shipped |
| `cta-below-fold` | off — the rebuild does not fix the defect |
| `flat` | off — the deciding quantity measures the wrong thing |
| `dead-cta` | off — the next step is decided but not built |

Every rule has a firing *and* a non-firing test, plus a reachability test through
the real analysis path and a repeat run under perturbed engine parameters. The
reasoning behind each switch-off is in the
[development journal](docs/entwicklungsjournal.md#befunde-epic-c).

### Long Frames

Viewport height is derived from frame width: from 1,024 px it is desktop at
900 px, below that mobile at `width × 2`. The **viewport height** slider overrides it.

- Frames **below 1.5 viewport heights** are analysed whole, unchanged.
- Above that, they are sliced into segments of one viewport height with **20 %
  overlap** so elements at cut edges are not split. Each segment is analysed on
  its own and then linearly cross-faded back together.
- An **above-the-fold map** is produced from the first segment as well.
- Fold lines are drawn dashed into every map, labelled "Fold 1", "Fold 2".

Segments run sequentially; progress reads "Abschnitt 3 von 7".

---

## Environment Variables and State

The plugin itself needs **no** environment variables and reads no config — there is
no backend and no secret. What exists concerns the harness and CI:

| Variable | Purpose | Read in |
|---|---|---|
| `UEYES_DIR` | root of the UEyes dataset, when not passed as `--ueyes <path>` | `eval/ueyes.ts` |
| `RELEASE_TAG` | tag whose published release is checked (otherwise `GITHUB_REF_NAME` or argument 1) | `scripts/check-published-release.mjs` |
| `GH_TOKEN` | read access for `gh`; the repo is private, anonymous requests get 404 | in the release workflow |
| `GITHUB_STEP_SUMMARY` | set by Actions; where the package insert writes | `scripts/gate-coverage.mjs` |
| `NODE_ENV` | set by the build (`development` on `--watch`/`--dev`), not from outside | `scripts/build.mjs` |

The dataset path is **never in the code** — deliberately, it is machine-local.

**Plugin state** lives exclusively in `figma.clientStorage`
(`src/figma/storage.ts`): the panel's `Settings` and the panel size. The size is
kept separate on purpose, because it is written on every frame of a resize drag.

---

## npm Scripts

### Development

| Command | What it does |
|---|---|
| `npm run build` | `build/main.js` + `build/ui.html`, then the realm check |
| `npm run watch` | the same build in watch mode, unminified, inline sourcemaps |
| `npm run typecheck` | `tsc --noEmit` across `src`, `eval`, `scripts` |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint across `src`, `eval`, `scripts` |
| `npm run verify` | `typecheck` + `test` + `build` — the CI command |

### Release

| Command | What it does |
|---|---|
| `npm run check-release` | checks the **built** bundle: location prior payload, CC BY attribution, exactly two embedded fonts |
| `npm run check-published-release -- v1.0.0-beta.1` | checks the **published** release at the tag: one object, not a draft, zip attached, unpacks to something installable, download notice in the body |

### Eval harness

All of these run offline in Node; none of them touches the plugin.

| Command | What it measures |
|---|---|
| `npm run eval:fixtures -- --ueyes <path> --category web\|mobile` | import reference data |
| `npm run eval -- --help` | the full option list for every command |
| `npm run eval` | engine against baselines, markdown report + contact sheet |
| `npm run tune` | random search over the weights, tuning split only |
| `npm run diagnose` | where the predictive power comes from |
| `npm run crossval` | k-fold cross-validation, prior re-estimated per fold |
| `npm run build-prior` | generates `src/engine/priors/generated.ts` |
| `npm run gate-fixtures` | builds the 40 gate images that live in the repo |
| `npm run contrast-gate` | the second regression gate: contrastmap against `eval/contrast-baseline.json` |
| `npm run findings-audit` | firing rates of the rules, distributions, where the thresholds sit |
| `npm run visual-check` | the check cases as an image |
| `npm run side-effects` | firing rates before and after a parameter change |
| `npm run measurable` | how much of the contrast measurement is measurable at all |

Further measurement commands from individual iterations — `alpha`, `sharpness`,
`groups`, `cutoff`, `band-gate`, `cold-fold`, `finding-load`, `competition`,
`contrast-check`, `header-weight`, `epic-d` — are listed in `package.json` and
documented in the [development journal](docs/entwicklungsjournal.md) alongside the
measurement they belong to.

---

## Tests

```bash
npm test
```

**522 tests across 36 files**, all against **synthetic** inputs with a known
truth: white image ⇒ flat feature map, black square ⇒ peak at its position, same
input ⇒ identical output. Real screens have no known truth and are unsuitable for
assertions; they serve manual acceptance, see
[`test-fixtures/README.md`](test-fixtures/README.md).

Single file or pattern:

```bash
npx vitest run src/findings/__tests__/rules.test.ts
npx vitest run -t "cta-rank"
```

The load-bearing groups:

| File | What it checks |
|---|---|
| `src/engine/__tests__/parity.test.ts` | both realms share resampler and blur; predictions differ by ≤ 1e-4; PNG roundtrip lossless |
| `src/engine/__tests__/segments.test.ts` | slice geometry, 20 % overlap, a constant field stays constant after cross-fading |
| `src/engine/__tests__/analyze.test.ts` | segments, above the fold, viewport override, cancellation |
| `eval/metrics/__tests__/metrics.test.ts` | every metric against a hand-computed 5×5 case |
| `src/findings/__tests__/rules.test.ts` | per rule a firing *and* a non-firing case, plus the wording rules |
| `src/findings/__tests__/end-to-end.test.ts` | every rule can be triggered *and* silenced through the real analysis path |
| `src/findings/__tests__/robustness.test.ts` | the same cases under perturbed engine parameters |
| `src/contrast/__tests__/measurable.test.ts` | rotation, occlusion and a missing text core are detected |
| `src/ui/__tests__/theme.test.ts` | every contrast pair that actually occurs, both palettes, against 4.5:1 or 3:1 |
| `src/ui/__tests__/marks.test.ts` | the panel mark matches `logos/` circle for circle |
| `src/__tests__/version.test.ts` | `humanVersion` in TypeScript and the YAML variant produce the same string |
| `eval/__tests__/contrast-gate.test.ts` | the contrastmap gate — including proof that it can go red |
| `scripts/__tests__/gate-coverage.test.ts` | no number appears in the package insert that was not computed there |

**The rule this repo learned the expensive way:** a check that finds nothing is
only evidence once it can prove it **could** find something. Both gates therefore
ship a run that must fail. The list of cases where that was missing is in the
[development journal](docs/entwicklungsjournal.md#praxis-prüfungen-die-etwas-finden-können).

Figma plugins cannot be verified automatically on the canvas. The manual
acceptance list (23 steps) is in the
[development journal](docs/entwicklungsjournal.md#manuelle-abnahme).

---

## Eval Harness

Without it there is no way to tell whether a change to the engine helps or hurts.

```bash
# 1. Import reference data — path as a parameter, never in the code
npm run eval:fixtures -- --ueyes /path/to/UEyes_dataset --category web

# 2. Measure
npm run eval -- --fixtures ueyes-web --set test --duration 3 --report out/eval.md
```

Output: a markdown table (engine × metric) plus a contact sheet of the twelve
worst cases as `original | ground truth | prediction`. The visual error analysis
is worth more than the number alone — that is where you see *which kind* of screen
the engine does not understand.

| Metric | Meaning | Ground truth | Direction |
|---|---|---|---|
| AUC-Judd | discriminates fixation vs. non-fixation | fixation map (discrete) | higher is better |
| CC | Pearson correlation of the maps | heatmap (continuous) | higher is better |
| NSS | normalised saliency at fixation points | fixation map (discrete) | higher is better |
| KL | divergence of the distributions | heatmap (continuous) | lower is better |

Four things carry the setup:

1. **The two ground-truth channels are not mixed.** AUC and NSS need points, CC
   and KL need a distribution. Deriving fixations from the heatmap would feed both
   sides from the same source; where it is unavoidable the loader marks it and the
   report says so.
2. **Baselines always run** — center bias across several widths, mean map (mean
   ground truth of the tuning split), uniform, and the frozen 1.0 configuration.
   The verdict is against the **strongest** one per metric.
3. **Uniform is the sanity check.** If it does not return exactly AUC 0.5 / CC 0 /
   NSS 0 on real data, the run aborts and writes no report — then the import is
   wrong, not the engine.
4. **Tuning and test stay separate.** `npm run tune` refuses the test split, and
   tuning results are **not** armed automatically: a human looks at the contact
   sheet and sets `activeConfigId` by hand.

Fixture structure, splits and the threshold for the baseline comparison:
[`eval/fixtures/README.md`](eval/fixtures/README.md).

---

## CI

Three workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `eval-gate.yml` (*CI*) | PR, push | `npm ci`, `lint`, `verify`; then the **eval gate** against `main` and the **contrastmap gate**; finally the package insert `gate-coverage.mjs` |
| `release.yml` | tag `v*` | builds, checks, packs the zip and creates or amends the release **draft** |
| `release-verify.yml` | `release: published`, manual | **downloads and unpacks** the asset from the published release |

Two properties of the gates you have to know:

- **Both ship a self-test that must fail.** A gate nobody knows can go red is not a
  gate — this repo had one that was green three times without measuring anything.
- **The eval gate's numbers are not evidence of quality.** It runs on 40 images
  from the test split, visible on every PR — anyone tuning a change until the
  number rises has calibrated on it. A regression of 0.065 CC shows up, one of
  0.005 does not do so reliably.

`gate-coverage.mjs` writes into every run summary what the run covers **and what it
does not** — every number in it is derived or it is not there.

---

## Distribution

### Three paths, and they are not equivalent

| Path | For whom | State |
|---|---|---|
| **Private publishing inside the organisation** | every user without repo access | **the binding path** once it stands — still open |
| **Release zip at the tag** | development, archive, emergencies | in place (`v1.0.0-beta.1`) — but not the path you name to a colleague |
| **Dev import from the worktree** | development only, local only | in place (`npm run watch`) |

**Why the GitHub path does not work as distribution:** the repo is private.
Someone without access cannot see the release and gets a 404 on every asset URL —
and designers typically have no repo access. On top of that, every manual step it
demands: pick the right archive (GitHub's automatic "Source code" archives are
source **without** `build/`), unpack, store it permanently, import the manifest.
One of those steps has already failed.

The tag release stays as an **archive**: the only place where a verified,
reproducible state exists per version.

### Cutting a release

```bash
git tag v1.0.0-beta.1 && git push origin v1.0.0-beta.1
```

`release.yml` then builds, checks and attaches `figmaps-1.0.0-beta.1.zip` to a
release in **draft** state, titled "Figmaps 1.0.0 Beta 1" and marked as a
**pre-release**. The body (`RELEASE.md`) is read before publishing — a zip somebody
has already downloaded cannot be withdrawn.

What the workflow enforces along the way:

1. **Tag = `package.json`.** Otherwise it aborts; otherwise the single place the
   version lives would be two places again.
2. **Pre-release flag derived from the version** — if it contains a hyphen,
   `prerelease: true` is mandatory. Without it GitHub lists the tag as "Latest
   release", and then a state that is not yet a recommendation becomes one.
3. **`check-release.mjs` checks the payload, not the filenames.** The location
   prior is the one piece whose absence stays **silent**: without the asset the
   engine falls back to an analytical bell curve — no message, just worse maps.
   Checked are twelve decoded prior maps, the CC BY attribution and exactly two
   embedded fonts.
4. **The zip is unpacked again elsewhere** and checked for what Figma would check:
   do `manifest.main` and `manifest.ui` point at files that exist? Packed is not
   installable.

After publishing:

```bash
npm run check-published-release -- v1.0.0-beta.1
```

Five questions, any one of which would have caught the `v1.2.0` incident — two
release objects hung on the same tag there, the published one without any asset.
**A draft is not attached to the tag** and therefore cannot answer the only
question that matters: is the file where a user looks for it? The story is in the
[development journal](docs/entwicklungsjournal.md#der-entwurf-ist-die-stelle-an-der-v120-schiefgegangen-ist).

**No link to `releases/latest`:** GitHub never lists a pre-release as "Latest", so
that URL is dead as long as only a pre-release exists. Link the release list or the
tag instead.

### What private publishing still needs

| Field | State |
|---|---|
| Icon 128 × 128 **as PNG** | missing — only SVG is versioned |
| Thumbnail/cover 1920 × 1080 | missing entirely |
| Tagline, description | missing entirely — and **not** to be taken from the repo description: that one names the prediction first, while since 1.2 the Contrastmap is the main output |
| Category, support contact (mandatory) | decision open |
| Plugin id | Figma assigns it on publishing, then it goes back into `manifest.json` |

Two points that are not on the list and decide anyway: private publishing exists
only on the **Organization and Enterprise** plans, and Figma does **not review**
privately shared plugins — whatever text stands here stands unreviewed in front of
colleagues. Full inventory in the
[development journal](docs/entwicklungsjournal.md#was-für-das-private-publishing-noch-fehlt).

---

## Troubleshooting

### `npm ci` aborts with 503

**Cause:** the lockfile points at an internal registry. `npm install` writes the
registry configured on the machine into every `resolved` field.

```bash
node scripts/ci-lockfile.mjs package-lock.json     # remove the addresses
node scripts/ci-lockfile.mjs --check               # check only
```

`integrity` stays in place, so the installation afterwards is exactly the same —
only the source is dropped, not the guarantee. A test pins the invariant and goes
red if the addresses are committed again.

### "Error loading the plugin environment" in Figma

Usually **not** the build but a dead entry in Figma's own `settings.json`: a
previously imported plugin whose directory no longer exists. Check that
`build/main.js` and `build/ui.html` exist; if they do, remove the stale entry in
Figma and re-import the plugin.

### Realm separation violated

```
✖ Realm separation violated:
  - build/main.js uses DOM APIs that do not exist in the Figma main thread: document.
```

The build is right: there is no DOM in the main thread and no `figma` in the
iframe. The code has to move to the other realm or behind a message in
`src/messages.ts`. The same error appears for accidentally bundled Node built-ins —
those exist in **neither** plugin realm, and the failure would otherwise only
surface at runtime inside Figma, where nobody sees the stack trace.

### `Error: Image is too large`

`figma.createImage()` takes at most 4096 px per edge. The fallback in
`src/figma/export.ts` handles this automatically — if the message appears anyway,
it is a bug in the constraint choice, not user error.

### The eval harness finds no fixtures

```
Kein Referenz-Set … oder Umgebungsvariable UEYES_DIR setzen.
```

The fixtures are not in the repo. Import them first:

```bash
npm run eval:fixtures -- --ueyes /path/to/UEyes_dataset --category web
```

Only the two **gate sets** live in the repo (`eval/fixtures/gate-web`,
`gate-mobile`, 20 images each) — deliberately as files rather than in an Actions
cache, because a cache can expire and then the check is silently gone. That is
exactly what happened.

### The eval run aborts on a uniform error

The constant baseline has to return exactly AUC 0.5 / CC 0 / NSS 0. If it does
not, the **import** is wrong — not the engine. The harness then deliberately writes
no report.

### The panel looks wrong or contrasts are off

`npm test` reads `src/ui/styles.css` and rejects three things: a colour literal
outside the `:root` fallback, a fallback that deviates from the dark theme, and
`var(--cta)` anywhere other than the two allowed places. Yellow is exclusively the
primary action — the rules are in [`DESIGN.md`](DESIGN.md).

### Panel size or settings are gone after a restart

Both live in `figma.clientStorage`, not on disk. A freshly imported plugin with a
different id has its own storage.

---

## Further Documentation

| File | Contents |
|---|---|
| [`docs/entwicklungsjournal.md`](docs/entwicklungsjournal.md) | **The depth** (German): every measurement series, every rejected approach, every disabled rule with its reasoning, the manual acceptance list, the open decisions and the "before going public" inventory. Until August 2026 this was the content of this README |
| [`docs/entwicklungsiterationen-1.1-1.2.md`](docs/entwicklungsiterationen-1.1-1.2.md) | texts that presuppose a predecessor state — moved out of the release notes |
| [`DESIGN.md`](DESIGN.md) | the panel's design system: tokens, typography, geometry, components |
| [`NOTICE.md`](NOTICE.md) | CC BY obligations of the UEyes location prior and where the attribution must appear |
| [`RELEASE.md`](RELEASE.md) | release notes; holds the download notice between two markers as its single source |
| [`eval/fixtures/README.md`](eval/fixtures/README.md) | reference data structure, splits, import, threshold for the baseline comparison |
| [`test-fixtures/README.md`](test-fixtures/README.md) | reference screens for manual acceptance — not yet chosen |

**Two countings with the same digits.** A **release** number is always given in
semver form (`1.0.0-beta.1`) or with the word release in front of it; a
**development iteration** ("1.1", "1.2 A", "1.3") is a stretch of work on the repo
and was never something anyone could install. A release numbered 1.2 never existed.

---

## Licence and Attribution

No licence is set for this repository — that is an open decision, not a statement.

The bundled location prior is derived from the **UEyes dataset** (Jiang et al.,
CHI 2023), licensed under **CC BY 4.0**. Attribution is mandatory and appears in
the bundle, under every output and in every eval report; `check-release.mjs`
verifies before each release that it arrives. Details: [`NOTICE.md`](NOTICE.md).
