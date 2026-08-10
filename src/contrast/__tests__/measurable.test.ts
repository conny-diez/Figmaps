/**
 * 1.3, 1a und 1b — die Fälle, in denen die Bounding-Box nicht ist, was man sieht.
 *
 * WARUM DIESE TESTS UND NICHT DER AUDIT. `npm run measurable` zählt, wie viele
 * messbare Elemente die Prüfung **verwirft** — das kann es, weil die Generatoren
 * nichts Gedrehtes und nichts Verdecktes zeichnen und jeder Treffer dort eine
 * Fehlmeldung wäre. Die umgekehrte Frage, ob die Prüfung findet, was sie finden
 * soll, kann derselbe Korpus aus demselben Grund **nicht** beantworten. Sie
 * steht hier, an Fällen, die den Mangel absichtlich herstellen.
 *
 * Dieselbe Aufteilung wie bei den Befundregeln: die Quote kommt aus dem Harness,
 * die Wirkung aus dem Test.
 */
import { describe, expect, it } from 'vitest'
import type { Bitmap } from '../../engine/ops'
import type { NodeSignal } from '../../messages'
import { HISTOGRAM_BINS, measureContrast, pixelLuminance, textCoreShare } from '../measure'
import {
  MEASURABLE_LIMITS,
  NO_LIMITS,
  occludedShare,
  rotationOf,
  SKIP_LABELS,
  SKIP_TEXT,
  summariseSkipped,
  unionArea,
  type SkipReason,
} from '../measurable'

type Rgb = [number, number, number]

function canvas(width: number, height: number, colour: Rgb): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = colour[0]
    data[p + 1] = colour[1]
    data[p + 2] = colour[2]
    data[p + 3] = 255
  }
  return { width, height, data }
}

function box(image: Bitmap, x: number, y: number, w: number, h: number, colour: Rgb): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue
      const p = (py * image.width + px) * 4
      for (let c = 0; c < 3; c++) image.data[p + c] = colour[c]
    }
  }
}

/** Glyphenbalken mit Kantenglättung — ohne sie prüft ein Testbild nichts. */
function glyphs(image: Bitmap, rect: { x: number; y: number; width: number; height: number }, ink: Rgb, bg: Rgb): void {
  for (let gx = rect.x + 2; gx + 5 < rect.x + rect.width; gx += 9) {
    for (let py = rect.y + 3; py < rect.y + rect.height - 3; py++) {
      for (let d = 0; d < 5; d++) {
        const mix = d === 0 || d === 4 ? 0.5 : 1
        const p = (py * image.width + gx + d) * 4
        for (let c = 0; c < 3; c++) image.data[p + c] = Math.round(bg[c] * (1 - mix) + ink[c] * mix)
      }
    }
  }
}

function node(over: Partial<NodeSignal> & { id: string }): NodeSignal {
  return {
    parentId: null,
    name: over.id,
    type: 'TEXT',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    zIndex: 1,
    opacity: 1,
    isText: false,
    isImage: false,
    hasFill: false,
    hasReactions: false,
    nameHints: [],
    ...over,
  }
}

const INK: Rgb = [18, 20, 24]
const PAPER: Rgb = [255, 255, 255]

function reasonFor(signals: NodeSignal[], image: Bitmap, id: string): SkipReason | 'gemessen' {
  const { results, skipped } = measureContrast({ image, signals, frameWidth: image.width, frameHeight: image.height })
  if (results.some((result) => result.nodeId === id)) return 'gemessen'
  return skipped.find((entry) => entry.nodeId === id)?.reason ?? 'kein-hintergrund'
}

// ---------------------------------------------------------------------------
// 1a — Drehung
// ---------------------------------------------------------------------------

