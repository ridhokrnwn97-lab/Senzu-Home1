import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  CustomerCRM,
  CustomerReview,
  CustomerNote,
  CustomerSavedAddress,
  CrmTask,
  CustomerInteraction,
  CustomerAuditLog,
  CrmSettings,
  DEFAULT_CRM_SETTINGS,
  CrmCustomerSegment,
  CustomerStatus,
  CrmCustomerStatus,
} from '../types/crm';
import { Booking } from '../types';
import { isPaymentPaid } from './paymentService';
import { emitEvent } from './notificationService';
import { cleanFirestoreData } from './utils';

export { cleanFirestoreData };

// ----------------- PHONE NORMALIZATION -----------------

/**
 * Normalizes Indonesian phone numbers into canonical E.164-style format:
 * e.g., '081272902321' -> '+6281272902321', cleanDigits -> '6281272902321'
 */
export function normalizeIndonesianPhone(phone: string): {
  normalizedPhone: string;
  cleanDigits: string;
  isIndonesian: boolean;
} {
  if (!phone) {
    return { normalizedPhone: '', cleanDigits: '', isIndonesian: false };
  }

  // Remove all non-digit characters except an initial '+' if any
  let digits = phone.replace(/[^0-9]/g, '');

  if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('8')) {
    digits = '628' + digits.slice(1);
  }

  const normalizedPhone = '+' + digits;
  return {
    normalizedPhone,
    cleanDigits: digits,
    isIndonesian: digits.startsWith('62'),
  };
}

/**
 * Generates canonical customer ID from phone or random string
 */
export function generateCustomerId(phone: string): string {
  const { cleanDigits } = normalizeIndonesianPhone(phone);
  return cleanDigits ? `cust_${cleanDigits}` : `cust_${Date.now()}`;
}

// ----------------- CRM SETTINGS -----------------

export async function getCrmSettings(): Promise<CrmSettings> {
  try {
    const snap = await getDoc(doc(db, 'crm_settings', 'general'));
    if (snap.exists()) {
      return { ...DEFAULT_CRM_SETTINGS, ...(snap.data() as CrmSettings) };
    }
    return DEFAULT_CRM_SETTINGS;
  } catch (err) {
    console.warn('Error fetching crm_settings, using defaults:', err);
    return DEFAULT_CRM_SETTINGS;
  }
}

export async function updateCrmSettings(
  settings: Partial<CrmSettings>
): Promise<void> {
  const ref = doc(db, 'crm_settings', 'general');
  await setDoc(
    ref,
    {
      ...settings,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

// ----------------- CUSTOMER LOOKUP & DEDUPLICATION -----------------

/**
 * Finds customer record by phone (primary) or email (secondary)
 */
export async function findCustomerByPhoneOrEmail(
  phone: string,
  email?: string
): Promise<CustomerCRM | null> {
  const { normalizedPhone, cleanDigits } = normalizeIndonesianPhone(phone);

  try {
    // 1. Check direct doc ID: cust_{cleanDigits}
    if (cleanDigits) {
      const docRef = doc(db, 'customers', `cust_${cleanDigits}`);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as CustomerCRM;
      }

      // Legacy fallback: doc ID was just cleanDigits
      const legacyRef = doc(db, 'customers', cleanDigits);
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        return legacySnap.data() as CustomerCRM;
      }
    }

    // 2. Query by normalizedPhone
    if (normalizedPhone) {
      const q = query(
        collection(db, 'customers'),
        where('normalizedPhone', '==', normalizedPhone)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].data() as CustomerCRM;
      }
    }

    // 3. Fallback: Query by original phone
    if (phone.trim()) {
      const qPhone = query(
        collection(db, 'customers'),
        where('phone', '==', phone.trim())
      );
      const snapPhone = await getDocs(qPhone);
      if (!snapPhone.empty) {
        return snapPhone.docs[0].data() as CustomerCRM;
      }
    }

    // 4. Secondary fallback: Query by email if available and non-empty
    if (email && email.trim()) {
      const qEmail = query(
        collection(db, 'customers'),
        where('email', '==', email.trim().toLowerCase())
      );
      const snapEmail = await getDocs(qEmail);
      if (!snapEmail.empty) {
        return snapEmail.docs[0].data() as CustomerCRM;
      }
    }

    return null;
  } catch (err) {
    console.warn('Customer lookup error:', err);
    return null;
  }
}

