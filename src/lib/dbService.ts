import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  or,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  Booking,
  BookingStatus,
  BookingStatusHistory,
  OperationalAuditLog,
  CustomerCRM,
  PaymentStatus,
  ServiceItem,
  AppSettings,
  Therapist,
  TherapistLocation,
  ServiceRadiusTier,
} from '../types';
import { formatDateTimeWIB, generateBookingCode, cleanFirestoreData } from './utils';
import {
  createPaymentRecord,
  getPaymentRecordByBookingId,
  cssVerifyPaymentTransaction,
  isPaymentPaid,
} from './paymentService';
import {
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_BRANCH_PALEMBANG,
  DEFAULT_BUSINESS_SETTINGS,
} from './masterDataService';
import { emitEvent } from './notificationService';
import {
  findCustomerByPhoneOrEmail,
  upsertCustomerFromBooking,
  normalizeIndonesianPhone,
} from './crmService';
import {
  processBookingLoyaltyEarning,
  redeemPointsForBooking,
  refundLoyaltyPointsForCancelledBooking,
  markCustomerVoucherUsed,
  recordVoucherUsage,
  recordVoucherRedemption,
} from './loyaltyService';
import {
  calculateHomeServiceFee,
  SENZU_BASE_LOCATION,
  formatDistanceDisplay,
  fetchDrivingRouteDistanceAndFee,
  type HomeServiceFeeCalculation,
} from './distanceFeeService';

export {
  calculateHomeServiceFee,
  SENZU_BASE_LOCATION,
  formatDistanceDisplay,
  fetchDrivingRouteDistanceAndFee,
  type HomeServiceFeeCalculation,
};

export const DEFAULT_RADIUS_TIERS: ServiceRadiusTier[] = [
  { id: 'tier-1', minKm: 0, maxKm: 10, fee: 0, label: '<= 10 KM (Gratis)' },
  { id: 'tier-2', minKm: 10, maxKm: 15, fee: 30000, label: '>10 – 15 KM' },
  { id: 'tier-3', minKm: 15, maxKm: 20, fee: 60000, label: '>15 – 20 KM' },
  { id: 'tier-4', minKm: 20, maxKm: null, fee: 75000, label: '> 20 KM' },
];

/**
 * Calculates distance in KM between two coordinates using the Haversine formula
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // 1 decimal place
}

/**
 * Calculates distance in meters between two coordinates
 */
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return Math.round(calculateDistanceKm(lat1, lon1, lat2, lon2) * 1000);
}

