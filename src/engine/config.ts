/**
 * The single tuning surface of the plugin.
 *
 * Every weight, sigma, threshold and magic number of the attention engine,
 * the clickmap scorer and the renderers lives here — nothing algorithmic is
 * allowed to inline a constant (see PRD §12).
 *
 * All sigmas expressed in "px" refer to the *analysis resolution*
 * (`ENGINE_CONFIG.analysisEdge`, longer edge = 512 px), not to frame pixels.
 */

/**
 * Bumped whenever the prediction changes. Appears in layer names and labels.
 * Must match `ENGINE_CONFIG.activeConfigId` — see `params.ts` for the list of
 * named configurations the eval harness can compare.
 *
 * `hybrid-v1` since 2026-08-08: data-estimated location prior plus additive
 * image analysis. Beats every image-independent baseline in all four metrics
 * across a 5-fold cross-validation over 495 images per UI category
 * (see README, „Kreuzvalidierung"). `heuristic-v1` remains available for
 * comparison and is what the harness reports as the frozen 1.0 reference.
 */
export const ENGINE_VERSION = 'hybrid-v1'

/**
 * Name tokens that mark a node as probably interactive (FR-3).
 *
 * Matched as substrings of a lowercased name token, so the shortest useful stem
 * is listed: `melden` covers „Anmelden" and „Abmelden", `schalter` covers
 * „Umschalter", `feld` covers „Eingabefeld" und „Suchfeld".
 *
 * **Deutsch gehört dazu, nicht als Zugabe.** Figma-Dateien werden in der
 * Sprache benannt, in der das Team arbeitet, und in einer durchgängig deutsch
 * benannten Bibliothek traf die rein englische Liste *keinen einzigen* Namen
 * (gemessen an 24 typischen deutschen Ebenennamen: 0 Treffer). Das betrifft
 * nicht nur die ausgeblendete Clickmap: `cta-rank` und `cta-below-fold` sind
 * ausgeliefert und hängen an denselben Kandidaten.
 *
 * Bekannte Fehlgriffe, bewusst in Kauf genommen: `karte` trifft auch eine
 * „Standortkarte", `reiter` steckt in „breiter", `feld` in „Umfeld". Ein
 * Kandidat zu viel verschiebt eine Rangfolge, ein fehlender macht die Regel
 * blind — und die zweite Richtung ist die, die auf dem Onboarding-Screen
 * schiefging.
 */
export const INTERACTIVE_KEYWORDS: readonly string[] = [
  // englisch
  'button',
  'btn',
  'cta',
  'link',
  'input',
  'field',
  'checkbox',
  'radio',
  'toggle',
  'switch',
  'tab',
  'chip',
  'menu',
  'dropdown',
  'select',
  'card',
  'nav',
  'accordion',
  // deutsch
  'knopf',
  'schaltfläche',
  'schalter',
  'karte',
  'kachel',
  'kategorie',
  'melden',
  'registrier',
  'senden',
  'weiter',
  'zurück',
  'suche',
  'filter',
  'auswahl',
  'eingabe',
  'feld',
  'reiter',
  'menü',
  'kästchen',
  'verweis',
  'akkordeon',
]

