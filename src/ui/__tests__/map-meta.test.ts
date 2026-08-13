/**
 * 1.3 — der Test, der bis dahin **ganz** fehlte.
 *
 * DIE EINE FORDERUNG: eine leere oder lückenhafte Asset-Tabelle darf keine
 * Kopfzeile erzeugen, die von der intakten nicht zu unterscheiden ist.
 *
 * Warum es diesen Test nicht gab, ist selbst Teil des Befunds. Die Kopfzeile
 * entstand in `ui/pipeline.ts`, und die dekodiert PNGs und zeichnet auf ein
 * Canvas — im Node-Test nicht lauffähig. Der Fall „Asset fehlt, Zeile behauptet
 * es trotzdem" war also nicht prüfbar, ohne einen Browser zu starten, und blieb
 * deshalb ungeprüft. Nicht aus Nachlässigkeit, sondern weil die Zuständigkeit am
 * falschen Ort lag. `ui/map-meta.ts` ist rein; damit ist der Test billig.
 *
 * Geprüft wird für **Kategorie und Betrachtungsdauer getrennt**. Die beiden
 * fallen unterschiedlich aus: fehlt die Kategorie, gibt es überhaupt keinen
 * Datenprior und die analytische Glocke rechnet; fehlt nur die Dauer, weicht
 * `priorMap` auf 3 s aus und rechnet weiter mit Daten. Ein Test, der nur
 * „irgendwas ist anders" prüft, würde den zweiten Fall durchlassen.
 */
import { describe, expect, it } from 'vitest'
import { metaLine } from '../../figma/place'
import { PROFILE_LABELS } from '../../engine/params'
import {
  assetKey,
  PRIOR_ASSETS,
  resolvePriorAsset,
  type PriorAsset,
  type PriorAssetId,
  type PriorDuration,
} from '../../engine/priors'
import { mapMetaFor } from '../map-meta'

/**
 * Die ausgelieferte Tabelle ohne einzelne Schlüssel.
 *
 * Über eine Kopie und nicht über ein Mock: `resolvePriorAsset` nimmt die Tabelle
 * als Parameter, weil dieselbe Injektion schon `blur` und `priorProvider` in der
 * Engine tragen. Ein Mock würde prüfen, dass die Funktion aufgerufen wird; die
 * Kopie prüft, was dabei herauskommt.
 */
function assetsWithout(...keys: string[]): Record<string, PriorAsset> {
  const out: Record<string, PriorAsset> = { ...PRIOR_ASSETS }
  for (const key of keys) delete out[key]
  return out
}

function headerFor(
  assets: Record<string, PriorAsset>,
  id: PriorAssetId,
  duration: PriorDuration,
  profile: 'glance' | 'scan' | 'read',
): { line: string; warnings: string[]; attribution?: string } {
  const { meta, warnings } = mapMetaFor({
    resolution: resolvePriorAsset(id, duration, assets),
    uiType: 'auto',
    profile,
  })
  return { line: metaLine(meta, 'heat'), warnings, attribution: meta.attribution }
}