export const DEFAULT_SERVICES: ServiceItem[] = [
  {
    id: 'srv-sig-60',
    name: 'Senzu Home Signature 60 Menit',
    duration: 60,
    price: 225000,
    description: 'Kombinasi reflexology titik saraf kaki, relaksasi punggung, leher, dan bahu dengan minyak aromaterapi premium.',
    isPopular: false,
    isActive: true,
  },
  {
    id: 'srv-sig-90',
    name: 'Senzu Home Signature 90 Menit',
    duration: 90,
    price: 325000,
    description: 'Pilihan terfavorit keluarga Palembang. Full body reflexology & massage menyeluruh dari ujung kaki hingga kepala untuk melepas lelah.',
    isPopular: true,
    isActive: true,
  },
  {
    id: 'srv-sig-120',
    name: 'Senzu Home Signature 120 Menit',
    duration: 120,
    price: 425000,
    description: 'Perawatan holistik mendalam: Foot reflexology intensif, akupresur, deep tissue massage & hot stone sensation untuk pemulihan optimal.',
    isPopular: false,
    isActive: true,
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'general',
  homeServiceFee: 50000,
  baseLocationName: 'Senzu Reflexology Palembang (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan)',
  baseLatitude: -2.9859024,
  baseLongitude: 104.7385997,
  radiusTiers: DEFAULT_RADIUS_TIERS,
  bankName: 'BCA (Bank Central Asia)',
  bankAccount: '021-8899-721',
  bankHolder: 'PT KSBONE UNTUK KITA',
  qrisInstruction: 'Scan QRIS Senzu Home melalui BCA Mobile, Livin, GoPay, OVO, ShopeePay, atau DANA.',
  contactWhatsApp: '+6289654623347',
};

export const DEFAULT_THERAPISTS: Therapist[] = [
  {
    id: 'th-rina',
    staffId: 'staff-th-rina',
    employeeCode: 'TRP001',
    name: 'Rina Anggraini',
    displayName: 'Rina A.',
    gender: 'Perempuan',
    phone: '+6281273445501',
    email: 'rina@senzuhome.com',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    serviceIds: ['srv-sig-60', 'srv-sig-90', 'srv-sig-120'],
    specialties: ['Signature Reflexology', 'Deep Tissue', 'Aromatherapy'],
    rating: 4.95,
    totalCompleted: 142,
    status: 'available',
    isActive: true,
    customerDisplayEnabled: true,
  },
  {
    id: 'th-siti',
    staffId: 'staff-th-siti',
    employeeCode: 'TRP002',
    name: 'Siti Rahma',
    displayName: 'Siti R.',
    gender: 'Perempuan',
    phone: '+6281273445502',
    email: 'siti@senzuhome.com',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    serviceIds: ['srv-fam-90', 'srv-fam-120', 'srv-totok-45'],
    specialties: ['Reflexology Keluarga', 'Tradisional Massage', 'Hot Stone'],
    rating: 4.9,
    totalCompleted: 98,
    status: 'available',
    isActive: true,
    customerDisplayEnabled: true,
  },
  {
    id: 'th-budi',
    staffId: 'staff-th-budi',
    employeeCode: 'TRP003',
    name: 'Budi Santoso',
    displayName: 'Budi S.',
    gender: 'Laki-laki',
    phone: '+6281273445503',
    email: 'budi@senzuhome.com',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    serviceIds: ['srv-sport-90', 'srv-sig-90', 'srv-totok-45'],
    specialties: ['Sport Massage', 'Acupressure', 'Totok Wajah'],
    rating: 4.88,
    totalCompleted: 115,
    status: 'available',
    isActive: true,
    customerDisplayEnabled: true,
  },
  {
    id: 'th-fauzi',
    staffId: 'staff-th-fauzi',
    employeeCode: 'TRP004',
    name: 'Ahmad Fauzi',
    displayName: 'Fauzi',
    gender: 'Laki-laki',
    phone: '+6281273445504',
    email: 'fauzi@senzuhome.com',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    serviceIds: ['srv-sig-60', 'srv-fam-90', 'srv-dry-60'],
    specialties: ['Tradisional Palembang', 'Reflexology Kaki', 'Relaksasi'],
    rating: 4.85,
    totalCompleted: 76,
    status: 'available',
    isActive: true,
    customerDisplayEnabled: true,
  },
];

let hasInitializedSeed = false;

/**
 * Initialize base seed data if collections are empty
 */
export async function initializeSeedData(): Promise<void> {
  if (hasInitializedSeed) return;
  try {
    if (
      typeof window !== 'undefined' &&
      (localStorage.getItem('senzu_seed_initialized') || sessionStorage.getItem('senzu_seed_initialized'))
    ) {
      hasInitializedSeed = true;
      return;
    }
    // 1. Settings (General)
    const settingsRef = doc(db, 'settings', 'general');
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      await setDoc(settingsRef, DEFAULT_SETTINGS);
    } else {
      const data = settingsSnap.data();
      // Ensure production configuration stores the official Senzu WhatsApp number
      if (
        !data.contactWhatsApp ||
        data.contactWhatsApp === '081271239876' ||
        data.contactWhatsApp.includes('1239876') ||
        data.contactWhatsApp.startsWith('0') ||
        !data.contactWhatsApp.startsWith('+62')
      ) {
        await updateDoc(settingsRef, {
          contactWhatsApp: '+6289654623347',
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // 1b. Centralized Company Settings
    try {
      const companyRef = doc(db, 'settings', 'company');
      const companySnap = await getDoc(companyRef);
      if (!companySnap.exists()) {
        await setDoc(companyRef, DEFAULT_COMPANY_SETTINGS);
      } else {
        const cData = companySnap.data();
        if (!cData.customerServiceWhatsApp || cData.customerServiceWhatsApp.includes('1239876')) {
          await updateDoc(companyRef, {
            customerServiceWhatsApp: '+6289654623347',
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err: any) {
      if (err?.code !== 'resource-exhausted') {
        console.warn('Company settings seed check:', err);
      }
    }

    // 1c. Centralized Business Settings
    try {
      const businessRef = doc(db, 'settings', 'business');
      const businessSnap = await getDoc(businessRef);
      if (!businessSnap.exists()) {
        await setDoc(businessRef, DEFAULT_BUSINESS_SETTINGS);
      } else {
        const bData = businessSnap.data();
        if (!bData.customerSupportWhatsApp || bData.customerSupportWhatsApp.includes('1239876')) {
          await updateDoc(businessRef, {
            customerSupportWhatsApp: '+6289654623347',
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err: any) {
      if (err?.code !== 'resource-exhausted') {
        console.warn('Business settings seed check:', err);
      }
    }

    // 1d. Centralized Default Branch (Palembang)
    try {
      const branchRef = doc(db, 'branches', DEFAULT_BRANCH_PALEMBANG.id);
      const branchSnap = await getDoc(branchRef);
      if (!branchSnap.exists()) {
        await setDoc(branchRef, DEFAULT_BRANCH_PALEMBANG);
      } else {
        const brData = branchSnap.data();
        if (!brData.customerServiceWhatsApp || brData.customerServiceWhatsApp.includes('1239876')) {
          await updateDoc(branchRef, {
            customerServiceWhatsApp: '+6289654623347',
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err: any) {
      if (err?.code !== 'resource-exhausted') {
        console.warn('Branch settings seed check:', err);
      }
    }

    // 2. Therapists
    try {
      const thSnap = await getDocs(collection(db, 'therapists'));
      if (thSnap.empty) {
        for (const th of DEFAULT_THERAPISTS) {
          await setDoc(doc(db, 'therapists', th.id), th);
        }
      }
    } catch (err: any) {
      if (err?.code !== 'resource-exhausted') {
        console.warn('Therapists seed check:', err);
      }
    }

    hasInitializedSeed = true;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('senzu_seed_initialized', '1');
        sessionStorage.setItem('senzu_seed_initialized', '1');
      } catch {}
    }
  } catch (err: any) {
    hasInitializedSeed = true;
    if (err?.code !== 'resource-exhausted') {
      console.warn('Seed initialization notice:', err);
    }
  }
}

// ----------------- SERVICES & SETTINGS -----------------

export async function getServices(): Promise<ServiceItem[]> {
  try {
    const snap = await getDocs(collection(db, 'services'));
    if (!snap.empty) {
      const list = snap.docs.map((d) => d.data() as ServiceItem);
      list.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('senzu_cached_services', JSON.stringify(list));
        } catch {}
      }
      return list;
    }
  } catch (err: any) {
    // If quota exceeded or offline, recover from local storage or defaults
    if (err?.code !== 'resource-exhausted') {
      console.warn('Get services notice:', err?.message || err);
    }
  }

  // Fallback to local cache if available
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('senzu_cached_services');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
  }

  return DEFAULT_SERVICES;
}

export async function saveService(service: ServiceItem): Promise<void> {
  await setDoc(doc(db, 'services', service.id), service, { merge: true });
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'general'));
    if (snap.exists()) {
      const data = snap.data() as AppSettings;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('senzu_cached_settings', JSON.stringify(data));
        } catch {}
      }
      return data;
    }
  } catch (err: any) {
    if (err?.code !== 'resource-exhausted') {
      console.warn('Get settings notice:', err?.message || err);
    }
  }

  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('senzu_cached_settings');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
  }

  return DEFAULT_SETTINGS;
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<void> {
  const ref = doc(db, 'settings', 'general');
  await setDoc(ref, { ...settings, updatedAt: new Date().toISOString() }, { merge: true });
}

// ----------------- THERAPISTS -----------------

export async function getTherapists(): Promise<Therapist[]> {
  try {
    const snap = await getDocs(collection(db, 'therapists'));
    if (!snap.empty) {
      const list = snap.docs.map((d) => d.data() as Therapist);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('senzu_cached_therapists', JSON.stringify(list));
        } catch {}
      }
      return list;
    }
  } catch (err: any) {
    if (err?.code !== 'resource-exhausted') {
      console.warn('Get therapists notice:', err?.message || err);
    }
  }

  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('senzu_cached_therapists');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
  }

  return DEFAULT_THERAPISTS;
}

export async function saveTherapist(therapist: Therapist): Promise<void> {
  await setDoc(doc(db, 'therapists', therapist.id), therapist, { merge: true });
}

// ----------------- CRM CUSTOMER -----------------

export async function getCustomerByWhatsApp(whatsapp: string): Promise<CustomerCRM | null> {
  return await findCustomerByPhoneOrEmail(whatsapp);
}

export async function getAllCustomers(): Promise<CustomerCRM[]> {
  try {
    const snap = await getDocs(collection(db, 'customers'));
    const list = snap.docs.map((d) => d.data() as CustomerCRM);
    list.sort((a, b) => {
      const timeB = new Date(b.lastBookingAt || b.createdAt || 0).getTime();
      const timeA = new Date(a.lastBookingAt || a.createdAt || 0).getTime();
      return timeB - timeA;
    });
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('senzu_cached_customers', JSON.stringify(list));
      } catch {}
    }
    return list;
  } catch (err: any) {
    if (err?.code !== 'resource-exhausted') {
      console.warn('Get customers notice:', err?.message || err);
    }
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('senzu_cached_customers');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  }
}

export async function upsertCustomerCRM(booking: Booking): Promise<void> {
  try {
    await upsertCustomerFromBooking(booking);
  } catch (err) {
    console.warn('Customer CRM upsert notice:', err);
  }
}

// ----------------- BOOKING STATUS HISTORY -----------------

export async function addBookingStatusHistory(
  bookingId: string,
  bookingCode: string,
  status: BookingStatus,
  updatedByRole: BookingStatusHistory['updatedByRole'],
  updatedByName: string,
  note?: string
): Promise<void> {
  // Prevent duplicate status history entries
  try {
    const q = query(
      collection(db, 'booking_status_history'),
      where('bookingCode', '==', bookingCode)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const existing = snap.docs.map((d) => d.data() as BookingStatusHistory);
      existing.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const last = existing[existing.length - 1];
      if (last && last.status === status) {
        // Status already logged as the latest state
        return;
      }
    }
  } catch (err) {
    console.warn('Duplicate check warning:', err);
  }

  const now = new Date();
  const historyId = `hist_${bookingCode}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const historyEntry: BookingStatusHistory = {
    id: historyId,
    bookingId,
    bookingCode,
    status,
    note,
    updatedByRole,
    updatedByName,
    timestamp: now.toISOString(),
    formattedWIB: formatDateTimeWIB(now),
  };
  try {
    await setDoc(doc(db, 'booking_status_history', historyId), cleanFirestoreData(historyEntry));
  } catch (historyErr) {
    console.warn('Booking status history write notice:', historyErr);
  }
}

export async function getBookingStatusHistory(bookingCode: string): Promise<BookingStatusHistory[]> {
  try {
    const q = query(
      collection(db, 'booking_status_history'),
      where('bookingCode', '==', bookingCode)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as BookingStatusHistory);
    // Sort ascending by timestamp
    list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Deduplicate consecutive identical status entries
    const deduplicated: BookingStatusHistory[] = [];
    for (const item of list) {
      if (deduplicated.length === 0 || deduplicated[deduplicated.length - 1].status !== item.status) {
        deduplicated.push(item);
      }
    }
    return deduplicated;
  } catch {
    return [];
  }
}

// ----------------- BOOKINGS CRUD -----------------

export async function createBooking(
  data: Omit<Booking, 'id' | 'bookingCode' | 'createdAt' | 'updatedAt' | 'status' | 'paymentStatus'>
): Promise<Booking> {
  // Validate payment method: strictly forbid cash, tunai, pay_on_service, cod, bayar_di_tempat for new bookings
  const rawMethod = (data.paymentMethod || '').toString().toLowerCase().trim();
  if (
    rawMethod.includes('cash') ||
    rawMethod.includes('tunai') ||
    rawMethod.includes('pay_on_service') ||
    rawMethod.includes('pay on service') ||
    rawMethod.includes('cod') ||
    rawMethod.includes('bayar di tempat') ||
    rawMethod.includes('bayar_di_tempat')
  ) {
    throw new Error('Metode pembayaran tersebut sudah tidak tersedia.');
  }

  const bookingCode = generateBookingCode();
  const docId = `bk_${bookingCode}`;
  // Display timestamp only. Payment authority uses Firestore document createTime.
  const now = new Date().toISOString();

  // Server-side / database-level validation of distance and home service fee:
  // A customer must not be able to modify homeServiceFee, distanceKm, or tier through request payload manipulation.
  let finalDistanceKm = typeof data.distanceKm === 'number' && !isNaN(data.distanceKm) ? data.distanceKm : 0;
  let finalDistanceMeters = typeof data.distanceMeters === 'number' && !isNaN(data.distanceMeters)
    ? data.distanceMeters
    : Math.round(finalDistanceKm * 1000);

  const baseLat = SENZU_BASE_LOCATION.lat;
  const baseLon = SENZU_BASE_LOCATION.lng;

  // Validate coordinates: coordinates must be valid numbers
  if (data.latitude == null || data.longitude == null || isNaN(data.latitude) || isNaN(data.longitude)) {
    throw new Error('Titik koordinat lokasi tidak valid.');
  }

  // Authoritative distance check against coordinates:
  // Driving distance cannot be less than straight-line geodesic distance.
  const minStraightDist = calculateDistanceKm(baseLat, baseLon, data.latitude, data.longitude);
  if (finalDistanceKm <= 0 || finalDistanceKm < minStraightDist * 0.95) {
    // If distance is missing, zero, or manipulated below straight-line distance, use authoritative straight-line distance as minimum
    finalDistanceKm = minStraightDist;
    finalDistanceMeters = Math.round(finalDistanceKm * 1000);
  }

  // If customer is not at Senzu base (> 0.2km) and calculated distance is 0, do not silently assume Rp0
  if (minStraightDist > 0.2 && finalDistanceKm === 0) {
    throw new Error('Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.');
  }

  // Authoritative recalculation of Home Service Fee using precise numeric distance
  const authoritativeFeeCalc = calculateHomeServiceFee(finalDistanceKm);
  const finalFee = authoritativeFeeCalc.fee; // Strictly authoritative, overriding any client-manipulated amount
  const finalTier = authoritativeFeeCalc.tier;
  const requiresAdminConfirmation = Boolean(data.requiresAdminConfirmation);

  const totalDiscounts = (data.voucherDiscount || 0) + (data.promoDiscount || 0) + (data.pointsDiscount || 0) + (data.discountAmount || 0);
  const finalTotalAmount = Math.max(0, data.servicePrice + finalFee - totalDiscounts);

  const newBooking: Booking = {
    ...data,
    id: docId,
    bookingCode,
    distanceKm: finalDistanceKm,
    distanceMeters: finalDistanceMeters,
    homeServiceFee: finalFee,
    homeServiceFeeSnapshot: finalFee,
    homeServiceFeeTier: finalTier,
    baseLocationId: SENZU_BASE_LOCATION.id,
    baseLocationName: SENZU_BASE_LOCATION.name,
    baseLatitude: baseLat,
    baseLongitude: baseLon,
    customerLat: data.latitude,
    customerLng: data.longitude,
    serviceNameSnapshot: data.serviceNameSnapshot ?? data.serviceName,
    durationMinutesSnapshot: data.durationMinutesSnapshot ?? data.serviceDuration,
    servicePriceSnapshot: data.servicePriceSnapshot ?? data.servicePrice,
    areaIdSnapshot: data.areaIdSnapshot,
    areaNameSnapshot: data.areaNameSnapshot ?? data.area,
    promoId: data.promoId || data.voucherId,
    promoCode: data.promoCode || data.voucherCode,
    promoCodeSnapshot: data.promoCodeSnapshot || data.promoCode || data.voucherCode,
    promoNameSnapshot: data.promoNameSnapshot,
    discountTypeSnapshot: data.discountTypeSnapshot,
    discountValueSnapshot: data.discountValueSnapshot,
    totalAmount: finalTotalAmount,
    requiresAdminConfirmation,
    status: 'Menunggu Pembayaran',
    paymentStatus: 'UNPAID',
    // Server-authoritative / authenticated identity: never trust client body ownership overrides
    customerAuthUid: auth.currentUser?.uid || undefined,
    authUserId: auth.currentUser?.uid || undefined,
    paymentPolicyVersion: 2,
    paymentDeadline: null,
    createdAt: now,
    updatedAt: now,
  };

  const appliedCode = (data.promoCode || data.voucherCode || '').trim().toUpperCase();
  const { cleanDigits } = normalizeIndonesianPhone(data.customerWhatsApp || '');
  const authUid = auth.currentUser?.uid || '';
  const custId = (data.customerId || '').trim() || (cleanDigits ? `cust_${cleanDigits}` : '');

  if (appliedCode) {
    // Authoritative atomic lock verification: prevents two-tab race conditions and unauthorized reuse
    const lockKeys: string[] = [];
    if (authUid) lockKeys.push(`vlock_${appliedCode}_uid_${authUid}`);
    if (cleanDigits) lockKeys.push(`vlock_${appliedCode}_phone_${cleanDigits}`);
    if (custId) lockKeys.push(`vlock_${appliedCode}_cust_${custId}`);

    const bookingRef = doc(db, 'bookings', docId);

    await runTransaction(db, async (t) => {
      for (const key of lockKeys) {
        const lSnap = await t.get(doc(db, 'voucher_redemptions', key));
        if (lSnap.exists()) {
          const lData = lSnap.data();
          if (lData?.status !== 'cancelled' && lData?.status !== 'batal') {
            throw new Error(`Voucher ${appliedCode} sudah pernah digunakan pada akun ini.`);
          }
        }
      }

      t.set(bookingRef, cleanFirestoreData(newBooking));

      for (const key of lockKeys) {
        t.set(doc(db, 'voucher_redemptions', key), {
          voucherCode: appliedCode,
          bookingId: docId,
          bookingCode,
          customerAuthUid: authUid || null,
          customerPhone: cleanDigits || null,
          customerId: custId || null,
          redeemedAt: now,
          status: 'active',
        }, { merge: true });
      }
    });
  } else {
    await setDoc(doc(db, 'bookings', docId), cleanFirestoreData(newBooking));
  }

  // If points were redeemed, deduct from loyalty ledger
  if (data.pointsRedeemed && data.pointsRedeemed > 0) {
    redeemPointsForBooking({
      customerId: data.customerId || `cust_${data.customerWhatsApp.replace(/[^0-9]/g, '')}`,
      points: data.pointsRedeemed,
      bookingId: docId,
      bookingCode,
      discountRp: data.pointsDiscount || 0,
    }).catch((err) => console.warn('Points redemption error in createBooking:', err));
  }

  // If customer voucher was applied, mark customer voucher used if applicable
  if (data.voucherId && data.voucherId.startsWith('cv_')) {
    markCustomerVoucherUsed(data.voucherId, docId, bookingCode).catch((err) =>
      console.warn('Voucher mark used warning:', err)
    );
  }

  // If general promo/voucher was applied, record authoritative redemption and usage
  if (appliedCode) {
    recordVoucherRedemption({
      voucherCode: appliedCode,
      voucherId: data.promoId || (data.voucherId && !data.voucherId.startsWith('cv_') ? data.voucherId : undefined),
      bookingId: docId,
      bookingCode,
      customerId: custId,
      customerAuthUid: authUid,
      customerPhone: data.customerWhatsApp,
      discountAmount: data.discountAmount || data.promoDiscount || data.voucherDiscount || 0,
    }).catch((err) => console.warn('General voucher redemption recording warning:', err));
  }

  // Initial history entry
  await addBookingStatusHistory(
    docId,
    bookingCode,
    'Menunggu Pembayaran',
    'customer',
    data.customerName,
    `Booking diajukan oleh customer melalui portal Senzu Home. Metode bayar: ${data.paymentMethod}`
  );

  // CRM Update
  await upsertCustomerCRM(newBooking);

  // Initialize official payment record in payments collection
  try {
    const pMethod = (data.paymentMethod || '').toLowerCase();
    const methodType = pMethod.includes('qris')
      ? 'qris'
      : pMethod.includes('mandiri')
      ? 'mandiri'
      : pMethod.includes('bri')
      ? 'bri'
      : 'bni';
    const payment = await createPaymentRecord(newBooking, { methodType: methodType as any });
    newBooking.paymentDeadline = payment.paymentDeadline || undefined;
  } catch (err) {
    console.warn('Payment record initialization non-blocking warning:', err);
  }

  // Emit booking.created event
  try {
    emitEvent('booking.created', {
      bookingId: newBooking.id,
      bookingCode: newBooking.bookingCode,
      customerId: newBooking.customerId,
      customerName: newBooking.customerName,
      customerWhatsApp: newBooking.customerWhatsApp,
      customerEmail: newBooking.customerEmail,
      serviceName: newBooking.serviceName,
      scheduleAt: newBooking.scheduleAt,
      totalAmount: newBooking.totalAmount,
      paymentMethod: newBooking.paymentMethod,
      area: newBooking.area,
    }, { id: newBooking.customerId, role: 'customer' }).catch((e) => console.warn('Notification emit warning:', e));
  } catch (err) {
    console.warn('Failed to emit booking.created event:', err);
  }

  return newBooking;
}

export async function trackBookingByCodeAndPhone(
  bookingCode: string,
  phoneInput: string
): Promise<{ booking: Booking; history: BookingStatusHistory[] } | null> {
  const cleanPhoneInput = phoneInput.replace(/[^0-9]/g, '');
  const cleanCode = bookingCode.trim().toUpperCase();

  // Enforce minimum 8 digits for phone number to avoid accidental matches or enumeration
  if (cleanPhoneInput.length < 8 || !cleanCode) {
    return null;
  }

  // 1. Try secure tracking server API (does not require broad Firestore rules)
  try {
    const res = await fetch(`/api/bookings/track?code=${encodeURIComponent(cleanCode)}&phone=${encodeURIComponent(cleanPhoneInput)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.booking) {
        return { booking: data.booking as Booking, history: data.history || [] };
      }
    }
  } catch (apiErr) {
    console.warn('API tracking lookup notice, trying direct client query:', apiErr);
  }

  // 2. Client query fallback (authorized for staff or customer owner)
  try {
    const q = query(collection(db, 'bookings'), where('bookingCode', '==', cleanCode));
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const b = snap.docs[0].data() as Booking;
    const dbPhoneClean = b.customerWhatsApp.replace(/[^0-9]/g, '');

    // Compare phone numbers using last 8 digits
    const last8Input = cleanPhoneInput.slice(-8);
    const last8Db = dbPhoneClean.slice(-8);

    if (last8Input !== last8Db) {
      return null;
    }

    const history = await getBookingStatusHistory(b.bookingCode);
    return { booking: b, history };
  } catch {
    return null;
  }
}

