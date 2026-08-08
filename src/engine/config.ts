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

/** Name tokens that mark a node as probably interactive (FR-3). */
export const INTERACTIVE_KEYWORDS: readonly string[] = [
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

  /** Post-processing of the weighted sum. */
  post: {
    /** Gaussian blur sigma as a fraction of the longer analysis edge. */
    blurSigmaRatio: 0.025,
    clipLowPercentile: 1,
    clipHighPercentile: 99,
    gamma: 0.8,
  },

  /** Clickmap scoring (FR-5). */
  clickmap: {
    weights: {
      attention: 0.5,
      reaction: 0.3,
      size: 0.2,
    },
    reactionBonus: {
      reactions: 1.0,
      keyword: 0.4,
      other: 0.15,
    },
    /** Max characters for a text node to qualify as a button label. */
    maxTextCharsForButton: 30,
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
    /** Reference edge used to scale legend/footer typography. */
    uiScaleReferenceEdge: 1200,
    legend: {
      barWidthRatio: 0.22,
      barHeightRatio: 0.018,
      fontSizeRatio: 0.016,
      paddingRatio: 0.02,
      minFontSize: 11,
      maxFontSize: 40,
    },
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
    defaultPercentile: 80,
    minPercentile: 60,
    maxPercentile: 95,
  },

  /** Main-thread traversal limits (FR-1, FR-3). */
  traversal: {
    /** Above this node count the tree is skipped entirely (FR-3). */
    maxNodes: 3000,
    minOpacity: 0.05,
    /** Frames with a shorter edge below this are rejected (FR-1). */
    minFrameEdge: 200,
  },

  /** Epic C — thresholds of the findings rules. Every rule reads from here. */
  findings: {
    /** Never show more than this many findings (C-1). */
    maxShown: 6,
    /** `competition`: intensity a region must reach to count as a hotspot. */
    competitionIntensity: 0.8,
    /** `competition`: minimum distance between the two peaks, share of width. */
    competitionMinDistance: 0.3,
    /**
     * `competition`: the path between the two peaks must dip below
     * `competitionIntensity x this`. Without it a single wide bright band reads
     * as two competing regions just because it is wider than the threshold.
     */
    competitionValleyRatio: 0.7,
    /** `flat`: p90 - p50 below this means "no hierarchy". */
    flatSpreadThreshold: 0.25,
    /** `dead-cta`: mean attention percentile below which an element is "cold". */
    deadCtaQuartile: 25,
    /** `cold-fold`: a later section must beat the first one by this much. */
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
