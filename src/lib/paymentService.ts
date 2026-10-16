import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocFromCache,
  getDocsFromCache,
  setDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  PaymentRecord,
  PaymentSettings,
  PaymentEvent,
  PaymentStatusCode,
  Booking,
  BookingStatusHistory,
} from '../types';
import { addBookingStatusHistory, upsertCustomerCRM } from './dbService';
import { cleanFirestoreData } from './utils';
import { emitEvent } from './notificationService';
import { optimizeFileForFirestore } from './imageOptimizer';

import { OFFICIAL_SENZU_BANK_ACCOUNTS, OFFICIAL_SENZU_QRIS, DEFAULT_PAYMENT_SETTINGS } from './paymentDefaults';
export { OFFICIAL_SENZU_BANK_ACCOUNTS, OFFICIAL_SENZU_QRIS, DEFAULT_PAYMENT_SETTINGS } from './paymentDefaults';
import { paymentRequest } from './paymentApi';
import { trackMetaAdsAction } from './metaPixel';

// ----------------- PAYMENT SETTINGS -----------------

export async function getPaymentSettings(): Promise<PaymentSettings> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'payment'));
    if (snap.exists()) {
      const data = snap.data() as Partial<PaymentSettings>;
      
      // Ensure bankAccounts is always a non-empty array with valid bankName
      const rawBanks = Array.isArray(data?.bankAccounts) ? data.bankAccounts.filter(Boolean) : [];
      const bankAccounts = rawBanks.length > 0
        ? (rawBanks || []).map((b: any, idx: number) => ({
            id: b.id || `bank_${idx}`,
            bankCode: b.bankCode || 'BNI',
            bankName: b.bankName || b.bankCode || 'Bank BNI',
            accountNumber: b.accountNumber || '',
            accountHolder: b.accountHolder || 'PT KSBONE UNTUK KITA',
            enabled: b.enabled !== false,
            sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : idx + 1,
          }))
        : OFFICIAL_SENZU_BANK_ACCOUNTS;

      const qris = data?.qris
        ? {
            ...OFFICIAL_SENZU_QRIS,
            ...data.qris,
          }
        : OFFICIAL_SENZU_QRIS;

      return {
        manualPaymentEnabled: data?.manualPaymentEnabled !== false,
        bankAccounts,
        qris,
      };
    }
    // If not exists, save defaults
    await setDoc(doc(db, 'settings', 'payment'), DEFAULT_PAYMENT_SETTINGS, { merge: true });
    return DEFAULT_PAYMENT_SETTINGS;
  } catch (err) {
    console.warn('Payment settings fallback to defaults:', err);
    return DEFAULT_PAYMENT_SETTINGS;
  }
}

