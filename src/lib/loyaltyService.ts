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
import { db } from './firebase';
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

  const { cleanDigits } = normalizeIndonesianPhone(customer.phone || customer.whatsapp || '');
  const memberNumber = generateMemberNumber(cleanDigits || customer.id.replace(/[^0-9]/g, ''));
  const referralCode = generateReferralCode(customer.name, cleanDigits);
  const now = new Date().toISOString();

  const newAccount: CustomerLoyaltyAccount = {
    id: customer.id,
    customerId: customer.id,
    memberNumber,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerWhatsApp: customer.whatsapp || customer.phone,
    customerEmail: customer.email,
    birthDate: customer.birthDate,

    pointsBalance: 0,
    lifetimePointsEarned: 0,
    lifetimePointsRedeemed: 0,
    lifetimePointsExpired: 0,

    currentTierId: 'member',
    currentTierName: 'Member',
    tierStartedAt: now,
    tierExpiresAt: null,

    qualifiedSpend: 0,
    qualifiedBookings: 0,

    referralCode,
    referralCount: 0,

    birthdayBenefitUsedYear: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'loyalty_accounts', customer.id), cleanFirestoreData(newAccount));
  return newAccount;
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
      newTierName: eligibleTier.name,
      previousTierName: currentTier.name,
      earningMultiplier: eligibleTier.earningMultiplier,
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

  const settings = await getLoyaltySettings();
  if (!settings.loyaltyEnabled) {
    return null;
  }

  // Idempotency check: Look for existing 'earn' transaction for this booking
  const existingTxQuery = query(
    collection(db, 'loyalty_transactions'),
    where('bookingId', '==', booking.id),
    where('transactionType', '==', 'earn')
  );
  const existingTxSnap = await getDocs(existingTxQuery);
  if (!existingTxSnap.empty) {
    return null; // Already processed, strictly prevent double earning
  }

  // Get or initialize customer loyalty account
  const account = await getOrCreateLoyaltyAccount({
    id: booking.customerId || `cust_${booking.customerWhatsApp.replace(/[^0-9]/g, '')}`,
    name: booking.customerName,
    phone: booking.customerWhatsApp,
    whatsapp: booking.customerWhatsApp,
    email: booking.customerEmail,
  });

  const tiers = await getMembershipTiers();
  const currentTier = tiers.find((t) => t.id === account.currentTierId) || tiers[0];
  const tierMultiplier = currentTier?.earningMultiplier || 1.0;

  // Calculate Net Qualified Spend
  const includeFee = settings.includeHomeServiceFeeForPoints ?? false;
  const discounts = (booking.voucherDiscount || 0) + (booking.pointsDiscount || 0) + (booking.promoDiscount || 0) + (booking.discountAmount || 0);
  let netSpend = Math.max(0, booking.servicePrice - discounts);
  if (includeFee) {
    netSpend += (booking.homeServiceFee || 0);
  }

  const spendPerPoint = settings.spendPerPoint || 10000;
  const basePoints = Math.floor(netSpend / spendPerPoint);
  const finalPoints = Math.floor(basePoints * tierMultiplier);

  if (finalPoints <= 0) {
    return null;
  }

  // Calculate Expiry Date
  let expiresAt: string | null = null;
  if (settings.pointsExpireEnabled && settings.pointsValidityDays > 0) {
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + settings.pointsValidityDays);
    expiresAt = expDate.toISOString();
  }

  // Record ledger transaction
  await recordLoyaltyTransaction({
    customerId: account.customerId,
    customerName: account.customerName,
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    transactionType: 'earn',
    pointsDelta: finalPoints,
    referenceType: 'booking',
    referenceId: booking.id,
    reason: `Poin treatment selesai ${booking.serviceName} (${booking.bookingCode})`,
    createdBy: 'system',
    expiresAt,
    metadata: {
      basePoints,
      tierMultiplier,
      finalPoints,
      netSpend,
      serviceName: booking.serviceName,
    },
  });

  // Update cumulative qualified stats
  const newSpend = (account.qualifiedSpend || 0) + netSpend;
  const newBookings = (account.qualifiedBookings || 0) + 1;
  const updatedAccount: CustomerLoyaltyAccount = {
    ...account,
    qualifiedSpend: newSpend,
    qualifiedBookings: newBookings,
    pointsBalance: account.pointsBalance + finalPoints,
  };

  await updateDoc(doc(db, 'loyalty_accounts', account.customerId), {
    qualifiedSpend: newSpend,
    qualifiedBookings: newBookings,
    updatedAt: new Date().toISOString(),
  });

  // Re-check Tier Upgrade
  await evaluateAndUpgradeCustomerTier(account.customerId, updatedAccount, tiers);

  // Check if this booking qualifies an existing referral
  await checkAndQualifyReferral(booking, account);

  // Emit Notification
  emitEvent('loyalty.points_earned', {
    customerId: account.customerId,
    customerName: account.customerName,
    customerWhatsApp: account.customerWhatsApp,
    bookingCode: booking.bookingCode,
    pointsEarned: finalPoints,
    newBalance: account.pointsBalance + finalPoints,
    serviceName: booking.serviceName,
  }, { id: 'system', role: 'system' }).catch(() => {});

  return { pointsEarned: finalPoints, reason: 'Earned' };
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

  await recordLoyaltyTransaction({
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
    bookingCode: params.bookingCode,
    pointsRedeemed: params.points,
    discountAmount: params.discountRp,
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

export async function validatePromoCodeForBooking(params: {
  promoCode: string;
  servicePrice: number;
  serviceId?: string;
  serviceCategory?: string;
  serviceDuration?: number;
  customerId?: string;
  customerAuthUid?: string;
  customerWhatsApp?: string;
  customerEmail?: string;
  homeServiceFee?: number;
}): Promise<PromoValidationResult> {
  const code = (params.promoCode || '').trim().toUpperCase();
  if (!code) {
    return { valid: false, errorMessage: 'Harap masukkan kode promo.' };
  }

  // 1. Authoritative Backend Validation First
  try {
    const apiRes = await fetch('/api/vouchers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promoCode: code,
        servicePrice: params.servicePrice,
        serviceId: params.serviceId,
        serviceCategory: params.serviceCategory,
        serviceDuration: params.serviceDuration,
        customerId: params.customerId,
        customerAuthUid: params.customerAuthUid,
        customerWhatsApp: params.customerWhatsApp,
        customerEmail: params.customerEmail,
        homeServiceFee: params.homeServiceFee,
      }),
    });
    if (apiRes.ok) {
      const result = await apiRes.json();
      return result;
    }
  } catch (apiErr) {
    console.warn('API voucher validation notice, falling back to direct Firestore ledger:', apiErr);
  }

  // 2. Resilient Client-Side Check against Firestore Master Catalog & Redemption Ledger
  let voucher: Voucher | null = null;
  try {
    const q = query(collection(db, 'vouchers'), where('code', '==', code));
    const snap = await getDocs(q);
    if (!snap.empty) {
      voucher = snap.docs[0].data() as Voucher;
    } else if (code === 'SENZUWELCOME') {
      voucher = await ensureSenzuWelcomeVoucherExists();
    }
  } catch (err) {
    console.warn('Error fetching promo by code:', err);
  }

  if (!voucher) {
    return { valid: false, errorMessage: 'Kode promo tidak ditemukan.' };
  }

  if (voucher.enabled === false) {
    return { valid: false, errorMessage: 'Voucher sedang tidak aktif.' };
  }

  const now = new Date().toISOString();
  if (voucher.validFrom && voucher.validFrom > now) {
    return { valid: false, errorMessage: 'Promo ini belum dapat digunakan (periode belum dimulai).' };
  }
  if (voucher.validUntil && voucher.validUntil < now) {
    return { valid: false, errorMessage: 'Voucher sudah tidak berlaku.' };
  }

  if (voucher.usageLimitTotal && voucher.usageLimitTotal > 0) {
    if ((voucher.currentUsageCount || 0) >= voucher.usageLimitTotal) {
      return { valid: false, errorMessage: 'Kuota promo sudah habis.' };
    }
  }

  const minSpend = voucher.minimumSpend || voucher.minimumTreatmentPrice || 0;
  if (params.servicePrice < minSpend) {
    return {
      valid: false,
      errorMessage: `Minimum transaksi untuk promo ini adalah Rp ${minSpend.toLocaleString('id-ID')}.`,
    };
  }

  if (voucher.applicableServiceIds && voucher.applicableServiceIds.length > 0) {
    if (params.serviceId && !voucher.applicableServiceIds.includes(params.serviceId)) {
      return { valid: false, errorMessage: 'Promo tidak berlaku untuk layanan yang dipilih.' };
    }
  }

  if (voucher.applicableCategoryIds && voucher.applicableCategoryIds.length > 0) {
    if (params.serviceCategory && !voucher.applicableCategoryIds.includes(params.serviceCategory)) {
      return { valid: false, errorMessage: 'Promo tidak berlaku untuk kategori layanan ini.' };
    }
  }

  if (voucher.minimumTreatmentDuration && params.serviceDuration && params.serviceDuration < voucher.minimumTreatmentDuration) {
    return {
      valid: false,
      errorMessage: `Promo memerlukan durasi treatment minimal ${voucher.minimumTreatmentDuration} menit.`,
    };
  }

  const { cleanDigits: phoneClean } = normalizeIndonesianPhone(params.customerWhatsApp || '');
  const custId = params.customerId || (phoneClean ? `cust_${phoneClean}` : '');
  const authUid = params.customerAuthUid || '';

  // 3. Authoritative Usage Limit Per Customer check
  const usageLimitPerCust = voucher.usageLimitPerCustomer ?? (code === 'SENZUWELCOME' ? 1 : 0);
  if (usageLimitPerCust > 0) {
    try {
      // A. Check deterministic lock documents
      let lockFound = false;
      if (authUid) {
        const lockSnap = await getDoc(doc(db, 'voucher_redemptions', `vlock_${code}_uid_${authUid}`));
        if (lockSnap.exists() && lockSnap.data()?.status !== 'cancelled' && lockSnap.data()?.status !== 'batal') {
          lockFound = true;
        }
      }
      if (!lockFound && phoneClean) {
        const lockSnap = await getDoc(doc(db, 'voucher_redemptions', `vlock_${code}_phone_${phoneClean}`));
        if (lockSnap.exists() && lockSnap.data()?.status !== 'cancelled' && lockSnap.data()?.status !== 'batal') {
          lockFound = true;
        }
      }
      if (!lockFound && custId) {
        const lockSnap = await getDoc(doc(db, 'voucher_redemptions', `vlock_${code}_cust_${custId}`));
        if (lockSnap.exists() && lockSnap.data()?.status !== 'cancelled' && lockSnap.data()?.status !== 'batal') {
          lockFound = true;
        }
      }

      if (lockFound) {
        return {
          valid: false,
          errorMessage: `Voucher ${voucher.code || code} sudah pernah digunakan pada akun ini.`,
        };
      }

      // B. Check voucher_redemptions ledger
      const redSnap = await getDocs(query(collection(db, 'voucher_redemptions'), where('voucherCode', '==', code)));
      let redCount = 0;
      for (const d of redSnap.docs) {
        const r = d.data() as any;
        if (r.status === 'cancelled' || r.status === 'batal') continue;
        let matched = false;
        if (authUid && r.customerAuthUid === authUid) matched = true;
        if (phoneClean) {
          const rPhoneClean = (r.customerPhone || '').replace(/[^0-9]/g, '');
          const rNormClean = (r.normalizedPhone || '').replace(/[^0-9]/g, '');
          if (rPhoneClean && (rPhoneClean.includes(phoneClean) || phoneClean.includes(rPhoneClean))) matched = true;
          if (rNormClean && (rNormClean.includes(phoneClean) || phoneClean.includes(rNormClean))) matched = true;
        }
        if (custId && r.customerId === custId) matched = true;
        if (matched) redCount++;
      }

      if (redCount >= usageLimitPerCust) {
        return {
          valid: false,
          errorMessage: `Voucher ${voucher.code || code} sudah pernah digunakan pada akun ini.`,
        };
      }

      // C. Check bookings collection directly
      const bookingsSnap = await getDocs(collection(db, 'bookings'));
      let bookingsUsed = 0;
      for (const bDoc of bookingsSnap.docs) {
        const b = bDoc.data() as Booking;
        const bCode = (b.promoCode || b.voucherCode || '').trim().toUpperCase();
        if (bCode !== code && b.voucherId !== voucher.id && b.promoId !== voucher.id) continue;
        const bStatus = (b.status || '').toLowerCase();
        if (bStatus === 'cancelled' || bStatus === 'batal') continue;

        let matched = false;
        if (authUid && b.authUserId === authUid) matched = true;
        if (phoneClean) {
          const bPhoneClean = (b.customerWhatsApp || '').replace(/[^0-9]/g, '');
          if (bPhoneClean && (bPhoneClean.includes(phoneClean) || phoneClean.includes(bPhoneClean))) matched = true;
        }
        if (custId && b.customerId === custId) matched = true;
        if (matched) bookingsUsed++;
      }

      if (bookingsUsed >= usageLimitPerCust) {
        return {
          valid: false,
          errorMessage: `Voucher ${voucher.code || code} sudah pernah digunakan pada akun ini.`,
        };
      }
    } catch (e) {
      console.warn('Could not check usage history for promo validation:', e);
    }
  }

  // 4. First Order Only / New Customer check
  if (voucher.firstOrderOnly || voucher.newCustomerOnly) {
    try {
      const bookingsSnap = await getDocs(collection(db, 'bookings'));
      let hasPreviousBookings = false;
      for (const bDoc of bookingsSnap.docs) {
        const b = bDoc.data() as Booking;
        const s = (b.status || '').toLowerCase();
        if (s === 'cancelled' || s === 'batal' || s === 'menunggu pembayaran') continue;

        let matched = false;
        if (authUid && b.authUserId === authUid) matched = true;
        if (phoneClean) {
          const bPhoneClean = (b.customerWhatsApp || '').replace(/[^0-9]/g, '');
          if (bPhoneClean && (bPhoneClean.includes(phoneClean) || phoneClean.includes(bPhoneClean))) matched = true;
        }
        if (custId && b.customerId === custId) matched = true;
        if (matched) {
          hasPreviousBookings = true;
          break;
        }
      }

      if (!hasPreviousBookings && custId) {
        const custDoc = await getDoc(doc(db, 'customers', custId));
        if (custDoc.exists()) {
          const cData = custDoc.data() as any;
          if ((cData.completedBookings || 0) > 0 || (cData.totalBookings || 0) > 0) {
            hasPreviousBookings = true;
          }
        }
      }

      if (hasPreviousBookings) {
        return {
          valid: false,
          errorMessage: 'Voucher ini khusus untuk pesanan pertama.',
        };
      }
    } catch (e) {
      console.warn('Could not check first order history:', e);
    }
  }

  // 5. Compute Discount
  let discountAmount = 0;
  if (voucher.voucherType === 'fixed_discount' || (voucher.voucherType as any) === 'FIXED_AMOUNT') {
    discountAmount = Math.min(voucher.value, params.servicePrice);
  } else if (
    voucher.voucherType === 'percentage_discount' ||
    voucher.voucherType === 'percentage' ||
    (voucher.voucherType as any) === 'PERCENTAGE'
  ) {
    let disc = Math.floor((params.servicePrice * voucher.value) / 100);
    if (voucher.maximumDiscount && voucher.maximumDiscount > 0) {
      disc = Math.min(disc, voucher.maximumDiscount);
    }
    discountAmount = Math.min(disc, params.servicePrice);
  } else if (voucher.voucherType === 'free_home_service_fee') {
    discountAmount = params.homeServiceFee || 0;
  }

  return {
    valid: true,
    voucher,
    discountAmount,
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
  const code = (params.voucherCode || '').trim().toUpperCase();
  if (!code || !params.bookingId) return;

  // 1. Try server endpoint first
  try {
    const res = await fetch('/api/vouchers/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) return;
  } catch (err) {
    console.warn('API voucher redeem notice, fallback to direct Firestore:', err);
  }

  // 2. Direct Firestore fallback
  try {
    const { cleanDigits } = normalizeIndonesianPhone(params.customerPhone || '');
    const authUid = (params.customerAuthUid || '').trim();
    const custId = (params.customerId || '').trim() || (cleanDigits ? `cust_${cleanDigits}` : '');
    const targetVoucherId = params.voucherId || (code === 'SENZUWELCOME' ? 'vch_senzuwelcome' : `vch_${code.toLowerCase()}`);
    const now = new Date().toISOString();
    const redDocId = `vred_${code}_${params.bookingId}`;

    await setDoc(
      doc(db, 'voucher_redemptions', redDocId),
      cleanFirestoreData({
        id: redDocId,
        voucherId: targetVoucherId,
        voucherCode: code,
        customerId: custId,
        customerAuthUid: authUid || null,
        customerPhone: params.customerPhone || null,
        normalizedPhone: cleanDigits ? `+${cleanDigits}` : null,
        bookingId: params.bookingId,
        bookingCode: params.bookingCode || '',
        discountAmount: params.discountAmount || 0,
        redeemedAt: now,
        status: 'active',
        source: 'client_submission',
        updatedAt: now,
      }),
      { merge: true }
    );

    if (authUid) {
      await setDoc(
        doc(db, 'voucher_redemptions', `vlock_${code}_uid_${authUid}`),
        cleanFirestoreData({
          voucherCode: code,
          voucherId: targetVoucherId,
          customerAuthUid: authUid,
          bookingId: params.bookingId,
          bookingCode: params.bookingCode || '',
          redeemedAt: now,
          status: 'active',
        }),
        { merge: true }
      );
    }
    if (cleanDigits) {
      await setDoc(
        doc(db, 'voucher_redemptions', `vlock_${code}_phone_${cleanDigits}`),
        cleanFirestoreData({
          voucherCode: code,
          voucherId: targetVoucherId,
          customerPhone: cleanDigits,
          bookingId: params.bookingId,
          bookingCode: params.bookingCode || '',
          redeemedAt: now,
          status: 'active',
        }),
        { merge: true }
      );
    }
    if (custId) {
      await setDoc(
        doc(db, 'voucher_redemptions', `vlock_${code}_cust_${custId}`),
        cleanFirestoreData({
          voucherCode: code,
          voucherId: targetVoucherId,
          customerId: custId,
          bookingId: params.bookingId,
          bookingCode: params.bookingCode || '',
          redeemedAt: now,
          status: 'active',
        }),
        { merge: true }
      );
    }

    if (targetVoucherId) {
      await recordVoucherUsage(targetVoucherId);
    }
  } catch (err) {
    console.warn('Error recording voucher redemption in client:', err);
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
    await recordLoyaltyTransaction({
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
      referredCustomerName: customerAccount.customerName,
      pointsReward: settings.referrerRewardPoints,
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
    await recordLoyaltyTransaction({
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