export async function getBookingByCode(bookingCode: string): Promise<Booking | null> {
  try {
    const cleanCode = bookingCode.trim().toUpperCase();
    if (!cleanCode) return null;

    // 1. Try secure tracking server API
    try {
      const res = await fetch(`/api/bookings/track?code=${encodeURIComponent(cleanCode)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.booking) {
          return data.booking as Booking;
        }
      }
    } catch {
      // ignore, fallback to direct query
    }

    // 2. Direct Firestore lookup (for staff / authenticated owner)
    const q = query(collection(db, 'bookings'), where('bookingCode', '==', cleanCode));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data() as Booking;
  } catch {
    return null;
  }
}

export function subscribeToBookingById(
  bookingId: string,
  callback: (booking: Booking | null) => void
) {
  const ref = doc(db, 'bookings', bookingId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as Booking);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('Booking subscription warning:', err);
    }
  );
}

export function subscribeToBookingStatusHistory(
  bookingCode: string,
  callback: (history: BookingStatusHistory[]) => void
) {
  const q = query(
    collection(db, 'booking_status_history'),
    where('bookingCode', '==', bookingCode)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as BookingStatusHistory);
      list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const deduplicated: BookingStatusHistory[] = [];
      for (const item of list) {
        if (deduplicated.length === 0 || deduplicated[deduplicated.length - 1].status !== item.status) {
          deduplicated.push(item);
        }
      }
      callback(deduplicated);
    },
    (err) => {
      console.warn('Status history subscription warning:', err);
    }
  );
}

export async function getAllBookings(): Promise<Booking[]> {
  try {
    const snap = await getDocs(collection(db, 'bookings'));
    const list = snap.docs.map((d) => d.data() as Booking);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('senzu_cached_bookings', JSON.stringify(list));
      } catch {}
    }
    return list;
  } catch (err: any) {
    if (err?.code !== 'resource-exhausted') {
      console.warn('Get bookings notice:', err?.message || err);
    }
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('senzu_cached_bookings');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  }
}

export function subscribeToAllBookings(callback: (bookings: Booking[]) => void) {
  return onSnapshot(
    collection(db, 'bookings'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Booking);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('senzu_cached_bookings', JSON.stringify(list));
        } catch {}
      }
      callback(list);
    },
    (err) => {
      if (err.code === 'resource-exhausted') {
        // Quota reached: recover smoothly from cached bookings
        if (typeof window !== 'undefined') {
          try {
            const cached = localStorage.getItem('senzu_cached_bookings');
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed)) {
                callback(parsed);
                return;
              }
            }
          } catch {}
        }
      } else {
        console.warn('Realtime bookings subscription notice:', err.message);
      }
    }
  );
}

/**
 * Authoritatively fetches customer bookings from the backend API.
 * Performs cryptographically verified token authentication and reconciles
 * any legacy bookings to the canonical customerAuthUid.
 */
export async function fetchCustomerBookingsAuthoritative(): Promise<{
  success: boolean;
  bookings: Booking[];
  error?: string;
}> {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, bookings: [], error: 'Belum masuk ke akun.' };
    }

    const idToken = await user.getIdToken();
    const res = await fetch('/api/customer/bookings', {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        bookings: [],
        error: errData?.error || 'Riwayat pesanan belum dapat dimuat. Silakan coba lagi.',
      };
    }

    const data = await res.json();
    return {
      success: true,
      bookings: data.bookings || [],
    };
  } catch (err: any) {
    console.warn('[Customer Bookings] Authoritative fetch notice:', err);
    return {
      success: false,
      bookings: [],
      error: 'Riwayat pesanan belum dapat dimuat. Silakan periksa koneksi Anda dan coba lagi.',
    };
  }
}

/**
 * Scoped customer bookings realtime query
 * Uses authenticated Firebase UID as primary authoritative identity
 * Complies strictly with Firestore security rules and RBAC boundaries
 */
export function subscribeToCustomerBookings(
  paramsOrCustomerId?:
    | {
        authUid?: string;
        customerId?: string;
        customerWhatsApp?: string;
        onSuccess: (bookings: Booking[]) => void;
        onError?: (err: Error) => void;
      }
    | string,
  legacyCustomerWhatsApp?: string,
  legacyCallback?: (bookings: Booking[]) => void
): () => void {
  let authUid = auth.currentUser?.uid || '';
  let customerId = '';
  let customerWhatsApp = '';
  let callback: (bookings: Booking[]) => void = () => {};
  let onError: ((err: Error) => void) | undefined;

  if (typeof paramsOrCustomerId === 'object' && paramsOrCustomerId !== null) {
    authUid = paramsOrCustomerId.authUid || auth.currentUser?.uid || '';
    customerId = paramsOrCustomerId.customerId || '';
    customerWhatsApp = paramsOrCustomerId.customerWhatsApp || '';
    callback = paramsOrCustomerId.onSuccess || (() => {});
    onError = paramsOrCustomerId.onError;
  } else {
    // Legacy positional arguments: (customerIdOrAuthUid, customerWhatsApp, callback)
    const firstArg = typeof paramsOrCustomerId === 'string' ? paramsOrCustomerId : '';
    if (firstArg.length >= 20 && !firstArg.startsWith('cust_') && !firstArg.startsWith('CUST-')) {
      authUid = firstArg;
    } else {
      customerId = firstArg;
    }
    customerWhatsApp = legacyCustomerWhatsApp || '';
    callback = legacyCallback || (() => {});
  }

  // Authoritative identity fallback
  if (!authUid && auth.currentUser?.uid) {
    authUid = auth.currentUser.uid;
  }

  if (!authUid) {
    callback([]);
    return () => {};
  }

  // Scoped query matching Firestore security rules
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

  // Proactively reconcile and fetch any legacy bookings in background
  fetchCustomerBookingsAuthoritative().then((res) => {
    if (res.success && res.bookings && res.bookings.length > 0) {
      callback(res.bookings);
    }
  }).catch(() => {});

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Booking);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    (err) => {
      console.warn('[Customer Bookings] Realtime subscription notice:', err.message);
      if (onError) {
        onError(err);
      }
      // Note: Never silently call callback([]) on error so UI can distinguish loading/error from empty!
    }
  );
}

/**
 * Phase 7 Data Minimization: Scoped therapist bookings query
 * Ensures therapist browser NEVER receives the entire company's bookings
 */
export function subscribeToTherapistBookings(
  therapistId: string,
  callback: (bookings: Booking[]) => void
) {
  if (!therapistId) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'bookings'), where('therapistId', '==', therapistId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Booking);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    (err) => {
      if (err.code === 'resource-exhausted') {
        if (typeof window !== 'undefined') {
          try {
            const cached = localStorage.getItem('senzu_cached_bookings');
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed)) {
                const filtered = parsed.filter((b: Booking) => b.therapistId === therapistId);
                callback(filtered);
                return;
              }
            }
          } catch {}
        }
      } else {
        console.warn('Therapist bookings subscription notice:', err.message);
      }
      callback([]);
    }
  );
}

// ----------------- ROLE-BASED ACTIONS -----------------

/**
 * CSS: Verify Payment
 * Menunggu Pembayaran -> Pembayaran Terverifikasi
 */
export async function cssVerifyPayment(
  booking: Booking,
  cssStaffName: string,
  notes?: string
): Promise<void> {
  const payment = await getPaymentRecordByBookingId(booking.id);
  if (!payment) throw new Error('Data pembayaran tidak ditemukan. Silakan segarkan pesanan.');
  const result = await cssVerifyPaymentTransaction(payment, booking, 'css', cssStaffName, notes);
  if (!result.success) throw new Error(result.error || 'Verifikasi pembayaran gagal.');
}

/**
 * CSS: Confirm Booking
 * Pembayaran Terverifikasi -> Confirmed
 */
export async function cssConfirmBooking(
  booking: Booking,
  cssStaffName: string,
  notes?: string
): Promise<void> {
  if (booking.status === 'Confirmed') {
    return;
  }
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date().toISOString();

  await updateDoc(ref, {
    status: 'Confirmed',
    updatedAt: now,
  });

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    'Confirmed',
    'css',
    cssStaffName,
    notes || 'Jadwal dan detail pesanan telah dikonfirmasi oleh CSS Senzu'
  );

  emitEvent('booking.confirmed', {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    customerName: booking.customerName,
    customerWhatsApp: booking.customerWhatsApp,
    customerEmail: booking.customerEmail,
    serviceName: booking.serviceName,
    scheduleAt: booking.scheduleAt,
    area: booking.area,
  }, { id: 'css', role: 'css' }).catch((e) => console.warn('Notification emit error:', e));
}

/**
 * CSS: Reschedule Booking
 */
export async function cssRescheduleBooking(
  booking: Booking,
  newDate: string,
  newTime: string,
  cssStaffName: string,
  notes?: string
): Promise<void> {
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date().toISOString();
  const oldSchedule = `${booking.scheduleDate} ${booking.scheduleTime} WIB`;
  const newSchedule = `${newDate} ${newTime} WIB`;

  await updateDoc(ref, {
    scheduleDate: newDate,
    scheduleTime: newTime,
    scheduleAt: `${newDate} ${newTime}`,
    status: 'Rescheduled',
    updatedAt: now,
  });

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    'Rescheduled',
    'css',
    cssStaffName,
    notes || `Jadwal diubah dari ${oldSchedule} ke ${newSchedule}`
  );

  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    therapistId: booking.therapistId,
    therapistName: booking.therapistName,
    action: 'reschedule',
    actorRole: 'css',
    actorName: cssStaffName,
    oldValue: oldSchedule,
    newValue: newSchedule,
    reason: notes || 'Permintaan perubahan jadwal pelanggan',
    note: `Rescheduled oleh CSS ${cssStaffName}`,
  });
}

/**
 * CSS: Cancel Booking
 */
export async function cssCancelBooking(
  booking: Booking,
  cssStaffName: string,
  reason: string
): Promise<void> {
  if (booking.status === 'Cancelled') {
    return;
  }
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date().toISOString();

  await updateDoc(ref, {
    status: 'Cancelled',
    internalNotes: reason ? `Batal: ${reason}` : booking.internalNotes,
    updatedAt: now,
  });

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    'Cancelled',
    'css',
    cssStaffName,
    reason || 'Pesanan dibatalkan oleh pihak Senzu / customer'
  );

  // Refund loyalty points if used
  if (booking.pointsRedeemed && booking.pointsRedeemed > 0) {
    refundLoyaltyPointsForCancelledBooking(booking, `Pengembalian poin: ${reason || 'Booking dibatalkan'}`).catch((err) =>
      console.warn('Loyalty point refund error:', err)
    );
  }

  emitEvent('booking.cancelled', {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    customerName: booking.customerName,
    customerWhatsApp: booking.customerWhatsApp,
    customerEmail: booking.customerEmail,
    serviceName: booking.serviceName,
    cancelReason: reason,
  }, { id: 'css', role: 'css' }).catch((e) => console.warn('Notification emit error:', e));
}

/**
 * CSS: Escalate Booking / Issue to Supervisor
 */
export async function cssEscalateToSupervisor(
  booking: Booking,
  params: {
    category: string;
    reason: string;
    priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
    cssStaffName: string;
    cssStaffId: string;
  }
): Promise<void> {
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date();
  const isoNow = now.toISOString();

  const escalationData = {
    category: params.category,
    reason: params.reason,
    priority: params.priority,
    escalatedBy: params.cssStaffId,
    escalatedByName: params.cssStaffName,
    escalatedAt: isoNow,
    status: 'open' as const,
  };

  const noteEntry = `[${formatDateTimeWIB(now)} - ESKALASI SUPERVISOR - ${params.cssStaffName}] Prioritas: ${params.priority} | Kategori: ${params.category} | Alasan: ${params.reason}`;
  const updatedNotes = booking.internalNotes ? `${booking.internalNotes}\n${noteEntry}` : noteEntry;

  await updateDoc(ref, {
    escalation: escalationData,
    internalNotes: updatedNotes,
    taskStatus: 'Waiting Supervisor',
    updatedAt: isoNow,
  });

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    booking.status,
    'css',
    params.cssStaffName,
    `[ESKALASI KE SUPERVISOR] ${params.category}: ${params.reason} (Prioritas: ${params.priority})`
  );

  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    therapistId: booking.therapistId,
    therapistName: booking.therapistName,
    action: 'escalate_supervisor',
    actorRole: 'css',
    actorName: params.cssStaffName,
    reason: `${params.category}: ${params.reason}`,
    note: `Prioritas: ${params.priority}`,
  });

  emitEvent('supervisor.unassigned_alert', {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    title: `Eskalasi CSS: ${params.category} (${booking.bookingCode})`,
    reason: params.reason,
    priority: params.priority,
    customerName: booking.customerName,
  }, { id: params.cssStaffId, role: 'css' }).catch((e) => console.warn('Escalation emit error:', e));
}

/**
 * CSS: Update Customer Address
 */
export async function cssUpdateAddress(
  booking: Booking,
  newAddress: string,
  newArea: string,
  addressNotes: string | undefined,
  cssStaffName: string,
  reason: string
): Promise<void> {
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date();
  const isoNow = now.toISOString();

  const oldAddressStr = `${booking.address} (${booking.area})`;
  const newAddressStr = `${newAddress} (${newArea})`;

  const noteEntry = `[${formatDateTimeWIB(now)} - PERUBAHAN ALAMAT - ${cssStaffName}] Dari: ${oldAddressStr} -> Ke: ${newAddressStr}. Alasan: ${reason}`;
  const updatedNotes = booking.internalNotes ? `${booking.internalNotes}\n${noteEntry}` : noteEntry;

  await updateDoc(ref, {
    address: newAddress,
    area: newArea,
    addressNotes: addressNotes || booking.addressNotes || '',
    internalNotes: updatedNotes,
    updatedAt: isoNow,
  });

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    booking.status,
    'css',
    cssStaffName,
    `Alamat diubah menjadi: ${newAddress}, ${newArea}. Alasan: ${reason}`
  );

  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    therapistId: booking.therapistId,
    therapistName: booking.therapistName,
    action: 'address_change',
    actorRole: 'css',
    actorName: cssStaffName,
    oldValue: oldAddressStr,
    newValue: newAddressStr,
    reason,
  });
}

/**
 * CSS: Add / Update Internal Notes
 */
export async function cssAddInternalNote(
  bookingId: string,
  bookingCode: string,
  noteText: string,
  cssStaffName: string
): Promise<void> {
  const ref = doc(db, 'bookings', bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const current = snap.data() as Booking;

  const now = new Date();
  const noteEntry = `[${formatDateTimeWIB(now)} - CSS ${cssStaffName}]: ${noteText}`;
  const updatedNotes = current.internalNotes ? `${current.internalNotes}\n${noteEntry}` : noteEntry;

  await updateDoc(ref, {
    internalNotes: updatedNotes,
    updatedAt: now.toISOString(),
  });

  await addOperationalAuditLog({
    bookingId,
    bookingCode,
    action: 'internal_note',
    actorRole: 'css',
    actorName: cssStaffName,
    note: noteText,
  });
}

/**
 * CSS: Claim Task (Ambil Tugas)
 */
export async function cssClaimTask(
  bookingId: string,
  bookingCode: string,
  cssStaffId: string,
  cssStaffName: string
): Promise<void> {
  const ref = doc(db, 'bookings', bookingId);
  const now = new Date().toISOString();

  await updateDoc(ref, {
    cssOwnerId: cssStaffId,
    cssOwnerName: cssStaffName,
    taskStatus: 'In Progress',
    updatedAt: now,
  });

  await addOperationalAuditLog({
    bookingId,
    bookingCode,
    action: 'claim_task',
    actorRole: 'css',
    actorName: cssStaffName,
    note: `Tugas operasional diambil oleh ${cssStaffName}`,
  });
}

/**
 * CSS: Flag Customer Unreachable (Tidak Dapat Dihubungi)
 */
export async function cssFlagCustomerUnreachable(
  booking: Booking,
  cssStaffName: string,
  note?: string
): Promise<void> {
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date();
  const isoNow = now.toISOString();
  const currentCount = (booking.unreachableCount || 0) + 1;

  const noteEntry = `[${formatDateTimeWIB(now)} - CUSTOMER TIDAK MERESPON #${currentCount} - ${cssStaffName}] ${note || 'Panggilan/WA tidak terjawab'}`;
  const updatedNotes = booking.internalNotes ? `${booking.internalNotes}\n${noteEntry}` : noteEntry;

  await updateDoc(ref, {
    unreachableCount: currentCount,
    lastContactAttemptAt: isoNow,
    taskStatus: 'Waiting Customer',
    internalNotes: updatedNotes,
    updatedAt: isoNow,
  });

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    booking.status,
    'css',
    cssStaffName,
    `Customer dihubungi namun tidak merespon (Percobaan #${currentCount}). ${note || ''}`
  );

  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    action: 'customer_unreachable',
    actorRole: 'css',
    actorName: cssStaffName,
    note: `Percobaan #${currentCount}: ${note || 'Tidak merespon'}`,
  });
}

/**
 * CSS: Update Work Task Status
 */
export async function cssUpdateTaskStatus(
  bookingId: string,
  taskStatus: NonNullable<Booking['taskStatus']>,
  cssStaffName: string,
  note?: string
): Promise<void> {
  const ref = doc(db, 'bookings', bookingId);
  const now = new Date().toISOString();

  await updateDoc(ref, {
    taskStatus,
    updatedAt: now,
  });
}

/**
 * Supervisor: Assign Therapist
 * Saat therapist sudah assigned: status menjadi “Therapist Assigned”.
 * Cegah duplicate assignment history jika therapist yang sama sudah ditugaskan.
 */
export async function supervisorAssignTherapist(
  booking: Booking,
  therapist: Therapist,
  supervisorName: string
): Promise<void> {
  const isPaid = isPaymentPaid(booking.paymentStatus);
  const isConfirmed =
    booking.status === 'Confirmed' ||
    booking.status === 'Therapist Assigned' ||
    booking.status === 'Pembayaran Terverifikasi' ||
    booking.status === 'Rescheduled';

  if (!isPaid || !isConfirmed) {
    throw new Error(
      'Booking belum terverifikasi lunas (PAID) atau belum terkonfirmasi. Supervisor hanya dapat menugaskan terapis jika booking sudah lunas dan terkonfirmasi.'
    );
  }

  const isSameTherapist = booking.therapistId === therapist.id && booking.status === 'Therapist Assigned';
  if (isSameTherapist) {
    // Do not create duplicate history
    return;
  }

  const ref = doc(db, 'bookings', booking.id);
  const now = new Date().toISOString();

  await updateDoc(ref, {
    therapistId: therapist.id,
    therapistName: therapist.name,
    status: 'Therapist Assigned',
    updatedAt: now,
  });

  // Mark therapist on_duty
  try {
    const thRef = doc(db, 'therapists', therapist.id);
    await updateDoc(thRef, { status: 'on_duty' });
  } catch (err) {
    console.warn('Therapist status update warning:', err);
  }

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    'Therapist Assigned',
    'supervisor',
    supervisorName,
    `Terapis ${therapist.name} ditugaskan oleh Supervisor ${supervisorName}`
  );

  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    therapistId: therapist.id,
    therapistName: therapist.name,
    action: 'assign',
    actorRole: 'supervisor',
    actorName: supervisorName,
    newValue: `Terapis: ${therapist.name}`,
    reason: 'Penugasan terapis oleh Supervisor',
  });

  emitEvent('therapist.assigned', {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    customerName: booking.customerName,
    customerWhatsApp: booking.customerWhatsApp,
    customerEmail: booking.customerEmail,
    therapistId: therapist.id,
    therapistName: therapist.name,
    serviceName: booking.serviceName,
    scheduleAt: booking.scheduleAt,
    area: booking.area,
  }, { id: 'supervisor', role: 'supervisor' }).catch((e) => console.warn('Notification emit error:', e));
}