export async function updatePaymentSettings(settings: Partial<PaymentSettings>): Promise<void> {
  const ref = doc(db, 'settings', 'payment');
  await setDoc(
    ref,
    {
      ...settings,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

// ----------------- PAYMENT STATUS HELPERS -----------------

export function isPaymentPaid(status?: string): boolean {
  if (!status || typeof status !== 'string') return false;
  return status.toLowerCase() === 'paid';
}

export function getPaymentStatusLabel(status?: string): string {
  if (!status || typeof status !== 'string') return 'Menunggu Pembayaran';
  const s = status.toLowerCase();
  switch (s) {
    case 'paid':
      return 'Pembayaran Terverifikasi';
    case 'pending_manual_verification':
      return 'Pembayaran Sedang Diverifikasi';
    case 'unpaid':
      return 'Menunggu Pembayaran';
    case 'payment_rejected':
      return 'Bukti Pembayaran Ditolak';
    case 'expired':
      return 'Waktu Pembayaran Berakhir';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Refund Sebagian';
    case 'cancelled':
      return 'Dibatalkan';
    case 'failed':
      return 'Gagal';
    default:
      return status;
  }
}

export function getPaymentStatusBadgeStyle(status?: string): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  const s = (typeof status === 'string' ? status : 'unpaid').toLowerCase();
  switch (s) {
    case 'paid':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700 font-bold',
        border: 'border-emerald-200',
        label: 'Pembayaran Terverifikasi',
      };
    case 'pending_manual_verification':
      return {
        bg: 'bg-blue-50',
        text: 'text-blue-700 font-bold',
        border: 'border-blue-200',
        label: 'Pembayaran Sedang Diverifikasi',
      };
    case 'payment_rejected':
      return {
        bg: 'bg-rose-50',
        text: 'text-rose-700 font-bold',
        border: 'border-rose-200',
        label: 'Bukti Pembayaran Ditolak',
      };
    case 'expired':
      return {
        bg: 'bg-slate-100',
        text: 'text-slate-600 font-bold',
        border: 'border-slate-300',
        label: 'Waktu Pembayaran Berakhir',
      };
    case 'refunded':
    case 'partially_refunded':
      return {
        bg: 'bg-purple-50',
        text: 'text-purple-700 font-bold',
        border: 'border-purple-200',
        label: 'Refund',
      };
    case 'unpaid':
    default:
      return {
        bg: 'bg-amber-50',
        text: 'text-amber-700 font-bold',
        border: 'border-amber-200',
        label: 'Menunggu Pembayaran',
      };
  }
}

// ----------------- AUDIT TRAIL / EVENTS -----------------

export async function getPaymentEvents(paymentId: string): Promise<PaymentEvent[]> {
  try {
    const q = query(
      collection(db, 'payment_status_history'),
      where('paymentId', '==', paymentId)
    );
    const snap = await getDocs(q);
    const events = snap.docs.map((d) => d.data() as PaymentEvent);
    events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return events;
  } catch {
    return [];
  }
}

// ----------------- PAYMENT OPERATIONS -----------------

/**
 * Authoritatively expires a payment if deadline has passed and no proof was uploaded.
 * Invokes the protected backend endpoint.
 */
export async function expirePaymentIfEligible(
  paymentId: string,
  bookingId?: string
): Promise<{ success: boolean; expired: boolean; message?: string }> {
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
    if (!idToken) {
      return { success: false, expired: false, message: 'Autentikasi diperlukan untuk memproses kedaluwarsa pembayaran.' };
    }
    const res = await fetch(`/api/payments/${paymentId}/expire`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ bookingId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof window !== 'undefined' && data.expired && bookingId) {
        try {
          const cached = localStorage.getItem('senzu_payment_' + bookingId);
          if (cached) {
            const parsed = JSON.parse(cached);
            localStorage.setItem(
              'senzu_payment_' + bookingId,
              JSON.stringify({ ...parsed, status: 'expired', expiredAt: new Date().toISOString() })
            );
          }
        } catch {}
      }
      return data;
    }
    const errData = await res.json().catch(() => null);
    return { success: false, expired: false, message: errData?.error || 'Gagal memproses kedaluwarsa pada server.' };
  } catch (err: any) {
    console.warn('Backend expire payment call notice:', err);
    return { success: false, expired: false, message: err?.message || 'Koneksi ke server gagal.' };
  }
}

/**
 * Creates or retrieves the active payment record for a booking.
 * Enforces price authority from database (service price + home service fee).
 */
export async function createOrGetPaymentForBooking(
  booking: Booking,
  methodChoice: {
    methodType: 'qris' | 'bni' | 'mandiri' | 'bri';
  }
): Promise<PaymentRecord> {
  const result = await paymentRequest('/api/payments/initialize', {
    bookingId: booking.id,
    methodType: methodChoice.methodType,
  });
  return result.payment as PaymentRecord;
}

/**
 * Upload payment proof by Customer
 * Validates mimeType, compresses image client-side to < 500KB to strictly comply with Firestore's 1MB limit
 * Sets paymentStatus to 'pending_manual_verification'
 */
