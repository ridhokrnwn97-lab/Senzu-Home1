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
  note?: string,
  options?: { requestId?: string } | string
): Promise<void> {
  void updatedByRole;
  void updatedByName;

  const isValidHistoryId = (val: unknown, maxBytes = 128): val is string => {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    if (!trimmed || trimmed !== val) return false;
    if (trimmed === '.' || trimmed === '..') return false;
    if (new TextEncoder().encode(trimmed).length > maxBytes) return false;
    if (/[\/\\\x00-\x1F\x7F\s]/.test(trimmed)) return false;
    return true;
  };

  const ALLOWED_STATUSES = new Set<string>([
    'Draft',
    'Pending',
    'awaiting_payment',
    'Menunggu Pembayaran',
    'Menunggu Verifikasi Pembayaran',
    'Pembayaran Terverifikasi',
    'Menunggu Penjadwalan',
    'Terjadwal',
    'Confirmed',
    'Therapist Assigned',
    'Accepted',
    'On The Way',
    'Arrived',
    'Treatment',
    'Completed',
    'Cancelled',
    'Rescheduled',
    'Pembayaran Ditolak',
  ]);

  const INITIAL_GUEST_STATUSES = new Set<string>([
    'Menunggu Pembayaran',
    'awaiting_payment',
    'Draft',
    'Pending',
  ]);

  const ALLOWED_ROLES = new Set<string>([
    'customer',
    'css',
    'supervisor',
    'therapist',
    'system',
    'manager',
    'admin',
  ]);

  const rawBookingId = typeof bookingId === 'string' ? bookingId.trim() : '';
  if (!isValidHistoryId(rawBookingId, 128) || bookingId !== rawBookingId) return;

  const rawBookingCode = typeof bookingCode === 'string' ? bookingCode.trim() : '';
  if (
    !isValidHistoryId(rawBookingCode, 64) ||
    rawBookingCode.length < 3 ||
    bookingCode !== rawBookingCode
  ) {
    return;
  }

  const rawStatus = typeof status === 'string' ? status.trim() : '';
  if (!ALLOWED_STATUSES.has(rawStatus) || status !== rawStatus) return;

  if (
    note !== undefined &&
    note !== null &&
    (typeof note !== 'string' ||
      note.length > 1000 ||
      new TextEncoder().encode(note).length > 1000)
  ) {
    return;
  }
  const cleanNote =
    typeof note === 'string'
      ? note.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
      : '';

  const providedRequestId =
    typeof options === 'string'
      ? options
      : options && typeof options === 'object' && !Array.isArray(options)
      ? options.requestId
      : undefined;

  let requestId = '';
  if (providedRequestId !== undefined && providedRequestId !== null && providedRequestId !== '') {
    if (typeof providedRequestId !== 'string' || !isValidHistoryId(providedRequestId, 128)) {
      return;
    }
    requestId = providedRequestId;
  } else {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      requestId = `req_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
    } else if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      requestId = `req_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    } else {
      requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  const session = auth?.currentUser;
  if (session === null || session === undefined) {
    if (!INITIAL_GUEST_STATUSES.has(rawStatus)) {
      return;
    }

    const guestPayload = {
      bookingId: rawBookingId,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (auth?.currentUser !== null && auth?.currentUser !== undefined) return;

        let res: Response;
        try {
          res = await fetch('/api/booking-history/initial', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(guestPayload),
          });
        } catch (networkErr) {
          if (auth?.currentUser !== null && auth?.currentUser !== undefined) return;
          if (attempt === 0) continue;
          console.warn('Booking initial status history network notice:', networkErr);
          return;
        }

        if (auth?.currentUser !== null && auth?.currentUser !== undefined) return;

        let data: any = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }

        if (auth?.currentUser !== null && auth?.currentUser !== undefined) return;

        if ((res.status >= 500 && res.status <= 599) || res.status === 429) {
          if (attempt === 0) continue;
          console.warn('Booking initial status history service unavailable:', res.status);
          return;
        }

        if (!res.ok) {
          console.warn('Booking initial status history write rejected:', res.status);
          return;
        }

        const isValidAck =
          Boolean(data && typeof data === 'object' && !Array.isArray(data)) &&
          data.success === true;

        if (!isValidAck) {
          console.warn('Booking initial status history returned invalid response payload');
          return;
        }

        return;
      } catch (err) {
        if (attempt === 0 && (auth?.currentUser === null || auth?.currentUser === undefined)) {
          continue;
        }
        console.warn('Failed to initialize guest booking status history:', err);
        return;
      }
    }
    return;
  }

  const initialUid = typeof session?.uid === 'string' ? session.uid.trim() : '';
  if (
    !initialUid ||
    session.uid !== initialUid ||
    !isValidHistoryId(initialUid, 128) ||
    typeof session.getIdToken !== 'function'
  ) {
    return;
  }

  const payload = {
    bookingId: rawBookingId,
    bookingCode: rawBookingCode,
    status: rawStatus,
    ...(cleanNote ? { note: cleanNote } : {}),
    requestId,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return;
      const rawToken = await session.getIdToken();
      const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
      if (!idToken || !auth?.currentUser || auth.currentUser.uid !== initialUid) return;

      let res: Response;
      try {
        res = await fetch('/api/booking-history/append', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (networkErr) {
        if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return;
        if (attempt === 0) continue;
        console.warn('Booking status history network notice:', networkErr);
        return;
      }

      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return;

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return;

      if ((res.status >= 500 && res.status <= 599) || res.status === 429) {
        if (attempt === 0) continue;
        console.warn('Booking status history service unavailable:', res.status);
        return;
      }

      if (!res.ok) {
        console.warn('Booking status history write rejected:', res.status);
        return;
      }

      const historyEntry = data?.historyEntry || data?.history || data?.entry;
      const isDuplicateStatus = data?.isDuplicateStatus === true;
      const isValidResponse =
        Boolean(data && typeof data === 'object' && !Array.isArray(data)) &&
        data.success === true &&
        typeof data.id === 'string' &&
        isValidHistoryId(data.id, 128) &&
        Boolean(historyEntry && typeof historyEntry === 'object' && !Array.isArray(historyEntry)) &&
        historyEntry.id === data.id &&
        historyEntry.bookingId === rawBookingId &&
        historyEntry.bookingCode === rawBookingCode &&
        historyEntry.status === rawStatus &&
        typeof historyEntry.updatedByRole === 'string' &&
        ALLOWED_ROLES.has(historyEntry.updatedByRole) &&
        typeof historyEntry.updatedByName === 'string' &&
        historyEntry.updatedByName.trim().length > 0 &&
        (historyEntry.note === undefined ||
          (typeof historyEntry.note === 'string' && historyEntry.note.trim().length > 0)) &&
        typeof historyEntry.timestamp === 'string' &&
        !Number.isNaN(Date.parse(historyEntry.timestamp)) &&
        typeof historyEntry.formattedWIB === 'string' &&
        historyEntry.formattedWIB.trim().length > 0 &&
        (isDuplicateStatus ||
          historyEntry.actorUid === undefined ||
          historyEntry.actorUid === initialUid) &&
        (isDuplicateStatus ||
          historyEntry.actorId === undefined ||
          historyEntry.actorId === initialUid) &&
        (historyEntry.requestId === undefined ||
          historyEntry.requestId === requestId ||
          ((data.isIdempotent === true || isDuplicateStatus) &&
            isValidHistoryId(historyEntry.requestId, 128)));

      if (!isValidResponse) {
        console.warn('Booking status history returned invalid response payload');
        return;
      }

      return;
    } catch (historyErr) {
      console.warn('Booking status history write notice:', historyErr);
      return;
    }
  }
}

