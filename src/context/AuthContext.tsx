import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { StaffUser, UserRole, LoginAccountStatus } from '../types';
import { getStaffMasterUsers } from '../lib/masterDataService';

export const SAMPLE_STAFF_USERS: StaffUser[] = [
  {
    uid: 'staff-css-01',
    employeeCode: 'CSS001',
    email: 'css@senzuhome.com',
    name: 'Dewi Lestari (CSS Admin)',
    displayName: 'Dewi L.',
    role: 'css',
    phone: '+6289654623347',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: true,
  },
  {
    uid: 'staff-spv-01',
    employeeCode: 'SPV001',
    email: 'supervisor@senzuhome.com',
    name: 'Hendra Wijaya (Supervisor)',
    displayName: 'Hendra W.',
    role: 'supervisor',
    phone: '+6281273445500',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: true,
  },
  {
    uid: 'staff-th-rina',
    employeeCode: 'TRP001',
    email: 'rina@senzuhome.com',
    name: 'Rina Anggraini',
    displayName: 'Rina A.',
    role: 'therapist',
    therapistId: 'th-rina',
    phone: '081273445501',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: true,
  },
  {
    uid: 'staff-th-siti',
    employeeCode: 'TRP002',
    email: 'siti@senzuhome.com',
    name: 'Siti Rahma',
    displayName: 'Siti R.',
    role: 'therapist',
    therapistId: 'th-siti',
    phone: '081273445502',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: true,
  },
  {
    uid: 'staff-th-budi',
    employeeCode: 'TRP003',
    email: 'budi@senzuhome.com',
    name: 'Budi Santoso',
    displayName: 'Budi S.',
    role: 'therapist',
    therapistId: 'th-budi',
    phone: '081273445503',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: true,
  },
  {
    uid: 'staff-th-fauzi',
    employeeCode: 'TRP004',
    email: 'fauzi@senzuhome.com',
    name: 'Ahmad Fauzi',
    displayName: 'Fauzi',
    role: 'therapist',
    therapistId: 'th-fauzi',
    phone: '081273445504',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: true,
  },
  {
    uid: 'staff-mgr-01',
    employeeCode: 'MGR001',
    email: 'manager@senzuhome.com',
    name: 'Bambang Irawan (Branch Manager)',
    displayName: 'Bambang I.',
    role: 'manager',
    phone: '+6281273445599',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: true,
  },
  {
    uid: 'staff-adm-01',
    employeeCode: 'ADM001',
    email: 'ridhokrnwn97@gmail.com',
    name: 'Ridho Kurniawan (Admin)',
    displayName: 'Ridho K.',
    role: 'admin',
    phone: '+6289654623347',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    loginAccountStatus: 'AKTIF',
    isDemoAccount: false,
  },
];