/**
 * Therapist Status Transition Workflow:
 * Therapist Assigned -> Accept Order -> Accepted
 * Accepted -> On The Way
 * On The Way -> Arrived
 * Arrived -> Start Treatment -> Treatment
 * Treatment -> Completed
 */
export async function updateTherapistStatus(
  therapistId: string,
  status: Therapist['status']
): Promise<void> {
  try {
    const ref = doc(db, 'therapists', therapistId);
    await updateDoc(ref, { status, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('Failed to update therapist status:', err);
  }
}

/**
 * Prompt 19: High-Performance Atomic Therapist Order Acceptance
 * Executes authoritative transaction to prevent double acceptances,
 * verifies assigned therapist ownership and non-cancelled status,
 * updates booking status to 'Accepted', and safely processes
 * non-blocking secondary operations in the background.
 */
export async function therapistAcceptOrderAtomic(
  bookingId: string,
  therapistId: string,
  therapistName: string
): Promise<{ success: boolean; error?: string; booking: Booking }> {
  // Check internet connection first (Prompt 19A Part 27)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const offlineErr: any = new Error('Koneksi diperlukan untuk menerima pesanan.');
    offlineErr.code = 'OFFLINE_CONNECTION_REQUIRED';
    throw offlineErr;
  }

  const now = new Date().toISOString();
  let updatedBooking: Booking | null = null;

  // Primary Path: Authoritative Backend Endpoint (Prompt 19A Part 7 & 8)
  try {
    const requestUser = auth.currentUser;
    if (!requestUser) {
      const sessionErr: any = new Error('Sesi terapis diperlukan untuk menerima pesanan.');
      sessionErr.code = 'AUTH_REQUIRED';
      throw sessionErr;
    }
    const idToken = await requestUser.getIdToken();
    if (!idToken || auth.currentUser?.uid !== requestUser.uid) {
      const sessionErr: any = new Error('Sesi terapis berubah atau tidak valid. Silakan masuk kembali.');
      sessionErr.code = 'AUTH_REQUIRED';
      throw sessionErr;
    }

    const resp = await fetch('/api/therapist/accept-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        bookingId,
        therapistId,
        therapistName,
        staffAuthUid: requestUser.uid,
      }),
    });

    const resData = await resp.json().catch(() => ({}));
    if (auth.currentUser?.uid !== requestUser.uid) {
      const sessionErr: any = new Error('Sesi terapis berubah. Silakan coba kembali dengan akun yang aktif.');
      sessionErr.code = 'AUTH_REQUIRED';
      throw sessionErr;
    }

    if (resp.ok && resData?.success && resData?.booking) {
      updatedBooking = resData.booking;
    } else {
      // Backend rejected the acceptance (reassigned, cancelled, already accepted, etc.)
      // Prompt 19A Part 7: Client MUST NOT override backend rejection!
      const errCode = resData?.code || 'FAILED_TO_ACCEPT';
      const errMsg = resData?.message || 'Pesanan belum dapat diterima. Silakan coba kembali.';
      const backendErr: any = new Error(errMsg);
      backendErr.code = errCode;
      throw backendErr;
    }
  } catch (apiErr: any) {
    // Only the authoritative backend may accept an order; every failure rolls back in the existing UI.
    throw apiErr;
  }

  if (!updatedBooking) {
    const failErr: any = new Error('Pesanan belum dapat diterima. Silakan coba kembali.');
    failErr.code = 'FAILED_TO_ACCEPT';
    throw failErr;
  }

  const confirmedBooking = updatedBooking as Booking;

  // Asynchronous secondary operations (Part AC): Non-blocking execution preserves UI speed
  (async () => {
    try {
      const historyId = `hist_${confirmedBooking.bookingCode || bookingId}_${Date.now()}`;
      const historyEntry = {
        id: historyId,
        bookingId,
        bookingCode: confirmedBooking.bookingCode || '',
        status: 'Accepted' as BookingStatus,
        note: `Pesanan diterima oleh Terapis ${therapistName}, bersiap menuju lokasi`,
        updatedByRole: 'therapist' as const,
        updatedByName: therapistName,
        timestamp: now,
        formattedWIB: formatDateTimeWIB(new Date(now)),
      };
      await setDoc(doc(db, 'booking_status_history', historyId), cleanFirestoreData(historyEntry));
    } catch (e) {
      console.warn('Background status history notice:', e);
    }

    try {
      const basePayload = {
        bookingId,
        bookingCode: confirmedBooking.bookingCode,
        customerId: confirmedBooking.customerId,
        customerName: confirmedBooking.customerName,
        customerWhatsApp: confirmedBooking.customerWhatsApp,
        customerEmail: confirmedBooking.customerEmail,
        serviceName: confirmedBooking.serviceName,
        therapistId: confirmedBooking.therapistId || therapistId,
        therapistName,
        scheduleAt: confirmedBooking.scheduleAt,
        area: confirmedBooking.area,
      };
      emitEvent('therapist.accepted', basePayload, { id: therapistId, role: 'therapist' }).catch(() => {});
    } catch (e) {}

    try {
      await addOperationalAuditLog({
        bookingId,
        bookingCode: confirmedBooking.bookingCode,
        therapistId,
        therapistName,
        action: 'claim_task',
        actorRole: 'system',
        actorName: therapistName,
        newValue: 'Accepted',
        reason: 'Terapis menerima tugas pemesanan',
      });
    } catch (e) {}
  })();

  return { success: true, booking: confirmedBooking };
}

