/**
 * Design tokens.
 *
 * Taken from the customer app (`customer_app/lib/core/theme/app_colors.dart`)
 * so a guest moving between the phone app and the website sees one product:
 * Phapai orange on a cream page, sand fills, hairline borders and dark-ink
 * selection. The names are the website's own — every page reads them — only
 * the values follow the app.
 */
export const c = {
  /** The page itself — the app's `cream`. */
  page: '#FBF6EF',
  /** Sections that need to lift off the page — cards, sheets, summaries. */
  surface: '#FFFFFF',
  /** A tint behind grouped content and filled inputs — the app's `sand`. */
  bg: '#F3EADD',
  /** Ink: selected chips, the footer band. */
  dark: '#2A1F19',
  darkSoft: '#3A2C23',

  accent: '#FF5722',
  accentDark: '#E64A19',
  accentSoft: '#FFF0EA',

  text: '#2A1F19',
  soft: '#5E5046',
  muted: '#8A7B6F',
  faint: '#B6A99C',
  onDark: '#EDE4D8',
  onDarkSoft: '#B6A99C',

  border: '#EDE4D8',
  divider: '#F3EADD',

  successBg: '#EAF6EE',
  successFg: '#0A7C4A',
  warnBg: '#FBEEDD',
  warnFg: '#B45309',
  dangerBg: '#FBEAE9',
  dangerFg: '#B3261E',
  neutralBg: '#F3EADD',
  neutralFg: '#8A7B6F',
  infoBg: '#F3EADD',
  infoFg: '#5E5046',

  star: '#FF5722',
  gold: '#C98A3B',

  /** An unselected tab-bar icon. */
  inactive: '#BEB1A3',
  /** A photo that has not arrived, or never will. */
  placeholderBg: '#E7DCCC',
  placeholderFg: '#C6B7A4',
} as const;

export const font = "'Noto Sans Lao', system-ui, -apple-system, sans-serif";

/**
 * `font: 700 13px/20px 'Noto Sans Lao'` in one call.
 *
 * The `px` on the line height is not optional. In the `font` shorthand a
 * unitless number is a *multiplier*, so `f(800, 34, 44)` would ask for a line
 * 44 × 34px = 1496px tall and every heading would push the page metres long.
 */
export const f = (weight: number, size: number, lineHeight?: number): string =>
  `${weight} ${size}px${lineHeight ? `/${lineHeight}px` : ''} ${font}`;

/** The app's `AppRadii`: 22px cards, 16px inputs, pill buttons and chips. */
export const radius = { sm: 10, md: 16, lg: 22, sheet: 28, pill: 999 } as const;

/**
 * The spacing scale. Every gap, padding and margin should be one of these.
 *
 * It exists because the app had no scale at all and drifted badly: 55 distinct
 * padding values, 24 margin shorthands, and clusters like 8/9/11/12/13/14px
 * that no eye can tell apart but that together stop anything from lining up.
 * Steps are far enough apart to read as deliberate.
 */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 48,
  8: 64,
} as const;

/**
 * The type scale, size and line height together.
 *
 * The pairing is the point. 82% of this app's `f()` calls used to pass no line
 * height at all, leaving the browser's ~1.2 — which is too tight for Lao, where
 * vowels and tone marks stack above and below the base character and collide
 * with the line above. Every entry here reserves room for them.
 *
 * Eight steps replace the 22 sizes the app had accumulated, including three at
 * half-pixel values that only ever blurred.
 */
export const type = {
  display: f(800, 32, 44),
  h1: f(700, 24, 34),
  h2: f(700, 19, 28),
  h3: f(700, 15.5, 24),
  body: f(400, 15, 24),
  bodySm: f(400, 13.5, 22),
  label: f(600, 13, 20),
  caption: f(400, 12, 18),
} as const;

/**
 * Breakpoints, readable from JS as well as CSS.
 *
 * `lg` and `md` are the two the stylesheet already used as bare numbers; naming
 * them here means a component can reason about the same thresholds instead of
 * guessing at them.
 */
export const bp = { sm: 560, md: 720, lg: 860, xl: 1120 } as const;

/** The smallest a touch target may be — Apple HIG and WCAG 2.5.5 agree on 44. */
export const TAP = 44;

/** The widest the content ever gets; the page centres inside it. */
export const MAX_WIDTH = 1120;

export const shadow = {
  card: '0 1px 2px rgba(42,31,25,.04), 0 10px 22px -14px rgba(42,31,25,.16)',
  raised: '0 10px 34px -12px rgba(42,31,25,.28)',
  sheet: '0 -8px 34px -12px rgba(42,31,25,.24)',
  /** The orange glow under the app's primary `CtaButton`. */
  cta: '0 12px 24px -10px rgba(255,87,34,.6)',
} as const;

type Pill = { bg: string; fg: string; label: string };

/** `booking_status` — what a guest sees on their own trips. */
export const BOOKING_STATUS_PILL: Record<string, Pill> = {
  pending: { bg: c.warnBg, fg: c.warnFg, label: 'ລໍຊຳລະ' },
  confirmed: { bg: c.successBg, fg: c.successFg, label: 'ຢືນຢັນແລ້ວ' },
  staying: { bg: c.accentSoft, fg: c.accentDark, label: 'ກຳລັງພັກ' },
  completed: { bg: c.infoBg, fg: c.infoFg, label: 'ພັກຈົບແລ້ວ' },
  cancelled: { bg: c.dangerBg, fg: c.dangerFg, label: 'ຍົກເລີກແລ້ວ' },
  no_show: { bg: c.neutralBg, fg: c.neutralFg, label: 'ບໍ່ໄດ້ໄປ' },
};

/** `payment_status` */
export const PAYMENT_STATUS_PILL: Record<string, Pill> = {
  pending: { bg: c.warnBg, fg: c.warnFg, label: 'ລໍຈ່າຍ' },
  paid: { bg: c.successBg, fg: c.successFg, label: 'ຈ່າຍແລ້ວ' },
  expired: { bg: c.neutralBg, fg: c.neutralFg, label: 'ໝົດອາຍຸ' },
  failed: { bg: c.dangerBg, fg: c.dangerFg, label: 'ລົ້ມເຫຼວ' },
  refunded: { bg: c.infoBg, fg: c.infoFg, label: 'ຄືນເງິນແລ້ວ' },
  partially_refunded: { bg: c.infoBg, fg: c.infoFg, label: 'ຄືນເງິນບາງສ່ວນ' },
};

export const PROPERTY_TYPE_LABEL: Record<string, string> = {
  homestay: 'ໂຮມສະເຕ',
  villa: 'ວິນລ່າ',
  resort: 'ຣີສອດ',
  guesthouse: 'ເຮືອນພັກ',
  hotel: 'ໂຮງແຮມ',
};

export const BED_TYPE_LABEL: Record<string, string> = {
  single: 'ຕຽງດ່ຽວ',
  double: 'ຕຽງຄູ່',
  twin: 'ສອງຕຽງ',
};

export const FALLBACK_PILL: Pill = { bg: c.neutralBg, fg: c.neutralFg, label: '—' };

export function pillFor(map: Record<string, Pill>, status: string | null | undefined): Pill {
  if (!status) return FALLBACK_PILL;
  return map[status] ?? { ...FALLBACK_PILL, label: status };
}
