/**
 * Central Loyalty, Membership, Points, Voucher & Referral Service for Senzu Home Palembang
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  runTransaction,
  deleteDoc,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  CustomerLoyaltyAccount,
  LoyaltyTransaction,
  MembershipTier,
  Voucher,
  CustomerVoucher,
  ReferralRecord,
  LoyaltySettings,
  DEFAULT_LOYALTY_SETTINGS,
  DEFAULT_MEMBERSHIP_TIERS,
  LoyaltyTransactionType,
  PromoValidationResult,
} from '../types/loyalty';
import { Booking } from '../types';
import { CustomerCRM } from '../types/crm';
import { isPaymentPaid } from './paymentService';
import { emitEvent } from './notificationService';
import { normalizeIndonesianPhone } from './crmService';
import { cleanFirestoreData } from './utils';

// ----------------- SETTINGS & TIERS -----------------

export async function getLoyaltySettings(): Promise<LoyaltySettings> {
  try {
    const snap = await getDoc(doc(db, 'loyalty_settings', 'general'));
    if (snap.exists()) {
      return { ...DEFAULT_LOYALTY_SETTINGS, ...(snap.data() as LoyaltySettings) };
    }
  } catch (err) {
    console.warn('Could not fetch loyalty_settings, using defaults:', err);
  }
  return DEFAULT_LOYALTY_SETTINGS;
}

export async function updateLoyaltySettings(
  settingsData: Partial<LoyaltySettings>,
  updatedBy: string
): Promise<LoyaltySettings> {
  const current = await getLoyaltySettings();
  const updated: LoyaltySettings = {
    ...current,
    ...settingsData,
    id: 'general',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await setDoc(doc(db, 'loyalty_settings', 'general'), cleanFirestoreData(updated));
  return updated;
}

export async function getMembershipTiers(): Promise<MembershipTier[]> {
  try {
    const snap = await getDocs(collection(db, 'membership_tiers'));
    if (!snap.empty) {
      const list = snap.docs.map((d) => d.data() as MembershipTier);
      return list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
  } catch (err) {
    console.warn('Could not fetch membership_tiers, initializing defaults:', err);
  }

  // Seed default tiers if empty
  for (const tier of DEFAULT_MEMBERSHIP_TIERS) {
    try {
      await setDoc(doc(db, 'membership_tiers', tier.id), cleanFirestoreData(tier));
    } catch {
      // ignore
    }
  }
  return DEFAULT_MEMBERSHIP_TIERS;
}

export async function updateMembershipTier(tier: MembershipTier): Promise<void> {
  const ref = doc(db, 'membership_tiers', tier.id);
  await setDoc(ref, cleanFirestoreData({ ...tier, updatedAt: new Date().toISOString() }), { merge: true });
}

// ----------------- REFERRAL & MEMBER CODE GENERATORS -----------------

export function generateMemberNumber(cleanDigits: string): string {
  const tail = cleanDigits.slice(-6).padStart(6, '0');
  return `SZH-${tail}`;
}

export function generateReferralCode(name: string, cleanDigits: string): string {
  const cleanName = name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5) || 'SENZU';
  const tail = cleanDigits.slice(-3) || Math.floor(100 + Math.random() * 900).toString();
  const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `SENZU-${cleanName}${tail}${randomLetter}`;
}

// ----------------- LOYALTY ACCOUNT MANAGEMENT -----------------

export async function getLoyaltyAccountByCustomerId(
  customerId: string
): Promise<CustomerLoyaltyAccount | null> {
  try {
    const snap = await getDoc(doc(db, 'loyalty_accounts', customerId));
    if (snap.exists()) {
      return snap.data() as CustomerLoyaltyAccount;
    }
  } catch (err) {
    console.warn('Error fetching loyalty account:', err);
  }
  return null;
}

export async function getOrCreateLoyaltyAccount(customer: {
  id: string;
  name: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  birthDate?: string;
}): Promise<CustomerLoyaltyAccount> {
  const existing = await getLoyaltyAccountByCustomerId(customer.id);
  if (existing) {
    return existing;
  }

  // Creating the account is server-side: Firestore rules keep loyalty_accounts staff-only.
  // shortcut: a guest earns under the booking's customer key (cust_<phone>); those points are not
  // claimed when that person later registers, because a phone typed into a profile is never verified
  // and must not grant ownership of someone else's balance. Revisit with phone/OTP verification.
  const rawToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
  const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!idToken) {
    throw Object.assign(new Error('Silakan masuk ke akun Anda untuk melihat dan mengumpulkan poin loyalitas.'), {
      code: 'AUTH_REQUIRED',
    });
  }

  const res = await fetch('/api/loyalty/account/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.account) {
    throw new Error(data?.error || 'Gagal menyiapkan akun poin loyalitas.');
  }
  return data.account as CustomerLoyaltyAccount;
}

export async function getAllLoyaltyAccounts(): Promise<CustomerLoyaltyAccount[]> {
  try {
    const snap = await getDocs(collection(db, 'loyalty_accounts'));
    return snap.docs.map((d) => d.data() as CustomerLoyaltyAccount);
  } catch (err) {
    console.warn('Error fetching all loyalty accounts:', err);
    return [];
  }
}

// ----------------- TRANSACTION LEDGER & BALANCE AUDIT -----------------

export async function getLoyaltyTransactions(
  customerId: string
): Promise<LoyaltyTransaction[]> {
  try {
    const q = query(
      collection(db, 'loyalty_transactions'),
      where('customerId', '==', customerId)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as LoyaltyTransaction);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.warn('Error fetching loyalty transactions:', err);
    return [];
  }
}

export async function getAllLoyaltyTransactions(
  limitCount = 100
): Promise<LoyaltyTransaction[]> {
  try {
    const snap = await getDocs(collection(db, 'loyalty_transactions'));
    const list = snap.docs.map((d) => d.data() as LoyaltyTransaction);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list.slice(0, limitCount);
  } catch (err) {
    console.warn('Error fetching all transactions:', err);
    return [];
  }
}

/**
 * Atomic Loyalty Transaction Recorder
 * Updates customer balance and writes ledger record inside a Firestore transaction.
 */