describe('die Kopfzeile kommt aus dem geladenen Asset', () => {
  it('nennt bei intakter Tabelle Kategorie und Dauer', () => {
    // Der Normalfall, damit die Vergleiche unten etwas bedeuten.
    const intact = headerFor(PRIOR_ASSETS, 'mobile', 3, 'scan')
    expect(intact.line).toContain('Blickverhalten: Mobile App (automatisch)')
    expect(intact.line).toContain(`Betrachtungsdauer: ${PROFILE_LABELS.scan}`)
    expect(intact.warnings).toEqual([])
    expect(intact.attribution).toBeTruthy()
  })

  it('KATEGORIE fehlt: die Zeile nennt keine Kategorie und sagt die Ersatzrechnung an', () => {
    // Alle Dauern von `mobile` weg — dann gibt es für einen Telefon-Frame keinen
    // Datenprior, und die analytische F-Muster-Glocke von 1.0 rechnet. Im Panel
    // verschwindet „Mobile App" aus dem Dropdown, aber „Automatisch erkennen"
    // ist die Voreinstellung und leitet trotzdem dorthin.
    const assets = assetsWithout(assetKey('mobile', 1), assetKey('mobile', 3), assetKey('mobile', 7))
    const broken = headerFor(assets, 'mobile', 3, 'scan')
    const intact = headerFor(PRIOR_ASSETS, 'mobile', 3, 'scan')

    expect(broken.line).not.toBe(intact.line)
    expect(broken.line).not.toContain('Blickverhalten')
    expect(broken.line).not.toContain('Mobile App')
    expect(broken.line).toContain('analytische Positionsannahme')
    expect(broken.warnings).toHaveLength(1)
    expect(broken.warnings[0]).toContain('Mobile App')
    // Keine Datengrundlage: kein Wert aus UEyes ist in diese Karte eingegangen.
    expect(broken.attribution).toBeUndefined()
  })

  it('DAUER fehlt: die Zeile nennt die gerechnete Dauer, nicht die eingestellte', () => {
    // Nur `web@7s` weg. `priorMap` weicht auf `web@3s` aus und rechnet weiter mit
    // Daten — die Kategorie stimmt also, die Dauer nicht. Bis 1.2 behauptete die
    // Kopfzeile weiter „Lesen (7 s)", und nach Epic D ist der Unterschied ein
    // GEMESSENER (+0,012 bis +0,021 CC): die Zeile behauptete genau die
    // Eigenschaft, die gerade nicht galt.
    const assets = assetsWithout(assetKey('web', 7))
    const broken = headerFor(assets, 'web', 7, 'read')
    const intact = headerFor(PRIOR_ASSETS, 'web', 7, 'read')

    expect(intact.line).toContain(`Betrachtungsdauer: ${PROFILE_LABELS.read}`)
    expect(broken.line).not.toBe(intact.line)
    expect(broken.line).not.toContain(PROFILE_LABELS.read)
    expect(broken.line).toContain(`Betrachtungsdauer: ${PROFILE_LABELS.scan}`)
    // Die Kategorie gilt weiter — es wurde ein Datenprior gelesen, nur ein
    // anderer. Eine Prüfung, die hier „alles weg" erwartete, wäre zu grob.
    expect(broken.line).toContain('Blickverhalten: Webseite (automatisch)')
    expect(broken.attribution).toBeTruthy()
    expect(broken.warnings).toHaveLength(1)
    expect(broken.warnings[0]).toContain(PROFILE_LABELS.read)
    expect(broken.warnings[0]).toContain(PROFILE_LABELS.scan)
  })

  it('leere Tabelle: keine Kopfzeile, die von der intakten nicht zu unterscheiden ist', () => {
    // Der Grenzfall, der bis 1.2 der einzige *sichtbare* war — und auch dort nur
    // dadurch, dass eine Zeile verschwand. Das Verschwinden einer Zeile ist keine
    // Meldung.
    for (const id of ['web', 'mobile', 'desktop', 'poster'] as PriorAssetId[]) {
      const broken = headerFor({}, id, 3, 'scan')
      expect(broken.line).not.toBe(headerFor(PRIOR_ASSETS, id, 3, 'scan').line)
      expect(broken.line).not.toContain('Blickverhalten')
      expect(broken.line).not.toContain('Betrachtungsdauer')
      expect(broken.warnings).toHaveLength(1)
    }
  })

  it('erkennt einen Eintrag mit leerer Nutzlast als fehlend', () => {
    // Genau der Fall, den `check-release.mjs` im Build bewacht: der Schlüssel ist
    // da, die Daten sind es nicht. Eine Prüfung auf Anwesenheit des Schlüssels
    // hielte ihn für geladen — und die Zeile wäre wieder eine Behauptung.
    const hollow: Record<string, PriorAsset> = {
      ...PRIOR_ASSETS,
      [assetKey('mobile', 3)]: { width: 32, height: 32, data: '', source: 'x', count: 0 },
      [assetKey('mobile', 1)]: { width: 32, height: 32, data: '', source: 'x', count: 0 },
      [assetKey('mobile', 7)]: { width: 32, height: 32, data: '', source: 'x', count: 0 },
    }
    expect(resolvePriorAsset('mobile', 3, hollow).source).toBe('analytic')
    expect(headerFor(hollow, 'mobile', 3, 'scan').line).not.toContain('Mobile App')
  })

  it('nennt ohne Auskunft der Engine überhaupt keine Kategorie', () => {
    // Eine Engine ohne `priorResolution` — der Fall, den `AttentionEngine`
    // ausdrücklich erlaubt. Sie darf keine Zeile erzeugen, die aussieht wie eine
    // mit Referenzdaten.
    const { meta, warnings } = mapMetaFor({ resolution: null, uiType: 'auto', profile: 'scan' })
    expect(meta).toEqual({})
    expect(warnings).toEqual([])
    const line = metaLine(meta, 'heat')
    expect(line).not.toContain('Blickverhalten')
    expect(line).not.toContain('Betrachtungsdauer')
    // Der Disclaimer und die Engine-Version bleiben — sie hängen an keiner
    // Datenquelle.
    expect(line).toContain('Algorithmische Vorhersage')
  })

  it('nennt bei ausdrücklicher Wahl kein „(automatisch)"', () => {
    const { meta } = mapMetaFor({
      resolution: resolvePriorAsset('desktop', 3, PRIOR_ASSETS),
      uiType: 'desktop',
      profile: 'scan',
    })
    expect(meta.screenBehaviour).toBe('Desktop-Anwendung')
  })
})

describe('der Ebenenname behauptet keine Dauer, die nicht gerechnet hat', () => {
  it('trägt bei der Ersatzrechnung keine Dauer', () => {
    // Der Ebenenname reist mit, wenn jemand den Frame kopiert — dieselbe
    // Begründung, mit der die Contrastmap keine Vorhersage-Parameter im Namen
    // trägt. Vor 1.3 stand hier `meta ? …` und hätte „— undefined" geschrieben.
    const { meta } = mapMetaFor({
      resolution: resolvePriorAsset('mobile', 3, {}),
      uiType: 'auto',
      profile: 'read',
    })
    expect(meta.duration).toBeUndefined()
  })
})