export async function uploadPaymentProof(
  paymentId: string,
  bookingId: string,
  file: File,
  uploaderName: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Raw file sanity limit (e.g. max 15MB before compression)
  const MAX_RAW_SIZE_BYTES = 15 * 1024 * 1024;
  if (file.size > MAX_RAW_SIZE_BYTES) {
    return { success: false, error: 'Ukuran file asli bukti pembayaran melebihi batas maksimal (15 MB).' };
  }

  // 2. Validate MIME type
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  const fileType = (file?.type || '').toLowerCase();
  if (!allowedMimeTypes.includes(fileType)) {
    return {
      success: false,
      error: 'Format file tidak didukung. Harap upload gambar (JPG, JPEG, PNG) atau dokumen PDF.',
    };
  }

  try {
    // 3. Compress / optimize file to strictly respect Firestore document size limit (< 500 KB)
    const optimized = await optimizeFileForFirestore(file, {
      maxDimension: 1200,
      initialQuality: 0.75,
      maxOutputSizeBytes: 500 * 1024,
    });

    const result = await paymentRequest(`/api/payments/${encodeURIComponent(paymentId)}/proof`, {
      bookingId,
      dataUrl: optimized.dataUrl,
      mimeType: optimized.mimeType,
      fileName: file.name,
    });
    const currentPaymentData = result.payment as PaymentRecord;
    const bookingCode = currentPaymentData.bookingCode || bookingId;
    void trackMetaAdsAction('payment_proof_submitted', { entityId: bookingId, value: currentPaymentData.amount });
    // Retry of the same accepted proof must not duplicate notifications.
    if (result.isIdempotent) return { success: true };

    // Emit payment.proof_uploaded event
    try {
      emitEvent('payment.proof_uploaded', {
        paymentId,
        bookingId,
        bookingCode,
        customerName: uploaderName,
        fileName: file.name,
        amount: currentPaymentData?.amount || 0,
      }, { id: uploaderName, role: 'customer' }).catch((e) => console.warn('Proof upload emit error:', e));
    } catch (e) {
      // Non-blocking
    }

    return { success: true };
  } catch (err: any) {
    console.error('Failed to save payment proof:', err);
    
    // Map specific errors to clean, friendly Indonesian messages as mandated by Prompt guidelines
    const errorCode = err?.code || '';
    const errorMessage = (err?.message || '').toLowerCase();

    if (
      errorCode === 'resource-exhausted' ||
      errorMessage.includes('quota') ||
      errorMessage.includes('resource-exhausted')
    ) {
      return {
        success: false,
        error: 'Layanan upload sedang sibuk. Silakan coba kembali beberapa saat lagi.',
      };
    }

    if (errorCode === 'permission-denied' || errorMessage.includes('permission')) {
      return {
        success: false,
        error: 'Bukti pembayaran tidak dapat disimpan untuk pesanan ini.',
      };
    }

    if (errorCode === 'unauthenticated' || errorMessage.includes('unauthenticated')) {
      return {
        success: false,
        error: 'Sesi Anda telah berakhir. Silakan masuk kembali.',
      };
    }

    if (errorCode === 'invalid-argument') {
      return {
        success: false,
        error: 'Format data bukti pembayaran tidak valid.',
      };
    }

    return {
      success: false,
      error: 'Bukti pembayaran gagal dikirim. Silakan coba kembali.',
    };
  }
}

/**
 * CSS: Verify Payment
 * Sets paymentStatus = 'paid'
 * If bookingStatus == 'awaiting_payment' / 'Menunggu Pembayaran', changes to 'Confirmed'
 * Idempotent & prevents double clicks
 */