export async function therapistUpdateStatus(
  booking: Booking,
  nextStatus: BookingStatus,
  therapistName: string,
  customNote?: string,
  additionalData?: {
    arrivalLatitude?: number;
    arrivalLongitude?: number;
    earlyCompletion?: boolean;
  }
): Promise<void> {
  if (booking.status === nextStatus) {
    return;
  }

  // Guard against updates on terminal statuses
  if (booking.status === 'Cancelled') {
    throw new Error('Pesanan telah dibatalkan, status tidak dapat diperbarui.');
  }
  if (booking.status === 'Completed') {
    throw new Error('Pesanan telah selesai, status tidak dapat diperbarui.');
  }

  // Enforce standard operational state transitions for therapists
  const allowedNext: Partial<Record<BookingStatus, BookingStatus[]>> = {
    'Therapist Assigned': ['Accepted'],
    'Accepted': ['On The Way'],
    'On The Way': ['Arrived'],
    'Arrived': ['Treatment'],
    'Treatment': ['Completed'],
  };

  const validTransitions = allowedNext[booking.status];
  if (validTransitions && !validTransitions.includes(nextStatus)) {
    throw new Error(`Transisi status tidak valid: dari "${booking.status}" ke "${nextStatus}".`);
  }

  const ref = doc(db, 'bookings', booking.id);
  const now = new Date().toISOString();

  // If nextStatus is Completed:
  // For Cash method, completing the treatment also completes cash collection -> mark paymentStatus PAID
  const isCash = booking.paymentMethod === 'Cash';
  const newPaymentStatus: PaymentStatus =
    nextStatus === 'Completed' && isCash ? 'PAID' : booking.paymentStatus;

  const updatePayload: Record<string, any> = {
    status: nextStatus,
    paymentStatus: newPaymentStatus,
    updatedAt: now,
  };

  if (nextStatus === 'Accepted') {
    updatePayload.acceptedAt = now;
    updatePayload.acceptedBy = therapistName;
  } else if (nextStatus === 'On The Way') {
    updatePayload.onTheWayAt = now;
  } else if (nextStatus === 'Arrived') {
    updatePayload.arrivedAt = now;
    if (additionalData?.arrivalLatitude != null) {
      updatePayload.arrivalLatitude = additionalData.arrivalLatitude;
      updatePayload.arrivalLongitude = additionalData.arrivalLongitude;
    }
  } else if (nextStatus === 'Treatment') {
    updatePayload.treatmentStartedAt = now;
  } else if (nextStatus === 'Completed') {
    updatePayload.completedAt = now;
    if (additionalData?.earlyCompletion != null) {
      updatePayload.earlyCompletion = additionalData.earlyCompletion;
    }
  }

  await updateDoc(ref, updatePayload);

  let defaultNote = '';
  switch (nextStatus) {
    case 'Accepted':
      defaultNote = `Pesanan diterima oleh Terapis ${therapistName}, bersiap menuju lokasi`;
      break;
    case 'On The Way':
      defaultNote = `Terapis ${therapistName} sedang dalam perjalanan ke alamat Anda`;
      break;
    case 'Arrived':
      defaultNote = `Terapis ${therapistName} telah sampai di lokasi pelanggan`;
      break;
    case 'Treatment':
      defaultNote = `Sesi pijat & refleksi dimulai oleh Terapis ${therapistName}`;
      break;
    case 'Completed':
      defaultNote = `Perawatan selesai. Terima kasih telah mempercayakan Senzu Home!`;
      break;
    default:
      defaultNote = `Status diperbarui menjadi ${nextStatus}`;
  }

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    nextStatus,
    'therapist',
    therapistName,
    customNote || defaultNote
  );

  // Emit corresponding notification event
  try {
    const basePayload = {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      customerId: booking.customerId,
      customerName: booking.customerName,
      customerWhatsApp: booking.customerWhatsApp,
      customerEmail: booking.customerEmail,
      serviceName: booking.serviceName,
      therapistId: booking.therapistId,
      therapistName,
      scheduleAt: booking.scheduleAt,
      area: booking.area,
    };
    const actor = { id: booking.therapistId || 'therapist', role: 'therapist' };

    if (nextStatus === 'Accepted') {
      emitEvent('therapist.accepted', basePayload, actor).catch(() => {});
    } else if (nextStatus === 'On The Way') {
      emitEvent('therapist.on_the_way', basePayload, actor).catch(() => {});
    } else if (nextStatus === 'Arrived') {
      emitEvent('therapist.arrived', basePayload, actor).catch(() => {});
    } else if (nextStatus === 'Treatment') {
      emitEvent('treatment.started', basePayload, actor).catch(() => {});
    } else if (nextStatus === 'Completed') {
      emitEvent('treatment.completed', basePayload, actor).catch(() => {});
    }
  } catch (err) {
    console.warn('Therapist status notification emit warning:', err);
  }

  // If completed, update therapist completed count, set status to available, and update CRM
  if (nextStatus === 'Completed') {
    if (booking.therapistId) {
      try {
        const thRef = doc(db, 'therapists', booking.therapistId);
        const thSnap = await getDoc(thRef);
        if (thSnap.exists()) {
          const curCount = thSnap.data().totalCompleted || 0;
          await updateDoc(thRef, { totalCompleted: curCount + 1, status: 'available' });
        }
      } catch (err) {
        console.warn('Therapist update counter warning:', err);
      }
    }
    // Update CRM with realized Completed & Paid
    await upsertCustomerCRM({ ...booking, status: 'Completed', paymentStatus: newPaymentStatus });

    // Process Loyalty Point Earning (idempotent, checks Completed + Paid)
    if (isPaymentPaid(newPaymentStatus)) {
      processBookingLoyaltyEarning({ ...booking, status: 'Completed', paymentStatus: newPaymentStatus }).catch((err) =>
        console.warn('Loyalty points earning trigger error:', err)
      );
    }
  }

  // If status is Arrived, Completed, or Cancelled, ensure location tracking is stopped
  if (['Arrived', 'Completed', 'Cancelled'].includes(nextStatus)) {
    try {
      await stopTherapistTracking(booking.id);
    } catch (err) {
      console.warn('Error stopping therapist tracking:', err);
    }
  }
}