/**
 * Finds customer record by Firebase Auth UID
 */
export async function findCustomerByAuthUserId(
  authUserId: string
): Promise<CustomerCRM | null> {
  if (!authUserId) return null;
  try {
    const q = query(
      collection(db, 'customers'),
      where('authUserId', '==', authUserId),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].data() as CustomerCRM;
    }
    return null;
  } catch (err) {
    console.warn('Error finding customer by authUserId:', err);
    return null;
  }
}

/**
 * Finds customer record by Email (case-insensitive search)
 */
export async function findCustomerByEmail(
  email: string
): Promise<CustomerCRM | null> {
  if (!email || !email.trim()) return null;
  try {
    const q = query(
      collection(db, 'customers'),
      where('email', '==', email.trim().toLowerCase()),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].data() as CustomerCRM;
    }
    return null;
  } catch (err) {
    console.warn('Error finding customer by email:', err);
    return null;
  }
}

// ----------------- SEGMENTATION ENGINE -----------------

/**
 * Evaluates customer segment dynamically based on completed bookings, spend, and recency
 */
export function evaluateCustomerSegment(
  cust: Partial<CustomerCRM>,
  settings: CrmSettings
): CrmCustomerSegment {
  if (cust.customerSegment === 'VIP' && cust.vipSource === 'manual') {
    return 'VIP';
  }

  const completed = cust.completedBookings ?? 0;
  const spend = cust.totalSpend ?? 0;

  // VIP auto rule
  if (spend >= settings.highValueSpend * 2 || completed >= settings.highValueBookings * 2) {
    return 'VIP';
  }

  // High value
  if (spend >= settings.highValueSpend || completed >= settings.highValueBookings) {
    return 'HIGH_VALUE';
  }

  if (!cust.lastCompletedTreatmentAt) {
    return 'NEW';
  }

  const lastDate = new Date(cust.lastCompletedTreatmentAt).getTime();
  const now = Date.now();
  const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  if (diffDays > settings.inactiveDays) {
    return 'INACTIVE';
  }

  if (diffDays >= settings.activeDays && diffDays <= settings.atRiskDays) {
    return 'AT_RISK';
  }

  if (completed >= settings.repeatMinBookings) {
    return 'REPEAT';
  }

  if (diffDays <= settings.activeDays) {
    return 'ACTIVE';
  }

  return 'NEW';
}

// ----------------- RECOMPUTE & IDEMPOTENT AGGREGATION -----------------

/**
 * Recomputes full customer aggregate from real bookings and reviews
 */
export async function recomputeCustomerProfile(
  customerId: string
): Promise<CustomerCRM | null> {
  if (!customerId) return null;
  const session = auth.currentUser;
  if (!session?.uid) return null;

  // Recompute is optional to callers; failed authorization/network requests
  // return null without bypassing the server through direct Firestore writes.
  try {
    const idToken = await session.getIdToken();
    if (!idToken || auth.currentUser?.uid !== session.uid) return null;
    const res = await fetch('/api/customers/recompute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ customerId }),
    });
    if (!res.ok || auth.currentUser?.uid !== session.uid) return null;
    const data = await res.json();
    if (auth.currentUser?.uid !== session.uid) return null;
    return data.success === true && data.customer ? data.customer as CustomerCRM : null;
  } catch (err: any) {
    console.warn('Notice in recomputeCustomerProfile:', err?.message || err);
    return null;
  }
}

// ----------------- CUSTOMER UPSERT FROM BOOKING -----------------

/**
 * Creates or updates a customer master record when a new booking is created or completed
 */