export async function cssVerifyPaymentTransaction(
  payment: PaymentRecord,
  booking: Booking,
  staffId: string,
  staffName: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const now = new Date().toISOString();

    // 1. Phase 5: Authoritative verification via trusted backend server endpoint
    try {
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
      const resp = await fetch(`/api/payments/${payment.id}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          bookingId: booking.id,
          note: note || `Pembayaran diverifikasi oleh CSS (${staffName}). Nominal: Rp${payment.amount.toLocaleString('id-ID')}`,
          staffId,
          staffName,
          staffAuthUid: auth.currentUser?.uid,
        }),
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result.isIdempotent) return { success: true };
        const nextBookingStatus = result.nextBookingStatus || booking.status;

        // Update CRM and emit notifications
        await upsertCustomerCRM({
          ...booking,
          status: nextBookingStatus,
          paymentStatus: 'paid',
        }).catch(() => {});

        try {
          emitEvent('payment.verified', {
            paymentId: payment.id,
            bookingId: booking.id,
            bookingCode: booking.bookingCode,
            customerId: booking.customerId,
            customerName: booking.customerName,
            customerWhatsApp: booking.customerWhatsApp,
            customerEmail: booking.customerEmail,
            serviceName: booking.serviceName,
            amount: payment.amount,
            scheduleAt: booking.scheduleAt,
            area: booking.area,
          }, { id: staffId, role: 'css' }).catch(() => {});

          emitEvent('booking.ready_for_assignment', {
            bookingId: booking.id,
            bookingCode: booking.bookingCode,
            customerId: booking.customerId,
            customerName: booking.customerName,
            serviceName: booking.serviceName,
            scheduleAt: booking.scheduleAt,
            area: booking.area,
          }, { id: staffId, role: 'css' }).catch(() => {});
        } catch {}

        return { success: true };
      }
      const errorData = await resp.json().catch(() => null);
      return { success: false, error: errorData?.error || 'Verifikasi pembayaran gagal. Silakan coba kembali.' };
    } catch (backendErr) {
      return { success: false, error: 'Server pembayaran tidak dapat dihubungi. Silakan coba kembali.' };
    }
  } catch (err) {
    console.error('Failed to verify payment:', err);
    return { success: false, error: 'Gagal memverifikasi pembayaran. Silakan coba kembali.' };
  }
}

/**
 * CSS: Reject Payment
 * Requires rejection reason & note
 * Sets paymentStatus = 'payment_rejected'
 */
export async function cssRejectPaymentTransaction(
  payment: PaymentRecord,
  booking: Booking,
  staffId: string,
  staffName: string,
  reason: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  if (!reason) {
    return { success: false, error: 'Alasan penolakan pembayaran wajib dipilih.' };
  }

  try {
    const now = new Date().toISOString();

    // Phase 5: Execute rejection via trusted backend server endpoint
    try {
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
      const resp = await fetch(`/api/payments/${payment.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          bookingId: booking.id,
          reason,
          note: note || '',
          staffId,
          staffName,
          staffAuthUid: auth.currentUser?.uid,
        }),
      });
      if (resp.ok) {
        return { success: true };
      }
      const errorData = await resp.json().catch(() => null);
      return { success: false, error: errorData?.error || 'Penolakan pembayaran gagal. Silakan coba kembali.' };
    } catch (backendErr) {
      return { success: false, error: 'Server pembayaran tidak dapat dihubungi. Silakan coba kembali.' };
    }
  } catch (err) {
    console.error('Failed to reject payment:', err);
    return { success: false, error: 'Gagal menolak pembayaran.' };
  }
}

const ALLOWED_ADMIN_CORRECTION_PAYMENT_STATUSES = new Set<PaymentStatusCode>([
  'unpaid',
  'pending_manual_verification',
  'paid',
  'payment_rejected',
  'pending',
  'failed',
  'expired',
  'cancelled',
  'refunded',
  'partially_refunded',
]);

function isValidPaymentCorrectionDocId(value: unknown, maxLen = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maxLen &&
    value.trim() === value &&
    !value.includes('/') &&
    !/[\x00-\x1F\x7F\s]/.test(value)
  );
}

