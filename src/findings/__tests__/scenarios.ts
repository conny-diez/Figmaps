/**
 * Die Erreichbarkeitsfälle — je Regel einer, der feuern muss, und einer, der
 * schweigen muss.
 *
 * WARUM SIE HIER STEHEN UND NICHT IM TEST: sie werden von **zwei** Tests
 * gelesen. `end-to-end.test.ts` prüft, dass jede Regel überhaupt auslösbar ist;
 * `robustness.test.ts` prüft dasselbe noch einmal unter verstellten
 * Engine-Parametern. Zwei Kopien derselben Frames wären zwei Definitionen
 * dessen, was „der Fall" ist — und die zweite driftet.
 *
 * ANLASS FÜR DEN ZWEITEN TEST (1.2): beim Umstieg von `blendAlpha` 0,3 auf 0,5
 * fiel der Erreichbarkeitstest von `cta-below-fold` um. Nicht, weil die Regel
 * falsch war, sondern weil der Fall auf der Kippe stand: der Kandidat unter dem
 * Fold führte mit 0,5227 gegen 0,4773, und das Verhältnis dreht sich schon bei
 * α ≈ 0,35. „Diese Regel ist erreichbar" hing an der dritten Nachkommastelle
 * eines Parameters, der mit der Regel nichts zu tun hat.
 *
 * Ein Fall, der nur bei genau den heutigen Konstanten das Erwartete tut, belegt
 * nichts über die Regel. Die Fälle hier sind deshalb mit **Abstand** gebaut,
 * und `robustness.test.ts` misst diesen Abstand nach.
 */
import type { Bitmap } from '../../engine/ops'
import type { NodeSignal } from '../../messages'

type Rgb = [number, number, number]

/** Eine leere Fläche in *Quell*pixeln; Frame-Koordinaten sind davon getrennt. */
export function canvas(width: number, height: number, colour: Rgb = [244, 245, 247]): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = colour[0]
    data[p + 1] = colour[1]
    data[p + 2] = colour[2]
    data[p + 3] = 255
  }
  return { width, height, data }
}

export function box(image: Bitmap, x: number, y: number, w: number, h: number, colour: Rgb): void {
  for (let py = Math.max(0, y); py < Math.min(image.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(image.width, x + w); px++) {
      const p = (py * image.width + px) * 4
      image.data[p] = colour[0]
      image.data[p + 1] = colour[1]
      image.data[p + 2] = colour[2]
    }
  }
}

let nextId = 0
export function signal(overrides: Partial<NodeSignal>): NodeSignal {
  nextId++
  return {
    id: `n${nextId}`,
    parentId: null,
    name: `node-${nextId}`,
    type: 'RECTANGLE',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    zIndex: nextId,
    opacity: 1,
    isText: false,
    isImage: false,
    hasFill: true,
    hasReactions: false,
    nameHints: [],
    ...overrides,
  }
}

export type ScenarioFrame = {
  source: Bitmap
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
  viewportOverride?: number
  /** Weitet den Regelsatz auf alles Implementierte — für die drei stillgelegten. */
  includeUnshipped?: boolean
}

export type Scenario = {
  id: string
  /** Die Regel, um die es geht. */
  rule: string
  /** Was passieren muss. */
  expect: 'fires' | 'silent'
  /**
   * Parameter-Störungen, unter denen dieser Fall **nicht** stabil ist, mit
   * Grund. Leer bei allen bis auf einen — und der eine ist ein Befund über die
   * Regel, nicht über den Fall.
   */
  knownUnstableUnder?: Array<{ perturbation: string; reason: string }>
  build: () => ScenarioFrame
}