export async function upsertCustomerFromBooking(
  booking: Booking
): Promise<CustomerCRM> {
  const { normalizedPhone, cleanDigits } = normalizeIndonesianPhone(
    booking.customerWhatsApp
  );
  const now = new Date().toISOString();

  // Try to find existing customer
  const existing = await findCustomerByPhoneOrEmail(
    booking.customerWhatsApp,
    booking.customerEmail
  );

  const targetId = existing?.id || (cleanDigits ? `cust_${cleanDigits}` : `cust_${Date.now()}`);
  const custRef = doc(db, 'customers', targetId);
  const settings = await getCrmSettings();

  if (!existing) {
    // New Customer Master Record
    const newCustomer: CustomerCRM = {
      id: targetId,
      name: booking.customerName.trim(),
      normalizedName: booking.customerName.trim().toLowerCase(),
      phone: booking.customerWhatsApp,
      normalizedPhone,
      email: booking.customerEmail || '',
      genderPreference: booking.genderPreference,
      defaultAddress: booking.address,
      defaultArea: booking.area,
      defaultLatitude: booking.latitude,
      defaultLongitude: booking.longitude,
      defaultPlaceId: booking.placeId,
      addressNotes: booking.addressNotes || '',
      firstBookingAt: now,
      lastBookingAt: now,
      totalBookings: 1,
      completedBookings: booking.status === 'Completed' ? 1 : 0,
      cancelledBookings: booking.status === 'Cancelled' ? 1 : 0,
      totalSpend:
        booking.status === 'Completed' && isPaymentPaid(booking.paymentStatus)
          ? booking.totalAmount
          : 0,
      averageOrderValue:
        booking.status === 'Completed' && isPaymentPaid(booking.paymentStatus)
          ? booking.totalAmount
          : 0,
      totalTreatmentMinutes:
        booking.status === 'Completed' ? booking.serviceDuration : 0,
      favoriteServiceId: booking.serviceId,
      favoriteServiceName: booking.serviceName,
      favoriteTherapistId: booking.therapistId,
      favoriteTherapistName: booking.therapistName,
      crmStatus: 'active',
      customerSegment: 'NEW',
      marketingConsent: true,
      transactionalNotificationEnabled: true,
      tags: ['New Customer'],
      // Backward compatibility
      totalBooking: 1,
      completedBooking: booking.status === 'Completed' ? 1 : 0,
      whatsapp: booking.customerWhatsApp,
      lastBooking: `${booking.scheduleDate} ${booking.scheduleTime}`,
      favoriteTreatment: booking.serviceName,
      favoriteTherapist: booking.therapistName || '-',
      createdAt: now,
      updatedAt: now,
    };

    newCustomer.customerSegment = evaluateCustomerSegment(newCustomer, settings);

    await setDoc(custRef, cleanFirestoreData(newCustomer));

    // Save initial address as default in saved addresses
    try {
      const addressId = `addr_${targetId}_default`;
      const addrRef = doc(db, 'customer_addresses', addressId);
      await setDoc(addrRef, cleanFirestoreData({
        id: addressId,
        customerId: targetId,
        label: 'Rumah',
        address: booking.address,
        area: booking.area,
        latitude: booking.latitude,
        longitude: booking.longitude,
        placeId: booking.placeId,
        addressNotes: booking.addressNotes || '',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      } as CustomerSavedAddress));
    } catch (e) {
      console.warn('Initial address save notice:', e);
    }

    // Audit log
    await addCustomerAuditLog({
      customerId: targetId,
      action: 'created',
      performedBy: 'System / Booking Form',
      details: `Customer Master dibuat otomatis dari booking ${booking.bookingCode}`,
    });

    return newCustomer;
  } else {
    // Existing Customer: Update recent activity and recompute
    const updates: Partial<CustomerCRM> = {
      lastBookingAt: now,
      updatedAt: now,
    };

    // If new booking has address, update defaults if not set
    if (!existing.defaultAddress && booking.address) {
      updates.defaultAddress = booking.address;
      updates.defaultArea = booking.area;
      updates.defaultLatitude = booking.latitude;
      updates.defaultLongitude = booking.longitude;
      updates.defaultPlaceId = booking.placeId;
      updates.addressNotes = booking.addressNotes;
    }

    await updateDoc(custRef, cleanFirestoreData(updates));

    // Trigger full recomputation for accurate metrics & segmentation
    try {
      const updated = await recomputeCustomerProfile(targetId);
      return updated || existing;
    } catch (recomputeErr) {
      console.warn('Notice recomputing customer profile:', recomputeErr);
      return existing;
    }
  }
}

// ----------------- CUSTOMER MERGE (ADMIN) -----------------

/**
 * Merges duplicate customer record into a primary target customer.
 * Moves all bookings, reviews, notes, and addresses to target, and archives source.
 */
