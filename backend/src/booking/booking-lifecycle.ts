import { booking_status } from '@prisma/client';
import { BOOKING_TRANSITIONS } from '../common/enums';
import { isoDayUtc, todayInLaos } from '../common/dates';

/**
 * The front-desk lifecycle of a booking, in one place, so the partner app, the
 * admin panel and the API all agree on what may happen next.
 *
 *   pending ──(guest pays)──▶ confirmed ──(check-in)──▶ staying ──(check-out)──▶ completed
 *      │                          │  ◀──(undo check-in)──┘
 *      │                          └──(arrival day passed, guest never came)──▶ no_show
 *      └──(hold expires / cancel)──▶ cancelled        (any live state ──▶ cancelled, via its own endpoint)
 *
 * What moves a booking, by who:
 *  - `pending → confirmed` is **never manual**. It happens when the payment
 *    lands (PaymentsService), which is also what turns the held nights into
 *    sold nights. A front-desk "confirm" would skip both — the room would stay
 *    held forever and the property would think it had been paid.
 *  - `confirmed → staying` (check-in) opens on the arrival date and closes at
 *    check-out. Checking a guest in a month early, or after they should have
 *    left, is a mis-tap, not a business event.
 *  - `staying → completed` (check-out) is always allowed — early departures
 *    are normal. The checkout sweeper does it automatically once the stay's
 *    dates have passed, for properties that never touch the buttons.
 *  - `no_show` can only be called once the arrival day is over.
 *
 * "Today" is the Lao calendar day (UTC+7), because that is the day a guest and
 * the front desk are living in — see `todayInLaos`.
 */

export interface LifecycleBooking {
  status: booking_status;
  check_in: Date;
  check_out: Date;
}

/** The moves the front desk may make on this booking right now. */
export function allowedStatusMoves(
  booking: LifecycleBooking,
  today: Date = todayInLaos(),
): booking_status[] {
  const structural = BOOKING_TRANSITIONS[booking.status] ?? [];
  return structural.filter((to) => blockedReason(booking, to, today) === null);
}

/**
 * Why `booking` cannot move to `to` today — a bilingual message fit to show a
 * person — or `null` when the move is allowed.
 */
export function blockedReason(
  booking: LifecycleBooking,
  to: booking_status,
  today: Date = todayInLaos(),
): string | null {
  const from = booking.status;
  const structural = BOOKING_TRANSITIONS[from] ?? [];

  if (from === booking_status.pending) {
    return (
      'ລໍຖ້າແຂກຈ່າຍເງິນ — ລະບົບຈະຢືນຢັນເອງເມື່ອໄດ້ຮັບເງິນ · ' +
      'Waiting for the guest to pay — the booking confirms itself once payment arrives'
    );
  }

  if (!structural.includes(to)) {
    return (
      `ປ່ຽນຈາກ "${from}" ໄປ "${to}" ບໍ່ໄດ້ · Cannot move a booking from "${from}" to "${to}"` +
      (structural.length ? ` (allowed: ${structural.join(', ')})` : '')
    );
  }

  const checkIn = isoDayUtc(booking.check_in);
  const checkOut = isoDayUtc(booking.check_out);

  if (from === booking_status.confirmed && to === booking_status.staying) {
    if (today.getTime() < booking.check_in.getTime()) {
      return (
        `ຍັງບໍ່ເຖິງມື້ເຂົ້າພັກ (${checkIn}) ເຊັກອິນບໍ່ໄດ້ · ` +
        `Check-in opens on the arrival date (${checkIn})`
      );
    }
    if (today.getTime() >= booking.check_out.getTime()) {
      return (
        `ເກີນມື້ອອກ (${checkOut}) ແລ້ວ ເຊັກອິນບໍ່ໄດ້ · ` +
        `This stay's dates have already passed (check-out ${checkOut})`
      );
    }
  }

  if (from === booking_status.confirmed && to === booking_status.no_show) {
    if (today.getTime() <= booking.check_in.getTime()) {
      return (
        'ຍັງບໍ່ພົ້ນມື້ເຂົ້າພັກ ໝາຍວ່າບໍ່ມາບໍ່ໄດ້ · ' +
        'A no-show can only be recorded once the arrival day has passed'
      );
    }
  }

  return null;
}
