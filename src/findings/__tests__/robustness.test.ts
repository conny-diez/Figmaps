/**
 * Halten die Erreichbarkeitsfälle auch, wenn jemand an der Engine dreht?
 *
 * ANLASS (1.2 A): der Umstieg von `blendAlpha` 0,3 auf 0,5 hat den
 * Erreichbarkeitstest von `cta-below-fold` umgeworfen. Die Regel war in
 * Ordnung, der Fall war es nicht: der Kandidat unter dem Fold führte mit
 * 0,5227 gegen 0,4773, und das Verhältnis dreht sich schon bei α ≈ 0,35. Die
 * Aussage „diese Regel ist erreichbar" hing damit an der dritten
 * Nachkommastelle eines Parameters, der mit der Regel nichts zu tun hat.
 *
 * Der Test danach zu suchen, welche der übrigen elf Fälle dieselbe
 * Zerbrechlichkeit haben, hat zwei weitere gefunden — beide bei `competition`,
 * beide in unterschiedliche Richtungen:
 *
 *   competition/feuert   kippte unter `blendGamma` — ein Gamma über der
 *                        fertigen Karte drückt alle Werte außer dem Maximum
 *                        nach unten, das zweite Maximum fiel unter 0,65.
 *   competition/schweigt kippte unter `post.gamma` — die steilere Tonkurve
 *                        machte einen abseits stehenden Textknoten zur
 *                        zweiten Region.
 *
 * Beide Fälle sind repariert (größere Blöcke, größere Lücke, Textknoten näher
 * am Block — siehe `scenarios.ts`). Dieser Test hält das fest, damit die
 * nächste Parameteränderung nicht wieder als „Regel kaputt" erscheint.
 *
 * **Was dieser Test NICHT behauptet:** dass die Regeln unter diesen Parametern
 * gleich *häufig* feuern. Das tun sie nachweislich nicht — `competition`
 * verdreifachte seine Quote beim Alpha-Wechsel (siehe README, A5). Geprüft
 * wird nur, dass ein Fall mit klarer, bekannter Antwort diese Antwort behält.
 * Feuerraten gehören an echte Daten, nicht an zwölf konstruierte Frames.
 *
 * Laufzeit: 12 Fälle x 5 Konfigurationen. Die Störungen sind bewusst die
 * **Ränder** der Bereiche aus `eval/sharpness.ts`, nicht ein feines Gitter —
 * was am Rand hält, hält dazwischen.
 */
import { describe, expect, it } from 'vitest'
import { cloneParams, resolveParams, type EngineParams } from '../../engine/params'
import { runScenario } from './run-scenario'
import { SCENARIOS } from './scenarios'

type Perturbation = { id: string; lever: string; params: EngineParams }

/**
 * Die Ränder der Hebel, die die Karte formen — jeweils gegen den
 * **ausgelieferten** Stand gerechnet, nicht gegen einen historischen.
 *
 * `blendAlpha` 0,3 und `blendGamma` 1 sind bewusst die Werte *vor* 1.2: wenn
 * ein Fall nur mit der neuen Konfiguration hält, ist er wieder so
 * zerbrechlich, wie `cta-below-fold` es war. Die übrigen Punkte liegen jenseits
 * des gemessenen Bereichs (`eval/sharpness.ts`), damit auch eine künftige
 * Bewegung abgedeckt ist.
 */
function perturbations(): Perturbation[] {
  const base = (): EngineParams => cloneParams(resolveParams('hybrid-v1'))
  const out: Perturbation[] = []

  const withAlpha = base()
  withAlpha.blendAlpha = 0.3
  out.push({ id: 'blendAlpha 0,3 (der Wert vor 1.2)', lever: 'blendAlpha', params: withAlpha })

  // Beide Ränder des Bereichs, den die Messung offen lässt: 1 ist das Verhalten
  // vor 1.2 A6 (kein Gamma über der fertigen Karte), 2,5 der größte Wert, der
  // im Sweep überhaupt noch irgendwo hielt (Webpage; Mobile verliert dort CC
  // belastbar, siehe `config.ts` → `hybrid`). Der ausgelieferte Wert 2 liegt
  // dazwischen und braucht keine eigene Zeile — das ist der Ist-Zustand in
  // `end-to-end.test.ts`.
  const withoutBlendGamma = base()
  withoutBlendGamma.blendGamma = 1
  out.push({ id: 'blendGamma 1 (kein Gamma, wie vor 1.2 A6)', lever: 'blendGamma', params: withoutBlendGamma })

  const withMoreBlendGamma = base()
  withMoreBlendGamma.blendGamma = 2.5
  out.push({ id: 'blendGamma 2,5 (die gemessene Obergrenze)', lever: 'blendGamma', params: withMoreBlendGamma })

  const withGamma = base()
  withGamma.post = { ...withGamma.post, gamma: 2 }
  out.push({ id: 'post.gamma 2', lever: 'post.gamma', params: withGamma })

  const withBlur = base()
  withBlur.post = { ...withBlur.post, blurSigmaRatio: 0.02 }
  out.push({ id: 'post.blurSigmaRatio 0,02', lever: 'post.blurSigmaRatio', params: withBlur })

  const withClip = base()
  withClip.post = { ...withClip.post, clipLowPercentile: 40 }
  out.push({ id: 'post.clipLowPercentile 40', lever: 'post.clipLowPercentile', params: withClip })

  return out
}

describe('Erreichbarkeit unter verstellten Engine-Parametern', () => {
  const perts = perturbations()

  for (const scenario of SCENARIOS) {
    for (const pert of perts) {
      const unstable = scenario.knownUnstableUnder?.find((entry) => entry.perturbation === pert.lever)

      it(`${scenario.id} — ${pert.id}${unstable ? ' (bekannt instabil)' : ''}`, async () => {
        const ids = await runScenario(scenario.build(), pert.params)
        const fired = ids.includes(scenario.rule)

        if (unstable) {
          // Kein `expect` auf das Ergebnis: dieser Fall *darf* kippen, und der
          // Grund steht im Szenario. Geprüft wird stattdessen, dass die
          // Ausnahme begründet ist — eine Ausnahme ohne Begründung wäre nur
          // ein stillgelegter Test.
          expect(unstable.reason.length).toBeGreaterThan(80)
          return
        }

        if (scenario.expect === 'fires') expect(fired).toBe(true)
        else expect(fired).toBe(false)
      })
    }
  }

  it('jede Ausnahme nennt einen Hebel, den es wirklich gibt', () => {
    const levers = new Set(perts.map((pert) => pert.lever))
    for (const scenario of SCENARIOS) {
      for (const entry of scenario.knownUnstableUnder ?? []) {
        expect(levers).toContain(entry.perturbation)
      }
    }
  })

  it('höchstens ein Fall ist als instabil eingetragen', () => {
    // Eine Ausnahmeliste, die wächst, ist ein Feigenblatt. Wenn hier ein
    // zweiter Eintrag nötig wird, ist das eine Entscheidung, kein Nachtrag.
    const exceptions = SCENARIOS.flatMap((scenario) =>
      (scenario.knownUnstableUnder ?? []).map((entry) => `${scenario.id} / ${entry.perturbation}`),
    )
    expect(exceptions).toEqual(['flat feuert auf einem Screen ohne visuelle Hierarchie / post.clipLowPercentile'])
  })
})