export async function mergeCustomers(
  targetCustomerId: string,
  sourceCustomerId: string,
  performedBy: string
): Promise<void> {
  if (targetCustomerId === sourceCustomerId) {
    throw new Error('Target and source customer cannot be the same.');
  }

  const targetSnap = await getDoc(doc(db, 'customers', targetCustomerId));
  const sourceSnap = await getDoc(doc(db, 'customers', sourceCustomerId));

  if (!targetSnap.exists() || !sourceSnap.exists()) {
    throw new Error('Target or source customer not found.');
  }

  const sourceData = sourceSnap.data() as CustomerCRM;

  // 1. Move all bookings belonging to source
  const bQuery = query(
    collection(db, 'bookings'),
    where('customerId', '==', sourceCustomerId)
  );
  const bSnap = await getDocs(bQuery);
  for (const bDoc of bSnap.docs) {
    await updateDoc(doc(db, 'bookings', bDoc.id), {
      customerId: targetCustomerId,
      updatedAt: new Date().toISOString(),
    });
  }

  // 2. Move all reviews
  const rQuery = query(
    collection(db, 'reviews'),
    where('customerId', '==', sourceCustomerId)
  );
  const rSnap = await getDocs(rQuery);
  for (const rDoc of rSnap.docs) {
    await updateDoc(doc(db, 'reviews', rDoc.id), {
      customerId: targetCustomerId,
      updatedAt: new Date().toISOString(),
    });
  }

  // 3. Move all customer notes
  const nQuery = query(
    collection(db, 'customer_notes'),
    where('customerId', '==', sourceCustomerId)
  );
  const nSnap = await getDocs(nQuery);
  for (const nDoc of nSnap.docs) {
    await updateDoc(doc(db, 'customer_notes', nDoc.id), {
      customerId: targetCustomerId,
      updatedAt: new Date().toISOString(),
    });
  }

  // 4. Move all saved addresses
  const aQuery = query(
    collection(db, 'customer_addresses'),
    where('customerId', '==', sourceCustomerId)
  );
  const aSnap = await getDocs(aQuery);
  for (const aDoc of aSnap.docs) {
    await updateDoc(doc(db, 'customer_addresses', aDoc.id), {
      customerId: targetCustomerId,
      isDefault: false,
      updatedAt: new Date().toISOString(),
    });
  }

  // 5. Move CRM Tasks
  const tQuery = query(
    collection(db, 'crm_tasks'),
    where('customerId', '==', sourceCustomerId)
  );
  const tSnap = await getDocs(tQuery);
  for (const tDoc of tSnap.docs) {
    await updateDoc(doc(db, 'crm_tasks', tDoc.id), {
      customerId: targetCustomerId,
      updatedAt: new Date().toISOString(),
    });
  }

  // 6. Mark source customer as archived / merged
  await updateDoc(doc(db, 'customers', sourceCustomerId), {
    crmStatus: 'archived',
    tags: [...(sourceData.tags || []), `Merged into ${targetCustomerId}`],
    updatedAt: new Date().toISOString(),
  });

  // 7. Audit log on target and source
  await addCustomerAuditLog({
    customerId: targetCustomerId,
    action: 'merged',
    performedBy,
    details: `Merged data dari customer duplicate ${sourceCustomerId} (${sourceData.name} - ${sourceData.phone})`,
  });

  await addCustomerAuditLog({
    customerId: sourceCustomerId,
    action: 'merged',
    performedBy,
    details: `Customer di-merge ke customer utama ${targetCustomerId}`,
  });

  // 8. Recompute primary customer
  await recomputeCustomerProfile(targetCustomerId);
}

export async function toggleCustomerVipStatus(
  customerId: string,
  isVip: boolean,
  performedBy: string,
  reason?: string
): Promise<void> {
  const custRef = doc(db, 'customers', customerId);
  const now = new Date().toISOString();
  await updateDoc(custRef, {
    isVip,
    customerSegment: isVip ? 'VIP' : 'REPEAT',
    updatedAt: now,
  });
  await addCustomerAuditLog({
    customerId,
    action: isVip ? 'promoted_to_vip' : 'demoted_from_vip',
    performedBy,
    details: reason || (isVip ? 'Customer dipromosikan ke VIP' : 'Status VIP dicabut'),
  });
}

