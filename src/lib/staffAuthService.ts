import {
  sendPasswordResetEmail,
  updatePassword,
} from 'firebase/auth';
import {
  doc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  StaffUser,
  LoginAccountStatus,
  DemoAccountCategory,
  Booking,
} from '../types';
import { cleanFirestoreData } from './utils';
import { recordAdminAuditLog } from './masterDataService';

// Password Strength Policy Check (Prompt 15E: min 12 chars, upper, lower, number, special char)
export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];
  if (!password || password.length < 12) {
    errors.push('Panjang kata sandi minimal 12 karakter.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Harus mengandung minimal satu huruf kapital (A-Z).');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Harus mengandung minimal satu huruf kecil (a-z).');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Harus mengandung minimal satu angka (0-9).');
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('Harus mengandung minimal satu simbol/karakter khusus (!@#$%^&* dll).');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Generate cryptographically secure temporary password (never persisted or displayed later)
export function generateSecureTempPassword(): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghijkmnopqrstuvwxyz';
  const numbers = '23456789';
  const symbols = '!@#$%^&*_-';
  const allChars = uppercase + lowercase + numbers + symbols;
  const secureIndex = (size: number): number => {
    const bytes = new Uint32Array(1);
    const bound = Math.floor(0x100000000 / size) * size;
    do {
      globalThis.crypto.getRandomValues(bytes);
    } while (bytes[0] >= bound);
    return bytes[0] % size;
  };
  const chars = [uppercase, lowercase, numbers, symbols].map(set => set[secureIndex(set.length)]);
  while (chars.length < 14) chars.push(allChars[secureIndex(allChars.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export interface ProvisionStaffOptions {
  staff: StaffUser;
  mode: 'INVITE_LINK' | 'TEMP_PASSWORD';
  tempPassword?: string;
  actor: { id: string; name: string; role: 'admin' | 'manager' };
}

export async function getStaffAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sesi staf diperlukan. Silakan masuk kembali.');
  }
  const token = await user.getIdToken();
  if (!token || auth.currentUser?.uid !== user.uid) {
    throw new Error('Sesi staf berubah atau tidak valid. Silakan masuk kembali.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function provisionStaffAuthAccount({
  staff,
  mode,
  tempPassword,
  actor,
}: ProvisionStaffOptions): Promise<{ success: boolean; authUid: string; message: string }> {
  if (!staff.email || !staff.email.includes('@')) {
    throw new Error('Alamat email staf tidak valid. Perbarui email di Master Data Staff terlebih dahulu.');
  }
  if (actor.role !== 'admin' && actor.role !== 'manager') {
    throw new Error('Akses Ditolak: Hanya Branch Manager dan Admin yang berwenang membuat akun login staf.');
  }
  if (mode === 'TEMP_PASSWORD') {
    if (!tempPassword) throw new Error('Kata sandi sementara harus diisi.');
    const validation = validatePasswordStrength(tempPassword);
    if (!validation.isValid) throw new Error(validation.errors.join(' '));
  }
  const headers = await getStaffAuthHeaders();
  const response = await fetch(`/api/manager/staff/${staff.uid}/create-login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode, tempPassword }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) {
    throw new Error(data?.error || data?.message || 'Gagal membuat akun login staf. Silakan coba kembali.');
  }
  return {
    success: true,
    authUid: data.authUid || '',
    message: data.message || 'Akun login staf berhasil dibuat.',
  };
}

/**
 * Send password reset email link to staff
 */
export async function sendStaffPasswordReset(
  staff: StaffUser,
  actor?: { id: string; name: string; role: 'admin' | 'manager' }
): Promise<{ success: boolean; message: string }> {
  if (!staff.email) {
    throw new Error('Staf tidak memiliki alamat email terdaftar.');
  }

  // 1. Authoritative Backend Attempt
  try {
    const headers = await getStaffAuthHeaders();
    const res = await fetch(`/api/manager/staff/${staff.uid}/reset-password`, {
      method: 'POST',
      headers,
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      return {
        success: true,
        message: data.message || `Link atur ulang kata sandi berhasil dikirim ke ${staff.email}.`,
      };
    }

    if (res.status >= 400 && res.status < 500) {
      throw new Error(data?.error || 'Gagal mengirim link reset kata sandi.');
    }
  } catch (apiErr: any) {
    if (apiErr.message && !apiErr.message.includes('fetch failed') && !apiErr.message.includes('ECONNREFUSED')) {
      throw apiErr;
    }
    console.warn('Backend password reset failed, falling back to client method:', apiErr);
  }

  // 2. Client Fallback
  try {
    await sendPasswordResetEmail(auth, staff.email.trim().toLowerCase());
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      throw new Error('Akun otentikasi Firebase belum terdaftar untuk email ini. Hubungi Manager.');
    }
    if (err.code === 'auth/operation-not-allowed') {
      throw new Error('Login Email & Password belum diaktifkan pada konfigurasi Firebase.');
    }
    if (err.code === 'auth/user-disabled') {
      throw new Error('Akun staff tidak aktif. Hubungi Manager.');
    }
    if (err.code === 'auth/too-many-requests') {
      throw new Error('Terlalu banyak permintaan reset kata sandi. Silakan tunggu beberapa saat.');
    }
    throw new Error(err.message || 'Gagal mengirim email reset kata sandi.');
  }

  const actorName = actor?.name || staff.name;
  const actorId = actor?.id || staff.uid;
  const actorRole = actor?.role || 'admin';

  const now = new Date().toISOString();
  await updateDoc(
    doc(db, 'staff_users', staff.uid),
    cleanFirestoreData({
      loginAccountStatus: 'UNDANGAN_TERKIRIM',
      updatedAt: now,
      updatedBy: actorName,
    })
  );

  await recordAdminAuditLog({
    actorId,
    actorRole,
    actorName,
    action: 'staff_account.password_reset_requested',
    entityType: 'staff',
    entityId: staff.uid,
    newValue: JSON.stringify({ email: staff.email }),
    summary: `Mengirimkan link atur ulang kata sandi ke email staf "${staff.name}" (${staff.email})`,
  });

  return {
    success: true,
    message: `Link atur ulang kata sandi berhasil dikirim ke ${staff.email}.`,
  };
}

/**
 * Disable staff login account with safety validations (prevent disabling last manager, check therapist active bookings)
 */
export async function disableStaffLoginAccount(
  staff: StaffUser,
  actor: { id: string; name: string; role: 'admin' | 'manager' },
  allStaffUsers: StaffUser[] = [],
  activeBookings: Booking[] = []
): Promise<{ success: boolean; message: string }> {
  const safeStaffList = Array.isArray(allStaffUsers) ? allStaffUsers : [];
  const safeBookings = Array.isArray(activeBookings) ? activeBookings : [];

  // Manager deactivation protection
  if (staff.role === 'manager') {
    const activeManagers = safeStaffList.filter(
      (u) =>
        u &&
        u.role === 'manager' &&
        u.uid !== staff.uid &&
        u.isActive !== false &&
        u.status !== 'INACTIVE' &&
        u.loginAccountStatus !== 'DINONAKTIFKAN'
    );
    if (activeManagers.length === 0) {
      throw new Error(
        'Akses Ditolak: Tidak dapat menonaktifkan satu-satunya akun Branch Manager aktif. Minimal satu akun Manager harus tetap aktif untuk operasional cabang.'
      );
    }
  }

  // Therapist deactivation safety
  if (staff.role === 'therapist') {
    const therapistId = staff.therapistId || staff.uid.replace('staff-', 'th-');
    const inFlight = safeBookings.filter(
      (b) =>
        b &&
        b.therapistId === therapistId &&
        ['confirmed', 'on_the_way', 'arrived', 'in_treatment'].includes(b.status)
    );

    if (inFlight.length > 0) {
      throw new Error(
        `Terapis "${staff.name}" masih memiliki ${inFlight.length} pesanan operasional aktif yang belum selesai. Hubungi Supervisor untuk mengalihkan penugasan sebelum menonaktifkan akun.`
      );
    }
  }

  // 1. Authoritative Backend Attempt
  try {
    const headers = await getStaffAuthHeaders();
    const res = await fetch(`/api/manager/staff/${staff.uid}/deactivate`, {
      method: 'POST',
      headers,
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      return {
        success: true,
        message: data.message || `Akun staf "${staff.name}" berhasil dinonaktifkan.`,
      };
    }

    if (res.status >= 400 && res.status < 500) {
      throw new Error(data?.error || 'Gagal menonaktifkan akun staf.');
    }
  } catch (apiErr: any) {
    if (apiErr.message && !apiErr.message.includes('fetch failed') && !apiErr.message.includes('ECONNREFUSED')) {
      throw apiErr;
    }
    console.warn('Backend deactivate failed, falling back to direct Firestore:', apiErr);
  }

  // 2. Direct Firestore Fallback
  const now = new Date().toISOString();
  const updatedData: Partial<StaffUser> = {
    loginAccountStatus: 'DINONAKTIFKAN',
    isActive: false,
    status: 'INACTIVE',
    accountDisabledAt: now,
    updatedAt: now,
    updatedBy: actor.name,
  };

  await updateDoc(doc(db, 'staff_users', staff.uid), cleanFirestoreData(updatedData));

  // If therapist, also sync status in therapists collection
  if (staff.role === 'therapist') {
    const therapistId = staff.therapistId || staff.uid.replace('staff-', 'th-');
    try {
      await updateDoc(
        doc(db, 'therapists', therapistId),
        cleanFirestoreData({
          isActive: false,
          status: 'off_duty',
          updatedAt: now,
          updatedBy: actor.name,
        })
      );
    } catch {
      // Ignore if therapist doc does not exist
    }
  }

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'staff_account.disabled',
    entityType: 'staff',
    entityId: staff.uid,
    newValue: JSON.stringify({ status: 'DINONAKTIFKAN' }),
    summary: `Menonaktifkan akses login staf "${staff.name}" (${staff.role.toUpperCase()})`,
  });

  return {
    success: true,
    message: `Akun staf "${staff.name}" berhasil dinonaktifkan. Sesi login akan segera dicabut.`,
  };
}

/**
 * Reactivate disabled staff login account
 */
export async function enableStaffLoginAccount(
  staff: StaffUser,
  actor: { id: string; name: string; role: 'admin' | 'manager' }
): Promise<{ success: boolean; message: string }> {
  // 1. Authoritative Backend Attempt
  try {
    const headers = await getStaffAuthHeaders();
    const res = await fetch(`/api/manager/staff/${staff.uid}/reactivate`, {
      method: 'POST',
      headers,
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      return {
        success: true,
        message: data.message || `Akun staf "${staff.name}" berhasil diaktifkan kembali.`,
      };
    }

    if (res.status >= 400 && res.status < 500) {
      throw new Error(data?.error || 'Gagal mengaktifkan kembali akun staf.');
    }
  } catch (apiErr: any) {
    if (apiErr.message && !apiErr.message.includes('fetch failed') && !apiErr.message.includes('ECONNREFUSED')) {
      throw apiErr;
    }
    console.warn('Backend reactivate failed, falling back to direct Firestore:', apiErr);
  }

  // 2. Direct Firestore Fallback
  const now = new Date().toISOString();
  const updatedData: Partial<StaffUser> = {
    loginAccountStatus: staff.authUserId ? 'AKTIF' : 'BELUM_DIBUAT',
    isActive: true,
    status: 'ACTIVE',
    accountDisabledAt: undefined,
    updatedAt: now,
    updatedBy: actor.name,
  };

  await updateDoc(doc(db, 'staff_users', staff.uid), cleanFirestoreData(updatedData));

  // If therapist, also activate in therapists collection
  if (staff.role === 'therapist') {
    const therapistId = staff.therapistId || staff.uid.replace('staff-', 'th-');
    try {
      await updateDoc(
        doc(db, 'therapists', therapistId),
        cleanFirestoreData({
          isActive: true,
          status: 'available',
          updatedAt: now,
          updatedBy: actor.name,
        })
      );
    } catch {
      // Ignore
    }
  }

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'staff_account.enabled',
    entityType: 'staff',
    entityId: staff.uid,
    newValue: JSON.stringify({ status: 'AKTIF' }),
    summary: `Mengaktifkan kembali akses staf "${staff.name}" (${staff.role.toUpperCase()})`,
  });

  return {
    success: true,
    message: `Akun staf "${staff.name}" berhasil diaktifkan kembali.`,
  };
}

/**
 * Handle mandatory first-login password change (Server-Authoritative Activation)
 */
export async function changeStaffFirstPassword(
  newPassword: string,
  staffUser: StaffUser
): Promise<{ success: boolean; message: string; staff?: StaffUser }> {
  const validation = validatePasswordStrength(newPassword);
  if (!validation.isValid) {
    throw new Error(validation.errors.join(' '));
  }

  if (!auth.currentUser) {
    throw new Error('Sesi login telah berakhir. Silakan masuk kembali.');
  }

  // 1. Genuine Firebase Auth Password Update (Never persist password in Firestore or logs)
  try {
    await updatePassword(auth.currentUser, newPassword);
  } catch (pwdErr: any) {
    if (pwdErr.code === 'auth/requires-recent-login') {
      throw new Error('Sesi login telah berakhir. Silakan masuk kembali.');
    }
    throw new Error(pwdErr.message || 'Gagal memperbarui kata sandi di Firebase Auth.');
  }

  // 2. Obtain freshly minted Firebase ID Token
  let idToken = '';
  try {
    idToken = await auth.currentUser.getIdToken(true);
  } catch (tokenErr) {
    throw new Error('Sesi login telah berakhir. Silakan masuk kembali.');
  }

  // 3. Complete activation through trusted server-authoritative backend endpoint
  try {
    const res = await fetch('/api/staff/complete-first-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      const errMsg =
        data?.message ||
        'Perubahan kata sandi berhasil, tetapi aktivasi akun belum selesai. Silakan coba kembali.';
      throw new Error(errMsg);
    }

    const finalStaff: StaffUser = {
      ...staffUser,
      ...(data.staff || {}),
      mustChangePassword: false,
      loginAccountStatus: 'AKTIF',
      firstLoginCompleted: true,
    };

    return {
      success: true,
      message: data.message || 'Kata sandi baru berhasil disimpan. Anda kini dapat mengakses portal operasional.',
      staff: finalStaff,
    };
  } catch (netErr: any) {
    // Map error safely according to Requirement 22 (never expose raw Firestore/Firebase errors)
    if (
      netErr.message &&
      (netErr.message.includes('Sesi login telah berakhir') ||
        netErr.message.includes('sedang tidak aktif') ||
        netErr.message.includes('Perubahan kata sandi berhasil'))
    ) {
      throw netErr;
    }
    throw new Error('Perubahan kata sandi berhasil, tetapi aktivasi akun belum selesai. Silakan coba kembali.');
  }
}

/**
 * Migration & Demo Cleanup Report Analyzer
 */
export interface DemoAccountAuditItem {
  staff: StaffUser;
  isDemo: boolean;
  category: DemoAccountCategory;
  totalBookings: number;
  activeBookings: number;
  recommendation: string;
}

export interface DemoCleanupAuditReport {
  items: DemoAccountAuditItem[];
  metrics: {
    totalAccounts: number;
    realAccountsCount: number;
    demoAccountsRemaining: number;
    disabledDemoCount: number;
    managerReady: boolean;
    supervisorReady: boolean;
    cssReady: boolean;
    activeTherapistsReadyCount: number;
    totalTherapistsCount: number;
    isSystemMigrationReady: boolean;
  };
}

export function analyzeDemoAccounts(
  staffList: StaffUser[] = [],
  bookings: Booking[] = []
): DemoCleanupAuditReport {
  const safeStaffList = Array.isArray(staffList) ? staffList : [];
  const safeBookings = Array.isArray(bookings) ? bookings : [];

  // Known demo email suffixes / demo seed identifiers
  const isDemoEmail = (email: string, uid: string) => {
    const e = (email || '').toLowerCase();
    const isSenzuDemo = e.endsWith('@senzuhome.com');
    const isSeedUid = uid.startsWith('staff-') && !uid.includes('adm-01');
    return isSenzuDemo || isSeedUid;
  };

  const items: DemoAccountAuditItem[] = safeStaffList.map((st) => {
    const isDemo = st.isDemoAccount !== undefined ? st.isDemoAccount : isDemoEmail(st.email, st.uid);
    const therapistId = st.therapistId || st.uid.replace('staff-', 'th-');

    const staffBookings = safeBookings.filter(
      (b) =>
        b &&
        (b.therapistId === therapistId ||
          (b as any).handledByStaffId === st.uid ||
          b.cssOwnerId === st.uid)
    );
    const totalBookings = staffBookings.length;
    const activeBookings = staffBookings.filter((b) =>
      ['confirmed', 'on_the_way', 'arrived', 'in_treatment'].includes(b.status)
    ).length;

    let category: DemoAccountCategory = 'REAL_PRODUCTION';
    let recommendation = 'Akun produksi aktif.';

    if (!isDemo) {
      category = 'REAL_PRODUCTION';
      recommendation = 'Akun produksi resmi. Tidak memerlukan tindakan pembersihan.';
    } else if (st.isActive === false || st.loginAccountStatus === 'DINONAKTIFKAN') {
      category = 'ALREADY_DISABLED';
      recommendation = 'Akun demo telah dinonaktifkan dengan aman. Data historis tetap utuh.';
    } else if (activeBookings > 0) {
      category = 'HAS_ACTIVE_REFERENCES';
      recommendation = `Perhatian: Akun demo memiliki ${activeBookings} pesanan aktif yang sedang berjalan. Tunggu hingga pesanan selesai atau alihkan sebelum menonaktifkan.`;
    } else if (totalBookings > 0) {
      category = 'SAFE_TO_DISABLE';
      recommendation = `Dapat dinonaktifkan dengan aman. Memiliki ${totalBookings} data pesanan historis yang akan tetap terjaga untuk audit laporan.`;
    } else {
      category = 'SAFE_TO_DISABLE';
      recommendation = 'Aman untuk dinonaktifkan. Tidak ada riwayat transaksi aktif.';
    }

    return {
      staff: st,
      isDemo,
      category,
      totalBookings,
      activeBookings,
      recommendation,
    };
  });

  // Calculate readiness metrics
  const realAccounts = items.filter((it) => !it.isDemo);
  const activeDemo = items.filter((it) => it.isDemo && it.category !== 'ALREADY_DISABLED');
  const disabledDemo = items.filter((it) => it.isDemo && it.category === 'ALREADY_DISABLED');

  const managerReady = realAccounts.some(
    (it) => (it.staff.role === 'manager' || it.staff.role === 'admin') && it.staff.isActive !== false
  );
  const supervisorReady = realAccounts.some(
    (it) => it.staff.role === 'supervisor' && it.staff.isActive !== false
  );
  const cssReady = realAccounts.some(
    (it) => it.staff.role === 'css' && it.staff.isActive !== false
  );

  const realTherapists = realAccounts.filter((it) => it.staff.role === 'therapist' && it.staff.isActive !== false);
  const totalTherapists = safeStaffList.filter((st) => st && st.role === 'therapist');

  const isSystemMigrationReady = managerReady && supervisorReady && cssReady;

  return {
    items,
    metrics: {
      totalAccounts: safeStaffList.length,
      realAccountsCount: realAccounts.length,
      demoAccountsRemaining: activeDemo.length,
      disabledDemoCount: disabledDemo.length,
      managerReady,
      supervisorReady,
      cssReady,
      activeTherapistsReadyCount: realTherapists.length,
      totalTherapistsCount: totalTherapists.length,
      isSystemMigrationReady,
    },
  };
}
