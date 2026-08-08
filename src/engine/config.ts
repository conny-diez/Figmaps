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

/** Bumped whenever the prediction changes. Appears in layer names and labels. */
export const ENGINE_VERSION = 'heuristic-v1'

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
  /** Longer edge of the map the engine computes on. Not negotiable (PRD §10). */
  analysisEdge: 512,

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

  /** Canvas placement (FR-8). */
  placement: {
    gap: 64,
    padding: 64,
    titleFontSize: 24,
  },
} as const

export type EngineConfig = typeof ENGINE_CONFIG
