import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword as fbUpdatePassword,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { CustomerCRM } from '../types/crm';
import {
  normalizeIndonesianPhone,
  cleanFirestoreData,
  findCustomerByPhoneOrEmail,
  findCustomerByAuthUserId,
  addCustomerAuditLog,
} from '../lib/crmService';
import { useAuth } from './AuthContext';

export interface RegisterCustomerParams {
  name: string;
  whatsapp: string;
  email: string;
  password: string;
  confirmPassword?: string;
  displayName?: string;
  nickname?: string;
  termsAccepted: boolean;
  marketingConsent?: boolean;
  defaultAddress?: string;
  defaultArea?: string;
  currentBookingCode?: string; // If registered right after guest booking
}

export interface CustomerAuthContextType {
  currentCustomer: CustomerCRM | null;
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  isCustomerAuthenticated: boolean;
  isCustomerPreviewMode: boolean;
  registerCustomer: (params: RegisterCustomerParams) => Promise<CustomerCRM>;
  loginCustomer: (email: string, password: string) => Promise<CustomerCRM>;
  logoutCustomer: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  updateCustomerProfile: (updates: Partial<CustomerCRM>) => Promise<void>;
  updateCustomerPassword: (newPassword: string) => Promise<void>;
  refreshCustomer: () => Promise<void>;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(undefined);

interface RegistrationEligibilityResult {
  eligible: boolean;
  message?: string;
  isServiceError?: boolean;
}

// Authoritative verification for customer registration eligibility
// Determines staff association using authoritative backend and persisted data
// ZERO hardcoded email lists; fails safe if verification service is unavailable
async function verifyCustomerRegistrationEligibility(
  email: string,
  activeStaffEmail?: string
): Promise<RegistrationEligibilityResult> {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return { eligible: false, message: 'Alamat email tidak valid.' };
  }

  // 1. In-browser active staff session check (prevent active staff session from polluting customer state)
  if (activeStaffEmail && normalized === activeStaffEmail.trim().toLowerCase()) {
    return {
      eligible: false,
      message: 'Email ini terdaftar sebagai akun Staf Senzu Home. Untuk akun pelanggan, gunakan email pribadi Anda.',
    };
  }

  // 2. Direct Firestore checks (if accessible by the current client session)
  try {
    const qTh = query(
      collection(db, 'therapists'),
      where('email', '==', normalized),
      limit(1)
    );
    const snapTh = await getDocs(qTh);
    if (!snapTh.empty) {
      return {
        eligible: false,
        message: 'Email ini terdaftar sebagai akun Staf Senzu Home. Untuk akun pelanggan, gunakan email pribadi Anda.',
      };
    }
  } catch {}

  try {
    const qStaff = query(
      collection(db, 'staff_users'),
      where('email', '==', normalized),
      limit(1)
    );
    const snapStaff = await getDocs(qStaff);
    if (!snapStaff.empty) {
      return {
        eligible: false,
        message: 'Email ini terdaftar sebagai akun Staf Senzu Home. Untuk akun pelanggan, gunakan email pribadi Anda.',
      };
    }
  } catch {}

  // 3. Authoritative server check via /api/staff/check-email
  try {
    const res = await fetch('/api/staff/check-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized }),
    });

    if (res.status === 429) {
      return {
        eligible: false,
        isServiceError: true,
        message: 'Terlalu banyak permintaan verifikasi email. Silakan tunggu sebentar dan coba lagi.',
      };
    }

    if (!res.ok) {
      // 503, 500, etc. Fail-safe: do NOT assume non-staff!
      const errData = await res.json().catch(() => ({}));
      return {
        eligible: false,
        isServiceError: true,
        message:
          errData?.message ||
          'Sistem verifikasi pendaftaran sedang sibuk atau mengalami kendala jaringan. Silakan coba beberapa saat lagi.',
      };
    }

    const data = await res.json();
    if (data && data.availableForCustomerRegistration === true) {
      return { eligible: true };
    }

    return {
      eligible: false,
      message: 'Email ini terdaftar sebagai akun Staf Senzu Home. Untuk akun pelanggan, gunakan email pribadi Anda.',
    };
  } catch (netErr) {
    // Network failure / server offline: FAIL-SAFE
    return {
      eligible: false,
      isServiceError: true,
      message:
        'Sistem verifikasi pendaftaran sedang mengalami kendala jaringan. Silakan periksa koneksi Anda dan coba beberapa saat lagi.',
    };
  }
}