/** Eine konventionelle Desktop-Landingpage: Nav, Hero, Headline, zwei Knöpfe. */
export function landingPage(): ScenarioFrame {
  const source = canvas(720, 450)
  box(source, 0, 0, 720, 36, [255, 255, 255]) // nav
  box(source, 40, 90, 300, 48, [22, 22, 28]) // headline
  box(source, 40, 160, 260, 60, [110, 110, 120]) // copy
  box(source, 40, 250, 140, 34, [20, 110, 220]) // primary button
  box(source, 200, 250, 110, 34, [225, 227, 232]) // secondary button
  box(source, 400, 80, 280, 200, [205, 120, 90]) // hero image

  // Frame-Koordinaten sind das Doppelte der Quelle, wie bei einem echten Export.
  const signals = [
    signal({ name: 'Headline', isText: true, fontSize: 44, fontWeight: 700, charCount: 28, x: 80, y: 180, width: 600, height: 96 }),
    signal({ name: 'Fließtext', isText: true, fontSize: 16, charCount: 160, x: 80, y: 320, width: 520, height: 120 }),
    signal({ name: 'Primary CTA Button', nameHints: ['button', 'cta'], hasReactions: true, x: 80, y: 500, width: 280, height: 68 }),
    signal({ name: 'Alle Angebote', nameHints: ['button'], x: 400, y: 500, width: 220, height: 68 }),
    signal({ name: 'Hero-Bild', isImage: true, x: 800, y: 160, width: 560, height: 400 }),
  ]
  return { source, signals, frameWidth: 1440, frameHeight: 900 }
}

