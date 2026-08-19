/**
 * Design tokens.
 *
 * The same brand as the admin panel — LaoStay orange on warm neutrals — but a
 * different frame. The admin console is a dark-sidebar card floating on a
 * coloured page because it is a desk tool. This is a shopfront: white, edge to
 * edge, laid out for a phone first.
 */
export const c = {
  page: '#ffffff',
  /** Sections that need to lift off the page — cards, sheets, summaries. */
  surface: '#ffffff',
  /** A tint behind grouped content. */
  bg: '#FBF7F1',
  /** The hero / footer band. */
  dark: '#2C1E16',
  darkSoft: '#3A2A1E',

  accent: '#FD4D1C',
  accentDark: '#D13A0E',
  accentSoft: '#FFE3D6',

  text: '#2B2521',
  soft: '#5C5348',
  muted: '#8C8073',
  faint: '#A2988A',
  onDark: '#E4D8C4',
  onDarkSoft: '#B39C86',

  border: '#E8DFD1',
  divider: '#F1EAE0',

  successBg: '#E7EAD7',
  successFg: '#4E5836',
  warnBg: '#F6E7C9',
  warnFg: '#8A6B1F',
  dangerBg: '#FFF0EA',
  dangerFg: '#D13A0E',
  neutralBg: '#EDE8E0',
  neutralFg: '#5C5348',
  infoBg: '#F3E6D8',
  infoFg: '#4A3527',

  star: '#C89B4A',
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

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

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
  display: f(800, 34, 46),
  h1: f(800, 26, 36),
  h2: f(800, 20, 28),
  h3: f(700, 16, 24),
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
  card: '0 1px 3px rgba(43,37,33,.06), 0 6px 20px -8px rgba(43,37,33,.12)',
  raised: '0 10px 34px -12px rgba(43,37,33,.28)',
  sheet: '0 -8px 34px -12px rgba(43,37,33,.24)',
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