const BOOKING_READ_ALLOWED_STATUSES = new Set<string>([
  'Draft',
  'Pending',
  'awaiting_payment',
  'Menunggu Pembayaran',
  'Menunggu Verifikasi Pembayaran',
  'Pembayaran Terverifikasi',
  'Menunggu Penjadwalan',
  'Terjadwal',
  'Confirmed',
  'Therapist Assigned',
  'Accepted',
  'On The Way',
  'Arrived',
  'Treatment',
  'Completed',
  'Cancelled',
  'Rescheduled',
  'Pembayaran Ditolak',
]);

const BOOKING_READ_ALLOWED_ROLES = new Set<string>([
  'customer',
  'css',
  'supervisor',
  'therapist',
  'system',
  'manager',
  'admin',
]);

const CLIENT_GUEST_ALLOWED_BOOKING_FIELDS: ReadonlyArray<string> = [
  'id',
  'bookingCode',
  'status',
  'paymentStatus',
  'paymentMethod',
  'paymentDeadline',
  'serviceId',
  'serviceName',
  'packageName',
  'serviceDuration',
  'durationMinutes',
  'scheduleDate',
  'bookingDate',
  'scheduleTime',
  'timeSlot',
  'scheduleAt',
  'genderPreference',
  'therapistName',
  'totalAmount',
  'totalPrice',
  'servicePrice',
  'homeServiceFee',
  'discountAmount',
  'area',
  'customerName',
  'customerWhatsApp',
  'address',
  'createdAt',
  'updatedAt',
];

const CLIENT_OWNER_ALLOWED_BOOKING_FIELDS: ReadonlyArray<string> = [
  'id',
  'bookingCode',
  'customerId',
  'customerAuthUid',
  'authUserId',
  'customerName',
  'customerWhatsApp',
  'customerEmail',
  'serviceId',
  'serviceName',
  'packageName',
  'serviceDuration',
  'durationMinutes',
  'serviceNameSnapshot',
  'durationMinutesSnapshot',
  'servicePriceSnapshot',
  'homeServiceFeeSnapshot',
  'areaIdSnapshot',
  'areaNameSnapshot',
  'therapistId',
  'assignedTherapistId',
  'therapistName',
  'assignedTherapistName',
  'preferredTherapistName',
  'scheduleDate',
  'bookingDate',
  'scheduleTime',
  'timeSlot',
  'scheduleAt',
  'genderPreference',
  'customerGender',
  'address',
  'customerAddress',
  'latitude',
  'longitude',
  'customerLat',
  'customerLng',
  'placeId',
  'area',
  'areaName',
  'customerArea',
  'addressDistrict',
  'addressNotes',
  'distanceKm',
  'distanceMeters',
  'homeServiceFeeTier',
  'baseLocationId',
  'baseLocationName',
  'baseLatitude',
  'baseLongitude',
  'servicePrice',
  'homeServiceFee',
  'discountAmount',
  'voucherId',
  'voucherCode',
  'voucherDiscount',
  'promoId',
  'promoCode',
  'promoCodeSnapshot',
  'promoNameSnapshot',
  'discountTypeSnapshot',
  'discountValueSnapshot',
  'promoDiscount',
  'pointsRedeemed',
  'pointsDiscount',
  'pointsEarned',
  'membershipTierAtBooking',
  'totalAmount',
  'totalPrice',
  'price',
  'paymentMethod',
  'paymentStatus',
  'status',
  'customerNotes',
  'notes',
  'branchId',
  'branchName',
  'assignedAt',
  'paymentDeadline',
  'paymentPolicyVersion',
  'paymentExpiredAt',
  'paymentVerifiedAt',
  'confirmedAt',
  'cancellationReason',
  'acceptedAt',
  'onTheWayAt',
  'arrivedAt',
  'treatmentStartedAt',
  'completedAt',
  'createdAt',
  'updatedAt',
];

const CLIENT_THERAPIST_ALLOWED_BOOKING_FIELDS: ReadonlyArray<string> = [
  ...CLIENT_OWNER_ALLOWED_BOOKING_FIELDS,
  'acceptedBy',
  'arrivalLatitude',
  'arrivalLongitude',
  'earlyCompletion',
];

const CLIENT_STAFF_ALLOWED_BOOKING_FIELDS: ReadonlyArray<string> = [
  ...CLIENT_THERAPIST_ALLOWED_BOOKING_FIELDS,
  'internalNotes',
  'requiresAdminConfirmation',
  'isReassigned',
  'reassignedFromTherapistId',
  'referredByCustomerId',
  'referralCodeUsed',
  'issueReport',
];

function isValidReadDocId(value: unknown, maxLen = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maxLen &&
    value.trim() === value &&
    !value.includes('/') &&
    !/[\x00-\x1F\x7F\s]/.test(value)
  );
}

function isValidReadBookingCode(value: unknown, maxLen = 64): value is string {
  return (
    isValidReadDocId(value, maxLen) &&
    value.length >= 3 &&
    !/^bk_/i.test(value) &&
    /^[A-Z0-9_-]+$/.test(value)
  );
}

function normalizeTrackingPhoneInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 30) return '';
  if (!/^\+?[0-9][0-9\s\-]{6,28}[0-9]$/.test(trimmed)) return '';
  if (/--/.test(trimmed)) return '';
  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/^\+/, '').replace(/[\s\-]/g, '');
  if (!/^[0-9]{8,20}$/.test(digits)) return '';
  if (hasLeadingPlus) {
    if (digits.startsWith('0')) return '';
    return digits;
  }
  if (digits.startsWith('00')) return '';
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits;
}

function getClientGuestGenericActorLabel(role: string): string {
  switch (role) {
    case 'customer':
      return 'Pelanggan';
    case 'therapist':
      return 'Terapis Senzu';
    case 'css':
      return 'Petugas CSS';
    case 'supervisor':
      return 'Supervisor Senzu';
    case 'manager':
    case 'admin':
      return 'Manajemen Senzu';
    default:
      return 'Sistem Senzu';
  }
}