export async function updateCustomerStatus(
  customerId: string,
  status: CustomerStatus,
  performedBy: string,
  reason?: string
): Promise<void> {
  const custRef = doc(db, 'customers', customerId);
  const now = new Date().toISOString();
  await updateDoc(custRef, {
    customerStatus: status,
    crmStatus: status,
    updatedAt: now,
  });
  await addCustomerAuditLog({
    customerId,
    action: 'status_changed',
    performedBy,
    details: reason || `Status pelanggan diubah menjadi ${status}`,
  });
}

// ----------------- RATING & REVIEW SYSTEM -----------------

/**
 * Gets review for a specific booking
 */
export async function getReviewByBookingId(
  bookingId: string
): Promise<CustomerReview | null> {
  try {
    const q = query(
      collection(db, 'reviews'),
      where('bookingId', '==', bookingId)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].data() as CustomerReview;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Submits a rating and review for a completed booking
 */
export async function submitCustomerReview(
  reviewData: Omit<CustomerReview, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CustomerReview> {
  // Prevent duplicate review for the same booking
  const existing = await getReviewByBookingId(reviewData.bookingId);
  if (existing) {
    // Update existing review
    const now = new Date().toISOString();
    const updatedReview: CustomerReview = {
      ...existing,
      ...reviewData,
      updatedAt: now,
    };
    await setDoc(doc(db, 'reviews', existing.id), cleanFirestoreData(updatedReview));

    // Recompute customer metrics
    await recomputeCustomerProfile(reviewData.customerId);
    return updatedReview;
  }

  const reviewId = `rev_${reviewData.bookingCode}_${Date.now()}`;
  const now = new Date().toISOString();

  // If low rating (<= 2), initiate open service recovery
  const isLowRating = reviewData.overallRating <= 2;

  const newReview: CustomerReview = {
    ...reviewData,
    id: reviewId,
    serviceRecoveryStatus: isLowRating ? 'open' : undefined,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'reviews', reviewId), cleanFirestoreData(newReview));

  // Trigger Low Rating Alert to CSS & Supervisor if rating <= 2
  if (isLowRating) {
    try {
      emitEvent(
        'review.low_rating',
        {
          reviewId,
          bookingId: reviewData.bookingId,
          bookingCode: reviewData.bookingCode,
          customerId: reviewData.customerId,
          customerName: reviewData.customerName,
          rating: reviewData.overallRating,
          comment: reviewData.comment,
          tags: reviewData.tags,
        },
        { id: reviewData.customerId, role: 'customer' }
      ).catch((e) => console.warn('Low rating emit warning:', e));

      // Also create an automated CRM Task for follow-up service recovery
      await createCrmTask({
        customerId: reviewData.customerId,
        customerName: reviewData.customerName,
        customerPhone: '',
        bookingId: reviewData.bookingId,
        taskType: 'service_recovery',
        title: `Service Recovery: Rating ${reviewData.overallRating}★ (${reviewData.bookingCode})`,
        description: `Customer memberikan rating rendah (${reviewData.overallRating}/5). Catatan: "${reviewData.comment}". Segera lakukan penelusuran SOP layanan.`,
        priority: 'HIGH',
        status: 'open',
        createdBy: 'System / Low Rating Engine',
      });

      // Automatically create or link Unified Operational Case for CSS
      try {
        const { createCase, getCasesByBookingId } = await import('./caseService');
        const existingCases = await getCasesByBookingId(reviewData.bookingId);
        const hasActiveCase = existingCases.some((c) => c.status !== 'CLOSED');
        if (!hasActiveCase) {
          await createCase({
            caseType: 'LOW_RATING',
            source: 'Rating / Review',
            booking: {
              id: reviewData.bookingId,
              bookingCode: reviewData.bookingCode,
              customerId: reviewData.customerId,
              customerName: reviewData.customerName,
              therapistId: reviewData.therapistId,
              therapistName: reviewData.therapistName,
            },
            category: 'Treatment concern',
            severity: 'HIGH',
            summary: `Ulasan Rendah ${reviewData.overallRating}★: ${reviewData.comment ? reviewData.comment.substring(0, 60) : 'Evaluasi Layanan'}`,
            description: `Pelanggan memberikan rating ${reviewData.overallRating}/5. Komentar: "${reviewData.comment || '-'}" (Tags: ${reviewData.tags?.join(', ') || '-'}).`,
            reviewId,
            rating: reviewData.overallRating,
            reportedBy: reviewData.customerId,
            reportedByName: reviewData.customerName,
            assignedRole: 'CSS',
          });
        }
      } catch (caseErr) {
        console.warn('Auto create case on low rating warning:', caseErr);
      }
    } catch (err) {
      console.warn('Low rating workflow warning:', err);
    }
  }

  // Update therapist rating if therapist assigned
  if (reviewData.therapistId) {
    try {
      const thRef = doc(db, 'therapists', reviewData.therapistId);
      const thSnap = await getDoc(thRef);
      if (thSnap.exists()) {
        const thReviews = await getDocs(
          query(
            collection(db, 'reviews'),
            where('therapistId', '==', reviewData.therapistId)
          )
        );
        let thSum = 0;
        let thCount = 0;
        thReviews.forEach((d) => {
          const r = d.data() as CustomerReview;
          if (r.overallRating) {
            thSum += r.overallRating;
            thCount += 1;
          }
        });
        const newRating = thCount > 0 ? +(thSum / thCount).toFixed(1) : 5.0;
        await updateDoc(thRef, { rating: newRating });
      }
    } catch (e) {
      console.warn('Therapist rating recalculation warning:', e);
    }
  }

  // Recompute customer metrics
  await recomputeCustomerProfile(reviewData.customerId);

  return newReview;
}

export async function getCustomerReviews(customerId: string): Promise<CustomerReview[]> {
  try {
    const q = query(
      collection(db, 'reviews'),
      where('customerId', '==', customerId)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as CustomerReview);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  } catch {
    return [];
  }
}

export async function getLowRatingReviews(): Promise<CustomerReview[]> {
  try {
    const q = query(
      collection(db, 'reviews'),
      where('overallRating', '<=', 2)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as CustomerReview);
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  } catch {
    return [];
  }
}

// ----------------- CUSTOMER NOTES & SAVED ADDRESSES -----------------

export async function getCustomerNotes(
  customerId: string
): Promise<CustomerNote[]> {
  try {
    const q = query(
      collection(db, 'customer_notes'),
      where('customerId', '==', customerId)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as CustomerNote);
    list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return list;
  } catch {
    return [];
  }
}

export async function addCustomerNote(
  noteData: Omit<CustomerNote, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CustomerNote> {
  const noteId = `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const note: CustomerNote = {
    ...noteData,
    id: noteId,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'customer_notes', noteId), cleanFirestoreData(note));

  await addCustomerAuditLog({
    customerId: noteData.customerId,
    action: 'note_added',
    performedBy: `${noteData.createdBy} (${noteData.createdByRole})`,
    details: `Menambahkan catatan ${noteData.noteType}: "${noteData.note.substring(0, 40)}..."`,
  });

  return note;
}

export async function getCustomerSavedAddresses(
  customerId: string
): Promise<CustomerSavedAddress[]> {
  try {
    const q = query(
      collection(db, 'customer_addresses'),
      where('customerId', '==', customerId)
    );
    const snap = await getDocs(q);
    const list = snap.docs
      .map((d) => d.data() as CustomerSavedAddress)
      .filter((a) => !(a as any).deleted);
    list.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
    return list;
  } catch {
    return [];
  }
}

export async function saveCustomerAddress(
  addrData: Omit<CustomerSavedAddress, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CustomerSavedAddress> {
  const addrId = `addr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const address: CustomerSavedAddress = {
    ...addrData,
    id: addrId,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'customer_addresses', addrId), cleanFirestoreData(address));

  if (address.isDefault) {
    await setDefaultCustomerAddress(address.customerId, addrId);
  }

  return address;
}

export async function updateCustomerAddress(
  addressId: string,
  updates: Partial<CustomerSavedAddress>
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'customer_addresses', addressId), cleanFirestoreData({
    ...updates,
    updatedAt: now,
  }));
}

