/**
 * 1.3 — die Herkunftsangabe über einer Karte, aus dem, was gelaufen ist.
 *
 * DAS TEXT-BINDUNGS-PRINZIP. Drei Fälle in 1.2 hatten dieselbe Form: der Text,
 * der eine Ausgabe beschreibt, entstand **parallel** zur Ausgabe, und niemand
 * prüfte, ob er stimmt.
 *
 *   „Contrastmap — vorhergesagt"   der Titel kam aus einer Vorlage für
 *                                  Vorhersagen, die Karte war eine Messung
 *   vier README-Statuszeilen       standen auf einem Stand, den der Code
 *                                  längst verlassen hatte
 *   „Betrachtungsdauer: 7 s"       während `priorMap` stumm auf 3 s ausgewichen
 *                                  war
 *
 * Das Prinzip daraus: **jede Herkunftsangabe muss aus dem stammen, was
 * tatsächlich gelaufen ist, nicht aus dem, was angefordert wurde.**
 *
 * WARUM DIESE DATEI EXISTIERT UND DER CODE NICHT IN `pipeline.ts` STEHT. Die
 * Pipeline dekodiert PNGs und zeichnet auf ein Canvas; sie ist im Node-Test
 * nicht lauffähig. Genau deshalb gab es für die Kopfzeile bis 1.3 **keinen
 * einzigen Test** — der Fall „Asset fehlt, Zeile behauptet es trotzdem" war
 * nicht prüfbar, ohne einen Browser zu starten. Diese Funktion ist rein: sie
 * bekommt die Auflösung der Engine und die Einstellung und gibt Text zurück.
 */
import { PROFILE_DURATIONS, PROFILE_LABELS, type ProfileId } from '../engine/params'
import {
  PRIOR_ASSET_LABELS,
  PRIOR_ATTRIBUTION_SHORT,
  type PriorDuration,
  type PriorResolution,
} from '../engine/priors'
import type { MapMeta, UiTypeSetting } from '../messages'

/**
 * Das Profil, dessen Betrachtungsdauer das ist — für die Beschriftung.
 *
 * Die Beschriftung muss die **gerechnete** Dauer nennen, und die kommt aus dem
 * geladenen Asset in Sekunden. `PROFILE_LABELS` ist nach Profil geschlüsselt;
 * ohne diese Umkehrung müsste der Aufrufer die angeforderte Beschriftung
 * weiterverwenden — also genau den Fehler machen, den 1.3 behebt.
 */
function profileForDuration(seconds: PriorDuration): ProfileId | null {
  const ids = Object.keys(PROFILE_DURATIONS) as ProfileId[]
  return ids.find((id) => PROFILE_DURATIONS[id] === seconds) ?? null
}

export type MapMetaInput = {
  /** Was die Engine für diesen Frame tatsächlich gerechnet hat. */
  resolution: PriorResolution | null
  /** Was der Nutzer eingestellt hat — nur für das „(automatisch)". */
  uiType: UiTypeSetting
  /** Was der Nutzer angefordert hat — nur für den Text der Warnung. */
  profile: ProfileId
}

/**
 * Kopfzeile und Warnungen einer Karte.
 *
 * Die Warnungen gehen in denselben `warnings: string[]`, in dem schon der
 * Bänder-Hinweis steht — der Kanal existierte, gefragt hat ihn niemand.
 */
export function mapMetaFor(input: MapMetaInput): { meta: MapMeta; warnings: string[] } {
  const { resolution, uiType, profile } = input
  const warnings: string[] = []

  // Ohne Auskunft der Engine wird **keine** Kategorie genannt. Das ist der
  // wichtigste Zweig dieser Funktion: eine Engine, die nichts über ihren
  // Ortsprior sagt, darf keine Zeile erzeugen, die von einer intakten nicht zu
  // unterscheiden ist.
  if (!resolution) return { meta: {}, warnings }

  const suffix = uiType === 'auto' ? ' (automatisch)' : ''

  if (resolution.source === 'analytic') {
    // Die Ersatzrechnung sagt sich an. Kategorie und Betrachtungsdauer fehlen
    // **beide**, und das ist keine Auslassung: ohne Referenzdaten geht keine der
    // beiden Größen in die Karte ein. Nach Epic D ist die Dauer ein Effekt des
    // Ortspriors und nicht der Gewichte — fällt der Prior weg, ändert der
    // Umschalter nichts mehr, und eine Zeile, die ihn nennt, behauptet eine
    // Abhängigkeit, die es gerade nicht gibt.
    warnings.push(
      `Für „${PRIOR_ASSET_LABELS[resolution.asset]}" liegen keine Referenzdaten im Build — ` +
        'gerechnet hat die analytische Positionsannahme von 1.0. ' +
        'Die Karte nennt deshalb kein Blickverhalten und keine Betrachtungsdauer.',
    )
    return { meta: { fallback: 'ohne Referenzdaten, analytische Positionsannahme' }, warnings }
  }

  const label = profileForDuration(resolution.duration)
  if (resolution.duration !== resolution.requestedDuration) {
    // Der Fall aus PR #11, jetzt mit Meldung. Nach Epic D ist der Unterschied
    // gemessen (+0,012 bis +0,021 CC) — die Zeile behauptete also genau die
    // Eigenschaft, die gerade nicht galt.
    warnings.push(
      `Für ${PROFILE_LABELS[profile]} liegt kein Ortsprior im Build — gerechnet wurde mit ` +
        `${label ? PROFILE_LABELS[label] : `${resolution.duration} s`}. ` +
        'Nach Epic D ist der Unterschied gemessen; die Kopfzeile nennt deshalb die gerechnete Dauer.',
    )
  }

  return {
    meta: {
      screenBehaviour: `${PRIOR_ASSET_LABELS[resolution.asset]}${suffix}`,
      // Die **gerechnete** Dauer, nicht die eingestellte.
      ...(label ? { duration: PROFILE_LABELS[label] } : {}),
      // Die Datengrundlage hängt daran, dass wirklich ein Wert daraus
      // eingegangen ist — nicht daran, dass das Bundle einen trägt. Dieselbe
      // Begründung, mit der `figma/place.ts` sie unter reinen Messkarten
      // weglässt: sie belegt eine Abhängigkeit, und ohne gelesenes Asset gibt es
      // keine. (Die CC-BY-Pflicht für die Weitergabe bleibt unberührt, sie steht
      // in NOTICE.md.)
      attribution: PRIOR_ATTRIBUTION_SHORT,
    },
    warnings,
  }
}
