import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  or,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { Booking, PaymentRecord, PaymentSettings } from '../types';
import { CustomerCRM } from '../types/crm';
import { normalizeIndonesianPhone, cleanFirestoreData } from './crmService';
import { getPaymentSettings, OFFICIAL_SENZU_BANK_ACCOUNTS, OFFICIAL_SENZU_QRIS } from './paymentService';

/**
 * Standardizes any Indonesian phone number to clean digits starting with 62
 * e.g. "089698203326" -> "6289698203326"
 *      "+62896-9820-3326" -> "6289698203326"
 */
export function normalizePhoneDigits(phone?: string | null): string {
  if (!phone) return '';
  const { cleanDigits } = normalizeIndonesianPhone(phone);
  if (cleanDigits) return cleanDigits;
  let raw = phone.replace(/[^0-9]/g, '');
  if (raw.startsWith('0')) {
    raw = '62' + raw.slice(1);
  } else if (raw.startsWith('8')) {
    raw = '628' + raw.slice(1);
  }
  return raw;
}

/**
 * Compares two phone representations safely.
 */
export function phonesMatch(phoneA?: string | null, phoneB?: string | null): boolean {
  if (!phoneA || !phoneB) return false;
  const digitsA = normalizePhoneDigits(phoneA);
  const digitsB = normalizePhoneDigits(phoneB);
  if (digitsA.length >= 8 && digitsB.length >= 8) {
    if (digitsA === digitsB) return true;
    if (digitsA.includes(digitsB) || digitsB.includes(digitsA)) return true;
  }
  return false;
}

/**
 * Filters a list of bookings to only those belonging to the given customer (by verified Firebase UID).
 * Prevents unauthorized exposure or claiming of bookings through unverified contact matching.
 */
export function filterCustomerBookings(
  allBookings: Booking[],
  customer: CustomerCRM | null,
  guestPhone?: string | null,
  authUid?: string | null
): Booking[] {
  if (!Array.isArray(allBookings) || allBookings.length === 0) return [];

  const targetAuthUid = authUid || auth.currentUser?.uid || customer?.authUserId;

  // 1. Authenticated customer flow: strictly scoped by verified Firebase UID
  if (targetAuthUid) {
    return allBookings
      .filter((b) => {
        // Conflict check: if customerAuthUid and authUserId disagree, exclude from active display
        if (b.customerAuthUid && b.authUserId && b.customerAuthUid !== b.authUserId) {
          return false;
        }
        // Direct canonical customerAuthUid match
        if (b.customerAuthUid && b.customerAuthUid === targetAuthUid) {
          return true;
        }
        // Backward-compatible auth user ID match
        if ((b as any).authUserId && (b as any).authUserId === targetAuthUid) {
          return true;
        }
        return false;
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  // 2. Unauthenticated guest: A phone number alone must never enumerate bookings
  return [];
}

/**
 * Returns the highest priority active booking for a customer.
 */
export function getActiveBooking(
  customerBookings: Booking[],
  savedLastBookingCode?: string | null
): Booking | null {
  if (!customerBookings || customerBookings.length === 0) return null;

  // If there is a last booking code saved in localStorage, check if it's currently active
  if (savedLastBookingCode) {
    const match = customerBookings.find((b) => b.bookingCode === savedLastBookingCode);
    if (match) {
      const s = (match.status || '').toLowerCase();
      if (s !== 'completed' && s !== 'cancelled') {
        return match;
      }
    }
  }

  // Otherwise pick the newest active booking
  const activeList = customerBookings.filter((b) => {
    const s = (b.status || '').toLowerCase();
    return s !== 'completed' && s !== 'cancelled';
  });

  return activeList[0] || null;
}

/**
 * Reconciles customer bookings in Firestore safely and idempotently.
 * Uses the authoritative backend endpoint with verified authentication.
 */
export async function reconcileCustomerBookingsInFirestore(
  customer: CustomerCRM,
  authUserId?: string
): Promise<number> {
  if (!customer) return 0;

  try {
    const user = auth.currentUser;
    if (!user) return 0;

    const idToken = await user.getIdToken();
    const res = await fetch('/api/customer/reconcile-bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ idToken, authUserId: authUserId || user.uid }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.reconciledCount || 0;
    }
    return 0;
  } catch (err) {
    console.warn('Reconciliation non-blocking warning:', err);
    return 0;
  }
}

/**
 * Realtime hook-friendly listener for a specific customer's bookings
 */
export function subscribeToCustomerBookings(
  customer: CustomerCRM | null,
  guestPhone: string | null | undefined,
  callback: (bookings: Booking[], activeBooking: Booking | null) => void
): () => void {
  const authUid = auth.currentUser?.uid || customer?.authUserId || '';

  if (!authUid) {
    callback([], null);
    return () => {};
  }

  let q;
  try {
    q = query(
      collection(db, 'bookings'),
      or(
        where('customerAuthUid', '==', authUid),
        where('authUserId', '==', authUid)
      )
    );
  } catch {
    q = query(collection(db, 'bookings'), where('customerAuthUid', '==', authUid));
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const all: Booking[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      const filtered = filterCustomerBookings(all, customer, null, authUid);
      const savedCode = typeof window !== 'undefined' ? localStorage.getItem('senzu_last_booking_code') : null;
      const active = getActiveBooking(filtered, savedCode);

      callback(filtered, active);
    },
    (err) => {
      console.warn('Customer bookings subscription notice:', err.message);
    }
  );
}