export const CustomerAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser: staffUser } = useAuth();
  const isCustomerPreviewMode = Boolean(staffUser);

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [internalCustomer, setInternalCustomer] = useState<CustomerCRM | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // When staff is logged in, immediately isolate customer state to null and clean customer localStorage
  useEffect(() => {
    if (staffUser) {
      setInternalCustomer(null);
      try {
        localStorage.removeItem('senzu_customer_phone');
        localStorage.removeItem('senzu_customer_name');
        localStorage.removeItem('senzu_current_customer');
        localStorage.removeItem('senzu_last_booking_code');
      } catch {}
    }
  }, [staffUser]);

  // Load customer document from Firebase user
  const loadCustomerForUser = useCallback(async (user: FirebaseUser | null) => {
    // If no user or staff user is currently logged in, customer state must remain strictly null
    if (!user || staffUser) {
      setInternalCustomer(null);
      setIsLoading(false);
      return;
    }

    try {
      const email = (user.email || '').trim().toLowerCase();

      // Guard: If this is a staff user, do NOT load them as customer!
      if (staffUser?.email && email === staffUser.email.trim().toLowerCase()) {
        setInternalCustomer(null);
        setIsLoading(false);
        return;
      }
      const eligibility = await verifyCustomerRegistrationEligibility(email, staffUser?.email);
      if (!eligibility.eligible && !eligibility.isServiceError) {
        // Staff account: Customer state remains null
        setInternalCustomer(null);
        setIsLoading(false);
        return;
      }

      // 1. Look up by authUserId (authoritative mapping)
      let customer = await findCustomerByAuthUserId(user.uid);

      // 2. If not found by authUserId, check legacy truncated ID if owned by this UID
      if (!customer) {
        const legacyId = `cust_u_${user.uid.slice(0, 10)}`;
        const legacyDoc = await getDoc(doc(db, 'customers', legacyId)).catch(() => null);
        if (legacyDoc && legacyDoc.exists()) {
          const legacyData = legacyDoc.data() as CustomerCRM;
          if (legacyData.authUserId === user.uid) {
            customer = legacyData;
          }
        }
      }

      // 3. Auto-recover dedicated customer profile using collision-safe full verified UID
      if (!customer) {
        const custId = `cust_u_${user.uid}`;
        const custRef = doc(db, 'customers', custId);
        const existingDoc = await getDoc(custRef).catch(() => null);
        if (existingDoc && existingDoc.exists()) {
          const existingData = existingDoc.data() as CustomerCRM;
          if (existingData.authUserId === user.uid) {
            customer = existingData;
          } else if (existingData.authUserId && existingData.authUserId !== user.uid) {
            // Ownership conflict: profile belongs to another UID, fail closed
            console.error('[CustomerAuth] Customer profile conflict: doc already belongs to another authUserId:', existingData.authUserId);
            customer = null;
          } else {
            customer = existingData;
          }
        } else {
          const now = new Date().toISOString();
          customer = {
            id: custId,
            name: user.displayName || 'Pelanggan Senzu',
            displayName: user.displayName || 'Pelanggan Senzu',
            normalizedName: (user.displayName || 'pelanggan senzu').toLowerCase(),
            phone: user.phoneNumber || '',
            normalizedPhone: user.phoneNumber || '',
            email: email,
            authUserId: user.uid,
            accountType: 'CUSTOMER',
            accountStatus: 'ACTIVE',
            emailVerified: user.emailVerified,
            defaultAddress: '',
            defaultArea: '',
            totalBookings: 0,
            completedBookings: 0,
            cancelledBookings: 0,
            totalSpend: 0,
            averageOrderValue: 0,
            totalTreatmentMinutes: 0,
            firstBookingAt: now,
            lastBookingAt: now,
            crmStatus: 'active',
            customerSegment: 'NEW',
            marketingConsent: false,
            transactionalNotificationEnabled: true,
            registeredAt: now,
            lastLoginAt: now,
            createdAt: now,
            updatedAt: now,
          };
          await setDoc(custRef, cleanFirestoreData(customer)).catch((err) => {
            console.warn('[CustomerAuth] Auto-recover profile notice:', err?.message);
          });
        }
      }

      if (customer) {
        // Check if customer is disabled or blocked
        if (customer.accountStatus === 'DISABLED' || customer.crmStatus === 'archived') {
          console.warn('Customer account is disabled.');
          await signOut(auth);
          setInternalCustomer(null);
          setIsLoading(false);
          return;
        }

        // Sync verification status if changed
        if (customer.emailVerified !== user.emailVerified) {
          try {
            await updateDoc(doc(db, 'customers', customer.id), {
              emailVerified: user.emailVerified,
              updatedAt: new Date().toISOString(),
            });
            customer.emailVerified = user.emailVerified;
          } catch (e) {
            console.warn('Sync emailVerified notice:', e);
          }
        }

        // Keep local storage synced for guest continuity
        if (customer.phone) {
          const { cleanDigits } = normalizeIndonesianPhone(customer.phone);
          if (cleanDigits) {
            localStorage.setItem('senzu_customer_phone', cleanDigits);
          }
        }
        if (customer.name) {
          localStorage.setItem('senzu_customer_name', customer.name);
        }

        setInternalCustomer(customer);
        try {
          localStorage.setItem('senzu_current_customer', JSON.stringify(customer));
        } catch {}
      } else {
        setInternalCustomer(null);
      }
    } catch (err: any) {
      console.warn('Notice loading customer record:', err?.message || err);
      // Resilient fallback to cached customer data if available (handles temporary quota limit / offline state)
      try {
        const cached = localStorage.getItem('senzu_current_customer');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (
            parsed &&
            (parsed.authUserId === user.uid ||
              (parsed.email && parsed.email.toLowerCase() === (user.email || '').toLowerCase()))
          ) {
            setInternalCustomer(parsed);
            return;
          }
        }
      } catch {}
      setInternalCustomer(null);
    } finally {
      setIsLoading(false);
    }
  }, [staffUser]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      await loadCustomerForUser(user);
    });

    return () => unsubscribe();
  }, [loadCustomerForUser]);

  // REGISTER
  const registerCustomer = async (params: RegisterCustomerParams): Promise<CustomerCRM> => {
    const {
      name,
      whatsapp,
      email,
      password,
      confirmPassword,
      displayName,
      nickname,
      termsAccepted,
      marketingConsent = false,
      defaultAddress = '',
      defaultArea = '',
      currentBookingCode,
    } = params;

    // Validation
    if (!name || name.trim().length < 2) {
      throw new Error('Nama lengkap minimal 2 karakter.');
    }
    const { normalizedPhone, cleanDigits } = normalizeIndonesianPhone(whatsapp);
    if (!cleanDigits || cleanDigits.length < 9) {
      throw new Error('Nomor WhatsApp tidak valid. Masukkan nomor yang benar (contoh: 08181818181).');
    }
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      throw new Error('Alamat email tidak valid.');
    }
    if (!password || password.length < 8) {
      throw new Error('Kata sandi minimal 8 karakter.');
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      throw new Error('Konfirmasi kata sandi tidak cocok.');
    }
    if (!termsAccepted) {
      throw new Error('Anda harus menyetujui Syarat & Ketentuan dan Kebijakan Privasi Senzu Home.');
    }

    // Guard: Prevent Staff email from registering as customer (fail-safe)
    const eligibility = await verifyCustomerRegistrationEligibility(cleanEmail);
    if (!eligibility.eligible) {
      throw new Error(
        eligibility.message ||
          'Email ini terdaftar sebagai akun Staf Senzu Home. Untuk akun pelanggan, gunakan email pribadi Anda.'
      );
    }

    // 1. Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    const user = userCredential.user;

    // 2. Set Firebase Auth display name
    const finalDisplayName = (displayName || nickname || name).trim();
    try {
      await updateProfile(user, { displayName: finalDisplayName });
    } catch (e) {
      console.warn('Update profile displayName notice:', e);
    }

    // 3. Send email verification (non-blocking)
    sendEmailVerification(user).catch((e) => {
      console.warn('Send email verification notice:', e);
    });

    const now = new Date().toISOString();

    // 4. Dedicated Customer CRM Record (scoped by verified full UID for collision-safe uniqueness)
    const targetCustomerId = `cust_u_${user.uid}`;

    // Verify existing profile ownership: never overwrite a profile belonging to another UID
    const existingRef = doc(db, 'customers', targetCustomerId);
    const existingDoc = await getDoc(existingRef).catch(() => null);
    if (existingDoc && existingDoc.exists()) {
      const existingData = existingDoc.data() as CustomerCRM;
      if (existingData.authUserId && existingData.authUserId !== user.uid) {
        throw new Error('ID profil pelanggan telah digunakan oleh akun lain. Pendaftaran dibatalkan demi keamanan.');
      }
    }

    const finalCustomer: CustomerCRM = {
      id: targetCustomerId,
      name: name.trim(),
      displayName: finalDisplayName,
      nickname: (nickname || '').trim(),
      normalizedName: name.trim().toLowerCase(),
      phone: whatsapp.trim(),
      normalizedPhone,
      email: cleanEmail,
      authUserId: user.uid,
      accountType: 'CUSTOMER',
      accountStatus: 'ACTIVE',
      emailVerified: user.emailVerified,
      defaultAddress: defaultAddress.trim(),
      defaultArea: defaultArea.trim(),
      totalBookings: 0,
      completedBookings: 0,
      cancelledBookings: 0,
      totalSpend: 0,
      averageOrderValue: 0,
      totalTreatmentMinutes: 0,
      firstBookingAt: now,
      lastBookingAt: now,
      crmStatus: 'active',
      customerSegment: 'NEW',
      marketingConsent: !!marketingConsent,
      marketingConsentAt: marketingConsent ? now : undefined,
      marketingConsentSource: 'registration',
      transactionalNotificationEnabled: true,
      registeredAt: now,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, 'customers', targetCustomerId), cleanFirestoreData(finalCustomer));

    // 5. Audit Log
    try {
      await addCustomerAuditLog({
        customerId: targetCustomerId,
        action: 'created',
        performedBy: 'Customer / Self-Registration',
        details: `Akun pelanggan berhasil didaftarkan via Email (${cleanEmail}) & WhatsApp (${normalizedPhone}).`,
      });
    } catch (e) {
      console.warn('Customer audit log notice:', e);
    }

    // 6. Sync localStorage for immediate access
    localStorage.setItem('senzu_customer_phone', cleanDigits);
    localStorage.setItem('senzu_customer_name', finalCustomer.name);

    setInternalCustomer(finalCustomer);
    setFirebaseUser(user);

    return finalCustomer;
  };

  // LOGIN
  const loginCustomer = async (email: string, password: string): Promise<CustomerCRM> => {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) {
      throw new Error('Masukkan alamat email Anda.');
    }
    if (!password) {
      throw new Error('Masukkan kata sandi Anda.');
    }

    // Guard: Prevent Staff user from logging in through customer portal
    const eligibility = await verifyCustomerRegistrationEligibility(cleanEmail);
    if (!eligibility.eligible && !eligibility.isServiceError) {
      throw new Error(
        'Akun ini terdaftar sebagai Akun Staf Senzu Home. Silakan masuk melalui Portal Khusus Staf di bagian bawah menu.'
      );
    }

    const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const user = userCredential.user;

    // Load customer profile by authoritative UID
    let customer = await findCustomerByAuthUserId(user.uid);

    if (!customer) {
      // Check legacy truncated ID if it exists and matches authUserId
      const legacyId = `cust_u_${user.uid.slice(0, 10)}`;
      const legacyDoc = await getDoc(doc(db, 'customers', legacyId)).catch(() => null);
      if (legacyDoc && legacyDoc.exists()) {
        const legacyData = legacyDoc.data() as CustomerCRM;
        if (legacyData.authUserId === user.uid) {
          customer = legacyData;
        }
      }
    }

    if (!customer) {
      // Auto-recover customer CRM record for this Firebase user using collision-safe full UID
      const custId = `cust_u_${user.uid}`;
      const custRef = doc(db, 'customers', custId);
      const existingDoc = await getDoc(custRef).catch(() => null);
      if (existingDoc && existingDoc.exists()) {
        const existingData = existingDoc.data() as CustomerCRM;
        if (existingData.authUserId === user.uid) {
          customer = existingData;
        } else if (existingData.authUserId && existingData.authUserId !== user.uid) {
          throw new Error('Konflik kepemilikan profil pelanggan terdeteksi. Hubungi layanan pelanggan.');
        } else {
          customer = existingData;
        }
      } else {
        const now = new Date().toISOString();
        customer = {
          id: custId,
          name: user.displayName || 'Pelanggan Senzu',
          displayName: user.displayName || 'Pelanggan Senzu',
          normalizedName: (user.displayName || 'pelanggan senzu').toLowerCase(),
          phone: user.phoneNumber || '',
          normalizedPhone: user.phoneNumber || '',
          email: cleanEmail,
          authUserId: user.uid,
          accountType: 'CUSTOMER',
          accountStatus: 'ACTIVE',
          emailVerified: user.emailVerified,
          defaultAddress: '',
          defaultArea: '',
          totalBookings: 0,
          completedBookings: 0,
          cancelledBookings: 0,
          totalSpend: 0,
          averageOrderValue: 0,
          totalTreatmentMinutes: 0,
          firstBookingAt: now,
          lastBookingAt: now,
          crmStatus: 'active',
          customerSegment: 'NEW',
          marketingConsent: false,
          transactionalNotificationEnabled: true,
          registeredAt: now,
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await setDoc(custRef, cleanFirestoreData(customer));
      }
    }

    // Check account status
    if (customer.accountStatus === 'DISABLED' || customer.crmStatus === 'archived') {
      await signOut(auth);
      throw new Error(
        'Akun Anda sedang dinonaktifkan. Silakan hubungi Customer Service Senzu Home untuk bantuan.'
      );
    }

    // Update lastLoginAt
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'customers', customer.id), {
        lastLoginAt: now,
        emailVerified: user.emailVerified,
        updatedAt: now,
      });
      customer.lastLoginAt = now;
      customer.emailVerified = user.emailVerified;
    } catch (e) {
      console.warn('Update lastLoginAt notice:', e);
    }

    // Update local storage
    if (customer.phone) {
      const { cleanDigits } = normalizeIndonesianPhone(customer.phone);
      if (cleanDigits) {
        localStorage.setItem('senzu_customer_phone', cleanDigits);
      }
    }
    if (customer.name) {
      localStorage.setItem('senzu_customer_name', customer.name);
    }

    setInternalCustomer(customer);
    setFirebaseUser(user);

    return customer;
  };

  // LOGOUT
  const logoutCustomer = async (): Promise<void> => {
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Signout notice:', err);
    } finally {
      setInternalCustomer(null);
      setFirebaseUser(null);
      try {
        localStorage.removeItem('senzu_customer_phone');
        localStorage.removeItem('senzu_customer_name');
        localStorage.removeItem('senzu_current_customer');
        localStorage.removeItem('senzu_last_booking_code');
      } catch {}
    }
  };

  // RESET PASSWORD
  const sendPasswordReset = async (email: string): Promise<void> => {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) {
      throw new Error('Masukkan alamat email Anda.');
    }
    await sendPasswordResetEmail(auth, cleanEmail);
  };

  // RESEND EMAIL VERIFICATION
  const resendVerificationEmail = async (): Promise<void> => {
    if (!firebaseUser) {
      throw new Error('Anda belum masuk.');
    }
    await sendEmailVerification(firebaseUser);
  };

  // UPDATE PROFILE
  const updateCustomerProfile = async (updates: Partial<CustomerCRM>): Promise<void> => {
    if (!internalCustomer) {
      throw new Error('Pelanggan belum masuk.');
    }

    const now = new Date().toISOString();
    const cleanUpdates = cleanFirestoreData({
      ...updates,
      updatedAt: now,
    });

    await updateDoc(doc(db, 'customers', internalCustomer.id), cleanUpdates);

    // If displayName or name changed, update Firebase Auth user displayName
    if (firebaseUser && (updates.displayName || updates.name)) {
      try {
        await updateProfile(firebaseUser, {
          displayName: updates.displayName || updates.name,
        });
      } catch (e) {
        console.warn('Update Firebase Auth profile notice:', e);
      }
    }

    // Sync localStorage
    if (updates.name) {
      localStorage.setItem('senzu_customer_name', updates.name);
    }
    if (updates.phone) {
      const { cleanDigits } = normalizeIndonesianPhone(updates.phone);
      if (cleanDigits) {
        localStorage.setItem('senzu_customer_phone', cleanDigits);
      }
    }

    setInternalCustomer((prev) => (prev ? { ...prev, ...updates, updatedAt: now } : null));
  };

  // UPDATE PASSWORD
  const updateCustomerPassword = async (newPassword: string): Promise<void> => {
    if (!firebaseUser) {
      throw new Error('Anda belum masuk.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('Kata sandi baru minimal 8 karakter.');
    }
    await fbUpdatePassword(firebaseUser, newPassword);
  };

  // REFRESH
  const refreshCustomer = async (): Promise<void> => {
    if (staffUser) return;
    if (firebaseUser) {
      await loadCustomerForUser(firebaseUser);
    }
  };

  return (
    <CustomerAuthContext.Provider
      value={{
        currentCustomer: staffUser ? null : internalCustomer,
        firebaseUser: staffUser ? null : firebaseUser,
        isLoading: staffUser ? false : isLoading,
        isCustomerAuthenticated: !staffUser && !!internalCustomer && !!firebaseUser,
        isCustomerPreviewMode,
        registerCustomer,
        loginCustomer,
        logoutCustomer,
        sendPasswordReset,
        resendVerificationEmail,
        updateCustomerProfile,
        updateCustomerPassword,
        refreshCustomer,
      }}
    >
      {children}
    </CustomerAuthContext.Provider>
  );
};

export const useCustomerAuth = (): CustomerAuthContextType => {
  const context = useContext(CustomerAuthContext);
  if (!context) {
    throw new Error('useCustomerAuth must be used within a CustomerAuthProvider');
  }
  return context;
};