export async function recordLoyaltyTransaction(params: {
  customerId: string;
  customerName?: string;
  bookingId?: string;
  bookingCode?: string;
  transactionType: LoyaltyTransactionType;
  pointsDelta: number; // positive for gain, negative for spend
  referenceType: string;
  referenceId: string;
  reason: string;
  createdBy: string;
  expiresAt?: string | null;
  metadata?: Record<string, any>;
}): Promise<{ transaction: LoyaltyTransaction; newBalance: number }> {
  const accountRef = doc(db, 'loyalty_accounts', params.customerId);
  const now = new Date().toISOString();
  const txId = `ltx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let finalTx!: LoyaltyTransaction;
  let finalBalance = 0;

  await runTransaction(db, async (t) => {
    const snap = await t.get(accountRef);
    if (!snap.exists()) {
      throw new Error(`Loyalty account ${params.customerId} not found.`);
    }
    const acc = snap.data() as CustomerLoyaltyAccount;

    if (acc.status === 'suspended' || acc.status === 'closed') {
      throw new Error(`Loyalty account is ${acc.status}`);
    }

    const currentBalance = acc.pointsBalance || 0;
    const newBalance = currentBalance + params.pointsDelta;

    if (newBalance < 0) {
      throw new Error(
        `Saldo poin tidak mencukupi (Saldo: ${currentBalance}, Dibutuhkan: ${Math.abs(params.pointsDelta)})`
      );
    }

    finalBalance = newBalance;

    finalTx = {
      id: txId,
      customerId: params.customerId,
      customerName: params.customerName || acc.customerName,
      bookingId: params.bookingId,
      bookingCode: params.bookingCode,
      transactionType: params.transactionType,
      points: params.pointsDelta,
      balanceBefore: currentBalance,
      balanceAfter: newBalance,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      reason: params.reason,
      createdBy: params.createdBy,
      createdAt: now,
      expiresAt: params.expiresAt,
      metadata: cleanFirestoreData(params.metadata || {}),
    };

    const updatePayload: Partial<CustomerLoyaltyAccount> = {
      pointsBalance: newBalance,
      updatedAt: now,
    };

    if (params.pointsDelta > 0) {
      updatePayload.lifetimePointsEarned = (acc.lifetimePointsEarned || 0) + params.pointsDelta;
    } else if (params.pointsDelta < 0) {
      if (params.transactionType === 'expire') {
        updatePayload.lifetimePointsExpired = (acc.lifetimePointsExpired || 0) + Math.abs(params.pointsDelta);
      } else {
        updatePayload.lifetimePointsRedeemed = (acc.lifetimePointsRedeemed || 0) + Math.abs(params.pointsDelta);
      }
    }

    t.update(accountRef, cleanFirestoreData(updatePayload));
    t.set(doc(db, 'loyalty_transactions', txId), cleanFirestoreData(finalTx));
  });

  return { transaction: finalTx, newBalance: finalBalance };
}

// ----------------- TIER UPGRADE & QUALIFICATION -----------------

export async function evaluateAndUpgradeCustomerTier(
  customerId: string,
  account: CustomerLoyaltyAccount,
  tiers: MembershipTier[]
): Promise<MembershipTier | null> {
  const enabledTiers = tiers.filter((t) => t.enabled).sort((a, b) => b.level - a.level);
  const currentTier = tiers.find((t) => t.id === account.currentTierId) || tiers[0];

  let eligibleTier: MembershipTier | null = null;
  for (const tier of enabledTiers) {
    const spendMatch = account.qualifiedSpend >= tier.minimumQualifiedSpend;
    const bookingsMatch = account.qualifiedBookings >= tier.minimumCompletedBookings;
    if (spendMatch && bookingsMatch) {
      eligibleTier = tier;
      break;
    }
  }

  if (eligibleTier && eligibleTier.level > (currentTier?.level || 1)) {
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'loyalty_accounts', customerId), {
      currentTierId: eligibleTier.id,
      currentTierName: eligibleTier.name,
      tierStartedAt: now,
      updatedAt: now,
    });

    // Notify customer about tier upgrade
    emitEvent('membership.tier_upgraded', {
      customerId,
      customerName: account.customerName,
      customerWhatsApp: account.customerWhatsApp,
      newTierId: eligibleTier.id,
      newTierName: eligibleTier.name,
      previousTierId: currentTier?.id,
      previousTierName: currentTier.name,
      earningMultiplier: eligibleTier.earningMultiplier,
      tierStartedAt: now,
    }, { id: 'system', role: 'system' }).catch(() => {});

    return eligibleTier;
  }

  return null;
}

// ----------------- POINT EARNING FROM COMPLETED BOOKING -----------------

/**
 * Idempotent Point Earning Triggered upon Booking Completion & Full Payment
 */
export async function processBookingLoyaltyEarning(booking: Booking): Promise<{
  pointsEarned: number;
  reason: string;
} | null> {
  if (booking.status !== 'Completed' || !isPaymentPaid(booking.paymentStatus)) {
    return null;
  }

  // Earning runs server-side: Firestore rules keep loyalty_accounts staff-only, so the
  // therapist/customer client can never write the balance or the ledger.
  const rawToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
  const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!idToken) {
    return null;
  }

  try {
    const res = await fetch('/api/loyalty/earn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ bookingId: booking.id }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !(data.pointsEarned > 0)) {
      return null;
    }
    return { pointsEarned: data.pointsEarned, reason: data.reason || 'Earned' };
  } catch (err) {
    console.warn('Loyalty points earning trigger error:', err);
    return null;
  }
}

// ----------------- POINT REDEMPTION & REFUNDS -----------------

export async function redeemPointsForBooking(params: {
  customerId: string;
  points: number;
  bookingId: string;
  bookingCode: string;
  discountRp: number;
}): Promise<void> {
  if (params.points <= 0) return;

  const { transaction: redeemTx } = await recordLoyaltyTransaction({
    customerId: params.customerId,
    bookingId: params.bookingId,
    bookingCode: params.bookingCode,
    transactionType: 'redeem',
    pointsDelta: -params.points,
    referenceType: 'booking_checkout',
    referenceId: params.bookingId,
    reason: `Penukaran poin untuk reservasi ${params.bookingCode} (-Rp${params.discountRp.toLocaleString('id-ID')})`,
    createdBy: 'customer',
    metadata: {
      discountRp: params.discountRp,
    },
  });

  emitEvent('loyalty.points_redeemed', {
    customerId: params.customerId,
    bookingId: params.bookingId,
    bookingCode: params.bookingCode,
    pointsRedeemed: params.points,
    discountAmount: params.discountRp,
    transactionId: redeemTx.id,
    loyaltyTransactionId: redeemTx.id,
  }, { id: 'customer', role: 'customer' }).catch(() => {});
}

export async function refundLoyaltyPointsForCancelledBooking(
  booking: Booking,
  reason = 'Pengembalian poin karena booking dibatalkan'
): Promise<void> {
  const pointsRedeemed = booking.pointsRedeemed || 0;
  if (pointsRedeemed <= 0) return;

  // Idempotency: verify no existing refund_adjustment for this booking
  const existingTx = query(
    collection(db, 'loyalty_transactions'),
    where('bookingId', '==', booking.id),
    where('transactionType', '==', 'refund_adjustment')
  );
  const snap = await getDocs(existingTx);
  if (!snap.empty) return;

  await recordLoyaltyTransaction({
    customerId: booking.customerId,
    customerName: booking.customerName,
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    transactionType: 'refund_adjustment',
    pointsDelta: pointsRedeemed,
    referenceType: 'booking_cancellation',
    referenceId: booking.id,
    reason,
    createdBy: 'system',
  });
}

// ----------------- VOUCHERS & PROMOS MANAGEMENT -----------------

export const DEFAULT_SENZUWELCOME_PROMO: Voucher = {
  id: 'vch_senzuwelcome',
  code: 'SENZUWELCOME',
  name: 'Diskon Pengguna Baru',
  description: 'Potongan Rp 20.000 untuk treatment pertama Anda di Kota Palembang.',
  voucherType: 'fixed_discount',
  value: 20000,
  minimumSpend: 0,
  maximumDiscount: 20000,
  firstOrderOnly: true,
  newCustomerOnly: true,
  usageLimitPerCustomer: 1,
  usageLimitTotal: 1000,
  currentUsageCount: 0,
  validFrom: '2025-01-01T00:00:00.000Z',
  validUntil: '2030-12-31T23:59:59.999Z',
  enabled: true,
  stackable: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

export async function ensureSenzuWelcomeVoucherExists(): Promise<Voucher> {
  try {
    const ref = doc(db, 'vouchers', 'vch_senzuwelcome');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as Voucher;
    }
    const q = query(collection(db, 'vouchers'), where('code', '==', 'SENZUWELCOME'));
    const codeSnap = await getDocs(q);
    if (!codeSnap.empty) {
      return codeSnap.docs[0].data() as Voucher;
    }
    await setDoc(ref, cleanFirestoreData(DEFAULT_SENZUWELCOME_PROMO));
    return DEFAULT_SENZUWELCOME_PROMO;
  } catch (err) {
    console.warn('Could not ensure SENZUWELCOME voucher in Firestore:', err);
    return DEFAULT_SENZUWELCOME_PROMO;
  }
}

export async function getAllVouchers(): Promise<Voucher[]> {
  try {
    const snap = await getDocs(collection(db, 'vouchers'));
    let list = snap.docs.map((d) => d.data() as Voucher);
    if (list.length === 0 || !list.some((v) => (v.code || '').toUpperCase() === 'SENZUWELCOME')) {
      const seeded = await ensureSenzuWelcomeVoucherExists();
      if (!list.some((v) => v.id === seeded.id || (v.code || '').toUpperCase() === 'SENZUWELCOME')) {
        list.push(seeded);
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.warn('Error getting vouchers:', err);
    return [DEFAULT_SENZUWELCOME_PROMO];
  }
}

export async function getVoucherByCode(code: string): Promise<Voucher | null> {
  if (!code) return null;
  const cleanCode = code.trim().toUpperCase();
  try {
    const q = query(
      collection(db, 'vouchers'),
      where('code', '==', cleanCode),
      where('enabled', '==', true)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const v = snap.docs[0].data() as Voucher;
      const now = new Date().toISOString();
      if (v.validUntil && v.validUntil < now) return null;
      if (v.validFrom && v.validFrom > now) return null;
      return v;
    }
    if (cleanCode === 'SENZUWELCOME') {
      const welcome = await ensureSenzuWelcomeVoucherExists();
      if (welcome.enabled) return welcome;
    }
  } catch (err) {
    console.warn('Error finding voucher by code:', err);
  }
  return null;
}

export async function validatePromoCodeForBooking(
  paramsOrCode:
    | string
    | {
        promoCode: string;
        servicePrice: number;
        serviceId?: string;
        serviceCategory?: string;
        serviceCategoryId?: string;
        serviceDuration?: number;
        customerId?: string;
        customerAuthUid?: string;
        customerWhatsApp?: string;
        customerEmail?: string;
        homeServiceFee?: number;
        latitude?: number;
        longitude?: number;
        distanceKm?: number;
        customerVoucherId?: string;
        selectedCustomerVoucher?: { id?: string } | null;
        pointsToRedeem?: number;
        pointsRedeemed?: number;
        checkoutAttemptId?: string;
      },
  contextArg?: {
    servicePrice: number;
    serviceId?: string;
    serviceCategory?: string;
    serviceCategoryId?: string;
    serviceDuration?: number;
    customerId?: string;
    customerAuthUid?: string;
    customerWhatsApp?: string;
    customerEmail?: string;
    homeServiceFee?: number;
    latitude?: number;
    longitude?: number;
    distanceKm?: number;
    customerVoucherId?: string;
    selectedCustomerVoucher?: { id?: string } | null;
    pointsToRedeem?: number;
    pointsRedeemed?: number;
    checkoutAttemptId?: string;
  }
): Promise<PromoValidationResult> {
  const rawParams =
    typeof paramsOrCode === 'string'
      ? {
          ...(contextArg || { servicePrice: 0 }),
          promoCode: paramsOrCode,
        }
      : paramsOrCode;

  const params = {
    ...rawParams,
    customerVoucherId:
      rawParams?.customerVoucherId || rawParams?.selectedCustomerVoucher?.id,
    pointsToRedeem:
      rawParams?.pointsToRedeem ?? rawParams?.pointsRedeemed,
  };

  const code = typeof params?.promoCode === 'string' ? params.promoCode.trim().toUpperCase() : '';
  if (!code) {
    return { valid: false, errorMessage: 'Harap masukkan kode promo.' };
  }
  if (!/^[A-Z0-9_-]{1,64}$/.test(code)) {
    return { valid: false, errorMessage: 'Format kode promo tidak valid.' };
  }

  const currentUser = auth?.currentUser;
  const initialUid = typeof currentUser?.uid === 'string' ? currentUser.uid.trim() : '';
  if (!currentUser || !initialUid || typeof currentUser.getIdToken !== 'function') {
    return {
      valid: false,
      errorMessage: 'Silakan login ke akun pelanggan terlebih dahulu untuk menggunakan voucher promo.',
    };
  }

  if (
    params.customerAuthUid !== undefined &&
    params.customerAuthUid !== null &&
    String(params.customerAuthUid).trim() !== '' &&
    String(params.customerAuthUid).trim() !== initialUid
  ) {
    return {
      valid: false,
      errorMessage: 'Sesi login pelanggan tidak sesuai dengan identitas pemesanan.',
    };
  }

  let idToken = '';
  try {
    const rawToken = await currentUser.getIdToken();
    idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
  } catch {
    return {
      valid: false,
      errorMessage: 'Gagal mengambil token autentikasi pelanggan. Silakan login kembali.',
    };
  }

  if (!idToken) {
    return {
      valid: false,
      errorMessage: 'Token autentikasi pelanggan tidak tersedia. Silakan login kembali.',
    };
  }

  const activeUserAfterToken = auth?.currentUser;
  if (!activeUserAfterToken || activeUserAfterToken.uid !== initialUid) {
    return {
      valid: false,
      errorMessage: 'Sesi pengguna berubah sebelum validasi voucher dikirim.',
      ...({errorCode: 'SESSION_CHANGED', retryable: false} as any),
    };
  }

  let apiRes: Response;
  try {
    apiRes = await fetch('/api/vouchers/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        code,
        promoCode: code,
        serviceId: params.serviceId,
        servicePrice: params.servicePrice,
        serviceCategory: params.serviceCategory,
        serviceCategoryId: (params as any).serviceCategoryId,
        serviceDuration: params.serviceDuration,
        customerId: params.customerId,
        customerAuthUid: initialUid,
        customerWhatsApp: params.customerWhatsApp,
        customerEmail: params.customerEmail,
        homeServiceFee: params.homeServiceFee,
        latitude: params.latitude,
        longitude: params.longitude,
        distanceKm: params.distanceKm,
        customerVoucherId: params.customerVoucherId,
        pointsToRedeem: params.pointsToRedeem,
        checkoutAttemptId: params.checkoutAttemptId,
      }),
    });
  } catch {
    return {
      valid: false,
      errorMessage: 'Gagal menghubungi server validasi voucher. Silakan periksa koneksi Anda.',
      ...({ errorCode: 'NETWORK_ERROR', retryable: true } as any),
    };
  }

  let result: any = null;
  try {
    result = await apiRes.json();
  } catch {
    return {
      valid: false,
      errorMessage: 'Respons server validasi voucher tidak valid.',
      ...({ errorCode: 'MALFORMED_RESPONSE', status: apiRes?.status, retryable: true } as any),
    };
  }

  const activeUserAfterFetch = auth?.currentUser;
  if (!activeUserAfterFetch || activeUserAfterFetch.uid !== initialUid) {
    return {
      valid: false,
      errorMessage: 'Sesi pengguna berubah saat memvalidasi kode promo.',
      ...({errorCode: 'SESSION_CHANGED', retryable: false} as any),
    };
  }

  if (
    !apiRes.ok ||
    !result ||
    result.valid !== true ||
    !result.voucher ||
    typeof result.voucher.id !== 'string' ||
    !result.voucher.id.trim() ||
    typeof result.discountAmount !== 'number' ||
    !Number.isFinite(result.discountAmount) ||
    (result.discountAmount <= 0 && !(result.discountAmount === 0
      && result.pricingBreakdown?.promoDiscountAmount === 0
      && typeof result.pricingBreakdown?.voucherDiscountAmount === 'number'
      && result.pricingBreakdown.voucherDiscountAmount > 0))
  ) {
    const errCode =
      typeof result?.code === 'string' && result.code.trim()
        ? result.code.trim()
        : !apiRes.ok
          ? `HTTP_${apiRes.status}`
          : 'VOUCHER_INVALID';
    const isRetryable =
      apiRes.status === 503 ||
      errCode === 'VOUCHER_VALIDATION_UNAVAILABLE' ||
      errCode === 'AUTH_SERVICE_UNAVAILABLE';
    const errMsg =
      typeof result?.errorMessage === 'string' && result.errorMessage.trim()
        ? result.errorMessage.trim()
        : typeof result?.error === 'string' && result.error.trim()
          ? result.error.trim()
          : typeof result?.message === 'string' && result.message.trim()
            ? result.message.trim()
            : 'Kode promo tidak valid atau tidak dapat digunakan.';
    return {
      valid: false,
      errorMessage: errMsg,
      ...({ errorCode: errCode, status: apiRes.status, retryable: isRetryable } as any),
    };
  }

  return {
    valid: true,
    voucher: result.voucher as Voucher,
    discountAmount: result.discountAmount,
    ...(result.pricingBreakdown ? ({ pricingBreakdown: result.pricingBreakdown } as any) : {}),
  };
}

export async function recordVoucherRedemption(params: {
  voucherCode: string;
  voucherId?: string;
  bookingId: string;
  bookingCode?: string;
  customerId?: string;
  customerAuthUid?: string;
  customerPhone?: string;
  discountAmount?: number;
}): Promise<void> {
  const code = typeof params?.voucherCode === 'string' ? params.voucherCode.trim().toUpperCase() : '';
  const bookingId = typeof params?.bookingId === 'string' ? params.bookingId.trim() : '';
  if (!code || !bookingId) {
    throw Object.assign(new Error('Data voucher atau booking tidak lengkap.'), {
      code: 'INVALID_VOUCHER_REDEMPTION_INPUT',
    });
  }

  const currentUser = auth?.currentUser;
  const initialUid = typeof currentUser?.uid === 'string' ? currentUser.uid.trim() : '';
  if (!currentUser || !initialUid || typeof currentUser.getIdToken !== 'function') {
    throw Object.assign(new Error('Sesi login pelanggan diperlukan untuk menukarkan voucher.'), {
      code: 'AUTH_REQUIRED',
    });
  }

  if (
    params.customerAuthUid !== undefined &&
    params.customerAuthUid !== null &&
    String(params.customerAuthUid).trim() !== '' &&
    String(params.customerAuthUid).trim() !== initialUid
  ) {
    throw Object.assign(new Error('Sesi login tidak sesuai dengan identitas pemesanan.'), {
      code: 'SESSION_CHANGED',
    });
  }

  let idToken = '';
  try {
    const rawToken = await currentUser.getIdToken();
    idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
  } catch {
    throw Object.assign(new Error('Gagal mengambil token autentikasi pelanggan.'), {
      code: 'AUTH_TOKEN_UNAVAILABLE',
    });
  }

  if (!idToken) {
    throw Object.assign(new Error('Token autentikasi pelanggan tidak tersedia.'), {
      code: 'AUTH_TOKEN_UNAVAILABLE',
    });
  }

  const activeUserAfterToken = auth?.currentUser;
  if (!activeUserAfterToken || activeUserAfterToken.uid !== initialUid) {
    throw Object.assign(new Error('Sesi pengguna berubah sebelum permintaan penukaran dikirim.'), {
      code: 'SESSION_CHANGED',
    });
  }

  let res: Response;
  try {
    res = await fetch('/api/vouchers/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        voucherCode: code,
        bookingId,
      }),
    });
  } catch {
    throw Object.assign(new Error('Gagal menghubungi server penukaran voucher.'), {
      code: 'NETWORK_ERROR',
    });
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    throw Object.assign(new Error('Respons server penukaran voucher tidak valid.'), {
      code: 'MALFORMED_RESPONSE',
      status: res?.status,
    });
  }

  const activeUserAfterFetch = auth?.currentUser;
  if (!activeUserAfterFetch || activeUserAfterFetch.uid !== initialUid) {
    throw Object.assign(new Error('Sesi pengguna berubah saat memproses penukaran voucher.'), {
      code: 'SESSION_CHANGED',
    });
  }

  if (
    !res.ok ||
    !payload ||
    payload.success !== true ||
    typeof payload.redemptionId !== 'string' ||
    !payload.redemptionId.trim()
  ) {
    const errCode =
      typeof payload?.code === 'string' && payload.code
        ? payload.code
        : !res.ok
          ? `HTTP_${res.status}`
          : 'VOUCHER_REDEMPTION_FAILED';
    const errMsg =
      typeof payload?.error === 'string' && payload.error
        ? payload.error
        : typeof payload?.message === 'string' && payload.message
          ? payload.message
          : 'Penukaran voucher ditolak oleh server.';
    throw Object.assign(new Error(errMsg), {
      code: errCode,
      status: res.status,
    });
  }
}

export async function recordVoucherUsage(voucherId: string): Promise<void> {
  if (!voucherId) return;
  try {
    const ref = doc(db, 'vouchers', voucherId);
    await runTransaction(db, async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists()) return;
      const v = snap.data() as Voucher;
      const current = v.currentUsageCount || 0;
      t.update(ref, {
        currentUsageCount: current + 1,
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    console.warn('Error recording voucher usage:', err);
  }
}

export async function deleteVoucher(voucherId: string): Promise<void> {
  if (!voucherId) return;
  const ref = doc(db, 'vouchers', voucherId);
  await deleteDoc(ref);
}

export async function createVoucher(data: Omit<Voucher, 'id' | 'createdAt' | 'updatedAt'>): Promise<Voucher> {
  const id = `vch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const v: Voucher = {
    ...data,
    id,
    code: data.code ? data.code.trim().toUpperCase() : undefined,
    currentUsageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'vouchers', id), cleanFirestoreData(v));
  return v;
}