export const SCENARIOS: readonly Scenario[] = [
  // --- cta-rank ------------------------------------------------------------
  {
    id: 'cta-rank feuert, wenn der primäre Knopf überholt wird',
    rule: 'cta-rank',
    expect: 'fires',
    build: () => {
      // Der Gegenspieler gewinnt über *Aufmerksamkeit*, nicht über Fläche: der
      // Score hat keinen Größenterm mehr, „riesig" ist also kein Weg mehr,
      // irgendetwas zu überholen.
      const source = canvas(720, 450, [248, 249, 250])
      box(source, 60, 40, 300, 150, [10, 10, 20]) // starker Block, oben links
      return {
        source,
        frameWidth: 1440,
        frameHeight: 900,
        signals: [
          signal({ name: 'Alle Angebote entdecken', nameHints: ['button'], hasReactions: true, x: 120, y: 80, width: 560, height: 280 }),
          // Derselbe Reaktions-Bonus, aber in der ruhigen unteren rechten Ecke.
          signal({ name: 'Jetzt anfragen', nameHints: ['button', 'cta'], hasReactions: true, x: 1000, y: 760, width: 380, height: 110 }),
        ],
      }
    },
  },
  {
    id: 'cta-rank schweigt, wenn der primäre Knopf führt',
    rule: 'cta-rank',
    expect: 'silent',
    build: () => {
      const page = landingPage()
      // Der primäre CTA ist das größte interaktive Element und trägt die Reaktion.
      page.signals = page.signals.filter((entry) => !entry.nameHints.includes('button'))
      page.signals.push(
        signal({ name: 'Primary CTA', nameHints: ['button', 'cta'], hasReactions: true, x: 80, y: 200, width: 600, height: 200 }),
        signal({ name: 'Kleiner Link', nameHints: ['link'], x: 1200, y: 800, width: 120, height: 30 }),
      )
      return page
    },
  },

  // --- dead-cta ------------------------------------------------------------
  {
    id: 'dead-cta feuert für einen Knopf, der viel leiser ist als seine Nachbarn',
    rule: 'dead-cta',
    expect: 'fires',
    build: () => {
      const source = canvas(720, 450)
      box(source, 40, 60, 240, 60, [10, 10, 200]) // lauter Knopf, oben
      return {
        source,
        frameWidth: 1440,
        frameHeight: 900,
        includeUnshipped: true,
        signals: [
          signal({ name: 'Jetzt starten', nameHints: ['button'], hasReactions: true, x: 80, y: 120, width: 480, height: 120 }),
          // Gleiche Größe, aber in der dunkelsten Ecke der Karte.
          signal({ name: 'Jetzt anfragen', nameHints: ['button'], x: 900, y: 800, width: 480, height: 90 }),
        ],
      }
    },
  },
  {
    id: 'dead-cta schweigt, wenn die Knöpfe dicht beieinander sitzen',
    rule: 'dead-cta',
    expect: 'silent',
    build: () => {
      const source = canvas(720, 450)
      box(source, 40, 120, 240, 60, [10, 10, 200])
      box(source, 320, 120, 240, 60, [10, 10, 200])
      return {
        source,
        frameWidth: 1440,
        frameHeight: 900,
        includeUnshipped: true,
        signals: [
          signal({ name: 'Jetzt starten', nameHints: ['button'], hasReactions: true, x: 80, y: 240, width: 480, height: 120 }),
          signal({ name: 'Mehr erfahren', nameHints: ['button'], x: 640, y: 240, width: 480, height: 120 }),
        ],
      }
    },
  },

  // --- competition ---------------------------------------------------------
  {
    id: 'competition feuert für zwei getrennte Blickfänge im selben Band',
    rule: 'competition',
    expect: 'fires',
    build: () => {
      // Beide Blickfänge müssen dort liegen, wo der Prior ohnehin hoch ist —
      // der Bildanteil wird additiv beigemischt und kann eine Region mit
      // niedrigem Prior nicht ins Rennen heben.
      //
      // GEOMETRIE MIT ABSTAND, seit 1.2 (siehe Modulkopf): die erste Fassung
      // stand bei 150 × 130 px mit 230 px Lücke, und das zweite Maximum lag bei
      // 0,709 gegen die Schwelle 0,65. Ein Gamma über der fertigen Karte drückt
      // alle Werte außer dem Maximum nach unten — bei `blendGamma` 2 fiel das
      // zweite Maximum auf 0,502 und die Regel konnte nicht mehr feuern.
      // Größere Blöcke heben das zweite Maximum (0,714 auch bei `blendGamma` 2),
      // die größere Lücke vertieft das Tal (Verhältnis 0,708 statt 0,822 bei
      // einer Schwelle von 0,9). Beide Bedingungen haben jetzt Luft.
      const source = canvas(720, 450, [248, 249, 250])
      box(source, 90, 35, 150, 180, [0, 0, 0])
      box(source, 360, 35, 150, 180, [0, 0, 0])
      // Keine Signale: diese Regel liest nur die Aufmerksamkeitskarte, und
      // strukturelle Signale würden eine dritte helle Region hinzufügen.
      return { source, signals: [], frameWidth: 1440, frameHeight: 900 }
    },
  },
  {
    id: 'competition schweigt bei einem einzelnen Blickfang',
    rule: 'competition',
    expect: 'silent',
    build: () => {
      // Der Textknoten sitzt seit 1.2 näher am Block: vorher stand er so weit
      // unten rechts, dass eine steilere Tonkurve (`post.gamma` 1,4) ihn zu
      // einer zweiten Region machte und die Regel fälschlich feuerte.
      const source = canvas(720, 450)
      box(source, 260, 120, 200, 120, [0, 0, 0]) // ein zentraler Block
      return {
        source,
        frameWidth: 1440,
        frameHeight: 900,
        signals: [
          signal({ name: 'Headline', isText: true, fontSize: 56, fontWeight: 700, charCount: 24, x: 520, y: 240, width: 400, height: 240 }),
        ],
      }
    },
  },

  // --- flat ----------------------------------------------------------------
  {
    id: 'flat feuert auf einem Screen ohne visuelle Hierarchie',
    rule: 'flat',
    expect: 'fires',
    knownUnstableUnder: [
      {
        perturbation: 'post.clipLowPercentile',
        reason:
          'Die Entscheidungsgröße ist die Konzentration des **Bildanteils**, und `clipLowPercentile` ist genau ' +
          'dessen Sockel: was darunter liegt, wird exakt 0 und trägt keine Masse mehr. Jede Anhebung des Clips ' +
          'erhöht die gemessene Konzentration mechanisch — auf einem gleichmäßig texturierten Screen genauso wie ' +
          'auf einem mit Blickfang. Das ist kein schwacher Testfall, sondern dieselbe Schwäche der Größe, an der ' +
          '`flat` schon dreimal gescheitert ist (siehe `rules.ts`). Wer den Clip verstellt, muss ' +
          '`flatConcentrationThreshold` neu schätzen; solange das nicht passiert ist, ist die Erreichbarkeit ' +
          'dieser Regel nicht behauptet.',
      },
    ],
    build: () => {
      // Gleichmäßig verteilter, gleich starker Inhalt über die *ganze* Fläche:
      // kein Element ist auffälliger als ein anderes. Nur die unteren zwei
      // Drittel zu füllen würde nicht mehr reichen — die Regel liest den
      // Bildanalyse-Anteil, und ein leeres oberes Drittel ist selbst ein
      // Kontrast (gemessen: 0,099 gegen 0,057).
      const source = canvas(720, 450)
      for (let y = 10; y < 444; y += 10) {
        for (let x = 4; x < 714; x += 12) box(source, x, y, 8, 7, [0, 0, 0])
      }
      return { source, signals: [], frameWidth: 1440, frameHeight: 900, includeUnshipped: true }
    },
  },
  {
    id: 'flat schweigt auf einem Screen mit einem dominanten Element',
    rule: 'flat',
    expect: 'silent',
    build: () => {
      const source = canvas(720, 450)
      box(source, 240, 140, 240, 170, [0, 0, 0])
      return { source, signals: [], frameWidth: 1440, frameHeight: 900, includeUnshipped: true }
    },
  },

  // --- cta-below-fold ------------------------------------------------------
  {
    id: 'cta-below-fold feuert, wenn der stärkste Knopf hinter Fold 1 sitzt',
    rule: 'cta-below-fold',
    expect: 'fires',
    build: () => {
      // Erreichbar, aber knapp — und das ist der Befund, kein Testdetail. Jeder
      // Abschnitt wird mit `sectionAttenuation^i` gedämpft, ein Kandidat unter
      // dem Fold startet also bei der halben Aufmerksamkeit. Es braucht eine
      // Prototype-Reaktion *und* einen starken Block dahinter, gegen einen
      // Gegenspieler, der beides nicht hat. Auf den konstruierten Frames kommt
      // diese Kombination nicht vor, dort feuert die Regel 0 von 24 Mal.
      //
      // DER GEGENSPIELER STAND BIS 1.2 OBEN LINKS (x 80, y 500), UND DAS WAR EIN
      // FEHLER IM TESTAUFBAU — siehe Modulkopf. Er steht jetzt dort, wo ein
      // Impressum-Link wirklich steht: unten rechts im ersten Viewport, in der
      // ruhigsten Ecke eines oben-links-lastigen Priors.
      const source = canvas(720, 1000, [248, 249, 250])
      box(source, 40, 470, 620, 200, [0, 0, 0]) // knapp hinter Fold 1
      return {
        source,
        frameWidth: 1440,
        frameHeight: 2000,
        includeUnshipped: true,
        signals: [
          signal({ name: 'Impressum', nameHints: ['link'], x: 1240, y: 820, width: 160, height: 40 }),
          signal({ name: 'Jetzt anfragen', nameHints: ['button', 'cta'], hasReactions: true, x: 100, y: 1000, width: 1200, height: 380 }),
        ],
      }
    },
  },
  {
    id: 'cta-below-fold schweigt, wenn der stärkste Knopf über Fold 1 liegt',
    rule: 'cta-below-fold',
    expect: 'silent',
    build: () => {
      const source = canvas(720, 2000)
      box(source, 40, 100, 400, 120, [20, 110, 220])
      return {
        source,
        frameWidth: 1440,
        frameHeight: 4000,
        includeUnshipped: true,
        signals: [
          signal({ name: 'Jetzt anfragen', nameHints: ['button', 'cta'], hasReactions: true, x: 80, y: 200, width: 800, height: 240 }),
          signal({ name: 'Fußzeilen-Link', nameHints: ['link'], x: 80, y: 3800, width: 120, height: 40 }),
        ],
      }
    },
  },

  // --- cold-fold -----------------------------------------------------------
  {
    id: 'cold-fold feuert, wenn ein späterer Abschnitt stärker bündelt',
    rule: 'cold-fold',
    expect: 'fires',
    build: () => {
      // Voller, gleichmäßig texturierter erster Viewport; ein starker
      // Blickfang weit unten.
      const source = canvas(720, 2000)
      for (let y = 20; y < 440; y += 40) for (let x = 20; x < 700; x += 60) box(source, x, y, 40, 24, [150, 150, 158])
      box(source, 250, 1450, 220, 160, [0, 0, 0])
      return { source, signals: [], frameWidth: 1440, frameHeight: 4000 }
    },
  },
  {
    id: 'cold-fold schweigt, wenn der erste Abschnitt am stärksten bündelt',
    rule: 'cold-fold',
    expect: 'silent',
    build: () => {
      const source = canvas(720, 2000)
      box(source, 250, 120, 220, 160, [0, 0, 0])
      for (let y = 1000; y < 1980; y += 40) for (let x = 20; x < 700; x += 60) box(source, x, y, 40, 24, [150, 150, 158])
      return { source, signals: [], frameWidth: 1440, frameHeight: 4000 }
    },
  },
]