/**
 * Reports an operational issue from the therapist for supervisor and CSS review.
 */
export async function reportBookingIssue(
  bookingId: string,
  bookingCode: string,
  currentStatus: BookingStatus,
  therapistId: string,
  therapistName: string,
  category: string,
  note: string
): Promise<void> {
  const ref = doc(db, 'bookings', bookingId);
  const now = new Date().toISOString();
  await updateDoc(ref, {
    issueReport: {
      category,
      note,
      reportedAt: now,
      reportedBy: therapistName,
    },
    updatedAt: now,
  });

  await addBookingStatusHistory(
    bookingId,
    bookingCode,
    currentStatus,
    'therapist',
    therapistName,
    `[LAPORAN KENDALA: ${category}] ${note}`
  );
}

// ----------------- THERAPIST REALTIME LOCATION TRACKING -----------------

/**
 * Saves therapist realtime location during an active "On The Way" delivery.
 */
export async function saveTherapistLocation(locationData: TherapistLocation): Promise<void> {
  try {
    const locRef = doc(db, 'therapist_locations', locationData.bookingId);
    await setDoc(locRef, cleanFirestoreData({
      ...locationData,
      updatedAtMillis: Date.now(),
      timestamp: new Date().toISOString(),
    }), { merge: true });
  } catch (err: any) {
    if (err?.code !== 'resource-exhausted') {
      console.warn('Therapist location sync notice:', err?.message || err);
    }
  }
}