interface AuthContextType {
  currentUser: StaffUser | null;
  staffUsers: StaffUser[];
  refreshStaffUsers: () => Promise<void>;
  loginAs: (staff: StaffUser) => { success: boolean; message?: string };
  loginWithCredentials: (
    email: string,
    pass: string
  ) => Promise<{ success: boolean; message?: string; mustChangePassword?: boolean; staff?: StaffUser }>;
  logout: () => Promise<void>;
  hasRole: (roles: UserRole[]) => boolean;
  isPasswordChangeRequired: boolean;
  clearPasswordChangeRequirement: (updatedStaff?: StaffUser) => void;
  isAuthLoading: boolean;
  authResolved: boolean;
  roleResolved: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(() => {
    const saved = localStorage.getItem('senzu_staff_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [staffUsers, setStaffUsers] = useState<StaffUser[]>(SAMPLE_STAFF_USERS);
  const [isPasswordChangeRequired, setIsPasswordChangeRequired] = useState<boolean>(false);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [authResolved, setAuthResolved] = useState<boolean>(false);
  const [roleResolved, setRoleResolved] = useState<boolean>(false);

  const currentUserRef = useRef<StaffUser | null>(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const refreshStaffUsers = useCallback(async () => {
    try {
      const users = await getStaffMasterUsers();
      setStaffUsers(users);

      // Enforce operational access deactivation:
      // If the currently logged-in user is deactivated in master data, revoke session immediately!
      const activeUser = currentUserRef.current;
      if (activeUser) {
        const found = users.find(
          (u) =>
            u.uid === activeUser.uid ||
            (Boolean(u.email) && Boolean(activeUser.email) && u.email.toLowerCase() === activeUser.email.toLowerCase())
        );
        if (
          found &&
          (found.isActive === false ||
            found.status === 'INACTIVE' ||
            found.loginAccountStatus === 'DINONAKTIFKAN')
        ) {
          console.warn(`Access revoked: staff user ${activeUser.name} was deactivated.`);
          setCurrentUser(null);
          localStorage.removeItem('senzu_staff_user');
          firebaseSignOut(auth).catch(() => {});
          alert(
            `Akses Operasional Dicabut:\nAkun staf Anda (${activeUser.name}) telah dinonaktifkan oleh Branch Manager. Sesi Anda dihentikan demi keamanan.`
          );
        } else if (found) {
          const activeHasCompleted =
            activeUser.mustChangePassword === false ||
            activeUser.loginAccountStatus === 'AKTIF' ||
            activeUser.firstLoginCompleted === true;

          // Update cached data if fields changed
          if (
            found.role !== activeUser.role ||
            found.displayName !== activeUser.displayName ||
            found.name !== activeUser.name ||
            (!activeHasCompleted && (
              found.mustChangePassword !== activeUser.mustChangePassword ||
              found.loginAccountStatus !== activeUser.loginAccountStatus
            ))
          ) {
            const safeUpdated: StaffUser = {
              ...found,
              mustChangePassword: activeHasCompleted ? false : found.mustChangePassword,
              loginAccountStatus: activeHasCompleted ? 'AKTIF' : found.loginAccountStatus,
              firstLoginCompleted: activeHasCompleted ? true : found.firstLoginCompleted,
            };
            setCurrentUser(safeUpdated);
            currentUserRef.current = safeUpdated;
            try {
              localStorage.setItem('senzu_staff_user', JSON.stringify(safeUpdated));
            } catch {}
          }

          if (activeHasCompleted) {
            setIsPasswordChangeRequired(false);
          } else if (found.mustChangePassword || found.loginAccountStatus === 'WAJIB_GANTI_PASSWORD') {
            setIsPasswordChangeRequired(true);
          } else {
            setIsPasswordChangeRequired(false);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to refresh staff users:', e);
    }
  }, []);

  useEffect(() => {
    refreshStaffUsers();
  }, [refreshStaffUsers]);

  // Listen to Firebase Auth state changes and authoritatively reconcile role and staff profile
  const lastReconciledUidRef = useRef<string | null>(null);
  const isReconcilingRef = useRef<boolean>(false);

  useEffect(() => {
    let active = true;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!active) return;

      if (firebaseUser) {
        if (isReconcilingRef.current || lastReconciledUidRef.current === firebaseUser.uid) {
          if (active) {
            setAuthResolved(true);
            setRoleResolved(true);
            setIsAuthLoading(false);
          }
          return;
        }

        isReconcilingRef.current = true;
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await fetch('/api/staff/reconcile', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              authUid: firebaseUser.uid,
              email: firebaseUser.email || '',
            }),
          });
          if (!active) return;

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.staff) {
              lastReconciledUidRef.current = firebaseUser.uid;
              setCurrentUser(data.staff);
              localStorage.setItem('senzu_staff_user', JSON.stringify(data.staff));
              if (
                data.staff.mustChangePassword === true ||
                data.staff.loginAccountStatus === 'WAJIB_GANTI_PASSWORD'
              ) {
                setIsPasswordChangeRequired(true);
              } else {
                setIsPasswordChangeRequired(false);
              }
              // Refresh staff users once without triggering loop
              refreshStaffUsers().catch(() => {});
            } else {
              // Inactive or unlinked staff
              setCurrentUser(null);
              localStorage.removeItem('senzu_staff_user');
            }
          } else {
            // Reconcile response not OK (e.g., quota or temporary server issue)
            // Fall back gracefully to cached session ONLY if UID strictly matches
            try {
              const cached = localStorage.getItem('senzu_staff_user');
              if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.authUserId === firebaseUser.uid) {
                  setCurrentUser(parsed);
                }
              }
            } catch {}
          }
        } catch (e) {
          console.warn('Session verification notice:', e);
          // Fall back gracefully to cached session ONLY if UID strictly matches
          try {
            const cached = localStorage.getItem('senzu_staff_user');
            if (cached) {
              const parsed = JSON.parse(cached);
              if (parsed && parsed.authUserId === firebaseUser.uid) {
                setCurrentUser(parsed);
              }
            }
          } catch {}
        } finally {
          isReconcilingRef.current = false;
        }
      } else {
        // No firebase user
        lastReconciledUidRef.current = null;
        setCurrentUser((prev) => {
          if (prev && !prev.isDemoAccount) {
            localStorage.removeItem('senzu_staff_user');
            return null;
          }
          return prev;
        });
      }
      if (active) {
        setAuthResolved(true);
        setRoleResolved(true);
        setIsAuthLoading(false);
      }
    });

    return () => {
      active = false;
      unsubAuth();
    };
  }, [refreshStaffUsers]);

  // Listen to Firestore real-time updates on active current user
  useEffect(() => {
    if (!currentUser?.uid) return;

    const unsub = onSnapshot(
      doc(db, 'staff_users', currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const live = snap.data() as StaffUser;
          if (
            live.isActive === false ||
            live.status === 'INACTIVE' ||
            live.loginAccountStatus === 'DINONAKTIFKAN'
          ) {
            console.warn(`Realtime session revoked: staff user ${live.name} deactivated.`);
            setCurrentUser(null);
            localStorage.removeItem('senzu_staff_user');
            firebaseSignOut(auth).catch(() => {});
            alert(
              `Akses Operasional Dinonaktifkan:\nAkun staf Anda (${live.name}) telah dinonaktifkan di Master Data Staff. Sesi login dihentikan.`
            );
          } else {
            setCurrentUser(live);
            if (live.mustChangePassword || live.loginAccountStatus === 'WAJIB_GANTI_PASSWORD') {
              setIsPasswordChangeRequired(true);
            } else {
              setIsPasswordChangeRequired(false);
            }
          }
        }
      },
      (err) => {
        console.warn('Realtime staff status listener notice:', err.message);
      }
    );

    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('senzu_staff_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('senzu_staff_user');
    }
  }, [currentUser]);

  const loginAs = (staff: StaffUser): { success: boolean; message?: string } => {
    // Check master data status
    const liveStaff =
      staffUsers.find(
        (u) =>
          u.uid === staff.uid ||
          (Boolean(u.email) && Boolean(staff.email) && u.email.toLowerCase() === staff.email.toLowerCase())
      ) || staff;

    if (
      liveStaff.isActive === false ||
      liveStaff.status === 'INACTIVE' ||
      liveStaff.loginAccountStatus === 'DINONAKTIFKAN'
    ) {
      return {
        success: false,
        message: `Akses Ditolak: Akun staf "${liveStaff.name}" berstatus NONAKTIF. Sesuai otoritas Master Data Manager, akun nonaktif tidak memiliki hak akses operasional.`,
      };
    }

    setCurrentUser(liveStaff);
    if (liveStaff.mustChangePassword || liveStaff.loginAccountStatus === 'WAJIB_GANTI_PASSWORD') {
      setIsPasswordChangeRequired(true);
    } else {
      setIsPasswordChangeRequired(false);
    }
    return { success: true };
  };

  const loginWithCredentials = async (
    email: string,
    pass: string
  ): Promise<{ success: boolean; message?: string; mustChangePassword?: boolean; staff?: StaffUser }> => {
    const trimmed = email.trim().toLowerCase();

    // 1. First attempt genuine Firebase Authentication
    let authUid = '';
    let authEmail = trimmed;
    let authIdToken = '';
    try {
      const cred = await signInWithEmailAndPassword(auth, trimmed, pass);
      authUid = cred.user.uid;
      authEmail = cred.user.email ? cred.user.email.toLowerCase() : trimmed;
      authIdToken = await cred.user.getIdToken();
    } catch (authError: any) {
      console.warn('Firebase Auth sign-in notice:', authError.code || authError.message);

      // Fallback for demo/development accounts in preview
      const liveUsers = staffUsers.length > 0 ? staffUsers : SAMPLE_STAFF_USERS;
      const foundDemo = liveUsers.find((u) => (u.email || '').toLowerCase() === trimmed && u.isDemoAccount);
      if (foundDemo) {
        if (
          foundDemo.isActive === false ||
          foundDemo.status === 'INACTIVE' ||
          foundDemo.loginAccountStatus === 'DINONAKTIFKAN'
        ) {
          return {
            success: false,
            message: 'Akun staf sedang tidak aktif.',
          };
        }
        const requiresPwdChange =
          foundDemo.mustChangePassword === true ||
          foundDemo.loginAccountStatus === 'WAJIB_GANTI_PASSWORD';

        setCurrentUser(foundDemo);
        setIsPasswordChangeRequired(requiresPwdChange);

        return {
          success: true,
          mustChangePassword: requiresPwdChange,
          staff: foundDemo,
        };
      }

      // Map Firebase errors to user-friendly Indonesian messages (Requirement 30)
      if (authError.code === 'auth/operation-not-allowed') {
        return {
          success: false,
          message: 'Login Email & Password belum diaktifkan pada konfigurasi Firebase.',
        };
      } else if (
        authError.code === 'auth/invalid-credential' ||
        authError.code === 'auth/wrong-password'
      ) {
        return {
          success: false,
          message: 'Email atau kata sandi tidak sesuai.',
        };
      } else if (authError.code === 'auth/user-disabled') {
        return {
          success: false,
          message: 'Akun staff tidak aktif. Hubungi Manager.',
        };
      } else if (authError.code === 'auth/user-not-found') {
        return {
          success: false,
          message: 'Akun otentikasi Firebase belum terdaftar. Hubungi Manager.',
        };
      } else if (authError.code === 'auth/too-many-requests') {
        return {
          success: false,
          message: 'Terlalu banyak percobaan gagal. Silakan tunggu beberapa saat atau atur ulang kata sandi.',
        };
      }

      return {
        success: false,
        message: 'Email atau kata sandi tidak sesuai.',
      };
    }

    // 2. Firebase Authentication succeeded! Reconcile with trusted backend authoritatively
    try {
      const idToken = authIdToken || (auth.currentUser ? await auth.currentUser.getIdToken() : '');
      const res = await fetch('/api/staff/reconcile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          authUid,
          email: authEmail,
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success || !result.staff) {
        await firebaseSignOut(auth).catch(() => {});
        return {
          success: false,
          message:
            result.message ||
            'Data akses staf sedang tidak dapat diverifikasi. Silakan coba kembali beberapa saat lagi.',
        };
      }

      const verifiedStaff = result.staff;
      const requiresPwdChange =
        verifiedStaff.mustChangePassword === true ||
        verifiedStaff.loginAccountStatus === 'WAJIB_GANTI_PASSWORD';

      lastReconciledUidRef.current = authUid;
      currentUserRef.current = verifiedStaff;
      setCurrentUser(verifiedStaff);
      localStorage.setItem('senzu_staff_user', JSON.stringify(verifiedStaff));
      setIsPasswordChangeRequired(requiresPwdChange);

      // Purge any stale customer localStorage keys to prevent identity leaking
      try {
        localStorage.removeItem('senzu_customer_phone');
        localStorage.removeItem('senzu_customer_name');
        localStorage.removeItem('senzu_current_customer');
        localStorage.removeItem('senzu_last_booking_code');
      } catch {}

      // Refresh master list in context now that permission is unlocked
      refreshStaffUsers().catch(() => {});

      return {
        success: true,
        mustChangePassword: requiresPwdChange,
        staff: verifiedStaff,
      };
    } catch (err: any) {
      console.warn('Staff reconciliation network notice:', err);
      await firebaseSignOut(auth).catch(() => {});
      return {
        success: false,
        message: 'Data akses staf sedang tidak dapat diverifikasi. Silakan coba kembali beberapa saat lagi.',
      };
    }
  };

  const logout = async (): Promise<void> => {
    try {
      // Execute genuine Firebase Auth signOut using the shared auth instance
      await firebaseSignOut(auth);
    } catch (err: any) {
      console.error('Firebase signOut technical error:', err);
      // Requirement 25: keep session intact on failure, rethrow to caller
      throw err;
    }

    // Terminate local staff session only after signOut succeeds
    setCurrentUser(null);
    setIsPasswordChangeRequired(false);
    try {
      localStorage.removeItem('senzu_staff_user');
      sessionStorage.removeItem('senzu_staff_user');
    } catch {
      // Safe fallback
    }
  };

  const hasRole = (roles: UserRole[]) => {
    if (!currentUser) return false;
    // Inactive user has NO permissions
    if (currentUser.isActive === false || currentUser.status === 'INACTIVE') return false;
    const normUserRole = (currentUser.role || '').toLowerCase().trim();
    if (normUserRole === 'admin' || normUserRole === 'manager') return true;
    return roles.map((r) => r.toLowerCase().trim()).includes(normUserRole);
  };

  const clearPasswordChangeRequirement = (updatedStaff?: StaffUser) => {
    setIsPasswordChangeRequired(false);
    const active = updatedStaff || (currentUserRef.current ? {
      ...currentUserRef.current,
      mustChangePassword: false,
      loginAccountStatus: 'AKTIF' as LoginAccountStatus,
      firstLoginCompleted: true,
    } : (currentUser ? {
      ...currentUser,
      mustChangePassword: false,
      loginAccountStatus: 'AKTIF' as LoginAccountStatus,
      firstLoginCompleted: true,
    } : null));

    if (active) {
      currentUserRef.current = active;
      setCurrentUser(active);
      try {
        localStorage.setItem('senzu_staff_user', JSON.stringify(active));
      } catch {}

      // Synchronize in-memory staffUsers state immediately
      setStaffUsers((prev) =>
        prev.map((u) =>
          u.uid === active.uid || u.id === active.uid || (u.email && active.email && u.email.toLowerCase() === active.email.toLowerCase())
            ? { ...u, mustChangePassword: false, loginAccountStatus: 'AKTIF', status: 'ACTIVE', isActive: true, firstLoginCompleted: true }
            : u
        )
      );

      // Synchronize localStorage master cache
      try {
        const cachedMaster = localStorage.getItem('senzu_staff_master_cache');
        if (cachedMaster) {
          const parsed = JSON.parse(cachedMaster);
          if (Array.isArray(parsed)) {
            const updatedList = parsed.map((item: any) =>
              item.uid === active.uid || item.id === active.uid || (item.email && active.email && item.email.toLowerCase() === active.email.toLowerCase())
                ? { ...item, mustChangePassword: false, loginAccountStatus: 'AKTIF', status: 'ACTIVE', isActive: true, firstLoginCompleted: true }
                : item
            );
            localStorage.setItem('senzu_staff_master_cache', JSON.stringify(updatedList));
          }
        }
      } catch {}
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        staffUsers,
        refreshStaffUsers,
        loginAs,
        loginWithCredentials,
        logout,
        hasRole,
        isPasswordChangeRequired,
        clearPasswordChangeRequirement,
        isAuthLoading,
        authResolved,
        roleResolved,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