function sanitizeBookingForClientAccess(
  rawBooking: unknown,
  accessLevel: 'staff' | 'therapist' | 'owner' | 'guest',
  expectedUid?: string
): Booking | null {
  if (!rawBooking || typeof rawBooking !== 'object' || Array.isArray(rawBooking)) {
    return null;
  }
  const b = rawBooking as Record<string, any>;
  const id = typeof b.id === 'string' ? b.id.trim() : '';
  const bookingCode = typeof b.bookingCode === 'string' ? b.bookingCode.trim().toUpperCase() : '';
  if (!isValidReadDocId(id, 128) || !isValidReadBookingCode(bookingCode, 64)) {
    return null;
  }

  if (accessLevel === 'owner') {
    if (!expectedUid || !isValidReadDocId(expectedUid, 128)) return null;
    for (const rawOwner of [b.customerAuthUid, b.authUserId, b.customerUid, b.userId, b.uid]) {
      if (rawOwner !== undefined && rawOwner !== null && rawOwner !== '') {
        if (typeof rawOwner !== 'string' || rawOwner.trim() !== expectedUid) {
          return null;
        }
      }
    }
    const custAuthUid = typeof b.customerAuthUid === 'string' ? b.customerAuthUid.trim() : '';
    const authUserId = typeof b.authUserId === 'string' ? b.authUserId.trim() : '';
    if (custAuthUid !== expectedUid && authUserId !== expectedUid) {
      return null;
    }
  }

  const allowedKeys =
    accessLevel === 'guest'
      ? CLIENT_GUEST_ALLOWED_BOOKING_FIELDS
      : accessLevel === 'owner'
      ? CLIENT_OWNER_ALLOWED_BOOKING_FIELDS
      : accessLevel === 'therapist'
      ? CLIENT_THERAPIST_ALLOWED_BOOKING_FIELDS
      : CLIENT_STAFF_ALLOWED_BOOKING_FIELDS;

  const projected: Record<string, any> = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(b, key) && b[key] !== undefined) {
      projected[key] = b[key];
    }
  }
  projected.id = id;
  projected.bookingCode = bookingCode;
  return projected as Booking;
}

