import { ConfigService } from '@nestjs/config';

/**
 * The ways a guest can pay — each a PhaJay channel.
 *
 * The banks each get their own QR (PhaJay has one endpoint per bank), so the
 * guest picks their bank and is shown the code their app reads. `card` is
 * PhaJay's hosted 3-D Secure page instead of a QR.
 */
export const BANK_CHANNELS = ['bcel', 'jdb', 'ldb', 'ib', 'stb', 'm_money'] as const;
export type BankChannel = (typeof BANK_CHANNELS)[number];
export type PaymentChannel = BankChannel | 'card';

export const ALL_CHANNELS: readonly PaymentChannel[] = [...BANK_CHANNELS, 'card'];

/** PhaJay refuses smaller amounts on these: "Amount must be at least 1,000 LAK." */
export const CHANNEL_MIN_KIP: Partial<Record<PaymentChannel, number>> = { m_money: 1000 };

export function isChannel(value: unknown): value is PaymentChannel {
  return typeof value === 'string' && (ALL_CHANNELS as readonly string[]).includes(value);
}

/**
 * What a call with no channel means — an app built before the guest could
 * choose. `PHAJAY_BANK`, as before.
 */
export function defaultChannel(config: ConfigService): BankChannel {
  const choice = (config.get<string>('PHAJAY_BANK') ?? '').trim().toLowerCase();
  return (BANK_CHANNELS as readonly string[]).includes(choice) ? (choice as BankChannel) : 'bcel';
}

/**
 * The channels offered to guests.
 *
 * `PHAJAY_CHANNELS` lists the banks (default: all six). Cards are off unless
 * `PHAJAY_CARD=true`: PhaJay answers 403 until the merchant account passes
 * KYC for cards, and a button that always fails is worse than none.
 */
export function enabledChannels(config: ConfigService): PaymentChannel[] {
  const listed = (config.get<string>('PHAJAY_CHANNELS') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const banks = listed.length
    ? BANK_CHANNELS.filter((b) => listed.includes(b))
    : [...BANK_CHANNELS];
  const card = (config.get<string>('PHAJAY_CARD') ?? '').trim().toLowerCase() === 'true';
  return card ? [...banks, 'card'] : banks;
}
