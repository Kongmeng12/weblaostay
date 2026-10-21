import { useSyncExternalStore } from 'react';
import { nightsBetween, todayIso } from './format';

/**
 * The stay the guest is planning — chosen once, used everywhere.
 *
 * Dates used to live only in each page's URL, so they were lost the moment a
 * guest left the page they picked them on: dates set in a search were gone
 * after going home and opening a property from there, and the property page
 * asked for them again. Now whatever a guest last chose — on the search page or
 * a property page — is remembered, and every link into a property and every
 * property page that arrives without dates fills them in from here.
 *
 * Kept in `localStorage`, so it survives a reload and a return visit the next
 * day. A stay whose arrival has passed is dropped rather than offered: those
 * nights can no longer be booked. Storage can be blocked (private windows,
 * cleared site data), so every access is guarded and the app simply works
 * without a remembered stay.
 */
export interface PlannedStay {
  checkIn: string;
  checkOut: string;
  guests: number;
}

const KEY = 'phaphak.stay';
const listeners = new Set<() => void>();
let cached: PlannedStay | null | undefined;

function read(): PlannedStay | null {
  if (cached !== undefined) return cached;
  let stay: PlannedStay | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stay = JSON.parse(raw) as PlannedStay;
  } catch {
    stay = null;
  }
  cached = valid(stay) ? stay : null;
  return cached;
}

function valid(s: PlannedStay | null): s is PlannedStay {
  return (
    !!s &&
    typeof s.checkIn === 'string' &&
    typeof s.checkOut === 'string' &&
    !!s.checkIn &&
    !!s.checkOut &&
    s.checkIn >= todayIso() &&
    nightsBetween(s.checkIn, s.checkOut) > 0
  );
}

/**
 * Records the guest's choice. A half-picked range (arrival, no departure yet)
 * is ignored rather than stored: it is a moment in the middle of picking, not
 * a stay. Clearing the dates — both ends empty — forgets the stay.
 */
export function rememberStay(next: { checkIn: string; checkOut: string; guests?: number }) {
  const guests = Math.max(1, Math.floor(next.guests ?? read()?.guests ?? 2));
  let stay: PlannedStay | null;
  if (!next.checkIn && !next.checkOut) stay = null;
  else if (next.checkIn && next.checkOut) stay = { checkIn: next.checkIn, checkOut: next.checkOut, guests };
  else return;
  if (stay && !valid(stay)) return;

  const before = read();
  if (JSON.stringify(before) === JSON.stringify(stay)) return;
  cached = stay;
  try {
    if (stay) localStorage.setItem(KEY, JSON.stringify(stay));
    else localStorage.removeItem(KEY);
  } catch {
    // Remembered for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab choosing dates counts too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = undefined;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePlannedStay(): PlannedStay | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/**
 * A property link with the planned stay on it, so the page opens priced for
 * those nights instead of asking for dates. A link that already names dates —
 * a search result for a specific range — is left exactly as it is, and a
 * guest count already on the link wins over the remembered one.
 */
export function withStay(to: string, stay: PlannedStay | null): string {
  if (!stay) return to;
  const [path, query = ''] = to.split('?');
  const sp = new URLSearchParams(query);
  if (sp.get('checkIn')) return to;
  sp.set('checkIn', stay.checkIn);
  sp.set('checkOut', stay.checkOut);
  if (!sp.get('guests')) sp.set('guests', String(stay.guests));
  return `${path}?${sp.toString()}`;
}