function sanitizeAndDeduplicateHistoryEntries(
  rawList: unknown,
  expectedBookingId?: string,
  expectedBookingCode?: string,
  accessLevel?: 'staff' | 'therapist' | 'owner' | 'guest'
): BookingStatusHistory[] {
  if (!Array.isArray(rawList)) return [];
  const validEntries: BookingStatusHistory[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const h = item as Record<string, unknown>;
    const id = typeof h.id === 'string' ? h.id.trim() : '';
    const bookingId = typeof h.bookingId === 'string' ? h.bookingId.trim() : '';
    const bookingCode =
      typeof h.bookingCode === 'string' ? h.bookingCode.trim().toUpperCase() : '';
    const status = typeof h.status === 'string' ? h.status.trim() : '';
    const updatedByRole = typeof h.updatedByRole === 'string' ? h.updatedByRole.trim() : '';
    const rawUpdatedByName =
      typeof h.updatedByName === 'string'
        ? h.updatedByName.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
        : '';
    const timestamp = typeof h.timestamp === 'string' ? h.timestamp.trim() : '';
    const formattedWIB =
      typeof h.formattedWIB === 'string' && h.formattedWIB.trim().length > 0
        ? h.formattedWIB.trim()
        : formatDateTimeWIB(timestamp);
    const rawNote =
      typeof h.note === 'string'
        ? h.note.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
        : '';

    if (!isValidReadDocId(id, 128)) continue;
    if (
      (h.bookingId !== undefined &&
        h.bookingId !== null &&
        h.bookingId !== '' &&
        (!bookingId || (expectedBookingId && bookingId !== expectedBookingId))) ||
      (h.bookingCode !== undefined &&
        h.bookingCode !== null &&
        h.bookingCode !== '' &&
        (!bookingCode || (expectedBookingCode && bookingCode !== expectedBookingCode)))
    ) {
      return [];
    }
    if (!status || !BOOKING_READ_ALLOWED_STATUSES.has(status)) continue;
    const cleanRole = BOOKING_READ_ALLOWED_ROLES.has(updatedByRole) ? updatedByRole : 'system';
    const updatedByName =
      accessLevel === 'guest'
        ? getClientGuestGenericActorLabel(cleanRole)
        : rawUpdatedByName || 'Sistem Senzu';
    const note = accessLevel === 'guest' ? '' : rawNote;
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) continue;

    validEntries.push({
      id,
      bookingId: bookingId || expectedBookingId || '',
      bookingCode: bookingCode || expectedBookingCode || '',
      status: status as BookingStatus,
      ...(note ? { note } : {}),
      updatedByRole: cleanRole as BookingStatusHistory['updatedByRole'],
      updatedByName,
      timestamp,
      formattedWIB,
    });
  }

  validEntries.sort((a, b) => {
    const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const deduplicated: BookingStatusHistory[] = [];
  for (const entry of validEntries) {
    if (
      deduplicated.length === 0 ||
      deduplicated[deduplicated.length - 1].status !== entry.status
    ) {
      deduplicated.push(entry);
    }
  }
  return deduplicated;
}

export async function getBookingStatusHistory(
  bookingCode: string,
  options?: { bookingId?: string; phone?: string; signal?: AbortSignal }
): Promise<BookingStatusHistory[]> {
  try {
    if (typeof bookingCode !== 'string') return [];
    const trimmedTarget = bookingCode.trim();
    if (!trimmedTarget || bookingCode !== trimmedTarget || !isValidReadDocId(trimmedTarget, 128)) {
      return [];
    }

    let explicitBookingId = '';
    if (options?.bookingId !== undefined && options?.bookingId !== null && options?.bookingId !== '') {
      if (
        typeof options.bookingId !== 'string' ||
        options.bookingId.trim() !== options.bookingId ||
        !isValidReadDocId(options.bookingId, 128)
      ) {
        return [];
      }
      explicitBookingId = options.bookingId;
    }

    const cleanPhone =
      options?.phone !== undefined && options?.phone !== null && options?.phone !== ''
        ? normalizeTrackingPhoneInput(options.phone)
        : '';
    if (options?.phone !== undefined && options?.phone !== null && options?.phone !== '' && !cleanPhone) {
      return [];
    }

    const session = auth?.currentUser;
    if (session === null || session === undefined) {
      // Unauthenticated history reads require a valid bookingCode + verified phone via /api/bookings/track
      if (!cleanPhone || explicitBookingId || /^bk_/i.test(trimmedTarget)) {
        return [];
      }
      const upperGuestCode = trimmedTarget.toUpperCase();
      if (!isValidReadBookingCode(upperGuestCode, 64)) {
        return [];
      }
      const tracked = await trackBookingByCodeAndPhone(upperGuestCode, cleanPhone, {
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (auth?.currentUser !== null && auth?.currentUser !== undefined) return [];
      return tracked && tracked.accessLevel === 'guest' ? tracked.history : [];
    }

    const initialUid = typeof session?.uid === 'string' ? session.uid.trim() : '';
    if (
      !initialUid ||
      session.uid !== initialUid ||
      !isValidReadDocId(initialUid, 128) ||
      typeof session.getIdToken !== 'function'
    ) {
      return [];
    }

    let requestBookingId = explicitBookingId;
    let requestBookingCode = '';
    let requestSingleTarget = '';

    if (trimmedTarget.startsWith('bk_')) {
      if (requestBookingId && requestBookingId !== trimmedTarget) return [];
      requestBookingId = trimmedTarget;
      const derivedCode = trimmedTarget.slice(3).toUpperCase();
      if (isValidReadBookingCode(derivedCode, 64)) {
        requestBookingCode = derivedCode;
      }
    } else if (requestBookingId) {
      if (trimmedTarget === requestBookingId) {
        if (requestBookingId.startsWith('bk_')) {
          const derivedCode = requestBookingId.slice(3).toUpperCase();
          if (isValidReadBookingCode(derivedCode, 64)) {
            requestBookingCode = derivedCode;
          }
        }
      } else {
        const upperCode = trimmedTarget.toUpperCase();
        if (!isValidReadBookingCode(upperCode, 64)) return [];
        if (
          requestBookingId.startsWith('bk_') &&
          requestBookingId.slice(3).toUpperCase() !== upperCode
        ) {
          return [];
        }
        requestBookingCode = upperCode;
      }
    } else {
      // Single reference from authenticated caller: may be a bookingCode or arbitrary non-bk_ document ID
      requestSingleTarget = trimmedTarget;
    }

    const rawToken = await session.getIdToken();
    const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!idToken || !auth?.currentUser || auth.currentUser.uid !== initialUid) return [];

    const res = await fetch('/api/booking-history/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        ...(requestBookingId ? { bookingId: requestBookingId } : {}),
        ...(requestBookingCode ? { bookingCode: requestBookingCode } : {}),
        ...(requestSingleTarget ? { target: requestSingleTarget } : {}),
        ...(cleanPhone ? { phone: cleanPhone } : {}),
      }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return [];
    if (!res.ok) return [];

    const data = await res.json().catch(() => null);
    if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return [];
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
      return [];
    }

    const accessLevel =
      data.accessLevel === 'staff' ||
      data.accessLevel === 'therapist' ||
      data.accessLevel === 'owner'
        ? data.accessLevel
        : undefined;
    if (!accessLevel) return [];

    const resolvedId = typeof data.bookingId === 'string' ? data.bookingId.trim() : '';
    const resolvedCode =
      typeof data.bookingCode === 'string' ? data.bookingCode.trim().toUpperCase() : '';
    if (!isValidReadDocId(resolvedId, 128) || !isValidReadBookingCode(resolvedCode, 64)) {
      return [];
    }
    if (requestBookingId && resolvedId !== requestBookingId) return [];
    if (requestBookingCode && resolvedCode !== requestBookingCode) return [];
    if (
      requestSingleTarget &&
      resolvedId !== requestSingleTarget &&
      resolvedId !== `bk_${requestSingleTarget.toUpperCase()}` &&
      resolvedCode !== requestSingleTarget.toUpperCase()
    ) {
      return [];
    }

    return sanitizeAndDeduplicateHistoryEntries(
      data.history,
      resolvedId,
      resolvedCode,
      accessLevel
    );
  } catch {
    return [];
  }
}

// ----------------- BOOKINGS CRUD -----------------

export async function createBooking(
  data: Omit<Booking, 'id' | 'bookingCode' | 'createdAt' | 'updatedAt' | 'status' | 'paymentStatus'> & {
    checkoutAttemptId?: string;
    customerVoucherId?: string;
    voucherRecoveryOnly?: boolean;
  }
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

  // Detect any voucher or promo intent on the booking request
  const rawPromoCode = typeof data.promoCode === 'string' ? data.promoCode.trim().toUpperCase() : '';
  const rawVoucherCode = typeof data.voucherCode === 'string' ? data.voucherCode.trim().toUpperCase() : '';
  const rawPromoSnapshot = typeof data.promoCodeSnapshot === 'string' ? data.promoCodeSnapshot.trim().toUpperCase() : '';
  const rawPromoId = typeof data.promoId === 'string' ? data.promoId.trim() : '';
  const rawVoucherId = typeof data.voucherId === 'string' ? data.voucherId.trim() : '';
  const rawCustomerVoucherId = typeof data.customerVoucherId === 'string' ? data.customerVoucherId.trim() : '';
  const assertedDiscount = typeof data.discountAmount === 'number' && Number.isFinite(data.discountAmount)
    ? Math.max(0, data.discountAmount) : 0;
  const allowedNoVoucherDiscount = assertedDiscount;
  const hasVoucherDiscountNum =
    (typeof data.voucherDiscount === 'number' && data.voucherDiscount !== 0) ||
    (typeof data.promoDiscount === 'number' && data.promoDiscount !== 0) ||
    (typeof data.discountValueSnapshot === 'number' && data.discountValueSnapshot !== 0) ||
    Boolean(typeof data.discountTypeSnapshot === 'string' && data.discountTypeSnapshot.trim()) ||
    Boolean(typeof data.promoNameSnapshot === 'string' && data.promoNameSnapshot.trim());

  const hasVoucherIntent = Boolean(
    rawPromoCode ||
    rawVoucherCode ||
    rawPromoSnapshot ||
    rawPromoId ||
    rawVoucherId ||
    rawCustomerVoucherId ||
    (typeof data.checkoutAttemptId === 'string' && data.checkoutAttemptId.trim()) ||
    hasVoucherDiscountNum
  );

  const hasPointsIntent = (data.pointsRedeemed != null && data.pointsRedeemed !== 0)
    || (data.pointsDiscount != null && data.pointsDiscount !== 0);
  // Both voucher and points consumption require the same authenticated atomic server checkout.
  if (hasVoucherIntent || hasPointsIntent) {
    const currentUser = auth?.currentUser;
    const initialUid = typeof currentUser?.uid === 'string' ? currentUser.uid.trim() : '';
    if (!currentUser || !initialUid || typeof currentUser.getIdToken !== 'function') {
      throw Object.assign(
        new Error('Silakan login ke akun pelanggan terlebih dahulu untuk menggunakan voucher promo.'),
        { code: 'AUTH_REQUIRED' }
      );
    }

    if (
      (data.customerAuthUid !== undefined &&
        data.customerAuthUid !== null &&
        String(data.customerAuthUid).trim() !== '' &&
        String(data.customerAuthUid).trim() !== initialUid) ||
      (data.authUserId !== undefined &&
        data.authUserId !== null &&
        String(data.authUserId).trim() !== '' &&
        String(data.authUserId).trim() !== initialUid)
    ) {
      throw Object.assign(new Error('Sesi login tidak sesuai dengan identitas pemesanan.'), {
        code: 'SESSION_CHANGED',
      });
    }

    let checkoutAttemptId = '';
    if (data.checkoutAttemptId !== undefined) {
      checkoutAttemptId = typeof data.checkoutAttemptId === 'string' ? data.checkoutAttemptId.trim() : '';
      if (!checkoutAttemptId || !/^[A-Za-z0-9_-]{8,128}$/.test(checkoutAttemptId)) {
        throw Object.assign(new Error('ID percobaan checkout voucher tidak valid.'), {
          code: 'INVALID_CHECKOUT_ATTEMPT_ID',
        });
      }
    } else {
      checkoutAttemptId = `chk_${globalThis.crypto.randomUUID()}`;
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
      throw Object.assign(new Error('Sesi pengguna berubah sebelum checkout voucher dikirim.'), {
        code: 'SESSION_CHANGED',
      });
    }

    let res: Response;
    // A tab-scoped draft contains no token or payment proof. It permits read-only recovery after a lost response.
    try {
      if (!data.voucherRecoveryOnly) globalThis.sessionStorage?.setItem(`senzu:voucher-checkout:${initialUid}`, JSON.stringify({
        uid: initialUid, checkoutAttemptId, draft: { ...data, checkoutAttemptId },
      }));
    } catch {}
    try {
      res = await fetch('/api/vouchers/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          checkoutAttemptId,
          recoverOnly: data.voucherRecoveryOnly === true,
          customerId: data.customerId,
          customerAuthUid: initialUid,
          authUserId: initialUid,
          customerName: data.customerName,
          customerWhatsApp: data.customerWhatsApp,
          customerEmail: data.customerEmail,
          serviceId: data.serviceId,
          serviceName: data.serviceName,
          serviceDuration: data.serviceDuration,
          scheduleDate: data.scheduleDate,
          scheduleTime: data.scheduleTime,
          scheduleAt: data.scheduleAt || `${data.scheduleDate} ${data.scheduleTime}`,
          genderPreference: data.genderPreference,
          customerGender: data.customerGender,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
          placeId: data.placeId,
          addressNotes: data.addressNotes,
          distanceKm: finalDistanceKm,
          distanceMeters: finalDistanceMeters,
          requiresAdminConfirmation,
          area: data.area,
          areaIdSnapshot: data.areaIdSnapshot,
          areaNameSnapshot: data.areaNameSnapshot ?? data.area,
          servicePrice: data.servicePrice,
          homeServiceFee: finalFee,
          promoId: rawPromoId || undefined,
          promoCode: rawPromoCode || undefined,
          promoCodeSnapshot: rawPromoSnapshot || rawPromoCode || undefined,
          promoNameSnapshot: data.promoNameSnapshot,
          discountTypeSnapshot: data.discountTypeSnapshot,
          discountValueSnapshot: data.discountValueSnapshot,
          voucherId: rawVoucherId || undefined,
          voucherCode: rawVoucherCode || undefined,
          customerVoucherId: rawCustomerVoucherId || (rawVoucherId.startsWith('cv_') ? rawVoucherId : undefined),
          voucherDiscount: data.voucherDiscount,
          promoDiscount: data.promoDiscount,
          discountAmount: data.discountAmount,
          pointsRedeemed: data.pointsRedeemed,
          pointsDiscount: data.pointsDiscount,
          pointsEarned: data.pointsEarned,
          referredByCustomerId: data.referredByCustomerId,
          referralCodeUsed: data.referralCodeUsed,
          membershipTierAtBooking: data.membershipTierAtBooking,
          totalAmount: data.totalAmount,
          paymentMethod: data.paymentMethod,
          customerNotes: data.customerNotes,
        }),
      });
    } catch {
      throw Object.assign(new Error('Gagal menghubungi server checkout voucher. Silakan coba kembali.'), {
        code: 'NETWORK_ERROR',
      });
    }

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      throw Object.assign(new Error('Respons server checkout voucher tidak valid.'), {
        code: 'MALFORMED_RESPONSE',
        status: res?.status,
      });
    }

    const activeUserAfterFetch = auth?.currentUser;
    if (!activeUserAfterFetch || activeUserAfterFetch.uid !== initialUid) {
      throw Object.assign(new Error('Sesi pengguna berubah saat memproses checkout voucher.'), {
        code: 'SESSION_CHANGED',
      });
    }

    if (
      !res.ok ||
      !payload ||
      payload.success !== true ||
      !payload.booking ||
      typeof payload.booking.id !== 'string' ||
      !payload.booking.id.trim() ||
      typeof payload.redemptionId !== 'string' ||
      !payload.redemptionId.trim()
    ) {
      const errCode =
        typeof payload?.code === 'string' && payload.code
          ? payload.code
          : !res.ok
            ? `HTTP_${res.status}`
            : 'VOUCHER_CHECKOUT_FAILED';
      const errMsg =
        typeof payload?.error === 'string' && payload.error
          ? payload.error
          : typeof payload?.message === 'string' && payload.message
            ? payload.message
            : 'Checkout voucher ditolak oleh server.';
      throw Object.assign(new Error(errMsg), {
        code: errCode,
        status: res.status,
        pricingBreakdown: payload?.pricingBreakdown,
      });
    }

    const committedBooking: Booking = { ...(payload.booking as Booking) };

    const assertCurrentCheckoutUser = () => {
      if (auth?.currentUser?.uid !== initialUid) {
        throw Object.assign(new Error('Sesi pengguna berubah saat menyelesaikan checkout voucher.'), { code: 'SESSION_CHANGED' });
      }
    };
    assertCurrentCheckoutUser();

    try {
      const pMethod = (committedBooking.paymentMethod || '').toLowerCase();
      const methodType = pMethod.includes('qris')
        ? 'qris'
        : pMethod.includes('mandiri')
        ? 'mandiri'
        : pMethod.includes('bri')
        ? 'bri'
        : 'bni';
      const payment = await createPaymentRecord(committedBooking, { methodType: methodType as any });
      committedBooking.paymentDeadline = payment.paymentDeadline || undefined;
    } catch (err) {
      console.warn('Payment record initialization non-blocking warning:', err);
    }

    assertCurrentCheckoutUser();
    if (!data.voucherRecoveryOnly) {
      try { globalThis.sessionStorage?.removeItem(`senzu:voucher-checkout:${initialUid}`); } catch {}
    }
    return committedBooking;
  }

  // No-voucher booking branch
  const bookingCode = generateBookingCode();
  const docId = `bk_${bookingCode}`;
  // Display timestamp only. Payment authority uses Firestore document createTime.
  const now = new Date().toISOString();

  const finalTotalAmount = Math.max(0, data.servicePrice + finalFee - allowedNoVoucherDiscount);

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
    promoId: undefined,
    promoCode: undefined,
    promoCodeSnapshot: undefined,
    promoNameSnapshot: undefined,
    discountTypeSnapshot: undefined,
    discountValueSnapshot: undefined,
    voucherId: undefined,
    voucherCode: undefined,
    voucherDiscount: 0,
    promoDiscount: 0,
    discountAmount: allowedNoVoucherDiscount,
    totalAmount: finalTotalAmount,
    requiresAdminConfirmation,
    status: 'Menunggu Pembayaran',
    paymentStatus: 'UNPAID',
    // Server-authoritative / authenticated identity: never trust client body ownership overrides
    customerAuthUid: auth?.currentUser?.uid || undefined,
    authUserId: auth?.currentUser?.uid || undefined,
    paymentPolicyVersion: 2,
    paymentDeadline: null,
    createdAt: now,
    updatedAt: now,
  };

  delete (newBooking as any).checkoutAttemptId;
  delete (newBooking as any).customerVoucherId;

  await setDoc(doc(db, 'bookings', docId), cleanFirestoreData(newBooking));

  // Initial history entry
  await addBookingStatusHistory(
    docId,
    bookingCode,
    'Menunggu Pembayaran',
    'customer',
    data.customerName,
    `Booking diajukan oleh customer melalui portal Senzu Home. Metode bayar: ${data.paymentMethod}`
  ).catch(() => {});

  // CRM Update
  await upsertCustomerCRM(newBooking).catch(() => {});

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
  phoneInput: string,
  options?: {
    bookingId?: string;
    signal?: AbortSignal;
    onError?: (err: { status: number; code: string; message: string }) => void;
  }
): Promise<{
  booking: Booking;
  history: BookingStatusHistory[];
  accessLevel?: 'staff' | 'therapist' | 'owner' | 'guest';
} | null> {
  if (typeof bookingCode !== 'string' || typeof phoneInput !== 'string') {
    return null;
  }
  const trimmedCode = bookingCode.trim();
  if (!trimmedCode || bookingCode !== trimmedCode || /^bk_/i.test(trimmedCode)) {
    options?.onError?.({
      status: 400,
      code: 'INVALID_BOOKING_CODE',
      message: 'Kode booking tidak valid.',
    });
    return null;
  }
  const cleanCode = trimmedCode.toUpperCase();
  const cleanPhoneInput = normalizeTrackingPhoneInput(phoneInput);

  // Enforce valid bookingCode and canonical WhatsApp phone number
  if (!isValidReadBookingCode(cleanCode, 64)) {
    options?.onError?.({
      status: 400,
      code: 'INVALID_BOOKING_CODE',
      message: 'Kode booking tidak valid.',
    });
    return null;
  }
  if (!cleanPhoneInput) {
    options?.onError?.({
      status: 400,
      code: 'INVALID_PHONE',
      message: 'Nomor WhatsApp tidak valid.',
    });
    return null;
  }

  let targetBookingId = '';
  if (options?.bookingId !== undefined && options?.bookingId !== null && options?.bookingId !== '') {
    if (
      typeof options.bookingId !== 'string' ||
      options.bookingId.trim() !== options.bookingId ||
      !isValidReadDocId(options.bookingId, 128)
    ) {
      return null;
    }
    targetBookingId = options.bookingId;
  }

  try {
    const session = auth?.currentUser;
    let initialUid = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (session !== null && session !== undefined) {
      initialUid = typeof session.uid === 'string' ? session.uid.trim() : '';
      if (
        !initialUid ||
        session.uid !== initialUid ||
        !isValidReadDocId(initialUid, 128) ||
        typeof session.getIdToken !== 'function'
      ) {
        return null;
      }
      const rawToken = await session.getIdToken();
      const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
      if (!idToken || !auth?.currentUser || auth.currentUser.uid !== initialUid) {
        return null;
      }
      headers.Authorization = `Bearer ${idToken}`;
    } else if (targetBookingId) {
      // Unauthenticated guest tracking must never send bookingId
      return null;
    }

    const res = await fetch('/api/bookings/track', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bookingCode: cleanCode,
        phone: cleanPhoneInput,
        ...(initialUid && targetBookingId ? { bookingId: targetBookingId } : {}),
      }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (initialUid) {
      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return null;
    } else {
      if (auth?.currentUser !== null && auth?.currentUser !== undefined) return null;
    }

    const data = await res.json().catch(() => null);

    if (initialUid) {
      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return null;
    } else {
      if (auth?.currentUser !== null && auth?.currentUser !== undefined) return null;
    }

    if (!res.ok) {
      options?.onError?.({
        status: res.status,
        code: typeof data?.code === 'string' ? data.code : 'TRACK_REJECTED',
        message:
          typeof data?.message === 'string' && data.message.trim()
            ? data.message.trim()
            : typeof data?.error === 'string' && data.error.trim()
            ? data.error.trim()
            : 'Data reservasi tidak ditemukan. Pastikan Kode Booking dan Nomor WhatsApp sesuai.',
      });
      return null;
    }

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      data.success !== true ||
      !data.booking ||
      typeof data.booking !== 'object' ||
      Array.isArray(data.booking)
    ) {
      return null;
    }

    const accessLevel: 'staff' | 'therapist' | 'owner' | 'guest' | undefined =
      data.accessLevel === 'staff' ||
      data.accessLevel === 'therapist' ||
      data.accessLevel === 'owner' ||
      data.accessLevel === 'guest'
        ? data.accessLevel
        : undefined;

    if (!accessLevel) return null;
    if (!initialUid && accessLevel !== 'guest') return null;
    if (initialUid && accessLevel === 'guest') return null;

    const sanitizedBooking = sanitizeBookingForClientAccess(
      data.booking,
      accessLevel,
      initialUid || undefined
    );
    if (
      !sanitizedBooking ||
      sanitizedBooking.bookingCode !== cleanCode ||
      (targetBookingId && sanitizedBooking.id !== targetBookingId)
    ) {
      return null;
    }

    const history = sanitizeAndDeduplicateHistoryEntries(
      data.history,
      sanitizedBooking.id,
      cleanCode,
      accessLevel
    );

    return {
      booking: sanitizedBooking,
      history,
      accessLevel,
    };
  } catch {
    return null;
  }
}