export const ENGINE_CONFIG = {
  /** Named configuration the plugin ships (see `params.ts`). */
  activeConfigId: ENGINE_VERSION,

  /** Longer edge of the map the engine computes on. Not negotiable (PRD §10). */
  analysisEdge: 512,

  /**
   * Bounds for the decoded source bitmap that sections are cropped out of
   * (Epic B). Capped on *width*, not on the longer edge: a 6.000 px tall frame
   * still needs enough horizontal resolution for every section to be sampled
   * down to `analysisEdge` rather than up. `maxPixels` is the memory guard.
   */
  analysisSource: {
    maxWidth: 1024,
    maxPixels: 12_000_000,
  },

  /** Epic B — viewport derivation and segmentation. */
  viewport: {
    /** Frames at least this wide are treated as desktop. */
    desktopMinWidth: 1024,
    /**
     * Prior-Auswahl (`priors/index.ts`): mobil ist ein Frame nur, wenn er
     * schmaler als das hier ist **und** hochkant. Beides zusammen, weil jedes
     * Kriterium für sich einen Alltagsfall falsch macht — siehe dort.
     *
     * 600 px trennt Telefone (360–430) von Tablets (768+) in Design-Pixeln.
     * Diese Zahl ist an UEyes **nicht** überprüfbar, weil der Datensatz
     * Geräte-Pixel speichert.
     */
    mobileMaxWidth: 600,
    /**
     * Ab diesem Höhen-zu-Breiten-Verhältnis gilt ein schmaler Frame als
     * hochkant. 1,5 trennt auf den 1.980 gelabelten UEyes-Bildern Webseite und
     * Mobile fehlerfrei (je 495/495); Telefone liegen bei 1,78–2,17,
     * Webseiten bei höchstens 1,11.
     */
    mobileMinAspect: 1.5,
    /** Assumed visible height of a desktop viewport, in frame px. */
    desktopHeight: 900,
    /** Mobile approximation: viewport height = frame width x this factor. */
    mobileHeightFactor: 2.0,
    /** Below this many viewport heights a frame is analysed as a whole. */
    segmentThreshold: 1.5,
    /** Overlap between neighbouring sections, as a share of a viewport height. */
    overlap: 0.2,
    /** Refuse to cut a frame into more than this many sections. */
    maxSections: 24,

    /**
     * Scroll-depth attenuation of a section's contribution to the composed map.
     * Section `i` is scaled by `max(sectionAttenuationFloor, factor^i)`.
     *
     * WARUM: Jeder Abschnitt wird für sich normiert und bekommt seinen eigenen
     * top-lastigen Ortsprior. Ohne Dämpfung erzeugt das auf inhaltsarmen
     * Flächen ein Band am Kopf *jedes* Abschnitts, im Abstand eines
     * Abschnittsschritts — sichtbar gemessen auf einem grauen 1440x4000-Frame.
     *
     * ANNAHME, KEINE MESSUNG: Dass Aufmerksamkeit mit der Scrolltiefe abnimmt,
     * ist aus Analytics gut belegt, aber **wir haben es nicht gemessen**. UEyes
     * enthält ausschließlich einzelne Viewport-Ausschnitte, keine gescrollten
     * Seiten; mit diesem Datensatz ist weder der Verlauf noch der Startwert
     * überprüfbar. Der Faktor ist so gewählt, dass die Bänder auf dem
     * Testframe verschwinden — ein Kriterium für die Darstellung, nicht für
     * die Vorhersagegüte. Siehe NOTICE.md, „Nicht gemessene Annahmen".
     */
    sectionAttenuation: 0.5,
    /**
     * Untergrenze der Dämpfung.
     *
     * Bewusst knapp unter der Transparenzschwelle des Renderers gewählt: auf
     * inhaltsfreien Flächen fallen tiefe Abschnitte damit unter die Schwelle
     * und werden gar nicht gezeichnet, während ein echter Blickfang dort noch
     * schwach sichtbar bleibt. Eine höhere Untergrenze erzeugt wieder ein
     * Plateau gleich heller Bänder — genau das Artefakt, das die Dämpfung
     * beseitigen soll.
     */
    sectionAttenuationFloor: 0.12,
  },

  /** Feature weights of the weighted sum. Should add up to 1. */
  weights: {
    luminanceContrast: 0.2,
    colorOpponency: 0.15,
    edgeDensity: 0.15,
    textSalience: 0.2,
    interactiveSalience: 0.1,
    imageSalience: 0.1,
    positionPrior: 0.1,
  },

  /** Difference-of-Gaussians on the luminance channel. */
  luminance: {
    centerSigma: 2,
    surroundSigma: 8,
  },

  /** Red-Green / Blue-Yellow opponency, each center-surround. */
  color: {
    centerSigma: 2,
    surroundSigma: 8,
    /** Relative contribution of the two opponent channels. */
    redGreenWeight: 0.5,
    blueYellowWeight: 0.5,
  },

  /** Sobel magnitude, then smoothed into a density. */
  edges: {
    smoothSigma: 6,
  },

  /** Text rectangles, intensity ~ fontSize x weight factor. */
  text: {
    /** Font size (frame px) that maps to full intensity. */
    referenceFontSize: 48,
    minFontSize: 8,
    /** fontWeight is normalised against this and raised to `weightExponent`. */
    weightReference: 400,
    weightExponent: 0.5,
    /** Longer strings are visually heavier, but with diminishing returns. */
    charCountReference: 40,
    charCountInfluence: 0.25,
    smoothSigma: 2,
  },

  /** Rectangles of nodes with prototype reactions or interactive name hints. */
  interactive: {
    reactionIntensity: 1.0,
    keywordIntensity: 0.7,
    smoothSigma: 3,
  },

  /** Rectangles of image nodes, constant mid intensity. */
  image: {
    intensity: 0.6,
    smoothSigma: 3,
  },

  /**
   * F-pattern prior of western reading direction: peak upper-left of centre,
   * asymmetric falloff (slower to the right and downwards).
   */
  prior: {
    centerX: 0.35,
    centerY: 0.28,
    sigmaLeft: 0.3,
    sigmaRight: 0.5,
    sigmaUp: 0.26,
    sigmaDown: 0.55,
    /** Floor so the prior never fully zeroes out distant regions. */
    floor: 0.05,
    /** Set to false for RTL layouts (open decision PRD §11.2). */
    mirrorHorizontally: false,
  },

  /**
   * Post-processing of the weighted sum.
   *
   * Diese Werte sind die von 1.0 und bleiben es: `HEURISTIC_V1` liest sie, und
   * das ist die **eingefrorene Referenz** des Harness (A-4). Was `hybrid-v1`
   * abweichend macht, steht in `hybrid` darunter — sonst würde eine Messung an
   * der aktiven Konfiguration die Vergleichsbasis mitverschieben.
   */
  post: {
    /** Gaussian blur sigma as a fraction of the longer analysis edge. */
    blurSigmaRatio: 0.025,
    clipLowPercentile: 1,
    clipHighPercentile: 99,
    gamma: 0.8,
  },

  /**
   * Was `hybrid-v1` an der Nachbearbeitung anders macht (1.2 A6).
   *
   * Anlass ist der A1-Befund: die Ground Truth hält 48,2 % ihrer Masse in den
   * stärksten 5 % der Pixel, unsere Karte 13,3 %. `blendAlpha` ist dafür der
   * falsche Hebel — ein höheres α macht die Karte weicher. Gemessen wurde
   * stattdessen über die vier Größen, die die *Form* der Verteilung bestimmen
   * (`npm run sharpness`, kreuzvalidiert auf dem Tuning-Split, 468 Bilder je
   * Kategorie). Zwei davon tragen, und zwar zusammen:
   *
   *                          AUC     CC      NSS     KL      Konzentration
   *   Ist-Zustand 1.1        0,783   0,447   1,061   1,091   0,133
   *   nur blendGamma 2       0,783   0,454   1,080   1,055   0,225
   *   nur Blur 0,035         0,784   0,449   1,063   1,094   0,131
   *   **beide**              0,784   0,456   1,083   1,049   0,221
   *                                                          (Webpage)
   *
   * Auf Mobile derselbe Befund: CC 0,552 → 0,557, NSS 1,091 → 1,115,
   * KL 0,785 → 0,728, Konzentration 0,138 → 0,247. **Alle vier Metriken
   * verbessern sich, KL eingeschlossen** — die Zuspitzung wird hier nicht mit
   * Vorhersagegüte bezahlt, sondern bringt welche mit.
   *
   * Der Mechanismus ist gegenläufig und deshalb erklärungsbedürftig: die
   * Bildanalyse wird **weicher** gezeichnet und das Ergebnis **härter**
   * angezogen. Ein glatterer Bildanteil passt besser zu einer Ground Truth, die
   * selbst aus überlagerten Blickpunkten besteht; die Schärfe kommt danach aus
   * der Tonkurve über der fertigen Karte, wo sie den Ortsprior mitnimmt.
   */
  hybrid: {
    /**
     * Weichzeichnung des Bildanteils — 0,035 statt 0,025.
     *
     * Die Richtung ist die überraschende: **schärfer zeichnen hilft nicht.**
     * 0,006 bis 0,020 verlieren in allen drei Hauptmetriken, monoton, in beiden
     * Kategorien (web CC 0,440 bei 0,006 gegen 0,447 im Ist-Zustand). Der
     * Bildanteil ist kein Detailkanal.
     */
    blurSigmaRatio: 0.035,
    /**
     * Tonkurve über der **fertigen**, gemischten Karte — `map^2`.
     *
     * Dieser Hebel war in 1.1 ausgebaut, **weil er KL verschlechterte**
     * (1,115 statt 1,078). Der ausgebaute war aber ein Gamma *unter* 1, also
     * ein glättendes; ein zuspitzendes hat nie jemand gemessen. Es verbessert
     * KL (1,091 → 1,055) statt es zu verschlechtern.
     *
     * 2,0 ist der größte Wert, der in **beiden** Kategorien keine der drei
     * Hauptmetriken kostet: bei 2,5 hält Webpage noch (Konzentration 0,270),
     * Mobile verliert CC belastbar (0,538 gegen 0,552). Die Grenze ist
     * gemessen, nicht gewählt.
     */
    blendGamma: 2.0,
  },

  /** Clickmap scoring (FR-5). */
  clickmap: {
    /**
     * Der Flächenanteil ist **entfernt**, nicht neu kalibriert.
     *
     * `sizeRank = Fläche ÷ größte Fläche` mit 0,2 war für die Clickmap
     * gedacht: ein größeres Ziel wird häufiger getroffen. Seit die Kandidaten
     * *Kästen* statt Beschriftungen sind, addierte er 0,20 auf jede
     * Ergebniskarte (230.400 px² gegen 17.784 px² beim CTA) und entschied die
     * Rangfolge allein. Die drei Regeln, die noch daran hängen, sprechen aber
     * über **Aufmerksamkeit**, nicht über Klickwahrscheinlichkeit — und die
     * Clickmap, für die der Term Sinn ergäbe, ist nicht im Panel. „Median statt
     * Maximum" wäre eine zweite Zahl gegen dieselbe unvalidierte Population
     * gewesen.
     *
     * Die verbleibenden zwei Gewichte sind die alten, auf 1 renormiert:
     * 0,5/0,8 und 0,3/0,8.
     */
    weights: {
      attention: 0.625,
      reaction: 0.375,
    },
    reactionBonus: {
      reactions: 1.0,
      keyword: 0.4,
      other: 0.15,
    },
    /** Max characters for a text node to qualify as a button label. */
    maxTextCharsForButton: 30,
    /**
     * How far up the ancestor chain the filled box around a label is looked
     * for. 3 covers Button → Auto-Layout-Reihe → Icon+Text-Stapel → Label,
     * which is as deep as component libraries usually nest before the box is
     * no longer the tappable element.
     */
    buttonContainerDepth: 3,
    /** Candidates smaller than this (frame px²) are ignored. */
    minCandidateArea: 400,
    /** Candidates larger than this share of the frame are ignored (backdrops). */
    maxCandidateAreaRatio: 0.5,
    /** Only the strongest N candidates are drawn and ranked. */
    maxCandidates: 12,
    rankingSize: 5,
  },

  /** Rendering (FR-7). */
  render: {
    /** Hard limit of `figma.createImage` — verified against the API docs. */
    maxImageEdge: 4096,
    /** Heat values below this render fully transparent. */
    transparencyCutoff: 0.08,
    /** Width of the fade-in ramp above the cutoff. */
    transparencyRamp: 0.12,
    // The legend box and the disclaimer footer used to be drawn into every map
    // and had their own typography block here. They are Figma text nodes beside
    // the image now (`figma/place.ts`) — nothing but the prediction is painted
    // onto the screenshot.
    /** Epic B — dashed fold markers drawn into every segmented output. */
    fold: {
      lineWidthRatio: 0.0016,
      minLineWidth: 2,
      dashRatio: 0.012,
      gapRatio: 0.008,
      labelFontSizeRatio: 0.014,
      minLabelFontSize: 11,
    },
    clickBlob: {
      /** Blob radius as a share of the longer output edge. */
      minRadiusRatio: 0.035,
      maxRadiusRatio: 0.12,
      /** Blob radius is additionally capped to this multiple of the element. */
      elementRadiusFactor: 0.9,
      labelFontSizeRatio: 0.018,
      minLabelFontSize: 12,
    },
  },

  /** Focusmap composition (FR-6). */
  focus: {
    /** Brightness of the dimmed background, 0–1. */
    dimBrightness: 0.35,
    /** Background blur sigma as a fraction of the longer output edge. */
    blurSigmaRatio: 0.012,
    /** Feather of the mask edge as a fraction of the longer output edge. */
    maskFeatherRatio: 0.02,
    /**
     * Anchor of the falloff curve, **not an edge**: at the value of this
     * percentile the screen is fully sharp, below it visibility falls off
     * smoothly instead of dropping to nothing.
     *
     * 80 is the value the panel slider defaulted to. The alternative — deriving
     * it per screen from the concentration of the image term (the quantity
     * `findings/rules.ts` → `flat` cuts on) — was measured and dropped: that
     * quantity answers „how small is the strongest spot", not „how clear is the
     * hierarchy", and it moves just as much with the sheer amount of content.
     * On two constructed frames with a large hero it therefore *widened* the
     * sharp area to 30–45 % of the page, the opposite of the intent. See the
     * commit that removed the slider.
     */
    percentile: 80,
    /**
     * Exponent of the falloff below the anchor: `alpha = (v / anchor)^gamma`.
     *
     * The hard cut this replaces made the focusmap contradict the heatmap it is
     * computed from — a region the heatmap draws distinctly warm was either
     * fully sharp or fully dark, and on an onboarding screen a visibly warm CTA
     * fell into the dark side of the cut. Both maps are the same numbers, so
     * they have to say the same thing.
     *
     * 1.6 was chosen on the constructed frames: 1.0 is so flat that the whole
     * screen stays half-visible and the map stops pointing anywhere, 2.4 is
     * close enough to the old cut to reproduce the complaint. At 1.6 a region
     * at 70 % of the anchor still shows at 57 % visibility, one at 40 % of it
     * at 22 % — visible as "less", not as "not seen".
     */
    falloffGamma: 1.6,
  },

  /** Main-thread traversal limits (FR-1, FR-3). */
  traversal: {
    /** Above this node count the tree is skipped entirely (FR-3). */
    maxNodes: 3000,
    minOpacity: 0.05,
    /** Frames with a shorter edge below this are rejected (FR-1). */
    minFrameEdge: 200,
    /**
     * Wie viele Zeichen eines Textknotens in die Benennung wandern.
     *
     * Ein Befund ist ein Satz; eine ganze Fließtext-Spalte darin macht ihn
     * unlesbar. 48 Zeichen tragen eine Stellenanzeige („Fahrzeugeinkäufer im
     * Außendienst", 31) oder eine Überschrift vollständig und schneiden
     * Absätze ab.
     */
    maxTextLength: 48,
  },

  /** Epic C — thresholds of the findings rules. Every rule reads from here. */
  findings: {
    /** Never show more than this many findings (C-1). */
    maxShown: 6,
    /**
     * `competition`: Anteil des Maximums, den eine Region erreichen muss, um
     * als zweiter Hotspot zu zählen.
     *
     * Das PRD nannte 80 %. Unter `hybrid-v1` ist die Karte prior-dominiert:
     * eine weit entfernte Region kann höchstens `Prior dort + 0,3` erreichen
     * und kommt damit strukturell kaum über 0,66. Gemessen auf UEyes liegt das
     * zweite Maximum im Median bei 0,75 (p25 0,59, p75 0,81). Bei 0,8 feuerte
     * die Regel auf 2 % der Bilder und war auf konstruierten Frames überhaupt
     * nicht auslösbar — also nicht testbar.
     *
     * 0,65 liegt beim ~20. Perzentil; bindend wird damit der Tal-Test, der
     * die eigentliche Aussage trägt („zwei getrennte Regionen").
     */
    competitionIntensity: 0.65,
    /** `competition`: minimum distance between the two peaks, share of width. */
    competitionMinDistance: 0.3,
    /**
     * `competition`: the path between the two peaks must dip below
     * `zweites Maximum x this`. Without the valley test a single wide bright
     * band reads as two competing regions just because it is wider than the
     * threshold.
     *
     * **Relativ zum zweiten Maximum, nicht absolut.** Absolut (gegen
     * `competitionIntensity x 0,7 = 0,56`) feuerte die Regel auf 0 von 495
     * UEyes-Bildern: die beiden Bedingungen stehen sich im Weg, weil eine
     * glatte, prior-dominierte Karte mit zwei starken Maxima auch dazwischen
     * hell bleibt. Gemessen liegt das Tal im Median bei 0,74 bei einem zweiten
     * Maximum um 0,75–0,85 — der Quotient ist die aussagekräftige Größe.
     */
    competitionValleyRatio: 0.9,
    /**
     * `flat`: Konzentration des **Bildanalyse-Anteils** (Anteil der Masse in den
     * stärksten 5 % der Pixel) unterhalb dieses Werts heißt „keine Hierarchie".
     *
     * Gemessen auf dem ersten Abschnitt, ohne Ortsprior und ohne
     * Scroll-Dämpfung — siehe `findings/types.ts` → `aboveFoldImageTerm`. Die
     * fertige Karte taugt dafür nicht: sie ist prior-dominiert, und darauf ist
     * ein leerer Frame so „konzentriert" wie einer mit klarem Blickfang.
     *
     * **Pro UI-Typ**: gemessener Median 0,108 (web), 0,125 (mobile), 0,119
     * (desktop), 0,105 (poster) über je 150 UEyes-Bilder mit passendem Prior
     * und einem Viewport. Jeder Wert ist das 10. Perzentil seiner Kategorie,
     * die Regel meldet also die flachsten rund 10 % — „flach" heißt flach *für
     * diese Art Screen*. Die Kategorien liegen dabei deutlich enger beieinander
     * als in der Fassung davor; der große Abstand (0,163 gegen 0,258) war zum
     * großen Teil ein Artefakt der komponierten Karte.
     *
     * Drei Vorgänger sind an genau dieser Stelle gescheitert, und zwar in
     * aufsteigender Subtilität:
     *
     *   1. `p90 − p50 < 0,25` (aus `heuristic-v1`) — feuerte nie.
     *   2. skalenfrei, aber eine Schwelle für alle — 11 % der Webseiten,
     *      **90 %** der Mobile-Screens.
     *   3. je UI-Typ, aber auf der komponierten Karte gemessen — die Schwelle
     *      war in einer Konfiguration geschätzt (web-Prior, segmentiert) und in
     *      einer anderen angewandt (mobile-Prior, ein Viewport), und lag dort
     *      **über dem gesamten Wertebereich**: 150 von 150.
     *
     * Wer die Engine oder die Prioren ändert, muss diese Werte nachmessen —
     * `npm run findings-audit -- --prior-asset <typ> --single-viewport`. Und
     * zwar in der Konfiguration, in der die Regel läuft; das ist die Lehre aus
     * (3).
     */
    flatConcentrationThreshold: {
      web: 0.086,
      mobile: 0.091,
      desktop: 0.092,
      poster: 0.08,
    } as Record<string, number>,
    /**
     * `dead-cta`: ein Kandidat gilt als „ruhig", wenn seine mittlere
     * Aufmerksamkeit unter diesem Anteil des **stärksten Kandidaten** liegt.
     *
     * Verglichen wird gegen die anderen interaktiven Elemente, nicht gegen das
     * unterste Perzentil der ganzen Karte. Letzteres besteht bei einem
     * prior-dominierten Modell aus Rändern und Weißraum; jedes echte
     * Bedienelement liegt darüber, und die Regel feuerte nie (gemessen:
     * ruhigster Kandidat lag beim 3,5- bis 8-fachen des 25. Perzentils).
     * „Visuell ruhig" heißt sinnvoll: ruhig **im Vergleich zu den anderen
     * Schaltflächen desselben Screens".
     */
    deadCtaRelativeToBest: 0.45,
    /**
     * `cold-fold`: **relative** margin by which a later section's attention
     * concentration must exceed the first section's — 0,08 means 8 % more.
     *
     * Relative, not absolute, because the measure is a concentration share
     * (see `segments.ts` → `sectionSalience`) whose useful range is narrow:
     * a featureless page sits at 0,163 and a page with a strong eye-catcher
     * deep down at 0,182. An absolute margin on the old 0..1 peak scale could
     * never be reached — which is why this rule was silently inert.
     */
    coldFoldMargin: 0.08,
    /** `cta-rank`: a primary candidate below this rank is worth reporting. */
    ctaRankThreshold: 1,
    /** Name tokens that mark a candidate as the *primary* call to action. */
    primaryKeywords: ['primary', 'primär', 'cta', 'submit', 'anfragen', 'kaufen', 'jetzt'],
  },

  /** Canvas placement (FR-8). */
  placement: {
    gap: 64,
    padding: 64,
    titleFontSize: 24,
    findingsWidth: 520,
    findingsFontSize: 16,
  },
} as const

export type EngineConfig = typeof ENGINE_CONFIG
