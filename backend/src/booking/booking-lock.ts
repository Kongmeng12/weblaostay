import type { Prisma } from '@prisma/client';

/**
 * Takes the booking's row lock for the rest of the transaction.
 *
 * Three paths move a booking's status AND its inventory counters: payment
 * settling it, the hold sweeper expiring it, and a person cancelling it. Each
 * reads the status, then picks which counter to touch (held or booked). Run
 * two at once and both can read "pending": the sweeper gives the hold back
 * while settlement moves that same hold into booked — and the second
 * decrement lands on some other guest's hold, so the counters undercount and
 * the room can be sold twice. Locking first, then reading, makes them queue.
 *
 * Call it before the status is read, in every one of those paths.
 */
export async function lockBooking(tx: Prisma.TransactionClient, bookingId: bigint): Promise<void> {
  await tx.$queryRaw`SELECT booking_id FROM bookings WHERE booking_id = ${bookingId} FOR UPDATE`;
}