function generatePaymentCorrectionRequestId(): string {
  const ts = Date.now().toString(36);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `pcorr_${ts}_${hex}`;
  }
  return `pcorr_${ts}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Admin: Payment Correction
 * Allows authorized admin/manager to adjust payment state via authoritative server transaction
 */
export async function adminCorrectPayment(
  payment: PaymentRecord,
  booking: Booking,
  _staffId: string,
  _staffName: string,
  newStatus: PaymentStatusCode,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  if (typeof reason !== 'string' || !reason.trim()) {
    return { success: false, error: 'Alasan koreksi pembayaran wajib diisi.' };
  }

  const cleanReason = reason.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleanReason || cleanReason.length > 500) {
    return { success: false, error: 'Alasan koreksi pembayaran tidak valid atau melebihi batas.' };
  }

  const paymentId = typeof payment?.id === 'string' ? payment.id.trim() : '';
  const bookingId = typeof booking?.id === 'string' ? booking.id.trim() : '';
  if (
    !isValidPaymentCorrectionDocId(paymentId, 128) ||
    !isValidPaymentCorrectionDocId(bookingId, 128)
  ) {
    return { success: false, error: 'ID pembayaran atau reservasi tidak valid.' };
  }

  if (
    payment?.bookingId !== undefined &&
    payment?.bookingId !== null &&
    payment?.bookingId !== '' &&
    (typeof payment.bookingId !== 'string' || payment.bookingId.trim() !== bookingId)
  ) {
    return { success: false, error: 'ID reservasi tidak sesuai dengan data pembayaran.' };
  }

  if (
    typeof newStatus !== 'string' ||
    !ALLOWED_ADMIN_CORRECTION_PAYMENT_STATUSES.has(newStatus)
  ) {
    return { success: false, error: 'Status koreksi pembayaran tidak valid.' };
  }

  const initialSession = auth?.currentUser;
  const initialUid =
    initialSession && typeof initialSession.uid === 'string' ? initialSession.uid.trim() : '';
  if (
    !initialSession ||
    !initialUid ||
    initialSession.uid !== initialUid ||
    !isValidPaymentCorrectionDocId(initialUid, 128) ||
    typeof initialSession.getIdToken !== 'function'
  ) {
    return {
      success: false,
      error: 'Autentikasi Manager/Admin diperlukan untuk melakukan koreksi pembayaran.',
    };
  }

  const requestId = generatePaymentCorrectionRequestId();
  const payload = {
    bookingId,
    newStatus,
    reason: cleanReason,
    requestId,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const currentSession = auth?.currentUser;
      if (
        !currentSession ||
        currentSession.uid !== initialUid ||
        typeof currentSession.getIdToken !== 'function'
      ) {
        return { success: false, error: 'Sesi pengguna telah berubah atau berakhir.' };
      }

      const rawToken = await currentSession.getIdToken();
      const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
      if (!idToken || !auth?.currentUser || auth.currentUser.uid !== initialUid) {
        return { success: false, error: 'Sesi pengguna telah berubah atau berakhir.' };
      }

      const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/correct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
        return { success: false, error: 'Sesi pengguna telah berubah atau berakhir.' };
      }

      const data = await res.json().catch(() => null);

      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
        return { success: false, error: 'Sesi pengguna telah berubah atau berakhir.' };
      }

      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 40));
          continue;
        }
        const errMsg =
          (typeof data?.error === 'string' && data.error.trim()) ||
          (typeof data?.message === 'string' && data.message.trim()) ||
          'Gagal melakukan koreksi pembayaran.';
        return { success: false, error: errMsg };
      }

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        data.success !== true ||
        !data.payment ||
        typeof data.payment !== 'object' ||
        Array.isArray(data.payment) ||
        data.payment.id !== paymentId ||
        data.payment.status !== newStatus ||
        (data.bookingId !== undefined && data.bookingId !== bookingId)
      ) {
        return { success: false, error: 'Respons koreksi pembayaran dari server tidak valid.' };
      }

      return { success: true };
    } catch (err) {
      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
        return { success: false, error: 'Sesi pengguna telah berubah atau berakhir.' };
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      console.error('Payment correction error:', err);
      return { success: false, error: 'Gagal melakukan koreksi pembayaran.' };
    }
  }

  return { success: false, error: 'Gagal melakukan koreksi pembayaran.' };
}

// ----------------- SUBSCRIPTIONS & QUERIES -----------------

export function subscribeToAllPayments(callback: (payments: PaymentRecord[]) => void) {
  return onSnapshot(
    collection(db, 'payments'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as PaymentRecord);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    (err) => {
      console.warn('Realtime payments subscription notice:', err.message);
      callback([]);
    }
  );
}

export function subscribeToPendingPayments(callback: (payments: PaymentRecord[]) => void) {
  const q = query(
    collection(db, 'payments'),
    where('status', '==', 'pending_manual_verification')
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as PaymentRecord);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    (err) => {
      console.warn('Pending payments subscription notice:', err.message);
      callback([]);
    }
  );
}

export function subscribeToPaymentByBookingId(
  bookingId: string,
  callback: (payment: PaymentRecord | null) => void
) {
  const uid = auth.currentUser?.uid;
  let closed = false;
  let paymentUnsub: (() => void) | undefined;
  let bookingUnsub: (() => void) | undefined;
  let authUnsub: (() => void) | undefined;
  let observedId: string | undefined;
  let generation = 0;
  const current = () => !closed && !!uid && auth.currentUser?.uid === uid;
  const stop = () => { closed = true; generation++; paymentUnsub?.(); bookingUnsub?.(); authUnsub?.(); };
  if (!uid) { callback(null); return stop; }
  const lookup = async () => {
    const request = ++generation;
    try {
      const result = await paymentRequest('/api/payments/lookup', { bookingId });
      if (!current() || request !== generation) return;
      const payment = result.payment as PaymentRecord | null;
      if (!payment) { callback(null); return; }
      if (observedId === payment.id) return;
      paymentUnsub?.(); observedId = payment.id;
      callback(payment);
      paymentUnsub = onSnapshot(doc(db, 'payments', payment.id), snap => {
        if (current()) callback(snap.exists() ? { ...snap.data(), id: snap.id } as PaymentRecord : null);
      }, error => {
        if (current()) callback(null);
        console.warn('Payment document subscription failed:', error.code);
      });
    } catch (error) {
      if (current() && request === generation) callback(null);
      console.warn('Payment lookup failed:', error);
    }
  };
  // Booking writes already accompany payment creation/status changes; no polling required.
  bookingUnsub = onSnapshot(doc(db, 'bookings', bookingId), () => { if (current()) void lookup(); }, () => {
    if (current()) callback(null);
  });
  authUnsub = onAuthStateChanged(auth, user => {
    if (user?.uid !== uid) { callback(null); stop(); }
  });
  return stop;
}

export function subscribeToPaymentForBooking(
  bookingId: string,
  _bookingCode: string,
  callback: (payment: PaymentRecord | null) => void
) {
  return subscribeToPaymentByBookingId(bookingId, callback);
}

export async function getPaymentByBookingCode(bookingCode: string): Promise<PaymentRecord | null> {
  try {
    const q = query(
      collection(db, 'payments'),
      where('bookingCode', '==', bookingCode.trim().toUpperCase())
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const list = snap.docs.map((d) => d.data() as PaymentRecord);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list[0];
  } catch {
    return null;
  }
}

export const createPaymentRecord = createOrGetPaymentForBooking;

export async function getPaymentRecordByBookingId(bookingId: string): Promise<PaymentRecord | null> {
  const result = await paymentRequest('/api/payments/lookup', { bookingId });
  return result.payment as PaymentRecord | null;
}

function formatRupiah(amount: number): string {
  return 'Rp' + amount.toLocaleString('id-ID');
}