export async function setDefaultCustomerAddress(
  customerId: string,
  targetAddressId: string
): Promise<void> {
  const addresses = await getCustomerSavedAddresses(customerId);
  const now = new Date().toISOString();
  let defaultAddr: CustomerSavedAddress | undefined;

  for (const addr of addresses) {
    const isTarget = addr.id === targetAddressId;
    if (isTarget) defaultAddr = addr;
    if (addr.isDefault !== isTarget) {
      await updateDoc(doc(db, 'customer_addresses', addr.id), {
        isDefault: isTarget,
        updatedAt: now,
      });
    }
  }

  if (defaultAddr) {
    // Also sync to customer document default address
    try {
      await updateDoc(doc(db, 'customers', customerId), {
        defaultAddress: defaultAddr.address,
        defaultArea: defaultAddr.area,
        defaultLatitude: defaultAddr.latitude || null,
        defaultLongitude: defaultAddr.longitude || null,
        defaultPlaceId: defaultAddr.placeId || null,
        addressNotes: defaultAddr.addressNotes || '',
        updatedAt: now,
      });
    } catch (e) {
      console.warn('Sync default address to customer notice:', e);
    }
  }
}

export async function deleteCustomerAddress(addressId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'customer_addresses', addressId));
  } catch {
    await updateDoc(doc(db, 'customer_addresses', addressId), cleanFirestoreData({
      deleted: true,
      updatedAt: new Date().toISOString(),
    }));
  }
}