export async function getBookingByCode(
  bookingCode: string,
  options?: { bookingId?: string; phone?: string; signal?: AbortSignal }
): Promise<Booking | null> {
  try {
    if (typeof bookingCode !== 'string') return null;
    const trimmed = bookingCode.trim();
    if (!trimmed || bookingCode !== trimmed || !isValidReadDocId(trimmed, 128)) return null;

    let targetBookingId = '';
    if (options?.bookingId !== undefined && options?.bookingId !== null && options?.bookingId !== '') {
      if (
        typeof options.bookingId !== 'string' ||
        options.bookingId.trim() !== options.bookingId ||
        !isValidReadDocId(options.bookingId, 128)
      ) {
        return null;
      }
      targetBookingId = options.bookingId;
    }

    const cleanPhone =
      options?.phone !== undefined && options?.phone !== null && options?.phone !== ''
        ? normalizeTrackingPhoneInput(options.phone)
        : '';
    if (options?.phone !== undefined && options?.phone !== null && options?.phone !== '' && !cleanPhone) {
      return null;
    }

    const session = auth?.currentUser;
    if (session === null || session === undefined) {
      if (!cleanPhone || targetBookingId || /^bk_/i.test(trimmed)) {
        return null;
      }
      const cleanCode = trimmed.toUpperCase();
      if (!isValidReadBookingCode(cleanCode, 64)) return null;
      const tracked = await trackBookingByCodeAndPhone(cleanCode, cleanPhone, {
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (auth?.currentUser !== null && auth?.currentUser !== undefined) return null;
      return tracked?.booking ?? null;
    }

    const initialUid = typeof session.uid === 'string' ? session.uid.trim() : '';
    if (
      !initialUid ||
      session.uid !== initialUid ||
      !isValidReadDocId(initialUid, 128) ||
      typeof session.getIdToken !== 'function'
    ) {
      return null;
    }

    let requestBookingId = targetBookingId;
    let requestBookingCode = '';
    let requestSingleTarget = '';

    if (trimmed.startsWith('bk_')) {
      if (requestBookingId && requestBookingId !== trimmed) return null;
      requestBookingId = trimmed;
      const derived = trimmed.slice(3).toUpperCase();
      if (isValidReadBookingCode(derived, 64)) {
        requestBookingCode = derived;
      }
    } else if (requestBookingId) {
      if (trimmed === requestBookingId) {
        if (requestBookingId.startsWith('bk_')) {
          const derived = requestBookingId.slice(3).toUpperCase();
          if (isValidReadBookingCode(derived, 64)) {
            requestBookingCode = derived;
          }
        }
      } else {
        const cleanCode = trimmed.toUpperCase();
        if (!isValidReadBookingCode(cleanCode, 64)) return null;
        if (
          requestBookingId.startsWith('bk_') &&
          requestBookingId.slice(3).toUpperCase() !== cleanCode
        ) {
          return null;
        }
        requestBookingCode = cleanCode;
      }
    } else {
      const cleanCode = trimmed.toUpperCase();
      if (isValidReadBookingCode(cleanCode, 64)) {
        requestBookingCode = cleanCode;
      } else {
        requestSingleTarget = trimmed;
      }
    }

    const rawToken = await session.getIdToken();
    const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!idToken || !auth?.currentUser || auth.currentUser.uid !== initialUid) return null;

    const res = await fetch('/api/bookings/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        ...(requestBookingId ? { bookingId: requestBookingId } : {}),
        ...(requestBookingCode ? { bookingCode: requestBookingCode } : {}),
        ...(requestSingleTarget ? { target: requestSingleTarget } : {}),
        ...(cleanPhone ? { phone: cleanPhone } : {}),
      }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return null;
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!auth?.currentUser || auth.currentUser.uid !== initialUid) return null;
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      data.success !== true ||
      !data.booking ||
      typeof data.booking !== 'object' ||
      Array.isArray(data.booking)
    ) {
      return null;
    }

    const accessLevel =
      data.accessLevel === 'staff' ||
      data.accessLevel === 'therapist' ||
      data.accessLevel === 'owner'
        ? data.accessLevel
        : undefined;
    if (!accessLevel) return null;

    const sanitizedBooking = sanitizeBookingForClientAccess(
      data.booking,
      accessLevel,
      initialUid
    );
    if (!sanitizedBooking) return null;
    if (requestBookingId && sanitizedBooking.id !== requestBookingId) return null;
    if (requestBookingCode && sanitizedBooking.bookingCode !== requestBookingCode) return null;
    if (
      requestSingleTarget &&
      sanitizedBooking.id !== requestSingleTarget &&
      sanitizedBooking.id !== `bk_${requestSingleTarget.toUpperCase()}` &&
      sanitizedBooking.bookingCode !== requestSingleTarget.toUpperCase()
    ) {
      return null;
    }

    return sanitizedBooking;
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
  callback: (history: BookingStatusHistory[]) => void,
  options?: {
    bookingId?: string;
    phone?: string;
    pollIntervalMs?: number;
    onBookingUpdate?: (booking: Booking) => void;
    onError?: (err: { status: number; code: string; message: string }) => void;
  }
) {
  if (typeof bookingCode !== 'string') return () => {};
  const trimmedTarget = bookingCode.trim();
  if (!trimmedTarget || bookingCode !== trimmedTarget || !isValidReadDocId(trimmedTarget, 128)) {
    return () => {};
  }

  let expectedBookingId = '';
  if (options?.bookingId !== undefined && options?.bookingId !== null && options?.bookingId !== '') {
    if (
      typeof options.bookingId !== 'string' ||
      options.bookingId.trim() !== options.bookingId ||
      !isValidReadDocId(options.bookingId, 128)
    ) {
      return () => {};
    }
    expectedBookingId = options.bookingId;
  }

  const cleanPhone =
    options?.phone !== undefined && options?.phone !== null && options?.phone !== ''
      ? normalizeTrackingPhoneInput(options.phone)
      : '';
  if (options?.phone !== undefined && options?.phone !== null && options?.phone !== '' && !cleanPhone) {
    return () => {};
  }

  const initialSession = auth?.currentUser;
  const initialUid =
    initialSession && typeof initialSession.uid === 'string' ? initialSession.uid.trim() : '';

  let requestBookingId = '';
  let requestBookingCode = '';
  let requestSingleTarget = '';

  if (initialSession !== null && initialSession !== undefined) {
    if (
      !initialUid ||
      initialSession.uid !== initialUid ||
      !isValidReadDocId(initialUid, 128) ||
      typeof initialSession.getIdToken !== 'function'
    ) {
      return () => {};
    }

    requestBookingId = expectedBookingId;
    if (trimmedTarget.startsWith('bk_')) {
      if (requestBookingId && requestBookingId !== trimmedTarget) return () => {};
      requestBookingId = trimmedTarget;
      expectedBookingId = trimmedTarget;
      const derived = trimmedTarget.slice(3).toUpperCase();
      if (isValidReadBookingCode(derived, 64)) {
        requestBookingCode = derived;
      }
    } else if (requestBookingId) {
      if (trimmedTarget === requestBookingId) {
        if (requestBookingId.startsWith('bk_')) {
          const derived = requestBookingId.slice(3).toUpperCase();
          if (isValidReadBookingCode(derived, 64)) {
            requestBookingCode = derived;
          }
        }
      } else {
        const upper = trimmedTarget.toUpperCase();
        if (!isValidReadBookingCode(upper, 64)) return () => {};
        if (
          requestBookingId.startsWith('bk_') &&
          requestBookingId.slice(3).toUpperCase() !== upper
        ) {
          return () => {};
        }
        requestBookingCode = upper;
      }
    } else {
      requestSingleTarget = trimmedTarget;
    }
  } else {
    // Unauthenticated guest subscription requires a valid booking code and canonical phone
    if (/^bk_/i.test(trimmedTarget) || !cleanPhone) {
      return () => {};
    }
    const upper = trimmedTarget.toUpperCase();
    if (!isValidReadBookingCode(upper, 64)) return () => {};
    if (
      expectedBookingId &&
      expectedBookingId.startsWith('bk_') &&
      expectedBookingId.slice(3).toUpperCase() !== upper
    ) {
      return () => {};
    }
    requestBookingCode = upper;
  }

  let active = true;
  let pollInFlight = false;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let currentController: AbortController | null = null;

  const stopSubscription = () => {
    active = false;
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
  };

  const pollOnce = async () => {
    if (!active || pollInFlight) return;

    if (initialUid) {
      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
        stopSubscription();
        options?.onError?.({
          status: 401,
          code: 'SESSION_CHANGED',
          message: 'Sesi autentikasi telah berakhir atau berubah.',
        });
        return;
      }
    } else {
      if (auth?.currentUser !== null && auth?.currentUser !== undefined) {
        stopSubscription();
        options?.onError?.({
          status: 401,
          code: 'SESSION_CHANGED',
          message: 'Sesi autentikasi telah berubah.',
        });
        return;
      }
    }

    pollInFlight = true;
    if (currentController) {
      currentController.abort();
    }
    const controller = new AbortController();
    currentController = controller;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (initialUid) {
        const currentSession = auth?.currentUser;
        if (
          !currentSession ||
          currentSession.uid !== initialUid ||
          typeof currentSession.getIdToken !== 'function'
        ) {
          stopSubscription();
          return;
        }
        const rawToken = await currentSession.getIdToken();
        const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
        if (!active || !idToken || !auth?.currentUser || auth.currentUser.uid !== initialUid) {
          return;
        }
        headers.Authorization = `Bearer ${idToken}`;
      }

      // Guests must always use /api/bookings/track; authenticated callers use /api/booking-history/read unless booking updates are requested
      const endpoint =
        !initialUid || options?.onBookingUpdate
          ? '/api/bookings/track'
          : '/api/booking-history/read';

      const payload = initialUid
        ? {
            ...(requestBookingId ? { bookingId: requestBookingId } : {}),
            ...(requestBookingCode ? { bookingCode: requestBookingCode } : {}),
            ...(requestSingleTarget ? { target: requestSingleTarget } : {}),
            ...(cleanPhone ? { phone: cleanPhone } : {}),
          }
        : {
            bookingCode: requestBookingCode,
            phone: cleanPhone,
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!active) return;
      if (initialUid) {
        if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
          stopSubscription();
          return;
        }
      } else {
        if (auth?.currentUser !== null && auth?.currentUser !== undefined) {
          stopSubscription();
          return;
        }
      }

      const data = await res.json().catch(() => null);
      if (!active) return;
      if (initialUid) {
        if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
          stopSubscription();
          return;
        }
      } else {
        if (auth?.currentUser !== null && auth?.currentUser !== undefined) {
          stopSubscription();
          return;
        }
      }

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 409) {
          stopSubscription();
          options?.onError?.({
            status: res.status,
            code: typeof data?.code === 'string' ? data.code : 'HISTORY_ACCESS_DENIED',
            message:
              typeof data?.message === 'string' && data.message.trim()
                ? data.message.trim()
                : 'Akses ke riwayat status pesanan ditolak atau sesi berakhir.',
          });
        }
        return;
      }

      if (!data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
        return;
      }

      const accessLevel: 'staff' | 'therapist' | 'owner' | 'guest' | undefined =
        data.accessLevel === 'staff' ||
        data.accessLevel === 'therapist' ||
        data.accessLevel === 'owner' ||
        data.accessLevel === 'guest'
          ? data.accessLevel
          : undefined;
      if (!accessLevel) return;
      if (!initialUid && accessLevel !== 'guest') {
        stopSubscription();
        return;
      }
      if (initialUid && accessLevel === 'guest') {
        stopSubscription();
        return;
      }

      const resolvedId =
        typeof data.bookingId === 'string'
          ? data.bookingId.trim()
          : typeof data.booking?.id === 'string'
          ? data.booking.id.trim()
          : '';
      const resolvedCode =
        typeof data.bookingCode === 'string'
          ? data.bookingCode.trim().toUpperCase()
          : typeof data.booking?.bookingCode === 'string'
          ? String(data.booking.bookingCode).trim().toUpperCase()
          : '';

      if (!isValidReadDocId(resolvedId, 128) || !isValidReadBookingCode(resolvedCode, 64)) {
        return;
      }
      if (expectedBookingId && resolvedId !== expectedBookingId) {
        stopSubscription();
        return;
      }
      if (requestBookingCode && resolvedCode !== requestBookingCode) {
        stopSubscription();
        return;
      }
      if (
        requestSingleTarget &&
        resolvedId !== requestSingleTarget &&
        resolvedId !== `bk_${requestSingleTarget.toUpperCase()}` &&
        resolvedCode !== requestSingleTarget.toUpperCase()
      ) {
        stopSubscription();
        return;
      }

      const sanitizedHistory = sanitizeAndDeduplicateHistoryEntries(
        data.history,
        resolvedId,
        resolvedCode,
        accessLevel
      );

      if (!active) return;
      if (options?.onBookingUpdate && data.booking) {
        const sanitizedBooking = sanitizeBookingForClientAccess(
          data.booking,
          accessLevel,
          initialUid || undefined
        );
        if (!sanitizedBooking || sanitizedBooking.id !== resolvedId) {
          stopSubscription();
          return;
        }
        options.onBookingUpdate(sanitizedBooking);
      }
      callback(sanitizedHistory);
    } catch {
      // Ignore transient network or abort notices during subscription polling
    } finally {
      pollInFlight = false;
      if (currentController === controller) {
        currentController = null;
      }
    }
  };

  void pollOnce();
  const intervalMs =
    typeof options?.pollIntervalMs === 'number' && options.pollIntervalMs >= 2000
      ? options.pollIntervalMs
      : 5000;
  timerId = setInterval(() => {
    void pollOnce();
  }, intervalMs);

  return stopSubscription;
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

  // A supervisor can complete a booking that is already paid; credit it server-side (idempotent, no-ops otherwise).
  if (newStatus === 'Completed') {
    processBookingLoyaltyEarning({ ...booking, status: 'Completed', paymentStatus: booking.paymentStatus }).catch((err) =>
      console.warn('Loyalty points earning trigger error:', err)
    );
  }

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
