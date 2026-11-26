/**
 * FAT Finance customer-name resolution.
 * Legacy payment documents may lack the customerName snapshot written by current
 * payment writers. The related booking holds the authoritative customerName.
 * Resolve in batched reads only; never substitute email, phone or document ids.
 */

export interface FatNamePayment {
  bookingId?: string;
  customerName?: string;
}

export interface FatNameBooking {
  customerName?: string;
}

export interface FatNameDb {
  collection(name: string): { doc(id: string): unknown };
  getAll(...refsAndOptions: any[]): Promise<Array<{ exists: boolean; data: () => any } | undefined>>;
}

const cleanName = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : '';

/** Payment snapshot wins; otherwise the related booking. Contact fields are never read. */
export function resolveFatCustomerName(payment: FatNamePayment, booking?: FatNameBooking | null): string {
  return cleanName(payment.customerName) || cleanName(booking?.customerName);
}

export const FAT_BOOKING_LOOKUP_CHUNK_SIZE = 500;

/** Fills missing customerName on projected payments using at most one batched read per chunk. */
export async function hydrateFatCustomerNames(
  payments: FatNamePayment[],
  db: FatNameDb,
  chunkSize = FAT_BOOKING_LOOKUP_CHUNK_SIZE,
): Promise<void> {
  const missing = new Map<string, number[]>();
  payments.forEach((payment, index) => {
    payment.customerName = cleanName(payment.customerName);
    const bookingId = typeof payment.bookingId === 'string' ? payment.bookingId.trim() : '';
    // Malformed legacy ids would make doc() throw and discard the whole batch.
    if (!bookingId || bookingId.includes('/') || bookingId === '.' || bookingId === '..' || payment.customerName) return;
    const indexes = missing.get(bookingId);
    if (indexes) indexes.push(index);
    else missing.set(bookingId, [index]);
  });
  if (missing.size === 0) return;

  const ids = Array.from(missing.keys());
  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : FAT_BOOKING_LOOKUP_CHUNK_SIZE;
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    try {
      const refs = chunk.map(id => db.collection('bookings').doc(id));
      const snaps = await db.getAll(...refs, { fieldMask: ['customerName'] });
      chunk.forEach((id, j) => {
        const snap = snaps?.[j];
        names.set(id, snap?.exists ? cleanName(snap.data()?.customerName) : '');
      });
    } catch (err) {
      // An unavailable booking lookup leaves those rows as '-' instead of failing the whole table.
      console.warn('FAT customer-name booking lookup notice:', err);
      chunk.forEach(id => names.set(id, ''));
    }
  }
  for (const [id, indexes] of missing) {
    const name = names.get(id);
    if (!name) continue;
    for (const index of indexes) payments[index].customerName = name;
  }
}
