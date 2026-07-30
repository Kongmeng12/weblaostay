/**
 * Design tokens lifted directly from WebAdmin.dc.html so the built app matches
 * the mockup rather than approximating it.
 */
export const c = {
  /** Page background behind the app card. */
  pageOuter: '#EDE3D6',
  /** Main content background. */
  bg: '#F3E9D9',
  surface: '#ffffff',

  sidebarFrom: '#3A2A1E',
  sidebarTo: '#241B15',
  sidebarPanel: '#2C1E16',

  accent: '#FD4D1C',
  accentDark: '#D13A0E',
  accentSoft: '#FFE3D6',

  text: '#2B2521',
  soft: '#5C5348',
  muted: '#8C8073',
  faint: '#9B8F7E',
  onDark: '#C4B8A0',
  onDarkSoft: '#B39C86',

  border: '#E4D8C4',
  divider: '#EFE6D6',
  rowHover: '#FBF6EC',

  // Status pill pairs — background / foreground
  successBg: '#E7EAD7',
  successFg: '#4E5836',
  warnBg: '#F6E7C9',
  warnFg: '#8A6B1F',
  dangerBg: '#FFF0EA',
  dangerFg: '#D13A0E',
  neutralBg: '#E4E2DC',
  neutralFg: '#5C5348',
  infoBg: '#F3E6D8',
  infoFg: '#4A3527',
} as const;

export const font = "'Noto Sans Lao', system-ui, -apple-system, sans-serif";

/** `font: 700 13px 'Noto Sans Lao'` in one call. */
export const f = (weight: number, size: number, lineHeight?: number): string =>
  `${weight} ${size}px${lineHeight ? '/' + lineHeight : ''} ${font}`;

export const radius = { sm: 8, md: 11, lg: 16, xl: 22 } as const;

/** Avatar gradients used for partner and customer rows in the mockup. */
export const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#CDB88E,#8A6B4A)',
  'linear-gradient(135deg,#B9C29B,#6E7B4E)',
  'linear-gradient(135deg,#D7B49A,#B07850)',
  'linear-gradient(135deg,#C9B49C,#8A6E56)',
  'linear-gradient(135deg,#D9C7A0,#A98E5F)',
  'linear-gradient(135deg,#C89B4A,#D13A0E)',
  'linear-gradient(135deg,#8A6E56,#3A2A1E)',
] as const;

/** Stable gradient per entity, so a partner keeps the same colour everywhere. */
export function avatarFor(key: string | number): string {
  const s = String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

type Pill = { bg: string; fg: string; label: string };

export const BOOKING_STATUS_PILL: Record<string, Pill> = {
  confirmed: { bg: c.successBg, fg: c.successFg, label: 'ຢືນຢັນ' },
  pending: { bg: c.warnBg, fg: c.warnFg, label: 'ລໍຖ້າ' },
  staying: { bg: c.accentSoft, fg: c.accentDark, label: 'ກຳລັງພັກ' },
  done: { bg: c.infoBg, fg: c.infoFg, label: 'ສຳເລັດ' },
  cancelled: { bg: c.dangerBg, fg: c.dangerFg, label: 'ຍົກເລີກ' },
};

export const PARTNER_STATUS_PILL: Record<string, Pill> = {
  verified: { bg: c.successBg, fg: c.successFg, label: 'ຢືນຢັນແລ້ວ' },
  pending: { bg: c.warnBg, fg: c.warnFg, label: 'ລໍອະນຸມັດ' },
  rejected: { bg: c.dangerBg, fg: c.dangerFg, label: 'ບໍ່ຜ່ານ' },
};

export const USER_STATUS_PILL: Record<string, Pill> = {
  active: { bg: c.successBg, fg: c.successFg, label: 'ປົກກະຕິ' },
  suspended: { bg: c.dangerBg, fg: c.dangerFg, label: 'ລະງັບ' },
};

export const PAYOUT_STATUS_PILL: Record<string, Pill> = {
  pending: { bg: c.warnBg, fg: c.warnFg, label: 'ລໍໂອນ' },
  paid: { bg: c.successBg, fg: c.successFg, label: 'ໂອນແລ້ວ' },
};

export const PAYMENT_STATUS_PILL: Record<string, Pill> = {
  paid: { bg: c.successBg, fg: c.successFg, label: 'ຈ່າຍແລ້ວ' },
  pending: { bg: c.warnBg, fg: c.warnFg, label: 'ລໍຈ່າຍ' },
  refunded: { bg: c.neutralBg, fg: c.neutralFg, label: 'ຄືນເງິນ' },
  expired: { bg: c.dangerBg, fg: c.dangerFg, label: 'ໝົດອາຍຸ' },
};

export const FALLBACK_PILL: Pill = { bg: c.neutralBg, fg: c.neutralFg, label: '—' };

export function pillFor(map: Record<string, Pill>, status: string | null | undefined): Pill {
  if (!status) return FALLBACK_PILL;
  return map[status] ?? { ...FALLBACK_PILL, label: status };
}
