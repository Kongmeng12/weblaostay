/**
 * A stay as an iCalendar (RFC 5545) event — the one calendar format Google,
 * Apple and Outlook all import.
 *
 * Hand-built rather than pulled from a library: it is one VEVENT, and the two
 * rules that matter are small enough to own —
 *
 *  - TEXT values are escaped (§3.3.11). A guest's special request or a
 *    property name can hold a newline, and an unescaped one would end the
 *    property and let the rest of the text start a new one.
 *  - Lines are folded at 75 *octets* (§3.1), not characters. Lao is three
 *    bytes a character in UTF-8, so a character count would overrun, and a
 *    naive byte split would cut a character in half.
 */

import { enDate } from './format';

export interface StayEvent {
  bookingId: string;
  code: string;
  propertyName: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  roomName: string | null;
  guests: number;
  /** Date-only values, stored as UTC midnight. */
  checkIn: Date;
  checkOut: Date;
  /** Where the guest can open the booking, e.g. https://phaphak.com/trips/42 */
  url: string;
  /** Lets a test pin DTSTAMP; defaults to now. */
  now?: Date;
}

const CRLF = '\r\n';

/** §3.3.11 TEXT: backslash, semicolon, comma and line breaks are escaped. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * §3.1: no line longer than 75 octets; a continuation starts with one space.
 * Splits between characters, never inside one.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    // The first line may use all 75 octets; continuations lose one to the space.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

const readableDate = enDate;

export function buildStayIcs(e: StayEvent): string {
  const now = e.now ?? new Date();

  const description = [
    `PhaPhak · ລະຫັດຈອງ / Confirmation: ${e.code}`,
    `ເຂົ້າພັກ / Check-in: ${readableDate(e.checkIn)}`,
    `ອອກ / Check-out: ${readableDate(e.checkOut)}`,
    e.roomName ? `${e.roomName} · ${e.guests} ຄົນ / guests` : `${e.guests} ຄົນ / guests`,
    e.phone ? `ໂທ / Phone: ${e.phone}` : null,
    e.url,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  // Reminder at 09:00 in Laos (02:00 UTC) the day before arrival — an alarm
  // relative to an all-day start would fire at midnight.
  const reminder = addDays(e.checkIn, -1);
  reminder.setUTCHours(2, 0, 0, 0);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PhaPhak//Booking confirmation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:booking-${e.bookingId}@phaphak.com`,
    `DTSTAMP:${utcStamp(now)}`,
    // All-day, arrival through departure: DTEND is exclusive (§3.6.1), so the
    // day after check-out makes the departure day itself show on the calendar.
    `DTSTART;VALUE=DATE:${ymd(e.checkIn)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(e.checkOut, 1))}`,
    `SUMMARY:${escapeText(`${e.propertyName} · ${e.code}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText([e.propertyName, e.address].filter(Boolean).join(', '))}`,
    ...(e.lat !== null && e.lng !== null ? [`GEO:${e.lat.toFixed(6)};${e.lng.toFixed(6)}`] : []),
    `URL:${e.url}`,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`ມື້ອື່ນເຂົ້າພັກ ${e.propertyName} · Check-in tomorrow`)}`,
    `TRIGGER;VALUE=DATE-TIME:${utcStamp(reminder)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join(CRLF) + CRLF;
}