describe('Drehung wird abgelesen, nicht geschätzt', () => {
  const image = canvas(200, 120, PAPER)
  const rect = { x: 20, y: 20, width: 140, height: 24 }
  glyphs(image, rect, INK, PAPER)
  const text = node({ id: 't', ...rect, isText: true, fontSize: 16, fillLuminance: pixelLuminance(...INK) })

  it('misst einen ungedrehten Knoten', () => {
    expect(reasonFor([text], image, 't')).toBe('gemessen')
  })

  it('verwirft einen gedrehten Knoten mit Grund statt eine Zahl zu erfinden', () => {
    expect(reasonFor([{ ...text, rotation: 12 }], image, 't')).toBe('gedreht')
    // Auch gegen den Uhrzeigersinn — geprüft wird der Betrag.
    expect(reasonFor([{ ...text, rotation: -12 }], image, 't')).toBe('gedreht')
  })

  it('nimmt Rechenreste aus der Transformationskette nicht für eine Drehung', () => {
    // Der Fall, der ein `!== 0` unbrauchbar macht: Figma leitet `rotation` aus
    // `relativeTransform` ab, und Auto-Layout-Ketten liefern dort solche Werte.
    expect(reasonFor([{ ...text, rotation: -1.4e-14 }], image, 't')).toBe('gemessen')
  })

  it('findet die Drehung eines Vorfahren — der Text selbst steht auf null', () => {
    // Eine gedrehte Gruppe mit geradem Textkind ist der Alltagsfall: `rotation`
    // ist relativ zum Elternknoten. Nur den Knoten zu prüfen fände die Gruppe
    // und nicht ihren Inhalt.
    const group = node({ id: 'g', x: 10, y: 10, width: 180, height: 60, zIndex: 0, rotation: 30, hasFill: true })
    const child = { ...text, parentId: 'g', zIndex: 1 }
    expect(reasonFor([group, child], image, 't')).toBe('gedreht')
    expect(rotationOf(child, new Map([['g', group]]))).toBe(30)
  })

  it('bildet das Maximum der Beträge und nicht die Summe', () => {
    // Zwei entgegengesetzte Drehungen können sich geometrisch aufheben — ob sie
    // es tun, hängt an Schwerpunkten, die `NodeSignal` nicht mitführt. Das
    // Maximum ist die sichere Richtung.
    const outer = node({ id: 'a', rotation: 30 })
    const inner = node({ id: 'b', parentId: 'a', rotation: -30 })
    expect(rotationOf(inner, new Map([['a', outer], ['b', inner]]))).toBe(30)
  })

  it('läuft nicht in einer Zykel-Elternkette fest', () => {
    const a = node({ id: 'a', parentId: 'b' })
    const b = node({ id: 'b', parentId: 'a', rotation: 5 })
    expect(rotationOf(a, new Map([['a', a], ['b', b]]))).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 1a — Verdeckung
// ---------------------------------------------------------------------------

describe('Verdeckung folgt aus Zeichenreihenfolge und Geometrie', () => {
  const rect = { x: 20, y: 20, width: 140, height: 24 }
  const build = (): { image: Bitmap; text: NodeSignal } => {
    const image = canvas(200, 120, PAPER)
    glyphs(image, rect, INK, PAPER)
    return {
      image,
      text: node({ id: 't', ...rect, isText: true, zIndex: 5, fontSize: 16, fillLuminance: pixelLuminance(...INK) }),
    }
  }

  it('verwirft Text unter einem später gezeichneten, malenden Element', () => {
    const { image, text } = build()
    box(image, 100, 16, 70, 32, [206, 46, 46])
    const badge = node({ id: 'badge', x: 100, y: 16, width: 70, height: 32, zIndex: 9, hasFill: true })
    expect(reasonFor([text, badge], image, 't')).toBe('verdeckt')
  })

  it('lässt ein FRÜHER gezeichnetes Element in Ruhe — das ist der Hintergrund', () => {
    // Der Fall, der eine naive Überlappungsprüfung wertlos macht: ein Scrim oder
    // eine Kachel unter dem Text ist genau das, wogegen gemessen werden soll.
    const { image, text } = build()
    const tile = node({ id: 'tile', x: 0, y: 0, width: 200, height: 120, zIndex: 0, hasFill: true })
    expect(reasonFor([text, tile], image, 't')).toBe('gemessen')
  })

  it('zählt einen Container ohne Fill nicht als Verdecker', () => {
    // Gruppen und Auto-Layout-Rahmen umfassen Text ständig und malen nichts.
    // Ohne diese Bedingung wäre in einer echten Datei fast jeder Text verdeckt.
    const { image, text } = build()
    const group = node({ id: 'group', x: 0, y: 0, width: 200, height: 120, zIndex: 9, type: 'GROUP' })
    expect(reasonFor([text, group], image, 't')).toBe('gemessen')
  })

  it('lässt einen Saum von wenigen Prozent stehen', () => {
    // Ein Textrahmen mit fester Breite reicht über das letzte Wort hinaus, und
    // das nächste Element beginnt dort. Das verschiebt kein Histogramm.
    const { image, text } = build()
    const neighbour = node({ id: 'n', x: rect.x + rect.width - 4, y: rect.y, width: 40, height: 24, zIndex: 9, hasFill: true })
    expect(occludedShare(text, [text, neighbour])).toBeCloseTo(4 / rect.width, 6)
    expect(reasonFor([text, neighbour], image, 't')).toBe('gemessen')
  })

  it('rechnet die Fläche als Vereinigung und nicht als Summe', () => {
    // Drei Icons zu je 5 %, die sich gegenseitig überdecken, sind als Summe
    // 15 % und in Wahrheit weniger. Bei einer Schwelle von 10 % entscheidet das.
    const { text } = build()
    const overlapping = [0, 1, 2].map((i) =>
      node({ id: `i${i}`, x: rect.x + 10 + i, y: rect.y, width: 20, height: 24, zIndex: 9, hasFill: true }),
    )
    const share = occludedShare(text, [text, ...overlapping])
    expect(share).toBeCloseTo(22 / rect.width, 6)
    expect(share).toBeLessThan((3 * 20) / rect.width)
  })

  it('zählt einen Vorfahren nie als Verdecker, auch wenn seine Ordnung es hergäbe', () => {
    const { image, text } = build()
    const parent = node({ id: 'p', x: 0, y: 0, width: 200, height: 120, zIndex: 99, hasFill: true })
    expect(reasonFor([{ ...text, parentId: 'p' }, parent], image, 't')).toBe('gemessen')
  })
})

describe('unionArea', () => {
  it('addiert getrennte Rechtecke und zählt überlappende einmal', () => {
    expect(unionArea([])).toBe(0)
    expect(unionArea([{ x: 0, y: 0, width: 10, height: 10 }])).toBe(100)
    expect(
      unionArea([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 0, width: 10, height: 10 },
      ]),
    ).toBe(200)
    // Zwei Quadrate mit halber Überlappung: 100 + 100 − 50 = 150.
    expect(
      unionArea([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 0, width: 10, height: 10 },
      ]),
    ).toBe(150)
    // Vollständig enthalten — das äußere allein.
    expect(
      unionArea([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 2, y: 2, width: 4, height: 4 },
      ]),
    ).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// 1b — der Textkern
// ---------------------------------------------------------------------------

describe('zeigt der Rahmen diesen Text überhaupt', () => {
  it('verwirft einen Rahmen, in dem die angemeldete Textfarbe nicht vorkommt', () => {
    // Maske, Clipping oder ein Effekt: der Knoten steht mit Farbe und Größe im
    // Baum, an seiner Stelle ist der leere Grund. Bis 1.3 meldete die Messung
    // dafür den Kontrast des Hintergrunds gegen sich selbst — eine Zahl über
    // etwas, das nicht zu sehen ist.
    const image = canvas(200, 120, PAPER)
    const text = node({
      id: 't',
      x: 20,
      y: 20,
      width: 140,
      height: 24,
      isText: true,
      fontSize: 16,
      fillLuminance: pixelLuminance(...INK),
    })
    expect(reasonFor([text], image, 't')).toBe('textkern-fehlt')
  })

  it('ist eine Anwesenheitsprüfung und keine Kontrastprüfung', () => {
    // DER WICHTIGSTE FALL DIESER DATEI. Wäre die Prüfung eine Forderung nach
    // Trennung, würde sie genau die Elemente verwerfen, die das Werkzeug finden
    // soll. Hellgrau auf Weiß ist 1,3:1 und muss als Befund herauskommen.
    const grey: Rgb = [235, 235, 235]
    const image = canvas(200, 120, PAPER)
    const rect = { x: 20, y: 20, width: 140, height: 24 }
    glyphs(image, rect, grey, PAPER)
    const text = node({ id: 't', ...rect, isText: true, fontSize: 16, fillLuminance: pixelLuminance(...grey) })

    const { results } = measureContrast({ image, signals: [text], frameWidth: 200, frameHeight: 120 })
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('durchgefallen')
    expect(results[0].ratio).toBeLessThan(1.5)
  })

  it('zählt genau das Fenster, das die Hintergrundsuche ausblendet', () => {
    // Wären es zwei verschiedene Fenster, könnte ein Element beide Prüfungen
    // bestehen und die Messung liefe trotzdem über Pixel, die sie für Text hält.
    const bin = 1 / HISTOGRAM_BINS
    // Genau im Fenster (±1 Bin) und knapp daneben (3 Bins entfernt).
    expect(textCoreShare([0.5, 0.5 + bin], 0.5)).toBe(1)
    expect(textCoreShare([0.5 + 3 * bin], 0.5)).toBe(0)
    expect(textCoreShare([], 0.5)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Die verworfene Prüfung — als Entscheidung festgehalten
// ---------------------------------------------------------------------------

describe('backgroundShare ist gemessen und nicht ausgeliefert', () => {
  it('verwirft nichts, weil keine Schwelle den Verlauf verschont', () => {
    expect(MEASURABLE_LIMITS.backgroundShare).toBeNull()
  })

  it('steht trotzdem im Ergebnis, damit die Entscheidung neu aufzumachen ist', () => {
    const image = canvas(200, 120, PAPER)
    const rect = { x: 20, y: 20, width: 140, height: 24 }
    glyphs(image, rect, INK, PAPER)
    const text = node({ id: 't', ...rect, isText: true, fontSize: 16, fillLuminance: pixelLuminance(...INK) })
    const { results } = measureContrast({ image, signals: [text], frameWidth: 200, frameHeight: 120 })
    expect(results[0].backgroundShare).toBeGreaterThan(0.4)
    expect(results[0].textCoreShare).toBeGreaterThan(MEASURABLE_LIMITS.textCoreShare)
    expect(results[0].occludedShare).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 1c — gezählt und benannt
// ---------------------------------------------------------------------------

describe('nicht messbare Elemente werden gezählt und benannt', () => {
  it('zählt je Grund statt die Gründe aufzuzählen', () => {
    // Die Form aus der Aufgabe: „3 Elemente nicht messbar (2 verdeckt, 1 gedreht)".
    expect(
      summariseSkipped([
        { nodeId: 'a', reason: 'verdeckt' },
        { nodeId: 'b', reason: 'gedreht' },
        { nodeId: 'c', reason: 'verdeckt' },
      ]),
    ).toBe('2 verdeckt, 1 gedreht')
  })

  it('lautet bei Gleichstand zwischen zwei Läufen gleich', () => {
    // Eine Warnung, deren Wortlaut sich ohne Grund ändert, sieht wie ein Befund aus.
    const first = summariseSkipped([
      { nodeId: 'a', reason: 'verdeckt' },
      { nodeId: 'b', reason: 'gedreht' },
    ])
    const second = summariseSkipped([
      { nodeId: 'b', reason: 'gedreht' },
      { nodeId: 'a', reason: 'verdeckt' },
    ])
    expect(first).toBe(second)
  })

  it('hat für jeden Grund ein Zählwort und einen Satz', () => {
    // Ein Grund ohne Text käme als `undefined` in eine Nutzermeldung.
    const reasons: SkipReason[] = [
      'chrome',
      'keine-textfarbe',
      'keine-schriftgroesse',
      'gedreht',
      'verdeckt',
      'kein-hintergrund',
      'textkern-fehlt',
      'hintergrund-zu-klein',
      'kein-nachbar',
    ]
    for (const reason of reasons) {
      expect(SKIP_LABELS[reason]).toBeTruthy()
      expect(SKIP_TEXT[reason]).toBeTruthy()
      // Das Zählwort ist kurz, der Satz erklärt — sonst passt die Zeile nicht.
      expect(SKIP_LABELS[reason].length).toBeLessThan(SKIP_TEXT[reason].length)
    }
    expect(Object.keys(SKIP_LABELS).sort()).toEqual([...reasons].sort())
    expect(Object.keys(SKIP_TEXT).sort()).toEqual([...reasons].sort())
  })

  it('gibt es einen Nullpunkt, gegen den die Prüfung gemessen werden kann', () => {
    // Ohne `NO_LIMITS` wäre „wie viele Elemente verliert die Prüfung" nicht
    // beantwortbar — die Zahl davor fehlte.
    const image = canvas(200, 120, PAPER)
    const rect = { x: 20, y: 20, width: 140, height: 24 }
    glyphs(image, rect, INK, PAPER)
    const rotated = node({
      id: 't',
      ...rect,
      isText: true,
      fontSize: 16,
      rotation: 12,
      fillLuminance: pixelLuminance(...INK),
    })
    const options = { image, signals: [rotated], frameWidth: 200, frameHeight: 120 }
    expect(measureContrast({ ...options, limits: NO_LIMITS }).results).toHaveLength(1)
    expect(measureContrast({ ...options, limits: MEASURABLE_LIMITS }).results).toHaveLength(0)
  })
})