// ----------------- CUSTOMER INTERACTIONS -----------------

export async function addCustomerInteraction(
  interactionData: Omit<CustomerInteraction, 'id' | 'createdAt'>
): Promise<CustomerInteraction> {
  const id = `int_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const interaction: CustomerInteraction = {
    ...interactionData,
    id,
    createdAt: now,
  };
  await setDoc(doc(db, 'customer_interactions', id), cleanFirestoreData(interaction));

  await addCustomerAuditLog({
    customerId: interactionData.customerId,
    action: 'note_added',
    performedBy: interactionData.staffId || 'CSS Staff',
    details: `Interaksi [${interactionData.channel.toUpperCase()}]: ${interactionData.summary.substring(0, 40)}...`,
  });

  return interaction;
}

export async function getCustomerInteractions(
  customerId: string
): Promise<CustomerInteraction[]> {
  try {
    const q = query(
      collection(db, 'customer_interactions'),
      where('customerId', '==', customerId)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as CustomerInteraction);
    list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return list;
  } catch {
    return [];
  }
}

// ----------------- CRM TASKS & FOLLOW-UP -----------------

export async function getCrmTasks(filterParam?: string): Promise<CrmTask[]> {
  try {
    let q = query(collection(db, 'crm_tasks'));
    if (filterParam && filterParam !== 'ALL') {
      if (filterParam.startsWith('cust_')) {
        q = query(collection(db, 'crm_tasks'), where('customerId', '==', filterParam));
      } else {
        q = query(collection(db, 'crm_tasks'), where('status', '==', filterParam));
      }
    }
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as CrmTask);
    list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return list;
  } catch {
    return [];
  }
}

export async function createCrmTask(
  taskData: Omit<CrmTask, 'id' | 'createdAt' | 'completedAt'>
): Promise<CrmTask> {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const task: CrmTask = {
    ...taskData,
    id: taskId,
    createdAt: now,
  };
  await setDoc(doc(db, 'crm_tasks', taskId), cleanFirestoreData(task));
  return task;
}

export async function updateCrmTaskStatus(
  taskId: string,
  status: any,
  performedBy?: string
): Promise<void> {
  const now = new Date().toISOString();
  const updates: Partial<CrmTask> = {
    status,
    completedAt: status === 'completed' ? now : undefined,
  };
  await updateDoc(doc(db, 'crm_tasks', taskId), cleanFirestoreData(updates));
}

// ----------------- AUDIT LOGS -----------------

export async function addCustomerAuditLog(
  logData: Omit<CustomerAuditLog, 'id' | 'timestamp'>
): Promise<void> {
  try {
    const logId = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const entry: CustomerAuditLog = {
      ...logData,
      id: logId,
      timestamp: new Date().toISOString(),
    };
    await setDoc(doc(db, 'customer_audit_logs', logId), cleanFirestoreData(entry));
  } catch (err) {
    console.warn('Audit log write error:', err);
  }
}

export async function getCustomerAuditLogs(
  customerId: string
): Promise<CustomerAuditLog[]> {
  try {
    const q = query(
      collection(db, 'customer_audit_logs'),
      where('customerId', '==', customerId)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as CustomerAuditLog);
    list.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return list;
  } catch {
    return [];
  }
}

// ----------------- REALTIME SUBSCRIPTIONS -----------------

export function subscribeToAllCustomers(
  callback: (customers: CustomerCRM[]) => void
) {
  return onSnapshot(
    collection(db, 'customers'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CustomerCRM);
      list.sort((a, b) => {
        const timeB = new Date(b.lastBookingAt || b.createdAt || 0).getTime();
        const timeA = new Date(a.lastBookingAt || a.createdAt || 0).getTime();
        return timeB - timeA;
      });
      callback(list);
    },
    (err) => {
      console.warn('Realtime customers subscription notice:', err.message);
      callback([]);
    }
  );
}

export function subscribeToAllReviews(
  callback: (reviews: CustomerReview[]) => void
) {
  return onSnapshot(
    collection(db, 'reviews'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CustomerReview);
      list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      callback(list);
    },
    (err) => {
      console.warn('Realtime reviews subscription notice:', err.message);
      callback([]);
    }
  );
}

export function subscribeToCrmTasks(callback: (tasks: CrmTask[]) => void) {
  return onSnapshot(
    collection(db, 'crm_tasks'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CrmTask);
      list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      callback(list);
    },
    (err) => {
      console.warn('Realtime CRM tasks subscription notice:', err.message);
      callback([]);
    }
  );
}

// ----------------- SAFE BACKFILL / MIGRATION SCRIPT -----------------

/**
 * Safely backfills Customer CRM collection from all existing bookings.
 * Ensures consistent canonical IDs, lifetime spend, favorite services, and segmentation.
 */
export async function backfillAndRecomputeAllCustomers(
  performedBy: string = 'System Admin'
): Promise<{ processed: number; errors: number; processedBookings: number; syncedCustomers: number }> {
  let processed = 0;
  let errors = 0;
  let totalBookingsCount = 0;

  try {
    const bookingsSnap = await getDocs(collection(db, 'bookings'));
    const bookings = bookingsSnap.docs.map((d) => d.data() as Booking);
    totalBookingsCount = bookings.length;

    // Group bookings by normalized phone
    const phoneGroups: Record<string, Booking[]> = {};
    for (const b of bookings) {
      const { normalizedPhone, cleanDigits } = normalizeIndonesianPhone(
        b.customerWhatsApp
      );
      const key = normalizedPhone || cleanDigits || b.customerWhatsApp;
      if (!phoneGroups[key]) {
        phoneGroups[key] = [];
      }
      phoneGroups[key].push(b);
    }

    for (const [phoneKey, group] of Object.entries(phoneGroups)) {
      try {
        const firstB = group[0];
        await upsertCustomerFromBooking(firstB);
        processed++;
      } catch (err) {
        console.error(`Backfill error for group ${phoneKey}:`, err);
        errors++;
      }
    }

    await addCustomerAuditLog({
      customerId: 'all',
      action: 'updated',
      performedBy,
      details: `Backfill CRM dieksekusi: ${processed} customer diproses, ${errors} error.`,
    });

    return {
      processed,
      errors,
      processedBookings: totalBookingsCount,
      syncedCustomers: processed,
    };
  } catch (err) {
    console.error('Fatal backfill error:', err);
    return {
      processed,
      errors: errors + 1,
      processedBookings: totalBookingsCount,
      syncedCustomers: processed,
    };
  }
}

// ----------------- CUSTOMER 360 & INTERACTION HELPERS FOR CSS -----------------

/**
 * Get customer by direct ID
 */
export async function getCustomerById(customerId: string): Promise<CustomerCRM | null> {
  if (!customerId) return null;
  try {
    const snap = await getDoc(doc(db, 'customers', customerId));
    if (snap.exists()) {
      return snap.data() as CustomerCRM;
    }
    return null;
  } catch (err) {
    console.error('Failed to get customer by id:', err);
    return null;
  }
}

/**
 * Search customers by term (name, phone)
 */
export async function searchCustomers(term: string): Promise<CustomerCRM[]> {
  if (!term.trim()) return [];
  const qTerm = term.trim().toLowerCase();
  try {
    const custSnap = await getDocs(collection(db, 'customers'));
    const list: CustomerCRM[] = [];
    custSnap.forEach((d) => {
      const data = d.data() as CustomerCRM;
      if (
        (data.name && data.name.toLowerCase().includes(qTerm)) ||
        (data.phone && data.phone.includes(qTerm)) ||
        (data.normalizedPhone && data.normalizedPhone.includes(qTerm))
      ) {
        list.push(data);
      }
    });
    return list;
  } catch (err) {
    console.error('Failed to search customers:', err);
    return [];
  }
}