export async function updateVoucher(voucherId: string, updates: Partial<Voucher>): Promise<void> {
  const ref = doc(db, 'vouchers', voucherId);
  await updateDoc(ref, cleanFirestoreData({ ...updates, updatedAt: new Date().toISOString() }));
}

export async function getCustomerVouchers(customerId: string): Promise<CustomerVoucher[]> {
  try {
    const q = query(
      collection(db, 'customer_vouchers'),
      where('customerId', '==', customerId)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as CustomerVoucher);
    return list.sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());
  } catch (err) {
    console.warn('Error fetching customer vouchers:', err);
    return [];
  }
}

export async function issueVoucherToCustomer(params: {
  customerId: string;
  voucher: Voucher;
  source: CustomerVoucher['source'];
  issuedBy: string;
  issuedReason?: string;
  validityDays?: number;
}): Promise<CustomerVoucher> {
  const cvId = `cv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date();
  const expDate = new Date();
  expDate.setDate(expDate.getDate() + (params.validityDays || 30));

  const cv: CustomerVoucher = {
    id: cvId,
    voucherId: params.voucher.id,
    customerId: params.customerId,
    voucherCode: params.voucher.code,
    voucherName: params.voucher.name,
    voucherType: params.voucher.voucherType,
    value: params.voucher.value,
    maximumDiscount: params.voucher.maximumDiscount,
    minimumSpend: params.voucher.minimumSpend,
    applicableServiceIds: params.voucher.applicableServiceIds,
    applicableTierIds: params.voucher.applicableTierIds,
    source: params.source,
    status: 'available',
    assignedAt: now.toISOString(),
    expiredAt: expDate.toISOString(),
    issuedBy: params.issuedBy,
    issuedReason: params.issuedReason,
  };

  await setDoc(doc(db, 'customer_vouchers', cvId), cleanFirestoreData(cv));

  // Emit Notification
  emitEvent('voucher.issued', {
    customerId: params.customerId,
    customerVoucherId: cvId,
    voucherId: params.voucher.id,
    voucherCode: params.voucher.code,
    voucherName: params.voucher.name,
    discountValue: params.voucher.value,
    voucherType: params.voucher.voucherType,
    validUntil: expDate.toISOString(),
  }, { id: params.issuedBy, role: 'system' }).catch(() => {});

  return cv;
}

export async function markCustomerVoucherUsed(
  customerVoucherId: string,
  bookingId: string,
  bookingCode: string
): Promise<void> {
  const ref = doc(db, 'customer_vouchers', customerVoucherId);
  await updateDoc(ref, {
    status: 'used',
    usedAt: new Date().toISOString(),
    bookingId,
    bookingCode,
  });
}

// ----------------- REFERRAL PROGRAM -----------------

export async function validateReferralCode(
  code: string,
  currentCustomerId: string,
  currentPhone: string
): Promise<{ valid: boolean; message: string; referrerAccount?: CustomerLoyaltyAccount }> {
  if (!code || !code.trim()) {
    return { valid: false, message: 'Kode referral kosong.' };
  }

  const cleanCode = code.trim().toUpperCase();
  const accountsSnap = await getDocs(
    query(collection(db, 'loyalty_accounts'), where('referralCode', '==', cleanCode))
  );

  if (accountsSnap.empty) {
    return { valid: false, message: 'Kode referral tidak ditemukan.' };
  }

  const referrer = accountsSnap.docs[0].data() as CustomerLoyaltyAccount;

  // Self-referral prevention
  if (referrer.customerId === currentCustomerId) {
    return { valid: false, message: 'Anda tidak dapat menggunakan kode referral milik Anda sendiri.' };
  }

  const { cleanDigits: refPhone } = normalizeIndonesianPhone(referrer.customerPhone);
  const { cleanDigits: curPhone } = normalizeIndonesianPhone(currentPhone);
  if (refPhone && curPhone && refPhone === curPhone) {
    return { valid: false, message: 'Nomor telepon terdaftar sama dengan pemilik kode referral.' };
  }

  return { valid: true, message: `Kode valid! Diberikan oleh ${referrer.customerName}`, referrerAccount: referrer };
}

export async function checkAndQualifyReferral(
  booking: Booking,
  customerAccount: CustomerLoyaltyAccount
): Promise<void> {
  const referralCodeUsed = booking.referralCodeUsed || customerAccount.referredByCode;
  if (!referralCodeUsed) return;

  const settings = await getLoyaltySettings();
  if (!settings.referralEnabled) return;

  // Ensure this is the customer's first completed booking
  if (customerAccount.qualifiedBookings > 1) {
    return; // Only first completed booking qualifies referral
  }

  // Find referrer
  const q = query(
    collection(db, 'loyalty_accounts'),
    where('referralCode', '==', referralCodeUsed.toUpperCase().trim())
  );
  const snap = await getDocs(q);
  if (snap.empty) return;

  const referrer = snap.docs[0].data() as CustomerLoyaltyAccount;
  if (referrer.customerId === customerAccount.customerId) return;

  const referralId = `ref_${referrer.customerId}_${customerAccount.customerId}`;

  // Record or update referral entry
  const refRecord: ReferralRecord = {
    id: referralId,
    referrerCustomerId: referrer.customerId,
    referrerName: referrer.customerName,
    referrerPhone: referrer.customerPhone,
    referralCode: referralCodeUsed.toUpperCase().trim(),
    referredCustomerId: customerAccount.customerId,
    referredCustomerName: customerAccount.customerName,
    referredCustomerPhone: customerAccount.customerPhone,
    firstBookingId: booking.id,
    firstBookingCode: booking.bookingCode,
    status: 'rewarded',
    rewardStatus: 'issued',
    referrerRewardPoints: settings.referrerRewardPoints,
    qualifiedAt: new Date().toISOString(),
    createdAt: customerAccount.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await setDoc(doc(db, 'referrals', referralId), cleanFirestoreData(refRecord));

  // Reward referrer with bonus points
  if (settings.referrerRewardPoints > 0) {
    const { transaction: refTx } = await recordLoyaltyTransaction({
      customerId: referrer.customerId,
      customerName: referrer.customerName,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      transactionType: 'referral_bonus',
      pointsDelta: settings.referrerRewardPoints,
      referenceType: 'referral',
      referenceId: referralId,
      reason: `Bonus referral teman ${customerAccount.customerName} menyelesaikan booking pertamanya (${booking.bookingCode})`,
      createdBy: 'system',
    });

    // Increment referrer's referral count
    await updateDoc(doc(db, 'loyalty_accounts', referrer.customerId), {
      referralCount: (referrer.referralCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    });

    // Notify referrer
    emitEvent('referral.qualified', {
      customerId: referrer.customerId,
      referrerName: referrer.customerName,
      referredCustomerId: customerAccount.customerId,
      referredCustomerName: customerAccount.customerName,
      pointsReward: settings.referrerRewardPoints,
      referralId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      transactionId: refTx.id,
      loyaltyTransactionId: refTx.id,
    }, { id: 'system', role: 'system' }).catch(() => {});
  }
}

export async function getAllReferrals(): Promise<ReferralRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'referrals'));
    const list = snap.docs.map((d) => d.data() as ReferralRecord);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.warn('Error fetching referrals:', err);
    return [];
  }
}

// ----------------- BIRTHDAY REWARD -----------------

export async function checkAndIssueBirthdayReward(
  customerId: string,
  birthDate: string
): Promise<boolean> {
  const currentYear = new Date().getFullYear();
  const account = await getLoyaltyAccountByCustomerId(customerId);
  if (!account) return false;

  if (account.birthdayBenefitUsedYear === currentYear) {
    return false; // Already used this calendar year
  }

  const settings = await getLoyaltySettings();
  if (!settings.birthdayRewardEnabled || settings.birthdayRewardPoints <= 0) {
    return false;
  }

  // Parse birth month & day
  const [bYear, bMonth, bDay] = birthDate.split('-').map(Number);
  if (!bMonth || !bDay) return false;

  const today = new Date();
  const bThisYear = new Date(today.getFullYear(), bMonth - 1, bDay);
  const diffTime = Math.abs(today.getTime() - bThisYear.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Check validity window (default 30 days)
  if (diffDays <= settings.birthdayValidityDays) {
    const { transaction: bdayTx } = await recordLoyaltyTransaction({
      customerId,
      customerName: account.customerName,
      transactionType: 'birthday_bonus',
      pointsDelta: settings.birthdayRewardPoints,
      referenceType: 'birthday',
      referenceId: `${customerId}_${currentYear}`,
      reason: `Hadiah Ulang Tahun dari Senzu Home (${currentYear})`,
      createdBy: 'system',
    });

    await updateDoc(doc(db, 'loyalty_accounts', customerId), {
      birthdayBenefitUsedYear: currentYear,
      birthDate,
      updatedAt: new Date().toISOString(),
    });

    emitEvent('birthday.reward_issued', {
      customerId,
      customerName: account.customerName,
      pointsReward: settings.birthdayRewardPoints,
      year: currentYear,
      referenceId: `${customerId}_${currentYear}`,
      transactionId: bdayTx.id,
      loyaltyTransactionId: bdayTx.id,
    }, { id: 'system', role: 'system' }).catch(() => {});

    return true;
  }

  return false;
}

// ----------------- MANUAL ADJUSTMENTS (ADMIN ONLY) -----------------

export async function adminManualPointAdjustment(params: {
  customerId: string;
  pointsDelta: number; // positive to add, negative to deduct
  reason: string;
  adminName: string;
}): Promise<void> {
  if (params.pointsDelta === 0) return;
  if (!params.reason.trim()) {
    throw new Error('Alasan penyesuaian poin wajib diisi.');
  }

  const txType: LoyaltyTransactionType = params.pointsDelta > 0 ? 'manual_credit' : 'manual_debit';

  await recordLoyaltyTransaction({
    customerId: params.customerId,
    transactionType: txType,
    pointsDelta: params.pointsDelta,
    referenceType: 'admin_adjustment',
    referenceId: `adj_${Date.now()}`,
    reason: `Penyesuaian manual oleh ${params.adminName}: ${params.reason}`,
    createdBy: params.adminName,
  });
}

// ----------------- BACKFILL & SYNC -----------------

export async function backfillAndSyncAllLoyaltyAccounts(
  bookings: Booking[],
  customers: CustomerCRM[]
): Promise<{ totalAccountsSynced: number }> {
  let count = 0;
  for (const cust of customers) {
    try {
      const acc = await getOrCreateLoyaltyAccount({
        id: cust.id,
        name: cust.name,
        phone: cust.phone,
        whatsapp: cust.phone,
        email: cust.email,
      });

      // Recalculate completed bookings and spend from actual bookings
      const custBookings = bookings.filter(
        (b) => b.customerId === cust.id || b.customerWhatsApp === cust.phone
      );
      const completed = custBookings.filter(
        (b) => b.status === 'Completed' && isPaymentPaid(b.paymentStatus)
      );

      const totalSpend = completed.reduce((sum, b) => sum + (b.servicePrice || 0), 0);

      await updateDoc(doc(db, 'loyalty_accounts', cust.id), {
        qualifiedSpend: totalSpend,
        qualifiedBookings: completed.length,
        updatedAt: new Date().toISOString(),
      });

      count++;
    } catch (err) {
      console.warn(`Error backfilling loyalty account for ${cust.id}:`, err);
    }
  }

  return { totalAccountsSynced: count };
}