/**
 * Stops live tracking and marks the location session inactive.
 */
export async function stopTherapistTracking(bookingId: string): Promise<void> {
  try {
    const locRef = doc(db, 'therapist_locations', bookingId);
    await updateDoc(locRef, {
      isTrackingActive: false,
      updatedAtMillis: Date.now(),
    });
  } catch (err) {
    // Document may not exist yet if tracking wasn't started
  }
}

/**
 * Gets the current location for a specific booking.
 */
export async function getTherapistLocation(bookingId: string): Promise<TherapistLocation | null> {
  try {
    const locRef = doc(db, 'therapist_locations', bookingId);
    const snap = await getDoc(locRef);
    if (snap.exists()) {
      return snap.data() as TherapistLocation;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Subscribes to realtime updates for a single booking's therapist location.
 */
export function subscribeToTherapistLocation(
  bookingId: string,
  callback: (loc: TherapistLocation | null) => void
) {
  const locRef = doc(db, 'therapist_locations', bookingId);
  return onSnapshot(locRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data() as TherapistLocation);
    } else {
      callback(null);
    }
  }, (err) => {
    console.warn('Therapist location subscription notice:', err);
  });
}

/**
 * Subscribes to all currently active therapist locations (for Supervisor Control Room).
 */
export function subscribeToActiveTherapistLocations(
  callback: (locs: TherapistLocation[]) => void
) {
  const q = query(
    collection(db, 'therapist_locations'),
    where('isTrackingActive', '==', true)
  );
  return onSnapshot(q, (snap) => {
    const locations = snap.docs.map((d) => d.data() as TherapistLocation);
    callback(locations);
  }, (err) => {
    console.warn('Active therapist locations subscription notice:', err);
  });
}

/**
 * Supervisor: Override Arrival Validation when GPS/accuracy has an issue.
 * Logs supervisor override note in audit trail.
 */
export async function supervisorOverrideArrival(
  booking: Booking,
  supervisorName: string,
  reason: string
): Promise<void> {
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date().toISOString();

  await updateDoc(ref, {
    status: 'Arrived',
    arrivedAt: now,
    updatedAt: now,
  });

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    'Arrived',
    'supervisor',
    supervisorName,
    `[OVERRIDE SUPERVISOR] Status kedatangan disetujui manual oleh Supervisor ${supervisorName}. Alasan: ${reason || 'Verifikasi manual lapangan'}`
  );

  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    therapistId: booking.therapistId,
    therapistName: booking.therapistName,
    action: 'override_arrival',
    actorRole: 'supervisor',
    actorName: supervisorName,
    oldValue: booking.status,
    newValue: 'Arrived',
    reason: reason || 'Verifikasi manual lapangan oleh Supervisor',
  });

  // Stop tracking
  await stopTherapistTracking(booking.id);
}

// ----------------- OPERATIONAL AUDIT LOGS -----------------

export async function addOperationalAuditLog(
  log: Omit<OperationalAuditLog, 'id' | 'timestamp' | 'formattedWIB'>
): Promise<void> {
  try {
    const now = new Date();
    const logId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fullLog: OperationalAuditLog = {
      ...log,
      id: logId,
      timestamp: now.toISOString(),
      formattedWIB: formatDateTimeWIB(now),
    };
    await setDoc(doc(db, 'operational_audit_logs', logId), cleanFirestoreData(fullLog));
  } catch (err) {
    console.warn('Failed to record operational audit log:', err);
  }
}

export function subscribeToOperationalAuditLogs(
  callback: (logs: OperationalAuditLog[]) => void,
  maxLogs: number = 50
) {
  const q = query(
    collection(db, 'operational_audit_logs'),
    orderBy('timestamp', 'desc'),
    limit(maxLogs)
  );

  return onSnapshot(
    q,
    (snap) => {
      const logs = snap.docs.map((d) => d.data() as OperationalAuditLog);
      callback(logs);
    },
    (err) => {
      console.warn('Operational audit logs listener error:', err);
    }
  );
}

/**
 * Supervisor: Reassign Therapist
 * Idempotent, updates both old and new therapist, resets tracking, records audit log and notifications.
 */
export async function supervisorReassignTherapist(
  booking: Booking,
  newTherapist: Therapist,
  supervisorName: string,
  reason: string,
  internalNote?: string
): Promise<void> {
  const isPaid = isPaymentPaid(booking.paymentStatus);
  if (!isPaid) {
    throw new Error('Booking belum lunas. Verifikasi pembayaran sebelum menugaskan terapis.');
  }

  const oldTherapistId = booking.therapistId;
  const oldTherapistName = booking.therapistName || 'Belum Ditugaskan';

  if (oldTherapistId === newTherapist.id) {
    return; // same therapist, no-op
  }

  const now = new Date().toISOString();
  const bookingRef = doc(db, 'bookings', booking.id);

  // If order was already in OTW or Accepted, reset to 'Therapist Assigned' so new therapist can review & accept
  const shouldResetToAssigned = ['Accepted', 'On The Way'].includes(booking.status);
  const nextStatus: BookingStatus = shouldResetToAssigned ? 'Therapist Assigned' : (booking.status === 'Confirmed' ? 'Therapist Assigned' : booking.status);

  // Stop tracking for previous therapist
  if (booking.id) {
    await stopTherapistTracking(booking.id).catch(() => {});
  }

  await updateDoc(bookingRef, {
    therapistId: newTherapist.id,
    therapistName: newTherapist.name,
    status: nextStatus,
    updatedAt: now,
    ...(internalNote ? { internalNotes: booking.internalNotes ? `${booking.internalNotes}\n[${formatDateTimeWIB(new Date())} - ${supervisorName}] ${internalNote}` : `[${formatDateTimeWIB(new Date())} - ${supervisorName}] ${internalNote}` } : {}),
  });

  // Set new therapist to on_duty
  try {
    const newThRef = doc(db, 'therapists', newTherapist.id);
    await updateDoc(newThRef, { status: 'on_duty' });
  } catch (e) {
    console.warn('Update new therapist status warning:', e);
  }

  // Set old therapist to available if no other active booking
  if (oldTherapistId) {
    try {
      const oldThRef = doc(db, 'therapists', oldTherapistId);
      await updateDoc(oldThRef, { status: 'available' });
    } catch (e) {
      console.warn('Update old therapist status warning:', e);
    }
  }

  // Log status history
  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    nextStatus,
    'supervisor',
    supervisorName,
    `[REASSIGNMENT] Terapis diganti dari ${oldTherapistName} ke ${newTherapist.name}. Alasan: ${reason}${internalNote ? ` (Catatan: ${internalNote})` : ''}`
  );

  // Record operational audit log
  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    therapistId: newTherapist.id,
    therapistName: newTherapist.name,
    action: 'reassign',
    actorRole: 'supervisor',
    actorName: supervisorName,
    oldValue: oldTherapistName,
    newValue: newTherapist.name,
    reason,
    note: internalNote,
  });

  // Notify new therapist
  emitEvent('therapist.assigned', {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    customerId: booking.customerId,
    customerName: booking.customerName,
    customerWhatsApp: booking.customerWhatsApp,
    customerEmail: booking.customerEmail,
    therapistId: newTherapist.id,
    therapistName: newTherapist.name,
    serviceName: booking.serviceName,
    scheduleAt: booking.scheduleAt,
    area: booking.area,
  }, { id: 'supervisor', role: 'supervisor' }).catch((e) => console.warn('Notification emit error:', e));
}

/**
 * Supervisor: Override Booking Status
 * Allows correcting status if therapist device failed or manual verification occurred.
 */
export async function supervisorOverrideStatus(
  booking: Booking,
  newStatus: BookingStatus,
  supervisorName: string,
  reason: string,
  internalNote?: string
): Promise<void> {
  const ref = doc(db, 'bookings', booking.id);
  const now = new Date().toISOString();

  const updatePayload: Record<string, any> = {
    status: newStatus,
    updatedAt: now,
  };

  if (newStatus === 'Arrived' && !booking.arrivedAt) {
    updatePayload.arrivedAt = now;
  }
  if (newStatus === 'Treatment' && !booking.treatmentStartedAt) {
    updatePayload.treatmentStartedAt = now;
  }
  if (newStatus === 'Completed') {
    updatePayload.completedAt = now;
  }
  if (internalNote) {
    updatePayload.internalNotes = booking.internalNotes
      ? `${booking.internalNotes}\n[${formatDateTimeWIB(new Date())} - ${supervisorName}] ${internalNote}`
      : `[${formatDateTimeWIB(new Date())} - ${supervisorName}] ${internalNote}`;
  }

  await updateDoc(ref, updatePayload);

  // If Completed or Cancelled, stop tracking and release therapist
  if (['Completed', 'Cancelled'].includes(newStatus)) {
    await stopTherapistTracking(booking.id).catch(() => {});
    if (booking.therapistId) {
      try {
        const thRef = doc(db, 'therapists', booking.therapistId);
        await updateDoc(thRef, { status: 'available' });
      } catch (err) {
        console.warn('Release therapist status warning:', err);
      }
    }
  }

  await addBookingStatusHistory(
    booking.id,
    booking.bookingCode,
    newStatus,
    'supervisor',
    supervisorName,
    `[STATUS OVERRIDE] Status diubah dari ${booking.status} menjadi ${newStatus}. Alasan: ${reason}${internalNote ? ` (Catatan: ${internalNote})` : ''}`
  );

  await addOperationalAuditLog({
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    therapistId: booking.therapistId,
    therapistName: booking.therapistName,
    action: 'override_status',
    actorRole: 'supervisor',
    actorName: supervisorName,
    oldValue: booking.status,
    newValue: newStatus,
    reason,
    note: internalNote,
  });
}

/**
 * Supervisor: Add Internal Operational Note to Booking
 */
export async function supervisorAddInternalNote(
  bookingId: string,
  bookingCode: string,
  noteText: string,
  supervisorName: string
): Promise<void> {
  const ref = doc(db, 'bookings', bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const current = snap.data() as Booking;

  const now = new Date();
  const noteEntry = `[${formatDateTimeWIB(now)} - ${supervisorName}]: ${noteText}`;
  const updatedNotes = current.internalNotes ? `${current.internalNotes}\n${noteEntry}` : noteEntry;

  await updateDoc(ref, {
    internalNotes: updatedNotes,
    updatedAt: now.toISOString(),
  });

  await addOperationalAuditLog({
    bookingId,
    bookingCode,
    action: 'internal_note',
    actorRole: 'supervisor',
    actorName: supervisorName,
    note: noteText,
  });
}

/**
 * Supervisor: Resolve Operational Issue Reported by Therapist
 */
export async function supervisorResolveIssue(
  bookingId: string,
  bookingCode: string,
  resolutionNote: string,
  supervisorName: string
): Promise<void> {
  const ref = doc(db, 'bookings', bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const booking = snap.data() as Booking;

  const now = new Date();
  const updatedIssue = {
    ...(booking.issueReport || { category: 'Operational', note: '' }),
    status: 'resolved',
    resolvedAt: now.toISOString(),
    resolvedBy: supervisorName,
    resolutionNote,
  };

  await updateDoc(ref, {
    issueReport: updatedIssue,
    updatedAt: now.toISOString(),
  });

  await addBookingStatusHistory(
    bookingId,
    bookingCode,
    booking.status,
    'supervisor',
    supervisorName,
    `[KENDALA DISELESAIKAN] Kendala lapangan diselesaikan oleh Supervisor ${supervisorName}. Solusi: ${resolutionNote}`
  );

  await addOperationalAuditLog({
    bookingId,
    bookingCode,
    action: 'resolve_issue',
    actorRole: 'supervisor',
    actorName: supervisorName,
    note: `Solusi: ${resolutionNote}`,
  });
}

/**
 * Supervisor: Update Therapist Shift Status (Available, Break, Off)
 */
export async function supervisorUpdateTherapistShiftStatus(
  therapistId: string,
  therapistName: string,
  newStatus: 'available' | 'on_duty' | 'off' | 'busy' | 'break',
  supervisorName: string,
  reason?: string
): Promise<void> {
  const thRef = doc(db, 'therapists', therapistId);
  await updateDoc(thRef, { status: newStatus });

  await addOperationalAuditLog({
    therapistId,
    therapistName,
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName: supervisorName,
    newValue: newStatus,
    reason: reason || `Status shift diubah ke ${newStatus}`,
  });
}
