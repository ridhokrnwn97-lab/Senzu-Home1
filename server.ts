import { registerPaymentAcceptance, assertPaymentLink } from './src/server/paymentAcceptance.ts';
import { registerXenditSandbox } from './src/server/xenditSandbox.ts';
import { registerLoyaltyAccounts } from './src/server/loyaltyAccounts.ts';
import { randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { resolveNotificationTargets } from './src/lib/notificationTargets.ts';
import { DEFAULT_NOTIFICATION_SETTINGS } from './src/types/notification.ts';
import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import {
  getFirestore as clientGetFirestore,
  setLogLevel,
  collection as clientCollection,
  getDocs as clientGetDocs,
  doc as clientDoc,
  setDoc as clientSetDoc,
  getDoc as clientGetDoc,
  updateDoc as clientUpdateDoc,
  addDoc as clientAddDoc,
  query as clientQuery,
  where as clientWhere,
  limit as clientLimit,
  deleteDoc as clientDeleteDoc,
  runTransaction as clientRunTransaction
} from 'firebase/firestore';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
  signOut
} from 'firebase/auth';

dotenv.config();

// Dedicated Server-Side Firebase Admin SDK (Authoritative IAM-based credentials)
import {
  adminApp,
  adminAuth,
  adminDb,
  adminMessaging,
  projectId as adminProjectId,
  firestoreDatabaseId as adminDatabaseId,
  FieldValue
} from './src/server/firebaseAdmin.ts';
import {
  calculateHomeServiceFee,
  SENZU_BASE_LOCATION,
} from './src/lib/distanceFeeService.ts';
import {
  DEFAULT_LOYALTY_SETTINGS,
  DEFAULT_MEMBERSHIP_TIERS,
} from './src/types/loyalty.ts';

// Helper to normalize DocumentSnapshot across Firebase Admin SDK and client SDK conventions
function wrapDocSnap(snap: any) {
  if (!snap) return snap;
  if (typeof snap.exists === 'function') return snap;
  const isExists = Boolean(snap.exists);
  const existsFn = () => isExists;
  return new Proxy(snap, {
    get(target, prop, receiver) {
      if (prop === 'exists') return existsFn;
      return Reflect.get(target, prop, receiver);
    }
  });
}

// Helper to normalize QuerySnapshot across Firebase Admin SDK and client SDK conventions
function wrapQuerySnap(snap: any) {
  if (!snap) return snap;
  if (typeof snap.forEach === 'function' && Array.isArray(snap.docs) && snap.docs.length > 0 && typeof snap.docs[0]?.exists === 'function') {
    return snap;
  }
  const wrappedDocs = (snap.docs || []).map(wrapDocSnap);
  return {
    ...snap,
    empty: snap.empty,
    size: snap.size,
    docs: wrappedDocs,
    forEach: (cb: (doc: any) => void) => wrappedDocs.forEach(cb),
  };
}

// Authoritative Firestore helpers: Route all server operations through Firebase Admin SDK (adminDb)
const doc = (...args: any[]) => {
  const targetDb = adminDb;
  if (targetDb) {
    if (args.length === 3) {
      return targetDb.collection(args[1]).doc(args[2]);
    }
    if (args.length === 2) {
      if (typeof args[0] === 'object' && typeof args[0].doc === 'function') {
        return args[0].doc(args[1]);
      }
      return targetDb.doc(args[1]);
    }
  }
  return (clientDoc as any)(...args);
};

const collection = (...args: any[]) => {
  const targetDb = adminDb;
  if (targetDb) {
    if (args.length === 2) {
      return targetDb.collection(args[1]);
    }
    if (args.length === 1) {
      return targetDb.collection(args[0]);
    }
  }
  return (clientCollection as any)(...args);
};

const query = (target: any, ...constraints: any[]) => {
  if (!adminDb) {
    return (clientQuery as any)(target, ...constraints);
  }
  let res = target;
  for (const c of constraints) {
    if (typeof c === 'function') {
      res = c(res);
    }
  }
  return res;
};

const where = (field: string, op: any, value: any) => {
  if (!adminDb) return clientWhere(field, op, value);
  return (q: any) => q.where(field, op, value);
};

const limit = (num: number) => {
  if (!adminDb) return clientLimit(num);
  return (q: any) => q.limit(num);
};

const getDoc = async (docRef: any) => {
  if (typeof docRef?.get === 'function') {
    const snap = await docRef.get();
    return wrapDocSnap(snap);
  }
  return clientGetDoc(docRef);
};

const getDocs = async (queryRef: any) => {
  if (typeof queryRef?.get === 'function') {
    const snap = await queryRef.get();
    return wrapQuerySnap(snap);
  }
  return clientGetDocs(queryRef);
};

const setDoc = async (docRef: any, data: any, opts?: any) => {
  if (typeof docRef?.set === 'function') {
    return await docRef.set(data, opts || {});
  }
  return clientSetDoc(docRef, data, opts);
};

const updateDoc = async (docRef: any, data: any) => {
  if (typeof docRef?.update === 'function') {
    return await docRef.update(data);
  }
  return clientUpdateDoc(docRef, data);
};

const addDoc = async (colRef: any, data: any) => {
  if (typeof colRef?.add === 'function') {
    return await colRef.add(data);
  }
  return clientAddDoc(colRef, data);
};

const deleteDoc = async (docRef: any) => {
  if (typeof docRef?.delete === 'function') {
    return await docRef.delete();
  }
  return clientDeleteDoc(docRef);
};

const runTransaction = async (_db: any, updateFunction: any) => {
  if (adminDb && typeof adminDb.runTransaction === 'function') {
    return await adminDb.runTransaction(async (rawTx: any) => {
      const tx = {
        get: async (ref: any) => {
          const snap = await rawTx.get(ref);
          return wrapDocSnap(snap);
        },
        update: (ref: any, data: any) => rawTx.update(ref, data),
        set: (ref: any, data: any, opts?: any) => rawTx.set(ref, data, opts || {}),
        delete: (ref: any) => rawTx.delete(ref)
      };
      return await updateFunction(tx);
    });
  }
  return clientRunTransaction(_db, updateFunction);
};

// Structured Logging and Sanitization for Google Cloud Logging (Prompt 22)
function sanitizeMetadata(obj: any, depth = 0): any {
  if (depth > 3 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (obj.length > 300 && (obj.startsWith('data:') || /^[A-Za-z0-9+/=]{300,}$/.test(obj))) {
      return `[PAYLOAD_DATA: ${obj.length} chars]`;
    }
    if (obj.startsWith('Bearer ')) {
      return '[REDACTED_BEARER_TOKEN]';
    }
    if (obj.includes('@') && obj.includes('.')) {
      const parts = obj.split('@');
      return `${parts[0].slice(0, 2)}***@${parts[1]}`;
    }
    if (/^\+?[0-9]{9,15}$/.test(obj.trim())) {
      const p = obj.trim();
      return `${p.slice(0, 4)}****${p.slice(-4)}`;
    }
    return obj.length > 300 ? obj.slice(0, 300) + '...' : obj;
  }
  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('password') ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('authorization') ||
        lower.includes('cookie') ||
        lower.includes('key') ||
        lower.includes('cvv') ||
        lower.includes('credential') ||
        lower.includes('idtoken')
      ) {
        cleaned[key] = '[REDACTED]';
      } else if (
        lower.includes('account') ||
        lower.includes('rekening') ||
        lower.includes('card') ||
        lower.includes('pan')
      ) {
        cleaned[key] = '[REDACTED_ACCOUNT]';
      } else if (
        lower.includes('address') ||
        lower.includes('alamat')
      ) {
        cleaned[key] = '[REDACTED_ADDRESS]';
      } else if (
        lower.includes('coordinate') ||
        lower.includes('gps') ||
        lower === 'lat' ||
        lower === 'lng' ||
        lower === 'latitude' ||
        lower === 'longitude'
      ) {
        cleaned[key] = '[REDACTED_GPS]';
      } else {
        cleaned[key] = sanitizeMetadata(obj[key], depth + 1);
      }
    }
    return cleaned;
  }
  return obj;
}

export interface StructuredLogPayload {
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  event: string;
  requestId?: string;
  clientRequestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  latencyMs?: number;
  role?: string;
  authenticated?: boolean;
  userUid?: string;
  bookingId?: string;
  paymentId?: string;
  category?: string;
  message?: string;
  [key: string]: any;
}

function emitStructuredLog(logData: StructuredLogPayload) {
  const sanitized = sanitizeMetadata(logData);
  const cloudLog = {
    ...sanitized,
    userUidHash: logData.userUid ? logData.userUid.slice(0, 8) + '...' : undefined,
    userUid: undefined,
    cloudRunRevision: process.env.K_REVISION || undefined,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    timestamp: new Date().toISOString(),
  };

  if (logData.severity === 'ERROR' || logData.severity === 'CRITICAL') {
    console.error(JSON.stringify(cloudLog));
  } else if (logData.severity === 'WARNING') {
    console.warn(JSON.stringify(cloudLog));
  } else {
    console.log(JSON.stringify(cloudLog));
  }
}

async function startServer() {
  const app = express();
  // In AI Studio / Cloud Run, the container supervisor/nginx listens on external $PORT (8080)
  // and reverse-proxies requests internally to port 3000.
  // Express must always bind to 3000 to avoid conflicting with nginx or failing reverse-proxy routing.
  const PORT =
    process.env.APP_PORT
      ? parseInt(process.env.APP_PORT, 10)
      : process.env.PORT && process.env.PORT !== '8080'
      ? parseInt(process.env.PORT, 10)
      : 3000;

  // Configure trust proxy for Google Cloud Run / reverse proxy routing
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '5mb' }));

  // Production CORS and Security Headers Middleware
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isProduction = process.env.NODE_ENV === 'production';

    const trustedProductionOrigins = [
      'https://senzuhome.com',
      'https://www.senzuhome.com',
    ];

    if (origin) {
      if (trustedProductionOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else if (!isProduction) {
        // In development / preview, allow localhost, 127.0.0.1, or cloud preview domains
        if (
          origin.includes('.run.app') ||
          origin.includes('localhost') ||
          origin.includes('127.0.0.1')
        ) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
      }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Request-ID');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    next();
  });

  // Request Correlation ID and Latency Measurement Middleware
  app.use((req, res, next) => {
    const incomingReqId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
    const safeIncomingId =
      typeof incomingReqId === 'string' && /^[a-zA-Z0-9_\-.]{8,64}$/.test(incomingReqId)
        ? incomingReqId
        : '';
    const requestId =
      safeIncomingId ||
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

    (req as any).id = requestId;
    res.setHeader('X-Request-ID', requestId);

    const startHrTime = process.hrtime.bigint();

    res.on('finish', () => {
      // Only log API requests to avoid spamming logs with static Vite assets
      if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
        const latencyMs = Math.round(Number(process.hrtime.bigint() - startHrTime) / 1e6);
        const statusCode = res.statusCode;
        const severity = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARNING' : 'INFO';

        emitStructuredLog({
          severity,
          event: 'api_request_completed',
          requestId,
          method: req.method,
          path: req.baseUrl + req.path,
          statusCode,
          latencyMs,
          role: (req as any).verifiedRole,
          authenticated: Boolean((req as any).verifiedRole || (req as any).authUid),
          bookingId: (req as any).targetBookingId || (typeof req.body?.bookingId === 'string' ? req.body.bookingId : undefined),
        });
      }
    });

    next();
  });

  // Initialize Firebase server connection safely
  const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let firebaseConfig: any = {};
  if (fs.existsSync(firebaseConfigPath)) {
    try {
      firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
    } catch (e) {
      console.warn('Failed to parse firebase-applet-config.json:', e);
    }
  }

  // Trusted Staff Role Synchronizer: Authoritatively maps each staff member's Auth UID to /staff_roles/{authUserId} using Admin SDK
  let hasSyncedStaffRoles = false;
  async function syncStaffRoles(force = false) {
    if (!adminDb || (hasSyncedStaffRoles && !force)) return;
    try {
      hasSyncedStaffRoles = true;
      const snap = await adminDb.collection('staff_users').get();
      let synced = 0;
      for (const d of snap.docs) {
        const u = d.data() as any;
        const authUid = u.authUserId || u.authUid;
        if (authUid && typeof authUid === 'string' && authUid.trim().length > 5) {
          const isActive = u.isActive !== false && u.status !== 'INACTIVE' && u.loginAccountStatus !== 'DINONAKTIFKAN';

          // Ensure both authUid and authUserId are consistent in staff_users document
          if (!u.authUid || !u.authUserId) {
            await adminDb.collection('staff_users').doc(d.id).set({
              authUid: authUid,
              authUserId: authUid,
              updatedAt: new Date().toISOString(),
              updatedBy: 'trusted reconciliation system',
            }, { merge: true }).catch(() => {});
          }

          await adminDb.collection('staff_roles').doc(authUid).set({
            authUserId: authUid,
            staffId: u.uid || d.id,
            staffUserId: u.uid || d.id,
            therapistId: u.therapistId || u.uid || d.id,
            role: u.role || 'staff',
            name: u.name || '',
            email: u.email || '',
            status: isActive ? 'active' : 'inactive',
            isActive,
            branchId: u.branchId || 'PLG001',
            accountType: 'STAFF',
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(() => {});
          synced++;
        }
      }
      if (synced > 0) {
        console.log(`[Trusted RBAC] Synced ${synced} staff roles to /staff_roles collection via Admin SDK.`);
      }
    } catch (err: any) {
      // Quietly ignore quota or IAM limits during background startup sync
      console.warn('[Server RBAC] Admin startup sync notice:', err?.code || err?.message);
    }
  }

  let db: any = adminDb;
  let auth: any = null;
  try {
    const serverApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    if (!db) {
      db = firebaseConfig.firestoreDatabaseId
        ? clientGetFirestore(serverApp, firebaseConfig.firestoreDatabaseId)
        : clientGetFirestore(serverApp);
    }
    auth = getAuth(serverApp);

    // Suppress internal gRPC stream cancelation notices
    try {
      setLogLevel('error');
    } catch {}

    // Privileged server background operations now run via Firebase Admin SDK
    syncStaffRoles().catch((err) => console.error('[Server RBAC] Admin startup sync error:', err));
  } catch (initErr) {
    console.warn('Firebase server initialization warning:', initErr);
  }

  // Legacy helper replaced: Firebase Admin SDK manages privileged server credentials via Application Default Credentials
  async function ensureServerAuthenticated() {
    // No-op: Privileged operations utilize Firebase Admin SDK
  }

  /**
   * Cryptographically verifies a Firebase ID token.
   * Attempts Firebase Admin SDK first, then seamlessly falls back to Google Identity Toolkit REST API
   * using the project API key when running in environments where Admin IAM lacks Identity Toolkit permission.
   */
  async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string } | null> {
    if (!idToken || typeof idToken !== 'string') return null;
    const cleanToken = idToken.trim();
    if (!cleanToken) return null;

    // 1. Attempt verification with Firebase Admin SDK
    try {
      const decoded = await adminAuth.verifyIdToken(cleanToken);
      if (decoded && decoded.uid) {
        return {
          uid: decoded.uid,
          email: decoded.email ? decoded.email.trim().toLowerCase() : '',
        };
      }
    } catch (adminErr: any) {
      // Intentionally fall through to Google Identity Toolkit REST API
    }

    // 2. Fallback to Google Identity Toolkit REST API
    try {
      const apiKey = firebaseConfig?.apiKey;
      if (apiKey) {
        const resp = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: cleanToken }),
          }
        );
        if (resp.ok) {
          const data = (await resp.json()) as any;
          if (data && Array.isArray(data.users) && data.users[0]?.localId) {
            return {
              uid: data.users[0].localId,
              email: data.users[0].email ? data.users[0].email.trim().toLowerCase() : '',
            };
          }
        }
      }
    } catch (apiErr: any) {
      console.warn('[Auth] Identity Toolkit verification warning:', apiErr?.message);
    }

    return null;
  }

  // Baseline in-memory Staff Master repository (quota-resilient & authoritative fallback)
  const serverStaffMasterCache = new Map<string, any>();
  const BASE_STAFF_USERS = [
    {
      uid: 'staff-adm-01',
      employeeCode: 'ADM001',
      name: 'Ridho Kurniawan',
      displayName: 'Ridho K.',
      role: 'manager',
      email: 'ridhokrnwn97@gmail.com',
      phone: '+6289654623347',
      gender: 'Laki-laki',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-mgr-01',
      employeeCode: 'MGR001',
      name: 'Bambang Irawan',
      displayName: 'Bambang I.',
      role: 'manager',
      email: 'manager@senzuhome.com',
      phone: '+6281273445599',
      gender: 'Laki-laki',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-spv-01',
      employeeCode: 'SPV001',
      name: 'Hendra Wijaya',
      displayName: 'Hendra W.',
      role: 'supervisor',
      email: 'supervisor@senzuhome.com',
      phone: '+6281273445500',
      gender: 'Laki-laki',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-spv-02',
      employeeCode: 'SPV002',
      name: 'Budi Santoso',
      displayName: 'Budi S.',
      role: 'supervisor',
      email: 'spv@senzuhome.com',
      phone: '+6281234567890',
      gender: 'Laki-laki',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-css-01',
      employeeCode: 'CSS001',
      name: 'Siti Rahma',
      displayName: 'Siti R.',
      role: 'css',
      email: 'css@senzuhome.com',
      phone: '+6281298765432',
      gender: 'Perempuan',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-th-01',
      employeeCode: 'TH001',
      name: 'Dewi Sartika',
      displayName: 'Dewi S.',
      role: 'therapist',
      therapistId: 'th-dewi-sartika',
      email: 'dewi@senzuhome.com',
      phone: '+6281311223344',
      gender: 'Perempuan',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-th-02',
      employeeCode: 'TH002',
      name: 'Maya Indah',
      displayName: 'Maya I.',
      role: 'therapist',
      therapistId: 'th-maya-indah',
      email: 'maya@senzuhome.com',
      phone: '+6281355667788',
      gender: 'Perempuan',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-th-rina',
      employeeCode: 'TRP001',
      name: 'Rina Anggraini',
      displayName: 'Rina A.',
      role: 'therapist',
      therapistId: 'th-rina',
      email: 'rina@senzuhome.com',
      phone: '+6281273445501',
      gender: 'Perempuan',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-th-siti',
      employeeCode: 'TRP002',
      name: 'Siti Rahma',
      displayName: 'Siti R.',
      role: 'therapist',
      therapistId: 'th-siti',
      email: 'siti@senzuhome.com',
      phone: '+6281273445502',
      gender: 'Perempuan',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-th-budi',
      employeeCode: 'TRP003',
      name: 'Budi Santoso',
      displayName: 'Budi S.',
      role: 'therapist',
      therapistId: 'th-budi',
      email: 'budi@senzuhome.com',
      phone: '+6281273445503',
      gender: 'Laki-laki',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'staff-th-fauzi',
      employeeCode: 'TRP004',
      name: 'Ahmad Fauzi',
      displayName: 'Fauzi',
      role: 'therapist',
      therapistId: 'th-fauzi',
      email: 'fauzi@senzuhome.com',
      phone: '+6281273445504',
      gender: 'Laki-laki',
      isActive: true,
      status: 'ACTIVE',
      branchId: 'PLG001',
      branchName: 'Senzu Home Palembang R-01',
      loginAccountStatus: 'AKTIF',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  BASE_STAFF_USERS.forEach((st) => serverStaffMasterCache.set(st.uid, st));

  // Digital Asset Links for Android TWA (Trusted Web Activity)
  const ASSET_LINKS = [
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
      ],
      target: {
        namespace: 'android_app',
        package_name: 'com.ksbone.senzuhome',
        sha256_cert_fingerprints: [
          'E8:52:96:A2:4F:AC:D7:70:2C:D7:25:B5:38:70:D9:77:25:7E:99:BC:8E:5A:28:82:23:5D:E3:B4:FF:9C:D4:27',
          'BE:C0:5F:5E:23:B5:65:BF:A0:B0:4F:E5:13:DB:08:C5:88:31:55:37:E1:0B:6A:4E:A3:1D:C2:FA:F7:E1:2A:71',
        ],
      },
    },
  ];

  app.get('/.well-known/assetlinks.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(ASSET_LINKS);
  });

  // 1. Health Check (Lightweight, non-sensitive, zero DB overhead)
  app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      version: '1.0.0',
      revision: process.env.K_REVISION || 'local',
      requestId: (req as any).id,
    });
  });

  // Lightweight Authoritative Server Time & Payment Deadline Endpoint
  app.get('/api/server-time', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const now = new Date();
    res.json({
      serverTime: now.toISOString(),
      timestampMs: now.getTime(),
      deadlineMs: now.getTime() + 60 * 60 * 1000,
      deadlineIso: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    });
  });

  // Safe Client Error Ingestion Endpoint (Prompt 22 G: stdout/Cloud Logging, zero Firestore cost)
  const clientErrorRateLimit = new Map<string, { count: number; resetAt: number }>();

  app.post('/api/client-errors', (req, res) => {
    const requestId = (req as any).id || 'req_client';

    // Safe IP extraction compatible with Cloud Run and reverse proxies
    const rawForwarded = req.headers['x-forwarded-for'];
    const forwardedFirst = typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim() : '';
    const clientIp =
      (forwardedFirst && /^[0-9a-fA-F:.]+$/.test(forwardedFirst) ? forwardedFirst : '') ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();

    // Payload validation: Reject missing, non-object, or excessively large payloads
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, code: 'INVALID_PAYLOAD', message: 'Payload tidak valid.', requestId });
    }
    if (typeof req.body.messageSafe === 'string' && req.body.messageSafe.length > 2000) {
      return res.status(413).json({ success: false, code: 'PAYLOAD_TOO_LARGE', message: 'Ukuran pesan melebihi batas.', requestId });
    }

    // Rate limiting: max 30 reports per minute per client IP
    const currentRate = clientErrorRateLimit.get(clientIp);
    if (currentRate && now < currentRate.resetAt) {
      if (currentRate.count >= 30) {
        return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many reports', requestId });
      }
      currentRate.count++;
    } else {
      clientErrorRateLimit.set(clientIp, { count: 1, resetAt: now + 60000 });
    }

    const {
      event,
      messageSafe,
      category,
      severity,
      route,
      role,
      clientRequestId,
      browserFamily,
      deviceClass,
      onlineStatus,
    } = req.body || {};

    const msgCheck = String(messageSafe || '').toLowerCase();
    const isKnownBenign =
      msgCheck.includes('websocket closed without opened') ||
      msgCheck.includes('failed to connect to websocket');

    const catUpper = String(category || '').toUpperCase();
    const isProtectedCategory = ['AUTH', 'PERMISSION', 'FIRESTORE', 'STORAGE', 'PAYMENT', 'BOOKING', 'THERAPIST', 'GPS', 'MAPS'].includes(catUpper);

    if (isKnownBenign && !isProtectedCategory) {
      return res.json({ success: true, ignored: true, requestId });
    }

    const allowedCategories = [
      'AUTH', 'PERMISSION', 'FIRESTORE', 'STORAGE', 'PAYMENT', 'BOOKING',
      'THERAPIST', 'GPS', 'MAPS', 'NETWORK', 'PWA', 'NOTIFICATION',
      'VALIDATION', 'SERVER', 'UNKNOWN',
    ];

    const safeCategory = allowedCategories.includes(String(category).toUpperCase())
      ? String(category).toUpperCase()
      : 'UNKNOWN';

    const safeSeverity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' =
      ['INFO', 'WARNING', 'ERROR', 'CRITICAL'].includes(String(severity).toUpperCase())
        ? (String(severity).toUpperCase() as any)
        : 'ERROR';

    emitStructuredLog({
      severity: safeSeverity,
      event: typeof event === 'string' ? event.slice(0, 60) : 'client_error_reported',
      requestId,
      clientRequestId: typeof clientRequestId === 'string' ? clientRequestId.slice(0, 64) : undefined,
      category: safeCategory,
      message: typeof messageSafe === 'string' ? messageSafe.slice(0, 300) : 'Unknown client error',
      route: typeof route === 'string' ? route.slice(0, 100) : undefined,
      role: typeof role === 'string' ? role.slice(0, 30) : undefined,
      browserFamily: typeof browserFamily === 'string' ? browserFamily.slice(0, 50) : undefined,
      deviceClass: typeof deviceClass === 'string' ? deviceClass.slice(0, 30) : undefined,
      onlineStatus: typeof onlineStatus === 'boolean' ? onlineStatus : undefined,
    });

    res.json({ success: true, received: true, requestId });
  });

  // In-memory cache for staff role reconciliation to prevent redundant Firestore reads
  interface CachedStaffReconciliation {
    uid: string;
    staffUserId: string;
    role: string;
    status: string;
    branchId: string;
    verifiedAt: number;
    staff: any;
  }
  const reconciliationCache = new Map<string, CachedStaffReconciliation>();
  const RECONCILIATION_TTL_MS = 120 * 1000; // 2 minutes operational TTL

  // Trigger sync on server startup
  setTimeout(() => {
    syncStaffRoles().catch(() => {});
  }, 1000);

  // Authenticated endpoint to trigger staff role synchronization (Operational Staff / Admin only)
  app.post('/api/staff/sync-roles', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Autentikasi staf diperlukan untuk sinkronisasi role staf.',
        });
      }

      const idToken = authHeader.split('Bearer ')[1].trim();
      const verified = await verifyFirebaseIdToken(idToken);
      if (!verified || !verified.uid) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_TOKEN_INVALID',
          error: 'Token autentikasi tidak valid atau telah kadaluarsa.',
        });
      }

      // Assert caller has staff privileges (fail-closed RBAC)
      let callerRole = '';
      let isStaffActive = false;

      const cached = reconciliationCache.get(verified.uid);
      if (cached) {
        callerRole = cached.role;
        isStaffActive = cached.status === 'active' || cached.status === 'ACTIVE';
      } else if (adminDb) {
        try {
          const roleDoc = await adminDb.collection('staff_roles').doc(verified.uid).get();
          if (roleDoc.exists) {
            const rd = roleDoc.data() as any;
            callerRole = rd.role || '';
            isStaffActive = rd.isActive !== false && rd.status !== 'inactive' && rd.status !== 'INACTIVE';
          }
        } catch (e) {}

        if (!callerRole) {
          try {
            const snap = await adminDb.collection('staff_users')
              .where('authUserId', '==', verified.uid)
              .limit(1)
              .get();
            if (!snap.empty) {
              const sd = snap.docs[0].data();
              callerRole = sd.role || '';
              isStaffActive = sd.isActive !== false && sd.status !== 'INACTIVE';
            }
          } catch (e) {}
        }
      }

      if (!callerRole || !isStaffActive || (callerRole !== 'admin' && callerRole !== 'manager')) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Akses Ditolak: Hanya Manager atau Admin aktif yang berwenang melakukan sinkronisasi role staf.',
        });
      }

      await syncStaffRoles(true);
      res.json({ success: true, message: 'Sinkronisasi role staf berhasil.', role: callerRole });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Gagal sinkronisasi role staf.' });
    }
  });

  // Authoritative Endpoint: Provide verified Firebase Auth session token for staff operations
  app.post('/api/staff/session-token', async (req, res) => {
    try {
      await ensureServerAuthenticated();
      if (!auth?.currentUser) {
        return res.status(500).json({ error: 'Server authentication not ready.' });
      }
      const token = await auth.currentUser.getIdToken(true);
      return res.json({ success: true, token });
    } catch (err: any) {
      console.error('Failed to issue staff session token:', err);
      return res.status(500).json({ error: 'Gagal memperoleh token sesi staf.' });
    }
  });

  // Rate limiting map for /api/staff/check-email (sliding 60s window per client IP)
  const staffCheckRateLimit = new Map<string, { count: number; resetAt: number }>();

  // Authoritative Endpoint: Verify if an email is available for customer registration
  // (Prevents staff identity collision while exposing ZERO staff enumeration metadata)
  app.post('/api/staff/check-email', async (req, res) => {
    // Safe client IP extraction
    const rawForwarded = req.headers['x-forwarded-for'];
    const forwardedFirst = typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim() : '';
    const clientIp =
      (forwardedFirst && /^[0-9a-fA-F:.]+$/.test(forwardedFirst) ? forwardedFirst : '') ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();

    // 1. Rate limiting: max 30 checks per minute per IP to prevent enumeration
    const currentRate = staffCheckRateLimit.get(clientIp);
    if (currentRate && now < currentRate.resetAt) {
      if (currentRate.count >= 30) {
        return res.status(429).json({
          availableForCustomerRegistration: false,
          error: 'RATE_LIMITED',
          message: 'Terlalu banyak permintaan verifikasi. Silakan tunggu sebentar dan coba lagi.',
        });
      }
      currentRate.count++;
    } else {
      staffCheckRateLimit.set(clientIp, { count: 1, resetAt: now + 60000 });
    }

    const { email } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({
        availableForCustomerRegistration: false,
        error: 'INVALID_EMAIL',
        message: 'Alamat email tidak valid.',
      });
    }

    try {
      // 2. Authoritative check: Server-side Staff Master cache
      // (Covers active production staff source used by staff authentication)
      for (const staff of serverStaffMasterCache.values()) {
        const staffEmail = (staff.email || '').trim().toLowerCase();
        if (staffEmail === cleanEmail) {
          return res.json({ availableForCustomerRegistration: false });
        }
      }

      // 3. Authoritative check: Persistent Firestore collections (therapists, staff_users, staff_roles)
      if (db) {
        // A. therapists collection (publicly readable master directory)
        try {
          const qTh = query(collection(db, 'therapists'), where('email', '==', cleanEmail), limit(1));
          const snapTh = await getDocs(qTh);
          if (!snapTh.empty) {
            return res.json({ availableForCustomerRegistration: false });
          }
        } catch (thErr: any) {
          if (thErr?.code === 'unavailable' || thErr?.code === 'deadline-exceeded') {
            return res.status(503).json({
              availableForCustomerRegistration: false,
              error: 'SERVICE_UNAVAILABLE',
              message: 'Sistem verifikasi pendaftaran sedang sibuk atau mengalami kendala jaringan. Silakan coba beberapa saat lagi.',
            });
          }
        }

        // B. staff_users collection (if readable with operational context)
        try {
          const qStaff = query(collection(db, 'staff_users'), where('email', '==', cleanEmail), limit(1));
          const snapStaff = await getDocs(qStaff);
          if (!snapStaff.empty) {
            return res.json({ availableForCustomerRegistration: false });
          }
        } catch (staffErr: any) {
          if (staffErr?.code === 'unavailable' || staffErr?.code === 'deadline-exceeded') {
            return res.status(503).json({
              availableForCustomerRegistration: false,
              error: 'SERVICE_UNAVAILABLE',
              message: 'Sistem verifikasi pendaftaran sedang sibuk atau mengalami kendala jaringan. Silakan coba beberapa saat lagi.',
            });
          }
          // Permission-denied is caught gracefully, falling back to serverStaffMasterCache
        }

        // C. staff_roles collection (if readable with operational context)
        try {
          const qRoles = query(collection(db, 'staff_roles'), where('email', '==', cleanEmail), limit(1));
          const snapRoles = await getDocs(qRoles);
          if (!snapRoles.empty) {
            return res.json({ availableForCustomerRegistration: false });
          }
        } catch (rolesErr: any) {
          if (rolesErr?.code === 'unavailable' || rolesErr?.code === 'deadline-exceeded') {
            return res.status(503).json({
              availableForCustomerRegistration: false,
              error: 'SERVICE_UNAVAILABLE',
              message: 'Sistem verifikasi pendaftaran sedang sibuk atau mengalami kendala jaringan. Silakan coba beberapa saat lagi.',
            });
          }
        }
      }

      // 4. No staff record exists in any authoritative data source
      return res.json({ availableForCustomerRegistration: true });
    } catch (err: any) {
      console.error('[CheckStaffEmail] Unexpected error during verification:', err?.message || err);
      // FAIL-SAFE: Return temporary service error
      return res.status(503).json({
        availableForCustomerRegistration: false,
        error: 'SERVICE_UNAVAILABLE',
        message: 'Sistem verifikasi pendaftaran sedang sibuk atau mengalami kendala jaringan. Silakan coba beberapa saat lagi.',
      });
    }
  });

  // Resolve only an existing UID-bound Staff Master record. Email is metadata,
  // never an authorization/linking key. Reads and allowed writes commit together.
  async function reconcileUidBoundStaff(verifiedUid: string, verifiedEmail: string, activateFirstLogin = false) {
    const deny = (statusCode: number, code: string, message: string) =>
      Object.assign(new Error(message), { staffIdentityDenied: true, statusCode, code });
    const textId = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    if (typeof verifiedUid !== 'string' || !verifiedUid.trim() || verifiedUid !== verifiedUid.trim()) {
      throw deny(401, 'AUTH_TOKEN_INVALID', 'Sesi autentikasi tidak valid. Silakan masuk kembali.');
    }
    if (!adminDb) throw new Error('Authoritative staff database unavailable');

    return adminDb.runTransaction(async (transaction) => {
      const canonical = await transaction.get(adminDb.collection('staff_users').where('authUserId', '==', verifiedUid).limit(2));
      const legacy = await transaction.get(adminDb.collection('staff_users').where('authUid', '==', verifiedUid).limit(2));
      const direct = await transaction.get(adminDb.collection('staff_users').doc(verifiedUid));
      const roleRef = adminDb.collection('staff_roles').doc(verifiedUid);
      const roleSnap = await transaction.get(roleRef);
      const matches = new Map<string, any>();
      for (const found of [...canonical.docs, ...legacy.docs]) matches.set(found.id, found);
      if (direct.exists) matches.set(direct.id, direct);
      if (matches.size === 0) {
        throw deny(403, 'STAFF_NOT_REGISTERED', 'Akun belum tertaut ke Master Staff. Silakan hubungi Manager.');
      }
      if (matches.size !== 1) {
        throw deny(409, 'MULTIPLE_STAFF_MATCH', 'Identitas staf memiliki lebih dari satu profil. Hubungi Manager untuk pemeriksaan.');
      }
      const staffSnap = [...matches.values()][0];
      const staff = staffSnap.data();
      const uidConflict = (record: any) => [record.authUserId, record.authUid].some(value =>
        value != null && value !== '' && (typeof value !== 'string' || textId(value) !== verifiedUid));
      if (uidConflict(staff) || (staffSnap.id !== verifiedUid &&
          textId(staff.authUserId) !== verifiedUid && textId(staff.authUid) !== verifiedUid)) {
        throw deny(403, 'STAFF_UID_MISMATCH', 'Identitas staf tidak sesuai dengan sesi autentikasi.');
      }
      const disabled = (record: any) => record.isActive === false || record.loginEnabled === false ||
        ['INACTIVE', 'DISABLED', 'ARCHIVED', 'DINONAKTIFKAN', 'DELETED', 'TERMINATED']
          .includes(textId(record.status).toUpperCase()) ||
        textId(record.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';
      if (disabled(staff)) throw deny(403, 'STAFF_INACTIVE', 'Akun staf sedang tidak aktif.');
      const role = roleSnap.exists ? roleSnap.data() : null;
      if (role) {
        if (uidConflict(role)) throw deny(403, 'STAFF_UID_MISMATCH', 'Identitas role staf tidak sesuai dengan sesi.');
        if (role.isActive !== true || disabled(role)) throw deny(403, 'STAFF_INACTIVE', 'Akun staf sedang tidak aktif.');
        const aliases = new Set([verifiedUid, staffSnap.id, textId(staff.uid), textId(staff.id)].filter(Boolean));
        for (const linkedId of [role.staffId, role.staffUserId]) {
          if (linkedId != null && linkedId !== '' && (typeof linkedId !== 'string' || !aliases.has(textId(linkedId)))) {
            throw deny(409, 'STAFF_ROLE_MAPPING_CONFLICT', 'Referensi role staf memerlukan pemeriksaan Manager.');
          }
        }
      } else if (staff.isActive !== true && textId(staff.status).toUpperCase() !== 'ACTIVE') {
        throw deny(403, 'STAFF_INACTIVE', 'Status aktif staf belum dapat diverifikasi.');
      }
      const canonicalRole = staff.role || 'staff';
      if (!['manager', 'admin', 'supervisor', 'css', 'therapist', 'staff'].includes(canonicalRole)) {
        throw deny(403, 'STAFF_ROLE_INVALID', 'Role staf belum dapat diverifikasi. Hubungi Manager.');
      }
      const now = new Date().toISOString();
      const uidBackfilled = !staff.authUserId || !staff.authUid;
      const staffUpdates: Record<string, any> = {};
      if (uidBackfilled) Object.assign(staffUpdates, {
        authUserId: verifiedUid,
        authUid: verifiedUid,
        updatedAt: now,
        updatedBy: 'trusted admin reconciliation',
      });
      if (activateFirstLogin) Object.assign(staffUpdates, {
        mustChangePassword: false,
        firstLoginCompleted: true,
        firstLoginCompletedAt: staff.firstLoginCompletedAt || now,
        loginAccountStatus: 'AKTIF',
        passwordChangedAt: now,
        lastLoginAt: now,
        updatedAt: now,
        authUserId: verifiedUid,
        authUid: verifiedUid,
        updatedBy: staff.name || 'Sistem Aktivasi Staf',
      });
      if (Object.keys(staffUpdates).length) transaction.update(staffSnap.ref, staffUpdates);
      transaction.set(roleRef, {
        authUserId: verifiedUid,
        staffId: staffSnap.id,
        staffUserId: staffSnap.id,
        therapistId: staff.therapistId || staff.uid || staffSnap.id,
        role: canonicalRole,
        name: staff.name || '',
        email: staff.email || verifiedEmail || '',
        status: 'active',
        isActive: true,
        branchId: staff.branchId || 'PLG001',
        accountType: 'STAFF',
        updatedAt: now,
      }, { merge: true });
      return {
        staffDocId: staffSnap.id as string,
        canonicalRole,
        now,
        uidBackfilled,
        resolvedStaff: {
          ...staff,
          ...staffUpdates,
          id: staffSnap.id,
          uid: staff.uid || staffSnap.id,
          authUserId: verifiedUid,
          authUid: verifiedUid,
          role: canonicalRole,
        },
      };
    });
  }

  // Trusted Endpoint: Reconcile authenticated Firebase user with Staff Master & /staff_roles using Firebase Admin SDK
  app.post('/api/staff/reconcile', async (req, res) => {
    // 1. Authoritative Firebase ID Token Extraction
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_TOKEN_MISSING',
        message: 'Token otentikasi tidak ditemukan. Silakan masuk kembali.',
      });
    }

    const idToken = authHeader.split('Bearer ')[1]?.trim();
    if (!idToken) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_TOKEN_MISSING',
        message: 'Token otentikasi tidak valid.',
      });
    }

    // 2. Cryptographically verify Firebase ID token (never trust client body parameters)
    const verifiedAuth = await verifyFirebaseIdToken(idToken);
    if (!verifiedAuth || !verifiedAuth.uid) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Sesi autentikasi telah kedaluwarsa atau tidak valid.',
      });
    }

    const verifiedUid = verifiedAuth.uid;
    const verifiedEmail = verifiedAuth.email;

    try {
      // Cached sessions cannot claim unbound profiles or skip current UID checks.
      const resolved = await reconcileUidBoundStaff(verifiedUid, verifiedEmail);
      const { staffDocId, canonicalRole, resolvedStaff } = resolved;
      serverStaffMasterCache.set(staffDocId, resolvedStaff);
      reconciliationCache.set(verifiedUid, {
        uid: verifiedUid,
        staffUserId: staffDocId,
        role: canonicalRole,
        status: 'active',
        branchId: resolvedStaff.branchId || 'PLG001',
        verifiedAt: Date.now(),
        staff: resolvedStaff,
      });
      console.log(`[STAFF_ROLE_RECONCILED] Verified staff ${verifiedUid} as role ${canonicalRole}`);
      return res.json({
        success: true,
        reconciled: resolved.uidBackfilled,
        role: canonicalRole,
        staff: resolvedStaff,
      });
    } catch (err: any) {
      reconciliationCache.delete(verifiedUid);
      if (err.staffIdentityDenied === true) {
        return res.status(err.statusCode).json({ success: false, code: err.code, message: err.message });
      }
      console.error(`[STAFF_AUTHORIZATION_ERROR] Staff identity lookup unavailable:`, err?.code);
      return res.status(503).json({
        success: false,
        code: 'STAFF_AUTHORIZATION_UNAVAILABLE',
        message: 'Data akses staf sedang tidak dapat diverifikasi. Silakan coba kembali beberapa saat lagi.',
      });
    }
  });

  // Trusted Endpoint: Complete staff first-time password change and account activation (Server-Authoritative)
  app.post('/api/staff/complete-first-login', async (req, res) => {
    let verifiedUid = '';
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          message: 'Sesi login telah berakhir. Silakan masuk kembali.',
        });
      }

      const idToken = authHeader.split('Bearer ')[1]?.trim();
      if (!idToken) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          message: 'Sesi login telah berakhir. Silakan masuk kembali.',
        });
      }

      // 1. Authoritatively verify Firebase ID Token via Google Identity Toolkit
      let verifiedEmail = '';
      try {
        const resp = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          }
        );
        const data = (await resp.json()) as any;
        if (!resp.ok || !data.users || !data.users[0]) {
          return res.status(401).json({
            success: false,
            code: 'SESSION_EXPIRED',
            message: 'Sesi login telah berakhir. Silakan masuk kembali.',
          });
        }
        verifiedUid = data.users[0].localId;
        verifiedEmail = (data.users[0].email || '').toLowerCase().trim();
      } catch (err: any) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_VERIFICATION_FAILED',
          message: 'Sesi login telah berakhir. Silakan masuk kembali.',
        });
      }

      if (!verifiedUid) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_TOKEN',
          message: 'Sesi login tidak valid atau telah berakhir. Silakan masuk kembali.',
        });
      }

      // Finish only a currently UID-bound account; no email or memory claim.
      const { staffDocId, canonicalRole, resolvedStaff, now } =
        await reconcileUidBoundStaff(verifiedUid, verifiedEmail, true);
      const matchedData = resolvedStaff;
      serverStaffMasterCache.set(staffDocId, resolvedStaff);
      reconciliationCache.delete(staffDocId);
      reconciliationCache.set(verifiedUid, {
        uid: verifiedUid,
        staffUserId: staffDocId,
        role: canonicalRole,
        status: 'active',
        branchId: resolvedStaff.branchId || 'PLG001',
        verifiedAt: Date.now(),
        staff: resolvedStaff,
      });

      // 7. Record administrative audit log (Requirement 24: NEVER log password)
      try {
        await addDoc(collection(db, 'admin_audit_logs'), sanitizeForFirestore({
          actorId: staffDocId,
          actorRole: canonicalRole,
          actorName: matchedData.name || 'Staf',
          action: 'staff_account.first_login_completed',
          entityType: 'staff',
          entityId: staffDocId,
          newValue: JSON.stringify({ mustChangePassword: false, loginAccountStatus: 'AKTIF' }),
          summary: `Aktivasi akun pertama kali untuk staf "${matchedData.name}" (${canonicalRole.toUpperCase()}) berhasil diselesaikan.`,
          createdAt: now,
        }));
      } catch (auditErr) {
        // Non-blocking for activation
      }

      return res.json({
        success: true,
        message: 'Kata sandi baru berhasil disimpan dan akun staf Anda telah aktif.',
        staff: resolvedStaff,
        role: canonicalRole,
      });
    } catch (err: any) {
      if (err.staffIdentityDenied === true) {
        reconciliationCache.delete(verifiedUid);
        return res.status(err.statusCode).json({ success: false, code: err.code, message: err.message });
      }
      reconciliationCache.delete(verifiedUid);
      console.error('[CompleteFirstLogin] Unexpected error:', err);
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Perubahan kata sandi berhasil, tetapi aktivasi akun belum selesai. Silakan coba kembali.',
      });
    }
  });

  // Protected Server Endpoint for Atomic Therapist Order Acceptance (Prompt 19)
  // Protected Server Endpoint for Authoritative Atomic Therapist Order Acceptance (Prompt 19 & 19A)
  app.post('/api/therapist/accept-order', async (req, res) => {
    try {
      const { bookingId } = req.body || {};
      const requestId = (req as any).id;
      const authHeader = req.headers.authorization;
      const tokenMatch = typeof authHeader === 'string' ? /^Bearer\s+(\S+)$/i.exec(authHeader.trim()) : null;
      if (!tokenMatch) {
        return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: 'Sesi terapis diperlukan untuk menerima pesanan.', requestId });
      }

      let verifiedUid = '';
      try {
        const decoded = await adminAuth.verifyIdToken(tokenMatch[1]);
        verifiedUid = decoded?.uid || '';
      } catch {}
      if (!verifiedUid) {
        return res.status(401).json({ success: false, code: 'AUTH_TOKEN_INVALID', message: 'Sesi terapis tidak valid. Silakan masuk kembali.', requestId });
      }
      (req as any).authUid = verifiedUid;
      if (typeof bookingId !== 'string' || !bookingId.trim() || bookingId.includes('/')) {
        return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'ID Pemesanan wajib disertakan.', requestId });
      }
      (req as any).targetBookingId = bookingId;
      await ensureServerAuthenticated();
      if (!adminDb || !db) {
        return res.status(500).json({ success: false, code: 'SERVER_UNAVAILABLE', message: 'Database server tidak tersedia.', requestId });
      }

      let resolvedTherapistId = '';
      let resolvedTherapistName = 'Terapis';
      const bookingRef = doc(db, 'bookings', bookingId);
      const now = new Date().toISOString();
      let updatedBookingData: any = null;

      // Step 9, 10, 11: Atomic transaction for authoritative validation and update
      try {
        await runTransaction(db, async (transaction) => {
          // Resolve and revalidate identity inside the same authoritative transaction.
          const textId = (value: unknown) => typeof value === 'string' ? value.trim() : '';
          const hasConflictingUid = (data: any) => [data.authUserId, data.authUid]
            .some((value) => textId(value) && textId(value) !== verifiedUid);
          const isDisabled = (data: any) => data.isActive === false ||
            ['INACTIVE', 'DISABLED', 'ARCHIVED', 'DINONAKTIFKAN'].includes(textId(data.status).toUpperCase()) ||
            textId(data.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';

          const roleSnap = await transaction.get(doc(db, 'staff_roles', verifiedUid));
          if (!roleSnap.exists()) throw new Error('PERMISSION_DENIED');
          const roleData = roleSnap.data();
          if (roleData.role !== 'therapist' || roleData.isActive !== true || isDisabled(roleData) || hasConflictingUid(roleData)) {
            throw new Error('PERMISSION_DENIED');
          }

          const canonicalSnap = await transaction.get(query(collection(db, 'staff_users'), where('authUserId', '==', verifiedUid), limit(2)));
          const legacySnap = await transaction.get(query(collection(db, 'staff_users'), where('authUid', '==', verifiedUid), limit(2)));
          const directStaffSnap = await transaction.get(doc(db, 'staff_users', verifiedUid));
          const staffDocs = new Map<string, any>();
          for (const candidate of [...canonicalSnap.docs, ...legacySnap.docs]) staffDocs.set(candidate.id, candidate);
          if (directStaffSnap.exists()) staffDocs.set(directStaffSnap.id, directStaffSnap);
          if (staffDocs.size !== 1) throw new Error('PERMISSION_DENIED');
          const staffDoc = [...staffDocs.values()][0];
          const staff = staffDoc.data();
          if (hasConflictingUid(staff) || staff.role !== 'therapist') throw new Error('PERMISSION_DENIED');
          if (isDisabled(staff)) throw new Error('ACCOUNT_DISABLED');
          if (staffDoc.id !== verifiedUid && textId(staff.authUserId) !== verifiedUid && textId(staff.authUid) !== verifiedUid) {
            throw new Error('PERMISSION_DENIED');
          }

          const staffAliases = new Set([verifiedUid, staffDoc.id, textId(staff.uid), textId(staff.id)].filter(Boolean));
          for (const linkedStaffId of [roleData.staffId, roleData.staffUserId]) {
            if (textId(linkedStaffId) && !staffAliases.has(textId(linkedStaffId))) throw new Error('PERMISSION_DENIED');
          }
          const masterTherapistId = textId(staff.therapistId);
          const roleTherapistId = textId(roleData.therapistId);
          resolvedTherapistId = masterTherapistId || roleTherapistId || textId(staff.uid) || staffDoc.id;
          if (!resolvedTherapistId || resolvedTherapistId.includes('/')) throw new Error('PERMISSION_DENIED');
          const therapistSnap = await transaction.get(doc(db, 'therapists', resolvedTherapistId));
          const therapistData = therapistSnap.exists() ? therapistSnap.data() : null;
          if (therapistData) {
            if (isDisabled(therapistData)) throw new Error('ACCOUNT_DISABLED');
            if (hasConflictingUid(therapistData) ||
                (textId(therapistData.staffId) && !staffAliases.has(textId(therapistData.staffId))) ||
                (textId(therapistData.id) && textId(therapistData.id) !== resolvedTherapistId)) {
              throw new Error('PERMISSION_DENIED');
            }
          }
          // An optional therapist document may add evidence, never an email/name match.
          if (!masterTherapistId && !staffAliases.has(resolvedTherapistId) &&
              !(therapistData && (textId(therapistData.authUserId) === verifiedUid ||
                textId(therapistData.authUid) === verifiedUid || staffAliases.has(textId(therapistData.staffId))))) {
            throw new Error('PERMISSION_DENIED');
          }
          const trustedTherapistIds = new Set([...staffAliases, resolvedTherapistId]);
          if (roleTherapistId && !trustedTherapistIds.has(roleTherapistId)) throw new Error('PERMISSION_DENIED');
          resolvedTherapistName = textId(staff.name) || textId(staff.fullName) || 'Terapis';

          const snap = await transaction.get(bookingRef);
          if (!snap.exists()) {
            throw new Error('BOOKING_NOT_FOUND');
          }
          const bData = snap.data();

          // Check if cancelled
          if (bData.status === 'Cancelled') {
            throw new Error('ALREADY_CANCELLED');
          }

          // Check if completed
          if (bData.status === 'Completed') {
            throw new Error('ALREADY_COMPLETED');
          }

          // Check if already accepted
          if (['Accepted', 'On The Way', 'Arrived', 'Treatment', 'Completed'].includes(bData.status)) {
            throw new Error('ALREADY_ACCEPTED');
          }

          // Exact persisted assignment must match server-resolved identity, including safe legacy aliases.
          const assignedIds = [textId(bData.therapistId), textId(bData.assignedTherapistId)].filter(Boolean);
          if (!assignedIds.length) throw new Error('THERAPIST_NOT_ASSIGNED');
          if (assignedIds.some((assignedId) => !trustedTherapistIds.has(assignedId))) throw new Error('REASSIGNED_TO_OTHER');
          (req as any).verifiedRole = 'therapist';

          const updatePayload = {
            status: 'Accepted',
            acceptedAt: now,
            acceptedBy: resolvedTherapistName,
            updatedAt: now,
          };

          transaction.update(bookingRef, updatePayload);
          updatedBookingData = { ...bData, ...updatePayload, id: bookingId };
        });
      } catch (txErr: any) {
        const msg = txErr?.message || '';
        emitStructuredLog({
          severity: 'WARNING',
          event: 'therapist_order_conflict',
          requestId,
          bookingId,
          role: 'therapist',
          therapistId: resolvedTherapistId,
          conflictReason: msg,
        });
        if (msg === 'PERMISSION_DENIED') {
          return res.status(403).json({ success: false, code: 'PERMISSION_DENIED', message: 'Hanya terapis aktif yang ditugaskan dapat menerima pesanan.', requestId });
        }
        if (msg === 'ACCOUNT_DISABLED') {
          return res.status(403).json({ success: false, code: 'ACCOUNT_DISABLED', message: 'Akun terapis sedang tidak aktif.', requestId });
        }
        if (msg === 'THERAPIST_NOT_ASSIGNED') {
          return res.status(409).json({ success: false, code: 'THERAPIST_NOT_ASSIGNED', message: 'Pesanan belum ditugaskan kepada terapis.', requestId });
        }
        if (msg === 'ALREADY_CANCELLED') {
          return res.status(409).json({ success: false, code: 'ALREADY_CANCELLED', message: 'Pesanan telah dibatalkan.', requestId });
        }
        if (msg === 'ALREADY_ACCEPTED') {
          return res.status(409).json({ success: false, code: 'ALREADY_ACCEPTED', message: 'Pesanan ini sudah diterima.', requestId });
        }
        if (msg === 'ALREADY_COMPLETED') {
          return res.status(409).json({ success: false, code: 'ALREADY_COMPLETED', message: 'Pesanan telah selesai.', requestId });
        }
        if (msg === 'REASSIGNED_TO_OTHER') {
          return res.status(409).json({ success: false, code: 'REASSIGNED_TO_OTHER', message: 'Pesanan sudah dialihkan ke terapis lain.', requestId });
        }
        if (msg === 'BOOKING_NOT_FOUND') {
          return res.status(404).json({ success: false, code: 'BOOKING_NOT_FOUND', message: 'Pesanan tidak ditemukan.', requestId });
        }
        throw txErr;
      }

      // Step 12 & 18: Safe asynchronous secondary operations (Status history & audit log)
      if (updatedBookingData) {
        await recordAcceptedOrderStatusHistory({
          bookingId,
          bookingCode: updatedBookingData.bookingCode || '',
          therapistId: resolvedTherapistId,
          therapistName: resolvedTherapistName || 'Terapis',
          actorUid: verifiedUid,
          acceptedAt: now,
        }).catch((e) => console.warn('History write notice:', e));
      }

      emitStructuredLog({
        severity: 'INFO',
        event: 'therapist_order_accepted',
        requestId,
        bookingId,
        role: 'therapist',
        therapistId: resolvedTherapistId,
        therapistName: resolvedTherapistName,
      });

      return res.json({
        success: true,
        message: 'Pesanan berhasil diterima.',
        booking: updatedBookingData,
        requestId,
      });
    } catch (err: any) {
      const requestId = (req as any).id;
      emitStructuredLog({
        severity: 'ERROR',
        event: 'therapist_accept_order_failed',
        requestId,
        bookingId: req.body?.bookingId,
        role: 'therapist',
        message: err?.message || 'Unexpected accept-order failure',
      });
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Pesanan belum dapat diterima. Silakan coba kembali.',
        requestId,
      });
    }
  });

  // Authoritative Therapist Availability & Roster Update Endpoint
  app.post('/api/therapist/update-availability', async (req, res) => {
    try {
      const { therapistId, therapistName, date, status, unavailableReason, note, actor } = req.body || {};
      if (!therapistId || !status) {
        return res.status(400).json({ success: false, message: 'therapistId dan status wajib diisi.' });
      }

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ success: false, message: 'Database server tidak tersedia.' });
      }

      const targetDate = date || new Date().toISOString().split('T')[0];
      const rosterId = `${therapistId}_${targetDate}`;
      const now = new Date().toISOString();

      const rosterRef = adminDb.collection('therapist_rosters').doc(rosterId);
      const existingSnap = await rosterRef.get();
      const existingData = existingSnap.exists ? existingSnap.data() : null;

      const updatedRoster = {
        id: rosterId,
        therapistId,
        therapistName: therapistName || existingData?.therapistName || 'Terapis',
        date: targetDate,
        shiftStart: existingData?.shiftStart || '10:00',
        shiftEnd: existingData?.shiftEnd || '21:00',
        status,
        breaks: existingData?.breaks || [],
        unavailableReason: unavailableReason || '',
        note: note || '',
        createdAt: existingData?.createdAt || now,
        updatedAt: now,
        updatedBy: actor || therapistName || 'Terapis',
      };

      await rosterRef.set(updatedRoster, { merge: true });

      // Also sync therapist status in therapists collection if it matches
      const thStatusMap: Record<string, string> = {
        scheduled: 'available',
        working: 'available',
        break: 'break',
        off: 'off',
      };
      if (thStatusMap[status]) {
        await adminDb.collection('therapists').doc(therapistId).update({
          status: thStatusMap[status],
          updatedAt: now,
        }).catch(() => {});
      }

      // Record operational audit log
      const logId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await adminDb.collection('operational_audit_logs').doc(logId).set({
        id: logId,
        therapistId,
        therapistName: therapistName || 'Terapis',
        action: 'shift_change',
        actorRole: 'therapist',
        actorName: actor || therapistName || 'Terapis',
        oldValue: existingData?.status || 'unknown',
        newValue: status,
        reason: unavailableReason || `Perubahan status shift ke ${status}`,
        note: note || `Roster tanggal ${targetDate}`,
        timestamp: now,
      }).catch(() => {});

      return res.json({ success: true, roster: updatedRoster });
    } catch (err: any) {
      console.error('[API /api/therapist/update-availability] error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Gagal memperbarui status ketersediaan.' });
    }
  });

  registerPaymentAcceptance(app, adminDb, token => adminAuth!.verifyIdToken(token));

  // Isolated Test ledger only; reuse the current Stage 7D Manager identity policy.
  registerXenditSandbox(app, {
    db: adminDb,
    verify: token => {
      if (!adminAuth) throw Object.assign(new Error('Auth unavailable'), { code: 'auth/internal-error' });
      return adminAuth.verifyIdToken(token);
    },
    authorizeManager: async (transaction, uid) => {
      const [roleSnap, canonical, legacy, direct] = await Promise.all([
        transaction.get(adminDb.collection('staff_roles').doc(uid)),
        transaction.get(adminDb.collection('staff_users').where('authUserId', '==', uid).limit(2)),
        transaction.get(adminDb.collection('staff_users').where('authUid', '==', uid).limit(2)),
        transaction.get(adminDb.collection('staff_users').doc(uid)),
      ]);
      const matches = new Map<string, any>();
      for (const snap of [...canonical.docs, ...legacy.docs, ...(direct.exists ? [direct] : [])]) matches.set(snap.id, snap);
      const role = roleSnap.data() || {};
      for (const linked of [role.staffId, role.staffUserId]) {
        if (typeof linked === 'string' && isValidStage7dDocId(linked, 128) && !matches.has(linked)) {
          const snap = await transaction.get(adminDb.collection('staff_users').doc(linked));
          if (snap.exists) matches.set(snap.id, snap);
        }
      }
      const result = validateStage7dActiveManagerIdentity(uid, roleSnap.exists, role, matches);
      if (!result.ok) throw Object.assign(new Error(result.message || 'Akses Manager/Admin diperlukan.'), {
        status: result.status || 403, code: result.code || 'MANAGER_ROLE_REQUIRED',
      });
      return result;
    },
  });

  // Loyalty point earning + account provisioning run server-side; Firestore rules keep client writes staff-only.
  const loyaltyAccounts = registerLoyaltyAccounts(app, adminDb, token => adminAuth!.verifyIdToken(token));

  // Protected Server Endpoint for Payment Verification (Prompt 18 Phase 5)
  app.post('/api/payments/:paymentId/verify', async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { bookingId, note } = req.body || {};
      const requestId = (req as any).id;

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ error: 'Database server tidak tersedia.', requestId });
      }

      // Authoritative verification of staff caller via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Autentikasi staf diperlukan untuk memverifikasi pembayaran.', requestId });
      }
      const token = authHeader.split('Bearer ')[1]?.trim();
      const verified = await adminAuth?.verifyIdToken(token).catch(() => null);
      if (!verified || !verified.uid) {
        return res.status(401).json({ error: 'Sesi atau token autentikasi staf tidak valid.', requestId });
      }
      const staffAuthUid = verified.uid;

      // Authoritative identity derivation: Lookup staff role directly from trusted /staff_roles
      const roleDoc = await adminDb.collection('staff_roles').doc(staffAuthUid).get();
      if (!roleDoc.exists) {
        return res.status(403).json({ error: 'Identitas staf tidak terdaftar dalam otorisasi sistem.', requestId });
      }
      const roleData = roleDoc.data() as any;
      if (!roleData.isActive) {
        return res.status(403).json({ error: 'Akun staf dinonaktifkan.', requestId });
      }
      if (!['css', 'supervisor', 'manager', 'admin'].includes(roleData.role)) {
        return res.status(403).json({ error: 'Akses Ditolak: Hanya CSS, Supervisor, atau Manager yang berwenang memverifikasi pembayaran.', requestId });
      }

      const verifiedByStaffId = roleData.staffId || roleData.authUserId || staffAuthUid;
      const verifiedByName = roleData.name || 'Staff Senzu';
      const verifiedByRole = roleData.role;

      const paymentRef = adminDb.collection('payments').doc(paymentId);
      const now = new Date().toISOString();

      const result = await adminDb.runTransaction(async (t) => {
        const paymentSnap = await t.get(paymentRef);
        if (!paymentSnap.exists) {
          throw { status: 404, message: 'Data pembayaran tidak ditemukan.' };
        }
        const payment = paymentSnap.data() as any;

        // Authoritative linkage: Resolve booking strictly from persisted payment record
        if (bookingId && bookingId !== payment.bookingId) {
          throw { status: 400, message: 'ID reservasi pada permintaan tidak sesuai dengan catatan pembayaran tersimpan.' };
        }
        const targetBookingId = payment.bookingId;
        if (!targetBookingId) {
          throw { status: 400, message: 'Data pembayaran tidak memiliki ID reservasi yang valid.' };
        }

        const bookingRef = adminDb.collection('bookings').doc(targetBookingId);
        const bookingSnap = await t.get(bookingRef);
        if (!bookingSnap.exists) {
          throw { status: 404, message: 'Data reservasi tidak ditemukan.' };
        }
        const booking = bookingSnap.data() as any;

        assertPaymentLink(payment, booking);
        // Idempotency: If already paid, return early without re-recording duplicate audit events
        if (payment.status === 'paid') {
          return {
            isIdempotent: true,
            targetBookingId: payment.bookingId,
            payment: { id: paymentSnap.id, ...payment }
          };
        }

        // Cannot verify expired or rejected payments
        if (payment.status === 'expired' || payment.status === 'payment_rejected') {
          throw { status: 400, message: `Pembayaran dalam status ${payment.status} tidak dapat diverifikasi.` };
        }

        // 1. Authoritative Payment Update inside transaction
        t.update(paymentRef, {
          status: 'paid',
          verifiedBy: verifiedByStaffId,
          verifiedByName: verifiedByName,
          verifiedByRole: verifiedByRole,
          verifiedAt: now,
          paidAt: payment.paidAt || now,
          verificationNotes: note || 'Pembayaran diverifikasi secara manual oleh CSS Senzu Home.',
          updatedAt: now
        });

        // 2. Authoritative Booking Update inside transaction
        const isAwaitingPayment = booking.status === 'Menunggu Pembayaran' || booking.status === 'awaiting_payment';
        const nextBookingStatus = isAwaitingPayment ? 'Confirmed' : booking.status;
        t.update(bookingRef, {
          paymentStatus: 'PAID',
          status: nextBookingStatus,
          paymentVerifiedAt: now,
          paymentVerifiedBy: verifiedByName,
          updatedAt: now
        });

        // 3. Append to payment_status_history inside transaction
        const histRef = adminDb.collection('payment_status_history').doc();
        t.set(histRef, {
          paymentId: paymentSnap.id,
          bookingId: targetBookingId,
          bookingCode: booking.bookingCode || '',
          oldStatus: payment.status,
          newStatus: 'paid',
          source: verifiedByRole,
          userId: verifiedByStaffId,
          userName: verifiedByName,
          userRole: verifiedByRole,
          eventType: 'payment_verified',
          note: note || `Pembayaran diverifikasi oleh ${verifiedByName} (${verifiedByRole.toUpperCase()}). Nominal: Rp${(payment.amount || 0).toLocaleString('id-ID')}`,
          createdAt: now
        });

        // 4. Append to operational_audit_logs inside transaction
        const auditRef = adminDb.collection('operational_audit_logs').doc();
        t.set(auditRef, {
          action: 'payment.verified',
          entityId: paymentSnap.id,
          entityType: 'payment',
          actorId: verifiedByStaffId,
          actorName: verifiedByName,
          actorRole: verifiedByRole,
          details: {
            bookingId: targetBookingId,
            bookingCode: booking.bookingCode,
            amount: payment.amount,
            verificationNotes: note || ''
          },
          createdAt: now
        });

        return {
          isIdempotent: false,
          targetBookingId,
          bookingCode: booking.bookingCode,
          amount: payment.amount,
          nextBookingStatus,
          payment: { id: paymentSnap.id, ...payment, status: 'paid', verifiedAt: now }
        };
      });

      // Loyalty: payment is often confirmed *after* the treatment is completed, so this path must credit too.
      // Idempotent and detached: it can never change or delay the verification response.
      loyaltyAccounts.creditBookingLoyalty(result.targetBookingId).catch((e) => console.warn('[Loyalty] post-verify earning failed:', e?.code || e?.message || e));

      if (result.isIdempotent) {
        return res.json({
          success: true,
          message: 'Pembayaran sudah terverifikasi sebelumnya (Idempoten).',
          isIdempotent: true,
          payment: result.payment,
          requestId,
        });
      }

      (req as any).targetBookingId = result.targetBookingId;
      (req as any).verifiedRole = verifiedByRole;

      emitStructuredLog({
        severity: 'INFO',
        event: 'payment_verified',
        requestId,
        paymentId,
        bookingId: result.targetBookingId,
        role: verifiedByRole,
        staffId: verifiedByStaffId,
        amount: result.amount,
      });

      return res.json({
        success: true,
        message: 'Pembayaran berhasil diverifikasi dan reservasi dikonfirmasi.',
        verifiedAt: now,
        nextBookingStatus: result.nextBookingStatus,
        payment: result.payment,
        requestId,
      });
    } catch (err: any) {
      const requestId = (req as any).id;
      const status = err.status || 500;
      emitStructuredLog({
        severity: 'ERROR',
        event: 'payment_verify_failed',
        requestId,
        paymentId: req.params?.paymentId,
        bookingId: req.body?.bookingId,
        message: err.message || 'Gagal memverifikasi pembayaran.',
      });
      return res.status(status).json({ error: err.message || 'Gagal memverifikasi pembayaran.', requestId });
    }
  });

  // Protected Server Endpoint for Payment Rejection
  app.post('/api/payments/:paymentId/reject', async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { bookingId, reason, note } = req.body || {};
      const requestId = (req as any).id;

      if (!reason) {
        return res.status(400).json({ error: 'Alasan penolakan pembayaran wajib diisi.', requestId });
      }

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ error: 'Database server tidak tersedia.', requestId });
      }

      // Authoritative verification of staff caller via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Autentikasi staf diperlukan untuk menolak pembayaran.', requestId });
      }
      const token = authHeader.split('Bearer ')[1]?.trim();
      const verified = await adminAuth?.verifyIdToken(token).catch(() => null);
      if (!verified || !verified.uid) {
        return res.status(401).json({ error: 'Sesi atau token autentikasi staf tidak valid.', requestId });
      }
      const staffAuthUid = verified.uid;

      // Authoritative identity derivation from trusted /staff_roles
      const roleDoc = await adminDb.collection('staff_roles').doc(staffAuthUid).get();
      if (!roleDoc.exists) {
        return res.status(403).json({ error: 'Identitas staf tidak terdaftar dalam otorisasi sistem.', requestId });
      }
      const roleData = roleDoc.data() as any;
      if (!roleData.isActive) {
        return res.status(403).json({ error: 'Akun staf dinonaktifkan.', requestId });
      }
      if (!['css', 'supervisor', 'manager', 'admin'].includes(roleData.role)) {
        return res.status(403).json({ error: 'Akses Ditolak: Hanya CSS, Supervisor, atau Manager yang berwenang menolak pembayaran.', requestId });
      }

      const verifiedByStaffId = roleData.staffId || roleData.authUserId || staffAuthUid;
      const verifiedByName = roleData.name || 'Staff Senzu';
      const verifiedByRole = roleData.role;

      const paymentRef = adminDb.collection('payments').doc(paymentId);
      const now = new Date().toISOString();

      const result = await adminDb.runTransaction(async (t) => {
        const paymentSnap = await t.get(paymentRef);
        if (!paymentSnap.exists) {
          throw { status: 404, message: 'Data pembayaran tidak ditemukan.' };
        }
        const payment = paymentSnap.data() as any;

        // Authoritative linkage: Resolve booking strictly from persisted payment record
        if (bookingId && bookingId !== payment.bookingId) {
          throw { status: 400, message: 'ID reservasi pada permintaan tidak sesuai dengan catatan pembayaran tersimpan.' };
        }
        const targetBookingId = payment.bookingId;
        if (!targetBookingId) {
          throw { status: 400, message: 'Data pembayaran tidak memiliki ID reservasi yang valid.' };
        }

        const bookingRef = adminDb.collection('bookings').doc(targetBookingId);
        const bookingSnap = await t.get(bookingRef);
        const booking = bookingSnap.exists ? (bookingSnap.data() as any) : null;

        assertPaymentLink(payment, booking);
        // Idempotency: If already rejected, return early without re-recording duplicate events
        if (payment.status === 'payment_rejected') {
          return {
            isIdempotent: true,
            targetBookingId: payment.bookingId,
            payment: { id: paymentSnap.id, ...payment }
          };
        }

        // A confirmed/paid payment CANNOT be rejected
        if (payment.status === 'paid') {
          throw { status: 400, message: 'Pembayaran yang sudah terverifikasi (paid) tidak dapat ditolak.' };
        }

        t.update(paymentRef, {
          status: 'payment_rejected',
          rejectedBy: verifiedByStaffId,
          rejectedByName: verifiedByName,
          rejectedAt: now,
          rejectionReason: reason,
          rejectionNote: note || '',
          updatedAt: now
        });

        if (bookingSnap.exists) {
          t.update(bookingRef, {
            paymentStatus: 'payment_rejected',
            updatedAt: now
          });
        }

        const histRef = adminDb.collection('payment_status_history').doc();
        t.set(histRef, {
          paymentId: paymentSnap.id,
          bookingId: targetBookingId,
          bookingCode: booking?.bookingCode || '',
          oldStatus: payment.status,
          newStatus: 'payment_rejected',
          source: verifiedByRole,
          userId: verifiedByStaffId,
          userName: verifiedByName,
          userRole: verifiedByRole,
          eventType: 'payment_rejected',
          note: `Ditolak: ${reason}. ${note || ''}`.trim(),
          createdAt: now
        });

        return {
          isIdempotent: false,
          targetBookingId,
          payment: { id: paymentSnap.id, ...payment, status: 'payment_rejected', rejectedAt: now }
        };
      });

      if (result.isIdempotent) {
        return res.json({
          success: true,
          message: 'Pembayaran sudah dalam status ditolak (Idempoten).',
          isIdempotent: true,
          payment: result.payment,
          requestId,
        });
      }

      (req as any).targetBookingId = result.targetBookingId;
      (req as any).verifiedRole = verifiedByRole;

      emitStructuredLog({
        severity: 'WARNING',
        event: 'payment_rejected',
        requestId,
        paymentId,
        bookingId: result.targetBookingId,
        role: verifiedByRole,
        staffId: verifiedByStaffId,
        reason,
      });

      return res.json({
        success: true,
        message: 'Pembayaran berhasil ditolak.',
        payment: result.payment,
        requestId,
      });
    } catch (err: any) {
      const requestId = (req as any).id;
      const status = err.status || 500;
      emitStructuredLog({
        severity: 'ERROR',
        event: 'payment_reject_failed',
        requestId,
        paymentId: req.params?.paymentId,
        bookingId: req.body?.bookingId,
        message: err.message || 'Gagal menolak pembayaran.',
      });
      return res.status(status).json({ error: err.message || 'Gagal menolak pembayaran.', requestId });
    }
  });

  // Authoritative Server Endpoint for Payment Expiry Enforcement (Prompt — 60-Minute Payment Deadline)
  app.post('/api/payments/:paymentId/expire', async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { bookingId } = req.body || {};
      const requestId = (req as any).id;

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ error: 'Database server tidak tersedia.', requestId });
      }

      // Authoritative verification of caller via Bearer token (entry guard)
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Autentikasi diperlukan untuk memproses kedaluwarsa pembayaran.', requestId });
      }
      const token = authHeader.split('Bearer ')[1]?.trim();
      const verified = await adminAuth?.verifyIdToken(token).catch(() => null);
      if (!verified || !verified.uid) {
        return res.status(401).json({ error: 'Sesi autentikasi tidak valid atau telah kedaluwarsa.', requestId });
      }
      const callerUid = verified.uid;

      // Staff authorization check: Must satisfy the explicit role policy (merely having an active staff record is insufficient)
      let isAuthorizedStaff = false;
      const roleDoc = await adminDb.collection('staff_roles').doc(callerUid).get();
      if (roleDoc.exists) {
        const roleData = roleDoc.data() as any;
        if (roleData?.isActive && ['css', 'supervisor', 'manager', 'admin'].includes(roleData.role)) {
          isAuthorizedStaff = true;
        }
      }

      const paymentRef = adminDb.collection('payments').doc(paymentId);


      const result = await adminDb.runTransaction(async (t) => {
        const paymentSnap = await t.get(paymentRef);
        if (!paymentSnap.exists) {
          throw { status: 404, message: 'Data pembayaran tidak ditemukan.' };
        }
        const payment = paymentSnap.data() as any;

        // Authoritative linkage: Resolve booking strictly from persisted payment record
        if (bookingId && bookingId !== payment.bookingId) {
          throw { status: 400, message: 'ID reservasi pada permintaan tidak sesuai dengan catatan pembayaran tersimpan.' };
        }
        const targetBookingId = payment.bookingId;
        if (!targetBookingId) {
          throw { status: 400, message: 'Data pembayaran tidak memiliki ID reservasi yang valid.' };
        }

        const bookingRef = adminDb.collection('bookings').doc(targetBookingId);
        const bookingSnap = await t.get(bookingRef);
        const booking = bookingSnap.exists ? (bookingSnap.data() as any) : null;

        assertPaymentLink(payment, booking, isAuthorizedStaff ? undefined : callerUid);

        // Rule 5: VERY IMPORTANT — DO NOT EXPIRE AFTER PROOF UPLOAD OR CONFIRMATION
        // Once valid payment proof has been uploaded or if already paid, DO NOT expire
        if (
          payment.status === 'paid' ||
          payment.status === 'pending_manual_verification' ||
          Boolean(payment.paymentProofUrl)
        ) {
          return {
            expired: false,
            status: payment.status,
            message: 'Bukti pembayaran sudah diunggah atau telah terverifikasi, batas waktu tidak menyebabkan kadaluarsa.'
          };
        }

        // Idempotency: If already expired, return idempotent success
        if (payment.status === 'expired') {
          return {
            expired: true,
            status: 'expired',
            message: 'Waktu pembayaran telah berakhir.'
          };
        }

        // Authoritative deadline from persisted record
        const authoritativeDeadline = payment.paymentDeadline || booking?.paymentDeadline;

        // LEGACY: Bookings/payments without paymentDeadline preserve existing behavior
        // Remove automatic legacy expiry based solely on createdAt + 60 minutes
        if (!authoritativeDeadline) {
          return {
            expired: false,
            status: payment.status,
            message: 'Catatan legacy tanpa batas waktu pembayaran tidak kadaluarsa secara otomatis.'
          };
        }

        const deadlineDate = new Date(authoritativeDeadline);
        if (isNaN(deadlineDate.getTime())) {
          throw { status: 400, message: 'Format batas waktu pembayaran tidak valid.' };
        }

        const now = new Date();
        const nowIso = now.toISOString();
        // Check authoritative boundary: At or after deadline without proof
        // Never expire early (no -5000 defect)
        if (now.getTime() < deadlineDate.getTime()) {
          return {
            expired: false,
            remainingMs: deadlineDate.getTime() - now.getTime(),
            paymentDeadline: authoritativeDeadline,
            status: payment.status,
            message: 'Batas waktu pembayaran belum berakhir.'
          };
        }

        // Update payment record to expired inside transaction
        t.update(paymentRef, {
          status: 'expired',
          paymentDeadline: authoritativeDeadline,
          expiredAt: nowIso,
          updatedAt: nowIso,
        });

        // Update booking paymentStatus to expired (DO NOT modify booking status to Cancelled!)
        if (bookingSnap?.exists) {
          t.update(bookingRef, {
            paymentStatus: 'expired',
            paymentExpiredAt: nowIso,
            paymentDeadline: authoritativeDeadline,
            updatedAt: nowIso,
          });
        }

        // Record immutable payment event (NO false Cancelled booking history!)
        const histRef = adminDb.collection('payment_status_history').doc();
        t.set(histRef, {
          paymentId: paymentSnap.id,
          bookingId: targetBookingId,
          bookingCode: booking?.bookingCode || payment.bookingCode || '',
          oldStatus: payment.status,
          newStatus: 'expired',
          source: 'system',
          eventType: 'payment_expired',
          note: 'Waktu pembayaran telah berakhir (60 menit tanpa bukti pembayaran).',
          createdAt: nowIso,
        });

        return {
          expired: true,
          status: 'expired',
          paymentDeadline: authoritativeDeadline,
          message: 'Waktu pembayaran telah berakhir.',
          targetBookingId,
        };
      });

      if (result.expired && (result as any).targetBookingId) {
        emitStructuredLog({
          severity: 'INFO',
          event: 'payment_expired',
          requestId,
          paymentId,
          bookingId: (result as any).targetBookingId,
          paymentDeadline: result.paymentDeadline,
        });
      }

      return res.json({
        success: true,
        ...result,
        requestId,
      });
    } catch (err: any) {
      const requestId = (req as any).id;
      const status = err.status || 500;
      emitStructuredLog({
        severity: 'ERROR',
        event: 'payment_expire_failed',
        requestId,
        paymentId: req.params?.paymentId,
        bookingId: req.body?.bookingId,
        message: err.message || 'Gagal memproses kedaluwarsa pembayaran.',
      });
      return res.status(status).json({ error: err.message || 'Gagal memproses kedaluwarsa pembayaran.', requestId });
    }
  });

  // =============================================================
  // STAGE 7D: AUTHORITATIVE ADMIN PAYMENT CORRECTION &
  // MANAGER MANUAL REFUND STATUS GOVERNANCE
  // Finding 6: payment_status_history WRITES
  // Finding 11: Direct Client Payment Corrections
  // =============================================================

  const STAGE7D_ALLOWED_PAYMENT_STATUS_CODES = new Set<string>([
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

  const STAGE7D_ALLOWED_REFUND_STATUSES = new Set<string>([
    'APPROVED',
    'PROCESSING_MANUAL',
    'COMPLETED_MANUAL',
    'REJECTED',
  ]);

  const STAGE7D_CORRECTION_ALLOWED_BODY_KEYS = new Set<string>([
    'paymentId',
    'bookingId',
    'bookingCode',
    'newStatus',
    'reason',
    'requestId',
    'staffId',
    'staffName',
    'actorId',
    'actorName',
    'actorRole',
  ]);

  const STAGE7D_MANUAL_REFUND_ALLOWED_BODY_KEYS = new Set<string>([
    'caseId',
    'caseCode',
    'caseItem',
    'bookingId',
    'bookingCode',
    'paymentId',
    'newStatus',
    'refundAmount',
    'refundMethod',
    'refundDate',
    'refundReference',
    'refundProofUrl',
    'note',
    'requestId',
    'actorId',
    'actorName',
    'actorRole',
    'staffId',
    'staffName',
  ]);

  function isValidStage7dDocId(value: unknown, maxLen = 128): value is string {
    return (
      typeof value === 'string' &&
      value.length >= 1 &&
      value.length <= maxLen &&
      value.trim() === value &&
      !value.includes('/') &&
      !/[\x00-\x1F\x7F\s]/.test(value)
    );
  }

  function isValidStage7dBookingCode(value: unknown, maxLen = 64): value is string {
    return (
      isValidStage7dDocId(value, maxLen) &&
      value.length >= 3 &&
      !/^bk_/i.test(value) &&
      /^[A-Z0-9_-]+$/.test(value)
    );
  }

  function sanitizeStage7dText(value: unknown, maxLen = 250): string {
    if (typeof value !== 'string') return '';
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen);
  }

  function isValidStage7dDateString(value: string): boolean {
    if (!value || value.length < 8 || value.length > 40) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map((n) => parseInt(n, 10));
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      );
    }
    return !Number.isNaN(Date.parse(value));
  }

  function formatStage7dWIB(date: Date): string {
    const wibMs = date.getTime() + 7 * 60 * 60 * 1000;
    const d = new Date(wibMs);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'Mei',
      'Jun',
      'Jul',
      'Agu',
      'Sep',
      'Okt',
      'Nov',
      'Des',
    ];
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = months[d.getUTCMonth()] || 'Jan';
    const year = d.getUTCFullYear();
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day} ${month} ${year}, ${hours}:${minutes} WIB`;
  }

  function setStage7dNoStore(res: express.Response): void {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store');
    } else if (typeof (res as any).set === 'function') {
      (res as any).set('Cache-Control', 'no-store');
    }
  }

  function computePaymentCorrectionFingerprint(params: {
    actorUid: string;
    paymentId: string;
    bookingId: string;
    newStatus: string;
    reason: string;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          v: 1,
          action: 'payment_correct',
          actorUid: params.actorUid,
          paymentId: params.paymentId,
          bookingId: params.bookingId,
          newStatus: params.newStatus,
          reason: params.reason,
        })
      )
      .digest('hex');
  }

  function computeStage7dResponseFingerprint(value: unknown): string {
    const canonicalize = (item: any): any => {
      if (Array.isArray(item)) return item.map(canonicalize);
      if (item !== null && typeof item === 'object') {
        return Object.fromEntries(
          Object.keys(item).sort().map((key) => [key, canonicalize(item[key])])
        );
      }
      return item;
    };
    const plain = JSON.parse(JSON.stringify(value));
    return createHash('sha256').update(JSON.stringify(canonicalize(plain))).digest('hex');
  }

  function computeManualRefundFingerprint(params: {
    actorUid: string;
    caseId: string;
    newStatus: string;
    refundAmount: number | null;
    refundMethod: string;
    refundDate: string;
    refundReference: string;
    refundProofUrl: string;
    note: string;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          v: 1,
          action: 'manual_refund_status',
          actorUid: params.actorUid,
          caseId: params.caseId,
          newStatus: params.newStatus,
          refundAmount: params.refundAmount,
          refundMethod: params.refundMethod,
          refundDate: params.refundDate,
          refundReference: params.refundReference,
          refundProofUrl: params.refundProofUrl,
          note: params.note,
        })
      )
      .digest('hex');
  }

  async function verifyStage7dBearerToken(
    req: express.Request
  ): Promise<{
    ok: boolean;
    uid?: string;
    status?: 401 | 503;
    code?: string;
    message?: string;
  }> {
    const headersObj =
      req.headers && typeof req.headers === 'object'
        ? (req.headers as Record<string, unknown>)
        : {};
    let authHeaderCount = 0;
    let rawAuthHeader: unknown = undefined;
    for (const [k, v] of Object.entries(headersObj)) {
      const lower = k.toLowerCase();
      if (lower === 'x-firebase-auth') {
        return {
          ok: false,
          status: 401,
          code: 'AUTH_HEADER_INVALID',
          message: 'Header autentikasi tidak valid.',
        };
      }
      if (lower === 'authorization') {
        authHeaderCount++;
        rawAuthHeader = v;
      }
    }

    if (authHeaderCount !== 1 || typeof rawAuthHeader !== 'string') {
      return {
        ok: false,
        status: 401,
        code: 'AUTH_REQUIRED',
        message: 'Autentikasi Manager/Admin diperlukan.',
      };
    }

    const match = /^Bearer\s+(\S+)$/i.exec(rawAuthHeader.trim());
    if (!match || !match[1]) {
      return {
        ok: false,
        status: 401,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Format token autentikasi tidak valid.',
      };
    }

    if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
      return {
        ok: false,
        status: 503,
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Layanan verifikasi autentikasi sedang tidak tersedia.',
      };
    }

    try {
      const decoded = await adminAuth.verifyIdToken(match[1]);
      if (!decoded || !isValidStage7dDocId(decoded.uid, 128)) {
        return {
          ok: false,
          status: 401,
          code: 'AUTH_TOKEN_INVALID',
          message: 'Identitas sesi autentikasi tidak valid.',
        };
      }
      return { ok: true, uid: decoded.uid };
    } catch (authErr: any) {
      const errCode = String(authErr?.code || '');
      const errMsg = String(authErr?.message || '');
      const isInfra =
        errCode === 'auth/internal-error' ||
        errCode === 'auth/network-request-failed' ||
        errCode === 'unavailable' ||
        errCode === 'deadline-exceeded' ||
        authErr?.status === 503 ||
        authErr?.statusCode === 503 ||
        /unavailable|network|econnrefused|enotfound|etimedout|eai_again|socket hang up|fetch failed|deadline|internal-error|503/i.test(
          `${errCode} ${errMsg}`
        );
      if (isInfra) {
        return {
          ok: false,
          status: 503,
          code: 'AUTH_SERVICE_UNAVAILABLE',
          message: 'Layanan verifikasi autentikasi sedang mengalami kendala.',
        };
      }
      return {
        ok: false,
        status: 401,
        code: errCode === 'auth/id-token-expired' ? 'SESSION_EXPIRED' : 'AUTH_TOKEN_INVALID',
        message: 'Sesi autentikasi tidak valid atau telah berakhir.',
      };
    }
  }

  function validateStage7dActiveManagerIdentity(
    verifiedUid: string,
    roleExists: boolean,
    roleData: Record<string, any>,
    staffDocs: Map<string, any>
  ): {
    ok: boolean;
    actorUid?: string;
    actorStaffId?: string;
    actorRole?: 'manager' | 'admin';
    actorRoleLabel?: 'Manager' | 'Admin';
    actorName?: string;
    status?: 403;
    code?: string;
    message?: string;
  } {
    const textId = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const hasUidConflict = (record: any): boolean =>
      [record?.authUserId, record?.authUid].some(
        (value) =>
          value !== undefined &&
          value !== null &&
          value !== '' &&
          (typeof value !== 'string' ||
            value.trim() !== value ||
            !isValidStage7dDocId(value, 128) ||
            value !== verifiedUid)
      );

    const isStaffDisabled = (record: any): boolean =>
      !record ||
      record.isActive === false ||
      record.loginEnabled === false ||
      [
        'INACTIVE',
        'DISABLED',
        'ARCHIVED',
        'DINONAKTIFKAN',
        'DELETED',
        'TERMINATED',
        'SUSPENDED',
      ].includes(textId(record.status).toUpperCase()) ||
      textId(record.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';

    if (!roleExists || staffDocs.size === 0) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_AUTHORIZATION_DENIED',
        message: 'Identitas staf belum terikat atau tidak memiliki otorisasi aktif.',
      };
    }

    if (staffDocs.size > 1) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_DUPLICATE_MAPPING',
        message: 'Identitas staf memiliki duplikasi pemetaan pada Staff Master.',
      };
    }

    const staffSnap = [...staffDocs.values()][0];
    const staff = staffSnap.data() || {};
    const role = roleData || {};

    if (hasUidConflict(staff) || hasUidConflict(role)) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_UID_MISMATCH',
        message: 'Identitas UID staf tidak sesuai dengan sesi autentikasi.',
      };
    }

    const isUidBound =
      staffSnap.id === verifiedUid ||
      (typeof staff.authUserId === 'string' && staff.authUserId === verifiedUid) ||
      (typeof staff.authUid === 'string' && staff.authUid === verifiedUid);
    if (!isUidBound) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_UID_UNBOUND',
        message: 'Profil Staff Master tidak terikat pada UID sesi saat ini.',
      };
    }

    if (
      (staff.isStaffMaster !== undefined &&
        staff.isStaffMaster !== null &&
        staff.isStaffMaster !== true) ||
      (role.isStaffMaster !== undefined &&
        role.isStaffMaster !== null &&
        role.isStaffMaster !== true)
    ) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_MASTER_FLAG_INVALID',
        message: 'Atribut Staff Master tidak valid.',
      };
    }

    for (const srcSys of [staff.sourceSystem, role.sourceSystem]) {
      if (srcSys !== undefined && srcSys !== null && srcSys !== '') {
        if (typeof srcSys !== 'string' || srcSys.trim() !== 'STAFF_MASTER_GOVERNANCE') {
          return {
            ok: false,
            status: 403,
            code: 'STAFF_MASTER_FLAG_INVALID',
            message: 'Atribut sourceSystem Staff Master tidak valid.',
          };
        }
      }
    }

    for (const acctType of [staff.accountType, role.accountType]) {
      if (acctType !== undefined && acctType !== null && acctType !== '') {
        if (typeof acctType !== 'string' || acctType.trim().toUpperCase() === 'CUSTOMER') {
          return {
            ok: false,
            status: 403,
            code: 'STAFF_ACCOUNT_TYPE_INVALID',
            message: 'Tipe akun bukan akun staf yang sah.',
          };
        }
      }
    }

    if (
      isStaffDisabled(staff) ||
      isStaffDisabled(role) ||
      role.isActive !== true ||
      (staff.isActive !== undefined && staff.isActive !== null && staff.isActive !== true)
    ) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_INACTIVE',
        message: 'Akun staf sedang tidak aktif atau telah dinonaktifkan.',
      };
    }

    const staffRole = textId(staff.role);
    const activeRole = textId(role.role);
    if (
      !staffRole ||
      staff.role !== staffRole ||
      role.role !== activeRole ||
      activeRole !== staffRole
    ) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_ROLE_MISMATCH',
        message: 'Role staf tidak sesuai dengan Staff Master saat ini.',
      };
    }

    for (const aliasField of [staff.uid, staff.id]) {
      if (aliasField !== undefined && aliasField !== null && aliasField !== '') {
        if (typeof aliasField !== 'string' || !isValidStage7dDocId(aliasField, 128)) {
          return {
            ok: false,
            status: 403,
            code: 'STAFF_ROLE_MAPPING_CONFLICT',
            message: 'Alias identitas Staff Master tidak valid.',
          };
        }
      }
    }

    if (
      typeof staff.uid === 'string' &&
      staff.uid !== '' &&
      typeof staff.id === 'string' &&
      staff.id !== '' &&
      staff.uid !== staff.id &&
      ![verifiedUid, staffSnap.id].includes(staff.uid) &&
      ![verifiedUid, staffSnap.id].includes(staff.id)
    ) {
      return {
        ok: false,
        status: 403,
        code: 'STAFF_ROLE_MAPPING_CONFLICT',
        message: 'Konflik alias uid/id pada Staff Master.',
      };
    }

    const aliases = new Set(
      [verifiedUid, staffSnap.id, textId(staff.uid), textId(staff.id)].filter(Boolean)
    );
    for (const linkedId of [role.staffId, role.staffUserId]) {
      if (linkedId !== undefined && linkedId !== null && linkedId !== '') {
        if (
          typeof linkedId !== 'string' ||
          !isValidStage7dDocId(linkedId, 128) ||
          !aliases.has(linkedId)
        ) {
          return {
            ok: false,
            status: 403,
            code: 'STAFF_ROLE_MAPPING_CONFLICT',
            message: 'Referensi Staff Master pada staff_roles tidak sesuai.',
          };
        }
      }
    }

    if (staffRole !== 'manager' && staffRole !== 'admin') {
      return {
        ok: false,
        status: 403,
        code: 'MANAGER_ROLE_REQUIRED',
        message:
          'Akses Ditolak: Hanya Manager atau Admin aktif yang berwenang melakukan tindakan ini.',
      };
    }

    const actorName =
      sanitizeStage7dText(staff.name, 120) ||
      sanitizeStage7dText(staff.displayName, 120) ||
      sanitizeStage7dText(staff.fullName, 120) ||
      sanitizeStage7dText(role.name, 120) ||
      (staffRole === 'admin' ? 'Admin Senzu' : 'Manager Senzu');

    return {
      ok: true,
      actorUid: verifiedUid,
      actorStaffId: staffSnap.id,
      actorRole: staffRole,
      actorRoleLabel: staffRole === 'admin' ? 'Admin' : 'Manager',
      actorName,
    };
  }

  function extractConsistentRecordOwnerUid(
    record: Record<string, any> | null | undefined
  ): { ok: boolean; ownerUid?: string | null; code?: string; message?: string } {
    if (!record || typeof record !== 'object') {
      return { ok: true, ownerUid: null };
    }
    const populatedUids = new Set<string>();
    for (const field of [
      record.customerAuthUid,
      record.authUserId,
      record.customerUid,
      record.userId,
      record.uid,
    ]) {
      if (field !== undefined && field !== null && field !== '') {
        if (typeof field !== 'string' || !isValidStage7dDocId(field, 128)) {
          return {
            ok: false,
            code: 'OWNERSHIP_FIELD_INVALID',
            message: 'Atribut kepemilikan pengguna tidak valid.',
          };
        }
        populatedUids.add(field);
      }
    }
    if (populatedUids.size > 1) {
      return {
        ok: false,
        code: 'OWNERSHIP_UID_CONFLICT',
        message: 'Konflik atribut kepemilikan pengguna pada dokumen.',
      };
    }
    const ownerUid = populatedUids.size === 1 ? [...populatedUids][0] : null;
    return { ok: true, ownerUid };
  }

  // 1. Admin Payment Correction Endpoint
  app.post('/api/payments/:paymentId/correct', async (req, res) => {
    setStage7dNoStore(res);
    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));
    const textId = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    try {
      const authResult = await verifyStage7dBearerToken(req);
      if (!authResult.ok) {
        return res.status(authResult.status || 401).json({
          success: false,
          code: authResult.code,
          error: authResult.message,
          message: authResult.message,
        });
      }
      const verifiedUid = authResult.uid!;

      const rawPaymentId = req.params?.paymentId;
      if (!isValidStage7dDocId(rawPaymentId, 128)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYMENT_ID',
          error: 'ID pembayaran tidak valid.',
          message: 'ID pembayaran tidak valid.',
        });
      }
      const paymentId = rawPaymentId;

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYLOAD',
          error: 'Format permintaan koreksi pembayaran tidak valid.',
          message: 'Format permintaan koreksi pembayaran tidak valid.',
        });
      }

      for (const key of Object.keys(req.body)) {
        if (!STAGE7D_CORRECTION_ALLOWED_BODY_KEYS.has(key)) {
          return res.status(400).json({
            success: false,
            code: 'FORBIDDEN_CORRECTION_FIELD',
            error: 'Permintaan koreksi pembayaran memuat atribut yang tidak diizinkan.',
            message: 'Permintaan koreksi pembayaran memuat atribut yang tidak diizinkan.',
          });
        }
      }

      if (req.body.paymentId !== undefined) {
        if (typeof req.body.paymentId !== 'string' || req.body.paymentId.trim() !== paymentId) {
          return res.status(400).json({
            success: false,
            code: 'PAYMENT_ID_MISMATCH',
            error: 'ID pembayaran pada body tidak sesuai dengan parameter URL.',
            message: 'ID pembayaran pada body tidak sesuai dengan parameter URL.',
          });
        }
      }

      // Actor fields in body are ignored for authority, but malformed non-string types are rejected
      for (const actorKey of ['staffId', 'staffName', 'actorId', 'actorName', 'actorRole']) {
        const val = req.body[actorKey];
        if (val !== undefined && val !== null) {
          if (typeof val !== 'string' || val.length > 200 || /[\x00-\x1F\x7F]/.test(val)) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_ACTOR_FIELD',
              error: 'Format atribut identitas pemohon tidak valid.',
              message: 'Format atribut identitas pemohon tidak valid.',
            });
          }
        }
      }

      const rawBookingId = req.body.bookingId;
      if (!isValidStage7dDocId(rawBookingId, 128)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_ID',
          error: 'ID reservasi tidak valid.',
          message: 'ID reservasi tidak valid.',
        });
      }
      const bookingId = rawBookingId;

      let suppliedBookingCode = '';
      if (req.body.bookingCode !== undefined && req.body.bookingCode !== null) {
        if (typeof req.body.bookingCode !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_CODE',
            error: 'Kode reservasi tidak valid.',
            message: 'Kode reservasi tidak valid.',
          });
        }
        const upperCode = req.body.bookingCode.trim().toUpperCase();
        if (!isValidStage7dBookingCode(upperCode, 64)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_CODE',
            error: 'Kode reservasi tidak valid.',
            message: 'Kode reservasi tidak valid.',
          });
        }
        suppliedBookingCode = upperCode;
      }

      const rawNewStatus = req.body.newStatus;
      if (
        typeof rawNewStatus !== 'string' ||
        !STAGE7D_ALLOWED_PAYMENT_STATUS_CODES.has(rawNewStatus)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYMENT_STATUS',
          error: 'Status pembayaran baru tidak valid.',
          message: 'Status pembayaran baru tidak valid.',
        });
      }
      const newStatus = rawNewStatus;

      const rawReason = req.body.reason;
      if (
        typeof rawReason !== 'string' ||
        rawReason.length > 500 ||
        Buffer.byteLength(rawReason, 'utf8') > 1000
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CORRECTION_REASON',
          error: 'Alasan koreksi pembayaran wajib diisi dan tidak boleh melebihi batas.',
          message: 'Alasan koreksi pembayaran wajib diisi dan tidak boleh melebihi batas.',
        });
      }
      const sanitizedReason = rawReason.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
      if (!sanitizedReason) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CORRECTION_REASON',
          error: 'Alasan koreksi pembayaran wajib diisi.',
          message: 'Alasan koreksi pembayaran wajib diisi.',
        });
      }

      const rawRequestId = req.body.requestId;
      let cleanRequestId = '';
      if (rawRequestId !== undefined) {
        if (!isValidStage7dDocId(rawRequestId, 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REQUEST_ID',
            error: 'ID permintaan (requestId) tidak valid.',
            message: 'ID permintaan (requestId) tidak valid.',
          });
        }
        cleanRequestId = rawRequestId;
      }

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: 'Database server sedang tidak tersedia.',
          message: 'Database server sedang tidak tersedia.',
        });
      }

      const receiptId = cleanRequestId
        ? `pgr_corr_${createHash('sha256')
            .update(`payment_correct:${verifiedUid}:${cleanRequestId}`)
            .digest('hex')
            .slice(0, 40)}`
        : '';

      const deterministicCorrHistId = cleanRequestId
        ? `psh_corr_${createHash('sha256')
            .update(`payment_correct:${verifiedUid}:${cleanRequestId}`)
            .digest('hex')
            .slice(0, 32)}`
        : `psh_corr_${Date.now()}_${randomInt(100000, 1000000).toString(36)}`;

      const fallbackCorrHistId = `psh_corr_${createHash('sha256')
        .update(`payment_correct_alt:${verifiedUid}:${paymentId}:${cleanRequestId || Date.now()}`)
        .digest('hex')
        .slice(0, 20)}_${Date.now().toString(36)}_${randomInt(100000, 1000000).toString(36)}`;

      const requestFingerprint = computePaymentCorrectionFingerprint({
        actorUid: verifiedUid,
        paymentId,
        bookingId,
        newStatus,
        reason: sanitizedReason,
      });

      const txResult: any = await adminDb.runTransaction(async (transaction: any) => {
        const roleRef = adminDb.collection('staff_roles').doc(verifiedUid);
        const canonicalStaffQuery = adminDb
          .collection('staff_users')
          .where('authUserId', '==', verifiedUid)
          .limit(2);
        const legacyStaffQuery = adminDb
          .collection('staff_users')
          .where('authUid', '==', verifiedUid)
          .limit(2);
        const directStaffRef = adminDb.collection('staff_users').doc(verifiedUid);
        const paymentRef = adminDb.collection('payments').doc(paymentId);
        const suppliedBookingRef = adminDb.collection('bookings').doc(bookingId);
        const receiptRef = receiptId
          ? adminDb.collection('payment_governance_receipts').doc(receiptId)
          : null;
        const deterministicCorrHistRef = adminDb
          .collection('payment_status_history')
          .doc(deterministicCorrHistId);
        const fallbackCorrHistRef = adminDb
          .collection('payment_status_history')
          .doc(fallbackCorrHistId);

        const [
          roleSnap,
          canonicalStaffSnap,
          legacyStaffSnap,
          directStaffSnap,
          paymentSnap,
          suppliedBookingSnap,
          receiptSnap,
          deterministicCorrHistSnap,
          fallbackCorrHistSnap,
        ] = await Promise.all([
          transaction.get(roleRef),
          transaction.get(canonicalStaffQuery),
          transaction.get(legacyStaffQuery),
          transaction.get(directStaffRef),
          transaction.get(paymentRef),
          transaction.get(suppliedBookingRef),
          receiptRef ? transaction.get(receiptRef) : Promise.resolve(null),
          transaction.get(deterministicCorrHistRef),
          transaction.get(fallbackCorrHistRef),
        ]);

        const fetchedCorrHistoryDocs = new Map<string, any>();
        if (snapExists(deterministicCorrHistSnap)) {
          fetchedCorrHistoryDocs.set(deterministicCorrHistId, deterministicCorrHistSnap);
        }
        if (snapExists(fallbackCorrHistSnap)) {
          fetchedCorrHistoryDocs.set(fallbackCorrHistId, fallbackCorrHistSnap);
        }

        if (snapExists(receiptSnap)) {
          const rData = receiptSnap.data() || {};
          const rHistId = textId(rData?.responsePayload?.historyId);
          if (
            isValidStage7dDocId(rHistId, 128) &&
            !fetchedCorrHistoryDocs.has(rHistId) &&
            rHistId !== deterministicCorrHistId &&
            rHistId !== fallbackCorrHistId
          ) {
            const extraHistSnap = await transaction.get(
              adminDb.collection('payment_status_history').doc(rHistId)
            );
            if (snapExists(extraHistSnap)) {
              fetchedCorrHistoryDocs.set(rHistId, extraHistSnap);
            }
          }
        }

        const staffDocs = new Map<string, any>();
        for (const d of [
          ...(canonicalStaffSnap?.docs || []),
          ...(legacyStaffSnap?.docs || []),
        ]) {
          if (snapExists(d)) staffDocs.set(d.id, d);
        }
        if (snapExists(directStaffSnap)) {
          staffDocs.set(directStaffSnap.id, directStaffSnap);
        }

        const roleExists = snapExists(roleSnap);
        const roleData = roleExists ? roleSnap.data() || {} : {};
        if (roleExists) {
          for (const linked of [roleData.staffId, roleData.staffUserId]) {
            if (typeof linked === 'string' && isValidStage7dDocId(linked, 128) && !staffDocs.has(linked)) {
              const linkedSnap = await transaction.get(
                adminDb.collection('staff_users').doc(linked)
              );
              if (snapExists(linkedSnap)) {
                staffDocs.set(linkedSnap.id, linkedSnap);
              }
            }
          }
        }

        let authoritativeBookingSnap: any = suppliedBookingSnap;
        let bookingByCodeSnap: any = null;
        let customerSnap: any = null;

        if (snapExists(paymentSnap)) {
          const pData = paymentSnap.data() || {};
          const pBookingId = textId(pData.bookingId);
          if (isValidStage7dDocId(pBookingId, 128) && pBookingId !== bookingId) {
            authoritativeBookingSnap = await transaction.get(
              adminDb.collection('bookings').doc(pBookingId)
            );
          }
          const bData = snapExists(authoritativeBookingSnap)
            ? authoritativeBookingSnap.data() || {}
            : {};
          const candidateCode = (
            textId(bData.bookingCode) || textId(pData.bookingCode)
          ).toUpperCase();
          if (isValidStage7dBookingCode(candidateCode, 64)) {
            bookingByCodeSnap = await transaction.get(
              adminDb.collection('bookings').where('bookingCode', '==', candidateCode).limit(2)
            );
          }
          const candidateCustomerId = textId(bData.customerId) || textId(pData.customerId);
          if (isValidStage7dDocId(candidateCustomerId, 128)) {
            customerSnap = await transaction.get(
              adminDb.collection('customers').doc(candidateCustomerId)
            );
          }
        }

        // 1. Verify current active Manager/Admin identity inside transaction
        const managerCheck = validateStage7dActiveManagerIdentity(
          verifiedUid,
          roleExists,
          roleData,
          staffDocs
        );
        if (!managerCheck.ok) {
          return {
            status: managerCheck.status,
            code: managerCheck.code,
            message: managerCheck.message,
          };
        }

        // 2. Verify authoritative payment & booking linkage before receipt replay or mutation
        if (!snapExists(paymentSnap)) {
          return {
            status: 404,
            code: 'PAYMENT_NOT_FOUND',
            message: 'Data pembayaran tidak ditemukan.',
          };
        }
        const paymentData = paymentSnap.data() || {};
        if (
          paymentData.id !== undefined &&
          paymentData.id !== null &&
          paymentData.id !== '' &&
          (typeof paymentData.id !== 'string' || paymentData.id !== paymentId)
        ) {
          return {
            status: 409,
            code: 'PAYMENT_ID_CONFLICT',
            message: 'Identitas dokumen pembayaran tidak konsisten.',
          };
        }

        const persistedBookingId = textId(paymentData.bookingId);
        if (!isValidStage7dDocId(persistedBookingId, 128)) {
          return {
            status: 409,
            code: 'INVALID_PAYMENT_BOOKING_LINK',
            message: 'Data pembayaran tidak memiliki ID reservasi yang valid.',
          };
        }

        if (bookingId !== persistedBookingId) {
          return {
            status: 400,
            code: 'BOOKING_ID_MISMATCH',
            message:
              'ID reservasi pada permintaan tidak sesuai dengan catatan pembayaran tersimpan.',
          };
        }

        if (!snapExists(authoritativeBookingSnap)) {
          return {
            status: 404,
            code: 'BOOKING_NOT_FOUND',
            message: 'Data reservasi terkait pembayaran tidak ditemukan.',
          };
        }
        const bookingData = authoritativeBookingSnap.data() || {};
        if (
          bookingData.id !== undefined &&
          bookingData.id !== null &&
          bookingData.id !== '' &&
          (typeof bookingData.id !== 'string' || bookingData.id !== persistedBookingId)
        ) {
          return {
            status: 409,
            code: 'BOOKING_ID_CONFLICT',
            message: 'Identitas dokumen reservasi tidak konsisten.',
          };
        }

        const payBookingCode = textId(paymentData.bookingCode).toUpperCase();
        const bkBookingCode = textId(bookingData.bookingCode).toUpperCase();
        if (payBookingCode && bkBookingCode && payBookingCode !== bkBookingCode) {
          return {
            status: 409,
            code: 'BOOKING_CODE_MISMATCH',
            message: 'Kode reservasi pada pembayaran tidak sesuai dengan dokumen reservasi.',
          };
        }
        const canonicalBookingCode = bkBookingCode || payBookingCode;
        if (!isValidStage7dBookingCode(canonicalBookingCode, 64)) {
          return {
            status: 409,
            code: 'INVALID_BOOKING_CODE',
            message: 'Kode reservasi pada dokumen tidak valid.',
          };
        }
        if (suppliedBookingCode && suppliedBookingCode !== canonicalBookingCode) {
          return {
            status: 409,
            code: 'BOOKING_CODE_MISMATCH',
            message: 'Kode reservasi pada permintaan tidak sesuai dengan dokumen tersimpan.',
          };
        }

        for (const d of bookingByCodeSnap?.docs || []) {
          if (snapExists(d) && d.id !== persistedBookingId) {
            return {
              status: 409,
              code: 'BOOKING_CODE_CONFLICT',
              message: 'Kode reservasi merujuk pada lebih dari satu dokumen.',
            };
          }
        }

        const payOwnerRes = extractConsistentRecordOwnerUid(paymentData);
        if (!payOwnerRes.ok) {
          return {
            status: 403,
            code: payOwnerRes.code,
            message: payOwnerRes.message,
          };
        }
        const bkOwnerRes = extractConsistentRecordOwnerUid(bookingData);
        if (!bkOwnerRes.ok) {
          return {
            status: 403,
            code: bkOwnerRes.code,
            message: bkOwnerRes.message,
          };
        }
        if (
          payOwnerRes.ownerUid &&
          bkOwnerRes.ownerUid &&
          payOwnerRes.ownerUid !== bkOwnerRes.ownerUid
        ) {
          return {
            status: 403,
            code: 'CROSS_DOCUMENT_OWNERSHIP_CONFLICT',
            message: 'Kepemilikan pembayaran dan reservasi mengalami konflik.',
          };
        }
        if (payOwnerRes.ownerUid && !bkOwnerRes.ownerUid) {
          return {
            status: 403,
            code: 'UNOWNED_BOOKING_PAYMENT_UID_CONFLICT',
            message: 'Pembayaran memiliki UID pemilik pada reservasi tanpa pemilik.',
          };
        }

        const payCustomerId = textId(paymentData.customerId);
        const bkCustomerId = textId(bookingData.customerId);
        if (payCustomerId && bkCustomerId && payCustomerId !== bkCustomerId) {
          return {
            status: 409,
            code: 'CUSTOMER_ID_MISMATCH',
            message: 'ID pelanggan pada pembayaran dan reservasi tidak sesuai.',
          };
        }

        if (snapExists(customerSnap)) {
          const custOwnerRes = extractConsistentRecordOwnerUid(customerSnap.data() || {});
          if (!custOwnerRes.ok) {
            return {
              status: 403,
              code: custOwnerRes.code,
              message: custOwnerRes.message,
            };
          }
          const authoritativeOwner = bkOwnerRes.ownerUid || payOwnerRes.ownerUid;
          if (
            authoritativeOwner &&
            custOwnerRes.ownerUid &&
            custOwnerRes.ownerUid !== authoritativeOwner
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              message: 'Profil CRM pelanggan memiliki UID yang bertentangan dengan pemilik reservasi.',
            };
          }
        }

        // 3. Validate committed idempotency receipt and complete responsePayload BEFORE new-transition checks
        if (receiptRef && snapExists(receiptSnap)) {
          const receipt = receiptSnap.data() || {};
          const resp = receipt?.responsePayload;
          const allowedCorrRespKeys = new Set<string>([
            'paymentId',
            'bookingId',
            'bookingCode',
            'oldStatus',
            'newStatus',
            'correctedBy',
            'correctedAt',
            'correctionReason',
            'historyId',
            'auditId',
            'payment',
          ]);

          const isValidEnvelope =
            Boolean(receipt && typeof receipt === 'object' && !Array.isArray(receipt)) &&
            receipt.id === receiptId &&
            receipt.action === 'payment_correct' &&
            receipt.actorUid === verifiedUid &&
            isValidStage7dDocId(receipt.actorStaffId, 128) &&
            (receipt.actorRole === 'manager' || receipt.actorRole === 'admin') &&
            typeof receipt.actorName === 'string' &&
            receipt.actorName.trim().length > 0 &&
            receipt.actorName.length <= 120 &&
            receipt.requestId === cleanRequestId &&
            isValidStage7dDocId(receipt.paymentId, 128) &&
            isValidStage7dDocId(receipt.bookingId, 128) &&
            typeof receipt.newStatus === 'string' &&
            STAGE7D_ALLOWED_PAYMENT_STATUS_CODES.has(receipt.newStatus) &&
            typeof receipt.reason === 'string' &&
            receipt.reason.trim().length > 0 &&
            receipt.reason.length <= 500 &&
            typeof receipt.fingerprint === 'string' &&
            /^[a-f0-9]{64}$/.test(receipt.fingerprint) &&
            receipt.fingerprint ===
              computePaymentCorrectionFingerprint({
                actorUid: receipt.actorUid,
                paymentId: receipt.paymentId,
                bookingId: receipt.bookingId,
                newStatus: receipt.newStatus,
                reason: receipt.reason,
              }) &&
            typeof receipt.committedAt === 'string' &&
            !Number.isNaN(Date.parse(receipt.committedAt)) &&
            Boolean(resp && typeof resp === 'object' && !Array.isArray(resp));

          let isValidResponseShape = false;
          if (isValidEnvelope) {
            const expectedAuditId = `audit_pcorr_${createHash('sha256')
              .update(`payment_correct:${receipt.actorUid}:${receipt.requestId}`)
              .digest('hex')
              .slice(0, 32)}`;
            const respKeysOk = Object.keys(resp).every((k) => allowedCorrRespKeys.has(k));
            const respPay = resp.payment;
            const respPayOwner =
              respPay && typeof respPay === 'object' && !Array.isArray(respPay)
                ? extractConsistentRecordOwnerUid(respPay)
                : { ok: false };
            const linkedHistSnap = isValidStage7dDocId(resp.historyId, 128)
              ? fetchedCorrHistoryDocs.get(resp.historyId)
              : null;
            const linkedHistData = snapExists(linkedHistSnap) ? linkedHistSnap.data() || {} : null;

            isValidResponseShape =
              respKeysOk &&
              resp.paymentId === receipt.paymentId &&
              resp.bookingId === receipt.bookingId &&
              isValidStage7dBookingCode(resp.bookingCode, 64) &&
              typeof resp.oldStatus === 'string' &&
              STAGE7D_ALLOWED_PAYMENT_STATUS_CODES.has(resp.oldStatus) &&
              resp.oldStatus !== receipt.newStatus &&
              resp.newStatus === receipt.newStatus &&
              resp.correctedBy === receipt.actorName &&
              resp.correctedAt === receipt.committedAt &&
              resp.correctionReason === receipt.reason &&
              isValidStage7dDocId(resp.historyId, 128) &&
              resp.auditId === expectedAuditId &&
              Boolean(respPay && typeof respPay === 'object' && !Array.isArray(respPay)) &&
              respPay.id === receipt.paymentId &&
              respPay.bookingId === receipt.bookingId &&
              textId(respPay.bookingCode).toUpperCase() === resp.bookingCode &&
              respPay.status === receipt.newStatus &&
              respPay.correctedBy === receipt.actorName &&
              respPay.correctedAt === receipt.committedAt &&
              respPay.correctionReason === receipt.reason &&
              respPay.updatedAt === receipt.committedAt &&
              (respPay.amount === undefined ||
                (typeof respPay.amount === 'number' &&
                  Number.isFinite(respPay.amount) &&
                  respPay.amount > 0)) &&
              respPayOwner.ok === true &&
              Boolean(linkedHistData) &&
              linkedHistData.id === resp.historyId &&
              linkedHistData.paymentId === receipt.paymentId &&
              linkedHistData.bookingId === receipt.bookingId &&
              textId(linkedHistData.bookingCode).toUpperCase() === resp.bookingCode &&
              linkedHistData.oldStatus === resp.oldStatus &&
              linkedHistData.newStatus === receipt.newStatus &&
              linkedHistData.actorUid === receipt.actorUid &&
              linkedHistData.userId === receipt.actorStaffId &&
              linkedHistData.userName === receipt.actorName &&
              linkedHistData.eventType === 'payment_corrected' &&
              linkedHistData.serverAuthoritative === true;
          }

          if (!isValidEnvelope || !isValidResponseShape) {
            return {
              status: 409,
              code: 'RECEIPT_CORRUPTED',
              message: 'Bukti idempotensi koreksi pembayaran tidak valid atau mengalami konflik.',
            };
          }

          if (
            receipt.fingerprint !== requestFingerprint ||
            receipt.paymentId !== paymentId ||
            receipt.bookingId !== persistedBookingId ||
            receipt.newStatus !== newStatus ||
            receipt.reason !== sanitizedReason
          ) {
            return {
              status: 409,
              code: 'IDEMPOTENCY_PARAMETER_MISMATCH',
              message:
                'ID permintaan (requestId) telah digunakan untuk koreksi pembayaran dengan parameter berbeda.',
            };
          }

          const respPayOwner = extractConsistentRecordOwnerUid(resp.payment);
          const isCanonicalTargetMatch =
            resp.paymentId === paymentId &&
            resp.bookingId === persistedBookingId &&
            resp.bookingCode === canonicalBookingCode &&
            (typeof paymentData.amount !== 'number' ||
              resp.payment.amount === paymentData.amount) &&
            textId(resp.payment.customerId) === payCustomerId &&
            respPayOwner.ok === true &&
            respPayOwner.ownerUid === payOwnerRes.ownerUid;

          if (!isCanonicalTargetMatch) {
            return {
              status: 409,
              code: 'RECEIPT_CORRUPTED',
              message: 'Respons idempotensi koreksi pembayaran tidak sesuai dengan dokumen otoritatif.',
            };
          }

          return {
            paymentId: resp.paymentId,
            bookingId: resp.bookingId,
            bookingCode: resp.bookingCode,
            oldStatus: resp.oldStatus,
            newStatus: resp.newStatus,
            correctedBy: resp.correctedBy,
            correctedAt: resp.correctedAt,
            correctionReason: resp.correctionReason,
            historyId: resp.historyId,
            auditId: resp.auditId,
            payment: resp.payment,
            status: 200,
            isIdempotent: true,
          };
        }

        const oldStatus = textId(paymentData.status);
        if (!oldStatus || !STAGE7D_ALLOWED_PAYMENT_STATUS_CODES.has(oldStatus)) {
          return {
            status: 409,
            code: 'INVALID_CURRENT_PAYMENT_STATUS',
            message: 'Status pembayaran tersimpan tidak valid untuk dikoreksi.',
          };
        }

        // 4. Same-state no-op without an existing receipt must not invent another correction event
        if (oldStatus === newStatus) {
          return {
            status: 200,
            isIdempotent: true,
            noOp: true,
            paymentId,
            bookingId: persistedBookingId,
            bookingCode: canonicalBookingCode,
            oldStatus,
            newStatus,
            payment: {
              ...paymentData,
              id: paymentId,
            },
          };
        }

        // Never overwrite an existing payment_status_history document
        let actualCorrHistId = '';
        let actualCorrHistRef: any = null;
        if (!snapExists(deterministicCorrHistSnap)) {
          actualCorrHistId = deterministicCorrHistId;
          actualCorrHistRef = deterministicCorrHistRef;
        } else if (!snapExists(fallbackCorrHistSnap)) {
          actualCorrHistId = fallbackCorrHistId;
          actualCorrHistRef = fallbackCorrHistRef;
        } else {
          return {
            status: 409,
            code: 'HISTORY_ID_COLLISION',
            message: 'Konflik ID riwayat pembayaran; tidak dapat menimpa riwayat yang sudah ada.',
          };
        }

        const nowDate = new Date();
        const nowIso = nowDate.toISOString();
        const formattedWIB = formatStage7dWIB(nowDate);

        const paymentUpdates = {
          status: newStatus,
          correctedBy: managerCheck.actorName,
          correctedAt: nowIso,
          correctionReason: sanitizedReason,
          updatedAt: nowIso,
        };

        const bookingUpdates = {
          paymentStatus: newStatus,
          updatedAt: nowIso,
        };

        const historyEntry = {
          id: actualCorrHistId,
          paymentId,
          bookingId: persistedBookingId,
          bookingCode: canonicalBookingCode,
          oldStatus,
          newStatus,
          source: managerCheck.actorRole,
          userId: managerCheck.actorStaffId,
          actorUid: managerCheck.actorUid,
          userName: managerCheck.actorName,
          userRole: managerCheck.actorRole,
          eventType: 'payment_corrected',
          reason: sanitizedReason,
          note: `Koreksi status oleh ${managerCheck.actorRoleLabel} (${managerCheck.actorName}): ${sanitizedReason}`,
          serverAuthoritative: true,
          createdAt: nowIso,
          timestamp: nowIso,
        };

        const auditId = cleanRequestId
          ? `audit_pcorr_${createHash('sha256')
              .update(`payment_correct:${verifiedUid}:${cleanRequestId}`)
              .digest('hex')
              .slice(0, 32)}`
          : `audit_pcorr_${Date.now()}_${randomInt(100000, 1000000).toString(36)}`;

        const auditEntry = {
          id: auditId,
          bookingId: persistedBookingId,
          bookingCode: canonicalBookingCode,
          ...(bkCustomerId || payCustomerId ? { customerId: bkCustomerId || payCustomerId } : {}),
          entityId: paymentId,
          entityType: 'payment',
          action: 'payment_corrected',
          actorId: managerCheck.actorStaffId,
          actorUid: managerCheck.actorUid,
          actorRole: managerCheck.actorRole,
          actorName: managerCheck.actorName,
          oldValue: oldStatus,
          newValue: newStatus,
          reason: sanitizedReason,
          note: `Koreksi status pembayaran ${paymentId} (${canonicalBookingCode}) dari ${oldStatus} ke ${newStatus} oleh ${managerCheck.actorName}: ${sanitizedReason}`,
          timestamp: nowIso,
          createdAt: nowIso,
          formattedWIB,
        };

        transaction.update(paymentRef, paymentUpdates);
        transaction.update(suppliedBookingRef, bookingUpdates);
        transaction.set(actualCorrHistRef, historyEntry);
        transaction.set(adminDb.collection('operational_audit_logs').doc(auditId), auditEntry);

        const updatedPayment = {
          ...paymentData,
          ...paymentUpdates,
          id: paymentId,
        };

        const responsePayload = {
          paymentId,
          bookingId: persistedBookingId,
          bookingCode: canonicalBookingCode,
          oldStatus,
          newStatus,
          correctedBy: managerCheck.actorName,
          correctedAt: nowIso,
          correctionReason: sanitizedReason,
          historyId: actualCorrHistId,
          auditId,
          payment: updatedPayment,
        };

        if (receiptRef) {
          transaction.set(receiptRef, {
            id: receiptId,
            action: 'payment_correct',
            actorUid: verifiedUid,
            actorStaffId: managerCheck.actorStaffId,
            actorRole: managerCheck.actorRole,
            actorName: managerCheck.actorName,
            requestId: cleanRequestId,
            paymentId,
            bookingId: persistedBookingId,
            newStatus,
            reason: sanitizedReason,
            fingerprint: requestFingerprint,
            committedAt: nowIso,
            responsePayload,
          });
        }

        return {
          ...responsePayload,
          status: 200,
          isIdempotent: false,
        };
      });

      if (txResult.status !== 200) {
        return res.status(txResult.status).json({
          success: false,
          code: txResult.code || 'PAYMENT_CORRECTION_REJECTED',
          error: txResult.message || 'Gagal melakukan koreksi pembayaran.',
          message: txResult.message || 'Gagal melakukan koreksi pembayaran.',
        });
      }

      const { status: _st, ...payloadOut } = txResult;
      // Loyalty: a corrected payment can be what completes the "completed + paid" state (idempotent, detached).
      if (String(txResult.newStatus || '').trim().toLowerCase() === 'paid') {
        loyaltyAccounts.creditBookingLoyalty(txResult.bookingId).catch((e) => console.warn('[Loyalty] post-correct earning failed:', e?.code || e?.message || e));
      }
      return res.status(200).json({
        ...payloadOut,
        success: true,
      });
    } catch (err: any) {
      const errCode = String(err?.code || '');
      const errMsg = String(err?.message || '');
      const isInfra =
        errCode === 'unavailable' ||
        errCode === 'deadline-exceeded' ||
        err?.status === 503 ||
        /unavailable|network|econnrefused|enotfound|etimedout|deadline/i.test(
          `${errCode} ${errMsg}`
        );
      return res.status(isInfra ? 503 : 500).json({
        success: false,
        code: isInfra ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
        error: isInfra
          ? 'Layanan database sedang tidak tersedia.'
          : 'Terjadi kesalahan saat memproses koreksi pembayaran.',
        message: isInfra
          ? 'Layanan database sedang tidak tersedia.'
          : 'Terjadi kesalahan saat memproses koreksi pembayaran.',
      });
    }
  });

  // 2. Manager Manual Refund Status Endpoint
  app.post('/api/cases/:caseId/manual-refund-status', async (req, res) => {
    setStage7dNoStore(res);
    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));
    const textId = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    try {
      const authResult = await verifyStage7dBearerToken(req);
      if (!authResult.ok) {
        return res.status(authResult.status || 401).json({
          success: false,
          code: authResult.code,
          error: authResult.message,
          message: authResult.message,
        });
      }
      const verifiedUid = authResult.uid!;

      const rawCaseId = req.params?.caseId;
      if (!isValidStage7dDocId(rawCaseId, 128)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CASE_ID',
          error: 'ID kasus tidak valid.',
          message: 'ID kasus tidak valid.',
        });
      }
      const caseId = rawCaseId;

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYLOAD',
          error: 'Format permintaan status refund manual tidak valid.',
          message: 'Format permintaan status refund manual tidak valid.',
        });
      }

      for (const key of Object.keys(req.body)) {
        if (!STAGE7D_MANUAL_REFUND_ALLOWED_BODY_KEYS.has(key)) {
          return res.status(400).json({
            success: false,
            code: 'FORBIDDEN_REFUND_FIELD',
            error: 'Permintaan status refund manual memuat atribut yang tidak diizinkan.',
            message: 'Permintaan status refund manual memuat atribut yang tidak diizinkan.',
          });
        }
      }

      if (req.body.caseId !== undefined) {
        if (typeof req.body.caseId !== 'string' || req.body.caseId.trim() !== caseId) {
          return res.status(400).json({
            success: false,
            code: 'CASE_ID_CONFLICT',
            error: 'ID kasus pada body tidak sesuai dengan parameter URL.',
            message: 'ID kasus pada body tidak sesuai dengan parameter URL.',
          });
        }
      }

      if (req.body.caseItem !== undefined) {
        if (
          !req.body.caseItem ||
          typeof req.body.caseItem !== 'object' ||
          Array.isArray(req.body.caseItem)
        ) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_CASE_SNAPSHOT',
            error: 'Data caseItem tidak valid.',
            message: 'Data caseItem tidak valid.',
          });
        }
        if (
          req.body.caseItem.id !== undefined &&
          (typeof req.body.caseItem.id !== 'string' || req.body.caseItem.id.trim() !== caseId)
        ) {
          return res.status(400).json({
            success: false,
            code: 'CASE_ID_CONFLICT',
            error: 'ID kasus pada caseItem tidak sesuai dengan parameter URL.',
            message: 'ID kasus pada caseItem tidak sesuai dengan parameter URL.',
          });
        }
      }

      // Actor fields in body are ignored as authority, but malformed non-string types are rejected
      for (const actorKey of ['actorId', 'actorName', 'actorRole', 'staffId', 'staffName']) {
        const val = req.body[actorKey];
        if (val !== undefined && val !== null) {
          if (typeof val !== 'string' || val.length > 200 || /[\x00-\x1F\x7F]/.test(val)) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_ACTOR_FIELD',
              error: 'Format atribut identitas pemohon tidak valid.',
              message: 'Format atribut identitas pemohon tidak valid.',
            });
          }
        }
      }

      let suppliedCaseCode = '';
      const rawCaseCodeCandidate =
        req.body.caseCode !== undefined ? req.body.caseCode : req.body.caseItem?.caseCode;
      if (
        rawCaseCodeCandidate !== undefined &&
        rawCaseCodeCandidate !== null &&
        rawCaseCodeCandidate !== ''
      ) {
        if (
          typeof rawCaseCodeCandidate !== 'string' ||
          rawCaseCodeCandidate.trim().length > 64 ||
          /[\x00-\x1F\x7F]/.test(rawCaseCodeCandidate)
        ) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_CASE_CODE',
            error: 'Kode kasus tidak valid.',
            message: 'Kode kasus tidak valid.',
          });
        }
        suppliedCaseCode = rawCaseCodeCandidate.trim();
      }

      let suppliedCustomerId = '';
      if (
        req.body.caseItem?.customerId !== undefined &&
        req.body.caseItem?.customerId !== null &&
        req.body.caseItem?.customerId !== ''
      ) {
        if (!isValidStage7dDocId(req.body.caseItem.customerId, 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_CUSTOMER_ID',
            error: 'ID pelanggan pada caseItem tidak valid.',
            message: 'ID pelanggan pada caseItem tidak valid.',
          });
        }
        suppliedCustomerId = req.body.caseItem.customerId;
      }

      let suppliedBookingId = '';
      const rawBookingIdCandidate =
        req.body.bookingId !== undefined ? req.body.bookingId : req.body.caseItem?.bookingId;
      if (
        rawBookingIdCandidate !== undefined &&
        rawBookingIdCandidate !== null &&
        rawBookingIdCandidate !== ''
      ) {
        if (!isValidStage7dDocId(rawBookingIdCandidate, 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_ID',
            error: 'ID reservasi tidak valid.',
            message: 'ID reservasi tidak valid.',
          });
        }
        suppliedBookingId = rawBookingIdCandidate;
      } else if (req.body.bookingId === '') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_ID',
          error: 'ID reservasi tidak valid.',
          message: 'ID reservasi tidak valid.',
        });
      }

      let suppliedBookingCode = '';
      const rawBookingCodeCandidate =
        req.body.bookingCode !== undefined ? req.body.bookingCode : req.body.caseItem?.bookingCode;
      if (
        rawBookingCodeCandidate !== undefined &&
        rawBookingCodeCandidate !== null &&
        rawBookingCodeCandidate !== ''
      ) {
        if (typeof rawBookingCodeCandidate !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_CODE',
            error: 'Kode reservasi tidak valid.',
            message: 'Kode reservasi tidak valid.',
          });
        }
        const upper = rawBookingCodeCandidate.trim().toUpperCase();
        if (!isValidStage7dBookingCode(upper, 64)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_CODE',
            error: 'Kode reservasi tidak valid.',
            message: 'Kode reservasi tidak valid.',
          });
        }
        suppliedBookingCode = upper;
      } else if (req.body.bookingCode === '') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_CODE',
          error: 'Kode reservasi tidak valid.',
          message: 'Kode reservasi tidak valid.',
        });
      }

      let suppliedPaymentId = '';
      if (req.body.paymentId !== undefined && req.body.paymentId !== null) {
        if (!isValidStage7dDocId(req.body.paymentId, 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_PAYMENT_ID',
            error: 'ID pembayaran tidak valid.',
            message: 'ID pembayaran tidak valid.',
          });
        }
        suppliedPaymentId = req.body.paymentId;
      }

      const rawNewStatus = req.body.newStatus;
      if (
        typeof rawNewStatus !== 'string' ||
        !STAGE7D_ALLOWED_REFUND_STATUSES.has(rawNewStatus)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_REFUND_STATUS',
          error: 'Status refund manual tidak didukung.',
          message: 'Status refund manual tidak didukung.',
        });
      }
      const newStatus = rawNewStatus;

      const rawRefundAmount = req.body.refundAmount;
      let validatedRefundAmount: number | null = null;
      if (rawRefundAmount !== undefined && rawRefundAmount !== null) {
        if (
          typeof rawRefundAmount !== 'number' ||
          !Number.isFinite(rawRefundAmount) ||
          rawRefundAmount <= 0 ||
          rawRefundAmount > 100_000_000
        ) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_AMOUNT',
            error: 'Nominal refund manual tidak valid.',
            message: 'Nominal refund manual tidak valid.',
          });
        }
        validatedRefundAmount = rawRefundAmount;
      }

      const rawRefundMethod = req.body.refundMethod;
      let sanitizedMethod = '';
      if (rawRefundMethod !== undefined && rawRefundMethod !== null) {
        if (typeof rawRefundMethod !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_METHOD',
            error: 'Metode refund manual tidak valid.',
            message: 'Metode refund manual tidak valid.',
          });
        }
        sanitizedMethod = rawRefundMethod.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
        if (!sanitizedMethod || sanitizedMethod.length > 100) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_METHOD',
            error: 'Metode refund manual tidak valid.',
            message: 'Metode refund manual tidak valid.',
          });
        }
      }

      const rawRefundDate = req.body.refundDate;
      let sanitizedDate = '';
      if (rawRefundDate !== undefined && rawRefundDate !== null) {
        if (typeof rawRefundDate !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_DATE',
            error: 'Tanggal refund manual tidak valid.',
            message: 'Tanggal refund manual tidak valid.',
          });
        }
        sanitizedDate = rawRefundDate.trim();
        if (!isValidStage7dDateString(sanitizedDate)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_DATE',
            error: 'Tanggal refund manual tidak valid.',
            message: 'Tanggal refund manual tidak valid.',
          });
        }
      }

      const rawRefundReference = req.body.refundReference;
      let sanitizedReference = '';
      if (rawRefundReference !== undefined && rawRefundReference !== null) {
        if (typeof rawRefundReference !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_REFERENCE',
            error: 'Referensi refund manual tidak valid.',
            message: 'Referensi refund manual tidak valid.',
          });
        }
        sanitizedReference = rawRefundReference
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .trim();
        if (sanitizedReference.length > 150) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_REFERENCE',
            error: 'Referensi refund manual melebihi batas.',
            message: 'Referensi refund manual melebihi batas.',
          });
        }
      }

      const rawRefundProofUrl = req.body.refundProofUrl;
      let sanitizedProofUrl = '';
      if (rawRefundProofUrl !== undefined && rawRefundProofUrl !== null) {
        if (typeof rawRefundProofUrl !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_PROOF_URL',
            error: 'URL bukti refund manual tidak valid.',
            message: 'URL bukti refund manual tidak valid.',
          });
        }
        sanitizedProofUrl = rawRefundProofUrl
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .trim();
        if (sanitizedProofUrl.length > 2000) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_PROOF_URL',
            error: 'URL bukti refund manual melebihi batas.',
            message: 'URL bukti refund manual melebihi batas.',
          });
        }
      }

      const rawNote = req.body.note;
      let sanitizedNote = '';
      if (rawNote !== undefined && rawNote !== null) {
        if (
          typeof rawNote !== 'string' ||
          rawNote.length > 1000 ||
          Buffer.byteLength(rawNote, 'utf8') > 1000
        ) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFUND_NOTE',
            error: 'Catatan refund manual tidak valid atau melebihi batas.',
            message: 'Catatan refund manual tidak valid atau melebihi batas.',
          });
        }
        sanitizedNote = rawNote.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
      }

      const rawRequestId = req.body.requestId;
      let cleanRequestId = '';
      if (rawRequestId !== undefined) {
        if (!isValidStage7dDocId(rawRequestId, 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REQUEST_ID',
            error: 'ID permintaan (requestId) tidak valid.',
            message: 'ID permintaan (requestId) tidak valid.',
          });
        }
        cleanRequestId = rawRequestId;
      }

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: 'Database server sedang tidak tersedia.',
          message: 'Database server sedang tidak tersedia.',
        });
      }

      const receiptId = cleanRequestId
        ? `pgr_mref_${createHash('sha256')
            .update(`manual_refund_status:${verifiedUid}:${cleanRequestId}`)
            .digest('hex')
            .slice(0, 40)}`
        : '';

      const completionGuardId = `pgr_mref_guard_${createHash('sha256')
        .update(`case_manual_refund_guard:${caseId}`)
        .digest('hex')
        .slice(0, 40)}`;

      const manualRefundHistId = `psh_mref_${createHash('sha256')
        .update(`case_manual_refund:${caseId}`)
        .digest('hex')
        .slice(0, 36)}`;

      const fallbackManualRefundHistId = `psh_mref_${createHash('sha256')
        .update(`case_manual_refund:${caseId}`)
        .digest('hex')
        .slice(0, 20)}_${Date.now().toString(36)}_${randomInt(100000, 1000000).toString(36)}`;

      const requestFingerprint = computeManualRefundFingerprint({
        actorUid: verifiedUid,
        caseId,
        newStatus,
        refundAmount: validatedRefundAmount,
        refundMethod: sanitizedMethod,
        refundDate: sanitizedDate,
        refundReference: sanitizedReference,
        refundProofUrl: sanitizedProofUrl,
        note: sanitizedNote,
      });

      const txResult: any = await adminDb.runTransaction(async (transaction: any) => {
        const roleRef = adminDb.collection('staff_roles').doc(verifiedUid);
        const canonicalStaffQuery = adminDb
          .collection('staff_users')
          .where('authUserId', '==', verifiedUid)
          .limit(2);
        const legacyStaffQuery = adminDb
          .collection('staff_users')
          .where('authUid', '==', verifiedUid)
          .limit(2);
        const directStaffRef = adminDb.collection('staff_users').doc(verifiedUid);
        const caseRef = adminDb.collection('cases').doc(caseId);
        const receiptRef = receiptId
          ? adminDb.collection('payment_governance_receipts').doc(receiptId)
          : null;
        const completionGuardRef = adminDb
          .collection('payment_governance_receipts')
          .doc(completionGuardId);
        const caseReceiptsQuery = adminDb
          .collection('payment_governance_receipts')
          .where('caseId', '==', caseId);
        const manualRefundHistRef = adminDb
          .collection('payment_status_history')
          .doc(manualRefundHistId);
        const fallbackManualRefundHistRef = adminDb
          .collection('payment_status_history')
          .doc(fallbackManualRefundHistId);
        const caseRefundHistQuery = adminDb
          .collection('payment_status_history')
          .where('caseId', '==', caseId);

        const [
          roleSnap,
          canonicalStaffSnap,
          legacyStaffSnap,
          directStaffSnap,
          caseSnap,
          receiptSnap,
          completionGuardSnap,
          caseReceiptsQuerySnap,
          manualRefundHistSnap,
          fallbackManualRefundHistSnap,
          caseRefundHistQuerySnap,
        ] = await Promise.all([
          transaction.get(roleRef),
          transaction.get(canonicalStaffQuery),
          transaction.get(legacyStaffQuery),
          transaction.get(directStaffRef),
          transaction.get(caseRef),
          receiptRef ? transaction.get(receiptRef) : Promise.resolve(null),
          transaction.get(completionGuardRef),
          transaction.get(caseReceiptsQuery),
          transaction.get(manualRefundHistRef),
          transaction.get(fallbackManualRefundHistRef),
          transaction.get(caseRefundHistQuery),
        ]);

        const staffDocs = new Map<string, any>();
        for (const d of [
          ...(canonicalStaffSnap?.docs || []),
          ...(legacyStaffSnap?.docs || []),
        ]) {
          if (snapExists(d)) staffDocs.set(d.id, d);
        }
        if (snapExists(directStaffSnap)) {
          staffDocs.set(directStaffSnap.id, directStaffSnap);
        }

        const roleExists = snapExists(roleSnap);
        const roleData = roleExists ? roleSnap.data() || {} : {};
        if (roleExists) {
          for (const linked of [roleData.staffId, roleData.staffUserId]) {
            if (typeof linked === 'string' && isValidStage7dDocId(linked, 128) && !staffDocs.has(linked)) {
              const linkedSnap = await transaction.get(
                adminDb.collection('staff_users').doc(linked)
              );
              if (snapExists(linkedSnap)) {
                staffDocs.set(linkedSnap.id, linkedSnap);
              }
            }
          }
        }

        let bookingSnap: any = null;
        let bookingByCodeSnap: any = null;
        let paymentsByBookingIdSnap: any = null;
        let customerSnap: any = null;
        const allFetchedPayments = new Map<string, any>();
        const allFetchedHistoryDocs = new Map<string, any>();

        if (snapExists(manualRefundHistSnap)) {
          allFetchedHistoryDocs.set(manualRefundHistId, manualRefundHistSnap);
        }
        if (snapExists(fallbackManualRefundHistSnap)) {
          allFetchedHistoryDocs.set(fallbackManualRefundHistId, fallbackManualRefundHistSnap);
        }
        for (const d of caseRefundHistQuerySnap?.docs || []) {
          if (snapExists(d)) {
            allFetchedHistoryDocs.set(d.id, d);
          }
        }

        if (snapExists(caseSnap)) {
          const cData = caseSnap.data() || {};
          const cBookingId = textId(cData.bookingId);
          const cBookingCode = textId(cData.bookingCode).toUpperCase();
          const cCustomerId = textId(cData.customerId);

          if (isValidStage7dDocId(cBookingId, 128)) {
            const [bSnap, pSnap] = await Promise.all([
              transaction.get(adminDb.collection('bookings').doc(cBookingId)),
              transaction.get(
                adminDb.collection('payments').where('bookingId', '==', cBookingId)
              ),
            ]);
            bookingSnap = bSnap;
            paymentsByBookingIdSnap = pSnap;
            for (const d of paymentsByBookingIdSnap?.docs || []) {
              if (snapExists(d)) {
                allFetchedPayments.set(d.id, d);
              }
            }
          }

          const candidateCustId =
            cCustomerId ||
            (snapExists(bookingSnap) ? textId((bookingSnap.data() || {}).customerId) : '');
          if (isValidStage7dDocId(candidateCustId, 128)) {
            customerSnap = await transaction.get(
              adminDb.collection('customers').doc(candidateCustId)
            );
          }

          const extraPayIds = new Set<string>();
          if (snapExists(bookingSnap)) {
            const activePayId = textId((bookingSnap.data() || {}).activePaymentId);
            if (isValidStage7dDocId(activePayId, 128)) extraPayIds.add(activePayId);
          }
          const recPayId = textId(cData?.recovery?.refundPaymentId);
          if (isValidStage7dDocId(recPayId, 128)) extraPayIds.add(recPayId);
          if (snapExists(receiptSnap)) {
            const rPayId = textId(receiptSnap.data()?.responsePayload?.paymentId);
            if (isValidStage7dDocId(rPayId, 128)) extraPayIds.add(rPayId);
          }
          if (snapExists(completionGuardSnap)) {
            const gPayId = textId(completionGuardSnap.data()?.paymentId);
            if (isValidStage7dDocId(gPayId, 128)) extraPayIds.add(gPayId);
          }
          for (const d of caseReceiptsQuerySnap?.docs || []) {
            if (snapExists(d)) {
              const dPayId = textId(d.data()?.responsePayload?.paymentId);
              if (isValidStage7dDocId(dPayId, 128)) extraPayIds.add(dPayId);
            }
          }
          if (suppliedPaymentId) extraPayIds.add(suppliedPaymentId);

          for (const payId of extraPayIds) {
            if (!allFetchedPayments.has(payId)) {
              const pDocSnap = await transaction.get(
                adminDb.collection('payments').doc(payId)
              );
              if (snapExists(pDocSnap)) {
                allFetchedPayments.set(payId, pDocSnap);
              }
            }
          }

          const extraHistIds = new Set<string>();
          const recHistId = textId(cData?.recovery?.refundPaymentHistoryId);
          if (isValidStage7dDocId(recHistId, 128)) extraHistIds.add(recHistId);
          if (snapExists(receiptSnap)) {
            const rHistId = textId(receiptSnap.data()?.responsePayload?.paymentHistoryId);
            if (isValidStage7dDocId(rHistId, 128)) extraHistIds.add(rHistId);
          }
          if (snapExists(completionGuardSnap)) {
            const gHistId = textId(completionGuardSnap.data()?.paymentHistoryId);
            if (isValidStage7dDocId(gHistId, 128)) extraHistIds.add(gHistId);
          }
          for (const d of caseReceiptsQuerySnap?.docs || []) {
            if (snapExists(d)) {
              const dHistId = textId(d.data()?.responsePayload?.paymentHistoryId);
              if (isValidStage7dDocId(dHistId, 128)) extraHistIds.add(dHistId);
            }
          }

          for (const hId of extraHistIds) {
            if (!allFetchedHistoryDocs.has(hId)) {
              const hDocSnap = await transaction.get(
                adminDb.collection('payment_status_history').doc(hId)
              );
              if (snapExists(hDocSnap)) {
                allFetchedHistoryDocs.set(hId, hDocSnap);
              }
            }
          }

          const lookupCode =
            (snapExists(bookingSnap)
              ? textId((bookingSnap.data() || {}).bookingCode).toUpperCase()
              : '') || cBookingCode;
          if (isValidStage7dBookingCode(lookupCode, 64)) {
            bookingByCodeSnap = await transaction.get(
              adminDb.collection('bookings').where('bookingCode', '==', lookupCode).limit(2)
            );
          }
        }

        // 1. Verify current active Manager/Admin identity inside transaction
        const managerCheck = validateStage7dActiveManagerIdentity(
          verifiedUid,
          roleExists,
          roleData,
          staffDocs
        );
        if (!managerCheck.ok) {
          return {
            status: managerCheck.status,
            code: managerCheck.code,
            message: managerCheck.message,
          };
        }

        // 2. Verify persisted case, recovery, and booking linkage
        if (!snapExists(caseSnap)) {
          return {
            status: 404,
            code: 'CASE_NOT_FOUND',
            message: 'Data kasus tidak ditemukan.',
          };
        }
        const caseData = caseSnap.data() || {};
        if (
          caseData.id !== undefined &&
          caseData.id !== null &&
          caseData.id !== '' &&
          (typeof caseData.id !== 'string' || caseData.id !== caseId)
        ) {
          return {
            status: 409,
            code: 'CASE_ID_CONFLICT',
            message: 'Identitas dokumen kasus tidak konsisten.',
          };
        }

        if (
          caseData.caseCode !== undefined &&
          caseData.caseCode !== null &&
          caseData.caseCode !== '' &&
          (typeof caseData.caseCode !== 'string' ||
            caseData.caseCode.trim().length > 64 ||
            /[\x00-\x1F\x7F]/.test(caseData.caseCode))
        ) {
          return {
            status: 409,
            code: 'INVALID_CASE_CODE',
            message: 'Kode kasus pada dokumen tidak valid.',
          };
        }
        const persistedCaseCode = textId(caseData.caseCode) || caseId;
        if (suppliedCaseCode && suppliedCaseCode !== persistedCaseCode) {
          return {
            status: 409,
            code: 'FOREIGN_CASE_CODE_LINKAGE',
            message: 'Kode kasus pada permintaan tidak sesuai dengan kasus tersimpan.',
          };
        }

        const persistedCustomerId = textId(caseData.customerId);
        if (suppliedCustomerId && persistedCustomerId && suppliedCustomerId !== persistedCustomerId) {
          return {
            status: 409,
            code: 'FOREIGN_CUSTOMER_LINKAGE',
            message: 'ID pelanggan pada permintaan tidak sesuai dengan kasus tersimpan.',
          };
        }

        const caseOwnerRes = extractConsistentRecordOwnerUid(caseData);
        if (!caseOwnerRes.ok) {
          return {
            status: 409,
            code: caseOwnerRes.code,
            message: caseOwnerRes.message,
          };
        }

        if (
          !caseData.recovery ||
          typeof caseData.recovery !== 'object' ||
          Array.isArray(caseData.recovery)
        ) {
          return {
            status: 400,
            code: 'RECOVERY_NOT_FOUND',
            message: 'Kasus ini belum memiliki recovery record.',
          };
        }
        const rec = caseData.recovery as Record<string, any>;

        const persistedBookingId = textId(caseData.bookingId);
        const persistedBookingCode = textId(caseData.bookingCode).toUpperCase();

        if (suppliedBookingId && suppliedBookingId !== persistedBookingId) {
          return {
            status: 409,
            code: 'FOREIGN_BOOKING_LINKAGE',
            message: 'ID reservasi pada permintaan tidak sesuai dengan kasus tersimpan.',
          };
        }
        if (suppliedBookingCode && suppliedBookingCode !== persistedBookingCode) {
          return {
            status: 409,
            code: 'FOREIGN_BOOKING_CODE_LINKAGE',
            message: 'Kode reservasi pada permintaan tidak sesuai dengan kasus tersimpan.',
          };
        }

        if (
          caseData.bookingId !== undefined &&
          caseData.bookingId !== null &&
          caseData.bookingId !== '' &&
          !isValidStage7dDocId(persistedBookingId, 128)
        ) {
          return {
            status: 409,
            code: 'INVALID_CASE_BOOKING_ID',
            message: 'ID reservasi pada dokumen kasus tidak valid.',
          };
        }

        let canonicalBookingCode = persistedBookingCode;
        let bookingData: Record<string, any> | null = null;
        let bkOwnerUid: string | null = null;
        let bkCustomerId = '';

        if (persistedBookingId && snapExists(bookingSnap)) {
          bookingData = bookingSnap.data() || {};
          if (
            bookingData!.id !== undefined &&
            bookingData!.id !== null &&
            bookingData!.id !== '' &&
            (typeof bookingData!.id !== 'string' || bookingData!.id !== persistedBookingId)
          ) {
            return {
              status: 409,
              code: 'BOOKING_ID_CONFLICT',
              message: 'Identitas dokumen reservasi terkait kasus tidak konsisten.',
            };
          }
          const bkCode = textId(bookingData!.bookingCode).toUpperCase();
          if (persistedBookingCode && bkCode && persistedBookingCode !== bkCode) {
            return {
              status: 409,
              code: 'FOREIGN_BOOKING_CODE_LINKAGE',
              message: 'Kode reservasi pada kasus tidak sesuai dengan dokumen reservasi.',
            };
          }
          canonicalBookingCode = bkCode || persistedBookingCode;
          for (const d of bookingByCodeSnap?.docs || []) {
            if (snapExists(d) && d.id !== persistedBookingId) {
              return {
                status: 409,
                code: 'BOOKING_CODE_CONFLICT',
                message: 'Kode reservasi merujuk pada lebih dari satu dokumen pesanan.',
              };
            }
          }
          bkCustomerId = textId(bookingData!.customerId);
          if (persistedCustomerId && bkCustomerId && persistedCustomerId !== bkCustomerId) {
            return {
              status: 409,
              code: 'FOREIGN_CUSTOMER_LINKAGE',
              message: 'ID pelanggan pada kasus tidak sesuai dengan dokumen reservasi.',
            };
          }
          if (suppliedCustomerId && bkCustomerId && suppliedCustomerId !== bkCustomerId) {
            return {
              status: 409,
              code: 'FOREIGN_CUSTOMER_LINKAGE',
              message: 'ID pelanggan pada permintaan tidak sesuai dengan dokumen reservasi.',
            };
          }
          const bkOwnerRes = extractConsistentRecordOwnerUid(bookingData);
          if (!bkOwnerRes.ok) {
            return {
              status: 409,
              code: bkOwnerRes.code,
              message: bkOwnerRes.message,
            };
          }
          bkOwnerUid = bkOwnerRes.ownerUid || null;
          if (
            caseOwnerRes.ownerUid &&
            bkOwnerUid &&
            caseOwnerRes.ownerUid !== bkOwnerUid
          ) {
            return {
              status: 409,
              code: 'FOREIGN_OWNER_LINKAGE',
              message: 'Kepemilikan pengguna pada kasus tidak sesuai dengan dokumen reservasi.',
            };
          }
        }

        let custOwnerUid: string | null = null;
        if (snapExists(customerSnap)) {
          const custOwnerRes = extractConsistentRecordOwnerUid(customerSnap.data() || {});
          if (!custOwnerRes.ok) {
            return {
              status: 409,
              code: custOwnerRes.code,
              message: custOwnerRes.message,
            };
          }
          custOwnerUid = custOwnerRes.ownerUid || null;
          const authoritativeOwner = bkOwnerUid || caseOwnerRes.ownerUid || null;
          if (authoritativeOwner && custOwnerUid && custOwnerUid !== authoritativeOwner) {
            return {
              status: 409,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              message: 'Profil CRM pelanggan memiliki UID yang bertentangan dengan pemilik reservasi/kasus.',
            };
          }
        }

        // Evaluate current payment candidates and helper for current linked-payment revalidation
        const validPaymentCandidates: Array<{ id: string; data: Record<string, any> }> = [];
        let hasInvalidOrConflictingPayment = false;

        if (persistedBookingId && bookingData) {
          const bookingCandidateDocs = new Map<string, any>();
          for (const d of paymentsByBookingIdSnap?.docs || []) {
            if (snapExists(d)) bookingCandidateDocs.set(d.id, d);
          }
          const activePayId = textId(bookingData.activePaymentId);
          if (activePayId && allFetchedPayments.has(activePayId)) {
            bookingCandidateDocs.set(activePayId, allFetchedPayments.get(activePayId));
          }

          for (const [pId, pSnap] of bookingCandidateDocs.entries()) {
            const pData = pSnap.data() || {};
            if (
              pData.id !== undefined &&
              pData.id !== null &&
              pData.id !== '' &&
              pData.id !== pId
            ) {
              hasInvalidOrConflictingPayment = true;
              continue;
            }
            if (textId(pData.bookingId) !== persistedBookingId) {
              hasInvalidOrConflictingPayment = true;
              continue;
            }
            const pCode = textId(pData.bookingCode).toUpperCase();
            if (pCode && canonicalBookingCode && pCode !== canonicalBookingCode) {
              hasInvalidOrConflictingPayment = true;
              continue;
            }
            const pCustId = textId(pData.customerId);
            if (
              (pCustId && bkCustomerId && pCustId !== bkCustomerId) ||
              (pCustId && persistedCustomerId && pCustId !== persistedCustomerId)
            ) {
              hasInvalidOrConflictingPayment = true;
              continue;
            }
            const pOwnerRes = extractConsistentRecordOwnerUid(pData);
            if (!pOwnerRes.ok) {
              hasInvalidOrConflictingPayment = true;
              continue;
            }
            if (
              (pOwnerRes.ownerUid && bkOwnerUid && pOwnerRes.ownerUid !== bkOwnerUid) ||
              (pOwnerRes.ownerUid && !bkOwnerUid) ||
              (pOwnerRes.ownerUid &&
                caseOwnerRes.ownerUid &&
                pOwnerRes.ownerUid !== caseOwnerRes.ownerUid) ||
              (pOwnerRes.ownerUid && custOwnerUid && pOwnerRes.ownerUid !== custOwnerUid)
            ) {
              hasInvalidOrConflictingPayment = true;
              continue;
            }
            validPaymentCandidates.push({ id: pId, data: pData });
          }
        }

        const validateCurrentLinkedPayment = (
          targetPaymentId: string
        ): { ok: boolean; code?: string; message?: string } => {
          if (!isValidStage7dDocId(targetPaymentId, 128) || !persistedBookingId || !bookingData) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_MISSING_BOOKING',
              message: 'Dokumen reservasi untuk pembayaran tertaut tidak valid atau tidak ditemukan.',
            };
          }
          const pSnap = allFetchedPayments.get(targetPaymentId);
          if (!snapExists(pSnap)) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_NOT_FOUND',
              message: 'Dokumen pembayaran tertaut tidak ditemukan.',
            };
          }
          const pData = pSnap.data() || {};
          if (
            pData.id !== undefined &&
            pData.id !== null &&
            pData.id !== '' &&
            pData.id !== targetPaymentId
          ) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_ID_CONFLICT',
              message: 'Identitas dokumen pembayaran tertaut tidak konsisten.',
            };
          }
          if (textId(pData.bookingId) !== persistedBookingId) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_BOOKING_MISMATCH',
              message: 'Dokumen pembayaran tertaut merujuk pada reservasi yang berbeda.',
            };
          }
          const pCode = textId(pData.bookingCode).toUpperCase();
          if (pCode && canonicalBookingCode && pCode !== canonicalBookingCode) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_BOOKING_CODE_MISMATCH',
              message: 'Kode reservasi pada pembayaran tertaut mengalami konflik.',
            };
          }
          const pCustId = textId(pData.customerId);
          if (
            (pCustId && bkCustomerId && pCustId !== bkCustomerId) ||
            (pCustId && persistedCustomerId && pCustId !== persistedCustomerId)
          ) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_CUSTOMER_MISMATCH',
              message: 'ID pelanggan pada pembayaran tertaut mengalami konflik.',
            };
          }
          const pOwnerRes = extractConsistentRecordOwnerUid(pData);
          if (!pOwnerRes.ok) {
            return {
              ok: false,
              code: pOwnerRes.code || 'LINKED_PAYMENT_OWNERSHIP_INVALID',
              message:
                pOwnerRes.message || 'Atribut kepemilikan pada pembayaran tertaut mengalami konflik.',
            };
          }
          if (
            (pOwnerRes.ownerUid && bkOwnerUid && pOwnerRes.ownerUid !== bkOwnerUid) ||
            (pOwnerRes.ownerUid && !bkOwnerUid) ||
            (pOwnerRes.ownerUid &&
              caseOwnerRes.ownerUid &&
              pOwnerRes.ownerUid !== caseOwnerRes.ownerUid) ||
            (pOwnerRes.ownerUid && custOwnerUid && pOwnerRes.ownerUid !== custOwnerUid)
          ) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_OWNERSHIP_CONFLICT',
              message: 'Kepemilikan pengguna pada pembayaran tertaut bertentangan dengan reservasi/kasus.',
            };
          }
          const activePayId = textId(bookingData.activePaymentId);
          if (activePayId && activePayId !== targetPaymentId) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_REASSIGNED',
              message: 'activePaymentId pada reservasi tidak lagi merujuk pada pembayaran tertaut.',
            };
          }
          const recPayId = textId(rec.refundPaymentId);
          if (recPayId && recPayId !== targetPaymentId) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_RECOVERY_MISMATCH',
              message: 'Referensi pembayaran pada recovery kasus mengalami konflik.',
            };
          }
          if (hasInvalidOrConflictingPayment) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_CANDIDATE_CONFLICT',
              message: 'Ditemukan kandidat pembayaran lain yang mengalami konflik kepemilikan atau identitas.',
            };
          }
          const otherPaid = validPaymentCandidates.filter(
            (c) => c.id !== targetPaymentId && textId(c.data.status).toLowerCase() === 'paid'
          );
          if (otherPaid.length > 0) {
            return {
              ok: false,
              code: 'LINKED_PAYMENT_AMBIGUOUS',
              message: 'Terdapat lebih dari satu pembayaran terverifikasi untuk reservasi ini.',
            };
          }
          return { ok: true };
        };

        const validateTrustedRefundHistoryDoc = (params: {
          histId: string;
          expectedPaymentId: string;
          expectedAmount: number;
          expectedActorUid: string;
          expectedActorStaffId: string;
        }): boolean => {
          if (
            !isValidStage7dDocId(params.histId, 128) ||
            !isValidStage7dDocId(params.expectedPaymentId, 128)
          ) {
            return false;
          }
          const hSnap = allFetchedHistoryDocs.get(params.histId);
          if (!snapExists(hSnap)) return false;
          const hData = hSnap.data() || {};
          return (
            hData.id === params.histId &&
            hData.caseId === caseId &&
            hData.caseCode === persistedCaseCode &&
            hData.paymentId === params.expectedPaymentId &&
            hData.bookingId === persistedBookingId &&
            textId(hData.bookingCode).toUpperCase() === canonicalBookingCode &&
            typeof hData.amount === 'number' &&
            Number.isFinite(hData.amount) &&
            hData.amount === params.expectedAmount &&
            hData.eventType === 'refund_processed' &&
            hData.confirmationType === 'MANUAL_MANAGER_CONFIRMATION' &&
            hData.serverAuthoritative === true &&
            hData.actorUid === params.expectedActorUid &&
            hData.userId === params.expectedActorStaffId
          );
        };

        const allowedManualRefundRespKeys = new Set<string>([
          'caseId',
          'caseCode',
          'bookingId',
          'bookingCode',
          'oldStatus',
          'newStatus',
          'recovery',
          'paymentHistoryLinked',
          'reviewRequired',
          'paymentId',
          'paymentHistoryId',
          'linkageReviewReason',
          'caseEventId',
          'auditId',
        ]);

        const validateManualRefundReceiptDoc = (
          expectedReceiptId: string,
          receipt: Record<string, any>
        ): boolean => {
          const resp = receipt?.responsePayload;
          const isValidEnvelope =
            Boolean(receipt && typeof receipt === 'object' && !Array.isArray(receipt)) &&
            receipt.id === expectedReceiptId &&
            receipt.action === 'manual_refund_status' &&
            isValidStage7dDocId(receipt.actorUid, 128) &&
            isValidStage7dDocId(receipt.actorStaffId, 128) &&
            (receipt.actorRole === 'manager' || receipt.actorRole === 'admin') &&
            typeof receipt.actorName === 'string' &&
            receipt.actorName.trim().length > 0 &&
            receipt.actorName.length <= 120 &&
            isValidStage7dDocId(receipt.requestId, 128) &&
            isValidStage7dDocId(receipt.caseId, 128) &&
            typeof receipt.newStatus === 'string' &&
            STAGE7D_ALLOWED_REFUND_STATUSES.has(receipt.newStatus) &&
            (receipt.refundAmount === null ||
              (typeof receipt.refundAmount === 'number' &&
                Number.isFinite(receipt.refundAmount) &&
                receipt.refundAmount > 0 &&
                receipt.refundAmount <= 100_000_000)) &&
            typeof receipt.refundMethod === 'string' &&
            receipt.refundMethod.length <= 100 &&
            typeof receipt.refundDate === 'string' &&
            (receipt.refundDate === '' || isValidStage7dDateString(receipt.refundDate)) &&
            typeof receipt.refundReference === 'string' &&
            receipt.refundReference.length <= 150 &&
            typeof receipt.refundProofUrl === 'string' &&
            receipt.refundProofUrl.length <= 2000 &&
            typeof receipt.note === 'string' &&
            receipt.note.length <= 1000 &&
            typeof receipt.fingerprint === 'string' &&
            /^[a-f0-9]{64}$/.test(receipt.fingerprint) &&
            receipt.fingerprint ===
              computeManualRefundFingerprint({
                actorUid: receipt.actorUid,
                caseId: receipt.caseId,
                newStatus: receipt.newStatus,
                refundAmount: receipt.refundAmount,
                refundMethod: receipt.refundMethod,
                refundDate: receipt.refundDate,
                refundReference: receipt.refundReference,
                refundProofUrl: receipt.refundProofUrl,
                note: receipt.note,
              }) &&
            typeof receipt.committedAt === 'string' &&
            !Number.isNaN(Date.parse(receipt.committedAt)) &&
            Boolean(resp && typeof resp === 'object' && !Array.isArray(resp)) &&
            (receipt.responseFingerprint === undefined ||
              (typeof receipt.responseFingerprint === 'string' &&
                /^[a-f0-9]{64}$/.test(receipt.responseFingerprint) &&
                receipt.responseFingerprint === computeStage7dResponseFingerprint(resp)));

          if (!isValidEnvelope) return false;

          const expectedCaseEventId = `cevt_mref_${createHash('sha256')
            .update(`manual_refund_status:${receipt.actorUid}:${receipt.requestId}`)
            .digest('hex')
            .slice(0, 32)}`;
          const expectedAuditId = `audit_mref_${createHash('sha256')
            .update(`manual_refund_status:${receipt.actorUid}:${receipt.requestId}`)
            .digest('hex')
            .slice(0, 32)}`;

          const respKeysOk = Object.keys(resp).every((k) => allowedManualRefundRespKeys.has(k));
          const respRec = resp.recovery;
          if (
            !respKeysOk ||
            resp.caseId !== receipt.caseId ||
            typeof resp.caseCode !== 'string' ||
            !resp.caseCode.trim() ||
            resp.caseCode.length > 64 ||
            typeof resp.bookingId !== 'string' ||
            typeof resp.bookingCode !== 'string' ||
            !(
              resp.oldStatus === null ||
              (typeof resp.oldStatus === 'string' && resp.oldStatus.length <= 64)
            ) ||
            resp.newStatus !== receipt.newStatus ||
            typeof resp.paymentHistoryLinked !== 'boolean' ||
            typeof resp.reviewRequired !== 'boolean' ||
            resp.caseEventId !== expectedCaseEventId ||
            resp.auditId !== expectedAuditId ||
            !respRec ||
            typeof respRec !== 'object' ||
            Array.isArray(respRec)
          ) {
            return false;
          }

          if (
            respRec.refundStatus !== receipt.newStatus ||
            respRec.refundProcessedBy !== receipt.actorStaffId ||
            respRec.refundProcessedByName !== receipt.actorName ||
            respRec.refundProcessedAt !== receipt.committedAt ||
            typeof respRec.refundDate !== 'string' ||
            !isValidStage7dDateString(respRec.refundDate) ||
            (receipt.refundDate !== '' && respRec.refundDate !== receipt.refundDate) ||
            (receipt.refundMethod !== '' && respRec.refundMethod !== receipt.refundMethod) ||
            (receipt.refundReference !== '' &&
              respRec.refundReference !== receipt.refundReference) ||
            (receipt.refundProofUrl !== '' && respRec.refundProofUrl !== receipt.refundProofUrl)
          ) {
            return false;
          }

          if (receipt.refundAmount !== null && respRec.refundAmount !== receipt.refundAmount) {
            return false;
          }
          if (
            respRec.refundAmount !== undefined &&
            respRec.refundAmount !== null &&
            (typeof respRec.refundAmount !== 'number' ||
              !Number.isFinite(respRec.refundAmount) ||
              respRec.refundAmount <= 0 ||
              respRec.refundAmount > 100_000_000)
          ) {
            return false;
          }

          if (receipt.newStatus !== 'COMPLETED_MANUAL') {
            if (
              resp.paymentHistoryLinked !== false ||
              resp.reviewRequired !== false ||
              resp.paymentId !== undefined ||
              resp.paymentHistoryId !== undefined
            ) {
              return false;
            }
          } else {
            if (
              typeof respRec.refundAmount !== 'number' ||
              !Number.isFinite(respRec.refundAmount) ||
              respRec.refundAmount <= 0 ||
              resp.paymentHistoryLinked !== !resp.reviewRequired ||
              respRec.refundPaymentHistoryLinked !== resp.paymentHistoryLinked ||
              respRec.refundLinkageReviewRequired !== resp.reviewRequired
            ) {
              return false;
            }
            if (resp.paymentHistoryLinked) {
              if (
                !isValidStage7dDocId(resp.paymentId, 128) ||
                !isValidStage7dDocId(resp.paymentHistoryId, 128) ||
                respRec.refundPaymentId !== resp.paymentId ||
                respRec.refundPaymentHistoryId !== resp.paymentHistoryId ||
                resp.linkageReviewReason !== undefined
              ) {
                return false;
              }
            } else {
              if (
                resp.paymentId !== undefined ||
                resp.paymentHistoryId !== undefined ||
                respRec.refundPaymentId !== undefined ||
                respRec.refundPaymentHistoryId !== undefined ||
                (resp.linkageReviewReason !== undefined &&
                  (typeof resp.linkageReviewReason !== 'string' ||
                    !resp.linkageReviewReason.trim() ||
                    resp.linkageReviewReason.length > 500))
              ) {
                return false;
              }
            }
          }

          return true;
        };

        // 3. Validate committed idempotency receipt BEFORE new-transition checks
        if (receiptRef && snapExists(receiptSnap)) {
          const receipt = receiptSnap.data() || {};
          const isValidReceipt =
            receipt.actorUid === verifiedUid &&
            receipt.requestId === cleanRequestId &&
            validateManualRefundReceiptDoc(receiptId, receipt);

          if (!isValidReceipt) {
            return {
              status: 409,
              code: 'RECEIPT_CORRUPTED',
              message: 'Bukti idempotensi status refund manual tidak valid atau rusak.',
            };
          }

          if (
            receipt.fingerprint !== requestFingerprint ||
            receipt.caseId !== caseId ||
            receipt.newStatus !== newStatus
          ) {
            return {
              status: 409,
              code: 'IDEMPOTENCY_PARAMETER_MISMATCH',
              message:
                'ID permintaan (requestId) telah digunakan untuk pembaruan refund manual dengan parameter berbeda.',
            };
          }

          const resp = receipt.responsePayload;
          const respRec = resp.recovery;
          const isCanonicalCaseMatch =
            resp.caseId === caseId &&
            resp.caseCode === persistedCaseCode &&
            resp.bookingId === (persistedBookingId || '') &&
            resp.bookingCode === (canonicalBookingCode || '') &&
            (receipt.newStatus !== 'COMPLETED_MANUAL' ||
              receipt.refundAmount !== null ||
              typeof rec.refundAmount !== 'number' ||
              respRec.refundAmount === rec.refundAmount);

          if (!isCanonicalCaseMatch) {
            return {
              status: 409,
              code: 'RECEIPT_CORRUPTED',
              message: 'Respons idempotensi refund manual tidak sesuai dengan dokumen kasus otoritatif.',
            };
          }

          if (receipt.newStatus === 'COMPLETED_MANUAL') {
            if (textId(rec.refundStatus) !== 'COMPLETED_MANUAL') {
              return {
                status: 409,
                code: 'RECEIPT_CORRUPTED',
                message: 'Status penyelesaian refund manual pada kasus tidak konsisten dengan bukti idempotensi.',
              };
            }
            if (resp.paymentHistoryLinked) {
              const histValid = validateTrustedRefundHistoryDoc({
                histId: resp.paymentHistoryId,
                expectedPaymentId: resp.paymentId,
                expectedAmount: respRec.refundAmount,
                expectedActorUid: receipt.actorUid,
                expectedActorStaffId: receipt.actorStaffId,
              });
              if (!histValid) {
                return {
                  status: 409,
                  code: 'RECEIPT_CORRUPTED',
                  message: 'Riwayat pembayaran tertaut pada bukti idempotensi tidak valid atau mengalami konflik.',
                };
              }
              const currentLinkCheck = validateCurrentLinkedPayment(resp.paymentId);
              if (!currentLinkCheck.ok) {
                return {
                  status: 409,
                  code: currentLinkCheck.code || 'LINKED_PAYMENT_CONFLICT',
                  reviewRequired: true,
                  message:
                    currentLinkCheck.message ||
                    'Tautan pembayaran untuk konfirmasi refund manual mengalami konflik kepemilikan atau identitas.',
                };
              }
              if (suppliedPaymentId && suppliedPaymentId !== resp.paymentId) {
                return {
                  status: 409,
                  code: 'FOREIGN_PAYMENT_LINKAGE',
                  reviewRequired: true,
                  message: 'ID pembayaran pada permintaan tidak sesuai dengan pembayaran tertaut.',
                };
              }
            }
          }

          return {
            caseId: resp.caseId,
            caseCode: resp.caseCode,
            bookingId: resp.bookingId,
            bookingCode: resp.bookingCode,
            oldStatus: resp.oldStatus,
            newStatus: resp.newStatus,
            recovery: respRec,
            paymentHistoryLinked: resp.paymentHistoryLinked,
            reviewRequired: resp.reviewRequired,
            ...(resp.paymentHistoryLinked && resp.paymentId && resp.paymentHistoryId
              ? {
                  paymentId: resp.paymentId,
                  paymentHistoryId: resp.paymentHistoryId,
                }
              : {}),
            ...(resp.reviewRequired && typeof resp.linkageReviewReason === 'string'
              ? { linkageReviewReason: resp.linkageReviewReason }
              : {}),
            caseEventId: resp.caseEventId,
            auditId: resp.auditId,
            status: 200,
            isIdempotent: true,
          };
        }

        // Validate persisted refundAmount if present
        if (rec.refundAmount !== undefined && rec.refundAmount !== null) {
          if (
            typeof rec.refundAmount !== 'number' ||
            !Number.isFinite(rec.refundAmount) ||
            rec.refundAmount <= 0 ||
            rec.refundAmount > 100_000_000
          ) {
            return {
              status: 400,
              code: 'INVALID_PERSISTED_REFUND_AMOUNT',
              message: 'Nominal refund pada recovery kasus tidak valid.',
            };
          }
        }

        const effectiveRefundAmount: number | undefined =
          validatedRefundAmount !== null
            ? validatedRefundAmount
            : typeof rec.refundAmount === 'number'
            ? rec.refundAmount
            : undefined;

        if (
          newStatus === 'COMPLETED_MANUAL' &&
          (effectiveRefundAmount === undefined ||
            !Number.isFinite(effectiveRefundAmount) ||
            effectiveRefundAmount <= 0)
        ) {
          return {
            status: 400,
            code: 'REFUND_AMOUNT_REQUIRED',
            message: 'Nominal refund wajib bernilai positif untuk penyelesaian refund manual.',
          };
        }

        // 4. Inspect trusted private server completion provenance (never trust public payment_status_history rows alone)
        let trustedCompletion: {
          refundAmount: number;
          paymentHistoryLinked: boolean;
          reviewRequired: boolean;
          paymentId?: string;
          paymentHistoryId?: string;
          linkageReviewReason?: string;
        } | null = null;

        if (snapExists(completionGuardSnap)) {
          const guard = completionGuardSnap.data() || {};
          const isValidGuardBase =
            Boolean(guard && typeof guard === 'object' && !Array.isArray(guard)) &&
            guard.id === completionGuardId &&
            guard.action === 'manual_refund_completion_guard' &&
            guard.caseId === caseId &&
            guard.caseCode === persistedCaseCode &&
            guard.bookingId === (persistedBookingId || '') &&
            guard.bookingCode === (canonicalBookingCode || '') &&
            guard.newStatus === 'COMPLETED_MANUAL' &&
            isValidStage7dDocId(guard.actorUid, 128) &&
            isValidStage7dDocId(guard.actorStaffId, 128) &&
            (guard.actorRole === 'manager' || guard.actorRole === 'admin') &&
            typeof guard.actorName === 'string' &&
            guard.actorName.trim().length > 0 &&
            typeof guard.refundAmount === 'number' &&
            Number.isFinite(guard.refundAmount) &&
            guard.refundAmount > 0 &&
            guard.refundAmount <= 100_000_000 &&
            typeof guard.paymentHistoryLinked === 'boolean' &&
            typeof guard.reviewRequired === 'boolean' &&
            guard.paymentHistoryLinked === !guard.reviewRequired &&
            typeof guard.committedAt === 'string' &&
            !Number.isNaN(Date.parse(guard.committedAt));

          let isValidGuardLinks = false;
          if (isValidGuardBase) {
            if (guard.paymentHistoryLinked) {
              isValidGuardLinks =
                isValidStage7dDocId(guard.paymentId, 128) &&
                isValidStage7dDocId(guard.paymentHistoryId, 128) &&
                validateTrustedRefundHistoryDoc({
                  histId: guard.paymentHistoryId,
                  expectedPaymentId: guard.paymentId,
                  expectedAmount: guard.refundAmount,
                  expectedActorUid: guard.actorUid,
                  expectedActorStaffId: guard.actorStaffId,
                });
            } else {
              isValidGuardLinks =
                guard.paymentId === undefined && guard.paymentHistoryId === undefined;
            }
          }

          if (!isValidGuardBase || !isValidGuardLinks || textId(rec.refundStatus) !== 'COMPLETED_MANUAL') {
            return {
              status: 409,
              code: 'COMPLETION_GUARD_CORRUPTED',
              reviewRequired: true,
              message: 'Bukti provenance penyelesaian refund manual pada server tidak konsisten atau rusak.',
            };
          }

          trustedCompletion = {
            refundAmount: guard.refundAmount,
            paymentHistoryLinked: guard.paymentHistoryLinked,
            reviewRequired: guard.reviewRequired,
            ...(guard.paymentHistoryLinked
              ? {
                  paymentId: guard.paymentId,
                  paymentHistoryId: guard.paymentHistoryId,
                }
              : {}),
            ...(typeof guard.linkageReviewReason === 'string' && guard.linkageReviewReason
              ? { linkageReviewReason: guard.linkageReviewReason }
              : {}),
          };
        } else {
          // Preserve legitimate prior Stage 7D completions recorded before completionGuardId existed
          for (const d of caseReceiptsQuerySnap?.docs || []) {
            if (!snapExists(d) || !d.id.startsWith('pgr_mref_')) continue;
            const rData = d.data() || {};
            if (
              rData.action !== 'manual_refund_status' ||
              rData.caseId !== caseId ||
              rData.newStatus !== 'COMPLETED_MANUAL'
            ) {
              continue;
            }
            if (!validateManualRefundReceiptDoc(d.id, rData)) continue;
            const rResp = rData.responsePayload;
            if (
              rResp.caseId !== caseId ||
              rResp.caseCode !== persistedCaseCode ||
              rResp.bookingId !== (persistedBookingId || '') ||
              rResp.bookingCode !== (canonicalBookingCode || '')
            ) {
              continue;
            }
            if (rResp.paymentHistoryLinked) {
              const histOk = validateTrustedRefundHistoryDoc({
                histId: rResp.paymentHistoryId,
                expectedPaymentId: rResp.paymentId,
                expectedAmount: rResp.recovery.refundAmount,
                expectedActorUid: rData.actorUid,
                expectedActorStaffId: rData.actorStaffId,
              });
              if (!histOk) continue;
            }
            if (textId(rec.refundStatus) === 'COMPLETED_MANUAL') {
              trustedCompletion = {
                refundAmount: rResp.recovery.refundAmount,
                paymentHistoryLinked: rResp.paymentHistoryLinked,
                reviewRequired: rResp.reviewRequired,
                ...(rResp.paymentHistoryLinked
                  ? {
                      paymentId: rResp.paymentId,
                      paymentHistoryId: rResp.paymentHistoryId,
                    }
                  : {}),
                ...(typeof rResp.linkageReviewReason === 'string' && rResp.linkageReviewReason
                  ? { linkageReviewReason: rResp.linkageReviewReason }
                  : {}),
              };
              break;
            }
          }
        }

        const isAlreadyCompletedManual =
          trustedCompletion !== null || textId(rec.refundStatus) === 'COMPLETED_MANUAL';

        if (isAlreadyCompletedManual) {
          const persistedAmt =
            typeof rec.refundAmount === 'number'
              ? rec.refundAmount
              : trustedCompletion?.refundAmount;
          const hasConflictingRewrite =
            newStatus !== 'COMPLETED_MANUAL' ||
            (validatedRefundAmount !== null &&
              persistedAmt !== undefined &&
              validatedRefundAmount !== persistedAmt) ||
            (Boolean(sanitizedMethod) && sanitizedMethod !== textId(rec.refundMethod)) ||
            (Boolean(sanitizedDate) && sanitizedDate !== textId(rec.refundDate)) ||
            (Boolean(sanitizedReference) && sanitizedReference !== textId(rec.refundReference)) ||
            (Boolean(sanitizedProofUrl) && sanitizedProofUrl !== textId(rec.refundProofUrl));

          if (hasConflictingRewrite) {
            return {
              status: 409,
              code: 'MANUAL_REFUND_ALREADY_COMPLETED_CONFLICT',
              reviewRequired: true,
              message:
                'Konfirmasi refund manual pada kasus ini telah tercatat dan tidak dapat ditulis ulang dengan parameter berbeda.',
            };
          }

          if (trustedCompletion) {
            if (trustedCompletion.paymentHistoryLinked && trustedCompletion.paymentId) {
              const currentLinkCheck = validateCurrentLinkedPayment(trustedCompletion.paymentId);
              if (!currentLinkCheck.ok) {
                return {
                  status: 409,
                  code: currentLinkCheck.code || 'LINKED_PAYMENT_CONFLICT',
                  reviewRequired: true,
                  message:
                    currentLinkCheck.message ||
                    'Tautan pembayaran untuk konfirmasi refund manual mengalami konflik kepemilikan atau identitas.',
                };
              }
              const recHistId = textId(rec.refundPaymentHistoryId);
              if (
                recHistId &&
                trustedCompletion.paymentHistoryId &&
                recHistId !== trustedCompletion.paymentHistoryId
              ) {
                return {
                  status: 409,
                  code: 'LINKED_PAYMENT_HISTORY_MISMATCH',
                  reviewRequired: true,
                  message: 'Referensi riwayat pembayaran pada recovery kasus mengalami konflik.',
                };
              }
              if (suppliedPaymentId && suppliedPaymentId !== trustedCompletion.paymentId) {
                return {
                  status: 409,
                  code: 'FOREIGN_PAYMENT_LINKAGE',
                  reviewRequired: true,
                  message: 'ID pembayaran pada permintaan tidak sesuai dengan pembayaran tertaut.',
                };
              }
            } else if (
              hasInvalidOrConflictingPayment ||
              (textId(rec.refundPaymentId) &&
                !validateCurrentLinkedPayment(textId(rec.refundPaymentId)).ok) ||
              (suppliedPaymentId && !validateCurrentLinkedPayment(suppliedPaymentId).ok)
            ) {
              return {
                status: 409,
                code: 'LINKED_PAYMENT_CONFLICT',
                reviewRequired: true,
                message:
                  'Tautan pembayaran untuk konfirmasi refund manual mengalami konflik kepemilikan atau identitas.',
              };
            }

            return {
              caseId,
              caseCode: persistedCaseCode,
              bookingId: persistedBookingId || '',
              bookingCode: canonicalBookingCode || '',
              oldStatus: 'COMPLETED_MANUAL',
              newStatus: 'COMPLETED_MANUAL',
              recovery: rec,
              paymentHistoryLinked: trustedCompletion.paymentHistoryLinked,
              reviewRequired: trustedCompletion.reviewRequired,
              ...(trustedCompletion.paymentHistoryLinked &&
              trustedCompletion.paymentId &&
              trustedCompletion.paymentHistoryId
                ? {
                    paymentId: trustedCompletion.paymentId,
                    paymentHistoryId: trustedCompletion.paymentHistoryId,
                  }
                : {}),
              ...(trustedCompletion.reviewRequired && trustedCompletion.linkageReviewReason
                ? { linkageReviewReason: trustedCompletion.linkageReviewReason }
                : {}),
              status: 200,
              isIdempotent: true,
              noOp: true,
            };
          }

          // Legacy already-completed recovery without verifiable private completion evidence:
          // still revalidate any linked/candidate payment for foreign or missing linkage before returning no-op.
          const candidateLinkedPayId =
            textId(rec.refundPaymentId) ||
            (bookingData ? textId(bookingData.activePaymentId) : '') ||
            suppliedPaymentId ||
            (validPaymentCandidates.length === 1 ? validPaymentCandidates[0].id : '');
          if (hasInvalidOrConflictingPayment) {
            return {
              status: 409,
              code: 'LINKED_PAYMENT_CANDIDATE_CONFLICT',
              reviewRequired: true,
              message:
                'Ditemukan kandidat pembayaran yang mengalami konflik kepemilikan atau identitas.',
            };
          }
          if (candidateLinkedPayId) {
            const legacyLinkCheck = validateCurrentLinkedPayment(candidateLinkedPayId);
            if (!legacyLinkCheck.ok) {
              return {
                status: 409,
                code: legacyLinkCheck.code || 'LINKED_PAYMENT_CONFLICT',
                reviewRequired: true,
                message:
                  legacyLinkCheck.message ||
                  'Tautan pembayaran untuk konfirmasi refund manual mengalami konflik kepemilikan atau identitas.',
              };
            }
          }

          return {
            caseId,
            caseCode: persistedCaseCode,
            bookingId: persistedBookingId || '',
            bookingCode: canonicalBookingCode || '',
            oldStatus: 'COMPLETED_MANUAL',
            newStatus: 'COMPLETED_MANUAL',
            recovery: rec,
            paymentHistoryLinked: false,
            reviewRequired: true,
            linkageReviewReason:
              'Status COMPLETED_MANUAL telah tercatat sebelumnya tanpa bukti provenance server privat yang dapat diverifikasi.',
            status: 200,
            isIdempotent: true,
            noOp: true,
          };
        }

        // Check same-state no-op for non-completed statuses without an existing receipt
        const currentRefundStatus = textId(rec.refundStatus);
        if (
          currentRefundStatus === newStatus &&
          (validatedRefundAmount === null || validatedRefundAmount === rec.refundAmount) &&
          (!sanitizedMethod || sanitizedMethod === textId(rec.refundMethod)) &&
          (!sanitizedDate || sanitizedDate === textId(rec.refundDate)) &&
          (!sanitizedReference || sanitizedReference === textId(rec.refundReference)) &&
          (!sanitizedProofUrl || sanitizedProofUrl === textId(rec.refundProofUrl))
        ) {
          return {
            caseId,
            caseCode: persistedCaseCode,
            bookingId: persistedBookingId || '',
            bookingCode: canonicalBookingCode || '',
            oldStatus: currentRefundStatus,
            newStatus,
            recovery: rec,
            paymentHistoryLinked: false,
            reviewRequired: false,
            status: 200,
            isIdempotent: true,
            noOp: true,
          };
        }

        // 5. Resolve authoritative unambiguous payment link when booking is present
        let linkedPayment: { id: string; data: Record<string, any> } | null = null;
        let linkageReviewReason = '';

        if (!persistedBookingId || !bookingData) {
          linkageReviewReason =
            'Dokumen reservasi terkait tidak ditemukan untuk ditautkan secara otoritatif.';
        } else {
          const activePaymentId = textId(bookingData.activePaymentId);
          if (hasInvalidOrConflictingPayment) {
            linkageReviewReason =
              'Ditemukan konflik kepemilikan atau identitas pada kandidat dokumen pembayaran.';
          } else if (activePaymentId) {
            const activeMatch = validPaymentCandidates.find((c) => c.id === activePaymentId);
            const otherPaid = validPaymentCandidates.filter(
              (c) =>
                c.id !== activePaymentId && textId(c.data.status).toLowerCase() === 'paid'
            );
            if (activeMatch && otherPaid.length === 0) {
              linkedPayment = activeMatch;
            } else {
              linkageReviewReason = activeMatch
                ? 'Terdapat lebih dari satu pembayaran terverifikasi untuk reservasi ini.'
                : 'activePaymentId pada reservasi tidak merujuk pada dokumen pembayaran yang valid.';
            }
          } else if (validPaymentCandidates.length === 1) {
            linkedPayment = validPaymentCandidates[0];
          } else if (validPaymentCandidates.length === 0) {
            linkageReviewReason =
              'Tidak ditemukan dokumen pembayaran yang tertaut pada reservasi ini.';
          } else {
            const paidCandidates = validPaymentCandidates.filter(
              (c) => textId(c.data.status).toLowerCase() === 'paid'
            );
            if (paidCandidates.length === 1) {
              linkedPayment = paidCandidates[0];
            } else {
              linkageReviewReason =
                'Terdapat lebih dari satu dokumen pembayaran tanpa activePaymentId yang tidak ambigu.';
            }
          }
        }

        if (suppliedPaymentId) {
          if (!linkedPayment || linkedPayment.id !== suppliedPaymentId) {
            return {
              status: 409,
              code: 'FOREIGN_PAYMENT_LINKAGE',
              message: 'ID pembayaran pada permintaan tidak sesuai dengan pembayaran sah reservasi ini.',
            };
          }
        }

        const nowDate = new Date();
        const nowIso = nowDate.toISOString();
        const formattedWIB = formatStage7dWIB(nowDate);

        const effectiveRefundMethod = sanitizedMethod || textId(rec.refundMethod) || undefined;
        const effectiveRefundDate =
          sanitizedDate || textId(rec.refundDate) || nowIso.split('T')[0];
        const effectiveRefundReference =
          sanitizedReference || textId(rec.refundReference) || undefined;
        const effectiveRefundProofUrl =
          sanitizedProofUrl || textId(rec.refundProofUrl) || undefined;

        const paymentHistoryLinked =
          newStatus === 'COMPLETED_MANUAL' && Boolean(linkedPayment);
        const reviewRequired =
          newStatus === 'COMPLETED_MANUAL' && !linkedPayment;

        // Never overwrite an existing payment_status_history document on collision
        let actualManualRefundHistId = '';
        let actualManualRefundHistRef: any = null;
        if (paymentHistoryLinked && linkedPayment) {
          if (!snapExists(manualRefundHistSnap)) {
            actualManualRefundHistId = manualRefundHistId;
            actualManualRefundHistRef = manualRefundHistRef;
          } else if (!snapExists(fallbackManualRefundHistSnap)) {
            actualManualRefundHistId = fallbackManualRefundHistId;
            actualManualRefundHistRef = fallbackManualRefundHistRef;
          } else {
            return {
              status: 409,
              code: 'HISTORY_ID_COLLISION',
              reviewRequired: true,
              message: 'Konflik ID riwayat pembayaran; tidak dapat menimpa riwayat yang sudah ada.',
            };
          }
        }

        const updatedRec: Record<string, any> = {
          ...rec,
          refundStatus: newStatus,
          ...(effectiveRefundAmount !== undefined ? { refundAmount: effectiveRefundAmount } : {}),
          ...(effectiveRefundMethod !== undefined ? { refundMethod: effectiveRefundMethod } : {}),
          refundDate: effectiveRefundDate,
          ...(effectiveRefundReference !== undefined
            ? { refundReference: effectiveRefundReference }
            : {}),
          ...(effectiveRefundProofUrl !== undefined
            ? { refundProofUrl: effectiveRefundProofUrl }
            : {}),
          refundProcessedBy: managerCheck.actorStaffId,
          refundProcessedByName: managerCheck.actorName,
          refundProcessedAt: nowIso,
        };

        if (newStatus === 'COMPLETED_MANUAL') {
          updatedRec.refundPaymentHistoryLinked = paymentHistoryLinked;
          updatedRec.refundLinkageReviewRequired = reviewRequired;
          if (paymentHistoryLinked && linkedPayment) {
            updatedRec.refundPaymentId = linkedPayment.id;
            updatedRec.refundPaymentHistoryId = actualManualRefundHistId;
          }
        }

        const caseEventId = cleanRequestId
          ? `cevt_mref_${createHash('sha256')
              .update(`manual_refund_status:${verifiedUid}:${cleanRequestId}`)
              .digest('hex')
              .slice(0, 32)}`
          : `cevt_${Date.now()}_${randomInt(100000, 1000000).toString(36)}`;

        const baseTimelineDetails = `${effectiveRefundMethod || 'Transfer'} - Rp ${(
          effectiveRefundAmount || 0
        ).toLocaleString('id-ID')} | Ref: ${effectiveRefundReference || '-'} | Catatan: ${
          sanitizedNote || '-'
        }`;
        const timelineDetails =
          newStatus === 'COMPLETED_MANUAL' && reviewRequired
            ? `${baseTimelineDetails} | [TINJAUAN LINKAGE DIPERLUKAN: ${linkageReviewReason}]`
            : newStatus === 'COMPLETED_MANUAL' && linkedPayment
            ? `${baseTimelineDetails} | [Konfirmasi Refund Manual Manager - Payment ID: ${linkedPayment.id}]`
            : baseTimelineDetails;

        const caseEventRecord = {
          id: caseEventId,
          caseId,
          caseCode: persistedCaseCode,
          eventType: 'refund.status_updated',
          actorId: managerCheck.actorStaffId,
          actorUid: managerCheck.actorUid,
          actorName: managerCheck.actorName,
          actorRole: managerCheck.actorRoleLabel,
          summary: `Status Refund Manual diperbarui: ${newStatus}`,
          details: timelineDetails,
          ...(currentRefundStatus ? { oldValue: currentRefundStatus } : {}),
          newValue: newStatus,
          paymentHistoryLinked,
          reviewRequired,
          timestamp: nowIso,
        };

        const auditId = cleanRequestId
          ? `audit_mref_${createHash('sha256')
              .update(`manual_refund_status:${verifiedUid}:${cleanRequestId}`)
              .digest('hex')
              .slice(0, 32)}`
          : `audit_${Date.now()}_${randomInt(100000, 1000000).toString(36)}`;

        const baseAuditNote = `Refund manual kasus ${persistedCaseCode} diubah menjadi ${newStatus} (Rp ${(
          effectiveRefundAmount || 0
        ).toLocaleString('id-ID')})`;
        const auditNote =
          newStatus === 'COMPLETED_MANUAL' && reviewRequired
            ? `${baseAuditNote} [Review diperlukan: ${linkageReviewReason}]`
            : baseAuditNote;

        const auditRecord = {
          id: auditId,
          bookingId: persistedBookingId || '',
          bookingCode: canonicalBookingCode || '',
          ...(textId(caseData.customerId) ? { customerId: textId(caseData.customerId) } : {}),
          caseId,
          caseCode: persistedCaseCode,
          action: 'refund_status_updated',
          actorId: managerCheck.actorStaffId,
          actorUid: managerCheck.actorUid,
          actorRole: managerCheck.actorRole,
          actorName: managerCheck.actorName,
          ...(currentRefundStatus ? { oldValue: currentRefundStatus } : {}),
          newValue: newStatus,
          note: auditNote,
          paymentHistoryLinked,
          reviewRequired,
          timestamp: nowIso,
          createdAt: nowIso,
          formattedWIB,
        };

        // Execute atomic writes
        transaction.update(caseRef, {
          recovery: updatedRec,
          updatedAt: nowIso,
        });
        transaction.set(adminDb.collection('case_events').doc(caseEventId), caseEventRecord);
        transaction.set(
          adminDb.collection('operational_audit_logs').doc(auditId),
          auditRecord
        );

        if (paymentHistoryLinked && linkedPayment && actualManualRefundHistRef) {
          const histAmount =
            effectiveRefundAmount !== undefined
              ? effectiveRefundAmount
              : typeof linkedPayment.data.amount === 'number'
              ? linkedPayment.data.amount
              : 0;
          const reasonText = `Konfirmasi Refund Manual Kasus ${persistedCaseCode} oleh ${
            managerCheck.actorRoleLabel
          } (${managerCheck.actorName}): ${
            sanitizedNote || 'Pengembalian dana manual dikonfirmasi Manager'
          }`;
          const paymentHistoryEntry = {
            id: actualManualRefundHistId,
            paymentId: linkedPayment.id,
            bookingId: persistedBookingId,
            bookingCode:
              canonicalBookingCode || textId(linkedPayment.data.bookingCode).toUpperCase(),
            caseId,
            caseCode: persistedCaseCode,
            amount: histAmount,
            oldStatus: textId(linkedPayment.data.status) || 'paid',
            newStatus: 'refunded',
            source: managerCheck.actorRole,
            userId: managerCheck.actorStaffId,
            actorUid: managerCheck.actorUid,
            userName: managerCheck.actorName,
            userRole: managerCheck.actorRole,
            updatedBy: managerCheck.actorName,
            updatedByRole: managerCheck.actorRoleLabel,
            eventType: 'refund_processed',
            confirmationType: 'MANUAL_MANAGER_CONFIRMATION',
            evidenceBasis: `Konfirmasi refund manual oleh ${managerCheck.actorRoleLabel} terverifikasi (${managerCheck.actorName}) — bukan bukti penyelesaian payment gateway`,
            reason: reasonText,
            note: reasonText,
            serverAuthoritative: true,
            createdAt: nowIso,
            timestamp: nowIso,
          };
          transaction.set(actualManualRefundHistRef, paymentHistoryEntry);
        }

        if (newStatus === 'COMPLETED_MANUAL' && effectiveRefundAmount !== undefined) {
          transaction.set(completionGuardRef, {
            id: completionGuardId,
            action: 'manual_refund_completion_guard',
            caseId,
            caseCode: persistedCaseCode,
            bookingId: persistedBookingId || '',
            bookingCode: canonicalBookingCode || '',
            newStatus: 'COMPLETED_MANUAL',
            actorUid: verifiedUid,
            actorStaffId: managerCheck.actorStaffId,
            actorRole: managerCheck.actorRole,
            actorName: managerCheck.actorName,
            requestId: cleanRequestId || '',
            refundAmount: effectiveRefundAmount,
            paymentHistoryLinked,
            reviewRequired,
            ...(paymentHistoryLinked && linkedPayment
              ? {
                  paymentId: linkedPayment.id,
                  paymentHistoryId: actualManualRefundHistId,
                }
              : {}),
            ...(reviewRequired && linkageReviewReason
              ? { linkageReviewReason }
              : {}),
            committedAt: nowIso,
          });
        }

        const responsePayload = {
          caseId,
          caseCode: persistedCaseCode,
          bookingId: persistedBookingId || '',
          bookingCode: canonicalBookingCode || '',
          oldStatus: currentRefundStatus || null,
          newStatus,
          recovery: updatedRec,
          paymentHistoryLinked,
          reviewRequired,
          ...(paymentHistoryLinked && linkedPayment
            ? {
                paymentId: linkedPayment.id,
                paymentHistoryId: actualManualRefundHistId,
              }
            : {}),
          ...(reviewRequired && linkageReviewReason
            ? { linkageReviewReason }
            : {}),
          caseEventId,
          auditId,
        };

        if (receiptRef) {
          transaction.set(receiptRef, {
            id: receiptId,
            action: 'manual_refund_status',
            actorUid: verifiedUid,
            actorStaffId: managerCheck.actorStaffId,
            actorRole: managerCheck.actorRole,
            actorName: managerCheck.actorName,
            requestId: cleanRequestId,
            caseId,
            newStatus,
            refundAmount: validatedRefundAmount,
            refundMethod: sanitizedMethod,
            refundDate: sanitizedDate,
            refundReference: sanitizedReference,
            refundProofUrl: sanitizedProofUrl,
            note: sanitizedNote,
            fingerprint: requestFingerprint,
            committedAt: nowIso,
            responseFingerprint: computeStage7dResponseFingerprint(responsePayload),
            responsePayload,
          });
        }

        return {
          ...responsePayload,
          status: 200,
          isIdempotent: false,
        };
      });

      if (txResult.status !== 200) {
        return res.status(txResult.status).json({
          success: false,
          code: txResult.code || 'MANUAL_REFUND_STATUS_REJECTED',
          error: txResult.message || 'Gagal memperbarui status refund manual.',
          message: txResult.message || 'Gagal memperbarui status refund manual.',
          ...(txResult.reviewRequired !== undefined
            ? { reviewRequired: txResult.reviewRequired }
            : txResult.status === 409
            ? { reviewRequired: true }
            : {}),
        });
      }

      const { status: _st, ...payloadOut } = txResult;
      return res.status(200).json({
        ...payloadOut,
        success: true,
      });
    } catch (err: any) {
      const errCode = String(err?.code || '');
      const errMsg = String(err?.message || '');
      const isInfra =
        errCode === 'unavailable' ||
        errCode === 'deadline-exceeded' ||
        err?.status === 503 ||
        /unavailable|network|econnrefused|enotfound|etimedout|deadline/i.test(
          `${errCode} ${errMsg}`
        );
      return res.status(isInfra ? 503 : 500).json({
        success: false,
        code: isInfra ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
        error: isInfra
          ? 'Layanan database sedang tidak tersedia.'
          : 'Terjadi kesalahan saat memperbarui status refund manual.',
        message: isInfra
          ? 'Layanan database sedang tidak tersedia.'
          : 'Terjadi kesalahan saat memperbarui status refund manual.',
      });
    }
  });

  // =============================================================
  // AUTHORITATIVE CUSTOMER BOOKINGS & RECONCILIATION API
  // Prompt Bug Fix 01: Customer Booking History / Riwayat Pemesanan
  // =============================================================
  /**
   * Dedicated, authoritative customer ID token verification using Firebase Admin SDK.
   * Explicitly verifies against gen-lang-client-0466978413 and fails closed.
   * Distinguishes session expiration from invalid tokens and infrastructure errors.
   */
  async function verifyCustomerFirebaseIdToken(idToken: string): Promise<{
    success: true;
    uid: string;
    email: string;
  } | {
    success: false;
    statusCode: 401 | 503;
    code: string;
    message: string;
  }> {
    if (!idToken || typeof idToken !== 'string') {
      return {
        success: false,
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Token otentikasi tidak ditemukan. Silakan masuk kembali.',
      };
    }

    const cleanToken = idToken.trim();
    if (!cleanToken) {
      return {
        success: false,
        statusCode: 401,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Token otentikasi tidak valid.',
      };
    }

    try {
      const decoded = await adminAuth.verifyIdToken(cleanToken);
      if (!decoded || !decoded.uid) {
        return {
          success: false,
          statusCode: 401,
          code: 'AUTH_TOKEN_INVALID',
          message: 'Identitas pengguna tidak valid.',
        };
      }

      return {
        success: true,
        uid: decoded.uid,
        email: decoded.email ? decoded.email.trim().toLowerCase() : '',
      };
    } catch (err: any) {
      const errCode = err?.code || '';
      const errMsg = err?.message || '';

      if (errCode === 'auth/id-token-expired') {
        return {
          success: false,
          statusCode: 401,
          code: 'SESSION_EXPIRED',
          message: 'Sesi login telah berakhir. Silakan masuk kembali.',
        };
      }

      if (
        errCode === 'auth/argument-error' ||
        errCode === 'auth/invalid-id-token' ||
        errCode === 'auth/id-token-revoked' ||
        errCode === 'auth/project-id-mismatch' ||
        errMsg.includes('Decoding Firebase ID token failed') ||
        errMsg.includes('incorrect "aud"') ||
        errMsg.includes('incorrect "iss"')
      ) {
        return {
          success: false,
          statusCode: 401,
          code: 'AUTH_TOKEN_INVALID',
          message: 'Sesi autentikasi tidak valid. Silakan masuk kembali.',
        };
      }

      console.error('[CustomerAuth] Verification infrastructure notice:', errCode);
      return {
        success: false,
        statusCode: 503,
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Layanan verifikasi otentikasi sedang mengalami kendala. Silakan coba kembali beberapa saat lagi.',
      };
    }
  }

  // =============================================================
  // AUTHORITATIVE CUSTOMER BOOKINGS & RECONCILIATION API
  // Hardened Bug Fix 01A: Strict customer ownership & legacy reconciliation
  // =============================================================
  app.all(['/api/customer/bookings', '/api/customer/reconcile-bookings'], async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      let idToken = '';
      if (authHeader.startsWith('Bearer ')) {
        idToken = authHeader.slice(7).trim();
      } else if (req.headers['x-firebase-auth']) {
        idToken = String(req.headers['x-firebase-auth']).trim();
      } else if (req.body?.idToken) {
        idToken = String(req.body.idToken).trim();
      }

      if (!idToken) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Autentikasi diperlukan untuk melihat riwayat pesanan.',
        });
      }

      // 1. Authoritative verification of customer ID token via Firebase Admin SDK
      const authResult = await verifyCustomerFirebaseIdToken(idToken);
      if (authResult.success === false) {
        return res.status(authResult.statusCode).json({
          success: false,
          code: authResult.code,
          error: authResult.message,
        });
      }

      const verifiedUid = authResult.uid;
      const nowIso = new Date().toISOString();
      const matchedBookingsMap = new Map<string, any>();
      let reconciledCount = 0;

      // 2. Direct Canonical Queries: Bookings already owned by verified UID
      // A. Query bookings by customerAuthUid
      const snapCustomerAuth = await adminDb.collection('bookings')
        .where('customerAuthUid', '==', verifiedUid)
        .get();

      // B. Query bookings by authUserId
      const snapAuthUser = await adminDb.collection('bookings')
        .where('authUserId', '==', verifiedUid)
        .get();

      // Combine direct matches and validate non-conflict
      const directDocs = [...snapCustomerAuth.docs, ...snapAuthUser.docs];
      for (const d of directDocs) {
        const data = d.data();
        // Conflict Check: If both fields exist but belong to different UIDs, DO NOT EXPOSE
        if (data.customerAuthUid && data.authUserId && data.customerAuthUid !== data.authUserId) {
          console.warn(`[CUSTOMER_OWNERSHIP_CONFLICT] Booking ${d.id} has disagreeing customerAuthUid (${data.customerAuthUid}) and authUserId (${data.authUserId}).`);
          await adminDb.collection('reconciliation_audit').doc(`conflict_${d.id}`).set({
            bookingId: d.id,
            bookingCode: data.bookingCode || '',
            customerAuthUid: data.customerAuthUid,
            authUserId: data.authUserId,
            status: 'REVIEW_REQUIRED',
            reason: 'AUTH_UID_MISMATCH',
            reportedAt: nowIso,
          }, { merge: true }).catch(() => {});
          continue;
        }

        // If only authUserId was set to verifiedUid, backfill customerAuthUid conditionally
        if (!data.customerAuthUid && data.authUserId === verifiedUid) {
          try {
            await adminDb.runTransaction(async (t) => {
              const freshDoc = await t.get(d.ref);
              const freshData = freshDoc.data();
              if (!freshData) return;
              if (freshData.customerAuthUid && freshData.customerAuthUid !== verifiedUid) return;
              t.update(d.ref, {
                customerAuthUid: verifiedUid,
                updatedAt: nowIso,
              });
            });
            data.customerAuthUid = verifiedUid;
          } catch (e: any) {
            console.warn(`[Backfill Notice] Failed conditional backfill for ${d.id}:`, e?.message);
          }
        }

        matchedBookingsMap.set(d.id, { id: d.id, ...data });
      }

      // 3. Resolve Customer Profile Server-Side (Trusted Relationship Lookup)
      const custAuthSnap = await adminDb.collection('customers')
        .where('authUserId', '==', verifiedUid)
        .get();

      if (custAuthSnap.size > 1) {
        console.warn(`[CUSTOMER_MAPPING_AMBIGUOUS] Multiple customer profiles found for UID ${verifiedUid}`);
        await adminDb.collection('reconciliation_audit').doc(`ambiguous_cust_${verifiedUid}`).set({
          customerAuthUid: verifiedUid,
          status: 'REVIEW_REQUIRED',
          reason: 'MULTIPLE_CUSTOMER_RECORDS_FOR_UID',
          reportedAt: nowIso,
        }, { merge: true }).catch(() => {});
      } else if (custAuthSnap.size === 1) {
        const verifiedCustomerDoc = custAuthSnap.docs[0];
        const verifiedCustomerId = verifiedCustomerDoc.id;
        const verifiedCustomerData = verifiedCustomerDoc.data();
        const altCustomerId = verifiedCustomerData.id;

        // Query candidate legacy bookings matching this customer CRM ID
        const targetIds = [verifiedCustomerId];
        if (altCustomerId && altCustomerId !== verifiedCustomerId) {
          targetIds.push(altCustomerId);
        }

        for (const targetId of targetIds) {
          const legacySnap = await adminDb.collection('bookings')
            .where('customerId', '==', targetId)
            .get();

          for (const docSnap of legacySnap.docs) {
            if (matchedBookingsMap.has(docSnap.id)) continue;

            const bData = docSnap.data();

            // Ownership Conflict Inspection:
            // 1. If customerAuthUid belongs to another UID, NEVER reassign or expose
            if (bData.customerAuthUid && bData.customerAuthUid !== verifiedUid) {
              continue;
            }
            // 2. If authUserId belongs to another UID, NEVER reassign or expose
            if (bData.authUserId && bData.authUserId !== verifiedUid) {
              continue;
            }
            // 3. Case D: If both exist and disagree, report REVIEW_REQUIRED and do NOT expose or reassign
            if (bData.customerAuthUid && bData.authUserId && bData.customerAuthUid !== bData.authUserId) {
              await adminDb.collection('reconciliation_audit').doc(`conflict_${docSnap.id}`).set({
                bookingId: docSnap.id,
                bookingCode: bData.bookingCode || '',
                customerAuthUid: bData.customerAuthUid,
                authUserId: bData.authUserId,
                status: 'REVIEW_REQUIRED',
                reason: 'AUTH_UID_MISMATCH',
                reportedAt: nowIso,
              }, { merge: true }).catch(() => {});
              continue;
            }

            // 4. Case E: Neither ownership field exists on the historical booking
            // Section 2 & 3.E: Solely matching CRM ID is NOT sufficient trusted ownership evidence to auto-claim.
            // Leave affected ownership unchanged, report REVIEW_REQUIRED internally, and do not auto-claim.
            if (!bData.customerAuthUid && !bData.authUserId) {
              await adminDb.collection('reconciliation_audit').doc(`review_unowned_${docSnap.id}`).set({
                bookingId: docSnap.id,
                bookingCode: bData.bookingCode || '',
                customerId: targetId,
                attemptedUid: verifiedUid,
                status: 'REVIEW_REQUIRED',
                reason: 'INSUFFICIENT_HISTORICAL_PROVENANCE',
                reportedAt: nowIso,
              }, { merge: true }).catch(() => {});
              continue;
            }
          }
        }
      }

      // 4. Sort newest first (createdAt DESC)
      const allBookings = Array.from(matchedBookingsMap.values());
      allBookings.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      return res.json({
        success: true,
        bookings: allBookings,
        total: allBookings.length,
        reconciledCount,
      });
    } catch (err: any) {
      console.error('[Customer Bookings] Error handling request:', err);
      return res.status(500).json({
        success: false,
        error: 'Riwayat pesanan belum dapat dimuat. Silakan coba lagi.',
        message: err.message,
      });
    }
  });

  // =============================================================
  // AUTHORITATIVE VOUCHER REDEMPTION & VALIDATION ENGINE
  // =============================================================

  function normalizeIndonesianPhoneServer(phone: string): { normalizedPhone: string; cleanDigits: string } {
    if (!phone) return { normalizedPhone: '', cleanDigits: '' };
    let digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    else if (digits.startsWith('8')) digits = '628' + digits.slice(1);
    return { normalizedPhone: '+' + digits, cleanDigits: digits };
  }

  // POST /api/vouchers/validate - Authenticated, Read-Only Server Voucher Eligibility & Discount Preview (Stage 5B)
  app.post('/api/vouchers/validate', async (req, res) => {
    const isValidDocId = (val: unknown, maxBytes = 256): val is string => {
      if (typeof val !== 'string') return false;
      const trimmed = val.trim();
      if (!trimmed || trimmed !== val) return false;
      if (trimmed === '.' || trimmed === '..') return false;
      if (Buffer.byteLength(trimmed, 'utf8') > maxBytes) return false;
      if (/[\/\\\x00-\x1F\x7F\s]/.test(trimmed)) return false;
      return true;
    };

    const isFiniteNonNegativeInt = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val) && val >= 0;

    const isFiniteNonNegativeNumber = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && val >= 0;

    const isFinitePositiveNumber = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && val > 0;

    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

    const calculateStraightDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c * 10) / 10;
    };

    const calculateBookingPrice = (input: any) => {
      const warnings: string[] = [];
      const servicePrice = Math.max(0, input.servicePrice || 0);
      const homeServiceFee = Math.max(0, input.homeServiceFee || 0);
      const grossAmount = servicePrice + homeServiceFee;

      let tierDiscountAmount = 0;
      if (input.customerTier && input.customerTier.discountPercentage > 0) {
        tierDiscountAmount = Math.floor((servicePrice * input.customerTier.discountPercentage) / 100);
      }

      const priceAfterTier = Math.max(0, servicePrice - tierDiscountAmount);

      let promoDiscountAmount = 0;
      let voucherDiscountAmount = 0;

      if (input.promoVoucher && input.promoVoucher.enabled) {
        const promo = input.promoVoucher;
        if (priceAfterTier >= (promo.minimumSpend || 0)) {
          if (promo.voucherType === 'fixed_discount' || (promo.voucherType as any) === 'FIXED_AMOUNT') {
            promoDiscountAmount = promo.value;
          } else if (
            promo.voucherType === 'percentage_discount' ||
            promo.voucherType === 'percentage' ||
            (promo.voucherType as any) === 'PERCENTAGE'
          ) {
            let disc = Math.floor((priceAfterTier * promo.value) / 100);
            if (promo.maximumDiscount && promo.maximumDiscount > 0) {
              disc = Math.min(disc, promo.maximumDiscount);
            }
            promoDiscountAmount = disc;
          } else if (promo.voucherType === 'free_home_service_fee') {
            promoDiscountAmount = homeServiceFee;
          }
        } else {
          warnings.push(`Kode promo memerlukan minimal transaksi Rp ${(promo.minimumSpend || 0).toLocaleString('id-ID')}`);
        }
      }

      if (input.customerVoucher && input.customerVoucher.status === 'available') {
        const cv = input.customerVoucher;
        if (priceAfterTier >= (cv.minimumSpend || 0)) {
          if (cv.voucherType === 'fixed_discount') {
            voucherDiscountAmount = cv.value;
          } else if (cv.voucherType === 'percentage_discount') {
            let disc = Math.floor((priceAfterTier * cv.value) / 100);
            if (cv.maximumDiscount && cv.maximumDiscount > 0) {
              disc = Math.min(disc, cv.maximumDiscount);
            }
            voucherDiscountAmount = disc;
          } else if (cv.voucherType === 'free_home_service_fee') {
            voucherDiscountAmount = homeServiceFee;
          }
        } else {
          warnings.push(`Voucher memerlukan minimal transaksi Rp ${(cv.minimumSpend || 0).toLocaleString('id-ID')}`);
        }
      }

      const allowStacking = input.settings?.allowStacking ?? false;
      let totalPromoAndVoucherDiscount = 0;
      if (!allowStacking && promoDiscountAmount > 0 && voucherDiscountAmount > 0) {
        if (voucherDiscountAmount >= promoDiscountAmount) {
          promoDiscountAmount = 0;
          totalPromoAndVoucherDiscount = voucherDiscountAmount;
        } else {
          voucherDiscountAmount = 0;
          totalPromoAndVoucherDiscount = promoDiscountAmount;
        }
      } else {
        totalPromoAndVoucherDiscount = promoDiscountAmount + voucherDiscountAmount;
      }

      totalPromoAndVoucherDiscount = Math.min(totalPromoAndVoucherDiscount, priceAfterTier + homeServiceFee);

      const amountAfterVouchers = Math.max(0, priceAfterTier + homeServiceFee - totalPromoAndVoucherDiscount);

      const pointsPerCurrencyUnit = input.settings?.pointsPerCurrencyUnit || 10;
      const valuePerPoint = 1000 / pointsPerCurrencyUnit;
      const minPointsToRedeem = input.settings?.minimumPointsToRedeem || 50;
      const maxRedemptionPercentage = input.settings?.maximumRedemptionPercentage || 30;

      const requestedPoints = Math.max(0, Math.floor(input.pointsToRedeem || 0));
      let pointsRedeemed = 0;
      let pointsDiscountAmount = 0;

      if (requestedPoints > 0) {
        if (requestedPoints < minPointsToRedeem) {
          warnings.push(`Minimal penukaran poin adalah ${minPointsToRedeem} Poin.`);
        } else {
          const maxAllowedDiscountRp = Math.floor((grossAmount * maxRedemptionPercentage) / 100);
          const maxAllowedPoints = Math.floor(maxAllowedDiscountRp / valuePerPoint);

          pointsRedeemed = Math.min(requestedPoints, maxAllowedPoints);
          pointsDiscountAmount = pointsRedeemed * valuePerPoint;

          if (pointsDiscountAmount > amountAfterVouchers) {
            pointsDiscountAmount = amountAfterVouchers;
            pointsRedeemed = Math.floor(pointsDiscountAmount / valuePerPoint);
          }
        }
      }

      const totalDiscount = tierDiscountAmount + totalPromoAndVoucherDiscount + pointsDiscountAmount;
      const finalAmount = Math.max(0, grossAmount - totalDiscount);

      const includeHomeServiceFee = input.settings?.includeHomeServiceFeeForPoints ?? false;
      const spendPerPoint = input.settings?.spendPerPoint || 10000;
      const multiplier = input.customerTier?.earningMultiplier || 1.0;

      let qualifiedSpendForPoints = servicePrice - tierDiscountAmount - totalPromoAndVoucherDiscount - pointsDiscountAmount;
      if (includeHomeServiceFee) {
        qualifiedSpendForPoints += homeServiceFee;
      }
      qualifiedSpendForPoints = Math.max(0, qualifiedSpendForPoints);

      const basePointsEarned = Math.floor(qualifiedSpendForPoints / spendPerPoint);
      const estimatedPointsEarned = Math.floor(basePointsEarned * multiplier);

      return {
        servicePrice,
        homeServiceFee,
        grossAmount,
        tierDiscountAmount,
        promoDiscountAmount,
        voucherDiscountAmount,
        totalPromoAndVoucherDiscount,
        pointsRedeemed,
        pointsDiscountAmount,
        totalDiscount,
        finalAmount,
        qualifiedSpendForPoints,
        estimatedPointsEarned,
        warnings,
      };
    };

    try {
      // 1. Strict Single Bearer Token Verification BEFORE any DB reads
      const rawAuthHeader = req.headers?.authorization;
      if (typeof rawAuthHeader !== 'string') {
        return res.status(401).json({
          valid: false,
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Silakan login ke akun pelanggan terlebih dahulu untuk menggunakan voucher promo.',
          errorMessage: 'Silakan login ke akun pelanggan terlebih dahulu untuk menggunakan voucher promo.',
        });
      }
      const tokenMatch = /^Bearer\s+(\S+)$/i.exec(rawAuthHeader.trim());
      if (!tokenMatch || !tokenMatch[1]) {
        return res.status(401).json({
          valid: false,
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Format token otentikasi tidak valid.',
          errorMessage: 'Format token otentikasi tidak valid.',
        });
      }

      if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
        return res.status(503).json({
          valid: false,
          success: false,
          code: 'AUTH_SERVICE_UNAVAILABLE',
          error: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
          errorMessage: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
        });
      }

      const authResult = await verifyCustomerFirebaseIdToken(tokenMatch[1]);
      if (authResult.success === false) {
        return res.status(authResult.statusCode).json({
          valid: false,
          success: false,
          code: authResult.code,
          error: authResult.message,
          errorMessage: authResult.message,
        });
      }

      const verifiedUid = typeof authResult.uid === 'string' ? authResult.uid.trim() : '';
      if (!isValidDocId(verifiedUid, 128) || verifiedUid !== authResult.uid) {
        return res.status(401).json({
          valid: false,
          success: false,
          code: 'AUTH_TOKEN_INVALID',
          error: 'Identitas pengguna tidak valid.',
          errorMessage: 'Identitas pengguna tidak valid.',
        });
      }

      // Reject conflicting caller-supplied UID fields in body before any DB reads
      for (const uidField of ['customerAuthUid', 'authUserId'] as const) {
        const val = req.body?.[uidField];
        if (val !== undefined && val !== null && val !== '') {
          if (typeof val !== 'string' || val.trim() !== verifiedUid) {
            return res.status(403).json({
              valid: false,
              success: false,
              code: 'FOREIGN_CUSTOMER',
              error: 'Akses ditolak. Identitas sesi tidak sesuai dengan akun pelanggan.',
              errorMessage: 'Akses ditolak. Identitas sesi tidak sesuai dengan akun pelanggan.',
            });
          }
        }
      }

      // 2. Bounded Input Selectors Validation BEFORE any DB reads
      const rawPromoInput = req.body?.promoCode ?? req.body?.code ?? req.body?.voucherCode;
      const code = typeof rawPromoInput === 'string' ? rawPromoInput.trim().toUpperCase() : '';
      if (!code) {
        return res.status(400).json({
          valid: false,
          success: false,
          code: 'INVALID_VOUCHER_CODE',
          error: 'Harap masukkan kode promo.',
          errorMessage: 'Harap masukkan kode promo.',
        });
      }
      if (!/^[A-Z0-9_-]{1,64}$/.test(code)) {
        return res.status(400).json({
          valid: false,
          success: false,
          code: 'INVALID_VOUCHER_CODE',
          error: 'Format kode promo tidak valid.',
          errorMessage: 'Format kode promo tidak valid.',
        });
      }

      const rawServiceId = req.body?.serviceId;
      const serviceId = typeof rawServiceId === 'string' ? rawServiceId.trim() : '';
      if (!serviceId || !isValidDocId(serviceId, 128)) {
        return res.status(400).json({
          valid: false,
          success: false,
          code: 'INVALID_SERVICE_ID',
          error: 'ID layanan tidak valid.',
          errorMessage: 'Pilih layanan treatment yang valid terlebih dahulu.',
        });
      }

      const rawCustomerVoucherId = req.body?.customerVoucherId;
      let personalCvId = '';
      if (rawCustomerVoucherId !== undefined && rawCustomerVoucherId !== null && rawCustomerVoucherId !== '') {
        if (
          typeof rawCustomerVoucherId !== 'string' ||
          !isValidDocId(rawCustomerVoucherId.trim(), 128) ||
          !rawCustomerVoucherId.trim().startsWith('cv_')
        ) {
          return res.status(400).json({
            valid: false,
            success: false,
            code: 'INVALID_VOUCHER_ID',
            error: 'ID voucher pelanggan tidak valid.',
            errorMessage: 'ID voucher pelanggan tidak valid.',
          });
        }
        personalCvId = rawCustomerVoucherId.trim();
      }

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          valid: false,
          success: false,
          code: 'VOUCHER_VALIDATION_UNAVAILABLE',
          error: 'Layanan validasi voucher sedang tidak tersedia.',
          errorMessage: 'Layanan validasi voucher sedang tidak tersedia.',
        });
      }

      // 3. Read-Only Authoritative Snapshot via adminDb.runTransaction (ZERO writes)
      const previewOutcome = await adminDb.runTransaction(async (transaction: any) => {
        const nowIso = new Date().toISOString();

        const vouchersByCodeSnap = await transaction.get(
          adminDb.collection('vouchers').where('code', '==', code)
        );
        const serviceSnap = await transaction.get(
          adminDb.collection('services').doc(serviceId)
        );
        const personalCvSnap = personalCvId
          ? await transaction.get(adminDb.collection('customer_vouchers').doc(personalCvId))
          : null;
        const cvDataRaw = personalCvSnap && snapExists(personalCvSnap) ? personalCvSnap.data() || {} : null;
        const cvMasterId =
          cvDataRaw && typeof cvDataRaw.voucherId === 'string' && isValidDocId(cvDataRaw.voucherId.trim(), 128)
            ? cvDataRaw.voucherId.trim()
            : '';
        const cvMasterDocSnap = cvMasterId
          ? await transaction.get(adminDb.collection('vouchers').doc(cvMasterId))
          : null;

        const custByAuthUserSnap = await transaction.get(
          adminDb.collection('customers').where('authUserId', '==', verifiedUid)
        );
        const custByCanonicalSnap = await transaction.get(
          adminDb.collection('customers').where('customerAuthUid', '==', verifiedUid)
        );

        const reqCustomerId =
          typeof req.body?.customerId === 'string' && isValidDocId(req.body.customerId.trim(), 128)
            ? req.body.customerId.trim()
            : '';
        const reqCustomerDocSnap = reqCustomerId
          ? await transaction.get(adminDb.collection('customers').doc(reqCustomerId))
          : null;

        const previewPhoneRaw =
          typeof req.body?.customerWhatsApp === 'string'
            ? req.body.customerWhatsApp.trim()
            : typeof req.body?.customerPhone === 'string'
              ? req.body.customerPhone.trim()
              : '';
        const { cleanDigits: previewPhoneDigits } = normalizeIndonesianPhoneServer(previewPhoneRaw);
        const phoneDerivedCustId =
          previewPhoneDigits && isValidDocId(`cust_${previewPhoneDigits}`, 128)
            ? `cust_${previewPhoneDigits}`
            : '';

        const ownedCustomerDocsMap = new Map<string, any>();
        for (const d of [...(custByAuthUserSnap?.docs || []), ...(custByCanonicalSnap?.docs || [])]) {
          if (snapExists(d)) ownedCustomerDocsMap.set(d.id, d);
        }

        const candidateLoyaltyCustomerIds = new Set<string>([verifiedUid]);
        for (const cid of ownedCustomerDocsMap.keys()) {
          if (isValidDocId(cid, 128)) candidateLoyaltyCustomerIds.add(cid);
        }

        const loyaltyAccountSnaps = new Map<string, any>();
        for (const cid of candidateLoyaltyCustomerIds) {
          const laSnap = await transaction.get(adminDb.collection('loyalty_accounts').doc(cid));
          if (snapExists(laSnap)) {
            loyaltyAccountSnaps.set(cid, laSnap);
          }
        }

        const loyaltySettingsSnap = await transaction.get(
          adminDb.collection('loyalty_settings').doc('general')
        );

        const candidateTierIds = new Set<string>(['member']);
        for (const laSnap of loyaltyAccountSnaps.values()) {
          const tId = laSnap.data()?.currentTierId;
          if (typeof tId === 'string' && isValidDocId(tId.trim().toLowerCase(), 64)) {
            candidateTierIds.add(tId.trim().toLowerCase());
          }
        }
        if (typeof req.body?.membershipTierAtBooking === 'string') {
          const bt = req.body.membershipTierAtBooking.trim().toLowerCase();
          if (isValidDocId(bt, 64)) candidateTierIds.add(bt);
        }
        const membershipTierSnaps = new Map<string, any>();
        for (const tId of candidateTierIds) {
          const tSnap = await transaction.get(adminDb.collection('membership_tiers').doc(tId));
          if (snapExists(tSnap)) {
            membershipTierSnaps.set(tId, tSnap);
          }
        }

        const uidLockSnap = await transaction.get(
          adminDb.collection('voucher_redemptions').doc(`vlock_${code}_uid_${verifiedUid}`)
        );
        const custLockSnaps = new Map<string, any>();
        for (const cid of candidateLoyaltyCustomerIds) {
          const ref = adminDb.collection('voucher_redemptions').doc(`vlock_${code}_cust_${cid}`);
          custLockSnaps.set(cid, await transaction.get(ref));
        }
        const phoneLockSnap =
          previewPhoneDigits && isValidDocId(previewPhoneDigits, 64)
            ? await transaction.get(
                adminDb.collection('voucher_redemptions').doc(`vlock_${code}_phone_${previewPhoneDigits}`)
              )
            : null;

        const redemptionsByCodeSnap = await transaction.get(
          adminDb.collection('voucher_redemptions').where('voucherCode', '==', code)
        );
        const singleCodeMasterId =
          vouchersByCodeSnap?.docs?.length === 1 ? vouchersByCodeSnap.docs[0].id : '';
        const redemptionsByMasterIdSnap =
          singleCodeMasterId && isValidDocId(singleCodeMasterId, 128)
            ? await transaction.get(
                adminDb.collection('voucher_redemptions').where('voucherId', '==', singleCodeMasterId)
              )
            : null;

        const bookingsByCanonicalSnap = await transaction.get(
          adminDb.collection('bookings').where('customerAuthUid', '==', verifiedUid)
        );
        const bookingsByLegacySnap = await transaction.get(
          adminDb.collection('bookings').where('authUserId', '==', verifiedUid)
        );
        const bookingsByCustIdSnaps = new Map<string, any>();
        for (const cid of ownedCustomerDocsMap.keys()) {
          if (isValidDocId(cid, 128)) {
            bookingsByCustIdSnaps.set(
              cid,
              await transaction.get(adminDb.collection('bookings').where('customerId', '==', cid))
            );
          }
        }

        // --- PURE VALIDATION (ZERO READS / ZERO WRITES) ---
        if (ownedCustomerDocsMap.size > 1) {
          return {
            status: 409,
            code: 'CUSTOMER_OWNERSHIP_CONFLICT',
            error: 'Kepemilikan profil pelanggan ambigu dan memerlukan peninjauan.',
          };
        }

        let verifiedCustomerId = '';
        let verifiedCustomerData: any = null;
        if (ownedCustomerDocsMap.size === 1) {
          const [cid, cSnap] = [...ownedCustomerDocsMap.entries()][0];
          const cData = cSnap.data() || {};
          if (
            (cData.authUserId !== undefined && cData.authUserId !== null && cData.authUserId !== '' && cData.authUserId !== verifiedUid) ||
            (cData.customerAuthUid !== undefined && cData.customerAuthUid !== null && cData.customerAuthUid !== '' && cData.customerAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              error: 'Akses ditolak. Kepemilikan akun pelanggan tidak konsisten.',
            };
          }
          if (reqCustomerId && reqCustomerId !== cid && reqCustomerId !== cData.id) {
            if (reqCustomerDocSnap && snapExists(reqCustomerDocSnap)) {
              const rcData = reqCustomerDocSnap.data() || {};
              if (
                (rcData.authUserId && rcData.authUserId !== verifiedUid) ||
                (rcData.customerAuthUid && rcData.customerAuthUid !== verifiedUid)
              ) {
                return {
                  status: 403,
                  code: 'CUSTOMER_OWNERSHIP_DENIED',
                  error: 'Akses ditolak. Profil pelanggan dimiliki oleh akun lain.',
                };
              }
            }
            if (reqCustomerId !== phoneDerivedCustId) {
              return {
                status: 403,
                code: 'CUSTOMER_OWNERSHIP_CONFLICT',
                error: 'Akses ditolak. Identitas pelanggan pesanan tidak sesuai dengan profil akun.',
              };
            }
          }
          verifiedCustomerId = cid;
          verifiedCustomerData = cData;
        } else if (reqCustomerDocSnap && snapExists(reqCustomerDocSnap)) {
          const bcData = reqCustomerDocSnap.data() || {};
          const bcAuthUid = bcData.authUserId;
          const bcCustAuthUid = bcData.customerAuthUid;
          if (
            (bcAuthUid !== undefined && bcAuthUid !== null && bcAuthUid !== '' && bcAuthUid !== verifiedUid) ||
            (bcCustAuthUid !== undefined && bcCustAuthUid !== null && bcCustAuthUid !== '' && bcCustAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_DENIED',
              error: 'Akses ditolak. Profil pelanggan pesanan dimiliki oleh akun lain.',
            };
          }
          if (bcAuthUid === verifiedUid || bcCustAuthUid === verifiedUid) {
            verifiedCustomerId = reqCustomerDocSnap.id;
            verifiedCustomerData = bcData;
          }
        }


        const matchingMasterDocs = vouchersByCodeSnap?.docs || [];
        if (matchingMasterDocs.length > 1) {
          return {
            status: 409,
            code: 'AMBIGUOUS_VOUCHER_CODE',
            error: 'Kode voucher duplikat ditemukan di katalog master.',
          };
        }
        if (matchingMasterDocs.length === 0) {
          return {
            status: 404,
            code: 'VOUCHER_NOT_FOUND',
            error: 'Kode promo tidak ditemukan.',
          };
        }

        const targetMasterSnap = matchingMasterDocs[0];
        const targetMasterId = targetMasterSnap.id;
        const targetMasterData = targetMasterSnap.data() || {};
        if (
          !isValidDocId(targetMasterId, 128) ||
          (targetMasterData.id !== undefined && targetMasterData.id !== targetMasterId) ||
          typeof targetMasterData.code !== 'string' ||
          targetMasterData.code.trim().toUpperCase() !== code
        ) {
          return {
            status: 409,
            code: 'VOUCHER_LINKAGE_CONFLICT',
            error: 'Data master voucher tidak konsisten dengan kode promo.',
          };
        }

        if (!serviceSnap || !snapExists(serviceSnap)) {
          return {
            status: 404,
            code: 'SERVICE_NOT_FOUND',
            error: 'Layanan pesanan tidak ditemukan dalam katalog resmi.',
          };
        }
        const serviceData = serviceSnap.data() || {};
        const authoritativeServicePrice = serviceData.price;
        if (!isFinitePositiveNumber(authoritativeServicePrice)) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Harga layanan resmi tidak dapat diverifikasi.',
          };
        }

        const rawLoyaltySettings =
          loyaltySettingsSnap && snapExists(loyaltySettingsSnap) ? loyaltySettingsSnap.data() || {} : {};
        if (
          rawLoyaltySettings.allowStacking !== undefined &&
          typeof rawLoyaltySettings.allowStacking !== 'boolean'
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Konfigurasi penggabungan voucher tidak valid.',
          };
        }
        const loyaltySettings = {
          ...DEFAULT_LOYALTY_SETTINGS,
          ...rawLoyaltySettings,
        };
        if (loyaltySettings.voucherEnabled === false) {
          return {
            status: 409,
            code: 'VOUCHER_DISABLED',
            error: 'Fitur penukaran voucher sedang dinonaktifkan.',
          };
        }

        const resolvePreviewOwnedLoyaltySnap = () => {
          const matches: any[] = [];
          for (const cid of new Set([verifiedCustomerId, verifiedUid].filter(Boolean))) {
            const snap = loyaltyAccountSnaps.get(cid);
            if (!snap || !snapExists(snap)) continue;
            const account = snap.data() || {};
            const owners = [account.customerAuthUid, account.authUserId];
            const consistent = owners.every(value => value === undefined || value === null || value === '' || value === verifiedUid);
            const linkedProfile = Boolean(verifiedCustomerId && cid === verifiedCustomerId
              && (!account.customerId || account.customerId === verifiedCustomerId));
            const directUid = cid === verifiedUid && account.customerId === verifiedUid;
            if (!consistent || (!linkedProfile && !directUid)) {
              throw Object.assign(new Error('Kepemilikan akun loyalitas memerlukan peninjauan.'), { code: 'LOYALTY_OWNERSHIP_CONFLICT' });
            }
            matches.push(snap);
          }
          if (matches.length > 1) {
            throw Object.assign(new Error('Terdapat beberapa akun loyalitas untuk identitas yang sama.'), { code: 'LOYALTY_OWNERSHIP_CONFLICT' });
          }
          return matches[0] || null;
        };

        const verifiedLoyaltySnap = resolvePreviewOwnedLoyaltySnap();
        const verifiedLoyaltyData = verifiedLoyaltySnap ? verifiedLoyaltySnap.data() || {} : null;

        let resolvedTierId = 'member';
        if (verifiedLoyaltyData) {
          if (verifiedLoyaltyData.status === 'suspended' || verifiedLoyaltyData.status === 'closed') {
            return {
              status: 403,
              code: 'LOYALTY_ACCOUNT_INACTIVE',
              error: 'Akun loyalitas pelanggan sedang tidak aktif.',
            };
          }
          if (typeof verifiedLoyaltyData.currentTierId === 'string' && verifiedLoyaltyData.currentTierId.trim()) {
            resolvedTierId = verifiedLoyaltyData.currentTierId.trim().toLowerCase();
          }
        }

        const tierSnapFromDb = membershipTierSnaps.get(resolvedTierId);
        const resolvedTier: any = tierSnapFromDb
          ? tierSnapFromDb.data()
          : DEFAULT_MEMBERSHIP_TIERS.find((t) => t.id.toLowerCase() === resolvedTierId) || null;

        if (
          !resolvedTier ||
          !isFiniteNonNegativeNumber(resolvedTier.discountPercentage) ||
          resolvedTier.discountPercentage > 100
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Data tier keanggotaan pelanggan tidak dapat diverifikasi.',
          };
        }

        const previewRequestedPoints =
          req.body?.pointsToRedeem !== undefined && req.body?.pointsToRedeem !== null && isFiniteNonNegativeNumber(req.body.pointsToRedeem)
            ? Math.floor(req.body.pointsToRedeem)
            : req.body?.pointsRedeemed !== undefined && req.body?.pointsRedeemed !== null && isFiniteNonNegativeNumber(req.body.pointsRedeemed)
              ? Math.floor(req.body.pointsRedeemed)
              : 0;

        if (previewRequestedPoints > 0) {
          if (loyaltySettings.loyaltyEnabled === false) {
            return {
              status: 409,
              code: 'POINTS_REDEMPTION_DISABLED',
              error: 'Fitur penukaran poin sedang dinonaktifkan.',
            };
          }
          const minPts = loyaltySettings.minimumPointsToRedeem || 50;
          if (previewRequestedPoints < minPts) {
            return {
              status: 409,
              code: 'INSUFFICIENT_POINTS',
              error: `Minimal penukaran poin adalah ${minPts} Poin.`,
            };
          }
          const currentPtsBalance = verifiedLoyaltyData?.pointsBalance ?? verifiedLoyaltyData?.currentPointsBalance ?? 0;
          if (!isFiniteNonNegativeInt(currentPtsBalance) || currentPtsBalance < previewRequestedPoints) {
            return {
              status: 409,
              code: 'INSUFFICIENT_POINTS_BALANCE',
              error: 'Saldo Senzu Points Anda tidak mencukupi untuk jumlah penukaran ini.',
            };
          }
        }

        const normalizeSupportedVoucherType = (
          vType: unknown
        ): 'fixed_discount' | 'percentage_discount' | 'free_home_service_fee' | null => {
          if (vType === 'fixed_discount' || vType === 'FIXED_AMOUNT') return 'fixed_discount';
          if (vType === 'percentage_discount' || vType === 'percentage' || vType === 'PERCENTAGE')
            return 'percentage_discount';
          if (vType === 'free_home_service_fee') return 'free_home_service_fee';
          return null;
        };

        const validateVoucherNumbers = (vObj: any): {
          ok: boolean;
          normalizedType?: 'fixed_discount' | 'percentage_discount' | 'free_home_service_fee';
          code?: string;
          error?: string;
        } => {
          const normType = normalizeSupportedVoucherType(vObj?.voucherType);
          if (!normType) {
            return {
              ok: false,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Tipe voucher tidak mendukung perhitungan potongan otomatis.',
            };
          }
          if (normType === 'fixed_discount') {
            if (!isFinitePositiveNumber(vObj.value)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Nilai potongan voucher tidak valid.' };
            }
          } else if (normType === 'percentage_discount') {
            if (!isFinitePositiveNumber(vObj.value) || vObj.value > 100) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Persentase potongan voucher tidak valid.' };
            }
            if (vObj.maximumDiscount !== undefined && vObj.maximumDiscount !== null && !isFinitePositiveNumber(vObj.maximumDiscount)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas maksimum potongan voucher tidak valid.' };
            }
          } else if (normType === 'free_home_service_fee') {
            if (vObj.value !== undefined && vObj.value !== null && !isFiniteNonNegativeNumber(vObj.value)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Nilai voucher ongkir tidak valid.' };
            }
          }

          if (vObj.minimumSpend !== undefined && vObj.minimumSpend !== null && !isFiniteNonNegativeNumber(vObj.minimumSpend)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas minimum transaksi voucher tidak valid.' };
          }
          if (vObj.minimumTreatmentPrice !== undefined && vObj.minimumTreatmentPrice !== null && !isFiniteNonNegativeNumber(vObj.minimumTreatmentPrice)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas harga minimum layanan tidak valid.' };
          }
          if (vObj.minimumTreatmentDuration !== undefined && vObj.minimumTreatmentDuration !== null && !isFiniteNonNegativeNumber(vObj.minimumTreatmentDuration)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas durasi minimum layanan tidak valid.' };
          }
          return { ok: true, normalizedType: normType };
        };

        const targetCheck = validateVoucherNumbers(targetMasterData);
        if (!targetCheck.ok) {
          return { status: 409, code: targetCheck.code, error: targetCheck.error };
        }

        let resolvedPersonalCv: any = null;
        let resolvedPersonalCvMaster: any = null;
        if (personalCvId) {
          if (!personalCvSnap || !snapExists(personalCvSnap)) {
            return {
              status: 404,
              code: 'CUSTOMER_VOUCHER_NOT_FOUND',
              error: 'Voucher personal pelanggan tidak ditemukan.',
            };
          }
          const cvData = personalCvSnap.data() || {};
          if (
            (cvData.authUserId !== undefined && cvData.authUserId !== null && cvData.authUserId !== '' && cvData.authUserId !== verifiedUid) ||
            (cvData.customerAuthUid !== undefined && cvData.customerAuthUid !== null && cvData.customerAuthUid !== '' && cvData.customerAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_VOUCHER_OWNERSHIP_DENIED',
              error: 'Voucher personal ini bukan milik akun Anda.',
            };
          }
          const cvOwnerCustomerId = typeof cvData.customerId === 'string' ? cvData.customerId.trim() : '';
          const cvHasVerifiedUidBinding =
            cvData.customerAuthUid === verifiedUid || cvData.authUserId === verifiedUid;
          const cvOwnerAllowed = Boolean(cvOwnerCustomerId) && (
            cvOwnerCustomerId === verifiedUid ||
            (verifiedCustomerId && cvOwnerCustomerId === verifiedCustomerId) ||
            cvHasVerifiedUidBinding
          );
          if (!cvOwnerAllowed) {
            return {
              status: 403,
              code: 'CUSTOMER_VOUCHER_OWNERSHIP_DENIED',
              error: 'Kepemilikan voucher personal tidak sesuai dengan akun Anda.',
            };
          }
          if (!cvMasterId || !cvMasterDocSnap || !snapExists(cvMasterDocSnap)) {
            return {
              status: 404,
              code: 'VOUCHER_NOT_FOUND',
              error: 'Master voucher untuk voucher personal tidak ditemukan.',
            };
          }
          resolvedPersonalCvMaster = cvMasterDocSnap.data() || {};
          if (cvData.status !== 'available') {
            return {
              status: 409,
              code: 'CUSTOMER_VOUCHER_INELIGIBLE',
              error: 'Voucher personal sudah tidak tersedia.',
            };
          }
          const cvExpiryStr = cvData.expiredAt || cvData.expiresAt;
          if (cvExpiryStr !== undefined && cvExpiryStr !== null && cvExpiryStr !== '') {
            if (typeof cvExpiryStr !== 'string' || Number.isNaN(Date.parse(cvExpiryStr)) || cvExpiryStr < nowIso) {
              return {
                status: 409,
                code: 'VOUCHER_EXPIRED',
                error: 'Voucher personal sudah kedaluwarsa.',
              };
            }
          }
          const mergedCvData = {
            ...resolvedPersonalCvMaster,
            ...cvData,
            voucherType: cvData.voucherType ?? resolvedPersonalCvMaster?.voucherType,
            value: cvData.value ?? resolvedPersonalCvMaster?.value,
          };
          const cvCheck = validateVoucherNumbers(mergedCvData);
          if (!cvCheck.ok) return { status: 409, code: cvCheck.code, error: cvCheck.error };
          resolvedPersonalCv = {
            ...mergedCvData,
            id: personalCvSnap.id,
            voucherId: cvMasterDocSnap.id,
          };
        }

        if (targetMasterData.enabled !== true) {
          return {
            status: 409,
            code: 'VOUCHER_INACTIVE',
            error: 'Voucher sedang tidak aktif.',
          };
        }
        if (targetMasterData.validFrom !== undefined && targetMasterData.validFrom !== null && targetMasterData.validFrom !== '') {
          if (typeof targetMasterData.validFrom !== 'string' || Number.isNaN(Date.parse(targetMasterData.validFrom))) {
            return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Periode mulai voucher tidak valid.' };
          }
          if (targetMasterData.validFrom > nowIso) {
            return { status: 409, code: 'VOUCHER_NOT_YET_VALID', error: 'Promo ini belum dapat digunakan (periode belum dimulai).' };
          }
        }
        if (targetMasterData.validUntil !== undefined && targetMasterData.validUntil !== null && targetMasterData.validUntil !== '') {
          if (typeof targetMasterData.validUntil !== 'string' || Number.isNaN(Date.parse(targetMasterData.validUntil))) {
            return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Periode berakhir voucher tidak valid.' };
          }
          if (targetMasterData.validUntil < nowIso) {
            return { status: 409, code: 'VOUCHER_EXPIRED', error: 'Voucher sudah tidak berlaku.' };
          }
        }

        const needsVerifiedHomeServiceFee =
          targetCheck.normalizedType === 'free_home_service_fee' ||
          normalizeSupportedVoucherType(resolvedPersonalCv?.voucherType) === 'free_home_service_fee';

        let authoritativeHomeServiceFee = 0;
        const lat = req.body?.latitude;
        const lng = req.body?.longitude;
        const distKm = req.body?.distanceKm;
        const hasValidCoords =
          typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
          typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;

        if (needsVerifiedHomeServiceFee) {
          if (!hasValidCoords || typeof distKm !== 'number' || !Number.isFinite(distKm) || distKm < 0) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Pilih titik lokasi pengantaran yang valid untuk menghitung promo biaya home service.',
            };
          }
          const minStraightKm = calculateStraightDistanceKm(
            SENZU_BASE_LOCATION.lat,
            SENZU_BASE_LOCATION.lng,
            lat,
            lng
          );
          if (distKm < minStraightKm * 0.95 || (minStraightKm > 0.2 && distKm === 0)) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Jarak lokasi pesanan tidak dapat diverifikasi untuk potongan biaya home service.',
            };
          }
          const feeFromDist = calculateHomeServiceFee(distKm).fee;
          const feeFromStraight = calculateHomeServiceFee(minStraightKm).fee;
          if (
            !isFinitePositiveNumber(feeFromDist) ||
            feeFromStraight !== feeFromDist ||
            (req.body?.homeServiceFee !== undefined && req.body?.homeServiceFee !== null && Number(req.body.homeServiceFee) !== feeFromDist)
          ) {
            return {
              status: 409,
              code: 'VOUCHER_INELIGIBLE',
              error: 'Voucher gratis biaya home service tidak berlaku untuk jarak lokasi saat ini.',
            };
          }
          authoritativeHomeServiceFee = feeFromDist;
        } else if (hasValidCoords) {
          const minStraightKm = calculateStraightDistanceKm(
            SENZU_BASE_LOCATION.lat,
            SENZU_BASE_LOCATION.lng,
            lat,
            lng
          );
          const effectiveDistKm =
            typeof distKm === 'number' && Number.isFinite(distKm) && distKm >= minStraightKm * 0.95 && distKm > 0
              ? distKm
              : minStraightKm;
          authoritativeHomeServiceFee = calculateHomeServiceFee(effectiveDistKm).fee;
        } else if (req.body?.homeServiceFee !== undefined && req.body?.homeServiceFee !== null) {
          if (!isFiniteNonNegativeNumber(req.body.homeServiceFee)) {
            return {
              status: 400,
              code: 'INVALID_HOME_SERVICE_FEE',
              error: 'Biaya home service tidak valid.',
            };
          }
          authoritativeHomeServiceFee = req.body.homeServiceFee;
        }

        const promoForCalc = {
          ...targetMasterData,
          id: targetMasterId,
          code,
          minimumSpend: Math.max(
            targetMasterData.minimumSpend || 0,
            targetMasterData.minimumTreatmentPrice || 0
          ),
          enabled: true,
        };

        const cvForCalc =
          resolvedPersonalCv && resolvedPersonalCv.voucherId !== targetMasterId
            ? {
                ...resolvedPersonalCv,
                voucherType: normalizeSupportedVoucherType(resolvedPersonalCv.voucherType) || resolvedPersonalCv.voucherType,
                minimumSpend: Math.max(
                  resolvedPersonalCv.minimumSpend || 0,
                  resolvedPersonalCvMaster?.minimumSpend || 0,
                  resolvedPersonalCvMaster?.minimumTreatmentPrice || 0
                ),
                maximumDiscount: resolvedPersonalCv.maximumDiscount ?? resolvedPersonalCvMaster?.maximumDiscount,
                status: 'available' as const,
              }
            : null;

        const pricingBreakdown = calculateBookingPrice({
          servicePrice: authoritativeServicePrice,
          homeServiceFee: authoritativeHomeServiceFee,
          promoVoucher: promoForCalc,
          customerVoucher: cvForCalc,
          pointsToRedeem: isFiniteNonNegativeNumber(req.body?.pointsToRedeem) ? req.body.pointsToRedeem : 0,
          customerTier: resolvedTier,
          settings: loyaltySettings,
        });

        const serverDerivedDiscountAmount = Math.min(
          pricingBreakdown.promoDiscountAmount,
          pricingBreakdown.totalPromoAndVoucherDiscount
        );
        const personalWins = !loyaltySettings.allowStacking && Boolean(cvForCalc)
          && pricingBreakdown.promoDiscountAmount === 0 && pricingBreakdown.voucherDiscountAmount > 0;
        // A zero-discount losing selection is not redeemed and must not consume its quota.
        if (!personalWins) {
        const minSpend = Math.max(
          targetMasterData.minimumSpend || 0,
          targetMasterData.minimumTreatmentPrice || 0
        );
        const priceAfterTier = Math.max(0, authoritativeServicePrice - pricingBreakdown.tierDiscountAmount);
        if (priceAfterTier < minSpend || authoritativeServicePrice < minSpend) {
          return {
            status: 409,
            code: 'VOUCHER_MINIMUM_SPEND_NOT_MET',
            error: `Minimum transaksi untuk promo ini adalah Rp ${minSpend.toLocaleString('id-ID')}.`,
          };
        }

        const checkServiceIds = (ids: unknown): boolean => {
          if (ids === undefined || ids === null) return true;
          if (!Array.isArray(ids)) return false;
          if (ids.length === 0) return true;
          return ids.includes(serviceId);
        };
        if (!checkServiceIds(targetMasterData.applicableServiceIds)) {
          return {
            status: 409,
            code: 'VOUCHER_SERVICE_INELIGIBLE',
            error: 'Promo tidak berlaku untuk layanan yang dipilih.',
          };
        }

        if (targetMasterData.applicableCategoryIds !== undefined && targetMasterData.applicableCategoryIds !== null) {
          if (!Array.isArray(targetMasterData.applicableCategoryIds)) {
            return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Konfigurasi kategori voucher tidak valid.' };
          }
          if (targetMasterData.applicableCategoryIds.length > 0) {
            const srvCatId = typeof serviceData.categoryId === 'string' ? serviceData.categoryId.trim() : '';
            const srvCatName = typeof serviceData.category === 'string' ? serviceData.category.trim() : '';
            if (
              (!srvCatId || !targetMasterData.applicableCategoryIds.includes(srvCatId)) &&
              (!srvCatName || !targetMasterData.applicableCategoryIds.includes(srvCatName))
            ) {
              return {
                status: 409,
                code: 'VOUCHER_CATEGORY_INELIGIBLE',
                error: 'Promo tidak berlaku untuk kategori layanan ini.',
              };
            }
          }
        }

        if (isFinitePositiveNumber(targetMasterData.minimumTreatmentDuration)) {
          if (!isFinitePositiveNumber(serviceData.duration) || serviceData.duration < targetMasterData.minimumTreatmentDuration) {
            return {
              status: 409,
              code: 'VOUCHER_DURATION_INELIGIBLE',
              error: `Promo memerlukan durasi layanan minimal ${targetMasterData.minimumTreatmentDuration} menit.`,
            };
          }
        }

        const checkTierIds = (ids: unknown): boolean => {
          if (ids === undefined || ids === null) return true;
          if (!Array.isArray(ids)) return false;
          if (ids.length === 0) return true;
          const lowerIds = ids.map((x) => String(x).trim().toLowerCase());
          return (
            lowerIds.includes(String(resolvedTier.id || '').trim().toLowerCase()) ||
            lowerIds.includes(String(resolvedTier.name || '').trim().toLowerCase())
          );
        };
        if (!checkTierIds(targetMasterData.applicableTierIds)) {
          return {
            status: 409,
            code: 'VOUCHER_TIER_INELIGIBLE',
            error: 'Promo tidak berlaku untuk tier keanggotaan Anda.',
          };
        }

        if (
          targetMasterData.customerSpecific === true ||
          (targetMasterData.customerId !== undefined && targetMasterData.customerId !== null && targetMasterData.customerId !== '')
        ) {
          const targetCust = typeof targetMasterData.customerId === 'string' ? targetMasterData.customerId.trim() : '';
          if (!targetCust || (targetCust !== verifiedUid && (!verifiedCustomerId || targetCust !== verifiedCustomerId))) {
            return {
              status: 403,
              code: 'VOUCHER_CUSTOMER_INELIGIBLE',
              error: 'Voucher khusus ini tidak ditujukan untuk akun Anda.',
            };
          }
        }


        if (!isFinitePositiveNumber(serverDerivedDiscountAmount)) {
          return {
            status: 409,
            code: 'VOUCHER_INELIGIBLE',
            error: 'Voucher tidak menghasilkan potongan yang valid pada pesanan ini.',
          };
        }

        const rawCurrentUsage = targetMasterData.currentUsageCount ?? 0;
        const rawLimitTotal = targetMasterData.usageLimitTotal ?? 0;
        const rawLimitPerCustomer =
          targetMasterData.usageLimitPerCustomer !== undefined && targetMasterData.usageLimitPerCustomer !== null
            ? targetMasterData.usageLimitPerCustomer
            : code === 'SENZUWELCOME'
              ? 1
              : 0;
        if (
          !isFiniteNonNegativeInt(rawCurrentUsage) ||
          !isFiniteNonNegativeInt(rawLimitTotal) ||
          !isFiniteNonNegativeInt(rawLimitPerCustomer)
        ) {
          return {
            status: 409,
            code: 'VOUCHER_CONFIG_INVALID',
            error: 'Konfigurasi kuota voucher tidak valid.',
          };
        }

        const checkLockActive = (lSnap: any): { ok: boolean; activeId?: string; code?: string; error?: string } => {
          if (!lSnap || !snapExists(lSnap)) return { ok: true };
          const lData = lSnap.data() || {};
          const lStatus = typeof lData.status === 'string' ? lData.status.trim().toLowerCase() : 'active';
          if (lStatus === 'cancelled' || lStatus === 'batal') return { ok: true };
          const lCode = typeof lData.voucherCode === 'string' ? lData.voucherCode.trim().toUpperCase() : '';
          if (lCode && lCode !== code) {
            return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'Data reservasi voucher tidak konsisten.' };
          }
          const lUid = typeof lData.customerAuthUid === 'string' ? lData.customerAuthUid.trim() : '';
          if (lUid && lUid !== verifiedUid) {
            return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'Reservasi voucher bertentangan dengan pemilik akun.' };
          }
          return { ok: true, activeId: lData.bookingId || lSnap.id };
        };

        const uidLockCheck = checkLockActive(uidLockSnap);
        if (!uidLockCheck.ok) {
          return { status: 409, code: uidLockCheck.code, error: uidLockCheck.error };
        }
        const priorCustomerUseKeys = new Set<string>();
        if (uidLockCheck.activeId) priorCustomerUseKeys.add(uidLockCheck.activeId);

        if (verifiedCustomerId && custLockSnaps.has(verifiedCustomerId)) {
          const custLockCheck = checkLockActive(custLockSnaps.get(verifiedCustomerId));
          if (!custLockCheck.ok) {
            return { status: 409, code: custLockCheck.code, error: custLockCheck.error };
          }
          if (custLockCheck.activeId) priorCustomerUseKeys.add(custLockCheck.activeId);
        }
        if (phoneLockSnap && snapExists(phoneLockSnap)) {
          const pData = phoneLockSnap.data() || {};
          const pStatus = typeof pData.status === 'string' ? pData.status.trim().toLowerCase() : 'active';
          if (pStatus !== 'cancelled' && pStatus !== 'batal') {
            const pCode = typeof pData.voucherCode === 'string' ? pData.voucherCode.trim().toUpperCase() : '';
            if (pCode && pCode !== code) {
              return { status: 409, code: 'VOUCHER_LOCK_CONFLICT', error: 'Data reservasi voucher tidak konsisten.' };
            }
            const pUid = typeof pData.customerAuthUid === 'string' ? pData.customerAuthUid.trim() : '';
            if (pUid === verifiedUid && (pData.bookingId || phoneLockSnap.id)) {
              priorCustomerUseKeys.add(pData.bookingId || phoneLockSnap.id);
            }
          }
        }

        const allRedemptionDocs = new Map<string, any>();
        for (const d of [
          ...(redemptionsByCodeSnap?.docs || []),
          ...(redemptionsByMasterIdSnap?.docs || []),
        ]) {
          if (snapExists(d) && !d.id.startsWith('vlock_')) {
            allRedemptionDocs.set(d.id, d.data() || {});
          }
        }

        let activeGlobalRedemptionsCount = 0;
        for (const [rId, rData] of allRedemptionDocs.entries()) {
          const rStatus = typeof rData.status === 'string' ? rData.status.trim().toLowerCase() : 'active';
          if (rStatus === 'cancelled' || rStatus === 'batal') continue;
          const rCode = typeof rData.voucherCode === 'string' ? rData.voucherCode.trim().toUpperCase() : '';
          const rVoucherId = typeof rData.voucherId === 'string' ? rData.voucherId.trim() : '';
          if (rCode !== code && rVoucherId !== targetMasterId) continue;

          activeGlobalRedemptionsCount++;
          const rUid = typeof rData.customerAuthUid === 'string' ? rData.customerAuthUid.trim() : '';
          const rCustId = typeof rData.customerId === 'string' ? rData.customerId.trim() : '';
          if (rUid === verifiedUid || (verifiedCustomerId && rCustId === verifiedCustomerId)) {
            priorCustomerUseKeys.add(rData.bookingId || rId);
          }
        }

        if (rawLimitTotal > 0) {
          const effectiveGlobalUsed = Math.max(rawCurrentUsage, activeGlobalRedemptionsCount);
          if (effectiveGlobalUsed >= rawLimitTotal) {
            return {
              status: 409,
              code: 'VOUCHER_QUOTA_EXHAUSTED',
              error: 'Kuota promo sudah habis.',
            };
          }
        }

        const ownedBookingsMap = new Map<string, any>();
        for (const d of [
          ...(bookingsByCanonicalSnap?.docs || []),
          ...(bookingsByLegacySnap?.docs || []),
        ]) {
          if (!snapExists(d)) continue;
          const b = d.data() || {};
          if (b.customerAuthUid && b.authUserId && b.customerAuthUid !== b.authUserId) continue;
          if (b.customerAuthUid && b.customerAuthUid !== verifiedUid) continue;
          if (!b.customerAuthUid && b.authUserId !== verifiedUid) continue;
          ownedBookingsMap.set(d.id, b);
        }
        if (verifiedCustomerId && bookingsByCustIdSnaps.has(verifiedCustomerId)) {
          for (const d of bookingsByCustIdSnaps.get(verifiedCustomerId)?.docs || []) {
            if (!snapExists(d) || ownedBookingsMap.has(d.id)) continue;
            const b = d.data() || {};
            if (b.customerAuthUid && b.customerAuthUid !== verifiedUid) continue;
            if (b.authUserId && b.authUserId !== verifiedUid) continue;
            ownedBookingsMap.set(d.id, b);
          }
        }

        let hasPreviousNonCancelledBooking = false;
        for (const [bId, b] of ownedBookingsMap.entries()) {
          const bStatus = typeof b.status === 'string' ? b.status.trim().toLowerCase() : '';
          if (bStatus === 'cancelled' || bStatus === 'batal') continue;
          hasPreviousNonCancelledBooking = true;

          const bPromoCode = typeof b.promoCode === 'string' ? b.promoCode.trim().toUpperCase() : '';
          const bVoucherCode = typeof b.voucherCode === 'string' ? b.voucherCode.trim().toUpperCase() : '';
          const bPromoId = typeof b.promoId === 'string' ? b.promoId.trim() : '';
          const bVoucherId = typeof b.voucherId === 'string' ? b.voucherId.trim() : '';
          if (
            bPromoCode === code ||
            bVoucherCode === code ||
            bPromoId === targetMasterId ||
            bVoucherId === targetMasterId
          ) {
            priorCustomerUseKeys.add(bId);
          }
        }

        if (rawLimitPerCustomer > 0 && priorCustomerUseKeys.size >= rawLimitPerCustomer) {
          return {
            status: 409,
            code: 'VOUCHER_CUSTOMER_QUOTA_EXHAUSTED',
            error: `Voucher ${code} sudah pernah digunakan pada akun ini.`,
          };
        }

        if (targetMasterData.firstOrderOnly === true || targetMasterData.newCustomerOnly === true) {
          if (hasPreviousNonCancelledBooking) {
            return {
              status: 409,
              code: 'VOUCHER_FIRST_ORDER_ONLY',
              error: 'Voucher ini khusus untuk pesanan pertama.',
            };
          }
          if (verifiedCustomerData) {
            const comp = verifiedCustomerData.completedBookings ?? 0;
            const tot = verifiedCustomerData.totalBookings ?? 0;
            if (!isFiniteNonNegativeInt(comp) || !isFiniteNonNegativeInt(tot)) {
              return {
                status: 409,
                code: 'VOUCHER_CONFIG_INVALID',
                error: 'Data riwayat pesanan pelanggan tidak valid.',
              };
            }
            if (comp > 0 || tot > 0) {
              return {
                status: 409,
                code: 'VOUCHER_FIRST_ORDER_ONLY',
                error: 'Voucher ini khusus untuk pesanan pertama.',
              };
            }
          }
        }

        }

        return {
          status: 200,
          voucher: {
            id: targetMasterId,
            code,
            name: targetMasterData.name || code,
            description: targetMasterData.description || '',
            voucherType: targetMasterData.voucherType,
            value: targetMasterData.value,
            maximumDiscount: targetMasterData.maximumDiscount,
            minimumSpend: targetMasterData.minimumSpend ?? 0,
            minimumTreatmentPrice: targetMasterData.minimumTreatmentPrice,
            minimumTreatmentDuration: targetMasterData.minimumTreatmentDuration,
            applicableServiceIds: targetMasterData.applicableServiceIds,
            applicableCategoryIds: targetMasterData.applicableCategoryIds,
            applicableTierIds: targetMasterData.applicableTierIds,
            firstOrderOnly: Boolean(targetMasterData.firstOrderOnly),
            newCustomerOnly: Boolean(targetMasterData.newCustomerOnly),
            stackable: Boolean(targetMasterData.stackable),
            enabled: true,
            validFrom: targetMasterData.validFrom,
            validUntil: targetMasterData.validUntil,
          },
          discountAmount: serverDerivedDiscountAmount,
          pricingBreakdown,
        };
      });

      if (previewOutcome.status !== 200) {
        return res.status(previewOutcome.status).json({
          valid: false,
          success: false,
          code: previewOutcome.code,
          error: previewOutcome.error,
          errorMessage: previewOutcome.error,
        });
      }

      return res.json({
        valid: true,
        success: true,
        voucher: previewOutcome.voucher,
        discountAmount: previewOutcome.discountAmount,
        pricingBreakdown: previewOutcome.pricingBreakdown,
      });
    } catch (err: any) {
      if (err?.code === 'LOYALTY_OWNERSHIP_CONFLICT') return res.status(409).json({valid: false, success: false, code: err.code, error: err.message, errorMessage: err.message});
      console.error('[VoucherValidate] Validation failure:', err?.code || err?.message || err);
      return res.status(503).json({
        valid: false,
        success: false,
        code: 'VOUCHER_VALIDATION_UNAVAILABLE',
        error: 'Layanan validasi voucher sedang mengalami kendala. Silakan coba kembali.',
        errorMessage: 'Layanan validasi voucher sedang mengalami kendala. Silakan coba kembali.',
      });
    }
  });

  // POST /api/vouchers/checkout - Server Authoritative Atomic Voucher-Bearing Booking + Redemption Writer (Stage 5B)
  app.post('/api/vouchers/checkout', async (req, res) => {
    const isValidDocId = (val: unknown, maxBytes = 256): val is string => {
      if (typeof val !== 'string') return false;
      const trimmed = val.trim();
      if (!trimmed || trimmed !== val) return false;
      if (trimmed === '.' || trimmed === '..') return false;
      if (Buffer.byteLength(trimmed, 'utf8') > maxBytes) return false;
      if (/[\/\\\x00-\x1F\x7F\s]/.test(trimmed)) return false;
      return true;
    };

    const isFiniteNonNegativeInt = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val) && val >= 0;

    const isFiniteNonNegativeNumber = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && val >= 0;

    const isFinitePositiveNumber = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && val > 0;

    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

    const calculateStraightDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c * 10) / 10;
    };

    const deriveDeterministicBookingCode = (uid: string, attemptId: string): string => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', year: '2-digit', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const date = ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value || '').join('');
      const digest = createHash('sha256').update(JSON.stringify([uid, attemptId])).digest('hex');
      const suffix = (Number.parseInt(digest.slice(0, 12), 16) % (36 ** 5)).toString(36).padStart(5, '0').toUpperCase();
      // The transaction reads this document first and never overwrites a collision.
      return `SH-${date}-${suffix}`;
    };

    const cleanBookingRecord = (obj: Record<string, any>): Record<string, any> => {
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) {
          cleaned[k] = v;
        }
      }
      return cleaned;
    };

    const calculateBookingPrice = (input: any) => {
      const warnings: string[] = [];
      const servicePrice = Math.max(0, input.servicePrice || 0);
      const homeServiceFee = Math.max(0, input.homeServiceFee || 0);
      const grossAmount = servicePrice + homeServiceFee;

      let tierDiscountAmount = 0;
      if (input.customerTier && input.customerTier.discountPercentage > 0) {
        tierDiscountAmount = Math.floor((servicePrice * input.customerTier.discountPercentage) / 100);
      }

      const priceAfterTier = Math.max(0, servicePrice - tierDiscountAmount);

      let promoDiscountAmount = 0;
      let voucherDiscountAmount = 0;

      if (input.promoVoucher && input.promoVoucher.enabled) {
        const promo = input.promoVoucher;
        if (priceAfterTier >= (promo.minimumSpend || 0)) {
          if (promo.voucherType === 'fixed_discount' || (promo.voucherType as any) === 'FIXED_AMOUNT') {
            promoDiscountAmount = promo.value;
          } else if (
            promo.voucherType === 'percentage_discount' ||
            promo.voucherType === 'percentage' ||
            (promo.voucherType as any) === 'PERCENTAGE'
          ) {
            let disc = Math.floor((priceAfterTier * promo.value) / 100);
            if (promo.maximumDiscount && promo.maximumDiscount > 0) {
              disc = Math.min(disc, promo.maximumDiscount);
            }
            promoDiscountAmount = disc;
          } else if (promo.voucherType === 'free_home_service_fee') {
            promoDiscountAmount = homeServiceFee;
          }
        } else {
          warnings.push(`Kode promo memerlukan minimal transaksi Rp ${(promo.minimumSpend || 0).toLocaleString('id-ID')}`);
        }
      }

      if (input.customerVoucher && input.customerVoucher.status === 'available') {
        const cv = input.customerVoucher;
        if (priceAfterTier >= (cv.minimumSpend || 0)) {
          if (cv.voucherType === 'fixed_discount') {
            voucherDiscountAmount = cv.value;
          } else if (cv.voucherType === 'percentage_discount') {
            let disc = Math.floor((priceAfterTier * cv.value) / 100);
            if (cv.maximumDiscount && cv.maximumDiscount > 0) {
              disc = Math.min(disc, cv.maximumDiscount);
            }
            voucherDiscountAmount = disc;
          } else if (cv.voucherType === 'free_home_service_fee') {
            voucherDiscountAmount = homeServiceFee;
          }
        } else {
          warnings.push(`Voucher memerlukan minimal transaksi Rp ${(cv.minimumSpend || 0).toLocaleString('id-ID')}`);
        }
      }

      const allowStacking = input.settings?.allowStacking ?? false;
      let totalPromoAndVoucherDiscount = 0;
      if (!allowStacking && promoDiscountAmount > 0 && voucherDiscountAmount > 0) {
        if (voucherDiscountAmount >= promoDiscountAmount) {
          promoDiscountAmount = 0;
          totalPromoAndVoucherDiscount = voucherDiscountAmount;
        } else {
          voucherDiscountAmount = 0;
          totalPromoAndVoucherDiscount = promoDiscountAmount;
        }
      } else {
        totalPromoAndVoucherDiscount = promoDiscountAmount + voucherDiscountAmount;
      }

      totalPromoAndVoucherDiscount = Math.min(totalPromoAndVoucherDiscount, priceAfterTier + homeServiceFee);

      const amountAfterVouchers = Math.max(0, priceAfterTier + homeServiceFee - totalPromoAndVoucherDiscount);

      const pointsPerCurrencyUnit = input.settings?.pointsPerCurrencyUnit || 10;
      const valuePerPoint = 1000 / pointsPerCurrencyUnit;
      const minPointsToRedeem = input.settings?.minimumPointsToRedeem || 50;
      const maxRedemptionPercentage = input.settings?.maximumRedemptionPercentage || 30;

      const requestedPoints = Math.max(0, Math.floor(input.pointsToRedeem || 0));
      let pointsRedeemed = 0;
      let pointsDiscountAmount = 0;

      if (requestedPoints > 0) {
        if (requestedPoints < minPointsToRedeem) {
          warnings.push(`Minimal penukaran poin adalah ${minPointsToRedeem} Poin.`);
        } else {
          const maxAllowedDiscountRp = Math.floor((grossAmount * maxRedemptionPercentage) / 100);
          const maxAllowedPoints = Math.floor(maxAllowedDiscountRp / valuePerPoint);

          pointsRedeemed = Math.min(requestedPoints, maxAllowedPoints);
          pointsDiscountAmount = pointsRedeemed * valuePerPoint;

          if (pointsDiscountAmount > amountAfterVouchers) {
            pointsDiscountAmount = amountAfterVouchers;
            pointsRedeemed = Math.floor(pointsDiscountAmount / valuePerPoint);
          }
        }
      }

      const totalDiscount = tierDiscountAmount + totalPromoAndVoucherDiscount + pointsDiscountAmount;
      const finalAmount = Math.max(0, grossAmount - totalDiscount);

      const includeHomeServiceFee = input.settings?.includeHomeServiceFeeForPoints ?? false;
      const spendPerPoint = input.settings?.spendPerPoint || 10000;
      const multiplier = input.customerTier?.earningMultiplier || 1.0;

      let qualifiedSpendForPoints = servicePrice - tierDiscountAmount - totalPromoAndVoucherDiscount - pointsDiscountAmount;
      if (includeHomeServiceFee) {
        qualifiedSpendForPoints += homeServiceFee;
      }
      qualifiedSpendForPoints = Math.max(0, qualifiedSpendForPoints);

      const basePointsEarned = Math.floor(qualifiedSpendForPoints / spendPerPoint);
      const estimatedPointsEarned = Math.floor(basePointsEarned * multiplier);

      return {
        servicePrice,
        homeServiceFee,
        grossAmount,
        tierDiscountAmount,
        promoDiscountAmount,
        voucherDiscountAmount,
        totalPromoAndVoucherDiscount,
        pointsRedeemed,
        pointsDiscountAmount,
        totalDiscount,
        finalAmount,
        qualifiedSpendForPoints,
        estimatedPointsEarned,
        warnings,
      };
    };

    try {
      // 1. Strict Single Bearer Token Extraction BEFORE any DB reads/writes
      const rawAuthHeader = req.headers?.authorization;
      if (typeof rawAuthHeader !== 'string') {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Token otentikasi diperlukan untuk checkout voucher.',
        });
      }
      const tokenMatch = /^Bearer\s+(\S+)$/i.exec(rawAuthHeader.trim());
      if (!tokenMatch || !tokenMatch[1]) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Format token otentikasi tidak valid.',
        });
      }

      if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'AUTH_SERVICE_UNAVAILABLE',
          error: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
        });
      }

      const authResult = await verifyCustomerFirebaseIdToken(tokenMatch[1]);
      if (authResult.success === false) {
        return res.status(authResult.statusCode).json({
          success: false,
          code: authResult.code,
          error: authResult.message,
          message: authResult.message,
        });
      }

      const verifiedUid = typeof authResult.uid === 'string' ? authResult.uid.trim() : '';
      if (!isValidDocId(verifiedUid, 128) || verifiedUid !== authResult.uid) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_TOKEN_INVALID',
          error: 'Identitas pengguna tidak valid.',
        });
      }

      // Reject conflicting caller-supplied UID fields in body
      for (const uidField of ['customerAuthUid', 'authUserId'] as const) {
        const val = req.body?.[uidField];
        if (val !== undefined && val !== null && val !== '') {
          if (typeof val !== 'string' || val.trim() !== verifiedUid) {
            return res.status(403).json({
              success: false,
              code: 'BOOKING_OWNERSHIP_DENIED',
              error: 'Akses ditolak. Identitas sesi tidak sesuai dengan akun pemesanan.',
            });
          }
        }
      }

      // 2. Bounded Input & Attempt ID Validation BEFORE any DB reads/writes
      const rawAttemptId = req.body?.checkoutAttemptId ?? req.body?.idempotencyKey ?? req.body?.attemptId;
      const checkoutAttemptId = typeof rawAttemptId === 'string' ? rawAttemptId.trim() : '';
      if (
        !checkoutAttemptId ||
        !isValidDocId(checkoutAttemptId, 128) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(checkoutAttemptId)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CHECKOUT_ATTEMPT_ID',
          error: 'ID percobaan checkout voucher tidak valid.',
        });
      }

      // Reject privileged status/operational overrides in request body
      if (
        req.body?.status !== undefined &&
        req.body?.status !== null &&
        req.body?.status !== 'Menunggu Pembayaran'
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_STATUS',
          error: 'Status pesanan awal tidak valid.',
        });
      }
      if (
        req.body?.paymentStatus !== undefined &&
        req.body?.paymentStatus !== null &&
        req.body?.paymentStatus !== 'UNPAID'
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYMENT_STATUS',
          error: 'Status pembayaran awal tidak valid.',
        });
      }
      for (const forbiddenField of [
        'therapistId',
        'therapistName',
        'paymentVerifiedAt',
        'paymentVerifiedBy',
        'paidAt',
        'completedAt',
        'cancelledAt',
        'acceptedAt',
        'onTheWayAt',
        'arrivedAt',
        'paymentDeadline',
        'internalNotes',
      ] as const) {
        const fVal = req.body?.[forbiddenField];
        if (fVal !== undefined && fVal !== null && fVal !== '') {
          return res.status(400).json({
            success: false,
            code: 'FORBIDDEN_BOOKING_FIELD',
            error: 'Permintaan mengandung atribut operasional yang tidak diizinkan.',
          });
        }
      }

      const paymentMethodTrimmed =
        typeof req.body?.paymentMethod === 'string' ? req.body.paymentMethod.trim() : '';
      const rawMethodLower = paymentMethodTrimmed.toLowerCase();
      if (
        !paymentMethodTrimmed ||
        paymentMethodTrimmed.length > 64 ||
        rawMethodLower.includes('cash') ||
        rawMethodLower.includes('tunai') ||
        rawMethodLower.includes('pay_on_service') ||
        rawMethodLower.includes('pay on service') ||
        rawMethodLower.includes('cod') ||
        rawMethodLower.includes('bayar di tempat') ||
        rawMethodLower.includes('bayar_di_tempat')
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYMENT_METHOD',
          error: 'Metode pembayaran tersebut sudah tidak tersedia.',
        });
      }

      const serviceId = typeof req.body?.serviceId === 'string' ? req.body.serviceId.trim() : '';
      if (!serviceId || !isValidDocId(serviceId, 128)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_SERVICE_ID',
          error: 'ID layanan tidak valid.',
        });
      }

      const customerNameTrimmed =
        typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
      if (!customerNameTrimmed || customerNameTrimmed.length > 200) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMER_NAME',
          error: 'Nama pelanggan tidak valid.',
        });
      }

      const customerWhatsAppTrimmed =
        typeof req.body?.customerWhatsApp === 'string'
          ? req.body.customerWhatsApp.trim()
          : typeof req.body?.customerPhone === 'string'
            ? req.body.customerPhone.trim()
            : '';
      const { cleanDigits: bookingPhoneDigits } = normalizeIndonesianPhoneServer(customerWhatsAppTrimmed);
      if (!bookingPhoneDigits || !/^[0-9]{9,20}$/.test(bookingPhoneDigits) || !isValidDocId(bookingPhoneDigits, 32)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMER_PHONE',
          error: 'Nomor WhatsApp pelanggan tidak valid.',
        });
      }

      const customerEmailTrimmed =
        typeof req.body?.customerEmail === 'string' ? req.body.customerEmail.trim() : '';
      if (customerEmailTrimmed.length > 254) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMER_EMAIL',
          error: 'Alamat email pelanggan terlalu panjang.',
        });
      }

      const addressTrimmed = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
      if (!addressTrimmed || addressTrimmed.length > 1000) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ADDRESS',
          error: 'Alamat kedatangan terapis tidak valid.',
        });
      }

      const scheduleDate = typeof req.body?.scheduleDate === 'string' ? req.body.scheduleDate.trim() : '';
      const scheduleTime = typeof req.body?.scheduleTime === 'string' ? req.body.scheduleTime.trim() : '';
      if (!scheduleDate || scheduleDate.length > 32 || !scheduleTime || scheduleTime.length > 32) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_SCHEDULE',
          error: 'Jadwal layanan tidak valid.',
        });
      }

      const latitude = req.body?.latitude;
      const longitude = req.body?.longitude;
      if (
        typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_COORDINATES',
          error: 'Titik koordinat lokasi tidak valid.',
        });
      }

      // Validate voucher linkage fields structure
      for (const fieldName of [
        'promoId',
        'promoCode',
        'promoCodeSnapshot',
        'voucherId',
        'voucherCode',
        'customerVoucherId',
      ] as const) {
        const val = req.body?.[fieldName];
        if (val !== undefined && val !== null && val !== '') {
          if (typeof val !== 'string' || /[\/\\\x00-\x1F\x7F\s]/.test(val.trim()) || Buffer.byteLength(val.trim(), 'utf8') > 128) {
            return res.status(400).json({
              success: false,
              code: 'VOUCHER_LINKAGE_INVALID',
              error: 'Data referensi voucher pada pesanan tidak valid.',
            });
          }
        }
      }

      const rawReqVoucherId = typeof req.body?.voucherId === 'string' ? req.body.voucherId.trim() : '';
      const rawReqPromoId = typeof req.body?.promoId === 'string' ? req.body.promoId.trim() : '';
      const rawReqCustomerVoucherId =
        typeof req.body?.customerVoucherId === 'string' ? req.body.customerVoucherId.trim() : '';
      const rawReqVoucherCode =
        typeof req.body?.voucherCode === 'string' ? req.body.voucherCode.trim().toUpperCase() : '';
      const rawReqPromoCode =
        typeof req.body?.promoCode === 'string' ? req.body.promoCode.trim().toUpperCase() : '';
      const rawReqPromoSnapshot =
        typeof req.body?.promoCodeSnapshot === 'string' ? req.body.promoCodeSnapshot.trim().toUpperCase() : '';

      for (const codeVal of [rawReqVoucherCode, rawReqPromoCode, rawReqPromoSnapshot]) {
        if (codeVal && !/^[A-Z0-9_-]{1,64}$/.test(codeVal)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_VOUCHER_CODE',
            error: 'Kode voucher tidak valid.',
          });
        }
      }

      if (rawReqPromoCode && rawReqPromoSnapshot && rawReqPromoCode !== rawReqPromoSnapshot) {
        return res.status(409).json({
          success: false,
          code: 'VOUCHER_LINKAGE_CONFLICT',
          error: 'Konflik kode promo pada data pesanan.',
        });
      }

      if (rawReqCustomerVoucherId && !rawReqCustomerVoucherId.startsWith('cv_')) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_VOUCHER_ID',
          error: 'ID voucher personal tidak valid.',
        });
      }
      if (
        rawReqCustomerVoucherId &&
        rawReqVoucherId.startsWith('cv_') &&
        rawReqCustomerVoucherId !== rawReqVoucherId
      ) {
        return res.status(409).json({
          success: false,
          code: 'VOUCHER_LINKAGE_CONFLICT',
          error: 'Konflik ID voucher personal pada data pesanan.',
        });
      }

      const personalCvId = rawReqCustomerVoucherId
        ? rawReqCustomerVoucherId
        : rawReqVoucherId.startsWith('cv_')
          ? rawReqVoucherId
          : rawReqPromoId.startsWith('cv_')
            ? rawReqPromoId
            : '';

      if (
        rawReqPromoId &&
        !rawReqPromoId.startsWith('cv_') &&
        rawReqVoucherId &&
        !rawReqVoucherId.startsWith('cv_') &&
        rawReqPromoId !== rawReqVoucherId
      ) {
        return res.status(409).json({
          success: false,
          code: 'VOUCHER_LINKAGE_CONFLICT',
          error: 'Konflik ID voucher pada data pesanan.',
        });
      }

      const generalPromoId =
        rawReqPromoId && !rawReqPromoId.startsWith('cv_')
          ? rawReqPromoId
          : !personalCvId && rawReqVoucherId && !rawReqVoucherId.startsWith('cv_')
            ? rawReqVoucherId
            : '';

      if (!personalCvId) {
        const nonEmptyCodes = new Set(
          [rawReqPromoCode, rawReqPromoSnapshot, rawReqVoucherCode].filter(Boolean)
        );
        if (nonEmptyCodes.size > 1) {
          return res.status(409).json({
            success: false,
            code: 'VOUCHER_LINKAGE_CONFLICT',
            error: 'Konflik kode voucher pada data pesanan.',
          });
        }
      }

      const effectivePromoCode =
        rawReqPromoCode || rawReqPromoSnapshot || (!personalCvId ? rawReqVoucherCode : '');

      const requestedPoints =
        req.body?.pointsRedeemed !== undefined && req.body?.pointsRedeemed !== null
          ? Math.floor(req.body.pointsRedeemed)
          : req.body?.pointsToRedeem !== undefined && req.body?.pointsToRedeem !== null && isFiniteNonNegativeNumber(req.body.pointsToRedeem)
            ? Math.floor(req.body.pointsToRedeem)
            : 0;

      const pointsOnlyCheckout = !personalCvId && !effectivePromoCode && !generalPromoId && requestedPoints > 0;
      if (!personalCvId && !effectivePromoCode && !generalPromoId && !pointsOnlyCheckout) {
        return res.status(400).json({
          success: false,
          code: 'VOUCHER_REQUIRED',
          error: 'Pesanan checkout voucher harus menyertakan kode promo atau voucher pelanggan.',
        });
      }

      // Validate optional numeric price/points fields in request
      for (const numField of [
        'servicePrice',
        'homeServiceFee',
        'discountAmount',
        'promoDiscount',
        'voucherDiscount',
        'totalAmount',
        'pointsRedeemed',
        'pointsDiscount',
      ] as const) {
        const nVal = req.body?.[numField];
        if (nVal !== undefined && nVal !== null && !isFiniteNonNegativeNumber(nVal)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_PRICE_ASSERTION',
            error: `Format nilai numerik ${numField} tidak valid.`,
          });
        }
      }


      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'VOUCHER_CHECKOUT_UNAVAILABLE',
          error: 'Layanan checkout voucher sedang tidak tersedia.',
        });
      }

      const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
      // Price assertions and membership snapshots are deliberately excluded from intent identity.
      const checkoutIntent = {
        customerId: text(req.body?.customerId), customerName: customerNameTrimmed,
        customerPhoneDigits: bookingPhoneDigits, customerEmail: customerEmailTrimmed,
        serviceId, scheduleDate, scheduleTime, paymentMethod: paymentMethodTrimmed,
        genderPreference: text(req.body?.genderPreference) || 'Bebas', address: addressTrimmed,
        latitude, longitude, placeId: text(req.body?.placeId), addressNotes: text(req.body?.addressNotes),
        distanceKm: req.body?.distanceKm ?? 0, distanceMeters: req.body?.distanceMeters ?? null,
        requiresAdminConfirmation: Boolean(req.body?.requiresAdminConfirmation),
        area: text(req.body?.area), areaIdSnapshot: text(req.body?.areaIdSnapshot),
        areaNameSnapshot: text(req.body?.areaNameSnapshot) || text(req.body?.area),
        customerNotes: text(req.body?.customerNotes).slice(0, 1000),
        referredByCustomerId: text(req.body?.referredByCustomerId), referralCodeUsed: text(req.body?.referralCodeUsed).toUpperCase(),
        personalCvId, generalPromoId, effectivePromoCode, requestedPoints,
      };
      const checkoutReceiptId = `vchk_${createHash('sha256').update(JSON.stringify([verifiedUid, checkoutAttemptId])).digest('hex')}`;
      const checkoutReceiptRef = adminDb.collection('voucher_checkout_receipts').doc(checkoutReceiptId);
      const legacyCheckoutReceiptRef = adminDb.collection('voucher_checkout_receipts').doc(`vchk_${checkoutAttemptId}`);
      const candidateBookingCode = deriveDeterministicBookingCode(verifiedUid, checkoutAttemptId);
      const candidateBookingId = `bk_${candidateBookingCode}`;
      const candidateBookingRef = adminDb.collection('bookings').doc(candidateBookingId);

      // 3. Authoritative Native Admin Transaction (All reads precede all writes)
      const txOutcome: any = await adminDb.runTransaction(async (transaction: any) => {
        const nowIso = new Date().toISOString();

        // --- PHASE 1: CHECK TRUSTED CHECKOUT RECEIPT FOR IDEMPOTENT REPLAY ---
        let checkoutReceiptSnap = await transaction.get(checkoutReceiptRef);
        if (!snapExists(checkoutReceiptSnap)) {
          const legacySnap = await transaction.get(legacyCheckoutReceiptRef);
          // A different UID's legacy attempt is never used as authority or reassigned.
          if (snapExists(legacySnap) && legacySnap.data()?.customerAuthUid === verifiedUid) checkoutReceiptSnap = legacySnap;
        }
        if (snapExists(checkoutReceiptSnap)) {
          const receipt = checkoutReceiptSnap.data() || {};
          const conflict = (code = 'VOUCHER_RECEIPT_CONFLICT') => ({ status: 409, code,
            error: 'Bukti checkout tidak lengkap atau detail pesanan berbeda. Hubungi Customer Service untuk peninjauan.' });
          const pointsReceipt = receipt.schemaVersion === 2 && receipt.benefitType === 'points';
          if (![1, 2].includes(receipt.schemaVersion) || receipt.checkoutAttemptId !== checkoutAttemptId
            || receipt.customerAuthUid !== verifiedUid || !isValidDocId(receipt.bookingId, 256)
            || !isValidDocId(receipt.redemptionId, 256)
            || (pointsReceipt ? (receipt.voucherId !== null || receipt.voucherCode !== null
              || receipt.discountAmount !== 0 || !isFinitePositiveNumber(receipt.pointsRedeemed)
              || receipt.redemptionId !== receipt.loyaltyTransactionId)
              : (!isValidDocId(receipt.voucherId, 128) || !isFinitePositiveNumber(receipt.discountAmount)))
            || !isFiniteNonNegativeNumber(receipt.totalAmount)
            || typeof receipt.committedAt !== 'string' || Number.isNaN(Date.parse(receipt.committedAt))) return conflict();
          const bookingSnap = await transaction.get(adminDb.collection('bookings').doc(receipt.bookingId));
          if (!snapExists(bookingSnap)) return conflict();
          const booking = bookingSnap.data() || {};
          const owners = [booking.customerAuthUid, booking.authUserId];
          if (!owners.some(value => value === verifiedUid)
            || !owners.every(value => value === undefined || value === null || value === '' || value === verifiedUid)
            || booking.customerId !== receipt.customerId || booking.totalAmount !== receipt.totalAmount
            || booking.bookingCode !== receipt.bookingCode) return conflict();
          if (['cancelled', 'batal', 'completed', 'expired', 'rejected', 'refunded', 'rescheduled'].includes(text(booking.status).toLowerCase())
            || text(booking.paymentStatus).toLowerCase() === 'expired') {
            return {status: 409, code: 'CHECKOUT_BOOKING_CLOSED', error: 'Pesanan ini sudah ditutup. Silakan lihat statusnya di Pesanan Saya.'};
          }
          if (receipt.schemaVersion === 2 && (!receipt.pricingBreakdown
            || booking.discountAmount !== receipt.totalDiscount
            || booking.servicePrice !== receipt.pricingBreakdown.servicePrice
            || booking.homeServiceFee !== receipt.pricingBreakdown.homeServiceFee
            || booking.promoDiscount !== receipt.pricingBreakdown.promoDiscountAmount
            || booking.totalAmount !== receipt.pricingBreakdown.finalAmount)) return conflict();
          if (receipt.schemaVersion === 2) {
            if (!receipt.intent || Object.keys(receipt.intent).length !== Object.keys(checkoutIntent).length
              || Object.keys(checkoutIntent).some(key => receipt.intent[key] !== (checkoutIntent as any)[key])) return conflict('CHECKOUT_ATTEMPT_MISMATCH');
          } else {
            // Schema 1 had no full intent. Use its immutable committed booking, never public ledger fields.
            const oldPhone = normalizeIndonesianPhoneServer(text(booking.customerWhatsApp)).cleanDigits;
            const oldIntent = {
              ...checkoutIntent, customerId: text(booking.customerId), customerName: text(booking.customerName),
              customerPhoneDigits: oldPhone, customerEmail: text(booking.customerEmail),
              serviceId: text(booking.serviceId), scheduleDate: text(booking.scheduleDate), scheduleTime: text(booking.scheduleTime),
              paymentMethod: text(booking.paymentMethod), genderPreference: text(booking.genderPreference) || 'Bebas',
              address: text(booking.address), latitude: booking.latitude, longitude: booking.longitude,
              placeId: text(booking.placeId), addressNotes: text(booking.addressNotes),
              distanceKm: booking.distanceKm ?? 0,
              distanceMeters: req.body?.distanceMeters == null ? null : booking.distanceMeters,
              requiresAdminConfirmation: Boolean(booking.requiresAdminConfirmation), area: text(booking.area),
              areaIdSnapshot: text(booking.areaIdSnapshot), areaNameSnapshot: text(booking.areaNameSnapshot) || text(booking.area),
              customerNotes: text(booking.customerNotes), referredByCustomerId: text(booking.referredByCustomerId),
              referralCodeUsed: text(booking.referralCodeUsed).toUpperCase(),
              personalCvId: receipt.personalCustomerVoucherId || '',
              generalPromoId: receipt.generalPromoId || '', effectivePromoCode: receipt.generalPromoCode || '',
              requestedPoints: receipt.requestedPoints ?? receipt.pointsRedeemed ?? 0,
            };
            if (JSON.stringify(oldIntent) !== JSON.stringify(checkoutIntent)) return conflict('CHECKOUT_ATTEMPT_MISMATCH');
          }
          let applied = receipt.appliedVouchers;
          if (receipt.schemaVersion === 1) {
            applied = [];
            if (booking.promoDiscount > 0 && receipt.generalPromoId && receipt.generalPromoCode) applied.push({
              kind: 'general', voucherId: receipt.generalPromoId, voucherCode: receipt.generalPromoCode,
              redemptionId: `vred_${receipt.generalPromoCode}_${receipt.bookingId}`, discountAmount: booking.promoDiscount,
            });
            if (booking.voucherDiscount > 0 && receipt.personalCustomerVoucherId) applied.push({
              kind: 'personal', voucherId: '', voucherCode: booking.voucherCode,
              redemptionId: `vred_${booking.voucherCode}_${receipt.bookingId}`, discountAmount: booking.voucherDiscount,
              customerVoucherId: receipt.personalCustomerVoucherId,
            });
            if (receipt.personalCustomerVoucherId && applied.some(item => item.kind === 'personal')) {
              const legacyCvSnap = await transaction.get(adminDb.collection('customer_vouchers').doc(receipt.personalCustomerVoucherId));
              if (!snapExists(legacyCvSnap)) return conflict();
              const personalItem = applied.find(item => item.kind === 'personal');
              personalItem.voucherId = legacyCvSnap.data()?.voucherId;
            }
            if (applied.length === 0 && !receipt.personalCustomerVoucherId) applied.push({kind: 'general',
              voucherId: receipt.voucherId, voucherCode: receipt.voucherCode, redemptionId: receipt.redemptionId, discountAmount: receipt.discountAmount});
          }
          if (!Array.isArray(applied) || (pointsReceipt ? applied.length !== 0 : applied.length < 1) || applied.length > 2
            || applied.some(item => !item || typeof item !== 'object')
            || new Set(applied.map(item => item.redemptionId)).size !== applied.length
            || (!pointsReceipt && !applied.some(item => item.redemptionId === receipt.redemptionId))
            || applied.reduce((sum, item) => sum + item.discountAmount, 0) !== receipt.discountAmount) return conflict();
          for (const item of applied) {
            if (!['general', 'personal'].includes(item.kind) || !isValidDocId(item.voucherId, 128)
              || typeof item.voucherCode !== 'string' || !/^[A-Z0-9_-]{1,64}$/.test(item.voucherCode)
              || item.redemptionId !== `vred_${item.voucherCode}_${receipt.bookingId}`
              || !isFinitePositiveNumber(item.discountAmount)) return conflict();
            const proofSnap = await transaction.get(adminDb.collection('voucher_redemption_receipts').doc(item.redemptionId));
            const proof = snapExists(proofSnap) ? proofSnap.data() || {} : {};
            if (proof.schemaVersion !== 1 || proof.redemptionId !== item.redemptionId || proof.bookingId !== receipt.bookingId
              || proof.voucherId !== item.voucherId || proof.voucherCode !== item.voucherCode || proof.customerAuthUid !== verifiedUid
              || proof.discountAmount !== item.discountAmount || proof.committedAt !== receipt.committedAt) return conflict();
            if (item.kind === 'general' && (booking.promoId || booking.voucherId) !== item.voucherId) return conflict();
            if (item.kind === 'personal') {
              const cvId = item.customerVoucherId || receipt.personalCustomerVoucherId;
              if (!isValidDocId(cvId, 128) || (booking.customerVoucherId || booking.voucherId) !== cvId) return conflict();
              const cvSnap = await transaction.get(adminDb.collection('customer_vouchers').doc(cvId));
              const cv = snapExists(cvSnap) ? cvSnap.data() || {} : {};
              const cvOwners = [cv.customerAuthUid, cv.authUserId];
              if (!cvOwners.every(value => value === undefined || value === null || value === '' || value === verifiedUid)
                || ![verifiedUid, receipt.customerId].includes(cv.customerId) || cv.voucherId !== item.voucherId
                || text(cv.voucherCode).toUpperCase() !== item.voucherCode || cv.bookingId !== receipt.bookingId
                || cv.status !== 'used') return conflict('VOUCHER_LINKAGE_CONFLICT');
              if (cv.customerId !== verifiedUid) {
                const profileSnap = await transaction.get(adminDb.collection('customers').doc(cv.customerId));
                const profile = snapExists(profileSnap) ? profileSnap.data() || {} : {};
                const profileOwners = [profile.customerAuthUid, profile.authUserId];
                if (!profileOwners.some(value => value === verifiedUid)
                  || !profileOwners.every(value => value === undefined || value === null || value === '' || value === verifiedUid)) return conflict('VOUCHER_LINKAGE_CONFLICT');
              }
            }
          }
          const points = receipt.pointsRedeemed || 0;
          if ((booking.pointsRedeemed || 0) !== points || (booking.pointsDiscount || 0) !== (receipt.pointsDiscount || 0)) return conflict();
          if (points > 0) {
            if (receipt.schemaVersion !== 2 || !isValidDocId(receipt.loyaltyTransactionId, 256)
              || !isValidDocId(receipt.loyaltyAccountId, 128)) return conflict('VOUCHER_REDEMPTION_REVIEW_REQUIRED');
            const debitSnap = await transaction.get(adminDb.collection('loyalty_transactions').doc(receipt.loyaltyTransactionId));
            const debit = snapExists(debitSnap) ? debitSnap.data() || {} : {};
            if (debit.customerAuthUid !== verifiedUid || debit.bookingId !== receipt.bookingId || debit.referenceId !== receipt.bookingId
              || debit.referenceType !== 'booking_checkout' || debit.transactionType !== 'redeem' || debit.points !== -points
              || debit.balanceBefore - debit.balanceAfter !== points || debit.metadata?.discountRp !== receipt.pointsDiscount
              || debit.customerId !== receipt.loyaltyAccountId) return conflict();
          }
          // No repricing, eligibility dates, financial writes, or status changes on replay.
          return {status: 200, isIdempotent: true, booking, redemptionId: receipt.redemptionId,
            voucherId: receipt.voucherId, voucherCode: receipt.voucherCode, discountAmount: receipt.discountAmount,
            ...(receipt.pricingBreakdown ? {pricingBreakdown: receipt.pricingBreakdown} : {})};
        }

        if (req.body?.recoverOnly === true) {
          return {status: 404, code: 'CHECKOUT_NOT_COMMITTED', error: 'Percobaan checkout belum tersimpan. Silakan kirim pesanan kembali.'};
        }

        // --- PHASE 2: COMPLETE ALL TRANSACTION READS BEFORE ANY WRITES ---
        const candidateBookingSnap = await transaction.get(candidateBookingRef);
        const serviceSnap = await transaction.get(adminDb.collection('services').doc(serviceId));

        const vouchersByPromoCodeSnap = effectivePromoCode
          ? await transaction.get(adminDb.collection('vouchers').where('code', '==', effectivePromoCode))
          : null;
        const generalPromoDocSnap =
          generalPromoId && isValidDocId(generalPromoId, 128)
            ? await transaction.get(adminDb.collection('vouchers').doc(generalPromoId))
            : null;

        const personalCvRef =
          personalCvId && isValidDocId(personalCvId, 128)
            ? adminDb.collection('customer_vouchers').doc(personalCvId)
            : null;
        const personalCvSnap = personalCvRef ? await transaction.get(personalCvRef) : null;
        const cvDataRaw = personalCvSnap && snapExists(personalCvSnap) ? personalCvSnap.data() || {} : null;
        const cvMasterId =
          cvDataRaw && typeof cvDataRaw.voucherId === 'string' && isValidDocId(cvDataRaw.voucherId.trim(), 128)
            ? cvDataRaw.voucherId.trim()
            : '';
        const cvMasterDocSnap = cvMasterId
          ? await transaction.get(adminDb.collection('vouchers').doc(cvMasterId))
          : null;

        const custByAuthUserSnap = await transaction.get(
          adminDb.collection('customers').where('authUserId', '==', verifiedUid)
        );
        const custByCanonicalSnap = await transaction.get(
          adminDb.collection('customers').where('customerAuthUid', '==', verifiedUid)
        );

        const reqCustomerId =
          typeof req.body?.customerId === 'string' && isValidDocId(req.body.customerId.trim(), 128)
            ? req.body.customerId.trim()
            : '';
        const reqCustomerDocSnap = reqCustomerId
          ? await transaction.get(adminDb.collection('customers').doc(reqCustomerId))
          : null;

        const phoneDerivedCustId = `cust_${bookingPhoneDigits}`;

        const ownedCustomerDocsMap = new Map<string, any>();
        for (const d of [...(custByAuthUserSnap?.docs || []), ...(custByCanonicalSnap?.docs || [])]) {
          if (snapExists(d)) ownedCustomerDocsMap.set(d.id, d);
        }

        const candidateLoyaltyCustomerIds = new Set<string>([verifiedUid]);
        for (const cid of ownedCustomerDocsMap.keys()) {
          if (isValidDocId(cid, 128)) candidateLoyaltyCustomerIds.add(cid);
        }

        const loyaltyAccountSnaps = new Map<string, any>();
        for (const cid of candidateLoyaltyCustomerIds) {
          const laSnap = await transaction.get(adminDb.collection('loyalty_accounts').doc(cid));
          if (snapExists(laSnap)) {
            loyaltyAccountSnaps.set(cid, laSnap);
          }
        }

        const loyaltyTxId = `ltx_redeem_${candidateBookingId}`;
        const loyaltyTxRef = adminDb.collection('loyalty_transactions').doc(loyaltyTxId);
        const loyaltyTxSnap = requestedPoints > 0 ? await transaction.get(loyaltyTxRef) : null;

        const loyaltySettingsSnap = await transaction.get(
          adminDb.collection('loyalty_settings').doc('general')
        );
        const bookingNotificationSettingsSnap = await transaction.get(
          adminDb.collection('notification_settings').doc('default')
        );

        const candidateTierIds = new Set<string>(['member']);
        for (const laSnap of loyaltyAccountSnaps.values()) {
          const tId = laSnap.data()?.currentTierId;
          if (typeof tId === 'string' && isValidDocId(tId.trim().toLowerCase(), 64)) {
            candidateTierIds.add(tId.trim().toLowerCase());
          }
        }
        if (typeof req.body?.membershipTierAtBooking === 'string') {
          const bt = req.body.membershipTierAtBooking.trim().toLowerCase();
          if (isValidDocId(bt, 64)) candidateTierIds.add(bt);
        }
        const membershipTierSnaps = new Map<string, any>();
        for (const tId of candidateTierIds) {
          const tSnap = await transaction.get(adminDb.collection('membership_tiers').doc(tId));
          if (snapExists(tSnap)) {
            membershipTierSnaps.set(tId, tSnap);
          }
        }

        // Collect all candidate voucher codes & master IDs that may be redeemed so we can read their locks & ledgers upfront
        const candidateVoucherCodes = new Set<string>();
        const candidateMasterIds = new Set<string>();
        if (effectivePromoCode) candidateVoucherCodes.add(effectivePromoCode);
        if (rawReqVoucherCode) candidateVoucherCodes.add(rawReqVoucherCode);
        if (generalPromoId) candidateMasterIds.add(generalPromoId);
        if (vouchersByPromoCodeSnap?.docs?.length === 1) {
          candidateMasterIds.add(vouchersByPromoCodeSnap.docs[0].id);
          const vCode = vouchersByPromoCodeSnap.docs[0].data()?.code;
          if (typeof vCode === 'string' && vCode.trim()) candidateVoucherCodes.add(vCode.trim().toUpperCase());
        }
        if (generalPromoDocSnap && snapExists(generalPromoDocSnap)) {
          candidateMasterIds.add(generalPromoDocSnap.id);
          const gpCode = generalPromoDocSnap.data()?.code;
          if (typeof gpCode === 'string' && gpCode.trim()) candidateVoucherCodes.add(gpCode.trim().toUpperCase());
        }
        if (cvDataRaw && typeof cvDataRaw.voucherCode === 'string' && cvDataRaw.voucherCode.trim()) {
          candidateVoucherCodes.add(cvDataRaw.voucherCode.trim().toUpperCase());
        }
        if (cvMasterDocSnap && snapExists(cvMasterDocSnap)) {
          candidateMasterIds.add(cvMasterDocSnap.id);
          const cvMCode = cvMasterDocSnap.data()?.code;
          if (typeof cvMCode === 'string' && cvMCode.trim()) candidateVoucherCodes.add(cvMCode.trim().toUpperCase());
        }

        const redemptionSnapsByCode = new Map<string, any>();
        const redemptionReceiptSnapsByCode = new Map<string, any>();
        const uidLockRefsByCode = new Map<string, any>();
        const uidLockSnapsByCode = new Map<string, any>();
        const custLockRefsByCode = new Map<string, Map<string, any>>();
        const custLockSnapsByCode = new Map<string, Map<string, any>>();
        const phoneLockRefsByCode = new Map<string, any>();
        const phoneLockSnapsByCode = new Map<string, any>();
        const redemptionsByCodeSnaps = new Map<string, any>();

        for (const vCode of candidateVoucherCodes) {
          if (!/^[A-Z0-9_-]{1,64}$/.test(vCode)) continue;
          const redId = `vred_${vCode}_${candidateBookingId}`;
          redemptionSnapsByCode.set(
            vCode,
            await transaction.get(adminDb.collection('voucher_redemptions').doc(redId))
          );
          redemptionReceiptSnapsByCode.set(
            vCode,
            await transaction.get(adminDb.collection('voucher_redemption_receipts').doc(redId))
          );

          const uRef = adminDb.collection('voucher_redemptions').doc(`vlock_${vCode}_uid_${verifiedUid}`);
          uidLockRefsByCode.set(vCode, uRef);
          uidLockSnapsByCode.set(vCode, await transaction.get(uRef));

          const cRefs = new Map<string, any>();
          const cSnaps = new Map<string, any>();
          for (const cid of candidateLoyaltyCustomerIds) {
            const cRef = adminDb.collection('voucher_redemptions').doc(`vlock_${vCode}_cust_${cid}`);
            cRefs.set(cid, cRef);
            cSnaps.set(cid, await transaction.get(cRef));
          }
          custLockRefsByCode.set(vCode, cRefs);
          custLockSnapsByCode.set(vCode, cSnaps);

          const pRef = adminDb.collection('voucher_redemptions').doc(`vlock_${vCode}_phone_${bookingPhoneDigits}`);
          phoneLockRefsByCode.set(vCode, pRef);
          phoneLockSnapsByCode.set(vCode, await transaction.get(pRef));

          redemptionsByCodeSnaps.set(
            vCode,
            await transaction.get(adminDb.collection('voucher_redemptions').where('voucherCode', '==', vCode))
          );
        }

        const redemptionsByMasterIdSnaps = new Map<string, any>();
        for (const mId of candidateMasterIds) {
          if (!isValidDocId(mId, 128)) continue;
          redemptionsByMasterIdSnaps.set(
            mId,
            await transaction.get(adminDb.collection('voucher_redemptions').where('voucherId', '==', mId))
          );
        }

        const bookingsByCanonicalSnap = await transaction.get(
          adminDb.collection('bookings').where('customerAuthUid', '==', verifiedUid)
        );
        const bookingsByLegacySnap = await transaction.get(
          adminDb.collection('bookings').where('authUserId', '==', verifiedUid)
        );
        const bookingsByCustIdSnaps = new Map<string, any>();
        for (const cid of ownedCustomerDocsMap.keys()) {
          if (isValidDocId(cid, 128)) {
            bookingsByCustIdSnaps.set(
              cid,
              await transaction.get(adminDb.collection('bookings').where('customerId', '==', cid))
            );
          }
        }

        // --- PHASE 3: PURE VALIDATION & DISCOUNT RECALCULATION (ZERO READS AFTER THIS POINT) ---
        if (snapExists(candidateBookingSnap)) {
          return {
            status: 409,
            code: 'BOOKING_ID_COLLISION',
            error: 'ID pesanan untuk percobaan checkout ini sudah ada tanpa bukti checkout yang valid.',
          };
        }

        // 3A. Customer Profile Ownership & Conflict Validation
        if (ownedCustomerDocsMap.size > 1) {
          return {
            status: 409,
            code: 'CUSTOMER_OWNERSHIP_CONFLICT',
            error: 'Kepemilikan profil pelanggan ambigu dan memerlukan peninjauan.',
          };
        }

        let verifiedCustomerId = '';
        let verifiedCustomerData: any = null;

        if (ownedCustomerDocsMap.size === 1) {
          const [cid, cSnap] = [...ownedCustomerDocsMap.entries()][0];
          const cData = cSnap.data() || {};
          if (
            (cData.authUserId !== undefined && cData.authUserId !== null && cData.authUserId !== '' && cData.authUserId !== verifiedUid) ||
            (cData.customerAuthUid !== undefined && cData.customerAuthUid !== null && cData.customerAuthUid !== '' && cData.customerAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              error: 'Akses ditolak. Kepemilikan akun pelanggan tidak konsisten.',
            };
          }
          if (reqCustomerId && reqCustomerId !== cid && reqCustomerId !== cData.id) {
            // If caller passed a customerId that belongs to a foreign account in customers, deny; if it's just phone-derived cust_*, use verifiedCustomerId
            if (reqCustomerDocSnap && snapExists(reqCustomerDocSnap)) {
              const rcData = reqCustomerDocSnap.data() || {};
              if (
                (rcData.authUserId && rcData.authUserId !== verifiedUid) ||
                (rcData.customerAuthUid && rcData.customerAuthUid !== verifiedUid)
              ) {
                return {
                  status: 403,
                  code: 'CUSTOMER_OWNERSHIP_DENIED',
                  error: 'Akses ditolak. Profil pelanggan dimiliki oleh akun lain.',
                };
              }
            }
            if (reqCustomerId !== phoneDerivedCustId) {
              return {
                status: 403,
                code: 'CUSTOMER_OWNERSHIP_CONFLICT',
                error: 'Akses ditolak. Identitas pelanggan pesanan tidak sesuai dengan profil akun.',
              };
            }
          }
          verifiedCustomerId = cid;
          verifiedCustomerData = cData;
        } else if (reqCustomerDocSnap && snapExists(reqCustomerDocSnap)) {
          const bcData = reqCustomerDocSnap.data() || {};
          const bcAuthUid = bcData.authUserId;
          const bcCustAuthUid = bcData.customerAuthUid;
          if (
            (bcAuthUid !== undefined && bcAuthUid !== null && bcAuthUid !== '' && bcAuthUid !== verifiedUid) ||
            (bcCustAuthUid !== undefined && bcCustAuthUid !== null && bcCustAuthUid !== '' && bcCustAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_DENIED',
              error: 'Akses ditolak. Profil pelanggan pesanan dimiliki oleh akun lain.',
            };
          }
          if (bcAuthUid === verifiedUid || bcCustAuthUid === verifiedUid) {
            verifiedCustomerId = reqCustomerDocSnap.id;
            verifiedCustomerData = bcData;
          }
        }

        const effectiveCustomerId = verifiedCustomerId || verifiedUid;

        // 3B. Service Catalog & Price/Duration Authority
        if (!serviceSnap || !snapExists(serviceSnap)) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Layanan pesanan tidak ditemukan dalam katalog resmi.',
          };
        }
        const serviceData = serviceSnap.data() || {};
        const authoritativeServicePrice = serviceData.price;
        if (!isFinitePositiveNumber(authoritativeServicePrice)) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Harga layanan resmi tidak dapat diverifikasi.',
          };
        }
        if (
          req.body?.servicePrice !== undefined &&
          req.body?.servicePrice !== null &&
          req.body.servicePrice !== authoritativeServicePrice
        ) {
          return {
            status: 409,
            code: 'PRICE_MISMATCH',
            error: 'Harga layanan pada pesanan berbeda dari katalog resmi. Total pembayaran telah diperbarui.',
          };
        }
        if (
          req.body?.serviceDuration !== undefined &&
          req.body?.serviceDuration !== null &&
          isFinitePositiveNumber(serviceData.duration) &&
          req.body.serviceDuration !== serviceData.duration
        ) {
          return {
            status: 409,
            code: 'PRICE_MISMATCH',
            error: 'Durasi layanan pada pesanan tidak konsisten dengan katalog resmi.',
          };
        }

        // 3C. Resolve Loyalty Settings & Customer Membership Tier
        const rawLoyaltySettings =
          loyaltySettingsSnap && snapExists(loyaltySettingsSnap) ? loyaltySettingsSnap.data() || {} : {};
        if (
          rawLoyaltySettings.allowStacking !== undefined &&
          typeof rawLoyaltySettings.allowStacking !== 'boolean'
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Konfigurasi penggabungan voucher tidak valid.',
          };
        }
        const loyaltySettings = {
          ...DEFAULT_LOYALTY_SETTINGS,
          ...rawLoyaltySettings,
        };
        if (!pointsOnlyCheckout && loyaltySettings.voucherEnabled === false) {
          return {
            status: 409,
            code: 'VOUCHER_DISABLED',
            error: 'Fitur penukaran voucher sedang dinonaktifkan.',
          };
        }

        const resolveOwnedLoyaltySnap = () => {
          const matches: any[] = [];
          for (const cid of new Set([verifiedCustomerId, verifiedUid].filter(Boolean))) {
            const snap = loyaltyAccountSnaps.get(cid);
            if (!snap || !snapExists(snap)) continue;
            const account = snap.data() || {};
            const owners = [account.customerAuthUid, account.authUserId];
            const consistent = owners.every(value => value === undefined || value === null || value === '' || value === verifiedUid);
            const linkedProfile = Boolean(verifiedCustomerId && cid === verifiedCustomerId
              && (!account.customerId || account.customerId === verifiedCustomerId));
            const directUid = cid === verifiedUid && account.customerId === verifiedUid;
            if (!consistent || (!linkedProfile && !directUid)) {
              throw Object.assign(new Error('Kepemilikan akun loyalitas memerlukan peninjauan.'), { code: 'LOYALTY_OWNERSHIP_CONFLICT' });
            }
            matches.push(snap);
          }
          if (matches.length > 1) {
            throw Object.assign(new Error('Terdapat beberapa akun loyalitas untuk identitas yang sama.'), { code: 'LOYALTY_OWNERSHIP_CONFLICT' });
          }
          return matches[0] || null;
        };

        const verifiedLoyaltySnap = resolveOwnedLoyaltySnap();
        const verifiedLoyaltyData = verifiedLoyaltySnap ? verifiedLoyaltySnap.data() || {} : null;

        let resolvedTierId = 'member';
        if (verifiedLoyaltyData) {
          if (verifiedLoyaltyData.status === 'suspended' || verifiedLoyaltyData.status === 'closed') {
            return {
              status: 403,
              code: 'LOYALTY_ACCOUNT_INACTIVE',
              error: 'Akun loyalitas pelanggan sedang tidak aktif.',
            };
          }
          if (typeof verifiedLoyaltyData.currentTierId === 'string' && verifiedLoyaltyData.currentTierId.trim()) {
            resolvedTierId = verifiedLoyaltyData.currentTierId.trim().toLowerCase();
          }
        }

        const tierSnapFromDb = membershipTierSnaps.get(resolvedTierId);
        const resolvedTier: any = tierSnapFromDb
          ? tierSnapFromDb.data()
          : DEFAULT_MEMBERSHIP_TIERS.find((t) => t.id.toLowerCase() === resolvedTierId) || null;

        if (
          !resolvedTier ||
          !isFiniteNonNegativeNumber(resolvedTier.discountPercentage) ||
          resolvedTier.discountPercentage > 100
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Data tier keanggotaan pelanggan tidak dapat diverifikasi.',
          };
        }

        if (
          req.body?.membershipTierAtBooking !== undefined &&
          req.body?.membershipTierAtBooking !== null &&
          String(req.body.membershipTierAtBooking).trim() !== ''
        ) {
          const bookingTierNorm = String(req.body.membershipTierAtBooking).trim().toLowerCase();
          const tierIdNorm = String(resolvedTier.id || '').trim().toLowerCase();
          const tierNameNorm = String(resolvedTier.name || '').trim().toLowerCase();
          if (bookingTierNorm !== tierIdNorm && bookingTierNorm !== tierNameNorm) {
            return {
              status: 409,
              code: 'PRICE_MISMATCH',
              error: 'Tier keanggotaan pada saat pemesanan berbeda dari profil resmi.',
            };
          }
        }

        const currentPtsBalance = verifiedLoyaltyData?.pointsBalance ?? verifiedLoyaltyData?.currentPointsBalance ?? 0;
        if (requestedPoints > 0) {
          if (loyaltySettings.loyaltyEnabled === false) {
            return {
              status: 409,
              code: 'POINTS_REDEMPTION_DISABLED',
              error: 'Fitur penukaran poin sedang dinonaktifkan.',
            };
          }
          const minPts = loyaltySettings.minimumPointsToRedeem || 50;
          if (requestedPoints < minPts) {
            return {
              status: 409,
              code: 'INSUFFICIENT_POINTS',
              error: `Minimal penukaran poin adalah ${minPts} Poin.`,
            };
          }
          if (!verifiedLoyaltySnap || !isFiniteNonNegativeInt(currentPtsBalance) || currentPtsBalance < requestedPoints) {
            return {
              status: 409,
              code: 'INSUFFICIENT_POINTS_BALANCE',
              error: 'Saldo Senzu Points Anda tidak mencukupi untuk jumlah penukaran ini.',
            };
          }
          const lifetimeRedeemedCheck = verifiedLoyaltyData?.lifetimePointsRedeemed ?? 0;
          if (!isFiniteNonNegativeInt(lifetimeRedeemedCheck)) {
            return {
              status: 409,
              code: 'LOYALTY_ACCOUNT_INVALID',
              error: 'Data riwayat penukaran poin pelanggan tidak valid.',
            };
          }
          if (loyaltyTxSnap && snapExists(loyaltyTxSnap)) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Catatan transaksi poin untuk pesanan ini sudah ada dan memerlukan peninjauan.',
            };
          }
        }

        // 3D. Resolve Personal CustomerVoucher (cv_) and General Promo Master Voucher
        const normalizeSupportedVoucherType = (
          vType: unknown
        ): 'fixed_discount' | 'percentage_discount' | 'free_home_service_fee' | null => {
          if (vType === 'fixed_discount' || vType === 'FIXED_AMOUNT') return 'fixed_discount';
          if (vType === 'percentage_discount' || vType === 'percentage' || vType === 'PERCENTAGE')
            return 'percentage_discount';
          if (vType === 'free_home_service_fee') return 'free_home_service_fee';
          return null;
        };

        const validateVoucherNumbers = (vObj: any): {
          ok: boolean;
          normalizedType?: 'fixed_discount' | 'percentage_discount' | 'free_home_service_fee';
          code?: string;
          error?: string;
        } => {
          const normType = normalizeSupportedVoucherType(vObj?.voucherType);
          if (!normType) {
            return {
              ok: false,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Tipe voucher tidak mendukung perhitungan potongan otomatis.',
            };
          }
          if (normType === 'fixed_discount') {
            if (!isFinitePositiveNumber(vObj.value)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Nilai potongan voucher tidak valid.' };
            }
          } else if (normType === 'percentage_discount') {
            if (!isFinitePositiveNumber(vObj.value) || vObj.value > 100) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Persentase potongan voucher tidak valid.' };
            }
            if (vObj.maximumDiscount !== undefined && vObj.maximumDiscount !== null && !isFinitePositiveNumber(vObj.maximumDiscount)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas maksimum potongan voucher tidak valid.' };
            }
          } else if (normType === 'free_home_service_fee') {
            if (vObj.value !== undefined && vObj.value !== null && !isFiniteNonNegativeNumber(vObj.value)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Nilai voucher ongkir tidak valid.' };
            }
          }

          if (vObj.minimumSpend !== undefined && vObj.minimumSpend !== null && !isFiniteNonNegativeNumber(vObj.minimumSpend)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas minimum transaksi voucher tidak valid.' };
          }
          if (vObj.minimumTreatmentPrice !== undefined && vObj.minimumTreatmentPrice !== null && !isFiniteNonNegativeNumber(vObj.minimumTreatmentPrice)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas harga minimum layanan tidak valid.' };
          }
          if (vObj.minimumTreatmentDuration !== undefined && vObj.minimumTreatmentDuration !== null && !isFiniteNonNegativeNumber(vObj.minimumTreatmentDuration)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas durasi minimum layanan tidak valid.' };
          }
          return { ok: true, normalizedType: normType };
        };

        let resolvedPersonalCv: any = null;
        let resolvedPersonalCvMaster: any = null;
        let resolvedPersonalCvMasterRef: any = null;
        let resolvedPersonalCvCode = '';

        if (personalCvId) {
          if (!personalCvSnap || !snapExists(personalCvSnap)) {
            return {
              status: 404,
              code: 'CUSTOMER_VOUCHER_NOT_FOUND',
              error: 'Voucher personal pelanggan tidak ditemukan.',
            };
          }
          const cvData = personalCvSnap.data() || {};
          if (
            (cvData.authUserId !== undefined && cvData.authUserId !== null && cvData.authUserId !== '' && cvData.authUserId !== verifiedUid) ||
            (cvData.customerAuthUid !== undefined && cvData.customerAuthUid !== null && cvData.customerAuthUid !== '' && cvData.customerAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_VOUCHER_OWNERSHIP_DENIED',
              error: 'Voucher personal ini bukan milik akun Anda.',
            };
          }

          const cvOwnerCustomerId = typeof cvData.customerId === 'string' ? cvData.customerId.trim() : '';
          if (
            !cvOwnerCustomerId ||
            (cvOwnerCustomerId !== verifiedUid && (!verifiedCustomerId || cvOwnerCustomerId !== verifiedCustomerId))
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_VOUCHER_OWNERSHIP_DENIED',
              error: 'Kepemilikan voucher personal tidak sesuai dengan akun Anda.',
            };
          }

          if (!cvMasterId || !cvMasterDocSnap || !snapExists(cvMasterDocSnap)) {
            return {
              status: 404,
              code: 'VOUCHER_NOT_FOUND',
              error: 'Master voucher untuk voucher personal tidak ditemukan.',
            };
          }

          resolvedPersonalCvMaster = cvMasterDocSnap.data() || {};
          resolvedPersonalCvMasterRef = cvMasterDocSnap.ref;
          const cvMasterCode =
            typeof resolvedPersonalCvMaster.code === 'string'
              ? resolvedPersonalCvMaster.code.trim().toUpperCase()
              : '';
          const cvDocCode =
            typeof cvData.voucherCode === 'string' ? cvData.voucherCode.trim().toUpperCase() : '';

          if (cvDocCode && cvMasterCode && cvDocCode !== cvMasterCode) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Kode voucher personal tidak sesuai dengan master voucher.',
            };
          }
          resolvedPersonalCvCode = cvDocCode || cvMasterCode;
          if (!resolvedPersonalCvCode) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Kode master voucher untuk voucher personal tidak ditemukan.',
            };
          }

          if (
            rawReqVoucherCode &&
            rawReqVoucherCode !== resolvedPersonalCvCode &&
            rawReqVoucherCode !== effectivePromoCode
          ) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Kode voucher pada pesanan tidak sesuai dengan voucher personal.',
            };
          }

          if (
            (cvData.voucherType && resolvedPersonalCvMaster.voucherType && cvData.voucherType !== resolvedPersonalCvMaster.voucherType) ||
            (cvData.value !== undefined && resolvedPersonalCvMaster.value !== undefined && cvData.value !== resolvedPersonalCvMaster.value)
          ) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Nilai voucher personal tidak konsisten dengan master voucher.',
            };
          }

          if (cvData.bookingId !== undefined && cvData.bookingId !== null && cvData.bookingId !== '' && cvData.bookingId !== candidateBookingId) {
            return {
              status: 409,
              code: 'CUSTOMER_VOUCHER_ALREADY_USED',
              error: 'Voucher personal ini sudah digunakan pada pesanan lain.',
            };
          }

          if (cvData.status === 'used') {
            return {
              status: 409,
              code: 'CUSTOMER_VOUCHER_ALREADY_USED',
              error: 'Voucher personal sudah pernah digunakan.',
            };
          }
          if (cvData.status !== 'available' && cvData.status !== 'reserved') {
            return {
              status: 409,
              code: 'CUSTOMER_VOUCHER_INELIGIBLE',
              error: 'Status voucher personal tidak dapat digunakan.',
            };
          }

          const cvExpiryStr = cvData.expiredAt || cvData.expiresAt;
          if (cvExpiryStr !== undefined && cvExpiryStr !== null && cvExpiryStr !== '') {
            if (typeof cvExpiryStr !== 'string' || Number.isNaN(Date.parse(cvExpiryStr)) || cvExpiryStr < nowIso) {
              return {
                status: 409,
                code: 'VOUCHER_EXPIRED',
                error: 'Voucher personal sudah kedaluwarsa.',
              };
            }
          }

          resolvedPersonalCv = {
            ...cvData,
            id: personalCvSnap.id,
            voucherId: cvMasterDocSnap.id,
            voucherCode: resolvedPersonalCvCode,
          };
        }

        let resolvedGeneralPromoMaster: any = null;
        let resolvedGeneralPromoMasterRef: any = null;
        let resolvedGeneralPromoId = '';
        let resolvedGeneralPromoCode = '';

        const hasGeneralPromoIntent =
          Boolean(generalPromoId) ||
          Boolean(effectivePromoCode && (!personalCvId || effectivePromoCode !== resolvedPersonalCvCode || Boolean(rawReqPromoCode)));

        if (hasGeneralPromoIntent) {
          if (vouchersByPromoCodeSnap && (vouchersByPromoCodeSnap.docs || []).length > 1) {
            return {
              status: 409,
              code: 'AMBIGUOUS_VOUCHER_CODE',
              error: 'Kode voucher duplikat ditemukan di katalog master.',
            };
          }

          let gpSnap: any = null;
          if (generalPromoId) {
            if (!generalPromoDocSnap || !snapExists(generalPromoDocSnap)) {
              return {
                status: 404,
                code: 'VOUCHER_NOT_FOUND',
                error: 'Referensi promo pada pesanan tidak ditemukan di katalog master.',
              };
            }
            gpSnap = generalPromoDocSnap;
            if (
              vouchersByPromoCodeSnap &&
              (vouchersByPromoCodeSnap.docs || []).length === 1 &&
              vouchersByPromoCodeSnap.docs[0].id !== gpSnap.id
            ) {
              return {
                status: 409,
                code: 'VOUCHER_LINKAGE_CONFLICT',
                error: 'Kode promo pada pesanan tidak sesuai dengan ID promo master.',
              };
            }
          } else if (vouchersByPromoCodeSnap && (vouchersByPromoCodeSnap.docs || []).length === 1) {
            gpSnap = vouchersByPromoCodeSnap.docs[0];
          } else {
            return {
              status: 404,
              code: 'VOUCHER_NOT_FOUND',
              error: 'Kode voucher tidak ditemukan dalam katalog resmi.',
            };
          }

          const gpData = gpSnap.data() || {};
          const gpCode = typeof gpData.code === 'string' ? gpData.code.trim().toUpperCase() : '';
          if (
            !isValidDocId(gpSnap.id, 128) ||
            (gpData.id !== undefined && gpData.id !== gpSnap.id) ||
            !gpCode ||
            (effectivePromoCode && gpCode !== effectivePromoCode)
          ) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Data master voucher tidak konsisten dengan kode voucher.',
            };
          }

          resolvedGeneralPromoMaster = { ...gpData, id: gpSnap.id, code: gpCode };
          resolvedGeneralPromoMasterRef = gpSnap.ref;
          resolvedGeneralPromoId = gpSnap.id;
          resolvedGeneralPromoCode = gpCode;
        }

        if (!resolvedGeneralPromoMaster && !resolvedPersonalCv && !pointsOnlyCheckout) {
          return {
            status: 409,
            code: 'VOUCHER_BOOKING_MISMATCH',
            error: 'Pesanan ini tidak memiliki voucher valid yang dapat diproses.',
          };
        }

        if (resolvedGeneralPromoMaster && resolvedPersonalCv) {
          if (loyaltySettings.allowStacking && (resolvedGeneralPromoId === cvMasterId || resolvedGeneralPromoCode === resolvedPersonalCvCode)) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Tidak dapat menggabungkan kode promo dan voucher personal dari kampanye yang sama.',
            };
          }
        }

        // Validate numeric configuration of active vouchers
        if (resolvedGeneralPromoMaster) {
          const gpCheck = validateVoucherNumbers(resolvedGeneralPromoMaster);
          if (!gpCheck.ok) return { status: 409, code: gpCheck.code, error: gpCheck.error };
          if (
            req.body?.discountTypeSnapshot !== undefined &&
            req.body?.discountTypeSnapshot !== null &&
            req.body?.discountTypeSnapshot !== '' &&
            normalizeSupportedVoucherType(req.body.discountTypeSnapshot) !== gpCheck.normalizedType
          ) {
            return {
              status: 409,
              code: 'DISCOUNT_MISMATCH',
              error: 'Tipe diskon promo pada form tidak sesuai dengan katalog resmi.',
            };
          }
          if (
            req.body?.discountValueSnapshot !== undefined &&
            req.body?.discountValueSnapshot !== null &&
            Number(req.body.discountValueSnapshot) !== resolvedGeneralPromoMaster.value
          ) {
            return {
              status: 409,
              code: 'DISCOUNT_MISMATCH',
              error: 'Nilai diskon promo pada form tidak sesuai dengan katalog resmi.',
            };
          }
        }
        if (resolvedPersonalCv) {
          const cvCheck = validateVoucherNumbers(resolvedPersonalCv);
          if (!cvCheck.ok) return { status: 409, code: cvCheck.code, error: cvCheck.error };
          const cvMasterCheck = validateVoucherNumbers(resolvedPersonalCvMaster);
          if (!cvMasterCheck.ok) return { status: 409, code: cvMasterCheck.code, error: cvMasterCheck.error };
        }

        // 3E. Establish Distance & Home Service Fee Safely
        const needsVerifiedHomeServiceFee =
          normalizeSupportedVoucherType(resolvedGeneralPromoMaster?.voucherType) === 'free_home_service_fee' ||
          normalizeSupportedVoucherType(resolvedPersonalCv?.voucherType) === 'free_home_service_fee';

        const minStraightKm = calculateStraightDistanceKm(
          SENZU_BASE_LOCATION.lat,
          SENZU_BASE_LOCATION.lng,
          latitude,
          longitude
        );
        const rawDistKm =
          typeof req.body?.distanceKm === 'number' && Number.isFinite(req.body.distanceKm)
            ? req.body.distanceKm
            : 0;

        if (needsVerifiedHomeServiceFee) {
          if (
            rawDistKm < 0 ||
            rawDistKm < minStraightKm * 0.95 ||
            (minStraightKm > 0.2 && rawDistKm === 0)
          ) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Jarak lokasi pesanan tidak dapat diverifikasi untuk potongan biaya home service.',
            };
          }
          const feeFromDist = calculateHomeServiceFee(rawDistKm).fee;
          const feeFromStraight = calculateHomeServiceFee(minStraightKm).fee;
          if (!isFinitePositiveNumber(feeFromDist) || feeFromStraight !== feeFromDist) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Nominal biaya home service memerlukan peninjauan.',
            };
          }
        }

        const finalDistanceKm =
          rawDistKm <= 0 || rawDistKm < minStraightKm * 0.95 ? minStraightKm : rawDistKm;
        if (minStraightKm > 0.2 && finalDistanceKm === 0) {
          return {
            status: 400,
            code: 'INVALID_DISTANCE',
            error: 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda.',
          };
        }
        const finalDistanceMeters =
          typeof req.body?.distanceMeters === 'number' &&
          Number.isFinite(req.body.distanceMeters) &&
          req.body.distanceMeters >= Math.round(minStraightKm * 950)
            ? Math.round(req.body.distanceMeters)
            : Math.round(finalDistanceKm * 1000);

        const authoritativeFeeCalc = calculateHomeServiceFee(finalDistanceKm);
        const authoritativeHomeServiceFee = authoritativeFeeCalc.fee;
        const authoritativeHomeServiceTier = authoritativeFeeCalc.tier;

        if (
          req.body?.homeServiceFee !== undefined &&
          req.body?.homeServiceFee !== null &&
          Number(req.body.homeServiceFee) !== authoritativeHomeServiceFee
        ) {
          return {
            status: 409,
            code: 'HOME_SERVICE_FEE_MISMATCH',
            error: 'Biaya home service pada form tidak sesuai dengan perhitungan jarak resmi.',
          };
        }

        // 3F. Compute Authoritative Pricing Breakdown via calculateBookingPrice
        const promoForCalc = resolvedGeneralPromoMaster
          ? {
              ...resolvedGeneralPromoMaster,
              minimumSpend: Math.max(
                resolvedGeneralPromoMaster.minimumSpend || 0,
                resolvedGeneralPromoMaster.minimumTreatmentPrice || 0
              ),
              enabled: true,
            }
          : null;

        const cvForCalc = resolvedPersonalCv
          ? {
              ...resolvedPersonalCv,
              voucherType: normalizeSupportedVoucherType(resolvedPersonalCv.voucherType) || resolvedPersonalCv.voucherType,
              minimumSpend: Math.max(
                resolvedPersonalCv.minimumSpend || 0,
                resolvedPersonalCvMaster?.minimumSpend || 0,
                resolvedPersonalCvMaster?.minimumTreatmentPrice || 0
              ),
              maximumDiscount: resolvedPersonalCv.maximumDiscount ?? resolvedPersonalCvMaster?.maximumDiscount,
              status: 'available' as const,
            }
          : null;

        const pricingBreakdown = calculateBookingPrice({
          servicePrice: authoritativeServicePrice,
          homeServiceFee: authoritativeHomeServiceFee,
          promoVoucher: promoForCalc,
          customerVoucher: cvForCalc,
          pointsToRedeem: requestedPoints,
          customerTier: resolvedTier,
          settings: loyaltySettings,
        });

        if (
          promoForCalc &&
          cvForCalc &&
          loyaltySettings.allowStacking &&
          pricingBreakdown.promoDiscountAmount + pricingBreakdown.voucherDiscountAmount >
            pricingBreakdown.totalPromoAndVoucherDiscount
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Kombinasi diskon melebihi nilai pesanan dan memerlukan peninjauan.',
          };
        }

        // Build list of voucher targets to validate & redeem in this transaction
        const voucherTargets: Array<{
          kind: 'general' | 'personal';
          code: string;
          masterId: string;
          masterRef: any;
          masterData: any;
          personalCv: any | null;
          discountAmount: number;
          currentUsageCount: number;
          canWritePhoneLock: boolean;
        }> = [];

        if (resolvedGeneralPromoMaster && pricingBreakdown.promoDiscountAmount > 0) {
          const disc = resolvedPersonalCv
            ? pricingBreakdown.promoDiscountAmount
            : Math.min(pricingBreakdown.promoDiscountAmount, pricingBreakdown.totalPromoAndVoucherDiscount);
          voucherTargets.push({
            kind: 'general',
            code: resolvedGeneralPromoCode,
            masterId: resolvedGeneralPromoId,
            masterRef: resolvedGeneralPromoMasterRef,
            masterData: resolvedGeneralPromoMaster,
            personalCv: null,
            discountAmount: disc,
            currentUsageCount: 0,
            canWritePhoneLock: false,
          });
        }

        if (resolvedPersonalCv && pricingBreakdown.voucherDiscountAmount > 0) {
          const disc = resolvedGeneralPromoMaster
            ? pricingBreakdown.voucherDiscountAmount
            : Math.min(pricingBreakdown.voucherDiscountAmount, pricingBreakdown.totalPromoAndVoucherDiscount);
          voucherTargets.push({
            kind: 'personal',
            code: resolvedPersonalCvCode,
            masterId: cvMasterId,
            masterRef: resolvedPersonalCvMasterRef,
            masterData: resolvedPersonalCvMaster,
            personalCv: resolvedPersonalCv,
            discountAmount: disc,
            currentUsageCount: 0,
            canWritePhoneLock: false,
          });
        }

        if (voucherTargets.length === 0 && !(pointsOnlyCheckout && pricingBreakdown.pointsRedeemed > 0)) {
          return { status: 409, code: 'VOUCHER_INELIGIBLE', error: 'Voucher tidak menghasilkan potongan untuk pesanan ini.' };
        }

        // Combine owned bookings for per-customer quota and first-order check
        const ownedBookingsMap = new Map<string, any>();
        for (const d of [
          ...(bookingsByCanonicalSnap?.docs || []),
          ...(bookingsByLegacySnap?.docs || []),
        ]) {
          if (!snapExists(d) || d.id === candidateBookingId) continue;
          const b = d.data() || {};
          if (b.customerAuthUid && b.authUserId && b.customerAuthUid !== b.authUserId) continue;
          if (b.customerAuthUid && b.customerAuthUid !== verifiedUid) continue;
          if (!b.customerAuthUid && b.authUserId !== verifiedUid) continue;
          ownedBookingsMap.set(d.id, b);
        }
        if (verifiedCustomerId && bookingsByCustIdSnaps.has(verifiedCustomerId)) {
          for (const d of bookingsByCustIdSnaps.get(verifiedCustomerId)?.docs || []) {
            if (!snapExists(d) || d.id === candidateBookingId || ownedBookingsMap.has(d.id)) continue;
            const b = d.data() || {};
            if (b.customerAuthUid && b.customerAuthUid !== verifiedUid) continue;
            if (b.authUserId && b.authUserId !== verifiedUid) continue;
            ownedBookingsMap.set(d.id, b);
          }
        }

        const priceAfterTier = Math.max(0, authoritativeServicePrice - pricingBreakdown.tierDiscountAmount);

        // 3G. Validate Eligibility, Quotas, Locks & First-Order for Each Target Voucher
        for (const target of voucherTargets) {
          const { code, masterId: targetMasterId, masterData: targetMasterData, personalCv } = target;

          if (!isFinitePositiveNumber(target.discountAmount)) {
            return {
              status: 409,
              code: 'VOUCHER_INELIGIBLE',
              error: 'Voucher tidak menghasilkan potongan yang valid pada pesanan ini.',
            };
          }

          if (
            snapExists(redemptionSnapsByCode.get(code)) ||
            snapExists(redemptionReceiptSnapsByCode.get(code))
          ) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Catatan penukaran untuk pesanan ini sudah ada dan memerlukan peninjauan.',
            };
          }

          if (targetMasterData.enabled !== true) {
            return {
              status: 409,
              code: 'VOUCHER_INACTIVE',
              error: 'Voucher sedang tidak aktif.',
            };
          }

          if (targetMasterData.validFrom !== undefined && targetMasterData.validFrom !== null && targetMasterData.validFrom !== '') {
            if (typeof targetMasterData.validFrom !== 'string' || Number.isNaN(Date.parse(targetMasterData.validFrom))) {
              return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Periode mulai voucher tidak valid.' };
            }
            if (targetMasterData.validFrom > nowIso) {
              return { status: 409, code: 'VOUCHER_NOT_YET_VALID', error: 'Periode promo belum dimulai.' };
            }
          }
          if (targetMasterData.validUntil !== undefined && targetMasterData.validUntil !== null && targetMasterData.validUntil !== '') {
            if (typeof targetMasterData.validUntil !== 'string' || Number.isNaN(Date.parse(targetMasterData.validUntil))) {
              return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Periode berakhir voucher tidak valid.' };
            }
            if (targetMasterData.validUntil < nowIso) {
              return { status: 409, code: 'VOUCHER_EXPIRED', error: 'Voucher sudah tidak berlaku.' };
            }
          }

          const minSpend = Math.max(
            targetMasterData.minimumSpend || 0,
            targetMasterData.minimumTreatmentPrice || 0,
            personalCv?.minimumSpend || 0
          );
          if (priceAfterTier < minSpend || authoritativeServicePrice < minSpend) {
            return {
              status: 409,
              code: 'VOUCHER_MINIMUM_SPEND_NOT_MET',
              error: `Minimum transaksi untuk promo ini adalah Rp ${minSpend.toLocaleString('id-ID')}.`,
            };
          }

          const checkServiceIds = (ids: unknown): boolean => {
            if (ids === undefined || ids === null) return true;
            if (!Array.isArray(ids)) return false;
            if (ids.length === 0) return true;
            return ids.includes(serviceId);
          };
          if (
            !checkServiceIds(targetMasterData.applicableServiceIds) ||
            (personalCv && !checkServiceIds(personalCv.applicableServiceIds))
          ) {
            return {
              status: 409,
              code: 'VOUCHER_SERVICE_INELIGIBLE',
              error: 'Promo tidak berlaku untuk layanan yang dipilih.',
            };
          }

          if (targetMasterData.applicableCategoryIds !== undefined && targetMasterData.applicableCategoryIds !== null) {
            if (!Array.isArray(targetMasterData.applicableCategoryIds)) {
              return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Konfigurasi kategori voucher tidak valid.' };
            }
            if (targetMasterData.applicableCategoryIds.length > 0) {
              const srvCatId = typeof serviceData.categoryId === 'string' ? serviceData.categoryId.trim() : '';
              const srvCatName = typeof serviceData.category === 'string' ? serviceData.category.trim() : '';
              if (
                (!srvCatId || !targetMasterData.applicableCategoryIds.includes(srvCatId)) &&
                (!srvCatName || !targetMasterData.applicableCategoryIds.includes(srvCatName))
              ) {
                return {
                  status: 409,
                  code: 'VOUCHER_CATEGORY_INELIGIBLE',
                  error: 'Promo tidak berlaku untuk kategori layanan ini.',
                };
              }
            }
          }

          if (isFinitePositiveNumber(targetMasterData.minimumTreatmentDuration)) {
            if (!isFinitePositiveNumber(serviceData.duration) || serviceData.duration < targetMasterData.minimumTreatmentDuration) {
              return {
                status: 409,
                code: 'VOUCHER_DURATION_INELIGIBLE',
                error: `Promo memerlukan durasi layanan minimal ${targetMasterData.minimumTreatmentDuration} menit.`,
              };
            }
          }

          const checkTierIds = (ids: unknown): boolean => {
            if (ids === undefined || ids === null) return true;
            if (!Array.isArray(ids)) return false;
            if (ids.length === 0) return true;
            const lowerIds = ids.map((x) => String(x).trim().toLowerCase());
            return (
              lowerIds.includes(String(resolvedTier.id || '').trim().toLowerCase()) ||
              lowerIds.includes(String(resolvedTier.name || '').trim().toLowerCase())
            );
          };
          if (
            !checkTierIds(targetMasterData.applicableTierIds) ||
            (personalCv && !checkTierIds(personalCv.applicableTierIds))
          ) {
            return {
              status: 409,
              code: 'VOUCHER_TIER_INELIGIBLE',
              error: 'Promo tidak berlaku untuk tier keanggotaan Anda.',
            };
          }

          if (
            targetMasterData.customerSpecific === true ||
            (targetMasterData.customerId !== undefined && targetMasterData.customerId !== null && targetMasterData.customerId !== '')
          ) {
            const targetCust = typeof targetMasterData.customerId === 'string' ? targetMasterData.customerId.trim() : '';
            if (!targetCust || (targetCust !== verifiedUid && (!verifiedCustomerId || targetCust !== verifiedCustomerId))) {
              return {
                status: 403,
                code: 'VOUCHER_CUSTOMER_INELIGIBLE',
                error: 'Voucher khusus ini tidak ditujukan untuk akun Anda.',
              };
            }
          }

          const rawCurrentUsage = targetMasterData.currentUsageCount ?? 0;
          if (!isFiniteNonNegativeInt(rawCurrentUsage)) {
            return {
              status: 409,
              code: 'VOUCHER_CONFIG_INVALID',
              error: 'Data penggunaan voucher tidak valid.',
            };
          }
          target.currentUsageCount = rawCurrentUsage;

          const rawLimitTotal = targetMasterData.usageLimitTotal ?? 0;
          if (!isFiniteNonNegativeInt(rawLimitTotal)) {
            return {
              status: 409,
              code: 'VOUCHER_CONFIG_INVALID',
              error: 'Batas kuota total voucher tidak valid.',
            };
          }
          const usageLimitTotal = rawLimitTotal;

          const rawLimitPerCustomer =
            targetMasterData.usageLimitPerCustomer !== undefined && targetMasterData.usageLimitPerCustomer !== null
              ? targetMasterData.usageLimitPerCustomer
              : code === 'SENZUWELCOME'
                ? 1
                : 0;
          if (!isFiniteNonNegativeInt(rawLimitPerCustomer)) {
            return {
              status: 409,
              code: 'VOUCHER_CONFIG_INVALID',
              error: 'Batas kuota per pelanggan tidak valid.',
            };
          }
          const usageLimitPerCustomer = rawLimitPerCustomer;

          const validateLockSnap = (
            lSnap: any,
            isPhoneLock = false
          ): { ok: boolean; activeOtherBookingId?: string; isSameBooking?: boolean; code?: string; error?: string } => {
            if (!lSnap || !snapExists(lSnap)) {
              return { ok: true, activeOtherBookingId: '', isSameBooking: false };
            }
            const lData = lSnap.data() || {};
            const lStatus = typeof lData.status === 'string' ? lData.status.trim().toLowerCase() : 'active';
            if (lStatus === 'cancelled' || lStatus === 'batal') {
              return { ok: true, activeOtherBookingId: '', isSameBooking: false };
            }

            const lCode = typeof lData.voucherCode === 'string' ? lData.voucherCode.trim().toUpperCase() : '';
            if (lCode && lCode !== code) {
              return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'Data reservasi voucher tidak konsisten.' };
            }

            const lUid = typeof lData.customerAuthUid === 'string' ? lData.customerAuthUid.trim() : '';
            const lBookingId = typeof lData.bookingId === 'string' ? lData.bookingId.trim() : '';

            if (!isPhoneLock) {
              if (lUid && lUid !== verifiedUid) {
                return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'Reservasi voucher bertentangan dengan pemilik akun.' };
              }
              return {
                ok: true,
                activeOtherBookingId: lBookingId || lSnap.id,
                isSameBooking: false,
              };
            }

            return {
              ok: true,
              activeOtherBookingId: lUid === verifiedUid ? lBookingId || lSnap.id : '',
              isSameBooking: false,
            };
          };

          const uidLockCheck = validateLockSnap(uidLockSnapsByCode.get(code), false);
          if (!uidLockCheck.ok) {
            return { status: 409, code: uidLockCheck.code, error: uidLockCheck.error };
          }

          const otherReservedBookingIds = new Set<string>();
          if (uidLockCheck.activeOtherBookingId) {
            otherReservedBookingIds.add(uidLockCheck.activeOtherBookingId);
          }

          const custSnapsForCode = custLockSnapsByCode.get(code);
          if (verifiedCustomerId && custSnapsForCode?.has(verifiedCustomerId)) {
            const custLockCheck = validateLockSnap(custSnapsForCode.get(verifiedCustomerId), false);
            if (!custLockCheck.ok) {
              return { status: 409, code: custLockCheck.code, error: custLockCheck.error };
            }
            if (custLockCheck.activeOtherBookingId) {
              otherReservedBookingIds.add(custLockCheck.activeOtherBookingId);
            }
          }

          const pLockSnap = phoneLockSnapsByCode.get(code);
          if (pLockSnap) {
            if (!snapExists(pLockSnap)) {
              target.canWritePhoneLock = true;
            } else {
              const pCheck = validateLockSnap(pLockSnap, true);
              if (!pCheck.ok) {
                return { status: 409, code: pCheck.code, error: pCheck.error };
              }
              if (pCheck.isSameBooking) {
                target.canWritePhoneLock = true;
              }
            }
          }

          const allRedemptionDocs = new Map<string, any>();
          for (const d of [
            ...(redemptionsByCodeSnaps.get(code)?.docs || []),
            ...(redemptionsByMasterIdSnaps.get(targetMasterId)?.docs || []),
          ]) {
            if (snapExists(d) && !d.id.startsWith('vlock_')) {
              allRedemptionDocs.set(d.id, d.data() || {});
            }
          }

          let activeGlobalRedemptionsCount = 0;
          const priorCustomerUseKeys = new Set<string>();

          for (const [rId, rData] of allRedemptionDocs.entries()) {
            const rStatus = typeof rData.status === 'string' ? rData.status.trim().toLowerCase() : 'active';
            if (rStatus === 'cancelled' || rStatus === 'batal') continue;

            const rCode = typeof rData.voucherCode === 'string' ? rData.voucherCode.trim().toUpperCase() : '';
            const rVoucherId = typeof rData.voucherId === 'string' ? rData.voucherId.trim() : '';
            if (rCode !== code && rVoucherId !== targetMasterId) continue;

            activeGlobalRedemptionsCount++;

            const rUid = typeof rData.customerAuthUid === 'string' ? rData.customerAuthUid.trim() : '';
            const rCustId = typeof rData.customerId === 'string' ? rData.customerId.trim() : '';
            if (rUid === verifiedUid || (verifiedCustomerId && rCustId === verifiedCustomerId)) {
              priorCustomerUseKeys.add(rData.bookingId || rId);
            }
          }

          if (usageLimitTotal > 0) {
            const effectiveGlobalUsed = Math.max(rawCurrentUsage, activeGlobalRedemptionsCount);
            if (effectiveGlobalUsed >= usageLimitTotal) {
              return {
                status: 409,
                code: 'VOUCHER_QUOTA_EXHAUSTED',
                error: 'Kuota promo sudah habis.',
              };
            }
          }

          let hasPreviousNonCancelledBooking = false;
          for (const [bId, b] of ownedBookingsMap.entries()) {
            const bStatus = typeof b.status === 'string' ? b.status.trim().toLowerCase() : '';
            if (bStatus === 'cancelled' || bStatus === 'batal') continue;

            hasPreviousNonCancelledBooking = true;

            const bPromoCode = typeof b.promoCode === 'string' ? b.promoCode.trim().toUpperCase() : '';
            const bVoucherCode = typeof b.voucherCode === 'string' ? b.voucherCode.trim().toUpperCase() : '';
            const bPromoId = typeof b.promoId === 'string' ? b.promoId.trim() : '';
            const bVoucherId = typeof b.voucherId === 'string' ? b.voucherId.trim() : '';

            if (
              bPromoCode === code ||
              bVoucherCode === code ||
              bPromoId === targetMasterId ||
              bVoucherId === targetMasterId
            ) {
              priorCustomerUseKeys.add(bId);
            }
          }

          for (const reservedBookingId of otherReservedBookingIds) {
            priorCustomerUseKeys.add(reservedBookingId);
          }

          if (usageLimitPerCustomer > 0 && priorCustomerUseKeys.size >= usageLimitPerCustomer) {
            return {
              status: 409,
              code: 'VOUCHER_CUSTOMER_QUOTA_EXHAUSTED',
              error: `Voucher ${code} sudah pernah digunakan pada akun ini.`,
            };
          }

          if (targetMasterData.firstOrderOnly === true || targetMasterData.newCustomerOnly === true) {
            if (hasPreviousNonCancelledBooking) {
              return {
                status: 409,
                code: 'VOUCHER_FIRST_ORDER_ONLY',
                error: 'Voucher ini khusus untuk pesanan pertama.',
              };
            }
            if (verifiedCustomerData) {
              const comp = verifiedCustomerData.completedBookings ?? 0;
              const tot = verifiedCustomerData.totalBookings ?? 0;
              if (!isFiniteNonNegativeInt(comp) || !isFiniteNonNegativeInt(tot)) {
                return {
                  status: 409,
                  code: 'VOUCHER_CONFIG_INVALID',
                  error: 'Data riwayat pesanan pelanggan tidak valid.',
                };
              }
              if (comp > 0 || tot > 0) {
                return {
                  status: 409,
                  code: 'VOUCHER_FIRST_ORDER_ONLY',
                  error: 'Voucher ini khusus untuk pesanan pertama.',
                };
              }
            }
          }
        }

        // 3H. Verify Client Price/Discount Expectations Against Server-Derived Breakdown
        const isVoucherOnlyGeneralRequest =
          !personalCvId && !rawReqPromoCode && !rawReqPromoId && Boolean(rawReqVoucherCode || rawReqVoucherId);
        if (
          req.body?.promoDiscount !== undefined &&
          req.body?.promoDiscount !== null &&
          Number(req.body.promoDiscount) !== pricingBreakdown.promoDiscountAmount &&
          !(isVoucherOnlyGeneralRequest && Number(req.body.promoDiscount) === 0 && Number(req.body?.voucherDiscount) === pricingBreakdown.promoDiscountAmount)
        ) {
          return {
            status: 409,
            code: 'DISCOUNT_MISMATCH',
            error: 'Nominal diskon promo pada form tidak sesuai dengan perhitungan resmi server.',
            pricingBreakdown,
          };
        }
        if (
          req.body?.voucherDiscount !== undefined &&
          req.body?.voucherDiscount !== null &&
          Number(req.body.voucherDiscount) !== pricingBreakdown.voucherDiscountAmount &&
          !(isVoucherOnlyGeneralRequest && Number(req.body.voucherDiscount) === pricingBreakdown.promoDiscountAmount && (req.body?.promoDiscount === undefined || req.body?.promoDiscount === null || Number(req.body.promoDiscount) === 0))
        ) {
          return {
            status: 409,
            code: 'DISCOUNT_MISMATCH',
            error: 'Nominal diskon voucher pada form tidak sesuai dengan perhitungan resmi server.',
            pricingBreakdown,
          };
        }
        if (
          req.body?.pointsDiscount !== undefined &&
          req.body?.pointsDiscount !== null &&
          Number(req.body.pointsDiscount) !== pricingBreakdown.pointsDiscountAmount
        ) {
          return {
            status: 409,
            code: 'DISCOUNT_MISMATCH',
            error: 'Nominal diskon poin pada form tidak sesuai dengan perhitungan resmi server.',
            pricingBreakdown,
          };
        }
        if (
          req.body?.discountAmount !== undefined &&
          req.body?.discountAmount !== null &&
          Number(req.body.discountAmount) !== pricingBreakdown.totalDiscount
        ) {
          return {
            status: 409,
            code: 'DISCOUNT_MISMATCH',
            error: 'Total diskon pada form tidak sesuai dengan perhitungan resmi server.',
            pricingBreakdown,
          };
        }
        if (
          req.body?.totalAmount !== undefined &&
          req.body?.totalAmount !== null &&
          Number(req.body.totalAmount) !== pricingBreakdown.finalAmount
        ) {
          return {
            status: 409,
            code: 'PRICE_MISMATCH',
            error: 'Total pembayaran pada form tidak sesuai dengan perhitungan resmi server.',
            pricingBreakdown,
          };
        }

        // --- PHASE 4: ATOMIC TRANSACTION WRITES ---
        const primaryTarget = voucherTargets[0];
        const appliedGeneral = voucherTargets.find(target => target.kind === 'general');
        const appliedPersonal = voucherTargets.find(target => target.kind === 'personal');
        const primaryRedemptionId = primaryTarget ? `vred_${primaryTarget.code}_${candidateBookingId}` : loyaltyTxId;

        const newBookingData = cleanBookingRecord({
          id: candidateBookingId,
          bookingCode: candidateBookingCode,
          customerId: effectiveCustomerId,
          customerAuthUid: verifiedUid,
          authUserId: verifiedUid,
          customerName: customerNameTrimmed,
          customerWhatsApp: customerWhatsAppTrimmed,
          customerEmail: customerEmailTrimmed,
          serviceId,
          serviceName: typeof serviceData.name === 'string' && serviceData.name.trim() ? serviceData.name.trim() : (typeof req.body?.serviceName === 'string' ? req.body.serviceName.trim() : ''),
          serviceDuration: isFinitePositiveNumber(serviceData.duration) ? serviceData.duration : (isFinitePositiveNumber(req.body?.serviceDuration) ? req.body.serviceDuration : 60),
          scheduleDate,
          scheduleTime,
          scheduleAt: `${scheduleDate} ${scheduleTime}`,
          genderPreference: typeof req.body?.genderPreference === 'string' && req.body.genderPreference.trim() ? req.body.genderPreference.trim() : 'Bebas',
          customerGender: (req.body?.customerGender === 'Laki-laki' || req.body?.customerGender === 'Perempuan') ? req.body.customerGender : undefined,
          address: addressTrimmed,
          latitude,
          longitude,
          placeId: typeof req.body?.placeId === 'string' ? req.body.placeId.trim() : '',
          addressNotes: typeof req.body?.addressNotes === 'string' ? req.body.addressNotes.trim() : '',
          distanceKm: finalDistanceKm,
          distanceMeters: finalDistanceMeters,
          requiresAdminConfirmation: Boolean(req.body?.requiresAdminConfirmation),
          area: typeof req.body?.area === 'string' ? req.body.area.trim() : '',
          servicePrice: authoritativeServicePrice,
          homeServiceFee: authoritativeHomeServiceFee,
          servicePriceSnapshot: authoritativeServicePrice,
          serviceNameSnapshot: typeof serviceData.name === 'string' && serviceData.name.trim() ? serviceData.name.trim() : (typeof req.body?.serviceName === 'string' ? req.body.serviceName.trim() : ''),
          durationMinutesSnapshot: isFinitePositiveNumber(serviceData.duration) ? serviceData.duration : (isFinitePositiveNumber(req.body?.serviceDuration) ? req.body.serviceDuration : 60),
          homeServiceFeeSnapshot: authoritativeHomeServiceFee,
          homeServiceFeeTier: authoritativeHomeServiceTier,
          baseLocationId: SENZU_BASE_LOCATION.id,
          baseLocationName: SENZU_BASE_LOCATION.name,
          baseLatitude: SENZU_BASE_LOCATION.lat,
          baseLongitude: SENZU_BASE_LOCATION.lng,
          customerLat: latitude,
          customerLng: longitude,
          areaIdSnapshot: typeof req.body?.areaIdSnapshot === 'string' && req.body.areaIdSnapshot.trim() ? req.body.areaIdSnapshot.trim() : undefined,
          areaNameSnapshot: typeof req.body?.areaNameSnapshot === 'string' && req.body.areaNameSnapshot.trim() ? req.body.areaNameSnapshot.trim() : (typeof req.body?.area === 'string' ? req.body.area.trim() : ''),
          discountAmount: pricingBreakdown.totalDiscount,
          customerVoucherId: appliedPersonal ? personalCvId : undefined,
          voucherId: appliedPersonal ? personalCvId : (appliedGeneral?.masterId || undefined),
          voucherCode: appliedPersonal ? resolvedPersonalCvCode : (appliedGeneral?.code || undefined),
          voucherDiscount: personalCvId ? pricingBreakdown.voucherDiscountAmount : (isVoucherOnlyGeneralRequest ? pricingBreakdown.promoDiscountAmount : pricingBreakdown.voucherDiscountAmount),
          promoId: appliedGeneral?.masterId,
          promoCode: appliedGeneral?.code,
          promoCodeSnapshot: appliedGeneral?.code,
          promoNameSnapshot: appliedGeneral?.masterData.name,
          discountTypeSnapshot: appliedGeneral?.masterData.voucherType,
          discountValueSnapshot: appliedGeneral?.masterData.value,
          promoDiscount: pricingBreakdown.promoDiscountAmount,
          pointsRedeemed: pricingBreakdown.pointsRedeemed,
          pointsDiscount: pricingBreakdown.pointsDiscountAmount,
          pointsEarned: pricingBreakdown.estimatedPointsEarned,
          referredByCustomerId: typeof req.body?.referredByCustomerId === 'string' && req.body.referredByCustomerId.trim() ? req.body.referredByCustomerId.trim() : undefined,
          referralCodeUsed: typeof req.body?.referralCodeUsed === 'string' && req.body.referralCodeUsed.trim() ? req.body.referralCodeUsed.trim().toUpperCase() : undefined,
          membershipTierAtBooking: resolvedTier.name || 'Member',
          totalAmount: pricingBreakdown.finalAmount,
          paymentMethod: paymentMethodTrimmed,
          customerNotes: typeof req.body?.customerNotes === 'string' ? req.body.customerNotes.trim().slice(0, 1000) : '',
          status: 'Menunggu Pembayaran',
          paymentStatus: 'UNPAID',
          paymentPolicyVersion: 2,
          paymentDeadline: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        transaction.set(candidateBookingRef, newBookingData);

        // These existing handoff records commit with the booking. A lost HTTP response cannot skip or duplicate them.
        const initialHistoryId = `hist_checkout_${candidateBookingId}`;
        transaction.set(adminDb.collection('booking_status_history').doc(initialHistoryId), {
          id: initialHistoryId, bookingId: candidateBookingId, bookingCode: candidateBookingCode,
          status: 'Menunggu Pembayaran', updatedByRole: 'customer', updatedByName: customerNameTrimmed,
          note: `Booking diajukan oleh customer melalui portal Senzu Home. Metode bayar: ${paymentMethodTrimmed}`,
          timestamp: nowIso, formattedWIB: new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short',
          }).format(new Date(nowIso)),
        });
        if (verifiedCustomerId && verifiedCustomerData) {
          const previousCount = Number.isSafeInteger(verifiedCustomerData.totalBookings) && verifiedCustomerData.totalBookings >= 0
            ? verifiedCustomerData.totalBookings : 0;
          transaction.update(adminDb.collection('customers').doc(verifiedCustomerId), cleanBookingRecord({
            totalBookings: Math.max(previousCount, ownedBookingsMap.size) + 1,
            totalBooking: Math.max(previousCount, ownedBookingsMap.size) + 1,
            firstBookingAt: verifiedCustomerData.firstBookingAt || nowIso, lastBookingAt: nowIso, updatedAt: nowIso,
            ...(!verifiedCustomerData.defaultAddress ? {
              defaultAddress: addressTrimmed, defaultArea: newBookingData.area, defaultLatitude: latitude,
              defaultLongitude: longitude, defaultPlaceId: newBookingData.placeId, addressNotes: newBookingData.addressNotes,
            } : {}),
            ...(!verifiedCustomerData.gender && newBookingData.customerGender ? { gender: newBookingData.customerGender } : {}),
          }));
        }
        const bookingEventId = `evt_checkout_${candidateBookingId}`;
        const eventPayload = cleanBookingRecord({
          bookingId: candidateBookingId, bookingCode: candidateBookingCode, customerId: effectiveCustomerId,
          customerName: customerNameTrimmed, customerWhatsApp: customerWhatsAppTrimmed, customerEmail: customerEmailTrimmed,
          serviceName: newBookingData.serviceName, scheduleAt: newBookingData.scheduleAt,
          totalAmount: newBookingData.totalAmount, paymentMethod: paymentMethodTrimmed, area: newBookingData.area,
        });
        const bookingAlertsEnabled = !snapExists(bookingNotificationSettingsSnap)
          || bookingNotificationSettingsSnap.data()?.bookingCreatedAlert !== false;
        transaction.set(adminDb.collection('notification_events').doc(bookingEventId), {
          id: bookingEventId, eventType: 'booking.created', bookingId: candidateBookingId,
          actorId: effectiveCustomerId, actorRole: 'customer', payload: eventPayload,
          createdAt: nowIso, status: 'processed', processedAt: nowIso,
        });
        if (bookingAlertsEnabled) {
          // Same recipient roles, titles and routes as the existing booking.created event.
          const targets = [
            {recipientRole: 'css', title: 'Booking Baru Diterima', priority: 'HIGH',
              message: `Order #${candidateBookingCode} dari ${customerNameTrimmed} (${newBookingData.serviceName}) menunggu verifikasi pembayaran.`,
              actionUrl: `/css?booking=${candidateBookingCode}`},
            {recipientRole: 'manager', title: 'Booking Baru Diterima', priority: 'HIGH',
              message: `Order #${candidateBookingCode} dari ${customerNameTrimmed} (${newBookingData.serviceName}) masuk ke sistem. Menunggu verifikasi pembayaran.`,
              actionUrl: `/reconciliation?booking=${candidateBookingCode}`},
            {recipientRole: 'customer', recipientUserId: effectiveCustomerId, title: 'Reservasi Senzu Home Diterima', priority: 'NORMAL',
              message: `Pesanan #${candidateBookingCode} (${newBookingData.serviceName}) berhasil dibuat. Silakan lakukan pembayaran agar dapat diproses.`,
              actionUrl: `/track/${candidateBookingCode}`},
          ];
          for (const target of targets) {
            const notificationId = `notif_checkout_${candidateBookingId}_${target.recipientRole}`;
            transaction.set(adminDb.collection('notifications').doc(notificationId), cleanBookingRecord({
              ...target, id: notificationId, eventId: bookingEventId, eventType: 'booking.created',
              bookingId: candidateBookingId, bookingCode: candidateBookingCode, customerId: effectiveCustomerId,
              channel: 'in_app', read: false, readAt: null,
              metadata: {...eventPayload, actorId: effectiveCustomerId, actorRole: 'customer'}, createdAt: nowIso,
            }));
          }
        }

        for (const target of voucherTargets) {
          const redId = `vred_${target.code}_${candidateBookingId}`;
          const redRef = adminDb.collection('voucher_redemptions').doc(redId);
          const recRef = adminDb.collection('voucher_redemption_receipts').doc(redId);
          const uLockRef = uidLockRefsByCode.get(target.code);
          const cLockRefs = custLockRefsByCode.get(target.code);
          const pLockRef = phoneLockRefsByCode.get(target.code);

          transaction.set(
            redRef,
            {
              id: redId,
              voucherId: target.masterId,
              voucherCode: target.code,
              customerId: effectiveCustomerId,
              customerAuthUid: verifiedUid,
              customerPhone: customerWhatsAppTrimmed || null,
              normalizedPhone: bookingPhoneDigits ? `+${bookingPhoneDigits}` : null,
              bookingId: candidateBookingId,
              bookingCode: candidateBookingCode,
              discountAmount: target.discountAmount,
              redeemedAt: nowIso,
              status: 'active',
              source: 'booking_checkout',
              updatedAt: nowIso,
            },
            { merge: true }
          );

          if (uLockRef) {
            transaction.set(
              uLockRef,
              {
                voucherCode: target.code,
                voucherId: target.masterId,
                customerAuthUid: verifiedUid,
                bookingId: candidateBookingId,
                bookingCode: candidateBookingCode,
                redeemedAt: nowIso,
                status: 'active',
                updatedAt: nowIso,
              },
              { merge: true }
            );
          }

          if (verifiedCustomerId && cLockRefs?.has(verifiedCustomerId)) {
            transaction.set(
              cLockRefs.get(verifiedCustomerId),
              {
                voucherCode: target.code,
                voucherId: target.masterId,
                customerId: verifiedCustomerId,
                customerAuthUid: verifiedUid,
                bookingId: candidateBookingId,
                bookingCode: candidateBookingCode,
                redeemedAt: nowIso,
                status: 'active',
                updatedAt: nowIso,
              },
              { merge: true }
            );
          }

          if (pLockRef && target.canWritePhoneLock) {
            transaction.set(
              pLockRef,
              {
                voucherCode: target.code,
                voucherId: target.masterId,
                customerPhone: bookingPhoneDigits,
                customerAuthUid: verifiedUid,
                bookingId: candidateBookingId,
                bookingCode: candidateBookingCode,
                redeemedAt: nowIso,
                status: 'active',
                updatedAt: nowIso,
              },
              { merge: true }
            );
          }

          transaction.update(target.masterRef, {
            currentUsageCount: target.currentUsageCount + 1,
            updatedAt: nowIso,
          });

          transaction.set(recRef, {
            schemaVersion: 1,
            redemptionId: redId,
            bookingId: candidateBookingId,
            voucherId: target.masterId,
            voucherCode: target.code,
            customerAuthUid: verifiedUid,
            discountAmount: target.discountAmount,
            committedAt: nowIso,
          });
        }

        if (personalCvRef && voucherTargets.some(target => target.kind === 'personal')) {
          transaction.update(personalCvRef, {
            status: 'used',
            usedAt: nowIso,
            bookingId: candidateBookingId,
            bookingCode: candidateBookingCode,
          });
        }

        if (pricingBreakdown.pointsRedeemed > 0 && verifiedLoyaltySnap) {
          const newPointsBalance = currentPtsBalance - pricingBreakdown.pointsRedeemed;
          const prevLifetimeRedeemed = isFiniteNonNegativeInt(verifiedLoyaltyData?.lifetimePointsRedeemed)
            ? verifiedLoyaltyData.lifetimePointsRedeemed
            : 0;
          const loyaltyAccountUpdate: Record<string, any> = {
            pointsBalance: newPointsBalance,
            lifetimePointsRedeemed: prevLifetimeRedeemed + pricingBreakdown.pointsRedeemed,
            updatedAt: nowIso,
          };
          if (verifiedLoyaltyData && 'currentPointsBalance' in verifiedLoyaltyData) {
            loyaltyAccountUpdate.currentPointsBalance = newPointsBalance;
          }
          transaction.update(verifiedLoyaltySnap.ref, loyaltyAccountUpdate);

          transaction.set(loyaltyTxRef, {
            id: loyaltyTxId,
            customerId:
              typeof verifiedLoyaltyData?.customerId === 'string' && verifiedLoyaltyData.customerId.trim()
                ? verifiedLoyaltyData.customerId.trim()
                : verifiedLoyaltySnap.id,
            customerName: customerNameTrimmed || verifiedLoyaltyData?.customerName || '',
            customerAuthUid: verifiedUid,
            bookingId: candidateBookingId,
            bookingCode: candidateBookingCode,
            transactionType: 'redeem',
            points: -pricingBreakdown.pointsRedeemed,
            balanceBefore: currentPtsBalance,
            balanceAfter: newPointsBalance,
            referenceType: 'booking_checkout',
            referenceId: candidateBookingId,
            reason: `Penukaran poin untuk reservasi ${candidateBookingCode} (-Rp${pricingBreakdown.pointsDiscountAmount.toLocaleString('id-ID')})`,
            createdBy: 'customer',
            createdAt: nowIso,
            metadata: {
              discountRp: pricingBreakdown.pointsDiscountAmount,
              redemptionDiscount: pricingBreakdown.pointsDiscountAmount,
            },
          });
        }

        transaction.set(checkoutReceiptRef, {
          schemaVersion: 2,
          benefitType: pointsOnlyCheckout ? 'points' : 'voucher',
          initialHistoryId, bookingEventId, crmRecorded: Boolean(verifiedCustomerId),
          intent: checkoutIntent,
          appliedVouchers: voucherTargets.map(target => cleanBookingRecord({
            kind: target.kind, voucherId: target.masterId, voucherCode: target.code,
            redemptionId: `vred_${target.code}_${candidateBookingId}`, discountAmount: target.discountAmount,
            customerVoucherId: target.kind === 'personal' ? personalCvId : undefined,
          })),
          loyaltyTransactionId: pricingBreakdown.pointsRedeemed > 0 ? loyaltyTxId : null,
          loyaltyAccountId: pricingBreakdown.pointsRedeemed > 0 ? verifiedLoyaltySnap.id : null,
          checkoutAttemptId,
          bookingId: candidateBookingId,
          bookingCode: candidateBookingCode,
          redemptionId: primaryRedemptionId,
          voucherId: primaryTarget?.masterId || null,
          voucherCode: primaryTarget?.code || null,
          generalPromoId: resolvedGeneralPromoId || null,
          generalPromoCode: resolvedGeneralPromoCode || null,
          personalCustomerVoucherId: personalCvId || null,
          customerAuthUid: verifiedUid,
          customerId: effectiveCustomerId,
          serviceId,
          scheduleDate,
          scheduleTime,
          customerPhoneDigits: bookingPhoneDigits,
          paymentMethod: paymentMethodTrimmed,
          requestedPoints,
          pointsRedeemed: pricingBreakdown.pointsRedeemed,
          pointsDiscount: pricingBreakdown.pointsDiscountAmount,
          discountAmount: pricingBreakdown.totalPromoAndVoucherDiscount,
          totalDiscount: pricingBreakdown.totalDiscount,
          totalAmount: pricingBreakdown.finalAmount,
          pricingBreakdown,
          committedAt: nowIso,
        });

        return {
          status: 200,
          isIdempotent: false,
          booking: newBookingData,
          redemptionId: primaryRedemptionId,
          voucherId: primaryTarget?.masterId || null,
          voucherCode: primaryTarget?.code || null,
          discountAmount: pricingBreakdown.totalPromoAndVoucherDiscount,
          pricingBreakdown,
        };
      });

      if (txOutcome.status !== 200) {
        return res.status(txOutcome.status).json({
          success: false,
          code: txOutcome.code,
          error: txOutcome.error,
          message: txOutcome.error,
          ...(txOutcome.pricingBreakdown ? { pricingBreakdown: txOutcome.pricingBreakdown } : {}),
        });
      }

      if (!txOutcome.isIdempotent) {
        emitStructuredLog({
          severity: 'INFO',
          event: 'voucher_checkout_atomic',
          checkoutAttemptId,
          redemptionId: txOutcome.redemptionId,
          bookingId: txOutcome.booking.id,
          bookingCode: txOutcome.booking.bookingCode,
          voucherId: txOutcome.voucherId,
          voucherCode: txOutcome.voucherCode,
          customerAuthUid: verifiedUid,
          discountAmount: txOutcome.discountAmount,
          totalAmount: txOutcome.booking.totalAmount,
          message: `Voucher checkout atomically committed for booking ${txOutcome.booking.id}`,
        });
      }

      return res.json({
        success: true,
        isIdempotent: Boolean(txOutcome.isIdempotent),
        booking: txOutcome.booking,
        redemptionId: txOutcome.redemptionId,
        discountAmount: txOutcome.discountAmount,
        ...(txOutcome.pricingBreakdown ? { pricingBreakdown: txOutcome.pricingBreakdown } : {}),
      });
    } catch (err: any) {
      if (err?.code === 'LOYALTY_OWNERSHIP_CONFLICT') return res.status(409).json({success: false, code: err.code, error: err.message, errorMessage: err.message});
      console.error('[VoucherCheckout] Transaction or infrastructure failure:', err?.code || err?.message || err);
      return res.status(503).json({
        success: false,
        code: 'VOUCHER_CHECKOUT_UNAVAILABLE',
        error: 'Layanan checkout voucher sedang mengalami kendala. Silakan coba kembali.',
      });
    }
  });

  // POST /api/vouchers/redeem - Server Authoritative Atomic Redemption Writer (Stage 5A)
  app.post('/api/vouchers/redeem', async (req, res) => {
    const isValidDocId = (val: unknown, maxBytes = 256): val is string => {
      if (typeof val !== 'string') return false;
      const trimmed = val.trim();
      if (!trimmed || trimmed !== val) return false;
      if (trimmed === '.' || trimmed === '..') return false;
      if (Buffer.byteLength(trimmed, 'utf8') > maxBytes) return false;
      if (/[\/\\\x00-\x1F\x7F\s]/.test(trimmed)) return false;
      return true;
    };

    const isFiniteNonNegativeInt = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val) && val >= 0;

    const isFiniteNonNegativeNumber = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && val >= 0;

    const isFinitePositiveNumber = (val: unknown): val is number =>
      typeof val === 'number' && Number.isFinite(val) && val > 0;

    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

    const calculateStraightDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c * 10) / 10;
    };

    const calculateBookingPrice = (input: any) => {
  const warnings: string[] = [];
  const servicePrice = Math.max(0, input.servicePrice || 0);
  const homeServiceFee = Math.max(0, input.homeServiceFee || 0);
  const grossAmount = servicePrice + homeServiceFee;

  // 1. Tier percentage discount (applied directly to service price if configured)
  let tierDiscountAmount = 0;
  if (input.customerTier && input.customerTier.discountPercentage > 0) {
    tierDiscountAmount = Math.floor((servicePrice * input.customerTier.discountPercentage) / 100);
  }

  const priceAfterTier = Math.max(0, servicePrice - tierDiscountAmount);

  // 2. Voucher / Promo Discount
  let promoDiscountAmount = 0;
  let voucherDiscountAmount = 0;

  // Check general promo voucher
  if (input.promoVoucher && input.promoVoucher.enabled) {
    const promo = input.promoVoucher;
    if (priceAfterTier >= (promo.minimumSpend || 0)) {
      if (promo.voucherType === 'fixed_discount' || (promo.voucherType as any) === 'FIXED_AMOUNT') {
        promoDiscountAmount = promo.value;
      } else if (
        promo.voucherType === 'percentage_discount' ||
        promo.voucherType === 'percentage' ||
        (promo.voucherType as any) === 'PERCENTAGE'
      ) {
        let disc = Math.floor((priceAfterTier * promo.value) / 100);
        if (promo.maximumDiscount && promo.maximumDiscount > 0) {
          disc = Math.min(disc, promo.maximumDiscount);
        }
        promoDiscountAmount = disc;
      } else if (promo.voucherType === 'free_home_service_fee') {
        promoDiscountAmount = homeServiceFee;
      }
    } else {
      warnings.push(`Kode promo memerlukan minimal transaksi Rp ${(promo.minimumSpend || 0).toLocaleString('id-ID')}`);
    }
  }

  // Check customer personal voucher (if not stacking or stacking permitted)
  if (input.customerVoucher && input.customerVoucher.status === 'available') {
    const cv = input.customerVoucher;
    if (priceAfterTier >= (cv.minimumSpend || 0)) {
      if (cv.voucherType === 'fixed_discount') {
        voucherDiscountAmount = cv.value;
      } else if (cv.voucherType === 'percentage_discount') {
        let disc = Math.floor((priceAfterTier * cv.value) / 100);
        if (cv.maximumDiscount && cv.maximumDiscount > 0) {
          disc = Math.min(disc, cv.maximumDiscount);
        }
        voucherDiscountAmount = disc;
      } else if (cv.voucherType === 'free_home_service_fee') {
        voucherDiscountAmount = homeServiceFee;
      }
    } else {
      warnings.push(`Voucher memerlukan minimal transaksi Rp ${(cv.minimumSpend || 0).toLocaleString('id-ID')}`);
    }
  }

  // If stacking not allowed and both provided, take the best one
  const allowStacking = input.settings?.allowStacking ?? false;
  let totalPromoAndVoucherDiscount = 0;
  if (!allowStacking && promoDiscountAmount > 0 && voucherDiscountAmount > 0) {
    if (voucherDiscountAmount >= promoDiscountAmount) {
      promoDiscountAmount = 0;
      totalPromoAndVoucherDiscount = voucherDiscountAmount;
    } else {
      voucherDiscountAmount = 0;
      totalPromoAndVoucherDiscount = promoDiscountAmount;
    }
  } else {
    totalPromoAndVoucherDiscount = promoDiscountAmount + voucherDiscountAmount;
  }

  // Cap voucher discount to not exceed the servicePrice + fee
  totalPromoAndVoucherDiscount = Math.min(totalPromoAndVoucherDiscount, priceAfterTier + homeServiceFee);

  const amountAfterVouchers = Math.max(0, priceAfterTier + homeServiceFee - totalPromoAndVoucherDiscount);

  // 3. Points Redemption
  // Conversion: pointsPerCurrencyUnit (e.g. 10 Points = Rp 1.000 -> 1 pt = Rp 100)
  const pointsPerCurrencyUnit = input.settings?.pointsPerCurrencyUnit || 10;
  const valuePerPoint = 1000 / pointsPerCurrencyUnit; // e.g. 100 Rp per point
  const minPointsToRedeem = input.settings?.minimumPointsToRedeem || 50;
  const maxRedemptionPercentage = input.settings?.maximumRedemptionPercentage || 30; // max 30% of booking value

  let requestedPoints = Math.max(0, Math.floor(input.pointsToRedeem || 0));
  let pointsRedeemed = 0;
  let pointsDiscountAmount = 0;

  if (requestedPoints > 0) {
    if (requestedPoints < minPointsToRedeem) {
      warnings.push(`Minimal penukaran poin adalah ${minPointsToRedeem} Poin.`);
    } else {
      // Maximum rupiah allowed from points = (grossAmount * maxRedemptionPercentage) / 100
      const maxAllowedDiscountRp = Math.floor((grossAmount * maxRedemptionPercentage) / 100);
      const maxAllowedPoints = Math.floor(maxAllowedDiscountRp / valuePerPoint);

      pointsRedeemed = Math.min(requestedPoints, maxAllowedPoints);
      pointsDiscountAmount = pointsRedeemed * valuePerPoint;

      // Ensure points discount does not exceed remaining amount
      if (pointsDiscountAmount > amountAfterVouchers) {
        pointsDiscountAmount = amountAfterVouchers;
        pointsRedeemed = Math.floor(pointsDiscountAmount / valuePerPoint);
      }
    }
  }

  // 4. Final Amount
  const totalDiscount = tierDiscountAmount + totalPromoAndVoucherDiscount + pointsDiscountAmount;
  const finalAmount = Math.max(0, grossAmount - totalDiscount);

  // 5. Estimated Points Earning Calculation
  // Net qualified spend: Net treatment price after discounts
  const includeHomeServiceFee = input.settings?.includeHomeServiceFeeForPoints ?? false;
  const spendPerPoint = input.settings?.spendPerPoint || 10000;
  const multiplier = input.customerTier?.earningMultiplier || 1.0;

  // Qualified spend = servicePrice - discounts (+ homeServiceFee if allowed)
  let qualifiedSpendForPoints = servicePrice - tierDiscountAmount - totalPromoAndVoucherDiscount - pointsDiscountAmount;
  if (includeHomeServiceFee) {
    qualifiedSpendForPoints += homeServiceFee;
  }
  qualifiedSpendForPoints = Math.max(0, qualifiedSpendForPoints);

  const basePointsEarned = Math.floor(qualifiedSpendForPoints / spendPerPoint);
  const estimatedPointsEarned = Math.floor(basePointsEarned * multiplier);

  return {
    servicePrice,
    homeServiceFee,
    grossAmount,
    tierDiscountAmount,
    promoDiscountAmount,
    voucherDiscountAmount,
    totalPromoAndVoucherDiscount,
    pointsRedeemed,
    pointsDiscountAmount,
    totalDiscount,
    finalAmount,
    qualifiedSpendForPoints,
    estimatedPointsEarned,
    warnings,
  };
};

    try {
      // 1. Strict Single Bearer Token Extraction BEFORE any DB reads/writes
      const rawAuthHeader = req.headers?.authorization;
      if (typeof rawAuthHeader !== 'string') {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Token otentikasi diperlukan untuk menukarkan voucher.',
        });
      }
      const tokenMatch = /^Bearer\s+(\S+)$/i.exec(rawAuthHeader.trim());
      if (!tokenMatch || !tokenMatch[1]) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Format token otentikasi tidak valid.',
        });
      }

      if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'AUTH_SERVICE_UNAVAILABLE',
          error: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
        });
      }

      const authResult = await verifyCustomerFirebaseIdToken(tokenMatch[1]);
      if (authResult.success === false) {
        return res.status(authResult.statusCode).json({
          success: false,
          code: authResult.code,
          error: authResult.message,
          message: authResult.message,
        });
      }

      const verifiedUid = typeof authResult.uid === 'string' ? authResult.uid.trim() : '';
      if (!isValidDocId(verifiedUid, 128) || verifiedUid !== authResult.uid) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_TOKEN_INVALID',
          error: 'Identitas pengguna tidak valid.',
        });
      }

      // 2. Bounded Input Selectors Validation BEFORE any DB reads/writes
      const rawBookingId = req.body?.bookingId;
      const bookingId = typeof rawBookingId === 'string' ? rawBookingId.trim() : '';
      if (!bookingId || !isValidDocId(bookingId, 256)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_ID',
          error: 'ID pesanan tidak valid.',
        });
      }

      const rawVoucherCode = req.body?.voucherCode;
      const code = typeof rawVoucherCode === 'string' ? rawVoucherCode.trim().toUpperCase() : '';
      if (!code || !/^[A-Z0-9_-]{1,64}$/.test(code)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_VOUCHER_CODE',
          error: 'Kode voucher tidak valid.',
        });
      }

      const rawSuppliedVoucherId = req.body?.voucherId;
      let suppliedVoucherId = '';
      if (rawSuppliedVoucherId !== undefined && rawSuppliedVoucherId !== null && rawSuppliedVoucherId !== '') {
        if (typeof rawSuppliedVoucherId !== 'string' || !isValidDocId(rawSuppliedVoucherId.trim(), 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_VOUCHER_ID',
            error: 'ID voucher tidak valid.',
          });
        }
        suppliedVoucherId = rawSuppliedVoucherId.trim();
      }

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'VOUCHER_REDEMPTION_UNAVAILABLE',
          error: 'Layanan penukaran voucher sedang tidak tersedia.',
        });
      }

      await ensureServerAuthenticated();

      const redemptionId = `vred_${code}_${bookingId}`;
      const bookingRef = adminDb.collection('bookings').doc(bookingId);
      const receiptRef = adminDb.collection('voucher_redemption_receipts').doc(redemptionId);
      const redemptionRef = adminDb.collection('voucher_redemptions').doc(redemptionId);

      // 3. Authoritative Native Admin Transaction (All reads precede writes)
      const txOutcome = await adminDb.runTransaction(async (transaction: any) => {
        const nowIso = new Date().toISOString();

        // --- PHASE 1: READ BOOKING & VALIDATE OWNERSHIP FIRST ---
        const bookingSnap = await transaction.get(bookingRef);
        if (!snapExists(bookingSnap)) {
          return {
            status: 403,
            code: 'BOOKING_OWNERSHIP_UNVERIFIED',
            error: 'Akses ditolak. Kepemilikan pesanan tidak dapat diverifikasi.',
          };
        }

        const bookingData = bookingSnap.data() || {};
        const rawCanonicalUid = bookingData.customerAuthUid;
        const rawLegacyUid = bookingData.authUserId;
        const hasCanonicalUid = rawCanonicalUid !== undefined && rawCanonicalUid !== null && rawCanonicalUid !== '';
        const hasLegacyUid = rawLegacyUid !== undefined && rawLegacyUid !== null && rawLegacyUid !== '';

        if (hasCanonicalUid && !isValidDocId(rawCanonicalUid, 128)) {
          return {
            status: 403,
            code: 'BOOKING_OWNERSHIP_INVALID',
            error: 'Akses ditolak. Kepemilikan pesanan tidak dapat diverifikasi.',
          };
        }
        if (hasLegacyUid && !isValidDocId(rawLegacyUid, 128)) {
          return {
            status: 403,
            code: 'BOOKING_OWNERSHIP_INVALID',
            error: 'Akses ditolak. Kepemilikan pesanan tidak dapat diverifikasi.',
          };
        }
        if (!hasCanonicalUid && !hasLegacyUid) {
          return {
            status: 403,
            code: 'BOOKING_OWNERSHIP_UNVERIFIED',
            error: 'Akses ditolak. Kepemilikan pesanan tidak dapat diverifikasi.',
          };
        }
        if (hasCanonicalUid && hasLegacyUid && rawCanonicalUid !== rawLegacyUid) {
          return {
            status: 403,
            code: 'BOOKING_OWNERSHIP_CONFLICT',
            error: 'Akses ditolak. Kepemilikan pesanan tidak dapat diverifikasi.',
          };
        }

        const effectiveOwnerUid = hasCanonicalUid ? rawCanonicalUid : rawLegacyUid;
        if (effectiveOwnerUid !== verifiedUid) {
          return {
            status: 403,
            code: 'BOOKING_OWNERSHIP_DENIED',
            error: 'Akses ditolak. Kepemilikan pesanan tidak dapat diverifikasi.',
          };
        }

        const bookingStatusLower = typeof bookingData.status === 'string' ? bookingData.status.trim().toLowerCase() : '';
        if (bookingStatusLower === 'cancelled' || bookingStatusLower === 'batal') {
          return {
            status: 409,
            code: 'BOOKING_CANCELLED',
            error: 'Pesanan yang telah dibatalkan tidak dapat menukarkan voucher.',
          };
        }

        // Validate booking voucher linkage fields structure
        for (const fieldName of ['promoId', 'promoCode', 'promoCodeSnapshot', 'voucherId', 'voucherCode'] as const) {
          const val = bookingData[fieldName];
          if (val !== undefined && val !== null && val !== '') {
            if (typeof val !== 'string' || /[\/\\\x00-\x1F\x7F]/.test(val) || Buffer.byteLength(val, 'utf8') > 256) {
              return {
                status: 409,
                code: 'VOUCHER_LINKAGE_INVALID',
                error: 'Data referensi voucher pada pesanan tidak valid.',
              };
            }
          }
        }

        const rawBookingVoucherId = typeof bookingData.voucherId === 'string' ? bookingData.voucherId.trim() : '';
        const rawBookingPromoId = typeof bookingData.promoId === 'string' ? bookingData.promoId.trim() : '';
        const rawBookingVoucherCode = typeof bookingData.voucherCode === 'string' ? bookingData.voucherCode.trim().toUpperCase() : '';
        const rawBookingPromoCode = typeof bookingData.promoCode === 'string' ? bookingData.promoCode.trim().toUpperCase() : '';
        const rawBookingPromoSnapshot = typeof bookingData.promoCodeSnapshot === 'string' ? bookingData.promoCodeSnapshot.trim().toUpperCase() : '';

        if (rawBookingPromoCode && rawBookingPromoSnapshot && rawBookingPromoCode !== rawBookingPromoSnapshot) {
          return {
            status: 409,
            code: 'VOUCHER_LINKAGE_CONFLICT',
            error: 'Konflik kode promo pada data pesanan.',
          };
        }

        const rawBookingCustomerVoucherId =
          typeof bookingData.customerVoucherId === 'string' ? bookingData.customerVoucherId.trim() : '';
        const personalCvId = rawBookingCustomerVoucherId.startsWith('cv_')
          ? rawBookingCustomerVoucherId
          : rawBookingVoucherId.startsWith('cv_')
            ? rawBookingVoucherId
            : rawBookingPromoId.startsWith('cv_')
              ? rawBookingPromoId
              : suppliedVoucherId.startsWith('cv_') && (!rawBookingVoucherId || rawBookingVoucherId === suppliedVoucherId)
                ? suppliedVoucherId
                : '';

        if (
          rawBookingPromoId &&
          !rawBookingPromoId.startsWith('cv_') &&
          rawBookingVoucherId &&
          !rawBookingVoucherId.startsWith('cv_') &&
          rawBookingPromoId !== rawBookingVoucherId
        ) {
          return {
            status: 409,
            code: 'VOUCHER_LINKAGE_CONFLICT',
            error: 'Konflik ID voucher pada data pesanan.',
          };
        }

        const generalPromoId =
          rawBookingPromoId && !rawBookingPromoId.startsWith('cv_')
            ? rawBookingPromoId
            : !personalCvId && rawBookingVoucherId && !rawBookingVoucherId.startsWith('cv_')
              ? rawBookingVoucherId
              : '';

        if (!personalCvId) {
          const nonEmptyCodes = new Set(
            [rawBookingPromoCode, rawBookingPromoSnapshot, rawBookingVoucherCode].filter(Boolean)
          );
          if (nonEmptyCodes.size > 1) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Konflik kode voucher pada data pesanan.',
            };
          }
          const singleBookingCode = [...nonEmptyCodes][0] || '';
          if (!singleBookingCode && !generalPromoId) {
            return {
              status: 409,
              code: 'VOUCHER_BOOKING_MISMATCH',
              error: 'Pesanan ini tidak memiliki voucher yang diterapkan.',
            };
          }
          if (singleBookingCode && singleBookingCode !== code) {
            return {
              status: 409,
              code: 'VOUCHER_BOOKING_MISMATCH',
              error: 'Kode voucher tidak sesuai dengan pesanan.',
            };
          }
        } else {
          const candidateCodes = [rawBookingPromoCode, rawBookingPromoSnapshot, rawBookingVoucherCode].filter(Boolean);
          if (candidateCodes.length > 0 && !candidateCodes.includes(code) && !personalCvId) {
            return {
              status: 409,
              code: 'VOUCHER_BOOKING_MISMATCH',
              error: 'Kode voucher tidak sesuai dengan pesanan.',
            };
          }
        }

        // Trusted receipt replay depends on current owned booking linkage, not current prices or public ledger.
        const replayReceiptSnap = await transaction.get(receiptRef);
        if (snapExists(replayReceiptSnap)) {
          const receipt = replayReceiptSnap.data() || {};
          const receiptValid = receipt.schemaVersion === 1
            && receipt.redemptionId === redemptionId
            && receipt.bookingId === bookingId
            && receipt.voucherCode === code
            && receipt.customerAuthUid === verifiedUid
            && isValidDocId(receipt.voucherId, 128)
            && isFinitePositiveNumber(receipt.discountAmount)
            && typeof receipt.committedAt === 'string'
            && receipt.committedAt.trim().length > 0
            && !Number.isNaN(Date.parse(receipt.committedAt));
          if (!receiptValid) return { status: 409, code: 'VOUCHER_RECEIPT_CONFLICT', error: 'Bukti penukaran voucher bertentangan atau rusak.' };

          const expectedGeneralCode = rawBookingPromoCode || rawBookingPromoSnapshot || (!personalCvId ? rawBookingVoucherCode : '');
          const replayGeneral = generalPromoId
            ? generalPromoId === receipt.voucherId && (!expectedGeneralCode || expectedGeneralCode === code)
            : !personalCvId && expectedGeneralCode === code;
          let replayPersonal = false;
          if (personalCvId && (!replayGeneral || rawBookingVoucherCode === code || suppliedVoucherId === personalCvId)) {
            const cvSnap = await transaction.get(adminDb.collection('customer_vouchers').doc(personalCvId));
            if (!snapExists(cvSnap)) return { status: 409, code: 'VOUCHER_LINKAGE_CONFLICT', error: 'Referensi voucher personal tidak dapat diverifikasi.' };
            const cv = cvSnap.data() || {};
            const cvCode = typeof cv.voucherCode === 'string' ? cv.voucherCode.trim().toUpperCase() : rawBookingVoucherCode;
            const cvUidFields = [cv.customerAuthUid, cv.authUserId];
            const cvUidConsistent = cvUidFields.every(value => value === undefined || value === null || value === '' || value === verifiedUid);
            const cvHasDirectUid = cv.customerAuthUid === verifiedUid || cv.authUserId === verifiedUid;
            const cvOwner = typeof cv.customerId === 'string' ? cv.customerId.trim() : '';
            let cvOwned = Boolean(cvOwner) && (cvOwner === verifiedUid || (cvHasDirectUid && cvUidConsistent));
            const parentCustomerId = typeof bookingData.customerId === 'string' ? bookingData.customerId.trim() : '';
            if (!cvOwned && cvOwner && cvOwner === parentCustomerId && isValidDocId(parentCustomerId, 128)) {
              const profileSnap = await transaction.get(adminDb.collection('customers').doc(parentCustomerId));
              if (snapExists(profileSnap)) {
                const profile = profileSnap.data() || {};
                const owners = [profile.customerAuthUid, profile.authUserId];
                cvOwned = owners.some(value => value === verifiedUid)
                  && owners.every(value => value === undefined || value === null || value === '' || value === verifiedUid);

              }
            }
            replayPersonal = cvUidConsistent && cvOwned && cv.voucherId === receipt.voucherId && cvCode === code
              && (cv.bookingId === undefined || cv.bookingId === null || cv.bookingId === '' || cv.bookingId === bookingId);
            if (!replayPersonal) return { status: 409, code: 'VOUCHER_LINKAGE_CONFLICT', error: 'Voucher personal bertentangan dengan bukti penukaran server.' };
          }
          if ((!replayGeneral && !replayPersonal)
            || (suppliedVoucherId && suppliedVoucherId !== receipt.voucherId && !(replayPersonal && suppliedVoucherId === personalCvId))) {
            return { status: 409, code: 'VOUCHER_LINKAGE_CONFLICT', error: 'Bukti penukaran tidak sesuai dengan referensi voucher pesanan.' };
          }
          return { status: 200, isIdempotent: true, redemptionId, discountAmount: receipt.discountAmount };
        }

        // --- PHASE 2: COMPLETE ALL REMAINING TRANSACTION READS BEFORE ANY WRITES ---
        const redemptionSnap = await transaction.get(redemptionRef);
        const vouchersByCodeSnap = await transaction.get(
          adminDb.collection('vouchers').where('code', '==', code)
        );

        const generalPromoDocSnap =
          generalPromoId && isValidDocId(generalPromoId, 128)
            ? await transaction.get(adminDb.collection('vouchers').doc(generalPromoId))
            : null;

        const personalCvRef =
          personalCvId && isValidDocId(personalCvId, 128)
            ? adminDb.collection('customer_vouchers').doc(personalCvId)
            : null;
        const personalCvSnap = personalCvRef ? await transaction.get(personalCvRef) : null;

        const cvDataRaw = personalCvSnap && snapExists(personalCvSnap) ? personalCvSnap.data() || {} : null;
        const cvMasterId =
          cvDataRaw && typeof cvDataRaw.voucherId === 'string' && isValidDocId(cvDataRaw.voucherId.trim(), 128)
            ? cvDataRaw.voucherId.trim()
            : '';
        const cvMasterDocSnap = cvMasterId
          ? await transaction.get(adminDb.collection('vouchers').doc(cvMasterId))
          : null;

        // If booking has both personal voucher and a separate general promo code, also read the other promo by code if needed
        const effectiveBookingPromoCode = rawBookingPromoCode || rawBookingPromoSnapshot;
        const otherPromoCodeToLookup =
          personalCvId && effectiveBookingPromoCode && effectiveBookingPromoCode !== code
            ? effectiveBookingPromoCode
            : '';
        const otherPromoByCodeSnap = otherPromoCodeToLookup
          ? await transaction.get(adminDb.collection('vouchers').where('code', '==', otherPromoCodeToLookup))
          : null;

        const serviceId = typeof bookingData.serviceId === 'string' ? bookingData.serviceId.trim() : '';
        const serviceSnap =
          serviceId && isValidDocId(serviceId, 128)
            ? await transaction.get(adminDb.collection('services').doc(serviceId))
            : null;

        // Read customer profiles bound to verifiedUid
        const custByAuthUserSnap = await transaction.get(
          adminDb.collection('customers').where('authUserId', '==', verifiedUid)
        );
        const custByCanonicalSnap = await transaction.get(
          adminDb.collection('customers').where('customerAuthUid', '==', verifiedUid)
        );

        const bookingCustomerId =
          typeof bookingData.customerId === 'string' && isValidDocId(bookingData.customerId.trim(), 128)
            ? bookingData.customerId.trim()
            : '';
        const bookingCustomerDocSnap = bookingCustomerId
          ? await transaction.get(adminDb.collection('customers').doc(bookingCustomerId))
          : null;

        // Collect candidate customer IDs for loyalty account lookup
        const ownedCustomerDocsMap = new Map<string, any>();
        for (const d of [...(custByAuthUserSnap?.docs || []), ...(custByCanonicalSnap?.docs || [])]) {
          if (snapExists(d)) ownedCustomerDocsMap.set(d.id, d);
        }

        const candidateLoyaltyCustomerIds = new Set<string>([verifiedUid]);
        for (const cid of ownedCustomerDocsMap.keys()) {
          if (isValidDocId(cid, 128)) candidateLoyaltyCustomerIds.add(cid);
        }
        if (bookingCustomerId) candidateLoyaltyCustomerIds.add(bookingCustomerId);

        const loyaltyAccountSnaps = new Map<string, any>();
        for (const cid of candidateLoyaltyCustomerIds) {
          const laSnap = await transaction.get(adminDb.collection('loyalty_accounts').doc(cid));
          if (snapExists(laSnap)) {
            loyaltyAccountSnaps.set(cid, laSnap);
          }
        }

        const loyaltySettingsSnap = await transaction.get(
          adminDb.collection('loyalty_settings').doc('general')
        );

        // Read candidate membership tier documents
        const candidateTierIds = new Set<string>(['member']);
        for (const laSnap of loyaltyAccountSnaps.values()) {
          const tId = laSnap.data()?.currentTierId;
          if (typeof tId === 'string' && isValidDocId(tId.trim().toLowerCase(), 64)) {
            candidateTierIds.add(tId.trim().toLowerCase());
          }
        }
        if (typeof bookingData.membershipTierAtBooking === 'string') {
          const bt = bookingData.membershipTierAtBooking.trim().toLowerCase();
          if (isValidDocId(bt, 64)) candidateTierIds.add(bt);
        }
        const membershipTierSnaps = new Map<string, any>();
        for (const tId of candidateTierIds) {
          const tSnap = await transaction.get(adminDb.collection('membership_tiers').doc(tId));
          if (snapExists(tSnap)) {
            membershipTierSnaps.set(tId, tSnap);
          }
        }

        // Read lock documents & redemption/booking history for quota and first-order validation
        const uidLockRef = adminDb.collection('voucher_redemptions').doc(`vlock_${code}_uid_${verifiedUid}`);
        const uidLockSnap = await transaction.get(uidLockRef);

        const custLockRefs = new Map<string, any>();
        const custLockSnaps = new Map<string, any>();
        for (const cid of candidateLoyaltyCustomerIds) {
          const ref = adminDb.collection('voucher_redemptions').doc(`vlock_${code}_cust_${cid}`);
          custLockRefs.set(cid, ref);
          custLockSnaps.set(cid, await transaction.get(ref));
        }

        const bookingPhoneRaw = typeof bookingData.customerWhatsApp === 'string'
          ? bookingData.customerWhatsApp.trim()
          : typeof bookingData.customerPhone === 'string'
            ? bookingData.customerPhone.trim()
            : '';
        const { cleanDigits: bookingPhoneDigits } = normalizeIndonesianPhoneServer(bookingPhoneRaw);
        const phoneLockRef =
          bookingPhoneDigits && isValidDocId(bookingPhoneDigits, 64)
            ? adminDb.collection('voucher_redemptions').doc(`vlock_${code}_phone_${bookingPhoneDigits}`)
            : null;
        const phoneLockSnap = phoneLockRef ? await transaction.get(phoneLockRef) : null;

        const redemptionsByCodeSnap = await transaction.get(
          adminDb.collection('voucher_redemptions').where('voucherCode', '==', code)
        );

        const singleCodeMasterId =
          vouchersByCodeSnap?.docs?.length === 1 ? vouchersByCodeSnap.docs[0].id : '';
        const redemptionsByMasterIdSnap =
          singleCodeMasterId && isValidDocId(singleCodeMasterId, 128)
            ? await transaction.get(
                adminDb.collection('voucher_redemptions').where('voucherId', '==', singleCodeMasterId)
              )
            : null;

        const bookingsByCanonicalSnap = await transaction.get(
          adminDb.collection('bookings').where('customerAuthUid', '==', verifiedUid)
        );
        const bookingsByLegacySnap = await transaction.get(
          adminDb.collection('bookings').where('authUserId', '==', verifiedUid)
        );
        const bookingsByCustIdSnaps = new Map<string, any>();
        for (const cid of ownedCustomerDocsMap.keys()) {
          if (isValidDocId(cid, 128)) {
            bookingsByCustIdSnaps.set(
              cid,
              await transaction.get(adminDb.collection('bookings').where('customerId', '==', cid))
            );
          }
        }

        // --- PHASE 3: PURE VALIDATION & DISCOUNT RECALCULATION (ZERO READS AFTER THIS POINT) ---

        // 3A. Customer Profile Ownership & Conflict Validation
        if (ownedCustomerDocsMap.size > 1) {
          return {
            status: 409,
            code: 'CUSTOMER_OWNERSHIP_CONFLICT',
            error: 'Kepemilikan profil pelanggan ambigu dan memerlukan peninjauan.',
          };
        }

        let verifiedCustomerId = '';
        let verifiedCustomerData: any = null;

        if (ownedCustomerDocsMap.size === 1) {
          const [cid, cSnap] = [...ownedCustomerDocsMap.entries()][0];
          const cData = cSnap.data() || {};
          if (
            (cData.authUserId !== undefined && cData.authUserId !== null && cData.authUserId !== '' && cData.authUserId !== verifiedUid) ||
            (cData.customerAuthUid !== undefined && cData.customerAuthUid !== null && cData.customerAuthUid !== '' && cData.customerAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              error: 'Akses ditolak. Kepemilikan akun pelanggan tidak konsisten.',
            };
          }
          if (bookingCustomerId && bookingCustomerId !== cid && bookingCustomerId !== cData.id) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              error: 'Akses ditolak. Identitas pelanggan pesanan tidak sesuai dengan profil akun.',
            };
          }
          verifiedCustomerId = cid;
          verifiedCustomerData = cData;
        } else if (bookingCustomerDocSnap && snapExists(bookingCustomerDocSnap)) {
          const bcData = bookingCustomerDocSnap.data() || {};
          const bcAuthUid = bcData.authUserId;
          const bcCustAuthUid = bcData.customerAuthUid;
          if (
            (bcAuthUid !== undefined && bcAuthUid !== null && bcAuthUid !== '' && bcAuthUid !== verifiedUid) ||
            (bcCustAuthUid !== undefined && bcCustAuthUid !== null && bcCustAuthUid !== '' && bcCustAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_DENIED',
              error: 'Akses ditolak. Profil pelanggan pesanan dimiliki oleh akun lain.',
            };
          }
          if (bcAuthUid === verifiedUid || bcCustAuthUid === verifiedUid) {
            verifiedCustomerId = bookingCustomerDocSnap.id;
            verifiedCustomerData = bcData;
          }
        }

        // 3B. Authoritative Master Catalog Lookup for Requested Code
        const matchingMasterDocs = vouchersByCodeSnap?.docs || [];
        if (matchingMasterDocs.length > 1) {
          return {
            status: 409,
            code: 'AMBIGUOUS_VOUCHER_CODE',
            error: 'Kode voucher duplikat ditemukan di katalog master.',
          };
        }
        if (matchingMasterDocs.length === 0) {
          return {
            status: 404,
            code: 'VOUCHER_NOT_FOUND',
            error: 'Kode voucher tidak ditemukan dalam katalog resmi.',
          };
        }

        const targetMasterSnap = matchingMasterDocs[0];
        const targetMasterRef = targetMasterSnap.ref;
        const targetMasterId = targetMasterSnap.id;
        const targetMasterData = targetMasterSnap.data() || {};

        if (
          !isValidDocId(targetMasterId, 128) ||
          (targetMasterData.id !== undefined && targetMasterData.id !== targetMasterId) ||
          typeof targetMasterData.code !== 'string' ||
          targetMasterData.code.trim().toUpperCase() !== code
        ) {
          return {
            status: 409,
            code: 'VOUCHER_LINKAGE_CONFLICT',
            error: 'Data master voucher tidak konsisten dengan kode voucher.',
          };
        }

        // 3C. Personal Voucher (cv_) & General Promo Linkage Validation
        let resolvedPersonalCv: any = null;
        let resolvedPersonalCvMaster: any = null;
        let resolvedPersonalCvCode = '';

        if (personalCvId) {
          if (!personalCvSnap || !snapExists(personalCvSnap)) {
            return {
              status: 404,
              code: 'CUSTOMER_VOUCHER_NOT_FOUND',
              error: 'Voucher personal pelanggan tidak ditemukan.',
            };
          }
          const cvData = personalCvSnap.data() || {};
          if (
            (cvData.authUserId !== undefined && cvData.authUserId !== null && cvData.authUserId !== '' && cvData.authUserId !== verifiedUid) ||
            (cvData.customerAuthUid !== undefined && cvData.customerAuthUid !== null && cvData.customerAuthUid !== '' && cvData.customerAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_VOUCHER_OWNERSHIP_DENIED',
              error: 'Voucher personal ini bukan milik akun Anda.',
            };
          }

          const cvOwnerCustomerId = typeof cvData.customerId === 'string' ? cvData.customerId.trim() : '';
          const cvHasVerifiedUidBinding =
            cvData.customerAuthUid === verifiedUid || cvData.authUserId === verifiedUid;
          const cvOwnerAllowed = Boolean(cvOwnerCustomerId) && (
            cvOwnerCustomerId === verifiedUid ||
            (verifiedCustomerId && cvOwnerCustomerId === verifiedCustomerId) ||
            cvHasVerifiedUidBinding
          );
          if (!cvOwnerAllowed) {
            return {
              status: 403,
              code: 'CUSTOMER_VOUCHER_OWNERSHIP_DENIED',
              error: 'Kepemilikan voucher personal tidak sesuai dengan akun Anda.',
            };
          }

          if (!cvMasterId || !cvMasterDocSnap || !snapExists(cvMasterDocSnap)) {
            return {
              status: 404,
              code: 'VOUCHER_NOT_FOUND',
              error: 'Master voucher untuk voucher personal tidak ditemukan.',
            };
          }

          resolvedPersonalCvMaster = cvMasterDocSnap.data() || {};
          const cvMasterCode =
            typeof resolvedPersonalCvMaster.code === 'string'
              ? resolvedPersonalCvMaster.code.trim().toUpperCase()
              : '';
          const cvDocCode =
            typeof cvData.voucherCode === 'string' ? cvData.voucherCode.trim().toUpperCase() : '';

          if (cvDocCode && cvMasterCode && cvDocCode !== cvMasterCode) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Kode voucher personal tidak sesuai dengan master voucher.',
            };
          }
          resolvedPersonalCvCode = cvDocCode || cvMasterCode;

          if (
            rawBookingVoucherCode &&
            rawBookingVoucherCode !== resolvedPersonalCvCode &&
            rawBookingVoucherCode !== effectiveBookingPromoCode
          ) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Kode voucher pada pesanan tidak sesuai dengan voucher personal.',
            };
          }

          if (
            (cvData.voucherType && resolvedPersonalCvMaster.voucherType && cvData.voucherType !== resolvedPersonalCvMaster.voucherType) ||
            (cvData.value !== undefined && resolvedPersonalCvMaster.value !== undefined && cvData.value !== resolvedPersonalCvMaster.value)
          ) {
            return {
              status: 409,
              code: 'VOUCHER_LINKAGE_CONFLICT',
              error: 'Nilai voucher personal tidak konsisten dengan master voucher.',
            };
          }

          if (cvData.bookingId !== undefined && cvData.bookingId !== null && cvData.bookingId !== '' && cvData.bookingId !== bookingId) {
            return {
              status: 409,
              code: 'CUSTOMER_VOUCHER_ALREADY_USED',
              error: 'Voucher personal ini sudah digunakan pada pesanan lain.',
            };
          }
          if (
            cvData.bookingCode !== undefined &&
            cvData.bookingCode !== null &&
            cvData.bookingCode !== '' &&
            bookingData.bookingCode &&
            cvData.bookingCode !== bookingData.bookingCode
          ) {
            return {
              status: 409,
              code: 'CUSTOMER_VOUCHER_ALREADY_USED',
              error: 'Kode pesanan pada voucher personal tidak sesuai.',
            };
          }

          if (cvData.status === 'used') {
            if (cvData.bookingId !== bookingId) {
              return {
                status: 409,
                code: 'CUSTOMER_VOUCHER_ALREADY_USED',
                error: 'Voucher personal sudah pernah digunakan.',
              };
            }
          } else if (cvData.status !== 'available' && cvData.status !== 'reserved') {
            return {
              status: 409,
              code: 'CUSTOMER_VOUCHER_INELIGIBLE',
              error: 'Status voucher personal tidak dapat digunakan.',
            };
          }

          const cvExpiryStr = cvData.expiredAt || cvData.expiresAt;
          if (cvExpiryStr !== undefined && cvExpiryStr !== null && cvExpiryStr !== '') {
            if (typeof cvExpiryStr !== 'string' || Number.isNaN(Date.parse(cvExpiryStr)) || cvExpiryStr < nowIso) {
              return {
                status: 409,
                code: 'VOUCHER_EXPIRED',
                error: 'Voucher personal sudah kedaluwarsa.',
              };
            }
          }

          resolvedPersonalCv = {
            ...resolvedPersonalCvMaster,
            ...cvData,
            id: personalCvSnap.id,
            voucherId: cvMasterDocSnap.id,
            voucherCode: resolvedPersonalCvCode,
            voucherType: cvData.voucherType ?? resolvedPersonalCvMaster?.voucherType,
            value: cvData.value ?? resolvedPersonalCvMaster?.value,
          };
        }

        // Resolve general promo master voucher if applied on the booking
        let resolvedGeneralPromoMaster: any = null;
        let resolvedGeneralPromoId = '';
        let resolvedGeneralPromoCode = '';

        const hasSeparateGeneralPromo =
          Boolean(generalPromoId) ||
          (!personalCvId && Boolean(effectiveBookingPromoCode || rawBookingVoucherCode)) ||
          (Boolean(personalCvId) && Boolean(effectiveBookingPromoCode) && effectiveBookingPromoCode !== resolvedPersonalCvCode);

        if (hasSeparateGeneralPromo) {
          const expectedPromoCode =
            effectiveBookingPromoCode || (!personalCvId ? rawBookingVoucherCode || code : '');

          if (generalPromoId) {
            if (!generalPromoDocSnap || !snapExists(generalPromoDocSnap)) {
              return {
                status: 409,
                code: 'VOUCHER_LINKAGE_CONFLICT',
                error: 'Referensi promo pada pesanan tidak ditemukan di katalog master.',
              };
            }
            const gpData = generalPromoDocSnap.data() || {};
            const gpCode = typeof gpData.code === 'string' ? gpData.code.trim().toUpperCase() : '';
            if (!gpCode || (expectedPromoCode && gpCode !== expectedPromoCode)) {
              return {
                status: 409,
                code: 'VOUCHER_LINKAGE_CONFLICT',
                error: 'Kode promo pada pesanan tidak sesuai dengan ID promo master.',
              };
            }
            resolvedGeneralPromoMaster = { ...gpData, id: generalPromoDocSnap.id, code: gpCode };
            resolvedGeneralPromoId = generalPromoDocSnap.id;
            resolvedGeneralPromoCode = gpCode;
          } else if (expectedPromoCode === code) {
            resolvedGeneralPromoMaster = { ...targetMasterData, id: targetMasterId, code };
            resolvedGeneralPromoId = targetMasterId;
            resolvedGeneralPromoCode = code;
          } else if (otherPromoByCodeSnap) {
            if ((otherPromoByCodeSnap.docs || []).length !== 1) {
              return {
                status: 409,
                code: 'VOUCHER_LINKAGE_CONFLICT',
                error: 'Kode promo pendamping pada pesanan tidak valid atau ambigu.',
              };
            }
            const opSnap = otherPromoByCodeSnap.docs[0];
            const opData = opSnap.data() || {};
            resolvedGeneralPromoMaster = {
              ...opData,
              id: opSnap.id,
              code: expectedPromoCode,
            };
            resolvedGeneralPromoId = opSnap.id;
            resolvedGeneralPromoCode = expectedPromoCode;
          }
        }

        const isRedeemingGeneralPromo =
          Boolean(resolvedGeneralPromoMaster) &&
          resolvedGeneralPromoCode === code &&
          resolvedGeneralPromoId === targetMasterId;

        const isRedeemingPersonalCv =
          Boolean(resolvedPersonalCv) &&
          resolvedPersonalCvCode === code &&
          cvMasterId === targetMasterId;

        if (!isRedeemingGeneralPromo && !isRedeemingPersonalCv) {
          return {
            status: 409,
            code: 'VOUCHER_BOOKING_MISMATCH',
            error: 'Voucher yang diminta tidak sesuai dengan referensi voucher pada pesanan.',
          };
        }

        if (
          suppliedVoucherId &&
          suppliedVoucherId !== targetMasterId &&
          !(isRedeemingPersonalCv && suppliedVoucherId === personalCvId)
        ) {
          return {
            status: 409,
            code: 'VOUCHER_LINKAGE_CONFLICT',
            error: 'ID voucher pada permintaan bertentangan dengan pesanan.',
          };
        }

        // 3D. Authoritative Price, Fee, Tier & Settings Resolution (Server-Derived Discount)
        if (!serviceSnap || !snapExists(serviceSnap)) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Layanan pesanan tidak ditemukan dalam katalog resmi. Penukaran memerlukan peninjauan.',
          };
        }
        const serviceData = serviceSnap.data() || {};
        const authoritativeServicePrice = serviceData.price;
        if (!isFinitePositiveNumber(authoritativeServicePrice)) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Harga layanan resmi tidak dapat diverifikasi.',
          };
        }

        if (
          bookingData.servicePrice !== undefined &&
          bookingData.servicePrice !== null &&
          bookingData.servicePrice !== authoritativeServicePrice
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Harga layanan pada pesanan berbeda dari katalog resmi dan memerlukan peninjauan.',
          };
        }
        if (
          bookingData.servicePriceSnapshot !== undefined &&
          bookingData.servicePriceSnapshot !== null &&
          bookingData.servicePriceSnapshot !== authoritativeServicePrice
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Snapshot harga layanan tidak dapat diverifikasi secara otomatis.',
          };
        }
        if (
          bookingData.serviceDuration !== undefined &&
          bookingData.serviceDuration !== null &&
          isFinitePositiveNumber(serviceData.duration) &&
          bookingData.serviceDuration !== serviceData.duration
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Durasi layanan pada pesanan tidak konsisten dengan katalog resmi.',
          };
        }

        // Resolve Loyalty Settings
        const rawLoyaltySettings =
          loyaltySettingsSnap && snapExists(loyaltySettingsSnap) ? loyaltySettingsSnap.data() || {} : {};
        if (
          rawLoyaltySettings.allowStacking !== undefined &&
          typeof rawLoyaltySettings.allowStacking !== 'boolean'
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Konfigurasi penggabungan voucher tidak valid.',
          };
        }
        const loyaltySettings = {
          ...DEFAULT_LOYALTY_SETTINGS,
          ...rawLoyaltySettings,
        };
        if (loyaltySettings.voucherEnabled === false) {
          return {
            status: 409,
            code: 'VOUCHER_DISABLED',
            error: 'Fitur penukaran voucher sedang dinonaktifkan.',
          };
        }

        // Resolve Customer Membership Tier
        const verifiedLoyaltySnap =
          (verifiedCustomerId && loyaltyAccountSnaps.get(verifiedCustomerId)) ||
          loyaltyAccountSnaps.get(verifiedUid) ||
          null;
        const verifiedLoyaltyData = verifiedLoyaltySnap ? verifiedLoyaltySnap.data() || {} : null;

        let resolvedTierId = 'member';
        if (verifiedLoyaltyData) {
          if (verifiedLoyaltyData.status === 'suspended' || verifiedLoyaltyData.status === 'closed') {
            return {
              status: 403,
              code: 'LOYALTY_ACCOUNT_INACTIVE',
              error: 'Akun loyalitas pelanggan sedang tidak aktif.',
            };
          }
          if (typeof verifiedLoyaltyData.currentTierId === 'string' && verifiedLoyaltyData.currentTierId.trim()) {
            resolvedTierId = verifiedLoyaltyData.currentTierId.trim().toLowerCase();
          }
        }

        const tierSnapFromDb = membershipTierSnaps.get(resolvedTierId);
        const resolvedTier: any = tierSnapFromDb
          ? tierSnapFromDb.data()
          : DEFAULT_MEMBERSHIP_TIERS.find((t) => t.id.toLowerCase() === resolvedTierId) || null;

        if (
          !resolvedTier ||
          !isFiniteNonNegativeNumber(resolvedTier.discountPercentage) ||
          resolvedTier.discountPercentage > 100
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Data tier keanggotaan pelanggan tidak dapat diverifikasi.',
          };
        }

        if (
          bookingData.membershipTierAtBooking !== undefined &&
          bookingData.membershipTierAtBooking !== null &&
          String(bookingData.membershipTierAtBooking).trim() !== ''
        ) {
          const bookingTierNorm = String(bookingData.membershipTierAtBooking).trim().toLowerCase();
          const tierIdNorm = String(resolvedTier.id || '').trim().toLowerCase();
          const tierNameNorm = String(resolvedTier.name || '').trim().toLowerCase();
          if (bookingTierNorm !== tierIdNorm && bookingTierNorm !== tierNameNorm) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Tier keanggotaan pada saat pemesanan berbeda dan memerlukan peninjauan.',
            };
          }
        }

        // Validate Voucher Type & Numeric Configuration Before Pricing
        const normalizeSupportedVoucherType = (vType: unknown): 'fixed_discount' | 'percentage_discount' | 'free_home_service_fee' | null => {
          if (vType === 'fixed_discount' || vType === 'FIXED_AMOUNT') return 'fixed_discount';
          if (vType === 'percentage_discount' || vType === 'percentage' || vType === 'PERCENTAGE') return 'percentage_discount';
          if (vType === 'free_home_service_fee') return 'free_home_service_fee';
          return null;
        };

        const validateVoucherNumbers = (vObj: any): {
          ok: boolean;
          normalizedType?: 'fixed_discount' | 'percentage_discount' | 'free_home_service_fee';
          code?: string;
          error?: string;
        } => {
          const normType = normalizeSupportedVoucherType(vObj?.voucherType);
          if (!normType) {
            return {
              ok: false,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Tipe voucher tidak mendukung perhitungan potongan otomatis.',
            };
          }
          if (normType === 'fixed_discount') {
            if (!isFinitePositiveNumber(vObj.value)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Nilai potongan voucher tidak valid.' };
            }
          } else if (normType === 'percentage_discount') {
            if (!isFinitePositiveNumber(vObj.value) || vObj.value > 100) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Persentase potongan voucher tidak valid.' };
            }
            if (vObj.maximumDiscount !== undefined && vObj.maximumDiscount !== null && !isFinitePositiveNumber(vObj.maximumDiscount)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas maksimum potongan voucher tidak valid.' };
            }
          } else if (normType === 'free_home_service_fee') {
            if (vObj.value !== undefined && vObj.value !== null && !isFiniteNonNegativeNumber(vObj.value)) {
              return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Nilai voucher ongkir tidak valid.' };
            }
          }

          if (vObj.minimumSpend !== undefined && vObj.minimumSpend !== null && !isFiniteNonNegativeNumber(vObj.minimumSpend)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas minimum transaksi voucher tidak valid.' };
          }
          if (vObj.minimumTreatmentPrice !== undefined && vObj.minimumTreatmentPrice !== null && !isFiniteNonNegativeNumber(vObj.minimumTreatmentPrice)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas harga minimum layanan tidak valid.' };
          }
          if (vObj.minimumTreatmentDuration !== undefined && vObj.minimumTreatmentDuration !== null && !isFiniteNonNegativeNumber(vObj.minimumTreatmentDuration)) {
            return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Batas durasi minimum layanan tidak valid.' };
          }
          return { ok: true, normalizedType: normType };
        };

        const targetCheck = validateVoucherNumbers(targetMasterData);
        if (!targetCheck.ok) {
          return { status: 409, code: targetCheck.code, error: targetCheck.error };
        }

        if (resolvedGeneralPromoMaster) {
          const gpCheck = validateVoucherNumbers(resolvedGeneralPromoMaster);
          if (!gpCheck.ok) return { status: 409, code: gpCheck.code, error: gpCheck.error };
        }
        if (resolvedPersonalCv) {
          const cvCheck = validateVoucherNumbers(resolvedPersonalCv);
          if (!cvCheck.ok) return { status: 409, code: cvCheck.code, error: cvCheck.error };
        }

        // Establish Home Service Fee Safely
        const needsVerifiedHomeServiceFee =
          targetCheck.normalizedType === 'free_home_service_fee' ||
          normalizeSupportedVoucherType(resolvedGeneralPromoMaster?.voucherType) === 'free_home_service_fee' ||
          normalizeSupportedVoucherType(resolvedPersonalCv?.voucherType) === 'free_home_service_fee';

        let authoritativeHomeServiceFee = 0;
        if (needsVerifiedHomeServiceFee) {
          const lat = bookingData.latitude ?? bookingData.customerLat;
          const lng = bookingData.longitude ?? bookingData.customerLng;
          const distKm = bookingData.distanceKm;
          const persistedFee = bookingData.homeServiceFee;

          if (
            typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
            typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
            typeof distKm !== 'number' || !Number.isFinite(distKm) || distKm < 0 ||
            !isFinitePositiveNumber(persistedFee)
          ) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Biaya home service untuk voucher ini memerlukan peninjauan.',
            };
          }

          const minStraightKm = calculateStraightDistanceKm(
            SENZU_BASE_LOCATION.lat,
            SENZU_BASE_LOCATION.lng,
            lat,
            lng
          );
          if (distKm < minStraightKm * 0.95 || (minStraightKm > 0.2 && distKm === 0)) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Jarak lokasi pesanan tidak dapat diverifikasi untuk potongan biaya home service.',
            };
          }

          const feeFromDist = calculateHomeServiceFee(distKm).fee;
          const feeFromStraight = calculateHomeServiceFee(minStraightKm).fee;
          if (feeFromDist !== persistedFee || feeFromStraight !== feeFromDist) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Nominal biaya home service memerlukan peninjauan.',
            };
          }
          authoritativeHomeServiceFee = feeFromDist;
        } else if (bookingData.homeServiceFee !== undefined && bookingData.homeServiceFee !== null) {
          if (!isFiniteNonNegativeNumber(bookingData.homeServiceFee)) {
            return {
              status: 409,
              code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
              error: 'Data biaya home service pada pesanan tidak valid.',
            };
          }
          authoritativeHomeServiceFee = bookingData.homeServiceFee;
        }

        // Prepare inputs for unchanged calculateBookingPrice
        const promoForCalc = resolvedGeneralPromoMaster
          ? {
              ...resolvedGeneralPromoMaster,
              minimumSpend: Math.max(
                resolvedGeneralPromoMaster.minimumSpend || 0,
                resolvedGeneralPromoMaster.minimumTreatmentPrice || 0
              ),
              enabled: true,
            }
          : null;

        const cvForCalc = resolvedPersonalCv
          ? {
              ...resolvedPersonalCv,
              voucherType: normalizeSupportedVoucherType(resolvedPersonalCv.voucherType) || resolvedPersonalCv.voucherType,
              minimumSpend: Math.max(
                resolvedPersonalCv.minimumSpend || 0,
                resolvedPersonalCvMaster?.minimumSpend || 0,
                resolvedPersonalCvMaster?.minimumTreatmentPrice || 0
              ),
              maximumDiscount: resolvedPersonalCv.maximumDiscount ?? resolvedPersonalCvMaster?.maximumDiscount,
              status: 'available' as const,
            }
          : null;

        const pricingBreakdown = calculateBookingPrice({
          servicePrice: authoritativeServicePrice,
          homeServiceFee: authoritativeHomeServiceFee,
          promoVoucher: promoForCalc,
          customerVoucher: cvForCalc,
          customerTier: resolvedTier,
          settings: loyaltySettings,
        });

        if (
          promoForCalc &&
          cvForCalc &&
          loyaltySettings.allowStacking &&
          pricingBreakdown.promoDiscountAmount + pricingBreakdown.voucherDiscountAmount >
            pricingBreakdown.totalPromoAndVoucherDiscount
        ) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Kombinasi diskon melebihi nilai pesanan dan memerlukan peninjauan.',
          };
        }

        let serverDerivedDiscountAmount = 0;
        if (isRedeemingGeneralPromo && !isRedeemingPersonalCv) {
          serverDerivedDiscountAmount = Math.min(
            pricingBreakdown.promoDiscountAmount,
            pricingBreakdown.totalPromoAndVoucherDiscount
          );
        } else if (isRedeemingPersonalCv && !isRedeemingGeneralPromo) {
          serverDerivedDiscountAmount = Math.min(
            pricingBreakdown.voucherDiscountAmount,
            pricingBreakdown.totalPromoAndVoucherDiscount
          );
        } else {
          serverDerivedDiscountAmount =
            pricingBreakdown.promoDiscountAmount > 0
              ? pricingBreakdown.promoDiscountAmount
              : pricingBreakdown.voucherDiscountAmount;
        }

        // Legacy or client-created voucher_redemptions record without trusted private receipt
        if (snapExists(redemptionSnap)) {
          return {
            status: 409,
            code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED',
            error: 'Catatan penukaran tanpa tanda terima server ditemukan dan memerlukan peninjauan.',
          };
        }

        // 3F. New-Commit Eligibility, Restrictions, Quotas & Lock Reservations
        if (targetMasterData.enabled !== true) {
          return {
            status: 409,
            code: 'VOUCHER_INACTIVE',
            error: 'Voucher sedang tidak aktif.',
          };
        }

        if (targetMasterData.validFrom !== undefined && targetMasterData.validFrom !== null && targetMasterData.validFrom !== '') {
          if (typeof targetMasterData.validFrom !== 'string' || Number.isNaN(Date.parse(targetMasterData.validFrom))) {
            return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Periode mulai voucher tidak valid.' };
          }
          if (targetMasterData.validFrom > nowIso) {
            return { status: 409, code: 'VOUCHER_NOT_YET_VALID', error: 'Periode promo belum dimulai.' };
          }
        }
        if (targetMasterData.validUntil !== undefined && targetMasterData.validUntil !== null && targetMasterData.validUntil !== '') {
          if (typeof targetMasterData.validUntil !== 'string' || Number.isNaN(Date.parse(targetMasterData.validUntil))) {
            return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Periode berakhir voucher tidak valid.' };
          }
          if (targetMasterData.validUntil < nowIso) {
            return { status: 409, code: 'VOUCHER_EXPIRED', error: 'Voucher sudah tidak berlaku.' };
          }
        }

        const minSpend = Math.max(
          targetMasterData.minimumSpend || 0,
          targetMasterData.minimumTreatmentPrice || 0
        );
        const priceAfterTier = Math.max(0, authoritativeServicePrice - pricingBreakdown.tierDiscountAmount);
        if (priceAfterTier < minSpend || authoritativeServicePrice < minSpend) {
          return {
            status: 409,
            code: 'VOUCHER_MINIMUM_SPEND_NOT_MET',
            error: `Minimum transaksi untuk promo ini adalah Rp ${minSpend.toLocaleString('id-ID')}.`,
          };
        }

        // Service / Category / Duration / Tier / Customer-Specific Restrictions
        const checkServiceIds = (ids: unknown): boolean => {
          if (ids === undefined || ids === null) return true;
          if (!Array.isArray(ids)) return false;
          if (ids.length === 0) return true;
          return ids.includes(serviceId);
        };
        if (!checkServiceIds(targetMasterData.applicableServiceIds) || (resolvedPersonalCv && !checkServiceIds(resolvedPersonalCv.applicableServiceIds))) {
          return {
            status: 409,
            code: 'VOUCHER_SERVICE_INELIGIBLE',
            error: 'Promo tidak berlaku untuk layanan yang dipilih.',
          };
        }

        if (targetMasterData.applicableCategoryIds !== undefined && targetMasterData.applicableCategoryIds !== null) {
          if (!Array.isArray(targetMasterData.applicableCategoryIds)) {
            return { status: 409, code: 'VOUCHER_CONFIG_INVALID', error: 'Konfigurasi kategori voucher tidak valid.' };
          }
          if (targetMasterData.applicableCategoryIds.length > 0) {
            const srvCatId = typeof serviceData.categoryId === 'string' ? serviceData.categoryId.trim() : '';
            const srvCatName = typeof serviceData.category === 'string' ? serviceData.category.trim() : '';
            if (
              (!srvCatId || !targetMasterData.applicableCategoryIds.includes(srvCatId)) &&
              (!srvCatName || !targetMasterData.applicableCategoryIds.includes(srvCatName))
            ) {
              return {
                status: 409,
                code: 'VOUCHER_CATEGORY_INELIGIBLE',
                error: 'Promo tidak berlaku untuk kategori layanan ini.',
              };
            }
          }
        }

        if (isFinitePositiveNumber(targetMasterData.minimumTreatmentDuration)) {
          if (!isFinitePositiveNumber(serviceData.duration) || serviceData.duration < targetMasterData.minimumTreatmentDuration) {
            return {
              status: 409,
              code: 'VOUCHER_DURATION_INELIGIBLE',
              error: `Promo memerlukan durasi layanan minimal ${targetMasterData.minimumTreatmentDuration} menit.`,
            };
          }
        }

        const checkTierIds = (ids: unknown): boolean => {
          if (ids === undefined || ids === null) return true;
          if (!Array.isArray(ids)) return false;
          if (ids.length === 0) return true;
          const lowerIds = ids.map((x) => String(x).trim().toLowerCase());
          return (
            lowerIds.includes(String(resolvedTier.id || '').trim().toLowerCase()) ||
            lowerIds.includes(String(resolvedTier.name || '').trim().toLowerCase())
          );
        };
        if (!checkTierIds(targetMasterData.applicableTierIds) || (resolvedPersonalCv && !checkTierIds(resolvedPersonalCv.applicableTierIds))) {
          return {
            status: 409,
            code: 'VOUCHER_TIER_INELIGIBLE',
            error: 'Promo tidak berlaku untuk tier keanggotaan Anda.',
          };
        }

        if (
          targetMasterData.customerSpecific === true ||
          (targetMasterData.customerId !== undefined && targetMasterData.customerId !== null && targetMasterData.customerId !== '')
        ) {
          const targetCust = typeof targetMasterData.customerId === 'string' ? targetMasterData.customerId.trim() : '';
          if (!targetCust || (targetCust !== verifiedUid && (!verifiedCustomerId || targetCust !== verifiedCustomerId))) {
            return {
              status: 403,
              code: 'VOUCHER_CUSTOMER_INELIGIBLE',
              error: 'Voucher khusus ini tidak ditujukan untuk akun Anda.',
            };
          }
        }

        if (!isFinitePositiveNumber(serverDerivedDiscountAmount)) {
          return {
            status: 409,
            code: 'VOUCHER_INELIGIBLE',
            error: 'Voucher tidak menghasilkan potongan yang valid pada pesanan ini.',
          };
        }

        // Validate Master Counter & Quota Fields as Finite Integers
        const rawCurrentUsage = targetMasterData.currentUsageCount ?? 0;
        if (!isFiniteNonNegativeInt(rawCurrentUsage)) {
          return {
            status: 409,
            code: 'VOUCHER_CONFIG_INVALID',
            error: 'Data penggunaan voucher tidak valid.',
          };
        }
        const currentUsageCount = rawCurrentUsage;

        const rawLimitTotal = targetMasterData.usageLimitTotal ?? 0;
        if (!isFiniteNonNegativeInt(rawLimitTotal)) {
          return {
            status: 409,
            code: 'VOUCHER_CONFIG_INVALID',
            error: 'Batas kuota total voucher tidak valid.',
          };
        }
        const usageLimitTotal = rawLimitTotal;

        const rawLimitPerCustomer =
          targetMasterData.usageLimitPerCustomer !== undefined && targetMasterData.usageLimitPerCustomer !== null
            ? targetMasterData.usageLimitPerCustomer
            : code === 'SENZUWELCOME'
              ? 1
              : 0;
        if (!isFiniteNonNegativeInt(rawLimitPerCustomer)) {
          return {
            status: 409,
            code: 'VOUCHER_CONFIG_INVALID',
            error: 'Batas kuota per pelanggan tidak valid.',
          };
        }
        const usageLimitPerCustomer = rawLimitPerCustomer;

        // Inspect Lock Documents (vlock_*)
        const validateLockSnap = (
          lSnap: any,
          isPhoneLock = false
        ): { ok: boolean; activeOtherBookingId?: string; isSameBooking?: boolean; code?: string; error?: string } => {
          if (!lSnap || !snapExists(lSnap)) {
            return { ok: true, activeOtherBookingId: '', isSameBooking: false };
          }
          const lData = lSnap.data() || {};
          const lStatus = typeof lData.status === 'string' ? lData.status.trim().toLowerCase() : 'active';
          if (lStatus === 'cancelled' || lStatus === 'batal') {
            return { ok: true, activeOtherBookingId: '', isSameBooking: false };
          }

          const lCode = typeof lData.voucherCode === 'string' ? lData.voucherCode.trim().toUpperCase() : '';
          if (lCode && lCode !== code) {
            return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'Data reservasi voucher tidak konsisten.' };
          }

          const lUid = typeof lData.customerAuthUid === 'string' ? lData.customerAuthUid.trim() : '';
          const lBookingId = typeof lData.bookingId === 'string' ? lData.bookingId.trim() : '';

          if (lBookingId === bookingId) {
            if (!lCode || (lUid && lUid !== verifiedUid)) {
              return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'Reservasi voucher pada pesanan ini tidak valid.' };
            }
            if (
              lData.voucherId !== undefined &&
              lData.voucherId !== null &&
              lData.voucherId !== '' &&
              lData.voucherId !== targetMasterId &&
              !(isRedeemingPersonalCv && lData.voucherId === personalCvId)
            ) {
              return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'ID reservasi voucher bertentangan.' };
            }
            return { ok: true, activeOtherBookingId: '', isSameBooking: true };
          }

          // Lock points to another booking (or missing bookingId)
          if (!isPhoneLock) {
            if (lUid && lUid !== verifiedUid) {
              return { ok: false, code: 'VOUCHER_LOCK_CONFLICT', error: 'Reservasi voucher bertentangan dengan pemilik akun.' };
            }
            return {
              ok: true,
              activeOtherBookingId: lBookingId || lSnap.id,
              isSameBooking: false,
            };
          }

          // For a phone lock pointing to another booking: if owned by verifiedUid, count as other booking; if foreign, never overwrite
          return {
            ok: true,
            activeOtherBookingId: lUid === verifiedUid ? lBookingId || lSnap.id : '',
            isSameBooking: false,
          };
        };

        const uidLockCheck = validateLockSnap(uidLockSnap, false);
        if (!uidLockCheck.ok) {
          return { status: 409, code: uidLockCheck.code, error: uidLockCheck.error };
        }

        const otherReservedBookingIds = new Set<string>();
        if (uidLockCheck.activeOtherBookingId) {
          otherReservedBookingIds.add(uidLockCheck.activeOtherBookingId);
        }

        if (verifiedCustomerId && custLockSnaps.has(verifiedCustomerId)) {
          const custLockCheck = validateLockSnap(custLockSnaps.get(verifiedCustomerId), false);
          if (!custLockCheck.ok) {
            return { status: 409, code: custLockCheck.code, error: custLockCheck.error };
          }
          if (custLockCheck.activeOtherBookingId) {
            otherReservedBookingIds.add(custLockCheck.activeOtherBookingId);
          }
        }

        let canWritePhoneLock = false;
        if (phoneLockSnap) {
          if (!snapExists(phoneLockSnap)) {
            canWritePhoneLock = true;
          } else {
            const pCheck = validateLockSnap(phoneLockSnap, true);
            if (!pCheck.ok) {
              return { status: 409, code: pCheck.code, error: pCheck.error };
            }
            if (pCheck.isSameBooking) {
              canWritePhoneLock = true;
            }
          }
        }

        // Combine voucher_redemptions docs (excluding vlock_* reservation locks)
        const allRedemptionDocs = new Map<string, any>();
        for (const d of [
          ...(redemptionsByCodeSnap?.docs || []),
          ...(redemptionsByMasterIdSnap?.docs || []),
        ]) {
          if (snapExists(d) && !d.id.startsWith('vlock_')) {
            allRedemptionDocs.set(d.id, d.data() || {});
          }
        }

        let activeGlobalRedemptionsCount = 0;
        const priorCustomerUseKeys = new Set<string>();

        for (const [rId, rData] of allRedemptionDocs.entries()) {
          if (rId === redemptionId || rData.bookingId === bookingId) continue;
          const rStatus = typeof rData.status === 'string' ? rData.status.trim().toLowerCase() : 'active';
          if (rStatus === 'cancelled' || rStatus === 'batal') continue;

          const rCode = typeof rData.voucherCode === 'string' ? rData.voucherCode.trim().toUpperCase() : '';
          const rVoucherId = typeof rData.voucherId === 'string' ? rData.voucherId.trim() : '';
          if (rCode !== code && rVoucherId !== targetMasterId) continue;

          activeGlobalRedemptionsCount++;

          const rUid = typeof rData.customerAuthUid === 'string' ? rData.customerAuthUid.trim() : '';
          const rCustId = typeof rData.customerId === 'string' ? rData.customerId.trim() : '';
          if (rUid === verifiedUid || (verifiedCustomerId && rCustId === verifiedCustomerId)) {
            priorCustomerUseKeys.add(rData.bookingId || rId);
          }
        }

        if (usageLimitTotal > 0) {
          const effectiveGlobalUsed = Math.max(currentUsageCount, activeGlobalRedemptionsCount);
          if (effectiveGlobalUsed >= usageLimitTotal) {
            return {
              status: 409,
              code: 'VOUCHER_QUOTA_EXHAUSTED',
              error: 'Kuota promo sudah habis.',
            };
          }
        }

        // Combine owned bookings (excluding current bookingId) for per-customer quota and first-order check
        const ownedBookingsMap = new Map<string, any>();
        for (const d of [
          ...(bookingsByCanonicalSnap?.docs || []),
          ...(bookingsByLegacySnap?.docs || []),
        ]) {
          if (!snapExists(d) || d.id === bookingId) continue;
          const b = d.data() || {};
          if (b.customerAuthUid && b.authUserId && b.customerAuthUid !== b.authUserId) continue;
          if (b.customerAuthUid && b.customerAuthUid !== verifiedUid) continue;
          if (!b.customerAuthUid && b.authUserId !== verifiedUid) continue;
          ownedBookingsMap.set(d.id, b);
        }
        if (verifiedCustomerId && bookingsByCustIdSnaps.has(verifiedCustomerId)) {
          for (const d of bookingsByCustIdSnaps.get(verifiedCustomerId)?.docs || []) {
            if (!snapExists(d) || d.id === bookingId || ownedBookingsMap.has(d.id)) continue;
            const b = d.data() || {};
            if (b.customerAuthUid && b.customerAuthUid !== verifiedUid) continue;
            if (b.authUserId && b.authUserId !== verifiedUid) continue;
            ownedBookingsMap.set(d.id, b);
          }
        }

        let hasPreviousNonCancelledBooking = false;
        for (const [bId, b] of ownedBookingsMap.entries()) {
          const bStatus = typeof b.status === 'string' ? b.status.trim().toLowerCase() : '';
          if (bStatus === 'cancelled' || bStatus === 'batal') continue;

          hasPreviousNonCancelledBooking = true;

          const bPromoCode = typeof b.promoCode === 'string' ? b.promoCode.trim().toUpperCase() : '';
          const bVoucherCode = typeof b.voucherCode === 'string' ? b.voucherCode.trim().toUpperCase() : '';
          const bPromoId = typeof b.promoId === 'string' ? b.promoId.trim() : '';
          const bVoucherId = typeof b.voucherId === 'string' ? b.voucherId.trim() : '';

          if (
            bPromoCode === code ||
            bVoucherCode === code ||
            bPromoId === targetMasterId ||
            bVoucherId === targetMasterId
          ) {
            priorCustomerUseKeys.add(bId);
          }
        }

        for (const reservedBookingId of otherReservedBookingIds) {
          priorCustomerUseKeys.add(reservedBookingId);
        }

        if (usageLimitPerCustomer > 0 && priorCustomerUseKeys.size >= usageLimitPerCustomer) {
          return {
            status: 409,
            code: 'VOUCHER_CUSTOMER_QUOTA_EXHAUSTED',
            error: `Voucher ${code} sudah pernah digunakan pada akun ini.`,
          };
        }

        if (targetMasterData.firstOrderOnly === true || targetMasterData.newCustomerOnly === true) {
          if (hasPreviousNonCancelledBooking) {
            return {
              status: 409,
              code: 'VOUCHER_FIRST_ORDER_ONLY',
              error: 'Voucher ini khusus untuk pesanan pertama.',
            };
          }
          if (verifiedCustomerData) {
            const comp = verifiedCustomerData.completedBookings ?? 0;
            const tot = verifiedCustomerData.totalBookings ?? 0;
            if (!isFiniteNonNegativeInt(comp) || !isFiniteNonNegativeInt(tot)) {
              return {
                status: 409,
                code: 'VOUCHER_CONFIG_INVALID',
                error: 'Data riwayat pesanan pelanggan tidak valid.',
              };
            }
            if (comp > 0 || tot > 1) {
              return {
                status: 409,
                code: 'VOUCHER_FIRST_ORDER_ONLY',
                error: 'Voucher ini khusus untuk pesanan pertama.',
              };
            }
            if (
              tot === 1 &&
              verifiedCustomerData.lastBookingId &&
              verifiedCustomerData.lastBookingId !== bookingId
            ) {
              return {
                status: 409,
                code: 'VOUCHER_FIRST_ORDER_ONLY',
                error: 'Voucher ini khusus untuk pesanan pertama.',
              };
            }
          }
        }

        // --- PHASE 4: ATOMIC TRANSACTION WRITES ---
        const bookingCodeStr = typeof bookingData.bookingCode === 'string' ? bookingData.bookingCode.trim() : '';
        const effectiveCustId = verifiedCustomerId || bookingCustomerId || '';

        transaction.set(
          redemptionRef,
          {
            id: redemptionId,
            voucherId: targetMasterId,
            voucherCode: code,
            customerId: effectiveCustId,
            customerAuthUid: verifiedUid,
            customerPhone: bookingPhoneRaw || null,
            normalizedPhone: bookingPhoneDigits ? `+${bookingPhoneDigits}` : null,
            bookingId,
            bookingCode: bookingCodeStr,
            discountAmount: serverDerivedDiscountAmount,
            redeemedAt: nowIso,
            status: 'active',
            source: 'booking_submission',
            updatedAt: nowIso,
          },
          { merge: true }
        );

        transaction.set(
          uidLockRef,
          {
            voucherCode: code,
            voucherId: targetMasterId,
            customerAuthUid: verifiedUid,
            bookingId,
            bookingCode: bookingCodeStr,
            redeemedAt: nowIso,
            status: 'active',
            updatedAt: nowIso,
          },
          { merge: true }
        );

        if (verifiedCustomerId && custLockRefs.has(verifiedCustomerId)) {
          transaction.set(
            custLockRefs.get(verifiedCustomerId),
            {
              voucherCode: code,
              voucherId: targetMasterId,
              customerId: verifiedCustomerId,
              customerAuthUid: verifiedUid,
              bookingId,
              bookingCode: bookingCodeStr,
              redeemedAt: nowIso,
              status: 'active',
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }

        if (phoneLockRef && canWritePhoneLock) {
          transaction.set(
            phoneLockRef,
            {
              voucherCode: code,
              voucherId: targetMasterId,
              customerPhone: bookingPhoneDigits,
              customerAuthUid: verifiedUid,
              bookingId,
              bookingCode: bookingCodeStr,
              redeemedAt: nowIso,
              status: 'active',
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }

        if (isRedeemingPersonalCv && personalCvRef && resolvedPersonalCv?.status !== 'used') {
          transaction.update(personalCvRef, {
            status: 'used',
            usedAt: nowIso,
            bookingId,
            bookingCode: bookingCodeStr,
          });
        }

        transaction.update(targetMasterRef, {
          currentUsageCount: currentUsageCount + 1,
          updatedAt: nowIso,
        });

        transaction.set(receiptRef, {
          schemaVersion: 1,
          redemptionId,
          bookingId,
          voucherId: targetMasterId,
          voucherCode: code,
          customerAuthUid: verifiedUid,
          discountAmount: serverDerivedDiscountAmount,
          committedAt: nowIso,
        });

        return {
          status: 200,
          isIdempotent: false,
          redemptionId,
          voucherId: targetMasterId,
          voucherCode: code,
          discountAmount: serverDerivedDiscountAmount,
        };
      });

      if (txOutcome.status !== 200) {
        return res.status(txOutcome.status).json({
          success: false,
          code: txOutcome.code,
          error: txOutcome.error,
          message: txOutcome.error,
        });
      }

      if (!txOutcome.isIdempotent) {
        emitStructuredLog({
          severity: 'INFO',
          event: 'voucher_redeemed_atomic',
          redemptionId: txOutcome.redemptionId,
          bookingId,
          voucherId: txOutcome.voucherId,
          voucherCode: txOutcome.voucherCode,
          customerAuthUid: verifiedUid,
          discountAmount: txOutcome.discountAmount,
          message: `Voucher ${code} atomically redeemed for booking ${bookingId}`,
        });
      }

      return res.json({
        success: true,
        redemptionId: txOutcome.redemptionId,
        isIdempotent: Boolean(txOutcome.isIdempotent),
        discountAmount: txOutcome.discountAmount,
      });
    } catch (err: any) {
      console.error('[VoucherRedeem] Transaction or infrastructure failure:', err?.code || err?.message || err);
      return res.status(503).json({
        success: false,
        code: 'VOUCHER_REDEMPTION_UNAVAILABLE',
        error: 'Layanan penukaran voucher sedang mengalami kendala. Silakan coba kembali.',
      });
    }
  });

  // =============================================================
  // GOOGLE PLAY ACCOUNT DELETION COMPLIANCE (Server-Authoritative)
  // =============================================================
  const publicAccountDeletionRateLimit = new Map<string, { count: number; resetAt: number }>();
  const authAccountDeletionRateLimit = new Map<string, { count: number; resetAt: number }>();

  // 1. Public Endpoint: Web Deletion Request (/hapus-akun) without login
  app.post('/api/account-deletion/public-request', async (req, res) => {
    try {
      // Safe IP extraction compatible with Cloud Run / nginx proxies
      const rawForwarded = req.headers['x-forwarded-for'];
      const forwardedFirst = typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim() : '';
      const clientIp =
        (forwardedFirst && /^[0-9a-fA-F:.]+$/.test(forwardedFirst) ? forwardedFirst : '') ||
        req.ip ||
        req.socket?.remoteAddress ||
        'unknown';

      const now = Date.now();

      // IP-based Rate Limiting (max 5 requests per 15 minutes)
      const currentIpRate = publicAccountDeletionRateLimit.get(clientIp);
      if (currentIpRate && now < currentIpRate.resetAt) {
        if (currentIpRate.count >= 5) {
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMITED',
            message: 'Terlalu banyak permintaan dalam waktu singkat. Silakan coba kembali dalam 15 menit.',
          });
        }
        currentIpRate.count++;
      } else {
        publicAccountDeletionRateLimit.set(clientIp, { count: 1, resetAt: now + 15 * 60 * 1000 });
      }

      // Honeypot check (anti-bot trap)
      const honeypot = (req.body?.website || '').trim();
      if (honeypot) {
        return res.json({
          success: true,
          referenceCode: 'DEL-PUB-RECEIVED',
          message: 'Permintaan penghapusan akun Anda telah berhasil diterima.',
        });
      }

      // Input Sanitization & Validation
      const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!rawEmail || rawEmail.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_EMAIL',
          message: 'Format alamat email tidak valid.',
        });
      }

      const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone.trim().replace(/[^0-9+]/g, '') : '';
      if (!rawPhone || rawPhone.length < 9 || rawPhone.length > 16) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PHONE',
          message: 'Nomor WhatsApp / telepon tidak valid (minimal 9 digit).',
        });
      }

      const rawReason = typeof req.body?.reason === 'string'
        ? req.body.reason.slice(0, 500).replace(/[<>]/g, '').trim()
        : '';

      // Contact-based rate limiting (max 3 requests per 15 minutes per email/phone combination)
      const contactKey = `${rawEmail}:${rawPhone}`;
      const currentContactRate = publicAccountDeletionRateLimit.get(contactKey);
      if (currentContactRate && now < currentContactRate.resetAt) {
        if (currentContactRate.count >= 3) {
          return res.status(429).json({
            success: false,
            code: 'CONTACT_RATE_LIMITED',
            message: 'Permintaan untuk akun ini telah diajukan sebelumnya. Tim kepatuhan kami sedang memproses verifikasi.',
          });
        }
        currentContactRate.count++;
      } else {
        publicAccountDeletionRateLimit.set(contactKey, { count: 1, resetAt: now + 15 * 60 * 1000 });
      }

      await ensureServerAuthenticated();

      const referenceCode = 'DEL-PUB-' + Math.floor(100000 + Math.random() * 900000);

      // Attempt matching customer to enrich request safely
      let matchedCustomerId: string | null = null;
      let matchedCustomerName: string | null = null;
      try {
        const qEmail = query(collection(db, 'customers'), where('email', '==', rawEmail), limit(1));
        const snapEmail = await getDocs(qEmail);
        if (!snapEmail.empty) {
          matchedCustomerId = snapEmail.docs[0].id;
          matchedCustomerName = snapEmail.docs[0].data()?.name || null;
        } else {
          const qPhone = query(collection(db, 'customers'), where('phone', '==', rawPhone), limit(1));
          const snapPhone = await getDocs(qPhone);
          if (!snapPhone.empty) {
            matchedCustomerId = snapPhone.docs[0].id;
            matchedCustomerName = snapPhone.docs[0].data()?.name || null;
          }
        }
      } catch (matchErr) {
        console.warn('[Account Deletion] Customer match notice:', matchErr);
      }

      // If matched, flag customer for pending verification
      if (matchedCustomerId) {
        try {
          const custRef = doc(db, 'customers', matchedCustomerId);
          await updateDoc(custRef, {
            deletionRequestedAt: new Date().toISOString(),
            deletionRequestStatus: 'pending_verification',
            deletionTicketCode: referenceCode,
            deletionSource: 'public_web',
            updatedAt: new Date().toISOString(),
          });
        } catch (uErr) {
          console.warn('[Account Deletion] Notice updating customer flag:', uErr);
        }
      }

      // Persist deletion request audit record
      const requestDocRef = doc(db, 'account_deletion_requests', referenceCode);
      await setDoc(requestDocRef, {
        referenceCode,
        source: 'public_web',
        status: 'pending_verification',
        email: rawEmail,
        phone: rawPhone,
        reason: rawReason || 'Tidak disebutkan',
        matchedCustomerId,
        matchedCustomerName,
        requestedAt: new Date().toISOString(),
        ipMasked: clientIp.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.***.***'),
        userAgent: (req.headers['user-agent'] || '').slice(0, 150),
      });

      // Create operational case for Customer Service verification
      try {
        const caseDocRef = doc(db, 'cases', `CASE-${referenceCode}`);
        await setDoc(caseDocRef, {
          caseNumber: `CASE-${referenceCode}`,
          category: 'ACCOUNT_DELETION',
          source: 'public_web',
          status: 'open',
          priority: 'high',
          title: `Permintaan Hapus Akun (${referenceCode})`,
          description: `Pengajuan hapus akun pelanggan via web publik. Verifikasi identitas diperlukan sebelum penghapusan data. Alasan: ${rawReason || 'Tidak disebutkan'}.`,
          customerId: matchedCustomerId || 'UNREGISTERED_OR_EXTERNAL',
          customerName: matchedCustomerName || 'Pemohon Publik',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (caseErr) {
        console.warn('[Account Deletion] Notice creating case ticket:', caseErr);
      }

      // Safe structured log (observability without logging sensitive PII in plain text)
      emitStructuredLog({
        severity: 'INFO',
        event: 'account_deletion_public_requested',
        referenceCode,
        matchedCustomerId: matchedCustomerId || undefined,
        message: `Account deletion request submitted via public form (${referenceCode})`,
      });

      return res.json({
        success: true,
        referenceCode,
        message: 'Permintaan penghapusan akun Anda telah berhasil diterima. Tim Senzu Home akan menghubungi Anda untuk verifikasi identitas kepemilikan sebelum penghapusan data diproses.',
      });
    } catch (err: any) {
      console.error('Account deletion public request error:', err);
      return res.status(500).json({
        success: false,
        error: 'Terjadi gangguan sistem saat mengajukan permintaan. Silakan coba kembali atau hubungi Customer Service kami.',
      });
    }
  });

  // 2. Authenticated Endpoint: In-App Deletion Request with Firebase ID Token
  app.post('/api/account-deletion/authenticated-request', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const tokenMatch = typeof authHeader === 'string'
        ? /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
        : null;
      if (!tokenMatch) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          message: 'Sesi login diperlukan untuk melakukan tindakan ini.',
        });
      }

      // Reuse the existing Admin Auth instance; no alternate identity path.
      let verifiedUid = '';
      let verifiedEmail = '';
      try {
        const decoded = await adminAuth.verifyIdToken(tokenMatch[1]);
        if (typeof decoded.uid !== 'string' || !decoded.uid) {
          throw new Error('Missing verified customer UID');
        }
        verifiedUid = decoded.uid;
        verifiedEmail = typeof decoded.email === 'string'
          ? decoded.email.toLowerCase().trim()
          : '';
      } catch {
        return res.status(401).json({
          success: false,
          code: 'SESSION_EXPIRED',
          message: 'Sesi login telah berakhir. Silakan masuk kembali.',
        });
      }

      const now = Date.now();
      const currentRate = authAccountDeletionRateLimit.get(verifiedUid);
      if (currentRate && now < currentRate.resetAt) {
        if (currentRate.count >= 3) {
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMITED',
            message: 'Permintaan telah diajukan. Mohon menunggu proses verifikasi tim kami.',
          });
        }
        currentRate.count++;
      } else {
        authAccountDeletionRateLimit.set(verifiedUid, { count: 1, resetAt: now + 15 * 60 * 1000 });
      }

      const rawReason = typeof req.body?.reason === 'string'
        ? req.body.reason.slice(0, 500).replace(/[<>]/g, '').trim()
        : '';
      const suppliedCustomerId = req.body?.customerId;
      if (suppliedCustomerId != null && (
        typeof suppliedCustomerId !== 'string' ||
        !suppliedCustomerId.trim() ||
        suppliedCustomerId.includes('/') ||
        Buffer.byteLength(suppliedCustomerId, 'utf8') > 1500
      )) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMER_ID',
          message: 'Data permintaan tidak valid.',
        });
      }
      const customerIdHint = typeof suppliedCustomerId === 'string'
        ? suppliedCustomerId.trim()
        : '';

      await ensureServerAuthenticated();
      const referenceCode = 'DEL-AUTH-' + randomInt(100000, 1000000);
      const requestedAt = new Date(now).toISOString();
      const reason = rawReason || 'Pengajuan via Akun Aplikasi';
      const requestDocRef = adminDb.collection('account_deletion_requests').doc(referenceCode);

      // Resolve ownership and persist the request atomically. Query reads are
      // re-evaluated by Admin Firestore if a concurrent ownership change retries.
      const result = await adminDb.runTransaction(async (transaction) => {
        const ownedProfiles = await transaction.get(
          adminDb.collection('customers').where('authUserId', '==', verifiedUid).limit(2)
        );
        if (ownedProfiles.empty) {
          return {
            status: 403,
            code: 'CUSTOMER_OWNERSHIP_UNVERIFIED',
            message: 'Akses ditolak. Kepemilikan akun tidak dapat diverifikasi.',
          };
        }
        if (ownedProfiles.docs.length !== 1) {
          return {
            status: 409,
            code: 'CUSTOMER_OWNERSHIP_CONFLICT',
            message: 'Kepemilikan akun perlu ditinjau oleh Customer Service Senzu.',
          };
        }

        const customerSnap = ownedProfiles.docs[0];
        const customerData = customerSnap.data();
        const customerDocId = customerSnap.id;
        if (customerData.authUserId !== verifiedUid || (
          customerData.customerAuthUid != null &&
          customerData.customerAuthUid !== '' &&
          customerData.customerAuthUid !== verifiedUid
        )) {
          return {
            status: 403,
            code: 'CUSTOMER_OWNERSHIP_UNVERIFIED',
            message: 'Akses ditolak. Kepemilikan akun tidak dapat diverifikasi.',
          };
        }
        if (customerIdHint && customerIdHint !== customerDocId) {
          return {
            status: 403,
            code: 'CUSTOMER_OWNERSHIP_UNVERIFIED',
            message: 'Akses ditolak. Kepemilikan akun tidak dapat diverifikasi.',
          };
        }

        // Preserve the existing ticket format without overwriting another request.
        const requestSnap = await transaction.get(requestDocRef);
        if (requestSnap.exists) {
          return {
            status: 409,
            code: 'REQUEST_REFERENCE_CONFLICT',
            message: 'Permintaan belum dapat disimpan. Silakan coba kembali.',
          };
        }

        transaction.update(customerSnap.ref, {
          status: 'DELETION_REQUESTED',
          deletionRequestedAt: requestedAt,
          deletionRequestStatus: 'pending',
          deletionReason: reason,
          deletionTicketCode: referenceCode,
          deletionSource: 'in_app_authenticated',
          updatedAt: requestedAt,
        });
        transaction.create(requestDocRef, {
          referenceCode,
          source: 'in_app_authenticated',
          status: 'verified_pending_processing',
          authUserId: verifiedUid,
          customerId: customerDocId,
          customerName: customerData.name || 'Pelanggan Senzu',
          email: verifiedEmail,
          phone: customerData.phone || '',
          reason,
          requestedAt,
        });
        return { status: 200, customerDocId, customerData };
      });

      if (result.status !== 200) {
        return res.status(result.status).json({
          success: false,
          code: result.code,
          message: result.message,
        });
      }
      const customerDocId = result.customerDocId!;
      const customerData = result.customerData!;

      // Keep operational case creation best-effort, after the request commits.
      // create() never overwrites a pre-existing case with the same reference.
      try {
        const caseDocRef = adminDb.collection('cases').doc(`CASE-${referenceCode}`);
        await caseDocRef.create({
          caseNumber: `CASE-${referenceCode}`,
          category: 'ACCOUNT_DELETION',
          source: 'in_app_authenticated',
          status: 'open',
          priority: 'high',
          title: `Permintaan Hapus Akun Terotentikasi (${referenceCode})`,
          description: `Pengajuan hapus akun oleh pelanggan terotentikasi. CustomerId: ${customerDocId}. Alasan: ${rawReason || 'Tidak ada'}. Sesuai kebijakan retensi, arsip transaksi keuangan tetap dipertahankan.`,
          customerId: customerDocId,
          customerName: customerData.name || 'Pelanggan Senzu',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (caseErr) {
        console.warn('[Account Deletion] Notice creating case ticket:', caseErr);
      }

      emitStructuredLog({
        severity: 'INFO',
        event: 'account_deletion_authenticated_requested',
        referenceCode,
        customerId: customerDocId,
        userUid: verifiedUid,
        message: `Authenticated account deletion requested (${referenceCode})`,
      });

      return res.json({
        success: true,
        referenceCode,
        message: 'Permintaan penghapusan akun Anda telah berhasil diajukan dan sedang diproses sesuai ketentuan privasi Senzu Home.',
      });
    } catch (err: any) {
      console.error('Authenticated account deletion error:', err);
      return res.status(500).json({
        success: false,
        error: 'Terjadi kesalahan sistem saat memproses penghapusan akun. Silakan coba kembali.',
      });
    }
  });

  // =============================================================
  // CUSTOMER CRM RECOMPUTATION (Server-Authoritative)
  // =============================================================

  // POST /api/customers/recompute - Recomputes full customer metrics & CRM segment authoritatively
  app.post(['/api/customers/recompute', '/api/customers/:id/recompute'], async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const tokenMatch = typeof authHeader === 'string'
        ? /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
        : null;
      if (!tokenMatch) {
        return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Sesi login diperlukan.' });
      }
      let verifiedUid = '';
      try {
        const decoded = await adminAuth.verifyIdToken(tokenMatch[1]);
        if (typeof decoded.uid === 'string') verifiedUid = decoded.uid;
      } catch {}
      if (!verifiedUid) {
        return res.status(401).json({ success: false, code: 'AUTH_TOKEN_INVALID', error: 'Sesi login tidak valid.' });
      }

      const bodyId = req.body?.customerId;
      const pathId = req.params?.id;
      const validId = (value: any) => typeof value === 'string' && !!value.trim() &&
        !value.includes('/') && Buffer.byteLength(value, 'utf8') <= 1500;
      if ((bodyId !== undefined && !validId(bodyId)) || (pathId !== undefined && !validId(pathId)) ||
          (bodyId === undefined && pathId === undefined)) {
        return res.status(400).json({ success: false, code: 'INVALID_CUSTOMER_ID', error: 'Customer ID is required.' });
      }
      if (bodyId !== undefined && pathId !== undefined && bodyId.trim() !== pathId.trim()) {
        return res.status(400).json({ success: false, code: 'CUSTOMER_ID_MISMATCH', error: 'Referensi pelanggan tidak sesuai.' });
      }
      const customerId = (pathId ?? bodyId).trim();
      await ensureServerAuthenticated();

      // Scope this mutation from current server records, never body roles or email.
      const isOperationalRole = (roleData: any) => !!roleData && roleData.isActive === true &&
        !['inactive', 'disabled', 'archived'].includes(String(roleData.status || '').toLowerCase()) &&
        ['css', 'supervisor', 'manager', 'admin'].includes(roleData.role) &&
        (roleData.authUserId == null || roleData.authUserId === '' || roleData.authUserId === verifiedUid) &&
        (roleData.authUid == null || roleData.authUid === '' || roleData.authUid === verifiedUid);
      const isOwnProfile = (profile: any) => !!profile && profile.authUserId === verifiedUid &&
        (profile.customerAuthUid == null || profile.customerAuthUid === '' || profile.customerAuthUid === verifiedUid);
      const roleRef = adminDb.collection('staff_roles').doc(verifiedUid);
      const custRef = adminDb.collection('customers').doc(customerId);
      const [roleSnap, custSnap] = await Promise.all([roleRef.get(), custRef.get()]);
      const isOperationalCaller = isOperationalRole(roleSnap.exists ? roleSnap.data() : null);
      if (!custSnap.exists) {
        return res.status(isOperationalCaller ? 404 : 403).json({
          success: false, code: isOperationalCaller ? 'CUSTOMER_NOT_FOUND' : 'PERMISSION_DENIED',
          error: isOperationalCaller ? 'Customer not found.' : 'Akses pelanggan ditolak.',
        });
      }
      const existingCust = custSnap.data() as any;
      if (!isOperationalCaller && !isOwnProfile(existingCust)) {
        return res.status(403).json({ success: false, code: 'PERMISSION_DENIED', error: 'Akses pelanggan ditolak.' });
      }

      // Fetch CRM settings for thresholds
      let settings: any = {
        repeatMinBookings: 2,
        activeDays: 60,
        atRiskDays: 90,
        inactiveDays: 90,
        highValueSpend: 1000000,
        highValueBookings: 5,
      };
      try {
        const settingsSnap = await getDoc(doc(db, 'crm_settings', 'general'));
        if (settingsSnap.exists()) {
          settings = { ...settings, ...settingsSnap.data() };
        }
      } catch (sErr) {
        console.warn('[Server CRM] Notice fetching crm_settings:', sErr);
      }

      // Fetch all bookings for this customer
      const bookingsMap = new Map<string, any>();

      // 1. By customerId
      try {
        const q1 = query(collection(db, 'bookings'), where('customerId', '==', customerId));
        const snap1 = await getDocs(q1);
        for (const d of snap1.docs) {
          bookingsMap.set(d.id, { id: d.id, ...d.data() });
        }
      } catch (e1) {
        console.warn('[Server CRM] Query by customerId notice:', e1);
      }

      // 2. By phone / normalizedPhone
      const phone = existingCust.phone || existingCust.whatsapp;
      if (phone) {
        try {
          const q2 = query(collection(db, 'bookings'), where('customerWhatsApp', '==', phone));
          const snap2 = await getDocs(q2);
          for (const d of snap2.docs) {
            bookingsMap.set(d.id, { id: d.id, ...d.data() });
          }
        } catch (e2) {
          console.warn('[Server CRM] Query by phone notice:', e2);
        }
      }

      // 3. By authUserId if present
      if (existingCust.authUserId) {
        try {
          const q3 = query(collection(db, 'bookings'), where('authUserId', '==', existingCust.authUserId));
          const snap3 = await getDocs(q3);
          for (const d of snap3.docs) {
            bookingsMap.set(d.id, { id: d.id, ...d.data() });
          }
        } catch (e3) {
          console.warn('[Server CRM] Query by authUserId notice:', e3);
        }
      }

      const bookingsList = Array.from(bookingsMap.values()).filter((booking) => {
        if (isOperationalCaller) return true;
        const canonical = booking.customerAuthUid;
        const legacy = booking.authUserId;
        // A customer's editable phone/CRM ID cannot grant access to foreign or
        // unowned booking aggregates. Preserve staff's existing legacy CRM view.
        if (canonical != null && canonical !== '' && canonical !== verifiedUid) return false;
        if (legacy != null && legacy !== '' && legacy !== verifiedUid) return false;
        return canonical === verifiedUid || legacy === verifiedUid;
      });
      bookingsList.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

      const completedBookings = bookingsList.filter((b) => b.status === 'Completed');
      const cancelledBookings = bookingsList.filter((b) => b.status === 'Cancelled');

      let totalSpend = 0;
      let totalTreatmentMinutes = 0;
      const serviceCounts: Record<string, { count: number; name: string; spend: number }> = {};
      const therapistCounts: Record<string, { count: number; name: string }> = {};
      const completedDates: number[] = [];

      for (const b of completedBookings) {
        const isPaid = b.paymentStatus === 'PAID' || b.paymentStatus === 'paid' || b.paymentStatus === 'Lunas' || b.paymentStatus === 'COMPLETED';
        if (isPaid) {
          totalSpend += Number(b.totalAmount) || 0;
        }
        totalTreatmentMinutes += Number(b.serviceDuration) || 60;

        if (b.serviceId) {
          if (!serviceCounts[b.serviceId]) {
            serviceCounts[b.serviceId] = { count: 0, name: b.serviceName || '', spend: 0 };
          }
          serviceCounts[b.serviceId].count += 1;
          serviceCounts[b.serviceId].spend += Number(b.totalAmount) || 0;
        }

        if (b.therapistId && b.therapistName) {
          if (!therapistCounts[b.therapistId]) {
            therapistCounts[b.therapistId] = { count: 0, name: b.therapistName };
          }
          therapistCounts[b.therapistId].count += 1;
        }

        const treatDate = new Date(`${b.scheduleDate}T${b.scheduleTime || '12:00'}:00`).getTime();
        if (!isNaN(treatDate)) {
          completedDates.push(treatDate);
        }
      }

      let favoriteServiceId = existingCust.favoriteServiceId;
      let favoriteServiceName = existingCust.favoriteServiceName;
      let maxServiceCount = -1;
      for (const [sId, data] of Object.entries(serviceCounts)) {
        if (data.count > maxServiceCount) {
          maxServiceCount = data.count;
          favoriteServiceId = sId;
          favoriteServiceName = data.name;
        }
      }

      let favoriteTherapistId = existingCust.favoriteTherapistId;
      let favoriteTherapistName = existingCust.favoriteTherapistName;
      let maxTherapistCount = -1;
      for (const [tId, data] of Object.entries(therapistCounts)) {
        if (data.count > maxTherapistCount) {
          maxTherapistCount = data.count;
          favoriteTherapistId = tId;
          favoriteTherapistName = data.name;
        }
      }

      completedDates.sort((a, b) => a - b);
      let avgDaysBetween: number | undefined;
      let nextExpectedBookingAt: string | undefined;
      let repeatInsight: string | undefined;

      if (completedDates.length >= 2) {
        let totalDiffDays = 0;
        for (let i = 1; i < completedDates.length; i++) {
          totalDiffDays += (completedDates[i] - completedDates[i - 1]) / (1000 * 60 * 60 * 24);
        }
        avgDaysBetween = Math.round(totalDiffDays / (completedDates.length - 1));

        const lastDate = completedDates[completedDates.length - 1];
        const nextDate = new Date(lastDate + avgDaysBetween * 24 * 60 * 60 * 1000);
        nextExpectedBookingAt = nextDate.toISOString();

        const daysSinceLast = Math.floor((Date.now() - lastDate) / (1000 * 60 * 60 * 24));
        if (daysSinceLast >= avgDaysBetween - 5 && daysSinceLast <= avgDaysBetween + 7) {
          repeatInsight = 'Pelanggan mendekati perkiraan periode repeat booking.';
        } else if (daysSinceLast > avgDaysBetween + 14) {
          repeatInsight = 'Pelanggan telah melewati siklus treatment biasanya.';
        }
      }

      // Fetch reviews
      let totalRatingSum = 0;
      let reviewCount = 0;
      try {
        const revQuery = query(collection(db, 'reviews'), where('customerId', '==', customerId));
        const revSnap = await getDocs(revQuery);
        for (const d of revSnap.docs) {
          const rev = d.data();
          if (rev.overallRating && rev.status !== 'hidden') {
            totalRatingSum += rev.overallRating;
            reviewCount += 1;
          }
        }
      } catch (revErr) {
        console.warn('[Server CRM] Reviews query notice:', revErr);
      }
      const averageRating = reviewCount > 0 ? +(totalRatingSum / reviewCount).toFixed(1) : undefined;

      const firstBookingAt = bookingsList[0]?.createdAt || existingCust.firstBookingAt || new Date().toISOString();
      const lastBookingAt = bookingsList[bookingsList.length - 1]?.createdAt || existingCust.lastBookingAt || new Date().toISOString();
      const lastCompleted = completedBookings[completedBookings.length - 1];
      const lastCompletedTreatmentAt = lastCompleted
        ? `${lastCompleted.scheduleDate}T${lastCompleted.scheduleTime || '12:00'}:00Z`
        : existingCust.lastCompletedTreatmentAt;
      const firstCompletedBookingAt = completedBookings[0]
        ? `${completedBookings[0].scheduleDate}T${completedBookings[0].scheduleTime || '12:00'}:00Z`
        : existingCust.firstCompletedBookingAt;

      const completedCount = completedBookings.length;
      const aov = completedCount > 0 ? Math.round(totalSpend / completedCount) : 0;

      // Evaluate customer segment
      let customerSegment = 'NEW';
      if (existingCust.customerSegment === 'VIP' && existingCust.vipSource === 'manual') {
        customerSegment = 'VIP';
      } else if (totalSpend >= settings.highValueSpend * 2 || completedCount >= settings.highValueBookings * 2) {
        customerSegment = 'VIP';
      } else if (totalSpend >= settings.highValueSpend || completedCount >= settings.highValueBookings) {
        customerSegment = 'HIGH_VALUE';
      } else if (!lastCompletedTreatmentAt) {
        customerSegment = 'NEW';
      } else {
        const lastDate = new Date(lastCompletedTreatmentAt).getTime();
        const diffDays = Math.floor((Date.now() - lastDate) / (1000 * 60 * 60 * 24));
        if (diffDays > settings.inactiveDays) {
          customerSegment = 'INACTIVE';
        } else if (diffDays >= settings.activeDays && diffDays <= settings.atRiskDays) {
          customerSegment = 'AT_RISK';
        } else if (completedCount >= settings.repeatMinBookings) {
          customerSegment = 'REPEAT';
        } else if (diffDays <= settings.activeDays) {
          customerSegment = 'ACTIVE';
        } else {
          customerSegment = 'NEW';
        }
      }

      const updatedData = {
        ...existingCust,
        totalBookings: bookingsList.length,
        completedBookings: completedCount,
        cancelledBookings: cancelledBookings.length,
        totalSpend,
        averageOrderValue: aov,
        totalTreatmentMinutes,
        firstBookingAt,
        firstCompletedBookingAt,
        lastBookingAt,
        lastCompletedTreatmentAt,
        favoriteServiceId,
        favoriteServiceName,
        favoriteTherapistId,
        favoriteTherapistName,
        averageRating,
        totalReviews: reviewCount,
        averageDaysBetweenTreatments: avgDaysBetween,
        nextExpectedBookingAt,
        repeatInsight,
        totalBooking: bookingsList.length,
        completedBooking: completedCount,
        whatsapp: existingCust.phone || existingCust.whatsapp,
        lastBooking: `${lastCompleted?.scheduleDate || ''} ${lastCompleted?.scheduleTime || ''}`.trim() || existingCust.lastBooking,
        favoriteTreatment: favoriteServiceName || existingCust.favoriteTreatment || '-',
        favoriteTherapist: favoriteTherapistName || existingCust.favoriteTherapist || '-',
        updatedAt: new Date().toISOString(),
        customerSegment,
      };

      const cleanedData: Record<string, any> = {};
      for (const [k, v] of Object.entries(updatedData)) {
        if (v !== undefined) {
          cleanedData[k] = v;
        }
      }

      // Write only the existing aggregate fields; never replay stale identity,
      // contact, address, account status or other unrelated profile fields.
      const aggregateKeys = [
        'totalBookings', 'completedBookings', 'cancelledBookings', 'totalSpend',
        'averageOrderValue', 'totalTreatmentMinutes', 'firstBookingAt',
        'firstCompletedBookingAt', 'lastBookingAt', 'lastCompletedTreatmentAt',
        'favoriteServiceId', 'favoriteServiceName', 'favoriteTherapistId',
        'favoriteTherapistName', 'averageRating', 'totalReviews',
        'averageDaysBetweenTreatments', 'nextExpectedBookingAt', 'repeatInsight',
        'totalBooking', 'completedBooking', 'whatsapp', 'lastBooking',
        'favoriteTreatment', 'favoriteTherapist', 'updatedAt', 'customerSegment',
      ];
      const aggregateUpdate: Record<string, any> = {};
      for (const key of aggregateKeys) {
        if (Object.prototype.hasOwnProperty.call(cleanedData, key)) aggregateUpdate[key] = cleanedData[key];
      }
      const customer = await adminDb.runTransaction(async (transaction) => {
        const currentRole = await transaction.get(roleRef);
        const currentProfile = await transaction.get(custRef);
        const roleStillAllowed = isOperationalRole(currentRole.exists ? currentRole.data() : null);
        const profile = currentProfile.exists ? currentProfile.data() : null;
        if (!profile || (isOperationalCaller ? !roleStillAllowed : !isOwnProfile(profile))) {
          throw Object.assign(new Error('Akses pelanggan ditolak.'), { statusCode: 403, code: 'PERMISSION_DENIED' });
        }
        if (!currentProfile.updateTime || !custSnap.updateTime || !currentProfile.updateTime.isEqual(custSnap.updateTime)) {
          throw Object.assign(new Error('Data pelanggan berubah. Silakan coba kembali.'), { statusCode: 409, code: 'CRM_SOURCE_CHANGED' });
        }
        transaction.update(custRef, aggregateUpdate);
        return { ...profile, ...aggregateUpdate };
      });
      emitStructuredLog({ severity: 'INFO', event: 'customer_profile_recomputed', customerId, userUid: verifiedUid });
      res.json({ success: true, customer });
    } catch (err: any) {
      console.error('[Server CRM] Customer recompute error:', err);
      res.status(err.statusCode || 500).json({
        success: false, code: err.code || 'INTERNAL_ERROR',
        error: err.statusCode ? err.message : 'Failed to recompute customer profile',
      });
    }
  });

  // POST /api/customer-audit/append - Authoritative Customer Audit Log Append (Stage 7A: Finding 6)
  app.post('/api/customer-audit/append', async (req, res) => {
    const isValidDocId = (val: unknown, maxBytes = 128): val is string => {
      if (typeof val !== 'string') return false;
      const trimmed = val.trim();
      if (!trimmed || trimmed !== val) return false;
      if (trimmed === '.' || trimmed === '..') return false;
      if (Buffer.byteLength(trimmed, 'utf8') > maxBytes) return false;
      if (/[\/\\\x00-\x1F\x7F\s]/.test(trimmed)) return false;
      return true;
    };

    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

    const textId = (value: unknown): string =>
      typeof value === 'string' ? value.trim() : '';

    const sanitizeText = (value: unknown, maxLen = 250): string =>
      typeof value === 'string'
        ? value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen)
        : '';

    const ALLOWED_CUSTOMER_AUDIT_ACTIONS = new Set([
      'created',
      'updated',
      'merged',
      'status_change',
      'status_changed',
      'vip_change',
      'promoted_to_vip',
      'demoted_from_vip',
      'segment_change',
      'note_added',
      'tag_added',
      'review_added',
    ]);

    const computeAuditFingerprint = (params: {
      actorScope: 'staff' | 'customer';
      actorUid: string;
      customerId: string;
      action: string;
      details: string;
    }): string =>
      createHash('sha256')
        .update(
          JSON.stringify([
            'v1',
            params.actorScope,
            params.actorUid,
            params.customerId,
            params.action,
            params.details,
          ])
        )
        .digest('hex');

    try {
      // 1. Require verified Bearer Firebase ID token BEFORE any database access (no alternate identity fallback)
      const rawAuthHeader = req.headers?.authorization;
      const tokenMatch =
        typeof rawAuthHeader === 'string'
          ? /^Bearer\s+(\S+)$/i.exec(rawAuthHeader.trim())
          : null;
      if (!tokenMatch || !tokenMatch[1]) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Autentikasi diperlukan untuk mencatat audit pelanggan.',
          message: 'Autentikasi diperlukan untuk mencatat audit pelanggan.',
        });
      }

      if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'AUTH_SERVICE_UNAVAILABLE',
          error: 'Layanan verifikasi otentikasi sedang tidak tersedia.',
          message: 'Layanan verifikasi otentikasi sedang tidak tersedia.',
        });
      }

      let verifiedUid = '';
      let verifiedEmail = '';
      try {
        const decoded = await adminAuth.verifyIdToken(tokenMatch[1]);
        if (!decoded || typeof decoded.uid !== 'string' || !isValidDocId(decoded.uid, 128)) {
          return res.status(401).json({
            success: false,
            code: 'AUTH_TOKEN_INVALID',
            error: 'Identitas sesi autentikasi tidak valid.',
            message: 'Identitas sesi autentikasi tidak valid.',
          });
        }
        verifiedUid = decoded.uid;
        verifiedEmail = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
      } catch (authErr: any) {
        const errCode = String(authErr?.code || '');
        const errMsg = String(authErr?.message || '');
        const isInfraError =
          errCode === 'auth/internal-error' ||
          errCode === 'auth/network-request-failed' ||
          errCode === 'unavailable' ||
          errCode === 'deadline-exceeded' ||
          authErr?.status === 503 ||
          authErr?.statusCode === 503 ||
          /unavailable|network|econnrefused|enotfound|etimedout|eai_again|socket hang up|fetch failed|deadline|internal-error|503/i.test(
            `${errCode} ${errMsg}`
          );
        if (isInfraError) {
          return res.status(503).json({
            success: false,
            code: 'AUTH_SERVICE_UNAVAILABLE',
            error: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
            message: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
          });
        }
        return res.status(401).json({
          success: false,
          code: errCode === 'auth/id-token-expired' ? 'SESSION_EXPIRED' : 'AUTH_TOKEN_INVALID',
          error: 'Sesi autentikasi tidak valid atau telah berakhir.',
          message: 'Sesi autentikasi tidak valid atau telah berakhir.',
        });
      }

      // 2. Validate bounded customerId, action, details, and requestId BEFORE database access
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYLOAD',
          error: 'Format permintaan audit pelanggan tidak valid.',
          message: 'Format permintaan audit pelanggan tidak valid.',
        });
      }

      const rawCustomerId = req.body.customerId;
      if (!isValidDocId(rawCustomerId, 128)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMER_ID',
          error: 'ID pelanggan tidak valid.',
          message: 'ID pelanggan tidak valid.',
        });
      }
      const customerId = rawCustomerId;

      const rawAction = req.body.action;
      if (typeof rawAction !== 'string' || !ALLOWED_CUSTOMER_AUDIT_ACTIONS.has(rawAction)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_AUDIT_ACTION',
          error: 'Tindakan audit pelanggan tidak valid.',
          message: 'Tindakan audit pelanggan tidak valid.',
        });
      }
      const action = rawAction;

      const rawDetails = req.body.details;
      if (
        rawDetails !== undefined &&
        rawDetails !== null &&
        (typeof rawDetails !== 'string' ||
          rawDetails.length > 1000 ||
          Buffer.byteLength(rawDetails, 'utf8') > 1000)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_AUDIT_DETAILS',
          error: 'Detail audit pelanggan tidak valid atau melebihi batas.',
          message: 'Detail audit pelanggan tidak valid atau melebihi batas.',
        });
      }
      const sanitizedDetails =
        typeof rawDetails === 'string'
          ? rawDetails.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
          : '';

      const rawRequestId = req.body.requestId;
      let cleanRequestId = '';
      if (rawRequestId !== undefined && rawRequestId !== null && rawRequestId !== '') {
        if (!isValidDocId(rawRequestId, 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REQUEST_ID',
            error: 'ID permintaan audit tidak valid.',
            message: 'ID permintaan audit tidak valid.',
          });
        }
        cleanRequestId = rawRequestId;
      }

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: 'Database server sedang tidak tersedia.',
          message: 'Database server sedang tidak tersedia.',
        });
      }

      // Staff idempotency key is derived from verified UID and requestId ONLY (independent of customerId/action/details)
      const staffLogId = cleanRequestId
        ? `aud_${createHash('sha256')
            .update(`staff:${verifiedUid}:${cleanRequestId}`)
            .digest('hex')
            .slice(0, 32)}`
        : `aud_${Date.now()}_${randomInt(100000, 1000000).toString(36)}`;

      // Customer self-registration identity is derived from verified UID and owned customerId ONLY (independent of requestId)
      const selfRegLogId =
        customerId !== 'all'
          ? `aud_${createHash('sha256')
              .update(`selfreg:${verifiedUid}:${customerId}:created`)
              .digest('hex')
              .slice(0, 32)}`
          : '';

      // 3. Authoritative Read-Only Staff/Customer Resolution & Audit Append inside Transaction
      const txResult = await adminDb.runTransaction(async (transaction: any) => {
        const hasUidConflict = (record: any): boolean =>
          [record?.authUserId, record?.authUid].some(
            (value) =>
              value != null &&
              value !== '' &&
              (typeof value !== 'string' ||
                value.trim() !== value ||
                !isValidDocId(value, 128) ||
                value !== verifiedUid)
          );

        const isStaffDisabled = (record: any): boolean =>
          !record ||
          record.isActive === false ||
          record.loginEnabled === false ||
          [
            'INACTIVE',
            'DISABLED',
            'ARCHIVED',
            'DINONAKTIFKAN',
            'DELETED',
            'TERMINATED',
            'SUSPENDED',
          ].includes(textId(record.status).toUpperCase()) ||
          textId(record.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';

        const roleRef = adminDb.collection('staff_roles').doc(verifiedUid);
        const canonicalStaffQuery = adminDb
          .collection('staff_users')
          .where('authUserId', '==', verifiedUid)
          .limit(2);
        const legacyStaffQuery = adminDb
          .collection('staff_users')
          .where('authUid', '==', verifiedUid)
          .limit(2);
        const directStaffRef = adminDb.collection('staff_users').doc(verifiedUid);
        const targetCustRef =
          customerId !== 'all' ? adminDb.collection('customers').doc(customerId) : null;
        const custByAuthUserQuery = adminDb
          .collection('customers')
          .where('authUserId', '==', verifiedUid)
          .limit(2);
        const custByCanonicalQuery = adminDb
          .collection('customers')
          .where('customerAuthUid', '==', verifiedUid)
          .limit(2);
        const staffAuditRef = adminDb.collection('customer_audit_logs').doc(staffLogId);
        const selfRegAuditRef = selfRegLogId
          ? adminDb.collection('customer_audit_logs').doc(selfRegLogId)
          : null;
        const custAuditQuery =
          customerId !== 'all' && action === 'created'
            ? adminDb
                .collection('customer_audit_logs')
                .where('customerId', '==', customerId)
                .limit(20)
            : null;

        const [
          roleSnap,
          canonicalStaffSnap,
          legacyStaffSnap,
          directStaffSnap,
          targetCustSnap,
          custByAuthUserSnap,
          custByCanonicalSnap,
          existingStaffAuditSnap,
          existingSelfRegAuditSnap,
          existingCustAuditQuerySnap,
        ] = await Promise.all([
          transaction.get(roleRef),
          transaction.get(canonicalStaffQuery),
          transaction.get(legacyStaffQuery),
          transaction.get(directStaffRef),
          targetCustRef ? transaction.get(targetCustRef) : Promise.resolve(null),
          transaction.get(custByAuthUserQuery),
          transaction.get(custByCanonicalQuery),
          transaction.get(staffAuditRef),
          selfRegAuditRef ? transaction.get(selfRegAuditRef) : Promise.resolve(null),
          custAuditQuery ? transaction.get(custAuditQuery) : Promise.resolve(null),
        ]);

        const staffDocs = new Map<string, any>();
        for (const d of [
          ...(canonicalStaffSnap?.docs || []),
          ...(legacyStaffSnap?.docs || []),
        ]) {
          if (snapExists(d)) staffDocs.set(d.id, d);
        }
        if (snapExists(directStaffSnap)) {
          staffDocs.set(directStaffSnap.id, directStaffSnap);
        }

        const roleExists = snapExists(roleSnap);
        if (roleExists) {
          const roleData = roleSnap.data() || {};
          for (const linked of [roleData.staffId, roleData.staffUserId]) {
            if (typeof linked === 'string' && isValidDocId(linked, 128) && !staffDocs.has(linked)) {
              const linkedSnap = await transaction.get(
                adminDb.collection('staff_users').doc(linked)
              );
              if (snapExists(linkedSnap)) {
                staffDocs.set(linkedSnap.id, linkedSnap);
              }
            }
          }
        }

        const hasStaffFootprint = staffDocs.size > 0 || roleExists;

        if (hasStaffFootprint) {
          // Stage 4B/4C: Require unique UID-bound Staff Master AND matching active staff_roles
          if (staffDocs.size === 0 || !roleExists) {
            return {
              status: 403,
              code: 'STAFF_AUTHORIZATION_DENIED',
              message: 'Identitas staf belum terikat atau tidak memiliki otorisasi aktif.',
            };
          }
          if (staffDocs.size > 1) {
            return {
              status: 403,
              code: 'STAFF_DUPLICATE_MAPPING',
              message: 'Identitas staf memiliki duplikasi pemetaan pada Staff Master.',
            };
          }

          const staffSnap = [...staffDocs.values()][0];
          const staff = staffSnap.data() || {};
          const role = roleSnap.data() || {};

          if (hasUidConflict(staff) || hasUidConflict(role)) {
            return {
              status: 403,
              code: 'STAFF_UID_MISMATCH',
              message: 'Identitas UID staf tidak sesuai dengan sesi autentikasi.',
            };
          }

          const isUidBound =
            staffSnap.id === verifiedUid ||
            (typeof staff.authUserId === 'string' && staff.authUserId === verifiedUid) ||
            (typeof staff.authUid === 'string' && staff.authUid === verifiedUid);
          if (!isUidBound) {
            return {
              status: 403,
              code: 'STAFF_UID_UNBOUND',
              message: 'Profil Staff Master tidak terikat pada UID sesi saat ini.',
            };
          }

          if (
            isStaffDisabled(staff) ||
            isStaffDisabled(role) ||
            role.isActive !== true
          ) {
            return {
              status: 403,
              code: 'STAFF_INACTIVE',
              message: 'Akun staf sedang tidak aktif atau telah dinonaktifkan.',
            };
          }

          const staffRole = textId(staff.role);
          const activeRole = textId(role.role);
          if (
            !staffRole ||
            staff.role !== staffRole ||
            role.role !== activeRole ||
            activeRole !== staffRole
          ) {
            return {
              status: 403,
              code: 'STAFF_ROLE_MISMATCH',
              message: 'Role staf tidak sesuai dengan Staff Master saat ini.',
            };
          }

          for (const aliasField of [staff.uid, staff.id]) {
            if (aliasField !== undefined && aliasField !== null && aliasField !== '') {
              if (typeof aliasField !== 'string' || !isValidDocId(aliasField, 128)) {
                return {
                  status: 403,
                  code: 'STAFF_ROLE_MAPPING_CONFLICT',
                  message: 'Alias identitas Staff Master tidak valid.',
                };
              }
            }
          }

          if (
            typeof staff.uid === 'string' &&
            staff.uid !== '' &&
            typeof staff.id === 'string' &&
            staff.id !== '' &&
            staff.uid !== staff.id &&
            ![verifiedUid, staffSnap.id].includes(staff.uid) &&
            ![verifiedUid, staffSnap.id].includes(staff.id)
          ) {
            return {
              status: 403,
              code: 'STAFF_ROLE_MAPPING_CONFLICT',
              message: 'Konflik alias uid/id pada Staff Master.',
            };
          }

          const aliases = new Set(
            [verifiedUid, staffSnap.id, textId(staff.uid), textId(staff.id)].filter(Boolean)
          );
          for (const linkedId of [role.staffId, role.staffUserId]) {
            if (linkedId !== undefined && linkedId !== null && linkedId !== '') {
              if (
                typeof linkedId !== 'string' ||
                !isValidDocId(linkedId, 128) ||
                !aliases.has(linkedId)
              ) {
                return {
                  status: 403,
                  code: 'STAFF_ROLE_MAPPING_CONFLICT',
                  message: 'Referensi Staff Master pada staff_roles tidak sesuai.',
                };
              }
            }
          }

          if (!['css', 'supervisor', 'manager', 'admin'].includes(staffRole)) {
            return {
              status: 403,
              code: 'PERMISSION_DENIED',
              message: 'Hanya staf operasional aktif (CSS, Supervisor, Manager, Admin) yang berwenang.',
            };
          }

          if (!sanitizedDetails) {
            return {
              status: 400,
              code: 'INVALID_AUDIT_DETAILS',
              message: 'Detail tindakan audit wajib diisi.',
            };
          }

          const actorRole = staffRole;
          const actorName =
            sanitizeText(staff.name, 120) ||
            sanitizeText(staff.displayName, 120) ||
            sanitizeText(staff.fullName, 120) ||
            sanitizeText(role.name, 120) ||
            'Staff Senzu';
          const performedBy = `${actorName} (${actorRole})`;
          const finalDetails = sanitizedDetails;
          const requestFingerprint = computeAuditFingerprint({
            actorScope: 'staff',
            actorUid: verifiedUid,
            customerId,
            action,
            details: finalDetails,
          });

          // Staff Idempotency Check (keyed by verifiedUid + requestId, independent of customerId/action/details)
          if (cleanRequestId && snapExists(existingStaffAuditSnap)) {
            const existingEntry = existingStaffAuditSnap.data();
            const isValidStoredStaffEntry =
              Boolean(
                existingEntry &&
                  typeof existingEntry === 'object' &&
                  !Array.isArray(existingEntry)
              ) &&
              existingEntry.id === staffLogId &&
              existingEntry.requestId === cleanRequestId &&
              existingEntry.actorUid === verifiedUid &&
              existingEntry.actorId === verifiedUid &&
              existingEntry.actorRole === actorRole &&
              typeof existingEntry.actorName === 'string' &&
              existingEntry.actorName.trim().length > 0 &&
              existingEntry.performedBy === performedBy &&
              typeof existingEntry.customerId === 'string' &&
              isValidDocId(existingEntry.customerId, 128) &&
              typeof existingEntry.action === 'string' &&
              ALLOWED_CUSTOMER_AUDIT_ACTIONS.has(existingEntry.action) &&
              (existingEntry.customerId !== 'all' || existingEntry.action === 'updated') &&
              typeof existingEntry.details === 'string' &&
              existingEntry.details.trim().length > 0 &&
              existingEntry.details.trim() === existingEntry.details &&
              Buffer.byteLength(existingEntry.details, 'utf8') <= 1000 &&
              typeof existingEntry.timestamp === 'string' &&
              !Number.isNaN(Date.parse(existingEntry.timestamp)) &&
              typeof existingEntry.requestFingerprint === 'string' &&
              /^[a-f0-9]{64}$/.test(existingEntry.requestFingerprint) &&
              existingEntry.requestFingerprint ===
                computeAuditFingerprint({
                  actorScope: 'staff',
                  actorUid: existingEntry.actorUid,
                  customerId: existingEntry.customerId,
                  action: existingEntry.action,
                  details: existingEntry.details,
                });

            if (!isValidStoredStaffEntry) {
              return {
                status: 409,
                code: 'AUDIT_REPLAY_INVALID',
                message: 'Data audit sebelumnya tidak valid atau mengalami konflik kepemilikan.',
              };
            }

            if (
              existingEntry.requestFingerprint !== requestFingerprint ||
              existingEntry.customerId !== customerId ||
              existingEntry.action !== action ||
              existingEntry.details !== finalDetails
            ) {
              return {
                status: 409,
                code: 'AUDIT_IDEMPOTENCY_MISMATCH',
                message:
                  'ID permintaan (requestId) telah digunakan dengan parameter audit yang berbeda.',
              };
            }

            if (customerId !== 'all') {
              if (!snapExists(targetCustSnap)) {
                return {
                  status: 409,
                  code: 'AUDIT_REPLAY_INVALID',
                  message: 'Target pelanggan pada entri audit sudah tidak ditemukan.',
                };
              }
              const targetCustData = targetCustSnap.data() || {};
              if (
                targetCustData.id !== undefined &&
                targetCustData.id !== null &&
                targetCustData.id !== '' &&
                (typeof targetCustData.id !== 'string' || targetCustData.id !== customerId)
              ) {
                return {
                  status: 409,
                  code: 'AUDIT_REPLAY_INVALID',
                  message: 'Identitas profil pelanggan pada entri audit mengalami konflik.',
                };
              }
            }

            return {
              status: 200,
              isIdempotent: true,
              entry: existingEntry,
            };
          }

          if (customerId === 'all') {
            if (action !== 'updated') {
              return {
                status: 403,
                code: 'INVALID_GLOBAL_AUDIT_ACTION',
                message: 'Target customerId="all" hanya diizinkan untuk ringkasan global staf.',
              };
            }
          } else {
            if (!snapExists(targetCustSnap)) {
              return {
                status: 404,
                code: 'CUSTOMER_NOT_FOUND',
                message: 'Data pelanggan tidak ditemukan.',
              };
            }
            const targetCustData = targetCustSnap.data() || {};
            if (
              targetCustData.id !== undefined &&
              targetCustData.id !== null &&
              targetCustData.id !== '' &&
              (typeof targetCustData.id !== 'string' || targetCustData.id !== customerId)
            ) {
              return {
                status: 409,
                code: 'CUSTOMER_RECORD_CONFLICT',
                message: 'Identitas dokumen pelanggan tidak konsisten.',
              };
            }
          }

          if (snapExists(existingStaffAuditSnap)) {
            return {
              status: 409,
              code: 'AUDIT_ID_CONFLICT',
              message: 'Entri audit sudah ada. Silakan coba kembali.',
            };
          }

          const nowIso = new Date().toISOString();
          const entry: Record<string, any> = {
            id: staffLogId,
            source: 'client_report',
            customerId,
            action,
            details: finalDetails,
            performedBy,
            actorUid: verifiedUid,
            actorId: verifiedUid,
            actorRole,
            actorName,
            timestamp: nowIso,
            requestFingerprint,
            ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
          };

          transaction.create(staffAuditRef, entry);
          return {
            status: 200,
            isIdempotent: false,
            entry,
          };
        } else {
          // Non-operational caller (Customer): ONLY action="created" for own UID-bound profile
          if (customerId === 'all' || action !== 'created') {
            return {
              status: 403,
              code: 'PERMISSION_DENIED',
              message: 'Pelanggan hanya dapat mencatat audit pembuatan profil milik sendiri.',
            };
          }

          if (
            customerId.startsWith('cust_u_') &&
            customerId !== `cust_u_${verifiedUid}` &&
            customerId !== `cust_u_${verifiedUid.slice(0, 10)}`
          ) {
            return {
              status: 403,
              code: 'FOREIGN_CUSTOMER_PROFILE',
              message: 'ID profil pelanggan tidak sesuai dengan identitas akun.',
            };
          }

          if (!snapExists(targetCustSnap) || !selfRegAuditRef) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_UNVERIFIED',
              message: 'Profil pelanggan tidak ditemukan atau akses ditolak.',
            };
          }

          const profile = targetCustSnap.data() || {};
          if (
            profile.id !== undefined &&
            profile.id !== null &&
            profile.id !== '' &&
            (typeof profile.id !== 'string' || profile.id !== customerId)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_MALFORMED',
              message: 'Identitas profil pelanggan tidak sesuai.',
            };
          }

          for (const rawUidVal of [profile.authUserId, profile.customerAuthUid]) {
            if (rawUidVal !== undefined && rawUidVal !== null && rawUidVal !== '') {
              if (
                typeof rawUidVal !== 'string' ||
                rawUidVal.trim() !== rawUidVal ||
                !isValidDocId(rawUidVal, 128)
              ) {
                return {
                  status: 403,
                  code: 'CUSTOMER_OWNERSHIP_MALFORMED',
                  message: 'Atribut kepemilikan profil pelanggan tidak valid.',
                };
              }
            }
          }

          const ownerAuthUserId = textId(profile.authUserId);
          const ownerCustomerAuthUid = textId(profile.customerAuthUid);

          if (!ownerAuthUserId && !ownerCustomerAuthUid) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_MISSING',
              message: 'Profil pelanggan tidak memiliki ikatan UID terotentikasi.',
            };
          }

          if (
            ownerAuthUserId &&
            ownerCustomerAuthUid &&
            ownerAuthUserId !== ownerCustomerAuthUid
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              message: 'Kepemilikan profil pelanggan mengalami konflik.',
            };
          }

          if (
            (ownerAuthUserId && ownerAuthUserId !== verifiedUid) ||
            (ownerCustomerAuthUid && ownerCustomerAuthUid !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'FOREIGN_CUSTOMER_PROFILE',
              message: 'Akses ke profil pelanggan lain ditolak.',
            };
          }

          const ownedProfiles = new Map<string, any>();
          for (const d of [
            ...(custByAuthUserSnap?.docs || []),
            ...(custByCanonicalSnap?.docs || []),
          ]) {
            if (snapExists(d)) ownedProfiles.set(d.id, d);
          }

          if (ownedProfiles.size !== 1 || !ownedProfiles.has(customerId)) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              message: 'Kepemilikan profil pelanggan tidak unik atau konflik.',
            };
          }

          const acctType = textId(profile.accountType).toUpperCase();
          const acctStatus = textId(profile.accountStatus).toUpperCase();
          const profStatus = textId(profile.status).toUpperCase();
          const crmStatus = textId(profile.crmStatus).toLowerCase();
          const custStatus = textId(profile.customerStatus).toLowerCase();

          if (
            (acctType && acctType !== 'CUSTOMER') ||
            acctStatus === 'DISABLED' ||
            acctStatus === 'NOT_REGISTERED' ||
            acctStatus === 'INACTIVE' ||
            ['DISABLED', 'INACTIVE', 'ARCHIVED', 'BLOCKED', 'DELETED', 'DELETION_REQUESTED'].includes(
              profStatus
            ) ||
            ['archived', 'blocked'].includes(crmStatus) ||
            ['archived', 'blocked'].includes(custStatus)
          ) {
            return {
              status: 403,
              code: 'CUSTOMER_PROFILE_INACTIVE',
              message: 'Profil pelanggan sedang tidak aktif atau tidak memenuhi syarat.',
            };
          }

          const profileEmail =
            sanitizeText(profile.email, 120).toLowerCase() || verifiedEmail || '-';
          const profilePhone =
            sanitizeText(profile.normalizedPhone, 40) ||
            sanitizeText(profile.phone, 40) ||
            sanitizeText(profile.whatsapp, 40) ||
            '-';

          const actorRole = 'customer';
          const actorName =
            sanitizeText(profile.name, 120) ||
            sanitizeText(profile.displayName, 120) ||
            'Pelanggan Senzu';
          const performedBy = 'Customer / Self-Registration';
          const finalDetails = `Akun pelanggan berhasil didaftarkan via Email (${profileEmail}) & WhatsApp (${profilePhone}).`;
          const requestFingerprint = computeAuditFingerprint({
            actorScope: 'customer',
            actorUid: verifiedUid,
            customerId,
            action: 'created',
            details: finalDetails,
          });

          // 1) Check stable server-side self-registration audit document first
          if (snapExists(existingSelfRegAuditSnap)) {
            const existingEntry = existingSelfRegAuditSnap.data();
            const isValidSelfRegEntry =
              Boolean(
                existingEntry &&
                  typeof existingEntry === 'object' &&
                  !Array.isArray(existingEntry)
              ) &&
              existingEntry.id === selfRegLogId &&
              existingEntry.customerId === customerId &&
              existingEntry.action === 'created' &&
              existingEntry.actorUid === verifiedUid &&
              existingEntry.actorId === verifiedUid &&
              existingEntry.actorRole === 'customer' &&
              typeof existingEntry.actorName === 'string' &&
              existingEntry.actorName.trim().length > 0 &&
              existingEntry.performedBy === 'Customer / Self-Registration' &&
              typeof existingEntry.details === 'string' &&
              existingEntry.details.trim().length > 0 &&
              existingEntry.details.trim() === existingEntry.details &&
              Buffer.byteLength(existingEntry.details, 'utf8') <= 1000 &&
              typeof existingEntry.timestamp === 'string' &&
              !Number.isNaN(Date.parse(existingEntry.timestamp)) &&
              typeof existingEntry.requestFingerprint === 'string' &&
              /^[a-f0-9]{64}$/.test(existingEntry.requestFingerprint) &&
              existingEntry.requestFingerprint ===
                computeAuditFingerprint({
                  actorScope: 'customer',
                  actorUid: existingEntry.actorUid,
                  customerId: existingEntry.customerId,
                  action: 'created',
                  details: existingEntry.details,
                }) &&
              (existingEntry.requestId === undefined ||
                isValidDocId(existingEntry.requestId, 128));

            if (!isValidSelfRegEntry) {
              return {
                status: 409,
                code: 'AUDIT_REPLAY_INVALID',
                message: 'Entri audit pendaftaran mandiri mengalami konflik kepemilikan atau integritas.',
              };
            }

            return {
              status: 200,
              isIdempotent: true,
              entry: existingEntry,
            };
          }

          // 2) Check existing historical records for this customer profile (preserve historical logs; prevent duplicate self-registration)
          for (const d of existingCustAuditQuerySnap?.docs || []) {
            if (!snapExists(d)) continue;
            const hist = d.data();
            if (!hist || typeof hist !== 'object' || Array.isArray(hist)) continue;
            if (hist.action !== 'created') continue;

            const isSelfRegRecord =
              hist.performedBy === 'Customer / Self-Registration' ||
              hist.actorRole === 'customer' ||
              hist.actorUid !== undefined ||
              hist.actorId !== undefined;

            if (!isSelfRegRecord) {
              // Preserve non-self-registration historical "created" record (e.g. 'System / Booking Form') without rewriting it
              continue;
            }

            const histValid =
              (hist.id === undefined || hist.id === d.id) &&
              hist.customerId === customerId &&
              hist.action === 'created' &&
              hist.performedBy === 'Customer / Self-Registration' &&
              hist.actorRole === 'customer' &&
              Boolean(hist.actorUid === verifiedUid || hist.actorId === verifiedUid) &&
              (hist.actorUid === undefined || hist.actorUid === verifiedUid) &&
              (hist.actorId === undefined || hist.actorId === verifiedUid) &&
              typeof hist.details === 'string' &&
              hist.details.trim().length > 0 &&
              hist.details.trim() === hist.details &&
              Buffer.byteLength(hist.details, 'utf8') <= 1000 &&
              typeof hist.timestamp === 'string' &&
              !Number.isNaN(Date.parse(hist.timestamp)) &&
              (hist.requestFingerprint === undefined ||
                (/^[a-f0-9]{64}$/.test(hist.requestFingerprint) &&
                  hist.requestFingerprint ===
                    computeAuditFingerprint({
                      actorScope: 'customer',
                      actorUid: verifiedUid,
                      customerId,
                      action: 'created',
                      details: hist.details,
                    }))) &&
              (hist.requestId === undefined || isValidDocId(hist.requestId, 128));

            if (!histValid) {
              return {
                status: 409,
                code: 'AUDIT_REPLAY_INVALID',
                message: 'Riwayat audit pendaftaran pelanggan mengalami konflik kepemilikan atau integritas.',
              };
            }

            return {
              status: 200,
              isIdempotent: true,
              entry: { ...hist, id: hist.id || d.id },
            };
          }

          const nowIso = new Date().toISOString();
          const entry: Record<string, any> = {
            id: selfRegLogId,
            customerId,
            action: 'created',
            details: finalDetails,
            performedBy,
            actorUid: verifiedUid,
            actorId: verifiedUid,
            actorRole,
            actorName,
            timestamp: nowIso,
            requestFingerprint,
            ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
          };

          transaction.create(selfRegAuditRef, entry);
          return {
            status: 200,
            isIdempotent: false,
            entry,
          };
        }
      });

      if (txResult.status !== 200) {
        return res.status(txResult.status).json({
          success: false,
          code: txResult.code,
          error: txResult.message,
          message: txResult.message,
        });
      }

      return res.json({
        success: true,
        id: txResult.entry.id,
        isIdempotent: txResult.isIdempotent,
        auditLog: txResult.entry,
      });
    } catch (err: any) {
      console.error('[Server CRM] Customer audit append error:', err);
      const errCodeStr = String(err?.code || '');
      const errMsgStr = String(err?.message || '');
      const isAlreadyExists =
        err?.code === 6 ||
        errCodeStr === 'already-exists' ||
        /already[-_\s]?exists/i.test(`${errCodeStr} ${errMsgStr}`);
      if (isAlreadyExists) {
        return res.status(409).json({
          success: false,
          code: 'AUDIT_ID_CONFLICT',
          error: 'Entri audit sudah ada. Silakan coba kembali.',
          message: 'Entri audit sudah ada. Silakan coba kembali.',
        });
      }
      const statusCode =
        typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
          ? err.statusCode
          : 503;
      const code = err?.code || (statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_ERROR');
      const msg =
        statusCode === 503
          ? 'Layanan pencatatan audit pelanggan sedang tidak tersedia.'
          : err?.message || 'Permintaan tidak dapat diproses.';
      return res.status(statusCode).json({
        success: false,
        code,
        error: msg,
        message: msg,
      });
    }
  });

  // =============================================================
  // STAGE 7B: AUTHORITATIVE BOOKING STATUS HISTORY (Finding 6)
  // =============================================================

  function isValidBookingHistoryDocId(val: unknown, maxBytes = 128): val is string {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    if (!trimmed || trimmed !== val) return false;
    if (trimmed === '.' || trimmed === '..') return false;
    if (Buffer.byteLength(trimmed, 'utf8') > maxBytes) return false;
    if (/[\/\\\x00-\x1F\x7F\s]/.test(trimmed)) return false;
    return true;
  }

  function isValidBookingHistoryCode(val: unknown, maxBytes = 64): val is string {
    if (!isValidBookingHistoryDocId(val, maxBytes)) return false;
    return val.length >= 3;
  }

  function formatBookingHistoryWIB(isoOrDate: string | Date): string {
    try {
      const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
      if (Number.isNaN(d.getTime())) return String(isoOrDate);
      const formatted = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
      return `${formatted} WIB`;
    } catch {
      return `${String(isoOrDate)} WIB`;
    }
  }

  function computeBookingHistoryFingerprint(params: {
    actorScope: 'staff' | 'customer';
    actorUid: string;
    bookingId: string;
    bookingCode: string;
    status: string;
    note: string;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          'v1',
          params.actorScope,
          params.actorUid,
          params.bookingId,
          params.bookingCode,
          params.status,
          params.note,
        ])
      )
      .digest('hex');
  }

  async function recordAcceptedOrderStatusHistory(params: {
    bookingId: string;
    bookingCode: string;
    therapistId: string;
    therapistName: string;
    actorUid: string;
    acceptedAt: string;
  }): Promise<void> {
    if (!adminDb || typeof adminDb.runTransaction !== 'function') return;
    const bookingId = typeof params.bookingId === 'string' ? params.bookingId.trim() : '';
    const actorUid = typeof params.actorUid === 'string' ? params.actorUid.trim() : '';
    if (!isValidBookingHistoryDocId(bookingId, 128) || !isValidBookingHistoryDocId(actorUid, 128)) {
      return;
    }

    const acceptedAt =
      typeof params.acceptedAt === 'string' && !Number.isNaN(Date.parse(params.acceptedAt))
        ? params.acceptedAt
        : new Date().toISOString();
    const cleanTherapistName =
      typeof params.therapistName === 'string'
        ? params.therapistName.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, 120)
        : '';
    const cleanTherapistId =
      typeof params.therapistId === 'string' && isValidBookingHistoryDocId(params.therapistId, 128)
        ? params.therapistId
        : '';
    const rawCode = typeof params.bookingCode === 'string' ? params.bookingCode.trim() : '';

    const histId = `hist_${createHash('sha256')
      .update(`accept_order:${actorUid}:${bookingId}:${acceptedAt}`)
      .digest('hex')
      .slice(0, 32)}`;

    await adminDb.runTransaction(async (transaction: any) => {
      const snapExists = (snap: any): boolean =>
        Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

      const bookingRef = adminDb.collection('bookings').doc(bookingId);
      const histRef = adminDb.collection('booking_status_history').doc(histId);
      const byIdQuery = adminDb
        .collection('booking_status_history')
        .where('bookingId', '==', bookingId);
      const byCodeQuery = isValidBookingHistoryCode(rawCode, 64)
        ? adminDb
            .collection('booking_status_history')
            .where('bookingCode', '==', rawCode)
        : null;

      const [bookingSnap, existingHistSnap, byIdSnap, byCodeSnap] = await Promise.all([
        transaction.get(bookingRef),
        transaction.get(histRef),
        transaction.get(byIdQuery),
        byCodeQuery ? transaction.get(byCodeQuery) : Promise.resolve(null),
      ]);

      if (!snapExists(bookingSnap) || snapExists(existingHistSnap)) return;
      const bData = bookingSnap.data() || {};
      if (bData.status !== 'Accepted') return;

      const resolvedCode = isValidBookingHistoryCode(bData.bookingCode, 64)
        ? bData.bookingCode
        : isValidBookingHistoryCode(rawCode, 64)
        ? rawCode
        : bookingId;

      const existingMap = new Map<string, { id: string; data: any }>();
      for (const d of [...(byIdSnap?.docs || []), ...(byCodeSnap?.docs || [])]) {
        if (snapExists(d)) {
          existingMap.set(d.id, { id: d.id, data: d.data() });
        }
      }
      const existingList = [...existingMap.values()].filter(({ data: item }) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        if (item.bookingId !== undefined && item.bookingId !== bookingId) return false;
        if (item.bookingCode !== undefined && item.bookingCode !== resolvedCode) return false;
        if (typeof item.status !== 'string' || !item.status.trim()) return false;
        if (typeof item.timestamp !== 'string' || Number.isNaN(Date.parse(item.timestamp))) {
          return false;
        }
        return true;
      });
      existingList.sort((a, b) => {
        const diff =
          new Date(a.data.timestamp || 0).getTime() -
          new Date(b.data.timestamp || 0).getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
      const last = existingList[existingList.length - 1];
      if (last && last.data.status === 'Accepted') return;

      const displayTherapist = cleanTherapistName || 'Terapis';
      const note = `Pesanan diterima oleh Terapis ${cleanTherapistName || 'Senzu'}`;
      const entry: Record<string, any> = {
        id: histId,
        bookingId,
        bookingCode: resolvedCode,
        status: 'Accepted',
        note,
        updatedByRole: 'therapist',
        updatedByName: displayTherapist,
        actorUid,
        actorId: actorUid,
        actorRole: 'therapist',
        actorName: displayTherapist,
        ...(cleanTherapistId ? { therapistId: cleanTherapistId } : {}),
        timestamp: acceptedAt,
        formattedWIB: formatBookingHistoryWIB(acceptedAt),
        requestFingerprint: computeBookingHistoryFingerprint({
          actorScope: 'staff',
          actorUid,
          bookingId,
          bookingCode: resolvedCode,
          status: 'Accepted',
          note,
        }),
      };

      transaction.create(histRef, entry);
    });
  }

  const bookingHistoryInitialRateLimit = new Map<string, { count: number; resetAt: number }>();

  const handleBookingStatusHistoryInitial = async (req: express.Request, res: express.Response) => {
    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

    const textId = (value: unknown): string =>
      typeof value === 'string' ? value.trim() : '';

    const sanitizeText = (value: unknown, maxLen = 250): string =>
      typeof value === 'string'
        ? value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen)
        : '';

    const extractSnapshotCreateTimeIso = (snap: any): string | null => {
      const ct = snap?.createTime;
      if (ct === null || ct === undefined) return null;
      if (typeof ct?.toDate === 'function') {
        const d = ct.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
        return null;
      }
      if (ct instanceof Date) {
        return !Number.isNaN(ct.getTime()) ? ct.toISOString() : null;
      }
      if (typeof ct === 'string') {
        const trimmed = ct.trim();
        if (!trimmed) return null;
        const parsed = new Date(trimmed);
        return !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
      }
      const secs =
        typeof ct?.seconds === 'number'
          ? ct.seconds
          : typeof ct?._seconds === 'number'
          ? ct._seconds
          : null;
      if (secs !== null && Number.isFinite(secs)) {
        const nanos =
          typeof ct?.nanoseconds === 'number'
            ? ct.nanoseconds
            : typeof ct?._nanoseconds === 'number'
            ? ct._nanoseconds
            : 0;
        const d = new Date(secs * 1000 + Math.floor(nanos / 1e6));
        return !Number.isNaN(d.getTime()) ? d.toISOString() : null;
      }
      return null;
    };

    const INITIAL_ELIGIBLE_STATUSES = new Set<string>([
      'Menunggu Pembayaran',
      'awaiting_payment',
      'Draft',
      'Pending',
    ]);

    const sendGenericInitialAck = () =>
      res.status(200).json({
        success: true,
        code: 'INITIAL_HISTORY_ACKNOWLEDGED',
        message: 'Permintaan inisialisasi riwayat pesanan telah diproses.',
      });

    try {
      // 1. Rate-limit requests BEFORE any database reads
      const rawForwarded = req.headers?.['x-forwarded-for'];
      const forwardedFirst =
        typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim() : '';
      const clientIp =
        (forwardedFirst && /^[0-9a-fA-F:.]+$/.test(forwardedFirst) ? forwardedFirst : '') ||
        req.ip ||
        req.socket?.remoteAddress ||
        'unknown';

      const now = Date.now();
      for (const [ipKey, entry] of bookingHistoryInitialRateLimit.entries()) {
        if (entry.resetAt <= now) {
          bookingHistoryInitialRateLimit.delete(ipKey);
        }
      }
      const currentRate = bookingHistoryInitialRateLimit.get(clientIp);
      if (currentRate && now < currentRate.resetAt) {
        if (currentRate.count >= 25) {
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMITED',
            error: 'Terlalu banyak permintaan inisialisasi riwayat dalam waktu singkat.',
            message: 'Terlalu banyak permintaan inisialisasi riwayat dalam waktu singkat.',
          });
        }
        currentRate.count++;
      } else {
        bookingHistoryInitialRateLimit.set(clientIp, {
          count: 1,
          resetAt: now + 60_000,
        });
      }

      // 2. Reject signed-in credentials and any arbitrary caller fields (browser sends ONLY { bookingId })
      const rawAuthHeader = req.headers?.authorization;
      if (typeof rawAuthHeader === 'string' && rawAuthHeader.trim() !== '') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INITIAL_HISTORY_PAYLOAD',
          error: 'Endpoint inisialisasi tamu tidak menerima kredensial sesi.',
          message: 'Endpoint inisialisasi tamu tidak menerima kredensial sesi.',
        });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYLOAD',
          error: 'Format permintaan inisialisasi riwayat tidak valid.',
          message: 'Format permintaan inisialisasi riwayat tidak valid.',
        });
      }

      const bodyKeys = Object.keys(req.body);
      if (bodyKeys.length !== 1 || bodyKeys[0] !== 'bookingId') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INITIAL_HISTORY_PAYLOAD',
          error: 'Permintaan inisialisasi hanya mengizinkan atribut bookingId.',
          message: 'Permintaan inisialisasi hanya mengizinkan atribut bookingId.',
        });
      }

      const rawBookingId = req.body.bookingId;
      if (!isValidBookingHistoryDocId(rawBookingId, 128)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_ID',
          error: 'ID pesanan tidak valid.',
          message: 'ID pesanan tidak valid.',
        });
      }
      const bookingId = rawBookingId;

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: 'Database server sedang tidak tersedia.',
          message: 'Database server sedang tidak tersedia.',
        });
      }

      const initHistId = `hist_${createHash('sha256')
        .update(`initial_guest:${bookingId}`)
        .digest('hex')
        .slice(0, 32)}`;

      await adminDb.runTransaction(async (transaction: any) => {
        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        const initHistRef = adminDb.collection('booking_status_history').doc(initHistId);
        const byIdQuery = adminDb
          .collection('booking_status_history')
          .where('bookingId', '==', bookingId);

        const [bookingSnap, existingInitSnap, byIdSnap] = await Promise.all([
          transaction.get(bookingRef),
          transaction.get(initHistRef),
          transaction.get(byIdQuery),
        ]);

        // Missing booking -> generic ack with zero writes
        if (!snapExists(bookingSnap)) return;

        const bookingData = bookingSnap.data() || {};
        if (
          bookingData.id !== undefined &&
          bookingData.id !== null &&
          bookingData.id !== '' &&
          (typeof bookingData.id !== 'string' || bookingData.id !== bookingId)
        ) {
          return;
        }

        const storedBookingCode = textId(bookingData.bookingCode);
        if (!isValidBookingHistoryCode(storedBookingCode, 64)) {
          return;
        }

        // Reject owned bookings (zero writes, no PII disclosure)
        for (const ownerField of [
          bookingData.customerAuthUid,
          bookingData.authUserId,
          bookingData.customerUid,
          bookingData.userId,
          bookingData.uid,
        ]) {
          if (ownerField !== undefined && ownerField !== null && ownerField !== '') {
            return;
          }
        }

        const rawCustomerId = bookingData.customerId;
        let cleanCustomerId = '';
        if (rawCustomerId !== undefined && rawCustomerId !== null && rawCustomerId !== '') {
          if (
            typeof rawCustomerId !== 'string' ||
            rawCustomerId.trim() !== rawCustomerId ||
            !isValidBookingHistoryDocId(rawCustomerId, 128) ||
            rawCustomerId.startsWith('cust_u_')
          ) {
            return;
          }
          cleanCustomerId = rawCustomerId;
        }

        // Must be in an eligible initial status & unpaid/initial lifecycle
        const storedStatus = textId(bookingData.status);
        if (!INITIAL_ELIGIBLE_STATUSES.has(storedStatus)) {
          return;
        }

        const pStatus = textId(bookingData.paymentStatus).toUpperCase();
        if (
          !['', 'UNPAID', 'PENDING', 'PENDING_PAYMENT', 'MENUNGGU PEMBAYARAN'].includes(pStatus)
        ) {
          return;
        }

        for (const lifecycleField of [
          bookingData.paymentVerifiedAt,
          bookingData.confirmedAt,
          bookingData.assignedAt,
          bookingData.acceptedAt,
          bookingData.onTheWayAt,
          bookingData.arrivedAt,
          bookingData.treatmentStartedAt,
          bookingData.completedAt,
          bookingData.therapistId,
          bookingData.assignedTherapistId,
        ]) {
          if (
            lifecycleField !== undefined &&
            lifecycleField !== null &&
            String(lifecycleField).trim() !== ''
          ) {
            return;
          }
        }

        // Derive initial timestamp strictly from Firestore snapshot.createTime
        const initialTimestampIso = extractSnapshotCreateTimeIso(bookingSnap);
        if (!initialTimestampIso) {
          return;
        }

        const bookingByCodeQuery = adminDb
          .collection('bookings')
          .where('bookingCode', '==', storedBookingCode)
          .limit(2);
        const byCodeQuery = adminDb
          .collection('booking_status_history')
          .where('bookingCode', '==', storedBookingCode);

        const [bookingByCodeSnap, byCodeSnap, custSnap] = await Promise.all([
          transaction.get(bookingByCodeQuery),
          transaction.get(byCodeQuery),
          cleanCustomerId
            ? transaction.get(adminDb.collection('customers').doc(cleanCustomerId))
            : Promise.resolve(null),
        ]);

        for (const d of bookingByCodeSnap?.docs || []) {
          if (snapExists(d) && d.id !== bookingId) {
            return;
          }
        }

        if (snapExists(custSnap)) {
          const custData = custSnap.data() || {};
          if (
            (custData.customerAuthUid !== undefined &&
              custData.customerAuthUid !== null &&
              String(custData.customerAuthUid).trim() !== '') ||
            (custData.authUserId !== undefined &&
              custData.authUserId !== null &&
              String(custData.authUserId).trim() !== '') ||
            textId(custData.accountStatus).toUpperCase() === 'ACTIVE'
          ) {
            return;
          }
        }

        // Repeated calls or bookings with existing history must not duplicate or overwrite
        if (snapExists(existingInitSnap)) return;
        for (const d of [...(byIdSnap?.docs || []), ...(byCodeSnap?.docs || [])]) {
          if (snapExists(d)) return;
        }

        const paymentMethodLabel = sanitizeText(bookingData.paymentMethod, 60) || 'Transfer';
        const initialNote = `Booking awal tercatat otomatis oleh sistem (${storedStatus}). Metode bayar: ${paymentMethodLabel}`;
        const entry: Record<string, any> = {
          id: initHistId,
          bookingId,
          bookingCode: storedBookingCode,
          status: storedStatus,
          note: initialNote,
          updatedByRole: 'system',
          updatedByName: 'Sistem Senzu Home',
          source: 'server_initial_snapshot',
          timestamp: initialTimestampIso,
          formattedWIB: formatBookingHistoryWIB(initialTimestampIso),
        };

        transaction.create(initHistRef, entry);
      });

      return sendGenericInitialAck();
    } catch (err: any) {
      const errCodeStr = String(err?.code || '');
      const errMsgStr = String(err?.message || '');
      const isAlreadyExists =
        err?.code === 6 ||
        errCodeStr === 'already-exists' ||
        /already[-_\s]?exists/i.test(`${errCodeStr} ${errMsgStr}`);
      if (isAlreadyExists) {
        return sendGenericInitialAck();
      }
      console.error('[Server Booking History Initial] Error:', err);
      const statusCode =
        typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
          ? err.statusCode
          : 503;
      const code = err?.code || (statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_ERROR');
      const msg =
        statusCode === 503
          ? 'Layanan inisialisasi riwayat pesanan sedang tidak tersedia.'
          : err?.message || 'Permintaan tidak dapat diproses.';
      return res.status(statusCode).json({
        success: false,
        code,
        error: msg,
        message: msg,
      });
    }
  };

  const handleBookingStatusHistoryAppend = async (req: express.Request, res: express.Response) => {
    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

    const textId = (value: unknown): string =>
      typeof value === 'string' ? value.trim() : '';

    const sanitizeText = (value: unknown, maxLen = 250): string =>
      typeof value === 'string'
        ? value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen)
        : '';

    const ALLOWED_BOOKING_STATUSES = new Set<string>([
      'Draft',
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

    const THERAPIST_ALLOWED_STATUSES = new Set<string>([
      'Accepted',
      'On The Way',
      'Arrived',
      'Treatment',
      'Completed',
    ]);

    const CUSTOMER_ALLOWED_STATUSES = new Set<string>([
      'Menunggu Pembayaran',
      'Cancelled',
    ]);

    try {
      // 1. Require verified Bearer Firebase ID token BEFORE any database access
      const rawAuthHeader = req.headers?.authorization;
      const tokenMatch =
        typeof rawAuthHeader === 'string'
          ? /^Bearer\s+(\S+)$/i.exec(rawAuthHeader.trim())
          : null;
      if (!tokenMatch || !tokenMatch[1]) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Autentikasi diperlukan untuk mencatat riwayat status pesanan.',
          message: 'Autentikasi diperlukan untuk mencatat riwayat status pesanan.',
        });
      }

      if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'AUTH_SERVICE_UNAVAILABLE',
          error: 'Layanan verifikasi otentikasi sedang tidak tersedia.',
          message: 'Layanan verifikasi otentikasi sedang tidak tersedia.',
        });
      }

      let verifiedUid = '';
      try {
        const decoded = await adminAuth.verifyIdToken(tokenMatch[1]);
        if (
          !decoded ||
          typeof decoded.uid !== 'string' ||
          !isValidBookingHistoryDocId(decoded.uid, 128)
        ) {
          return res.status(401).json({
            success: false,
            code: 'AUTH_TOKEN_INVALID',
            error: 'Identitas sesi autentikasi tidak valid.',
            message: 'Identitas sesi autentikasi tidak valid.',
          });
        }
        verifiedUid = decoded.uid;
      } catch (authErr: any) {
        const errCode = String(authErr?.code || '');
        const errMsg = String(authErr?.message || '');
        const isInfraError =
          errCode === 'auth/internal-error' ||
          errCode === 'auth/network-request-failed' ||
          errCode === 'unavailable' ||
          errCode === 'deadline-exceeded' ||
          authErr?.status === 503 ||
          authErr?.statusCode === 503 ||
          /unavailable|network|econnrefused|enotfound|etimedout|eai_again|socket hang up|fetch failed|deadline|internal-error|503/i.test(
            `${errCode} ${errMsg}`
          );
        if (isInfraError) {
          return res.status(503).json({
            success: false,
            code: 'AUTH_SERVICE_UNAVAILABLE',
            error: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
            message: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
          });
        }
        return res.status(401).json({
          success: false,
          code: errCode === 'auth/id-token-expired' ? 'SESSION_EXPIRED' : 'AUTH_TOKEN_INVALID',
          error: 'Sesi autentikasi tidak valid atau telah berakhir.',
          message: 'Sesi autentikasi tidak valid atau telah berakhir.',
        });
      }

      // 2. Validate bounded bookingId, bookingCode, status, note, and requestId BEFORE database access
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PAYLOAD',
          error: 'Format permintaan riwayat status pesanan tidak valid.',
          message: 'Format permintaan riwayat status pesanan tidak valid.',
        });
      }

      const rawBookingId = req.body.bookingId;
      if (!isValidBookingHistoryDocId(rawBookingId, 128)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_ID',
          error: 'ID pesanan tidak valid.',
          message: 'ID pesanan tidak valid.',
        });
      }
      const bookingId = rawBookingId;

      const rawBookingCode = req.body.bookingCode;
      if (!isValidBookingHistoryCode(rawBookingCode, 64)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_CODE',
          error: 'Kode pesanan tidak valid.',
          message: 'Kode pesanan tidak valid.',
        });
      }
      const bookingCode = rawBookingCode;

      const rawStatus = req.body.status;
      if (typeof rawStatus !== 'string' || !ALLOWED_BOOKING_STATUSES.has(rawStatus)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_STATUS',
          error: 'Status pesanan tidak valid.',
          message: 'Status pesanan tidak valid.',
        });
      }
      const status = rawStatus;

      const rawNote = req.body.note;
      if (
        rawNote !== undefined &&
        rawNote !== null &&
        (typeof rawNote !== 'string' ||
          rawNote.length > 1000 ||
          Buffer.byteLength(rawNote, 'utf8') > 1000)
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_HISTORY_NOTE',
          error: 'Catatan riwayat status tidak valid atau melebihi batas.',
          message: 'Catatan riwayat status tidak valid atau melebihi batas.',
        });
      }
      const sanitizedNote =
        typeof rawNote === 'string'
          ? rawNote.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
          : '';

      const rawRequestId = req.body.requestId;
      let cleanRequestId = '';
      if (rawRequestId !== undefined && rawRequestId !== null && rawRequestId !== '') {
        if (!isValidBookingHistoryDocId(rawRequestId, 128)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REQUEST_ID',
            error: 'ID permintaan riwayat tidak valid.',
            message: 'ID permintaan riwayat tidak valid.',
          });
        }
        cleanRequestId = rawRequestId;
      }

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: 'Database server sedang tidak tersedia.',
          message: 'Database server sedang tidak tersedia.',
        });
      }

      // Staff/therapist idempotency key derived from verifiedUid + requestId ONLY (independent of bookingId/bookingCode/status/note)
      const staffHistId = cleanRequestId
        ? `hist_${createHash('sha256')
            .update(`staff:${verifiedUid}:${cleanRequestId}`)
            .digest('hex')
            .slice(0, 32)}`
        : `hist_${Date.now()}_${randomInt(100000, 1000000).toString(36)}`;

      // Customer history key derived from verifiedUid + bookingId + status ONLY (independent of caller-supplied requestId)
      const custHistId = `hist_${createHash('sha256')
        .update(`customer:${verifiedUid}:${bookingId}:${status}`)
        .digest('hex')
        .slice(0, 32)}`;

      // 3. Authoritative Read-Only Staff/Customer/Booking Resolution & History Append inside Transaction
      const txResult = await adminDb.runTransaction(async (transaction: any) => {
        const hasUidConflict = (record: any): boolean =>
          [record?.authUserId, record?.authUid].some(
            (value) =>
              value != null &&
              value !== '' &&
              (typeof value !== 'string' ||
                value.trim() !== value ||
                !isValidBookingHistoryDocId(value, 128) ||
                value !== verifiedUid)
          );

        const isStaffDisabled = (record: any): boolean =>
          !record ||
          record.isActive === false ||
          record.loginEnabled === false ||
          [
            'INACTIVE',
            'DISABLED',
            'ARCHIVED',
            'DINONAKTIFKAN',
            'DELETED',
            'TERMINATED',
            'SUSPENDED',
          ].includes(textId(record.status).toUpperCase()) ||
          textId(record.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';

        const roleRef = adminDb.collection('staff_roles').doc(verifiedUid);
        const canonicalStaffQuery = adminDb
          .collection('staff_users')
          .where('authUserId', '==', verifiedUid)
          .limit(2);
        const legacyStaffQuery = adminDb
          .collection('staff_users')
          .where('authUid', '==', verifiedUid)
          .limit(2);
        const directStaffRef = adminDb.collection('staff_users').doc(verifiedUid);
        const targetBookingRef = adminDb.collection('bookings').doc(bookingId);
        const bookingByCodeQuery = adminDb
          .collection('bookings')
          .where('bookingCode', '==', bookingCode)
          .limit(2);
        const custByAuthUserQuery = adminDb
          .collection('customers')
          .where('authUserId', '==', verifiedUid)
          .limit(2);
        const custByCanonicalQuery = adminDb
          .collection('customers')
          .where('customerAuthUid', '==', verifiedUid)
          .limit(2);
        const staffHistRef = adminDb.collection('booking_status_history').doc(staffHistId);
        const custHistRef = adminDb.collection('booking_status_history').doc(custHistId);
        const histByBookingIdQuery = adminDb
          .collection('booking_status_history')
          .where('bookingId', '==', bookingId);
        const histByBookingCodeQuery = adminDb
          .collection('booking_status_history')
          .where('bookingCode', '==', bookingCode);
        const histByRequestIdQuery = cleanRequestId
          ? adminDb
              .collection('booking_status_history')
              .where('requestId', '==', cleanRequestId)
          : null;

        const [
          roleSnap,
          canonicalStaffSnap,
          legacyStaffSnap,
          directStaffSnap,
          targetBookingSnap,
          bookingByCodeSnap,
          custByAuthUserSnap,
          custByCanonicalSnap,
          existingStaffHistSnap,
          existingCustHistSnap,
          histByBookingIdSnap,
          histByBookingCodeSnap,
          histByRequestIdSnap,
        ] = await Promise.all([
          transaction.get(roleRef),
          transaction.get(canonicalStaffQuery),
          transaction.get(legacyStaffQuery),
          transaction.get(directStaffRef),
          transaction.get(targetBookingRef),
          transaction.get(bookingByCodeQuery),
          transaction.get(custByAuthUserQuery),
          transaction.get(custByCanonicalQuery),
          transaction.get(staffHistRef),
          transaction.get(custHistRef),
          transaction.get(histByBookingIdQuery),
          transaction.get(histByBookingCodeQuery),
          histByRequestIdQuery ? transaction.get(histByRequestIdQuery) : Promise.resolve(null),
        ]);

        const staffDocs = new Map<string, any>();
        for (const d of [
          ...(canonicalStaffSnap?.docs || []),
          ...(legacyStaffSnap?.docs || []),
        ]) {
          if (snapExists(d)) staffDocs.set(d.id, d);
        }
        if (snapExists(directStaffSnap)) {
          staffDocs.set(directStaffSnap.id, directStaffSnap);
        }

        const roleExists = snapExists(roleSnap);
        if (roleExists) {
          const roleData = roleSnap.data() || {};
          for (const linked of [roleData.staffId, roleData.staffUserId]) {
            if (
              typeof linked === 'string' &&
              isValidBookingHistoryDocId(linked, 128) &&
              !staffDocs.has(linked)
            ) {
              const linkedSnap = await transaction.get(
                adminDb.collection('staff_users').doc(linked)
              );
              if (snapExists(linkedSnap)) {
                staffDocs.set(linkedSnap.id, linkedSnap);
              }
            }
          }
        }

        let therapistDocSnap: any = null;
        let candidateTherapistId = '';
        if (staffDocs.size === 1 && roleExists) {
          const staffCandidate = [...staffDocs.values()][0].data() || {};
          const roleCandidate = roleSnap.data() || {};
          if (textId(staffCandidate.role) === 'therapist') {
            candidateTherapistId =
              textId(staffCandidate.therapistId) ||
              textId(roleCandidate.therapistId) ||
              textId(staffCandidate.uid) ||
              [...staffDocs.values()][0].id;
            if (isValidBookingHistoryDocId(candidateTherapistId, 128)) {
              therapistDocSnap = await transaction.get(
                adminDb.collection('therapists').doc(candidateTherapistId)
              );
            }
          }
        }

        let targetBookingCustSnap: any = null;
        if (snapExists(targetBookingSnap)) {
          const bData = targetBookingSnap.data() || {};
          const bCustId = textId(bData.customerId);
          if (isValidBookingHistoryDocId(bCustId, 128)) {
            targetBookingCustSnap = await transaction.get(
              adminDb.collection('customers').doc(bCustId)
            );
          }
        }

        const existingHistMap = new Map<string, { id: string; data: any }>();
        for (const d of [
          ...(histByBookingIdSnap?.docs || []),
          ...(histByBookingCodeSnap?.docs || []),
        ]) {
          if (snapExists(d)) {
            existingHistMap.set(d.id, { id: d.id, data: d.data() || {} });
          }
        }

        const hasStaffFootprint = staffDocs.size > 0 || roleExists;

        if (hasStaffFootprint) {
          // Stage 4B/4C/5B/7A: Require unique UID-bound Staff Master AND matching active staff_roles
          if (staffDocs.size === 0 || !roleExists) {
            return {
              status: 403,
              code: 'STAFF_AUTHORIZATION_DENIED',
              message: 'Identitas staf belum terikat atau tidak memiliki otorisasi aktif.',
            };
          }
          if (staffDocs.size > 1) {
            return {
              status: 403,
              code: 'STAFF_DUPLICATE_MAPPING',
              message: 'Identitas staf memiliki duplikasi pemetaan pada Staff Master.',
            };
          }

          const staffSnap = [...staffDocs.values()][0];
          const staff = staffSnap.data() || {};
          const role = roleSnap.data() || {};

          if (hasUidConflict(staff) || hasUidConflict(role)) {
            return {
              status: 403,
              code: 'STAFF_UID_MISMATCH',
              message: 'Identitas UID staf tidak sesuai dengan sesi autentikasi.',
            };
          }

          const isUidBound =
            staffSnap.id === verifiedUid ||
            (typeof staff.authUserId === 'string' && staff.authUserId === verifiedUid) ||
            (typeof staff.authUid === 'string' && staff.authUid === verifiedUid);
          if (!isUidBound) {
            return {
              status: 403,
              code: 'STAFF_UID_UNBOUND',
              message: 'Profil Staff Master tidak terikat pada UID sesi saat ini.',
            };
          }

          if (
            isStaffDisabled(staff) ||
            isStaffDisabled(role) ||
            role.isActive !== true
          ) {
            return {
              status: 403,
              code: 'STAFF_INACTIVE',
              message: 'Akun staf sedang tidak aktif atau telah dinonaktifkan.',
            };
          }

          const staffRole = textId(staff.role);
          const activeRole = textId(role.role);
          if (
            !staffRole ||
            staff.role !== staffRole ||
            role.role !== activeRole ||
            activeRole !== staffRole
          ) {
            return {
              status: 403,
              code: 'STAFF_ROLE_MISMATCH',
              message: 'Role staf tidak sesuai dengan Staff Master saat ini.',
            };
          }

          for (const aliasField of [staff.uid, staff.id]) {
            if (aliasField !== undefined && aliasField !== null && aliasField !== '') {
              if (
                typeof aliasField !== 'string' ||
                !isValidBookingHistoryDocId(aliasField, 128)
              ) {
                return {
                  status: 403,
                  code: 'STAFF_ROLE_MAPPING_CONFLICT',
                  message: 'Alias identitas Staff Master tidak valid.',
                };
              }
            }
          }

          if (
            typeof staff.uid === 'string' &&
            staff.uid !== '' &&
            typeof staff.id === 'string' &&
            staff.id !== '' &&
            staff.uid !== staff.id &&
            ![verifiedUid, staffSnap.id].includes(staff.uid) &&
            ![verifiedUid, staffSnap.id].includes(staff.id)
          ) {
            return {
              status: 403,
              code: 'STAFF_ROLE_MAPPING_CONFLICT',
              message: 'Konflik alias uid/id pada Staff Master.',
            };
          }

          const aliases = new Set(
            [verifiedUid, staffSnap.id, textId(staff.uid), textId(staff.id)].filter(Boolean)
          );
          for (const linkedId of [role.staffId, role.staffUserId]) {
            if (linkedId !== undefined && linkedId !== null && linkedId !== '') {
              if (
                typeof linkedId !== 'string' ||
                !isValidBookingHistoryDocId(linkedId, 128) ||
                !aliases.has(linkedId)
              ) {
                return {
                  status: 403,
                  code: 'STAFF_ROLE_MAPPING_CONFLICT',
                  message: 'Referensi Staff Master pada staff_roles tidak sesuai.',
                };
              }
            }
          }

          if (!['css', 'supervisor', 'manager', 'admin', 'therapist'].includes(staffRole)) {
            return {
              status: 403,
              code: 'PERMISSION_DENIED',
              message: 'Peran staf tidak memiliki wewenang mencatat riwayat status pesanan.',
            };
          }

          let resolvedTherapistId = '';
          let trustedTherapistIds = new Set<string>();
          if (staffRole === 'therapist') {
            const masterTherapistId = textId(staff.therapistId);
            const roleTherapistId = textId(role.therapistId);
            for (const rawThId of [staff.therapistId, role.therapistId]) {
              if (rawThId !== undefined && rawThId !== null && rawThId !== '') {
                if (
                  typeof rawThId !== 'string' ||
                  !isValidBookingHistoryDocId(rawThId, 128)
                ) {
                  return {
                    status: 403,
                    code: 'STAFF_ROLE_MAPPING_CONFLICT',
                    message: 'ID terapis pada Staff Master atau staff_roles tidak valid.',
                  };
                }
              }
            }
            resolvedTherapistId =
              masterTherapistId || roleTherapistId || textId(staff.uid) || staffSnap.id;
            if (!isValidBookingHistoryDocId(resolvedTherapistId, 128)) {
              return {
                status: 403,
                code: 'PERMISSION_DENIED',
                message: 'Identitas terapis tidak valid.',
              };
            }
            const therapistData = snapExists(therapistDocSnap)
              ? therapistDocSnap.data() || {}
              : null;
            if (therapistData) {
              if (isStaffDisabled(therapistData)) {
                return {
                  status: 403,
                  code: 'STAFF_INACTIVE',
                  message: 'Akun terapis sedang tidak aktif.',
                };
              }
              if (
                hasUidConflict(therapistData) ||
                (therapistData.staffId != null &&
                  therapistData.staffId !== '' &&
                  (typeof therapistData.staffId !== 'string' ||
                    !aliases.has(textId(therapistData.staffId)))) ||
                (therapistData.id != null &&
                  therapistData.id !== '' &&
                  (typeof therapistData.id !== 'string' ||
                    textId(therapistData.id) !== resolvedTherapistId))
              ) {
                return {
                  status: 403,
                  code: 'STAFF_ROLE_MAPPING_CONFLICT',
                  message: 'Profil terapis mengalami konflik identitas.',
                };
              }
            }
            if (
              !masterTherapistId &&
              !aliases.has(resolvedTherapistId) &&
              !(
                therapistData &&
                (textId(therapistData.authUserId) === verifiedUid ||
                  textId(therapistData.authUid) === verifiedUid ||
                  aliases.has(textId(therapistData.staffId)))
              )
            ) {
              return {
                status: 403,
                code: 'PERMISSION_DENIED',
                message: 'Ikatan profil terapis tidak dapat diverifikasi.',
              };
            }
            trustedTherapistIds = new Set([...aliases, resolvedTherapistId]);
            if (roleTherapistId && !trustedTherapistIds.has(roleTherapistId)) {
              return {
                status: 403,
                code: 'STAFF_ROLE_MAPPING_CONFLICT',
                message: 'ID terapis pada staff_roles tidak sesuai dengan Staff Master.',
              };
            }
          }

          const actorRole = staffRole;
          const actorName =
            sanitizeText(staff.name, 120) ||
            sanitizeText(staff.displayName, 120) ||
            sanitizeText(staff.fullName, 120) ||
            sanitizeText(role.name, 120) ||
            (staffRole === 'therapist' ? 'Terapis Senzu' : 'Staff Senzu');
          const finalNote =
            sanitizedNote ||
            `Status pesanan diperbarui menjadi ${status} oleh ${actorName}`;
          const requestFingerprint = computeBookingHistoryFingerprint({
            actorScope: 'staff',
            actorUid: verifiedUid,
            bookingId,
            bookingCode,
            status,
            note: finalNote,
          });

          // Staff Idempotency Check (keyed by verifiedUid + requestId, independent of bookingId/bookingCode/status/note)
          if (cleanRequestId && snapExists(existingStaffHistSnap)) {
            const existingEntry = existingStaffHistSnap.data();
            const isValidStoredStaffEntry =
              Boolean(
                existingEntry &&
                  typeof existingEntry === 'object' &&
                  !Array.isArray(existingEntry)
              ) &&
              existingEntry.id === staffHistId &&
              existingEntry.requestId === cleanRequestId &&
              existingEntry.actorUid === verifiedUid &&
              existingEntry.actorId === verifiedUid &&
              existingEntry.actorRole === actorRole &&
              existingEntry.updatedByRole === actorRole &&
              typeof existingEntry.actorName === 'string' &&
              existingEntry.actorName.trim().length > 0 &&
              typeof existingEntry.updatedByName === 'string' &&
              existingEntry.updatedByName.trim().length > 0 &&
              typeof existingEntry.bookingId === 'string' &&
              isValidBookingHistoryDocId(existingEntry.bookingId, 128) &&
              typeof existingEntry.bookingCode === 'string' &&
              isValidBookingHistoryCode(existingEntry.bookingCode, 64) &&
              typeof existingEntry.status === 'string' &&
              ALLOWED_BOOKING_STATUSES.has(existingEntry.status) &&
              typeof existingEntry.note === 'string' &&
              existingEntry.note.trim().length > 0 &&
              existingEntry.note.trim() === existingEntry.note &&
              Buffer.byteLength(existingEntry.note, 'utf8') <= 1000 &&
              typeof existingEntry.timestamp === 'string' &&
              !Number.isNaN(Date.parse(existingEntry.timestamp)) &&
              typeof existingEntry.formattedWIB === 'string' &&
              existingEntry.formattedWIB.trim().length > 0 &&
              typeof existingEntry.requestFingerprint === 'string' &&
              /^[a-f0-9]{64}$/.test(existingEntry.requestFingerprint) &&
              existingEntry.requestFingerprint ===
                computeBookingHistoryFingerprint({
                  actorScope: 'staff',
                  actorUid: existingEntry.actorUid,
                  bookingId: existingEntry.bookingId,
                  bookingCode: existingEntry.bookingCode,
                  status: existingEntry.status,
                  note: existingEntry.note,
                });

            if (!isValidStoredStaffEntry) {
              return {
                status: 409,
                code: 'HISTORY_REPLAY_INVALID',
                message: 'Data riwayat status sebelumnya tidak valid atau mengalami konflik kepemilikan.',
              };
            }

            if (
              existingEntry.requestFingerprint !== requestFingerprint ||
              existingEntry.bookingId !== bookingId ||
              existingEntry.bookingCode !== bookingCode ||
              existingEntry.status !== status ||
              existingEntry.note !== finalNote
            ) {
              return {
                status: 409,
                code: 'HISTORY_IDEMPOTENCY_MISMATCH',
                message:
                  'ID permintaan (requestId) telah digunakan dengan parameter riwayat status yang berbeda.',
              };
            }

            if (!snapExists(targetBookingSnap)) {
              return {
                status: 409,
                code: 'HISTORY_REPLAY_INVALID',
                message: 'Target pesanan pada entri riwayat status sudah tidak ditemukan.',
              };
            }
            const replayBookingData = targetBookingSnap.data() || {};
            if (
              (replayBookingData.id !== undefined &&
                replayBookingData.id !== null &&
                replayBookingData.id !== '' &&
                (typeof replayBookingData.id !== 'string' ||
                  replayBookingData.id !== bookingId)) ||
              textId(replayBookingData.bookingCode) !== bookingCode
            ) {
              return {
                status: 409,
                code: 'HISTORY_REPLAY_INVALID',
                message: 'Identitas dokumen pesanan pada entri riwayat mengalami konflik.',
              };
            }
            if (staffRole === 'therapist') {
              const assignedIds = [
                textId(replayBookingData.therapistId),
                textId(replayBookingData.assignedTherapistId),
              ].filter(Boolean);
              if (
                !assignedIds.length ||
                assignedIds.some((id) => !trustedTherapistIds.has(id))
              ) {
                return {
                  status: 409,
                  code: 'HISTORY_REPLAY_INVALID',
                  message: 'Penugasan terapis pada pesanan sudah tidak sesuai.',
                };
              }
            }

            return {
              status: 200,
              isIdempotent: true,
              entry: existingEntry,
            };
          }

          for (const d of bookingByCodeSnap?.docs || []) {
            if (snapExists(d) && d.id !== bookingId) {
              return {
                status: 409,
                code: 'BOOKING_CODE_CONFLICT',
                message: 'Kode pesanan merujuk pada dokumen pesanan lain.',
              };
            }
          }

          if (!snapExists(targetBookingSnap)) {
            return {
              status: 404,
              code: 'BOOKING_NOT_FOUND',
              message: 'Data pesanan tidak ditemukan.',
            };
          }

          const bookingData = targetBookingSnap.data() || {};
          if (
            bookingData.id !== undefined &&
            bookingData.id !== null &&
            bookingData.id !== '' &&
            (typeof bookingData.id !== 'string' || bookingData.id !== bookingId)
          ) {
            return {
              status: 409,
              code: 'BOOKING_RECORD_CONFLICT',
              message: 'Identitas dokumen pesanan tidak konsisten.',
            };
          }

          if (textId(bookingData.bookingCode) !== bookingCode) {
            return {
              status: 409,
              code: 'BOOKING_CODE_MISMATCH',
              message: 'Kode pesanan tidak sesuai dengan dokumen pesanan.',
            };
          }

          const persistedStatus = textId(bookingData.status);

          if (staffRole === 'therapist') {
            for (const rawAssign of [
              bookingData.therapistId,
              bookingData.assignedTherapistId,
            ]) {
              if (rawAssign !== undefined && rawAssign !== null && rawAssign !== '') {
                if (
                  typeof rawAssign !== 'string' ||
                  !isValidBookingHistoryDocId(rawAssign, 128)
                ) {
                  return {
                    status: 403,
                    code: 'PERMISSION_DENIED',
                    message: 'Atribut penugasan terapis pada pesanan tidak valid.',
                  };
                }
              }
            }
            const assignedIds = [
              textId(bookingData.therapistId),
              textId(bookingData.assignedTherapistId),
            ].filter(Boolean);
            if (
              !assignedIds.length ||
              assignedIds.some((id) => !trustedTherapistIds.has(id))
            ) {
              return {
                status: 403,
                code: 'PERMISSION_DENIED',
                message:
                  'Hanya terapis aktif yang ditugaskan pada pesanan ini yang berwenang mencatat riwayat status.',
              };
            }

            const isIssueOnAssigned =
              status === 'Therapist Assigned' &&
              persistedStatus === 'Therapist Assigned' &&
              Boolean(
                bookingData.issueReport &&
                  typeof bookingData.issueReport === 'object' &&
                  !Array.isArray(bookingData.issueReport)
              );

            if (!THERAPIST_ALLOWED_STATUSES.has(status) && !isIssueOnAssigned) {
              return {
                status: 403,
                code: 'PERMISSION_DENIED',
                message: 'Terapis tidak berwenang mencatat status pesanan ini.',
              };
            }
          }

          if (persistedStatus !== status) {
            return {
              status: 409,
              code: 'STATUS_STATE_MISMATCH',
              message: `Status riwayat (${status}) tidak sesuai dengan status pesanan saat ini (${persistedStatus || '-'}).`,
            };
          }

          // Check existing history entries for cross-booking conflicts and consecutive duplicate status
          const existingEntries: Array<{ id: string; data: any }> = [];
          for (const item of existingHistMap.values()) {
            const h = item.data;
            if (!h || typeof h !== 'object' || Array.isArray(h)) continue;
            if (
              (h.bookingId !== undefined && h.bookingId !== bookingId) ||
              (h.bookingCode !== undefined && h.bookingCode !== bookingCode)
            ) {
              return {
                status: 409,
                code: 'BOOKING_HISTORY_CONFLICT',
                message: 'Riwayat status pesanan mengalami konflik referensi dokumen.',
              };
            }
            existingEntries.push(item);
          }

          existingEntries.sort((a, b) => {
            const diff =
              new Date(a.data.timestamp || 0).getTime() -
              new Date(b.data.timestamp || 0).getTime();
            return diff !== 0 ? diff : a.id.localeCompare(b.id);
          });

          const lastItem = existingEntries[existingEntries.length - 1];
          if (lastItem && lastItem.data.status === status) {
            const lastData = lastItem.data;
            const lastId = isValidBookingHistoryDocId(lastData.id, 128)
              ? lastData.id
              : lastItem.id;
            const isValidLast =
              isValidBookingHistoryDocId(lastId, 128) &&
              lastData.bookingId === bookingId &&
              lastData.bookingCode === bookingCode &&
              lastData.status === status &&
              typeof lastData.updatedByRole === 'string' &&
              typeof lastData.updatedByName === 'string' &&
              lastData.updatedByName.trim().length > 0 &&
              typeof lastData.timestamp === 'string' &&
              !Number.isNaN(Date.parse(lastData.timestamp));

            if (!isValidLast) {
              return {
                status: 409,
                code: 'HISTORY_REPLAY_INVALID',
                message: 'Entri status terakhir pada riwayat pesanan tidak valid.',
              };
            }

            return {
              status: 200,
              isIdempotent: true,
              isDuplicateStatus: true,
              entry: {
                ...lastData,
                id: lastId,
                formattedWIB:
                  typeof lastData.formattedWIB === 'string' &&
                  lastData.formattedWIB.trim().length > 0
                    ? lastData.formattedWIB
                    : formatBookingHistoryWIB(lastData.timestamp),
              },
            };
          }

          if (snapExists(existingStaffHistSnap)) {
            return {
              status: 409,
              code: 'HISTORY_ID_CONFLICT',
              message: 'Entri riwayat status sudah ada. Silakan coba kembali.',
            };
          }

          const nowIso = new Date().toISOString();
          const entry: Record<string, any> = {
            id: staffHistId,
            source: 'client_report',
            bookingId,
            bookingCode,
            status,
            note: finalNote,
            updatedByRole: actorRole,
            updatedByName: actorName,
            actorUid: verifiedUid,
            actorId: verifiedUid,
            actorRole,
            actorName,
            ...(resolvedTherapistId ? { therapistId: resolvedTherapistId } : {}),
            timestamp: nowIso,
            formattedWIB: formatBookingHistoryWIB(nowIso),
            requestFingerprint,
            ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
          };

          transaction.create(staffHistRef, entry);
          return {
            status: 200,
            isIdempotent: false,
            entry,
          };
        } else {
          // Non-operational caller (Customer): ONLY own UID-bound booking & allowed customer statuses
          if (!CUSTOMER_ALLOWED_STATUSES.has(status)) {
            return {
              status: 403,
              code: 'PERMISSION_DENIED',
              message: 'Pelanggan tidak memiliki wewenang untuk mencatat status pesanan ini.',
            };
          }

          for (const d of bookingByCodeSnap?.docs || []) {
            if (snapExists(d) && d.id !== bookingId) {
              return {
                status: 409,
                code: 'BOOKING_CODE_CONFLICT',
                message: 'Kode pesanan merujuk pada dokumen pesanan lain.',
              };
            }
          }

          if (!snapExists(targetBookingSnap)) {
            return {
              status: 403,
              code: 'BOOKING_OWNERSHIP_UNVERIFIED',
              message: 'Pesanan tidak ditemukan atau akses ditolak.',
            };
          }

          const bookingData = targetBookingSnap.data() || {};
          if (
            bookingData.id !== undefined &&
            bookingData.id !== null &&
            bookingData.id !== '' &&
            (typeof bookingData.id !== 'string' || bookingData.id !== bookingId)
          ) {
            return {
              status: 403,
              code: 'BOOKING_OWNERSHIP_MALFORMED',
              message: 'Identitas dokumen pesanan tidak valid.',
            };
          }

          if (textId(bookingData.bookingCode) !== bookingCode) {
            return {
              status: 403,
              code: 'BOOKING_CODE_MISMATCH',
              message: 'Kode pesanan tidak sesuai dengan dokumen pesanan.',
            };
          }

          for (const rawUidVal of [bookingData.customerAuthUid, bookingData.authUserId]) {
            if (rawUidVal !== undefined && rawUidVal !== null && rawUidVal !== '') {
              if (
                typeof rawUidVal !== 'string' ||
                rawUidVal.trim() !== rawUidVal ||
                !isValidBookingHistoryDocId(rawUidVal, 128)
              ) {
                return {
                  status: 403,
                  code: 'BOOKING_OWNERSHIP_MALFORMED',
                  message: 'Atribut kepemilikan pesanan tidak valid.',
                };
              }
            }
          }

          const bookingCustomerAuthUid = textId(bookingData.customerAuthUid);
          const bookingAuthUserId = textId(bookingData.authUserId);

          if (!bookingCustomerAuthUid && !bookingAuthUserId) {
            return {
              status: 403,
              code: 'BOOKING_OWNERSHIP_MISSING',
              message: 'Pesanan tidak memiliki ikatan UID pelanggan terotentikasi.',
            };
          }

          if (
            bookingCustomerAuthUid &&
            bookingAuthUserId &&
            bookingCustomerAuthUid !== bookingAuthUserId
          ) {
            return {
              status: 403,
              code: 'BOOKING_OWNERSHIP_CONFLICT',
              message: 'Kepemilikan UID pesanan mengalami konflik.',
            };
          }

          if (
            (bookingCustomerAuthUid && bookingCustomerAuthUid !== verifiedUid) ||
            (bookingAuthUserId && bookingAuthUserId !== verifiedUid)
          ) {
            return {
              status: 403,
              code: 'FOREIGN_BOOKING',
              message: 'Akses ke pesanan pelanggan lain ditolak.',
            };
          }

          const rawBookingCustId = bookingData.customerId;
          let bookingCustomerId = '';
          if (rawBookingCustId !== undefined && rawBookingCustId !== null && rawBookingCustId !== '') {
            if (
              typeof rawBookingCustId !== 'string' ||
              rawBookingCustId.trim() !== rawBookingCustId ||
              !isValidBookingHistoryDocId(rawBookingCustId, 128)
            ) {
              return {
                status: 403,
                code: 'BOOKING_OWNERSHIP_MALFORMED',
                message: 'ID pelanggan pada pesanan tidak valid.',
              };
            }
            bookingCustomerId = rawBookingCustId;
            if (
              bookingCustomerId.startsWith('cust_u_') &&
              bookingCustomerId !== `cust_u_${verifiedUid}` &&
              bookingCustomerId !== `cust_u_${verifiedUid.slice(0, 10)}`
            ) {
              return {
                status: 403,
                code: 'FOREIGN_CUSTOMER_PROFILE',
                message: 'ID profil pelanggan pada pesanan tidak sesuai dengan sesi.',
              };
            }
          }

          const ownedProfiles = new Map<string, any>();
          for (const d of [
            ...(custByAuthUserSnap?.docs || []),
            ...(custByCanonicalSnap?.docs || []),
          ]) {
            if (snapExists(d)) ownedProfiles.set(d.id, d);
          }

          if (ownedProfiles.size > 1) {
            return {
              status: 403,
              code: 'CUSTOMER_OWNERSHIP_CONFLICT',
              message: 'Kepemilikan profil pelanggan tidak unik atau mengalami konflik.',
            };
          }

          const profilesToValidate = new Map<string, any>(ownedProfiles);
          if (snapExists(targetBookingCustSnap)) {
            profilesToValidate.set(targetBookingCustSnap.id, targetBookingCustSnap);
          }

          if (
            ownedProfiles.size === 1 &&
            bookingCustomerId &&
            snapExists(targetBookingCustSnap) &&
            !ownedProfiles.has(bookingCustomerId)
          ) {
            const targetCustData = targetBookingCustSnap.data() || {};
            if (
              targetCustData.authUserId != null ||
              targetCustData.customerAuthUid != null ||
              bookingCustomerId.startsWith('cust_u_')
            ) {
              return {
                status: 403,
                code: 'CUSTOMER_OWNERSHIP_CONFLICT',
                message: 'Profil pelanggan pada pesanan tidak sesuai dengan profil akun aktif.',
              };
            }
          }

          for (const [profId, profSnap] of profilesToValidate.entries()) {
            const profile = profSnap.data() || {};
            if (
              profile.id !== undefined &&
              profile.id !== null &&
              profile.id !== '' &&
              (typeof profile.id !== 'string' || profile.id !== profId)
            ) {
              return {
                status: 403,
                code: 'CUSTOMER_OWNERSHIP_MALFORMED',
                message: 'Identitas profil pelanggan tidak sesuai.',
              };
            }
            for (const rawProfUid of [profile.authUserId, profile.customerAuthUid]) {
              if (rawProfUid !== undefined && rawProfUid !== null && rawProfUid !== '') {
                if (
                  typeof rawProfUid !== 'string' ||
                  rawProfUid.trim() !== rawProfUid ||
                  !isValidBookingHistoryDocId(rawProfUid, 128) ||
                  rawProfUid !== verifiedUid
                ) {
                  return {
                    status: 403,
                    code: 'CUSTOMER_OWNERSHIP_CONFLICT',
                    message: 'Atribut kepemilikan profil pelanggan mengalami konflik.',
                  };
                }
              }
            }
            const acctType = textId(profile.accountType).toUpperCase();
            const acctStatus = textId(profile.accountStatus).toUpperCase();
            const profStatus = textId(profile.status).toUpperCase();
            const crmStatus = textId(profile.crmStatus).toLowerCase();
            const custStatus = textId(profile.customerStatus).toLowerCase();

            if (
              (acctType && acctType !== 'CUSTOMER') ||
              acctStatus === 'DISABLED' ||
              acctStatus === 'NOT_REGISTERED' ||
              acctStatus === 'INACTIVE' ||
              [
                'DISABLED',
                'INACTIVE',
                'ARCHIVED',
                'BLOCKED',
                'DELETED',
                'DELETION_REQUESTED',
              ].includes(profStatus) ||
              ['archived', 'blocked'].includes(crmStatus) ||
              ['archived', 'blocked'].includes(custStatus)
            ) {
              return {
                status: 403,
                code: 'CUSTOMER_PROFILE_INACTIVE',
                message: 'Profil pelanggan sedang tidak aktif atau tidak memenuhi syarat.',
              };
            }
          }

          // Check existing history entries for cross-booking conflicts first
          const existingEntries: Array<{ id: string; data: any }> = [];
          for (const item of existingHistMap.values()) {
            const hist = item.data;
            if (!hist || typeof hist !== 'object' || Array.isArray(hist)) continue;
            if (
              (hist.bookingId !== undefined && hist.bookingId !== bookingId) ||
              (hist.bookingCode !== undefined && hist.bookingCode !== bookingCode)
            ) {
              return {
                status: 409,
                code: 'BOOKING_HISTORY_CONFLICT',
                message: 'Riwayat status pesanan mengalami konflik referensi dokumen.',
              };
            }
            existingEntries.push(item);
          }

          // Validate stored customer entry integrity, linkage, ownership, and self-fingerprint
          const validateStoredCustomerReceipt = (
            entryObj: any,
            expectedDocId?: string
          ): boolean =>
            Boolean(entryObj && typeof entryObj === 'object' && !Array.isArray(entryObj)) &&
            (expectedDocId
              ? entryObj.id === expectedDocId
              : isValidBookingHistoryDocId(entryObj.id, 128)) &&
            typeof entryObj.bookingId === 'string' &&
            isValidBookingHistoryDocId(entryObj.bookingId, 128) &&
            typeof entryObj.bookingCode === 'string' &&
            isValidBookingHistoryCode(entryObj.bookingCode, 64) &&
            typeof entryObj.status === 'string' &&
            CUSTOMER_ALLOWED_STATUSES.has(entryObj.status) &&
            entryObj.updatedByRole === 'customer' &&
            entryObj.actorRole === 'customer' &&
            entryObj.actorUid === verifiedUid &&
            entryObj.actorId === verifiedUid &&
            typeof entryObj.updatedByName === 'string' &&
            entryObj.updatedByName.trim().length > 0 &&
            typeof entryObj.actorName === 'string' &&
            entryObj.actorName.trim().length > 0 &&
            typeof entryObj.note === 'string' &&
            entryObj.note.trim().length > 0 &&
            entryObj.note.trim() === entryObj.note &&
            Buffer.byteLength(entryObj.note, 'utf8') <= 1000 &&
            typeof entryObj.timestamp === 'string' &&
            !Number.isNaN(Date.parse(entryObj.timestamp)) &&
            typeof entryObj.formattedWIB === 'string' &&
            entryObj.formattedWIB.trim().length > 0 &&
            typeof entryObj.requestFingerprint === 'string' &&
            /^[a-f0-9]{64}$/.test(entryObj.requestFingerprint) &&
            entryObj.requestFingerprint ===
              computeBookingHistoryFingerprint({
                actorScope: 'customer',
                actorUid: entryObj.actorUid,
                bookingId: entryObj.bookingId,
                bookingCode: entryObj.bookingCode,
                status: entryObj.status,
                note: entryObj.note,
              }) &&
            (entryObj.requestId === undefined ||
              isValidBookingHistoryDocId(entryObj.requestId, 128));

          // Check whether caller-supplied note matches committed entry without regenerating from mutable booking labels
          const isCustomerReplayNoteCompatible = (storedEntry: any): boolean => {
            const storedNote = typeof storedEntry?.note === 'string' ? storedEntry.note : '';
            if (storedEntry?.status === 'Menunggu Pembayaran') {
              if (!sanitizedNote) return true;
              return sanitizedNote === storedNote;
            }
            if (storedEntry?.status === 'Cancelled') {
              if (sanitizedNote) {
                const normalizedCancelNote = sanitizedNote.startsWith('Dibatalkan')
                  ? sanitizedNote
                  : `Dibatalkan oleh Pelanggan: ${sanitizedNote}`;
                return sanitizedNote === storedNote || normalizedCancelNote === storedNote;
              }
              return (
                storedNote === 'Dibatalkan oleh pelanggan' ||
                storedNote === 'Dibatalkan oleh Pelanggan'
              );
            }
            return !sanitizedNote || sanitizedNote === storedNote;
          };

          // CORRECTION 2: Validate committed customer replays BEFORE applying current-status checks for new entries
          // 1a) Check any committed customer receipt matching cleanRequestId (across bookings or statuses)
          if (cleanRequestId) {
            const reqMatches = new Map<string, any>();
            for (const d of histByRequestIdSnap?.docs || []) {
              if (snapExists(d)) {
                const dData = d.data() || {};
                if (
                  dData.requestId === cleanRequestId &&
                  (dData.actorUid === verifiedUid ||
                    dData.actorId === verifiedUid ||
                    dData.updatedByRole === 'customer' ||
                    dData.actorRole === 'customer')
                ) {
                  reqMatches.set(d.id, { id: d.id, data: dData });
                }
              }
            }
            for (const item of existingEntries) {
              const h = item.data;
              if (
                h.requestId === cleanRequestId &&
                (h.actorUid === verifiedUid ||
                  h.actorId === verifiedUid ||
                  h.updatedByRole === 'customer' ||
                  h.actorRole === 'customer')
              ) {
                reqMatches.set(item.id, item);
              }
            }

            for (const matchedItem of reqMatches.values()) {
              const matchedEntry = matchedItem.data;
              if (!validateStoredCustomerReceipt(matchedEntry, matchedItem.id)) {
                return {
                  status: 409,
                  code: 'HISTORY_REPLAY_INVALID',
                  message:
                    'Entri riwayat status pesanan pelanggan mengalami konflik kepemilikan atau integritas.',
                };
              }
              if (
                matchedEntry.bookingId !== bookingId ||
                matchedEntry.bookingCode !== bookingCode ||
                matchedEntry.status !== status ||
                !isCustomerReplayNoteCompatible(matchedEntry)
              ) {
                return {
                  status: 409,
                  code: 'HISTORY_IDEMPOTENCY_MISMATCH',
                  message:
                    'ID permintaan (requestId) telah digunakan dengan parameter riwayat status pelanggan yang berbeda.',
                };
              }
              return {
                status: 200,
                isIdempotent: true,
                entry: matchedEntry,
              };
            }
          }

          // 1b) Check deterministic customer status history document (logical deduplication across requestIds)
          if (snapExists(existingCustHistSnap)) {
            const existingEntry = existingCustHistSnap.data();
            if (!validateStoredCustomerReceipt(existingEntry, custHistId)) {
              return {
                status: 409,
                code: 'HISTORY_REPLAY_INVALID',
                message:
                  'Entri riwayat status pesanan pelanggan mengalami konflik kepemilikan atau integritas.',
              };
            }

            if (
              existingEntry.bookingId !== bookingId ||
              existingEntry.bookingCode !== bookingCode ||
              existingEntry.status !== status ||
              !isCustomerReplayNoteCompatible(existingEntry)
            ) {
              return {
                status: 409,
                code: 'HISTORY_IDEMPOTENCY_MISMATCH',
                message:
                  'Parameter status atau catatan riwayat pelanggan tidak sesuai dengan entri yang telah tercatat.',
              };
            }

            return {
              status: 200,
              isIdempotent: true,
              entry: existingEntry,
            };
          }

          // 1c) Check existing history documents for this booking (preserve legacy records & logical deduplication)
          for (const item of existingEntries) {
            const hist = item.data;
            if (hist.status !== status) continue;
            const isCustomerRecord =
              hist.updatedByRole === 'customer' ||
              hist.actorRole === 'customer' ||
              hist.actorUid !== undefined ||
              hist.actorId !== undefined;

            if (!isCustomerRecord) continue;

            const histValid =
              (hist.id === undefined || hist.id === item.id) &&
              hist.bookingId === bookingId &&
              hist.bookingCode === bookingCode &&
              hist.status === status &&
              hist.updatedByRole === 'customer' &&
              (hist.actorRole === undefined || hist.actorRole === 'customer') &&
              hist.actorUid === verifiedUid &&
              hist.actorId === verifiedUid &&
              typeof hist.updatedByName === 'string' &&
              hist.updatedByName.trim().length > 0 &&
              typeof hist.note === 'string' &&
              hist.note.trim().length > 0 &&
              hist.note.trim() === hist.note &&
              Buffer.byteLength(hist.note, 'utf8') <= 1000 &&
              typeof hist.timestamp === 'string' &&
              !Number.isNaN(Date.parse(hist.timestamp)) &&
              typeof hist.requestFingerprint === 'string' &&
              /^[a-f0-9]{64}$/.test(hist.requestFingerprint) &&
              hist.requestFingerprint ===
                computeBookingHistoryFingerprint({
                  actorScope: 'customer',
                  actorUid: verifiedUid,
                  bookingId,
                  bookingCode,
                  status,
                  note: hist.note,
                }) &&
              (hist.requestId === undefined ||
                isValidBookingHistoryDocId(hist.requestId, 128));

            if (!histValid) {
              return {
                status: 409,
                code: 'HISTORY_REPLAY_INVALID',
                message:
                  'Riwayat status pesanan pelanggan mengalami konflik kepemilikan atau integritas.',
              };
            }

            if (!isCustomerReplayNoteCompatible(hist)) {
              return {
                status: 409,
                code: 'HISTORY_IDEMPOTENCY_MISMATCH',
                message:
                  'Parameter status atau catatan riwayat pelanggan tidak sesuai dengan entri yang telah tercatat.',
              };
            }

            return {
              status: 200,
              isIdempotent: true,
              entry: {
                ...hist,
                id: hist.id || item.id,
                formattedWIB:
                  typeof hist.formattedWIB === 'string' && hist.formattedWIB.trim().length > 0
                    ? hist.formattedWIB
                    : formatBookingHistoryWIB(hist.timestamp),
              },
            };
          }

          // 2) Current-status & provenance checks for NEW customer history entries
          const persistedStatus = textId(bookingData.status);
          if (persistedStatus !== status) {
            return {
              status: 409,
              code: 'STATUS_STATE_MISMATCH',
              message: `Status riwayat (${status}) tidak sesuai dengan status pesanan saat ini (${persistedStatus || '-'}).`,
            };
          }

          const pStatus = textId(bookingData.paymentStatus).toUpperCase();
          if (status === 'Cancelled') {
            // CORRECTION 3: Missing cancelledByRole, caller notes, and unprotected client-set markers do NOT prove customer cancellation.
            // Reject NEW customer-attributed cancellation entries for paid bookings or when permitted pending/unpaid customer-cancellation provenance cannot be established.
            if (pStatus === 'PAID' || pStatus === 'TERVERIFIKASI') {
              return {
                status: 403,
                code: 'PERMISSION_DENIED',
                message:
                  'Pembatalan pada pesanan yang telah dibayar tidak dapat diklaim sebagai pembatalan pelanggan.',
              };
            }
            return {
              status: 403,
              code: 'PERMISSION_DENIED',
              message:
                'Provenans pembatalan pesanan oleh pelanggan tidak dapat diverifikasi secara otoritatif.',
            };
          }

          if (status === 'Menunggu Pembayaran') {
            if (pStatus === 'PAID' || pStatus === 'TERVERIFIKASI') {
              return {
                status: 409,
                code: 'STATUS_STATE_MISMATCH',
                message: 'Pesanan sudah berstatus lunas.',
              };
            }
          }

          existingEntries.sort((a, b) => {
            const diff =
              new Date(a.data.timestamp || 0).getTime() -
              new Date(b.data.timestamp || 0).getTime();
            return diff !== 0 ? diff : a.id.localeCompare(b.id);
          });
          const lastItem = existingEntries[existingEntries.length - 1];
          if (lastItem && lastItem.data.status === status) {
            const lastData = lastItem.data;
            const lastId = isValidBookingHistoryDocId(lastData.id, 128)
              ? lastData.id
              : lastItem.id;
            const isValidLast =
              isValidBookingHistoryDocId(lastId, 128) &&
              lastData.bookingId === bookingId &&
              lastData.bookingCode === bookingCode &&
              lastData.status === status &&
              typeof lastData.updatedByRole === 'string' &&
              typeof lastData.updatedByName === 'string' &&
              lastData.updatedByName.trim().length > 0 &&
              typeof lastData.timestamp === 'string' &&
              !Number.isNaN(Date.parse(lastData.timestamp));

            if (!isValidLast) {
              return {
                status: 409,
                code: 'HISTORY_REPLAY_INVALID',
                message: 'Entri status terakhir pada riwayat pesanan tidak valid.',
              };
            }

            return {
              status: 200,
              isIdempotent: true,
              isDuplicateStatus: true,
              entry: {
                ...lastData,
                id: lastId,
                formattedWIB:
                  typeof lastData.formattedWIB === 'string' &&
                  lastData.formattedWIB.trim().length > 0
                    ? lastData.formattedWIB
                    : formatBookingHistoryWIB(lastData.timestamp),
              },
            };
          }

          const actorRole = 'customer';
          const actorName =
            sanitizeText(bookingData.customerName, 120) || 'Pelanggan Senzu';
          const paymentMethodLabel =
            sanitizeText(bookingData.paymentMethod, 60) || 'Transfer';
          const finalNote =
            sanitizedNote ||
            `Booking diajukan oleh customer melalui portal Senzu Home. Metode bayar: ${paymentMethodLabel}`;

          const requestFingerprint = computeBookingHistoryFingerprint({
            actorScope: 'customer',
            actorUid: verifiedUid,
            bookingId,
            bookingCode,
            status,
            note: finalNote,
          });

          const nowIso = new Date().toISOString();
          const entry: Record<string, any> = {
            id: custHistId,
            bookingId,
            bookingCode,
            status,
            note: finalNote,
            updatedByRole: 'customer',
            updatedByName: actorName,
            actorUid: verifiedUid,
            actorId: verifiedUid,
            actorRole,
            actorName,
            timestamp: nowIso,
            formattedWIB: formatBookingHistoryWIB(nowIso),
            requestFingerprint,
            ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
          };

          transaction.create(custHistRef, entry);
          return {
            status: 200,
            isIdempotent: false,
            entry,
          };
        }
      });

      if (txResult.status !== 200) {
        return res.status(txResult.status).json({
          success: false,
          code: txResult.code,
          error: txResult.message,
          message: txResult.message,
        });
      }

      return res.json({
        success: true,
        id: txResult.entry.id,
        isIdempotent: txResult.isIdempotent,
        ...(txResult.isDuplicateStatus ? { isDuplicateStatus: true } : {}),
        historyEntry: txResult.entry,
        history: txResult.entry,
        entry: txResult.entry,
      });
    } catch (err: any) {
      console.error('[Server Booking History] Append error:', err);
      const errCodeStr = String(err?.code || '');
      const errMsgStr = String(err?.message || '');
      const isAlreadyExists =
        err?.code === 6 ||
        errCodeStr === 'already-exists' ||
        /already[-_\s]?exists/i.test(`${errCodeStr} ${errMsgStr}`);
      if (isAlreadyExists) {
        return res.status(409).json({
          success: false,
          code: 'HISTORY_ID_CONFLICT',
          error: 'Entri riwayat status sudah ada. Silakan coba kembali.',
          message: 'Entri riwayat status sudah ada. Silakan coba kembali.',
        });
      }
      const statusCode =
        typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
          ? err.statusCode
          : 503;
      const code = err?.code || (statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_ERROR');
      const msg =
        statusCode === 503
          ? 'Layanan pencatatan riwayat status pesanan sedang tidak tersedia.'
          : err?.message || 'Permintaan tidak dapat diproses.';
      return res.status(statusCode).json({
        success: false,
        code,
        error: msg,
        message: msg,
      });
    }
  };

  app.post('/api/booking-history/initial', handleBookingStatusHistoryInitial);
  app.post('/api/booking-status-history/initial', handleBookingStatusHistoryInitial);
  app.post('/api/booking-history/append', handleBookingStatusHistoryAppend);
  app.post('/api/booking-status-history/append', handleBookingStatusHistoryAppend);

  // =============================================================
  // MANAGER STAFF MASTER CRUD ENDPOINTS (Server-Authoritative RBAC)
  // =============================================================

  // Phone normalization helper
  function normalizeWhatsAppServer(raw: string): string {
    if (!raw) return '';
    const cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');
    if (cleaned.startsWith('+62')) return cleaned;
    if (cleaned.startsWith('62')) return `+${cleaned}`;
    if (cleaned.startsWith('0')) return `+62${cleaned.substring(1)}`;
    if (cleaned.startsWith('8')) return `+62${cleaned}`;
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }

  // Password strength validator
  function validatePasswordComplexity(pass: string): { isValid: boolean; error?: string } {
    if (!pass || pass.length < 12) return { isValid: false, error: 'Kata sandi minimal 12 karakter.' };
    if (!/[A-Z]/.test(pass)) return { isValid: false, error: 'Kata sandi harus mengandung minimal satu huruf besar (A-Z).' };
    if (!/[a-z]/.test(pass)) return { isValid: false, error: 'Kata sandi harus mengandung minimal satu huruf kecil (a-z).' };
    if (!/[0-9]/.test(pass)) return { isValid: false, error: 'Kata sandi harus mengandung minimal satu angka (0-9).' };
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pass)) return { isValid: false, error: 'Kata sandi harus mengandung minimal satu simbol/karakter khusus (!@#$%^&*).' };
    return { isValid: true };
  }

  // Secure temp password generator
  function generateSecureTempPassword(): string {
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowercase = 'abcdefghijkmnopqrstuvwxyz';
    const numbers = '23456789';
    const symbols = '!@#$%^&*_-';
    const allChars = uppercase + lowercase + numbers + symbols;
    const chars = [
      uppercase[randomInt(0, uppercase.length)],
      lowercase[randomInt(0, lowercase.length)],
      numbers[randomInt(0, numbers.length)],
      symbols[randomInt(0, symbols.length)],
    ];
    while (chars.length < 14) {
      chars.push(allChars[randomInt(0, allChars.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  // Security Gatekeeper: Verifies Firebase ID Token and asserts Manager/Admin role authoritatively
  async function verifyManagerCaller(req: express.Request): Promise<{
    authorized: boolean;
    statusCode?: number;
    error?: string;
    caller?: {
      uid: string;
      email: string;
      role: string;
      name: string;
      staffId: string;
    };
  }> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Autentikasi diperlukan. Header Authorization: Bearer <token> tidak ditemukan.',
      };
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    if (!idToken) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Token autentikasi tidak valid.',
      };
    }

    let verifiedUid = '';
    let verifiedEmail = '';
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      verifiedUid = decoded.uid;
      verifiedEmail = (decoded.email || '').toLowerCase();
    } catch (adminErr: any) {
      try {
        const resp = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          }
        );
        const data = (await resp.json()) as any;
        if (!resp.ok || !data.users || !data.users[0]) {
          return {
            authorized: false,
            statusCode: 401,
            error: 'Sesi login tidak valid atau telah kadaluarsa. Silakan login kembali.',
          };
        }
        verifiedUid = data.users[0].localId;
        verifiedEmail = (data.users[0].email || '').toLowerCase();
      } catch (err: any) {
        return {
          authorized: false,
          statusCode: 401,
          error: 'Gagal memverifikasi token autentikasi.',
        };
      }
    }

    // Cache metadata is never the authority for Staff Master permissions.
    let callerRole = '';
    let callerName = '';
    let callerStaffId = '';
    let isCallerActive = false;
    const cached = reconciliationCache.get(verifiedUid);
    const now = Date.now();
    if (cached && (cached.uid !== verifiedUid || !Number.isFinite(cached.verifiedAt) ||
        cached.verifiedAt > now || now - cached.verifiedAt >= RECONCILIATION_TTL_MS)) {
      reconciliationCache.delete(verifiedUid);
    }

    try {
      if (!adminDb) throw new Error('Authoritative database unavailable');
      // Resolve a consistent current role and Staff Master snapshot. No cache
      // grants, memory fallback, email claim, or role-document writes here.
      const resolved = await adminDb.runTransaction(async (transaction) => {
        const textId = (value: unknown) => typeof value === 'string' ? value.trim() : '';
        const uidConflict = (record: any) => [record.authUserId, record.authUid].some(value =>
          value != null && value !== '' && (typeof value !== 'string' || textId(value) !== verifiedUid));
        const disabled = (record: any) => record.isActive === false || record.loginEnabled === false ||
          ['INACTIVE', 'DISABLED', 'ARCHIVED', 'DINONAKTIFKAN', 'DELETED', 'TERMINATED']
            .includes(textId(record.status).toUpperCase()) ||
          textId(record.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';
        const denied = (message: string) => Object.assign(new Error(message), { managerAuthorizationDenied: true });

        const roleSnap = await transaction.get(adminDb.collection('staff_roles').doc(verifiedUid));
        const canonical = await transaction.get(adminDb.collection('staff_users').where('authUserId', '==', verifiedUid).limit(2));
        const legacy = await transaction.get(adminDb.collection('staff_users').where('authUid', '==', verifiedUid).limit(2));
        const direct = await transaction.get(adminDb.collection('staff_users').doc(verifiedUid));
        const staffDocs = new Map<string, any>();
        for (const docSnap of [...canonical.docs, ...legacy.docs]) staffDocs.set(docSnap.id, docSnap);
        if (direct.exists) staffDocs.set(direct.id, direct);
        if (staffDocs.size !== 1) throw denied('Identitas staf tidak dapat diverifikasi secara unik.');
        const staffSnap = [...staffDocs.values()][0];
        const staff = staffSnap.data();
        if (uidConflict(staff) || (staffSnap.id !== verifiedUid &&
            textId(staff.authUserId) !== verifiedUid && textId(staff.authUid) !== verifiedUid)) {
          throw denied('Identitas staf tidak sesuai dengan sesi.');
        }
        if (disabled(staff)) throw denied('Akses Ditolak: Akun staf Anda sedang dinonaktifkan.');

        const role = roleSnap.exists ? roleSnap.data() : null;
        if (role) {
          if (role.isActive !== true || disabled(role)) throw denied('Akses Ditolak: Akun staf Anda sedang dinonaktifkan.');
          if (uidConflict(role) || role.role !== staff.role) throw denied('Role staf tidak sesuai dengan Staff Master saat ini.');
          const aliases = new Set([verifiedUid, staffSnap.id, textId(staff.uid), textId(staff.id)].filter(Boolean));
          for (const linkedId of [role.staffId, role.staffUserId]) {
            if (linkedId != null && linkedId !== '' && (typeof linkedId !== 'string' || !aliases.has(textId(linkedId)))) {
              throw denied('Referensi Staff Master tidak sesuai.');
            }
          }
        } else if (staff.isActive !== true && textId(staff.status).toUpperCase() !== 'ACTIVE') {
          throw denied('Status aktif staf belum dapat diverifikasi.');
        }
        return { staffId: staffSnap.id as string, staff: { ...staff, uid: staffSnap.id } };
      });

      callerRole = resolved.staff.role;
      callerName = resolved.staff.name || resolved.staff.fullName || 'Manager Senzu';
      callerStaffId = resolved.staffId;
      isCallerActive = true;
      // Refresh only in-memory metadata after the authoritative check succeeds.
      serverStaffMasterCache.set(callerStaffId, resolved.staff);
      reconciliationCache.set(verifiedUid, {
        uid: verifiedUid,
        staffUserId: callerStaffId,
        role: callerRole,
        status: 'active',
        branchId: resolved.staff.branchId || 'PLG001',
        verifiedAt: Date.now(),
        staff: resolved.staff,
      });
    } catch (err: any) {
      reconciliationCache.delete(verifiedUid);
      return {
        authorized: false,
        statusCode: err.managerAuthorizationDenied === true ? 403 : 503,
        error: err.managerAuthorizationDenied === true ? err.message : 'Otorisasi Manager belum dapat diverifikasi. Silakan coba kembali.',
      };
    }

    if (!callerRole) {
      return {
        authorized: false,
        statusCode: 403,
        error: 'Anda tidak memiliki izin mengubah Master Data Staff.',
      };
    }

    if (!isCallerActive) {
      return {
        authorized: false,
        statusCode: 403,
        error: 'Akses Ditolak: Akun staf Anda sedang dinonaktifkan.',
      };
    }

    if (callerRole !== 'manager' && callerRole !== 'admin') {
      return {
        authorized: false,
        statusCode: 403,
        error: 'Akses Ditolak: Hanya Manager atau Admin yang berwenang melakukan operasi Staff Master.',
      };
    }

    return {
      authorized: true,
      caller: {
        uid: verifiedUid,
        email: verifiedEmail,
        role: callerRole,
        name: callerName,
        staffId: callerStaffId,
      },
    };
  }

  // Sanitize helper to remove undefined fields and invalid values before writing to Firestore
  function sanitizeForFirestore(obj: any): any {
    if (obj === undefined) return null;
    if (obj === null) return null;
    if (typeof obj === 'number' && isNaN(obj)) return null;
    if (Array.isArray(obj)) {
      return obj.map(sanitizeForFirestore);
    }
    if (typeof obj === 'object' && !(obj instanceof Date)) {
      const cleaned: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          cleaned[key] = sanitizeForFirestore(value);
        }
      }
      return cleaned;
    }
    return obj;
  }

  // Audit log recorder
  async function recordServerAuditLog(action: string, entityId: string, summary: string, caller: any, extraData?: any) {
    const now = new Date().toISOString();
    try {
      if (db) {
        await addDoc(collection(db, 'admin_audit_logs'), sanitizeForFirestore({
          actorId: caller.uid,
          actorName: caller.name,
          actorRole: caller.role,
          action,
          entityType: 'staff',
          entityId,
          timestamp: now,
          createdAt: now,
          summary,
          details: extraData ? JSON.stringify(extraData) : null,
        }));
      }
    } catch (e) {
      console.warn('[AUDIT_LOG_ERROR]', e);
    }
  }

  // 0. GET /api/manager/staff: List Staff Master records
  app.get('/api/manager/staff', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }

      if (!db) {
        return res.json({ success: true, staff: Array.from(serverStaffMasterCache.values()) });
      }

      try {
        const snap = await getDocs(collection(db, 'staff_users'));
        const list = snap.docs.map((d) => ({ ...d.data(), uid: d.id }));
        list.forEach((s) => serverStaffMasterCache.set(s.uid, s));
        return res.json({ success: true, staff: list });
      } catch (dbErr) {
        return res.json({ success: true, staff: Array.from(serverStaffMasterCache.values()) });
      }
    } catch (err: any) {
      console.error('Error fetching staff list:', err);
      return res.status(500).json({ error: 'Gagal mengambil data staf.' });
    }
  });

  // 0b. GET /api/manager/staff/:staffId: Get specific staff record
  app.get('/api/manager/staff/:staffId', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }

      const { staffId } = req.params;
      let staffData: any = null;

      if (db) {
        try {
          const docSnap = await getDoc(doc(db, 'staff_users', staffId));
          if (docSnap.exists()) {
            staffData = { ...docSnap.data(), uid: docSnap.id };
            serverStaffMasterCache.set(staffId, staffData);
          }
        } catch (e) {}
      }

      if (!staffData) {
        staffData = serverStaffMasterCache.get(staffId);
      }

      if (!staffData) {
        return res.status(404).json({ error: 'Data staf tidak ditemukan di sistem.' });
      }

      return res.json({ success: true, staff: staffData });
    } catch (err: any) {
      console.error('Error fetching staff member:', err);
      return res.status(500).json({ error: 'Gagal mengambil data staf.' });
    }
  });

  // 1. POST /api/manager/staff: Create new Staff Master record
  app.post('/api/manager/staff', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }
      const caller = authRes.caller!;

      const {
        employeeCode,
        staffCode,
        name,
        fullName,
        displayName,
        email,
        phone,
        role,
        gender,
        branchId,
        branchName,
        internalNotes,
        isActive,
        skillIds,
        specialties,
        serviceIds,
      } = req.body || {};

      const rawName = fullName || name;
      const rawCode = staffCode || employeeCode;

      if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
        return res.status(400).json({ error: 'Nama staf wajib diisi.' });
      }
      if (!role || !['manager', 'supervisor', 'css', 'therapist'].includes(role)) {
        return res.status(400).json({ error: 'Peran organisasi tidak valid. Pilihan: Manager, Supervisor, CSS, Therapist.' });
      }
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'Alamat email wajib diisi dengan format valid.' });
      }
      if (!phone) {
        return res.status(400).json({ error: 'Nomor WhatsApp staf wajib diisi.' });
      }
      if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
        return res.status(400).json({ error: 'Kode karyawan wajib diisi.' });
      }
      if (role === 'therapist' && (!gender || !['Perempuan', 'Laki-laki'].includes(gender))) {
        return res.status(400).json({ error: 'Jenis kelamin wajib dipilih untuk peran Terapis.' });
      }

      const cleanCode = rawCode.trim().toUpperCase();
      const cleanEmail = email.trim().toLowerCase();
      const cleanPhone = normalizeWhatsAppServer(phone);
      const cleanName = rawName.trim();
      const cleanDisplayName = displayName && typeof displayName === 'string' && displayName.trim() ? displayName.trim() : cleanName;
      const cleanNotes = internalNotes && typeof internalNotes === 'string' ? internalNotes.trim() : '';
      const now = new Date().toISOString();

      // Check unique constraints against cache
      for (const existing of serverStaffMasterCache.values()) {
        if (existing.employeeCode && existing.employeeCode.toUpperCase() === cleanCode) {
          return res.status(409).json({ error: 'Kode karyawan sudah digunakan.', code: 'DUPLICATE_CODE' });
        }
        if (existing.email && existing.email.toLowerCase() === cleanEmail) {
          return res.status(409).json({ error: 'Email staf sudah terdaftar.', code: 'DUPLICATE_EMAIL' });
        }
        if (existing.phone && normalizeWhatsAppServer(existing.phone) === cleanPhone) {
          return res.status(409).json({ error: 'Nomor WhatsApp sudah digunakan oleh staf lain.', code: 'DUPLICATE_PHONE' });
        }
      }

      // Check uniqueness in Firestore if accessible
      if (db) {
        try {
          const codeQuery = query(collection(db, 'staff_users'), where('employeeCode', '==', cleanCode), limit(1));
          const codeSnap = await getDocs(codeQuery);
          if (!codeSnap.empty) {
            return res.status(409).json({ error: 'Kode karyawan sudah digunakan.', code: 'DUPLICATE_CODE' });
          }

          const emailQuery = query(collection(db, 'staff_users'), where('email', '==', cleanEmail), limit(1));
          const emailSnap = await getDocs(emailQuery);
          if (!emailSnap.empty) {
            return res.status(409).json({ error: 'Email staf sudah terdaftar.', code: 'DUPLICATE_EMAIL' });
          }
        } catch (queryErr: any) {
          console.warn('[STAFF_CHECK_NOTICE]', queryErr?.message);
        }
      }

      const staffId = req.body.uid && typeof req.body.uid === 'string' && req.body.uid.startsWith('staff')
        ? req.body.uid
        : `staff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      
      const therapistId = role === 'therapist'
        ? (req.body.therapistId || `th_${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`)
        : undefined;

      const staffData: any = {
        uid: staffId,
        employeeCode: cleanCode,
        name: cleanName,
        displayName: cleanDisplayName,
        email: cleanEmail,
        phone: cleanPhone,
        gender: gender || (role === 'therapist' ? 'Perempuan' : ''),
        role,
        branchId: branchId || 'PLG001',
        branchName: branchName || 'Senzu Home Palembang R-01',
        isActive: isActive !== false,
        status: isActive !== false ? 'ACTIVE' : 'INACTIVE',
        loginAccountStatus: 'BELUM_DIBUAT',
        internalNotes: cleanNotes,
        isDemoAccount: false,
        createdAt: now,
        updatedAt: now,
        updatedBy: caller.name,
      };

      if (role === 'therapist' && therapistId) {
        staffData.therapistId = therapistId;
      }

      // Write to staff_users with authenticated credentials
      await ensureServerAuthenticated();
      if (db) {
        await setDoc(doc(db, 'staff_users', staffId), sanitizeForFirestore(staffData));
      }

      // Synchronize therapist master if role === 'therapist' (with safe rollback)
      if (role === 'therapist' && therapistId && db) {
        try {
          const therapistData = {
            id: therapistId,
            staffId,
            employeeCode: cleanCode,
            name: cleanName,
            displayName: cleanDisplayName,
            gender: gender || 'Perempuan',
            phone: cleanPhone,
            email: cleanEmail,
            branchId: branchId || 'PLG001',
            branchName: branchName || 'Senzu Home Palembang R-01',
            specialties: specialties && specialties.length > 0 ? specialties : ['Reflexology Keluarga'],
            serviceIds: serviceIds && serviceIds.length > 0 ? serviceIds : ['srv-sig-60', 'srv-sig-90'],
            skillIds: Array.isArray(skillIds) ? skillIds : [],
            rating: 5.0,
            totalCompleted: 0,
            status: isActive !== false ? 'available' : 'off',
            isActive: isActive !== false,
            customerDisplayEnabled: true,
            internalNotes: cleanNotes,
            createdAt: now,
            updatedAt: now,
            updatedBy: caller.name,
          };
          await setDoc(doc(db, 'therapists', therapistId), sanitizeForFirestore(therapistData), { merge: true });
        } catch (thErr) {
          console.error('Therapist master sync failed, rolling back staff record:', thErr);
          await deleteDoc(doc(db, 'staff_users', staffId)).catch(() => {});
          return res.status(500).json({ error: 'Server gagal menyinkronkan data terapis. Silakan coba kembali.' });
        }
      }

      // Keep cache up to date
      serverStaffMasterCache.set(staffId, staffData);

      await recordServerAuditLog(
        'STAFF_CREATED',
        staffId,
        `Manager ${caller.name} mendaftarkan staf baru "${cleanName}" (${cleanCode}, peran: ${role.toUpperCase()})`,
        caller,
        { employeeCode: cleanCode, name: cleanName, role, email: cleanEmail }
      );

      return res.status(201).json({
        success: true,
        staff: staffData,
        message: `Staf baru "${cleanName}" (${cleanCode}) berhasil didaftarkan.`,
      });
    } catch (err: any) {
      console.error('Create staff endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal mendaftarkan staf baru.' });
    }
  });

  // 2. PATCH /api/manager/staff/:staffId: Update existing Staff Master record
  app.patch('/api/manager/staff/:staffId', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }
      const caller = authRes.caller!;
      const { staffId } = req.params;

      if (!staffId) {
        return res.status(400).json({ error: 'Parameter staffId wajib disertakan.' });
      }

      let existingStaff: any = null;
      if (db) {
        try {
          const staffSnap = await getDoc(doc(db, 'staff_users', staffId));
          if (staffSnap.exists()) {
            existingStaff = staffSnap.data();
          }
        } catch (e) {}
      }

      if (!existingStaff) {
        existingStaff = serverStaffMasterCache.get(staffId);
      }

      if (!existingStaff) {
        return res.status(404).json({ error: 'Data staf tidak ditemukan di sistem.' });
      }

      const {
        employeeCode,
        staffCode,
        name,
        fullName,
        displayName,
        email,
        phone,
        role,
        gender,
        branchId,
        branchName,
        internalNotes,
        isActive,
        skillIds,
        specialties,
        serviceIds,
      } = req.body || {};

      const now = new Date().toISOString();
      const updates: Record<string, any> = {
        updatedAt: now,
        updatedBy: caller.name,
      };

      const rawName = fullName || name;
      const rawCode = staffCode || employeeCode;

      if (rawName && typeof rawName === 'string') updates.name = rawName.trim();
      if (displayName !== undefined) updates.displayName = displayName && displayName.trim() ? displayName.trim() : (updates.name || existingStaff.name);
      if (internalNotes !== undefined) updates.internalNotes = internalNotes.trim();
      if (branchId) updates.branchId = branchId;
      if (branchName) updates.branchName = branchName;
      if (gender) updates.gender = gender;

      if (phone) {
        const cleanPhone = normalizeWhatsAppServer(phone);
        // Check uniqueness across other staff
        for (const [id, st] of serverStaffMasterCache.entries()) {
          if (id !== staffId && st.phone && normalizeWhatsAppServer(st.phone) === cleanPhone) {
            return res.status(409).json({ error: 'Nomor WhatsApp sudah digunakan oleh staf lain.', code: 'DUPLICATE_PHONE' });
          }
        }
        updates.phone = cleanPhone;
      }

      if (email && email.trim().toLowerCase() !== existingStaff.email) {
        const cleanEmail = email.trim().toLowerCase();
        for (const [id, st] of serverStaffMasterCache.entries()) {
          if (id !== staffId && st.email && st.email.toLowerCase() === cleanEmail) {
            return res.status(409).json({ error: 'Email staf sudah terdaftar.', code: 'DUPLICATE_EMAIL' });
          }
        }
        if (db) {
          try {
            const emailQuery = query(collection(db, 'staff_users'), where('email', '==', cleanEmail), limit(1));
            const emailSnap = await getDocs(emailQuery);
            if (!emailSnap.empty && emailSnap.docs[0].id !== staffId) {
              return res.status(409).json({ error: 'Email staf sudah terdaftar.', code: 'DUPLICATE_EMAIL' });
            }
          } catch (e) {}
        }
        updates.email = cleanEmail;
      }

      if (rawCode && rawCode.trim().toUpperCase() !== existingStaff.employeeCode) {
        const cleanCode = rawCode.trim().toUpperCase();
        for (const [id, st] of serverStaffMasterCache.entries()) {
          if (id !== staffId && st.employeeCode && st.employeeCode.toUpperCase() === cleanCode) {
            return res.status(409).json({ error: 'Kode karyawan sudah digunakan.', code: 'DUPLICATE_CODE' });
          }
        }
        if (db) {
          try {
            const codeQuery = query(collection(db, 'staff_users'), where('employeeCode', '==', cleanCode), limit(1));
            const codeSnap = await getDocs(codeQuery);
            if (!codeSnap.empty && codeSnap.docs[0].id !== staffId) {
              return res.status(409).json({ error: 'Kode karyawan sudah digunakan.', code: 'DUPLICATE_CODE' });
            }
          } catch (e) {}
        }
        updates.employeeCode = cleanCode;
      }

      if (isActive !== undefined) {
        updates.isActive = isActive;
        updates.status = isActive ? 'ACTIVE' : 'INACTIVE';
      }

      // Role update & role transition
      const oldRole = existingStaff.role;
      const newRole = role || oldRole;
      if (role && role !== oldRole) {
        if (!['manager', 'supervisor', 'css', 'therapist'].includes(role)) {
          return res.status(400).json({ error: 'Peran organisasi tidak valid.' });
        }
        updates.role = role;

        // Synchronize server-authoritative staff_roles if login account exists
        const linkedAuthUid = existingStaff.authUserId || existingStaff.authUid;
        if (linkedAuthUid && db) {
          await setDoc(doc(db, 'staff_roles', linkedAuthUid), {
            role: newRole,
            updatedAt: now,
          }, { merge: true }).catch(() => {});
          reconciliationCache.delete(linkedAuthUid);
        }

        // If transitioning from therapist -> other role: deactivate therapist record
        if (oldRole === 'therapist' && newRole !== 'therapist') {
          const thId = existingStaff.therapistId || `th_${existingStaff.employeeCode?.toLowerCase() || staffId.replace('staff_', '')}`;
          if (db) {
            await updateDoc(doc(db, 'therapists', thId), {
              isActive: false,
              status: 'off',
              updatedAt: now,
              updatedBy: caller.name,
            }).catch(() => {});
          }
        }

        // If transitioning from other role -> therapist: activate or create therapist record
        if (oldRole !== 'therapist' && newRole === 'therapist') {
          const thId = existingStaff.therapistId || `th_${(updates.employeeCode || existingStaff.employeeCode || '').toLowerCase().replace(/[^a-z0-9]/g, '') || staffId.replace('staff_', '')}`;
          updates.therapistId = thId;
          if (db) {
            await setDoc(doc(db, 'therapists', thId), sanitizeForFirestore({
              id: thId,
              staffId,
              employeeCode: updates.employeeCode || existingStaff.employeeCode,
              name: updates.name || existingStaff.name,
              displayName: updates.displayName || existingStaff.displayName || existingStaff.name,
              gender: updates.gender || existingStaff.gender || 'Perempuan',
              phone: updates.phone || existingStaff.phone,
              email: updates.email || existingStaff.email,
              branchId: updates.branchId || existingStaff.branchId || 'PLG001',
              branchName: updates.branchName || existingStaff.branchName || 'Senzu Home Palembang R-01',
              specialties: specialties || ['Reflexology Keluarga'],
              serviceIds: serviceIds || ['srv-sig-60', 'srv-sig-90'],
              skillIds: Array.isArray(skillIds) ? skillIds : [],
              rating: 5.0,
              totalCompleted: 0,
              status: 'available',
              isActive: true,
              customerDisplayEnabled: true,
              createdAt: now,
              updatedAt: now,
              updatedBy: caller.name,
            }), { merge: true }).catch(() => {});
          }
        }

        await recordServerAuditLog(
          'STAFF_ROLE_CHANGED',
          staffId,
          `Manager ${caller.name} mengubah peran staf "${existingStaff.name}" dari ${oldRole.toUpperCase()} menjadi ${newRole.toUpperCase()}`,
          caller,
          { oldRole, newRole }
        );
      }

      // Ensure server is authenticated
      await ensureServerAuthenticated();

      // Update staff_users doc
      if (db) {
        await updateDoc(doc(db, 'staff_users', staffId), sanitizeForFirestore(updates));
      }

      // Synchronize therapist record if staff is a therapist
      if ((newRole === 'therapist' || existingStaff.role === 'therapist') && db) {
        const thId = existingStaff.therapistId || updates.therapistId || `th_${(existingStaff.employeeCode || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const therapistUpdates: Record<string, any> = {
          name: updates.name || existingStaff.name,
          displayName: updates.displayName || existingStaff.displayName,
          phone: updates.phone || existingStaff.phone,
          email: updates.email || existingStaff.email,
          gender: updates.gender || existingStaff.gender,
          branchId: updates.branchId || existingStaff.branchId,
          branchName: updates.branchName || existingStaff.branchName,
          internalNotes: updates.internalNotes !== undefined ? updates.internalNotes : existingStaff.internalNotes,
          updatedAt: now,
          updatedBy: caller.name,
        };
        if (updates.isActive !== undefined) {
          therapistUpdates.isActive = updates.isActive;
          therapistUpdates.status = updates.isActive ? 'available' : 'off';
        }
        if (Array.isArray(skillIds)) {
          therapistUpdates.skillIds = skillIds;
        }
        if (Array.isArray(specialties)) {
          therapistUpdates.specialties = specialties;
        }
        if (Array.isArray(serviceIds)) {
          therapistUpdates.serviceIds = serviceIds;
        }
        await setDoc(doc(db, 'therapists', thId), sanitizeForFirestore(therapistUpdates), { merge: true }).catch(() => {});
      }

      await recordServerAuditLog(
        'STAFF_UPDATED',
        staffId,
        `Manager ${caller.name} memperbarui profil staf "${updates.name || existingStaff.name}"`,
        caller,
        updates
      );

      const mergedStaff = { ...existingStaff, ...updates };
      serverStaffMasterCache.set(staffId, mergedStaff);

      return res.json({
        success: true,
        staff: mergedStaff,
        message: `Profil staf "${mergedStaff.name}" berhasil diperbarui.`,
      });
    } catch (err: any) {
      console.error('Update staff endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal memperbarui data staf.' });
    }
  });

  // 3. POST /api/manager/staff/:staffId/create-login: Provision Firebase Auth account and link authoritatively
  app.post('/api/manager/staff/:staffId/create-login', async (req, res) => {
    let secApp: any = null;
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }
      const caller = authRes.caller!;
      const { staffId } = req.params;
      const { mode, tempPassword } = req.body;

      if (!mode || !['INVITE_LINK', 'TEMP_PASSWORD'].includes(mode)) {
        return res.status(400).json({ error: 'Metode pembuatan akun tidak valid. Pilihan: INVITE_LINK atau TEMP_PASSWORD.' });
      }

      let staff: any = null;
      if (db) {
        const staffSnap = await getDoc(doc(db, 'staff_users', staffId));
        if (staffSnap.exists()) staff = staffSnap.data();
      }
      if (!staff) {
        return res.status(404).json({ error: 'Data staf tidak ditemukan di sistem.' });
      }

      const email = staff.email ? staff.email.trim().toLowerCase() : '';
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Staf tidak memiliki alamat email yang valid untuk login.' });
      }

      // Check collision: Does another staff_user already have this email?
      if (db) {
        const emailSnap = await getDocs(query(collection(db, 'staff_users'), where('email', '==', email), limit(2)));
        for (const d of emailSnap.docs) {
          if (d.id !== staffId) {
            return res.status(400).json({ error: `Alamat email "${email}" sudah ditautkan ke akun staf lain (${d.data().name || 'staf'}).` });
          }
        }
      }

      let passwordToUse = '';
      if (mode === 'TEMP_PASSWORD') {
        const passCheck = validatePasswordComplexity(tempPassword || '');
        if (!passCheck.isValid) {
          return res.status(400).json({ error: passCheck.error });
        }
        passwordToUse = tempPassword;
      } else {
        passwordToUse = generateSecureTempPassword();
      }

      // Create user using isolated secondary app
      const secAppName = `prov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      secApp = initializeApp(firebaseConfig, secAppName);
      const secAuth = getAuth(secApp);

      let createdAuthUid = '';
      let isExistingAuthUser = false;

      try {
        const cred = await createUserWithEmailAndPassword(secAuth, email, passwordToUse);
        createdAuthUid = cred.user.uid;
        await signOut(secAuth);
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          isExistingAuthUser = true;
          // Look up if this email is already known in staff_roles or staff_users
          createdAuthUid = staff.authUserId || staff.authUid || '';
        } else {
          return res.status(400).json({ error: `Gagal membuat akun Firebase Auth: ${authErr.message}` });
        }
      }

      // Send password setup / reset email
      if (mode === 'INVITE_LINK' || isExistingAuthUser) {
        try {
          await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
          });
        } catch (mailErr) {
          console.warn('[PASSWORD_RESET_SEND_WARNING]', mailErr);
        }
      }

      const now = new Date().toISOString();
      const loginStatus = mode === 'INVITE_LINK' ? 'UNDANGAN_TERKIRIM' : 'WAJIB_GANTI_PASSWORD';

      // Update staff_users doc
      const staffUpdates: Record<string, any> = {
        loginAccountStatus: loginStatus,
        mustChangePassword: true,
        accountCreatedAt: now,
        updatedAt: now,
        updatedBy: caller.name,
      };
      if (createdAuthUid) {
        staffUpdates.authUserId = createdAuthUid;
        staffUpdates.authUid = createdAuthUid;
      }

      if (db) {
        await updateDoc(doc(db, 'staff_users', staffId), sanitizeForFirestore(staffUpdates));

        // Authoritatively set staff_roles doc
        if (createdAuthUid) {
          await setDoc(doc(db, 'staff_roles', createdAuthUid), sanitizeForFirestore({
            authUserId: createdAuthUid,
            staffId,
            staffUserId: staffId,
            therapistId: staff.therapistId || staffId,
            role: staff.role,
            name: staff.name,
            email,
            status: 'ACTIVE',
            isActive: true,
            branchId: staff.branchId || 'PLG001',
            accountType: 'STAFF',
            updatedAt: now,
          }), { merge: true });

          reconciliationCache.delete(createdAuthUid);
        }
      }

      await recordServerAuditLog(
        'STAFF_LOGIN_CREATED',
        staffId,
        `Manager ${caller.name} membuat akun login untuk staf "${staff.name}" (${email}, metode: ${mode})`,
        caller,
        { email, mode, authUid: createdAuthUid }
      );

      return res.json({
        success: true,
        authUid: createdAuthUid,
        loginAccountStatus: loginStatus,
        message: mode === 'INVITE_LINK'
          ? `Akun login berhasil dibuat. Link pengaturan kata sandi telah dikirim ke email ${email}.`
          : `Akun login berhasil dibuat dengan kata sandi sementara. Staf diwajibkan mengganti kata sandi saat pertama kali login.`,
      });
    } catch (err: any) {
      console.error('Create login endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal membuat akun login staf.' });
    } finally {
      if (secApp) {
        deleteApp(secApp).catch(() => {});
      }
    }
  });

  // 4. POST /api/manager/staff/:staffId/reset-password: Send password reset link to staff email
  app.post('/api/manager/staff/:staffId/reset-password', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }
      const caller = authRes.caller!;
      const { staffId } = req.params;

      let staff: any = null;
      if (db) {
        const snap = await getDoc(doc(db, 'staff_users', staffId));
        if (snap.exists()) staff = snap.data();
      }
      if (!staff) {
        return res.status(404).json({ error: 'Data staf tidak ditemukan di sistem.' });
      }

      const email = staff.email ? staff.email.trim().toLowerCase() : '';
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Staf tidak memiliki alamat email yang valid.' });
      }

      const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      });

      if (!resp.ok) {
        const errData = (await resp.json()) as any;
        return res.status(400).json({ error: errData?.error?.message || 'Gagal mengirim link reset kata sandi ke Firebase Auth.' });
      }

      const now = new Date().toISOString();
      if (db) {
        await updateDoc(doc(db, 'staff_users', staffId), {
          loginAccountStatus: 'UNDANGAN_TERKIRIM',
          updatedAt: now,
          updatedBy: caller.name,
        }).catch(() => {});
      }

      await recordServerAuditLog(
        'STAFF_PASSWORD_RESET_REQUESTED',
        staffId,
        `Manager ${caller.name} mengirimkan tautan reset kata sandi ke ${email} untuk staf "${staff.name}"`,
        caller,
        { email }
      );

      return res.json({
        success: true,
        message: `Tautan pengaturan ulang kata sandi berhasil dikirim ke alamat email "${email}".`,
      });
    } catch (err: any) {
      console.error('Reset password endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal mengirim link reset kata sandi.' });
    }
  });

  // 5. POST /api/manager/staff/:staffId/deactivate: Deactivate staff (soft-deactivate, revokes login & assignments)
  app.post('/api/manager/staff/:staffId/deactivate', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }
      const caller = authRes.caller!;
      const { staffId } = req.params;
      const { reason } = req.body || {};

      let staff: any = null;
      if (db) {
        const snap = await getDoc(doc(db, 'staff_users', staffId));
        if (snap.exists()) staff = { ...snap.data(), uid: snap.id };
      }
      if (!staff) {
        staff = serverStaffMasterCache.get(staffId);
      }
      if (!staff) {
        return res.status(404).json({ error: 'Data staf tidak ditemukan di sistem.' });
      }

      // 16. MANAGER SELF-PROTECTION: Cannot deactivate own account
      if (
        staff.authUserId === caller.uid ||
        staff.authUid === caller.uid ||
        staff.uid === caller.staffId ||
        staffId === caller.staffId
      ) {
        return res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun yang sedang digunakan.' });
      }

      // 17. LAST MANAGER PROTECTION: Ensure at least one active manager remains
      if (staff.role === 'manager' || staff.role === 'admin') {
        let activeManagersCount = 0;
        if (db) {
          try {
            const allStaffSnap = await getDocs(collection(db, 'staff_users'));
            activeManagersCount = allStaffSnap.docs.filter((d) => {
              const data = d.data();
              const isMgr = data.role === 'manager' || data.role === 'admin';
              const isActive = data.isActive !== false && data.status !== 'INACTIVE';
              return isMgr && isActive;
            }).length;
          } catch {
            activeManagersCount = Array.from(serverStaffMasterCache.values()).filter(
              (s) => (s.role === 'manager' || s.role === 'admin') && s.isActive !== false && s.status !== 'INACTIVE'
            ).length;
          }
        } else {
          activeManagersCount = Array.from(serverStaffMasterCache.values()).filter(
            (s) => (s.role === 'manager' || s.role === 'admin') && s.isActive !== false && s.status !== 'INACTIVE'
          ).length;
        }

        if (activeManagersCount <= 1) {
          return res.status(400).json({ error: 'Minimal satu akun Manager aktif harus tersedia.' });
        }
      }

      // 10. EXISTING BOOKING PROTECTION: Check if therapist has active ongoing bookings
      if (staff.role === 'therapist' || staff.therapistId) {
        const thId = staff.therapistId || `th_${staff.employeeCode?.toLowerCase() || staffId.replace('staff_', '')}`;
        if (db) {
          try {
            const bookingsSnap = await getDocs(collection(db, 'bookings'));
            const ongoingStatuses = ['Accepted', 'On The Way', 'Arrived', 'Treatment'];
            const ongoing = bookingsSnap.docs
              .map((d) => d.data())
              .filter((b) => (b.therapistId === thId || b.therapistId === staffId) && ongoingStatuses.includes(b.status));

            if (ongoing.length > 0) {
              const activeBooking = ongoing[0];
              const code = activeBooking.bookingCode || activeBooking.id || 'Order Aktif';
              return res.status(400).json({
                error: `Terapis "${staff.name}" masih memiliki order operasional yang sedang berjalan (${code} - ${activeBooking.status}). Harap selesaikan atau alihkan penugasan sebelum menonaktifkan terapis.`,
                hasActiveBookings: true,
              });
            }
          } catch (bErr) {
            console.warn('[Staff Deactivate] Booking check notice:', bErr);
          }
        }
      }

      const now = new Date().toISOString();
      const updates = {
        isActive: false,
        status: 'INACTIVE',
        loginAccountStatus: 'DINONAKTIFKAN',
        deactivatedAt: now,
        deactivatedBy: caller.staffId || caller.uid,
        deactivationReason: reason || '',
        updatedAt: now,
        updatedBy: caller.name,
      };

      await ensureServerAuthenticated();

      if (db) {
        await updateDoc(doc(db, 'staff_users', staffId), sanitizeForFirestore(updates));

        const linkedAuthUid = staff.authUserId || staff.authUid;
        if (linkedAuthUid) {
          await setDoc(
            doc(db, 'staff_roles', linkedAuthUid),
            {
              isActive: false,
              status: 'inactive',
              deactivatedAt: now,
              updatedAt: now,
            },
            { merge: true }
          );
          reconciliationCache.delete(linkedAuthUid);
        }

        if (staff.role === 'therapist' || staff.therapistId) {
          const thId = staff.therapistId || `th_${staff.employeeCode?.toLowerCase() || staffId.replace('staff_', '')}`;
          await updateDoc(
            doc(db, 'therapists', thId),
            sanitizeForFirestore({
              isActive: false,
              status: 'off',
              deactivatedAt: now,
              updatedAt: now,
              updatedBy: caller.name,
            })
          ).catch(() => {});
        }
      }

      // Update in-memory cache
      const cachedStaff = serverStaffMasterCache.get(staffId);
      if (cachedStaff) {
        serverStaffMasterCache.set(staffId, { ...cachedStaff, ...updates });
      }

      await recordServerAuditLog(
        'STAFF_DEACTIVATED',
        staffId,
        `Manager ${caller.name} menonaktifkan akun staf "${staff.name}" (${staff.role.toUpperCase()})${reason ? ` - Alasan: ${reason}` : ''}`,
        caller,
        {
          staffId,
          name: staff.name,
          role: staff.role,
          reason: reason || '',
          actorStaffId: caller.staffId || caller.uid,
          targetStaffId: staffId,
        }
      );

      return res.json({
        success: true,
        message: `Akun staf "${staff.name}" berhasil dinonaktifkan. Akses login dan penugasan operasional telah dicabut.`,
      });
    } catch (err: any) {
      console.error('Deactivate staff endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal menonaktifkan staf.' });
    }
  });

  // 6. POST /api/manager/staff/:staffId/reactivate: Reactivate staff
  app.post('/api/manager/staff/:staffId/reactivate', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }
      const caller = authRes.caller!;
      const { staffId } = req.params;

      let staff: any = null;
      if (db) {
        const snap = await getDoc(doc(db, 'staff_users', staffId));
        if (snap.exists()) staff = { ...snap.data(), uid: snap.id };
      }
      if (!staff) {
        staff = serverStaffMasterCache.get(staffId);
      }
      if (!staff) {
        return res.status(404).json({ error: 'Data staf tidak ditemukan di sistem.' });
      }

      const now = new Date().toISOString();
      const linkedAuthUid = staff.authUserId || staff.authUid;
      const updates = {
        isActive: true,
        status: 'ACTIVE',
        loginAccountStatus: linkedAuthUid ? 'AKTIF' : 'BELUM_DIBUAT',
        reactivatedAt: now,
        reactivatedBy: caller.staffId || caller.uid,
        updatedAt: now,
        updatedBy: caller.name,
      };

      await ensureServerAuthenticated();

      if (db) {
        await updateDoc(doc(db, 'staff_users', staffId), sanitizeForFirestore(updates));

        if (linkedAuthUid) {
          await setDoc(
            doc(db, 'staff_roles', linkedAuthUid),
            {
              isActive: true,
              status: 'active',
              reactivatedAt: now,
              updatedAt: now,
            },
            { merge: true }
          );
          reconciliationCache.delete(linkedAuthUid);
        }

        if (staff.role === 'therapist' || staff.therapistId) {
          const thId = staff.therapistId || `th_${staff.employeeCode?.toLowerCase() || staffId.replace('staff_', '')}`;
          await updateDoc(
            doc(db, 'therapists', thId),
            sanitizeForFirestore({
              isActive: true,
              status: 'available',
              reactivatedAt: now,
              updatedAt: now,
              updatedBy: caller.name,
            })
          ).catch(() => {});
        }
      }

      // Update in-memory cache
      const cachedStaff = serverStaffMasterCache.get(staffId);
      if (cachedStaff) {
        serverStaffMasterCache.set(staffId, { ...cachedStaff, ...updates });
      }

      await recordServerAuditLog(
        'STAFF_REACTIVATED',
        staffId,
        `Manager ${caller.name} mengaktifkan kembali akun staf "${staff.name}" (${staff.role.toUpperCase()})`,
        caller,
        {
          staffId,
          name: staff.name,
          role: staff.role,
          actorStaffId: caller.staffId || caller.uid,
          targetStaffId: staffId,
        }
      );

      return res.json({
        success: true,
        message: `Akun staf "${staff.name}" berhasil diaktifkan kembali.`,
      });
    } catch (err: any) {
      console.error('Reactivate staff endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal mengaktifkan staf.' });
    }
  });

  // 6b. DELETE /api/manager/staff/:staffId: HARD DELETE IS STRICTLY PROHIBITED
  app.delete('/api/manager/staff/:staffId', async (req, res) => {
    return res.status(400).json({
      error: 'Operasi hard delete dinonaktifkan untuk melindungi integritas riwayat transaksi dan operasional. Silakan gunakan opsi Nonaktifkan / Arsipkan Staf.',
    });
  });

  // 7. PATCH /api/manager/staff/:staffId/role: Authoritatively change operational role
  app.patch('/api/manager/staff/:staffId/role', async (req, res) => {
    try {
      const authRes = await verifyManagerCaller(req);
      if (!authRes.authorized) {
        return res.status(authRes.statusCode || 403).json({ error: authRes.error });
      }
      const caller = authRes.caller!;
      const { staffId } = req.params;
      const { role } = req.body;

      if (!role || !['manager', 'supervisor', 'css', 'therapist'].includes(role)) {
        return res.status(400).json({ error: 'Peran organisasi tidak valid. Pilihan: Manager, Supervisor, CSS, Therapist.' });
      }

      let staff: any = null;
      if (db) {
        const snap = await getDoc(doc(db, 'staff_users', staffId));
        if (snap.exists()) staff = snap.data();
      }
      if (!staff) {
        return res.status(404).json({ error: 'Data staf tidak ditemukan di sistem.' });
      }

      const oldRole = staff.role;
      const now = new Date().toISOString();

      if (db) {
        await updateDoc(doc(db, 'staff_users', staffId), {
          role,
          updatedAt: now,
          updatedBy: caller.name,
        });

        const linkedAuthUid = staff.authUserId || staff.authUid;
        if (linkedAuthUid) {
          await setDoc(doc(db, 'staff_roles', linkedAuthUid), {
            role,
            updatedAt: now,
          }, { merge: true });
          reconciliationCache.delete(linkedAuthUid);
        }

        // Therapist sync
        if (oldRole === 'therapist' && role !== 'therapist') {
          const thId = staff.therapistId || `th_${staff.employeeCode?.toLowerCase() || staffId.replace('staff_', '')}`;
          await updateDoc(doc(db, 'therapists', thId), {
            isActive: false,
            status: 'off',
            updatedAt: now,
            updatedBy: caller.name,
          }).catch(() => {});
        } else if (oldRole !== 'therapist' && role === 'therapist') {
          const thId = staff.therapistId || `th_${(staff.employeeCode || '').toLowerCase().replace(/[^a-z0-9]/g, '') || staffId.replace('staff_', '')}`;
          await setDoc(doc(db, 'therapists', thId), sanitizeForFirestore({
            id: thId,
            staffId,
            employeeCode: staff.employeeCode,
            name: staff.name,
            displayName: staff.displayName || staff.name,
            gender: staff.gender || 'Perempuan',
            phone: staff.phone,
            email: staff.email,
            branchId: staff.branchId || 'PLG001',
            branchName: staff.branchName || 'Senzu Home Palembang R-01',
            specialties: ['Reflexology Keluarga'],
            serviceIds: ['srv-sig-60', 'srv-sig-90'],
            skillIds: [],
            rating: 5.0,
            totalCompleted: 0,
            status: 'available',
            isActive: true,
            customerDisplayEnabled: true,
            createdAt: now,
            updatedAt: now,
            updatedBy: caller.name,
          }), { merge: true });
        }
      }

      await recordServerAuditLog(
        'STAFF_ROLE_CHANGED',
        staffId,
        `Manager ${caller.name} mengubah peran staf "${staff.name}" dari ${oldRole.toUpperCase()} ke ${role.toUpperCase()}`,
        caller,
        { oldRole, newRole: role }
      );

      return res.json({
        success: true,
        message: `Peran staf "${staff.name}" berhasil diubah menjadi ${role.toUpperCase()}.`,
      });
    } catch (err: any) {
      console.error('Update staff role endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal mengubah peran staf.' });
    }
  });

  // =========================================================================
  // AUTHORITATIVE BOOKING CHAT ENDPOINTS (PROMPT SECTIONS 4, 5, 6, 8, 9, 13)
  // Operational communication strictly between Customer <-> Assigned Therapist
  // =========================================================================

  /**
   * Authoritatively resolves caller authorization against a booking.
   * Checks customer ownership, assigned therapist mapping, and operational staff roles.
   */
  async function resolveChatParticipant(
    callerUid: string,
    booking: any
  ): Promise<{
    authorized: boolean;
    role: 'customer' | 'therapist' | 'staff' | null;
    displayName: string;
    therapistId?: string;
    error?: string;
  }> {
    if (!callerUid || !booking) {
      return { authorized: false, role: null, displayName: '', error: 'Identitas atau pesanan tidak valid.' };
    }

    // 1. Check if caller is Customer
    const isCustomerDirect =
      (booking.customerAuthUid && booking.customerAuthUid === callerUid) ||
      (booking.authUserId && booking.authUserId === callerUid) ||
      (booking.customerId && (booking.customerId === callerUid || booking.customerId === `cust_u_${callerUid}`));

    if (isCustomerDirect) {
      return {
        authorized: true,
        role: 'customer',
        displayName: booking.customerName || 'Pelanggan',
      };
    }

    if (adminDb && booking.customerId) {
      try {
        const custDoc = await adminDb.collection('customers').doc(booking.customerId).get();
        if (custDoc.exists && custDoc.data()?.authUserId === callerUid) {
          return {
            authorized: true,
            role: 'customer',
            displayName: custDoc.data()?.name || booking.customerName || 'Pelanggan',
          };
        }
      } catch {}
    }

    // 2. Check if caller is assigned Therapist or Staff
    let callerRole = '';
    let callerName = '';
    let callerTherapistId = '';

    if (adminDb) {
      try {
        const roleDoc = await adminDb.collection('staff_roles').doc(callerUid).get();
        if (roleDoc.exists) {
          const rd = roleDoc.data() as any;
          if (rd.isActive !== false) {
            callerRole = rd.role || '';
            callerName = rd.name || '';
            callerTherapistId = rd.therapistId || rd.staffId || '';
          }
        }
      } catch {}
    }

    const assignedTherapistId = booking.therapistId || booking.assignedTherapistId;

    // Check assigned therapist match
    if (callerTherapistId && assignedTherapistId && (callerTherapistId === assignedTherapistId || callerUid === assignedTherapistId)) {
      return {
        authorized: true,
        role: 'therapist',
        displayName: callerName || booking.therapistName || 'Terapis Senzu',
        therapistId: callerTherapistId,
      };
    }

    // Also check therapists collection by authUserId
    if (adminDb && assignedTherapistId) {
      try {
        const tDoc = await adminDb.collection('therapists').doc(assignedTherapistId).get();
        if (tDoc.exists) {
          const tData = tDoc.data() as any;
          if (tData.authUserId === callerUid || tData.authUid === callerUid) {
            return {
              authorized: true,
              role: 'therapist',
              displayName: tData.name || booking.therapistName || 'Terapis Senzu',
              therapistId: assignedTherapistId,
            };
          }
        }
      } catch {}
    }

    // 3. Check if caller is Operational Staff (manager, supervisor, css, admin)
    if (['manager', 'admin', 'supervisor', 'css'].includes(callerRole)) {
      return {
        authorized: true,
        role: 'staff',
        displayName: callerName || 'Staff Senzu',
      };
    }

    return {
      authorized: false,
      role: null,
      displayName: '',
      error: 'Akses chat ditolak: Anda bukan partisipan yang berwenang untuk pesanan ini.',
    };
  }

  app.post('/api/chat/init', async (req, res) => {
    try {
      const { bookingId } = req.body || {};
      if (!bookingId || typeof bookingId !== 'string') {
        return res.status(400).json({ success: false, message: 'bookingId wajib diisi.' });
      }

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ success: false, message: 'Database server tidak tersedia.' });
      }

      // 1. Authenticate caller via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Autentikasi diperlukan untuk mengakses chat.' });
      }
      const token = authHeader.split('Bearer ')[1]?.trim();
      const verified = await verifyFirebaseIdToken(token);
      if (!verified || !verified.uid) {
        return res.status(401).json({ success: false, message: 'Sesi autentikasi tidak valid atau telah berakhir.' });
      }
      const authUid = verified.uid;

      // 2. Fetch authoritative booking
      const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
      }
      const booking = bookingDoc.data() as any;

      // 3. Authorize caller against booking
      const participant = await resolveChatParticipant(authUid, booking);
      if (!participant.authorized) {
        return res.status(403).json({ success: false, message: participant.error || 'Akses chat ditolak.' });
      }

      const bookingStatus = (booking.status || '').toLowerCase().trim();
      const isTerminal =
        ['completed', 'cancelled', 'rescheduled', 'dibatalkan', 'selesai', 'expired'].includes(bookingStatus) ||
        ['expired', 'refunded', 'payment_rejected'].includes((booking.paymentStatus || '').toLowerCase().trim());

      // 4. Resolve authoritative participants
      const customerUid = booking.customerAuthUid || booking.authUserId || (participant.role === 'customer' ? authUid : (booking.customerId || ''));
      let therapistAuthUid = booking.therapistAuthUid || (participant.role === 'therapist' ? authUid : null);

      if (!therapistAuthUid && (booking.therapistId || booking.assignedTherapistId)) {
        const tId = booking.therapistId || booking.assignedTherapistId;
        try {
          const tDoc = await adminDb.collection('therapists').doc(tId).get();
          if (tDoc.exists && tDoc.data()?.authUserId) {
            therapistAuthUid = tDoc.data()!.authUserId;
          }
        } catch {}
      }

      const chatRef = adminDb.collection('booking_chats').doc(bookingId);
      const chatDoc = await chatRef.get();
      const now = new Date().toISOString();

      if (chatDoc.exists) {
        const existingChat = chatDoc.data() as any;
        const updates: any = { updatedAt: now };
        let hasUpdates = false;

        // Secure repair: only update participant UIDs if currently empty or if reassigned
        if (participant.role === 'therapist' && (!existingChat.therapistAuthUid || existingChat.therapistAuthUid !== authUid)) {
          updates.therapistAuthUid = authUid;
          hasUpdates = true;
        }
        if (participant.role === 'customer' && (!existingChat.customerUid || existingChat.customerUid !== authUid)) {
          updates.customerUid = authUid;
          hasUpdates = true;
        }
        // Update therapist assignment if changed in authoritative booking
        const assignedTId = booking.therapistId || booking.assignedTherapistId || '';
        if (assignedTId && existingChat.therapistId !== assignedTId) {
          updates.therapistId = assignedTId;
          updates.therapistName = booking.therapistName || booking.assignedTherapistName || existingChat.therapistName;
          if (therapistAuthUid) updates.therapistAuthUid = therapistAuthUid;
          hasUpdates = true;
        }
        if (isTerminal && existingChat.status !== 'closed') {
          updates.status = 'closed';
          updates.closedAt = now;
          hasUpdates = true;
        }

        if (hasUpdates) {
          await chatRef.update(updates).catch(() => {});
        }

        return res.json({
          success: true,
          chat: {
            ...existingChat,
            ...updates,
          },
        });
      }

      const newChat = {
        id: bookingId,
        bookingId,
        bookingCode: booking.bookingCode || '',
        customerUid,
        customerName: booking.customerName || (participant.role === 'customer' ? participant.displayName : 'Pelanggan'),
        therapistId: booking.therapistId || booking.assignedTherapistId || '',
        therapistAuthUid: therapistAuthUid || null,
        therapistName: booking.therapistName || booking.assignedTherapistName || 'Terapis Senzu',
        status: isTerminal ? 'closed' : 'active',
        createdAt: now,
        updatedAt: now,
        customerUnreadCount: 0,
        therapistUnreadCount: 0,
        closedAt: isTerminal ? now : null,
      };

      await chatRef.set(newChat);

      return res.json({
        success: true,
        chat: newChat,
      });
    } catch (err: any) {
      console.error('[API /api/chat/init] error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Gagal inisialisasi chat.' });
    }
  });

  app.post('/api/chat/send', async (req, res) => {
    try {
      const { bookingId, text, clientMessageId } = req.body || {};
      if (!bookingId || !text) {
        return res.status(400).json({ success: false, message: 'Parameter tidak lengkap.' });
      }

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ success: false, message: 'Database server tidak tersedia.' });
      }

      // 1. Authoritative verification of caller via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Autentikasi diperlukan untuk mengirim pesan.' });
      }
      const token = authHeader.split('Bearer ')[1]?.trim();
      const verified = await verifyFirebaseIdToken(token);
      if (!verified || !verified.uid) {
        return res.status(401).json({ success: false, message: 'Sesi autentikasi tidak valid atau telah berakhir.' });
      }
      const authUid = verified.uid;

      // 2. Fetch authoritative booking
      const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
      }
      const booking = bookingDoc.data() as any;

      // 3. Authorize caller against booking
      const participant = await resolveChatParticipant(authUid, booking);
      if (!participant.authorized) {
        return res.status(403).json({ success: false, message: participant.error || 'Akses chat ditolak.' });
      }

      // 4. Verify booking eligibility - terminal bookings cannot send messages
      const bookingStatus = (booking.status || '').toLowerCase().trim();
      const isTerminal =
        ['completed', 'cancelled', 'rescheduled', 'dibatalkan', 'selesai', 'expired'].includes(bookingStatus) ||
        ['expired', 'refunded', 'payment_rejected'].includes((booking.paymentStatus || '').toLowerCase().trim());

      if (isTerminal) {
        return res.status(403).json({ success: false, message: 'Percakapan telah ditutup untuk pesanan ini.' });
      }

      // 5. Derive senderType and senderName authoritatively (server-side derivation only)
      let senderType: 'CUSTOMER' | 'THERAPIST' | 'SYSTEM';
      let senderName = '';
      if (participant.role === 'therapist') {
        senderType = 'THERAPIST';
        senderName = participant.displayName || booking.therapistName || 'Terapis Senzu';
      } else if (participant.role === 'customer') {
        senderType = 'CUSTOMER';
        senderName = participant.displayName || booking.customerName || 'Pelanggan';
      } else {
        // Operational staff
        senderType = 'SYSTEM';
        senderName = 'Senzu Home Support';
      }

      const trimmedText = String(text).trim();
      if (!trimmedText || trimmedText.length > 1000) {
        return res.status(400).json({ success: false, message: 'Pesan tidak valid atau melebihi 1000 karakter.' });
      }

      const messageId = clientMessageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const now = new Date().toISOString();

      const chatRef = adminDb.collection('booking_chats').doc(bookingId);
      const messageRef = chatRef.collection('messages').doc(messageId);

      // 6. Idempotency check: if message already exists, return early without re-incrementing
      const existingMsgDoc = await messageRef.get();
      if (existingMsgDoc.exists) {
        return res.json({ success: true, message: existingMsgDoc.data(), isIdempotent: true });
      }

      const messageDoc = {
        id: messageId,
        bookingId,
        senderType,
        senderUid: authUid,
        senderName,
        text: trimmedText,
        createdAt: now,
        readAt: null,
        clientMessageId: messageId,
        messageType: 'TEXT',
        status: 'sent',
      };

      // 7. Atomic persistence of message and parent metadata
      const batch = adminDb.batch();
      batch.set(messageRef, messageDoc);

      const unreadField = senderType === 'CUSTOMER' ? 'therapistUnreadCount' : 'customerUnreadCount';
      const updateData: any = {
        id: bookingId,
        bookingId,
        updatedAt: now,
        lastMessageAt: now,
        lastMessagePreview: trimmedText.length > 60 ? trimmedText.substring(0, 57) + '...' : trimmedText,
        lastSenderType: senderType,
        [unreadField]: FieldValue.increment(1),
      };
      if (!isTerminal) {
        updateData.status = 'active';
      }
      batch.set(chatRef, updateData, { merge: true });
      await batch.commit();

      // 8. Trigger authoritative chat notification dispatch asynchronously
      dispatchAuthoritativeChatNotification({ bookingId, messageId, senderType }).catch(() => {});

      return res.json({ success: true, message: messageDoc });
    } catch (err: any) {
      console.error('[API /api/chat/send] error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Gagal mengirim pesan.' });
    }
  });

  app.post('/api/chat/read', async (req, res) => {
    try {
      const { bookingId } = req.body || {};
      if (!bookingId) {
        return res.status(400).json({ success: false, message: 'bookingId wajib diisi.' });
      }

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ success: false, message: 'Database server tidak tersedia.' });
      }

      // Authoritative verification of caller via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
      }
      const token = authHeader.split('Bearer ')[1]?.trim();
      const verified = await verifyFirebaseIdToken(token);
      if (!verified || !verified.uid) {
        return res.status(401).json({ success: false, message: 'Sesi login tidak valid.' });
      }
      const authUid = verified.uid;

      const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
      }
      const booking = bookingDoc.data() as any;

      const participant = await resolveChatParticipant(authUid, booking);
      if (!participant.authorized) {
        return res.status(403).json({ success: false, message: participant.error || 'Akses ditolak.' });
      }

      const effectiveRole = participant.role === 'therapist' ? 'THERAPIST' : 'CUSTOMER';
      const unreadZeroField = effectiveRole === 'CUSTOMER' ? 'customerUnreadCount' : 'therapistUnreadCount';

      const chatRef = adminDb.collection('booking_chats').doc(bookingId);
      await chatRef.update({
        [unreadZeroField]: 0,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});

      const targetSenderType = effectiveRole === 'CUSTOMER' ? 'THERAPIST' : 'CUSTOMER';
      const snap = await chatRef.collection('messages')
        .where('senderType', '==', targetSenderType)
        .where('readAt', '==', null)
        .limit(20)
        .get();

      if (!snap.empty) {
        const batch = adminDb.batch();
        const now = new Date().toISOString();
        snap.docs.forEach((d: any) => {
          batch.update(d.ref, { readAt: now });
        });
        await batch.commit();
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message || 'Gagal menandai pesan telah dibaca.' });
    }
  });

  // Authoritative Chat Notification Dispatcher (Stage 7E hardened)
  async function dispatchAuthoritativeChatNotification(params: {
    bookingId: string; messageId: string; senderType?: 'CUSTOMER' | 'THERAPIST' | 'SYSTEM';
  }): Promise<{ dispatched: boolean; isIdempotent?: boolean; notificationId?: string | null; deliveryId?: string | null; pushDeliveryId?: string | null }> {
    try { return await s7DispatchChat(params.bookingId, params.messageId); }
    catch { return { dispatched: false }; }
  }

  app.post('/api/chat/notify', s7Route(async (req, uid) => {
    const body = s7Body(req.body, ['bookingId', 'messageId', 'senderType']);
    if (!s7Id(body.bookingId) || !s7Id(body.messageId) || (body.senderType !== undefined && !['CUSTOMER','THERAPIST','SYSTEM'].includes(body.senderType))) throw s7Error(400, 'INVALID_CHAT_NOTIFY_INPUT');
    const caller: S7Caller = { uid, role: '', staffId: '', name: '', therapistIds: new Set() };
    const result = await s7DispatchChat(body.bookingId, body.messageId, caller, body.senderType);
    return { success: true, isIdempotent: result.isIdempotent === true, notificationId: result.notificationId };
  }));

  // Scoped guards for notification-device endpoints only.
  const notificationDeviceRateLimit = new Map<string, { count: number; resetAt: number }>();
  async function verifyNotificationDeviceCaller(req: any): Promise<string> {
    const raw = req.headers.authorization;
    const match = typeof raw === 'string' ? /^Bearer\s+(\S+)$/i.exec(raw.trim()) : null;
    if (!match) throw Object.assign(new Error('Autentikasi perangkat notifikasi diperlukan.'), { statusCode: 401, code: 'AUTH_REQUIRED' });
    let uid = '';
    try { uid = (await adminAuth.verifyIdToken(match[1]))?.uid || ''; } catch {}
    if (!uid) throw Object.assign(new Error('Sesi autentikasi tidak valid.'), { statusCode: 401, code: 'AUTH_TOKEN_INVALID' });
    const requestedUid = req.body?.userId;
    if (requestedUid !== undefined && requestedUid !== '' && requestedUid !== uid) {
      throw Object.assign(new Error('Identitas perangkat tidak sesuai dengan sesi.'), { statusCode: 403, code: 'PERMISSION_DENIED' });
    }
    const now = Date.now();
    for (const [key, value] of notificationDeviceRateLimit) {
      if (value.resetAt <= now) notificationDeviceRateLimit.delete(key);
    }
    const current = notificationDeviceRateLimit.get(uid);
    if (current && current.count >= 60) throw Object.assign(new Error('Permintaan perangkat terlalu sering. Silakan coba kembali.'), { statusCode: 429, code: 'RATE_LIMITED' });
    if (!current && notificationDeviceRateLimit.size >= 5000) throw Object.assign(new Error('Layanan perangkat sedang sibuk. Silakan coba kembali.'), { statusCode: 429, code: 'RATE_LIMITED' });
    notificationDeviceRateLimit.set(uid, current ? { ...current, count: current.count + 1 } : { count: 1, resetAt: now + 60000 });
    req.authUid = uid;
    return uid;
  }

  app.post('/api/notifications/register-device', async (req, res) => {
    try {
      const userId = await verifyNotificationDeviceCaller(req);
      const { token, platform, browser, deviceName } = req.body || {};
      if (typeof token !== 'string' || !token.trim() || token.length > 8192) {
        return res.status(400).json({ success: false, code: 'INVALID_DEVICE_TOKEN', message: 'Token perangkat tidak valid.' });
      }
      await ensureServerAuthenticated();
      if (!adminDb) return res.status(500).json({ success: false, code: 'SERVER_UNAVAILABLE', message: 'Database server tidak tersedia.' });

      // Preserve existing device IDs and payload formats in this scoped repair.
      const safeTokenId = Buffer.from(token).toString('base64').substring(0, 16).replace(/[^a-zA-Z0-9]/g, '_');
      const deviceId = `dev_${userId}_${safeTokenId}`;
      const deviceRef = adminDb.collection('notification_devices').doc(deviceId);
      const now = new Date().toISOString();
      await adminDb.runTransaction(async (transaction) => {
        const roleSnap = await transaction.get(adminDb.collection('staff_roles').doc(userId));
        const roleData = roleSnap.exists ? roleSnap.data() : null;
        let role = 'customer';
        if (roleData) {
          if (roleData.isActive !== true || ['inactive', 'disabled', 'archived'].includes(String(roleData.status || '').toLowerCase())) {
            throw Object.assign(new Error('Akun staf sedang tidak aktif.'), { statusCode: 403, code: 'ACCOUNT_DISABLED' });
          }
          if ((roleData.authUserId && roleData.authUserId !== userId) || (roleData.authUid && roleData.authUid !== userId) ||
              !['therapist', 'css', 'supervisor', 'manager', 'admin', 'staff'].includes(roleData.role)) {
            throw Object.assign(new Error('Identitas staf tidak sesuai.'), { statusCode: 403, code: 'PERMISSION_DENIED' });
          }
          role = roleData.role;
        }
        const existing = await transaction.get(deviceRef);
        if (existing.exists && existing.data()?.userId !== userId) {
          throw Object.assign(new Error('Perangkat tidak dimiliki sesi ini.'), { statusCode: 403, code: 'PERMISSION_DENIED' });
        }
        transaction.set(deviceRef, {
          id: deviceId, userId, role, token,
          platform: typeof platform === 'string' ? platform.slice(0, 30) : 'pwa',
          browser: typeof browser === 'string' ? browser.slice(0, 512) : '',
          deviceName: typeof deviceName === 'string' ? deviceName.slice(0, 128) : 'Browser Device',
          enabled: true, updatedAt: now, lastSeenAt: now,
        }, { merge: true });
      });
      return res.json({ success: true, deviceId });
    } catch (err: any) {
      return res.status(err.statusCode || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.statusCode ? err.message : 'Perangkat belum dapat didaftarkan. Silakan coba kembali.' });
    }
  });

  app.post('/api/notifications/unregister-device', async (req, res) => {
    try {
      const userId = await verifyNotificationDeviceCaller(req);
      const token = req.body?.token;
      if (token !== undefined && token !== '' && (typeof token !== 'string' || !token.trim() || token.length > 8192)) {
        return res.status(400).json({ success: false, code: 'INVALID_DEVICE_TOKEN', message: 'Token perangkat tidak valid.' });
      }
      await ensureServerAuthenticated();
      if (!adminDb) return res.status(500).json({ success: false, code: 'SERVER_UNAVAILABLE', message: 'Database server tidak tersedia.' });

      await adminDb.runTransaction(async (transaction) => {
        let deviceQuery = adminDb.collection('notification_devices').where('userId', '==', userId);
        if (token) deviceQuery = deviceQuery.where('token', '==', token);
        const snap = await transaction.get(deviceQuery);
        const now = new Date().toISOString();
        for (const device of snap.docs) {
          const data = device.data();
          if (data.userId === userId && (!token || data.token === token) && data.enabled !== false) {
            transaction.update(device.ref, { enabled: false, unregisterAt: now });
          }
        }
      });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(err.statusCode || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.statusCode ? err.message : 'Perangkat belum dapat dilepas. Silakan coba kembali.' });
    }
  });

  // Authoritative Google Routes API & Home Service Fee Calculation Endpoint
  app.post('/api/routes/calculate-fee', async (req, res) => {
    try {
      const lat = typeof req.body?.latitude === 'number' ? req.body.latitude : parseFloat(req.body?.latitude);
      const lng = typeof req.body?.longitude === 'number' ? req.body.longitude : parseFloat(req.body?.longitude);

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_COORDINATES',
          error: 'Titik koordinat lokasi tidak valid.',
        });
      }

      // Authoritative Senzu Operational Base coordinates (Palembang Hub)
      const baseLat = SENZU_BASE_LOCATION.lat;
      const baseLng = SENZU_BASE_LOCATION.lng;
      const baseLocation = {
        id: SENZU_BASE_LOCATION.id,
        name: SENZU_BASE_LOCATION.name,
        address: SENZU_BASE_LOCATION.address,
        lat: baseLat,
        lng: baseLng,
      };

      const mapsApiKey = (process.env.VITE_GOOGLE_MAPS_API_KEY || (firebaseConfig as any)?.apiKey || '').trim();
      const referer = (req.headers.referer || req.headers.origin || process.env.APP_URL || 'https://ais-dev-ah37wtgmhu3v7mrkwio4pf-254840792446.asia-southeast1.run.app/').toString();

      if (!mapsApiKey) {
        return res.status(500).json({
          success: false,
          code: 'MAPS_CONFIG_MISSING',
          error: 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.',
        });
      }

      const routesResponse = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': mapsApiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
          'Referer': referer,
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: baseLat, longitude: baseLng } } },
          destination: { location: { latLng: { latitude: lat, longitude: lng } } },
          travelMode: 'DRIVE',
        }),
      });

      const routesData = (await routesResponse.json()) as any;

      if (!routesResponse.ok || !routesData?.routes || !routesData.routes.length) {
        console.warn('[Routes API] Failed to compute route:', routesResponse.status, routesData?.error?.message || routesData);
        return res.status(400).json({
          success: false,
          code: 'ROUTE_CALCULATION_FAILED',
          error: 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.',
        });
      }

      // In protobuf JSON serialization, zero-value fields (such as distanceMeters: 0 when origin == destination)
      // are omitted from the JSON response, producing { duration: '0s' }.
      const rawDistanceMeters = routesData.routes[0]?.distanceMeters;
      const distanceMeters = typeof rawDistanceMeters === 'number' && !isNaN(rawDistanceMeters)
        ? Math.max(0, rawDistanceMeters)
        : (routesData.routes[0]?.duration === '0s' || (Math.abs(lat - baseLat) < 0.0001 && Math.abs(lng - baseLng) < 0.0001) ? 0 : null);

      if (distanceMeters === null) {
        console.warn('[Routes API] Route response missing distanceMeters and not zero-distance:', routesData);
        return res.status(400).json({
          success: false,
          code: 'ROUTE_CALCULATION_FAILED',
          error: 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.',
        });
      }

      const distanceKm = distanceMeters / 1000; // Preserve exact numeric precision

      // Authoritative Home Service Fee Rules (Single source of truth)
      const feeCalc = calculateHomeServiceFee(distanceKm);
      const homeServiceFee = feeCalc.fee;
      const homeServiceFeeTier = feeCalc.tier;
      const tierLabel = feeCalc.tierLabel;
      const isFree = feeCalc.isFree;
      const formattedFee = feeCalc.formattedFee;

      const durationStr = routesData.routes[0].duration || '0s';
      let durationText = '0 mnt';
      if (durationStr.endsWith('s')) {
        const secs = parseInt(durationStr.replace('s', ''), 10);
        if (!isNaN(secs)) {
          durationText = secs === 0 ? '0 mnt' : `${Math.max(1, Math.round(secs / 60))} mnt`;
        }
      }

      res.json({
        success: true,
        distanceMeters,
        distanceKm,
        duration: durationStr,
        durationText,
        homeServiceFee,
        homeServiceFeeTier,
        tierLabel,
        isFree,
        formattedFee,
        baseLocation,
      });
    } catch (err: any) {
      console.error('[Routes API] Server handler error:', err);
      res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.',
      });
    }
  });

  // =============================================================
  // STAGE 7C: AUTHORITATIVE BOOKING TRACKING & STATUS HISTORY READS
  // Finding 6 (Booking Status History READS) & Finding 10 (Guest Tracking Data Protection)
  // =============================================================
  // Process-local in-memory sliding-window rate limiters (scoped to this Node.js process).
  // Anonymous guest lookups and authenticated reads use separate budgets so legitimate
  // authenticated owner/staff/therapist polling on shared IPs never consumes guest quota.
  const BOOKING_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const BOOKING_GUEST_READ_RATE_LIMIT_MAX_PER_IP = 30;
  const BOOKING_AUTH_READ_RATE_LIMIT_MAX_PER_UID = 120;
  const BOOKING_AUTH_READ_RATE_LIMIT_MAX_PER_IP = 300;
  const bookingGuestReadRateLimits = new Map<string, number[]>();
  const bookingAuthUidReadRateLimits = new Map<string, number[]>();
  const bookingAuthIpReadRateLimits = new Map<string, number[]>();

  function consumeSlidingWindowRateLimit(
    store: Map<string, number[]>,
    key: string,
    maxRequests: number,
    windowMs: number,
    nowMs: number
  ): boolean {
    if (store.size > 5000) {
      for (const [k, tsList] of store.entries()) {
        const active = tsList.filter((t) => nowMs - t < windowMs);
        if (active.length === 0) store.delete(k);
        else store.set(k, active);
      }
    }
    const recent = (store.get(key) || []).filter((t) => nowMs - t < windowMs);
    if (recent.length >= maxRequests) {
      store.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    store.set(key, recent);
    return true;
  }

  function normalizeCanonicalTrackingPhone(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (trimmed.length < 8 || trimmed.length > 30) return '';
    // Reject arbitrary letters or symbols before stripping formatting spaces/hyphens
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

  function verifyTrackingPhoneMatch(storedRaw: unknown, inputRaw: unknown): boolean {
    const storedCanonical = normalizeCanonicalTrackingPhone(storedRaw);
    const inputCanonical = normalizeCanonicalTrackingPhone(inputRaw);
    if (!storedCanonical || !inputCanonical) return false;
    const storedDigest = createHash('sha256').update(`phone:${storedCanonical}`).digest();
    const inputDigest = createHash('sha256').update(`phone:${inputCanonical}`).digest();
    return timingSafeEqual(storedDigest, inputDigest);
  }

  function maskGuestCustomerName(rawName: unknown): string {
    if (typeof rawName !== 'string') return 'Pelanggan';
    const cleaned = rawName.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (!cleaned) return 'Pelanggan';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return parts
      .slice(0, 3)
      .map((part) => {
        const firstChar = Array.from(part)[0] || 'P';
        return `${firstChar}***`;
      })
      .join(' ');
  }

  function maskGuestWhatsApp(rawPhone: unknown): string {
    if (typeof rawPhone !== 'string') return '';
    const digits = rawPhone.replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.length <= 6) return `${digits.slice(0, 2)}****`;
    const prefix = digits.slice(0, Math.min(4, Math.max(2, digits.length - 6)));
    const suffix = digits.slice(-2);
    return `${prefix}****${suffix}`;
  }

  function maskGuestAddress(rawAddress: unknown, rawArea: unknown): string {
    const area =
      typeof rawArea === 'string'
        ? rawArea.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
        : '';
    if (area) return `Area ${area} (Alamat disamarkan)`;
    if (typeof rawAddress === 'string' && rawAddress.trim()) {
      return 'Alamat terverifikasi (Disamarkan untuk privasi)';
    }
    return '';
  }

  function getGuestGenericHistoryActorLabel(role: string): string {
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

  const OWNER_ALLOWED_BOOKING_FIELDS: ReadonlyArray<string> = [
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

  const THERAPIST_ALLOWED_BOOKING_FIELDS: ReadonlyArray<string> = [
    ...OWNER_ALLOWED_BOOKING_FIELDS,
    'acceptedBy',
    'arrivalLatitude',
    'arrivalLongitude',
    'earlyCompletion',
  ];

  const STAFF_ALLOWED_BOOKING_FIELDS: ReadonlyArray<string> = [
    ...THERAPIST_ALLOWED_BOOKING_FIELDS,
    'internalNotes',
    'requiresAdminConfirmation',
    'isReassigned',
    'reassignedFromTherapistId',
    'referredByCustomerId',
    'referralCodeUsed',
    'issueReport',
  ];

  function projectAllowedBookingFields(
    rawBooking: Record<string, any>,
    allowedKeys: ReadonlyArray<string>,
    overrides: Record<string, any>
  ): Record<string, any> {
    const projected: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(rawBooking, key) && rawBooking[key] !== undefined) {
        projected[key] = rawBooking[key];
      }
    }
    return {
      ...projected,
      ...overrides,
    };
  }

  const executeAuthoritativeBookingRead = async (
    req: express.Request,
    res: express.Response,
    mode: 'track' | 'history'
  ) => {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store');
    } else if (typeof (res as any).set === 'function') {
      (res as any).set('Cache-Control', 'no-store');
    }

    const snapExists = (snap: any): boolean =>
      Boolean(snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists));

    const textId = (value: unknown): string =>
      typeof value === 'string' ? value.trim() : '';

    const sanitizeText = (value: unknown, maxLen = 250): string =>
      typeof value === 'string'
        ? value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen)
        : '';

    const ALLOWED_BOOKING_STATUSES = new Set<string>([
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

    const ALLOWED_HISTORY_ROLES = new Set<string>([
      'customer',
      'css',
      'supervisor',
      'therapist',
      'system',
      'manager',
      'admin',
    ]);

    const GENERIC_GUEST_DENIAL_MESSAGE =
      'Data reservasi tidak ditemukan atau informasi pelacakan tidak sesuai.';

    try {
      // 1. Resolve client IP from Express req.ip (never raw caller-supplied X-Forwarded-For)
      const rawIp =
        (typeof req.ip === 'string' && req.ip.trim() ? req.ip.trim() : '') ||
        (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress.trim()
          ? req.socket.remoteAddress.trim()
          : '') ||
        'unknown';
      const clientIp = rawIp.slice(0, 128) || 'unknown';
      const nowMs = Date.now();

      // 2. Detect authentication header presence independently of its non-empty value
      const headersObj =
        req.headers && typeof req.headers === 'object'
          ? (req.headers as Record<string, unknown>)
          : {};
      let rawAuthHeader: unknown = undefined;
      let rawCustomAuthHeader: unknown = undefined;
      let hasAuthHeaderKey = false;
      for (const [hdrKey, hdrVal] of Object.entries(headersObj)) {
        const lowerKey = hdrKey.toLowerCase();
        if (lowerKey === 'authorization') {
          hasAuthHeaderKey = true;
          rawAuthHeader = hdrVal;
        } else if (lowerKey === 'x-firebase-auth') {
          hasAuthHeaderKey = true;
          rawCustomAuthHeader = hdrVal;
        }
      }

      if (!hasAuthHeaderKey) {
        if (
          !consumeSlidingWindowRateLimit(
            bookingGuestReadRateLimits,
            clientIp,
            BOOKING_GUEST_READ_RATE_LIMIT_MAX_PER_IP,
            BOOKING_READ_RATE_LIMIT_WINDOW_MS,
            nowMs
          )
        ) {
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMITED',
            error: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
            message: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
          });
        }

        // History read endpoints are strictly authenticated-only; guests must use /api/bookings/track
        if (mode === 'history') {
          return res.status(401).json({
            success: false,
            code: 'AUTH_REQUIRED',
            error: 'Autentikasi diperlukan untuk mengakses riwayat status pesanan.',
            message: 'Autentikasi diperlukan untuk mengakses riwayat status pesanan.',
          });
        }
      }

      // 3. If an authentication header key is present, validate and verify token BEFORE any DB read
      // Never downgrade a present-but-blank/malformed/invalid Authorization header to guest mode.
      let verifiedUid = '';
      if (hasAuthHeaderKey) {
        if (rawCustomAuthHeader !== undefined && rawAuthHeader === undefined) {
          if (
            !consumeSlidingWindowRateLimit(
              bookingGuestReadRateLimits,
              clientIp,
              BOOKING_GUEST_READ_RATE_LIMIT_MAX_PER_IP,
              BOOKING_READ_RATE_LIMIT_WINDOW_MS,
              nowMs
            )
          ) {
            return res.status(429).json({
              success: false,
              code: 'RATE_LIMITED',
              error: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
              message: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
            });
          }
          return res.status(401).json({
            success: false,
            code: 'AUTH_TOKEN_INVALID',
            error: 'Header autentikasi tidak valid.',
            message: 'Header autentikasi tidak valid.',
          });
        }

        const tokenMatch =
          typeof rawAuthHeader === 'string'
            ? /^Bearer\s+(\S+)$/i.exec(rawAuthHeader.trim())
            : null;
        if (!tokenMatch || !tokenMatch[1]) {
          if (
            !consumeSlidingWindowRateLimit(
              bookingGuestReadRateLimits,
              clientIp,
              BOOKING_GUEST_READ_RATE_LIMIT_MAX_PER_IP,
              BOOKING_READ_RATE_LIMIT_WINDOW_MS,
              nowMs
            )
          ) {
            return res.status(429).json({
              success: false,
              code: 'RATE_LIMITED',
              error: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
              message: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
            });
          }
          return res.status(401).json({
            success: false,
            code: 'AUTH_REQUIRED',
            error: 'Token autentikasi tidak valid. Silakan masuk kembali.',
            message: 'Token autentikasi tidak valid. Silakan masuk kembali.',
          });
        }

        if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
          return res.status(503).json({
            success: false,
            code: 'AUTH_SERVICE_UNAVAILABLE',
            error: 'Layanan verifikasi otentikasi sedang tidak tersedia.',
            message: 'Layanan verifikasi otentikasi sedang tidak tersedia.',
          });
        }

        try {
          const decoded = await adminAuth.verifyIdToken(tokenMatch[1]);
          if (
            !decoded ||
            typeof decoded.uid !== 'string' ||
            !isValidBookingHistoryDocId(decoded.uid, 128)
          ) {
            return res.status(401).json({
              success: false,
              code: 'AUTH_TOKEN_INVALID',
              error: 'Identitas sesi autentikasi tidak valid.',
              message: 'Identitas sesi autentikasi tidak valid.',
            });
          }
          verifiedUid = decoded.uid;
        } catch (authErr: any) {
          const errCode = String(authErr?.code || '');
          const errMsg = String(authErr?.message || '');
          const isInfraError =
            errCode === 'auth/internal-error' ||
            errCode === 'auth/network-request-failed' ||
            errCode === 'unavailable' ||
            errCode === 'deadline-exceeded' ||
            authErr?.status === 503 ||
            authErr?.statusCode === 503 ||
            /unavailable|network|econnrefused|enotfound|etimedout|eai_again|socket hang up|fetch failed|deadline|internal-error|503/i.test(
              `${errCode} ${errMsg}`
            );
          if (isInfraError) {
            return res.status(503).json({
              success: false,
              code: 'AUTH_SERVICE_UNAVAILABLE',
              error: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
              message: 'Layanan verifikasi otentikasi sedang mengalami kendala.',
            });
          }
          if (
            !consumeSlidingWindowRateLimit(
              bookingGuestReadRateLimits,
              clientIp,
              BOOKING_GUEST_READ_RATE_LIMIT_MAX_PER_IP,
              BOOKING_READ_RATE_LIMIT_WINDOW_MS,
              nowMs
            )
          ) {
            return res.status(429).json({
              success: false,
              code: 'RATE_LIMITED',
              error: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
              message: 'Terlalu banyak permintaan pelacakan pesanan. Silakan coba kembali setelah beberapa saat.',
            });
          }
          return res.status(401).json({
            success: false,
            code: errCode === 'auth/id-token-expired' ? 'SESSION_EXPIRED' : 'AUTH_TOKEN_INVALID',
            error: 'Sesi autentikasi tidak valid atau telah berakhir.',
            message: 'Sesi autentikasi tidak valid atau telah berakhir.',
          });
        }

        // Charge authenticated per-UID and shared-IP rate limits (separate from guest bucket)
        const uidAllowed = consumeSlidingWindowRateLimit(
          bookingAuthUidReadRateLimits,
          verifiedUid,
          BOOKING_AUTH_READ_RATE_LIMIT_MAX_PER_UID,
          BOOKING_READ_RATE_LIMIT_WINDOW_MS,
          nowMs
        );
        const sharedIpAllowed = consumeSlidingWindowRateLimit(
          bookingAuthIpReadRateLimits,
          clientIp,
          BOOKING_AUTH_READ_RATE_LIMIT_MAX_PER_IP,
          BOOKING_READ_RATE_LIMIT_WINDOW_MS,
          nowMs
        );
        if (!uidAllowed || !sharedIpAllowed) {
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMITED',
            error: 'Terlalu banyak permintaan pembacaan pesanan. Silakan coba kembali setelah beberapa saat.',
            message: 'Terlalu banyak permintaan pembacaan pesanan. Silakan coba kembali setelah beberapa saat.',
          });
        }
      }

      // 4. Validate query/body parameters BEFORE any database read
      if (req.method === 'POST') {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_PAYLOAD',
            error: 'Format permintaan tidak valid.',
            message: 'Format permintaan tidak valid.',
          });
        }
        const allowedBodyKeys = new Set([
          'code',
          'bookingCode',
          'bookingId',
          'id',
          'target',
          'phone',
          'customerWhatsApp',
          'whatsapp',
        ]);
        for (const k of Object.keys(req.body)) {
          if (!allowedBodyKeys.has(k)) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_PAYLOAD_FIELDS',
              error: 'Permintaan mengandung atribut yang tidak diizinkan.',
              message: 'Permintaan mengandung atribut yang tidak diizinkan.',
            });
          }
        }
      }

      const pickParam = (...candidates: unknown[]): unknown => {
        for (const c of candidates) {
          if (c !== undefined && c !== null && c !== '') return c;
        }
        return undefined;
      };

      const rawCodeParam = pickParam(
        req.query?.code,
        req.query?.bookingCode,
        req.body?.code,
        req.body?.bookingCode
      );
      const rawTargetParam = pickParam(req.query?.target, req.body?.target);
      const rawBookingIdParam = pickParam(
        req.params?.bookingId,
        req.query?.bookingId,
        req.query?.id,
        req.body?.bookingId,
        req.body?.id
      );
      const rawPhoneParam = pickParam(
        req.query?.phone,
        req.query?.customerWhatsApp,
        req.query?.whatsapp,
        req.body?.phone,
        req.body?.customerWhatsApp,
        req.body?.whatsapp
      );

      let explicitBookingId = '';
      let explicitBookingCode = '';
      let singleReference = '';

      if (rawBookingIdParam !== undefined) {
        if (
          typeof rawBookingIdParam !== 'string' ||
          rawBookingIdParam.trim() !== rawBookingIdParam ||
          !isValidBookingHistoryDocId(rawBookingIdParam, 128)
        ) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_ID',
            error: 'ID pesanan tidak valid.',
            message: 'ID pesanan tidak valid.',
          });
        }
        explicitBookingId = rawBookingIdParam;
      }

      if (rawTargetParam !== undefined) {
        if (
          typeof rawTargetParam !== 'string' ||
          rawTargetParam.trim() !== rawTargetParam ||
          !isValidBookingHistoryDocId(rawTargetParam, 128)
        ) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_CODE',
            error: 'Referensi pesanan tidak valid.',
            message: 'Referensi pesanan tidak valid.',
          });
        }
        singleReference = rawTargetParam;
      }

      if (rawCodeParam !== undefined) {
        if (
          typeof rawCodeParam !== 'string' ||
          rawCodeParam.trim() !== rawCodeParam ||
          !isValidBookingHistoryDocId(rawCodeParam, 128)
        ) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_CODE',
            error: 'Kode booking tidak valid.',
            message: 'Kode booking tidak valid.',
          });
        }

        if (!verifiedUid) {
          // Guest tracking requires a valid booking code
          const upper = rawCodeParam.toUpperCase();
          if (upper.startsWith('BK_') || !isValidBookingHistoryCode(upper, 64)) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_BOOKING_CODE',
              error: 'Kode booking tidak valid.',
              message: 'Kode booking tidak valid.',
            });
          }
          explicitBookingCode = upper;
        } else if (explicitBookingId) {
          // Both bookingId and bookingCode were explicitly supplied
          const upper = rawCodeParam.toUpperCase();
          if (upper.startsWith('BK_') || !isValidBookingHistoryCode(upper, 64)) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_BOOKING_CODE',
              error: 'Kode booking tidak valid.',
              message: 'Kode booking tidak valid.',
            });
          }
          explicitBookingCode = upper;
        } else {
          // Single reference supplied via code/bookingCode by an authenticated caller:
          // may be an exact document ID (bk_... or arbitrary non-bk_ doc ID) or a bookingCode
          if (singleReference && singleReference !== rawCodeParam) {
            return res.status(400).json({
              success: false,
              code: 'BOOKING_CODE_MISMATCH',
              error: 'Referensi pesanan tidak konsisten.',
              message: 'Referensi pesanan tidak konsisten.',
            });
          }
          singleReference = rawCodeParam;
        }
      }

      if (!verifiedUid && !explicitBookingCode && singleReference) {
        const upper = singleReference.toUpperCase();
        if (upper.startsWith('BK_') || !isValidBookingHistoryCode(upper, 64)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_BOOKING_CODE',
            error: 'Kode booking tidak valid.',
            message: 'Kode booking tidak valid.',
          });
        }
        explicitBookingCode = upper;
      }

      if (
        explicitBookingId &&
        explicitBookingCode &&
        explicitBookingId.startsWith('bk_') &&
        explicitBookingId.slice(3).toUpperCase() !== explicitBookingCode
      ) {
        return res.status(400).json({
          success: false,
          code: 'BOOKING_CODE_MISMATCH',
          error: 'Kode booking tidak sesuai dengan ID pesanan.',
          message: 'Kode booking tidak sesuai dengan ID pesanan.',
        });
      }

      if (!explicitBookingId && !explicitBookingCode && !singleReference) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BOOKING_CODE',
          error: 'Kode booking wajib diisi.',
          message: 'Kode booking wajib diisi.',
        });
      }

      let cleanCanonicalPhone = '';
      if (rawPhoneParam !== undefined && rawPhoneParam !== null && rawPhoneParam !== '') {
        cleanCanonicalPhone = normalizeCanonicalTrackingPhone(rawPhoneParam);
        if (!cleanCanonicalPhone) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_PHONE',
            error: 'Nomor WhatsApp tidak valid.',
            message: 'Nomor WhatsApp tidak valid.',
          });
        }
      }

      if (!verifiedUid) {
        // Unauthenticated Guest: booking code + valid phone are both mandatory
        if (!explicitBookingCode || !cleanCanonicalPhone || explicitBookingId) {
          return res.status(400).json({
            success: false,
            code: 'PHONE_REQUIRED',
            error: 'Kode booking dan minimal 8 digit Nomor WhatsApp wajib diisi untuk pelacakan tamu.',
            message: 'Kode booking dan minimal 8 digit Nomor WhatsApp wajib diisi untuk pelacakan tamu.',
          });
        }
      }

      if (!adminDb || typeof adminDb.runTransaction !== 'function') {
        return res.status(503).json({
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: 'Database server sedang tidak tersedia.',
          message: 'Database server sedang tidak tersedia.',
        });
      }

      // 5. Authoritative Read-Only Transaction via Firebase Admin SDK
      const txResult: any = await adminDb.runTransaction(async (transaction: any) => {
        const guestGenericDenial = () => ({
          status: 404,
          code: 'BOOKING_NOT_FOUND',
          message: GENERIC_GUEST_DENIAL_MESSAGE,
        });

        const candidateDocIds = new Set<string>();
        let candidateCodeQuery = '';

        if (explicitBookingId) {
          candidateDocIds.add(explicitBookingId);
          if (explicitBookingCode) {
            candidateCodeQuery = explicitBookingCode;
          } else if (explicitBookingId.startsWith('bk_')) {
            const derived = explicitBookingId.slice(3).toUpperCase();
            if (isValidBookingHistoryCode(derived, 64)) {
              candidateCodeQuery = derived;
            }
          }
        } else if (explicitBookingCode) {
          const bkId = `bk_${explicitBookingCode}`;
          if (isValidBookingHistoryDocId(bkId, 128)) {
            candidateDocIds.add(bkId);
          }
          candidateCodeQuery = explicitBookingCode;
        } else if (singleReference) {
          if (isValidBookingHistoryDocId(singleReference, 128)) {
            candidateDocIds.add(singleReference);
          }
          if (singleReference.startsWith('bk_')) {
            const derived = singleReference.slice(3).toUpperCase();
            if (isValidBookingHistoryCode(derived, 64)) {
              candidateCodeQuery = derived;
            }
          } else {
            const upper = singleReference.toUpperCase();
            if (isValidBookingHistoryCode(upper, 64)) {
              candidateCodeQuery = upper;
              const bkId = `bk_${upper}`;
              if (isValidBookingHistoryDocId(bkId, 128)) {
                candidateDocIds.add(bkId);
              }
            }
          }
        }

        const docIdArray = [...candidateDocIds];
        const [docSnaps, initialCodeSnap] = await Promise.all([
          Promise.all(
            docIdArray.map((docId) =>
              transaction.get(adminDb.collection('bookings').doc(docId))
            )
          ),
          candidateCodeQuery
            ? transaction.get(
                adminDb
                  .collection('bookings')
                  .where('bookingCode', '==', candidateCodeQuery)
                  .limit(2)
              )
            : Promise.resolve(null),
        ]);

        const matchedBookings = new Map<string, any>();
        for (const s of docSnaps) {
          if (snapExists(s)) {
            matchedBookings.set(s.id, s);
          }
        }
        for (const d of initialCodeSnap?.docs || []) {
          if (snapExists(d)) {
            matchedBookings.set(d.id, d);
          }
        }

        if (matchedBookings.size === 0) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 404,
                code: 'BOOKING_NOT_FOUND',
                message: 'Data reservasi tidak ditemukan.',
              };
        }

        if (matchedBookings.size > 1) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 409,
                code: 'BOOKING_CODE_CONFLICT',
                message: 'Kode pesanan merujuk pada lebih dari satu dokumen pesanan.',
              };
        }

        const bookingSnap = [...matchedBookings.values()][0];
        const resolvedBookingId = bookingSnap.id;
        const bookingData = bookingSnap.data() || {};

        if (!isValidBookingHistoryDocId(resolvedBookingId, 128)) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 409,
                code: 'BOOKING_RECORD_CONFLICT',
                message: 'ID dokumen pesanan tidak valid.',
              };
        }

        if (explicitBookingId && resolvedBookingId !== explicitBookingId) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 409,
                code: 'BOOKING_CODE_CONFLICT',
                message: 'ID pesanan tidak sesuai dengan dokumen yang ditemukan.',
              };
        }

        if (
          bookingData.id !== undefined &&
          bookingData.id !== null &&
          bookingData.id !== '' &&
          (typeof bookingData.id !== 'string' || bookingData.id !== resolvedBookingId)
        ) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 409,
                code: 'BOOKING_RECORD_CONFLICT',
                message: 'Identitas internal dokumen pesanan tidak konsisten.',
              };
        }

        const resolvedBookingCode = textId(bookingData.bookingCode).toUpperCase();
        if (!isValidBookingHistoryCode(resolvedBookingCode, 64)) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 409,
                code: 'BOOKING_RECORD_CONFLICT',
                message: 'Kode booking pada dokumen pesanan tidak valid.',
              };
        }

        if (explicitBookingCode && resolvedBookingCode !== explicitBookingCode) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 403,
                code: 'BOOKING_CODE_MISMATCH',
                message: 'Kode booking tidak sesuai dengan dokumen pesanan.',
              };
        }

        if (
          singleReference &&
          singleReference !== resolvedBookingId &&
          singleReference !== `bk_${resolvedBookingCode}` &&
          singleReference.toUpperCase() !== resolvedBookingCode
        ) {
          return !verifiedUid
            ? guestGenericDenial()
            : {
                status: 409,
                code: 'BOOKING_CODE_CONFLICT',
                message: 'Referensi pesanan tidak sesuai dengan dokumen yang ditemukan.',
              };
        }

        // When a document ID resolved the booking and its resolvedBookingCode was not yet queried,
        // prove resolvedBookingCode is unique across bookings before merging code-based history.
        if (resolvedBookingCode !== candidateCodeQuery) {
          const codeUniquenessSnap = await transaction.get(
            adminDb
              .collection('bookings')
              .where('bookingCode', '==', resolvedBookingCode)
              .limit(2)
          );
          for (const d of codeUniquenessSnap?.docs || []) {
            if (snapExists(d) && d.id !== resolvedBookingId) {
              return !verifiedUid
                ? guestGenericDenial()
                : {
                    status: 409,
                    code: 'BOOKING_CODE_CONFLICT',
                    message: 'Kode pesanan merujuk pada lebih dari satu dokumen pesanan.',
                  };
            }
          }
        }

        let accessLevel: 'staff' | 'therapist' | 'owner' | 'guest' = 'guest';

        if (verifiedUid) {
          const hasUidConflict = (record: any): boolean =>
            [record?.authUserId, record?.authUid].some(
              (value) =>
                value != null &&
                value !== '' &&
                (typeof value !== 'string' ||
                  value.trim() !== value ||
                  !isValidBookingHistoryDocId(value, 128) ||
                  value !== verifiedUid)
            );

          const isStaffDisabled = (record: any): boolean =>
            !record ||
            record.isActive === false ||
            record.loginEnabled === false ||
            [
              'INACTIVE',
              'DISABLED',
              'ARCHIVED',
              'DINONAKTIFKAN',
              'DELETED',
              'TERMINATED',
              'SUSPENDED',
            ].includes(textId(record.status).toUpperCase()) ||
            textId(record.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';

          const roleRef = adminDb.collection('staff_roles').doc(verifiedUid);
          const canonicalStaffQuery = adminDb
            .collection('staff_users')
            .where('authUserId', '==', verifiedUid)
            .limit(2);
          const legacyStaffQuery = adminDb
            .collection('staff_users')
            .where('authUid', '==', verifiedUid)
            .limit(2);
          const directStaffRef = adminDb.collection('staff_users').doc(verifiedUid);

          const [roleSnap, canonicalStaffSnap, legacyStaffSnap, directStaffSnap] =
            await Promise.all([
              transaction.get(roleRef),
              transaction.get(canonicalStaffQuery),
              transaction.get(legacyStaffQuery),
              transaction.get(directStaffRef),
            ]);

          const staffDocs = new Map<string, any>();
          for (const d of [
            ...(canonicalStaffSnap?.docs || []),
            ...(legacyStaffSnap?.docs || []),
          ]) {
            if (snapExists(d)) staffDocs.set(d.id, d);
          }
          if (snapExists(directStaffSnap)) {
            staffDocs.set(directStaffSnap.id, directStaffSnap);
          }

          const roleExists = snapExists(roleSnap);
          if (roleExists) {
            const roleData = roleSnap.data() || {};
            for (const linked of [roleData.staffId, roleData.staffUserId]) {
              if (
                typeof linked === 'string' &&
                isValidBookingHistoryDocId(linked, 128) &&
                !staffDocs.has(linked)
              ) {
                const linkedSnap = await transaction.get(
                  adminDb.collection('staff_users').doc(linked)
                );
                if (snapExists(linkedSnap)) {
                  staffDocs.set(linkedSnap.id, linkedSnap);
                }
              }
            }
          }

          const hasStaffFootprint = staffDocs.size > 0 || roleExists;

          if (hasStaffFootprint) {
            if (staffDocs.size === 0 || !roleExists) {
              return {
                status: 403,
                code: 'STAFF_AUTHORIZATION_DENIED',
                message: 'Identitas staf belum terikat atau tidak memiliki otorisasi aktif.',
              };
            }
            if (staffDocs.size > 1) {
              return {
                status: 403,
                code: 'STAFF_DUPLICATE_MAPPING',
                message: 'Identitas staf memiliki duplikasi pemetaan pada Staff Master.',
              };
            }

            const staffSnap = [...staffDocs.values()][0];
            const staff = staffSnap.data() || {};
            const role = roleSnap.data() || {};

            if (hasUidConflict(staff) || hasUidConflict(role)) {
              return {
                status: 403,
                code: 'STAFF_UID_MISMATCH',
                message: 'Identitas UID staf tidak sesuai dengan sesi autentikasi.',
              };
            }

            const isUidBound =
              staffSnap.id === verifiedUid ||
              (typeof staff.authUserId === 'string' && staff.authUserId === verifiedUid) ||
              (typeof staff.authUid === 'string' && staff.authUid === verifiedUid);
            if (!isUidBound) {
              return {
                status: 403,
                code: 'STAFF_UID_UNBOUND',
                message: 'Profil Staff Master tidak terikat pada UID sesi saat ini.',
              };
            }

            if (
              isStaffDisabled(staff) ||
              isStaffDisabled(role) ||
              role.isActive !== true
            ) {
              return {
                status: 403,
                code: 'STAFF_INACTIVE',
                message: 'Akun staf sedang tidak aktif atau telah dinonaktifkan.',
              };
            }

            const staffRole = textId(staff.role);
            const activeRole = textId(role.role);
            if (
              !staffRole ||
              staff.role !== staffRole ||
              role.role !== activeRole ||
              activeRole !== staffRole
            ) {
              return {
                status: 403,
                code: 'STAFF_ROLE_MISMATCH',
                message: 'Role staf tidak sesuai dengan Staff Master saat ini.',
              };
            }

            for (const aliasField of [staff.uid, staff.id]) {
              if (aliasField !== undefined && aliasField !== null && aliasField !== '') {
                if (
                  typeof aliasField !== 'string' ||
                  !isValidBookingHistoryDocId(aliasField, 128)
                ) {
                  return {
                    status: 403,
                    code: 'STAFF_ROLE_MAPPING_CONFLICT',
                    message: 'Alias identitas Staff Master tidak valid.',
                  };
                }
              }
            }

            const aliases = new Set(
              [verifiedUid, staffSnap.id, textId(staff.uid), textId(staff.id)].filter(Boolean)
            );
            for (const linkedId of [role.staffId, role.staffUserId]) {
              if (linkedId !== undefined && linkedId !== null && linkedId !== '') {
                if (
                  typeof linkedId !== 'string' ||
                  !isValidBookingHistoryDocId(linkedId, 128) ||
                  !aliases.has(linkedId)
                ) {
                  return {
                    status: 403,
                    code: 'STAFF_ROLE_MAPPING_CONFLICT',
                    message: 'Referensi Staff Master pada staff_roles tidak sesuai.',
                  };
                }
              }
            }

            if (['css', 'supervisor', 'manager', 'admin'].includes(staffRole)) {
              accessLevel = 'staff';
            } else if (staffRole === 'therapist') {
              const masterTherapistId = textId(staff.therapistId);
              const roleTherapistId = textId(role.therapistId);
              for (const rawThId of [staff.therapistId, role.therapistId]) {
                if (rawThId !== undefined && rawThId !== null && rawThId !== '') {
                  if (
                    typeof rawThId !== 'string' ||
                    !isValidBookingHistoryDocId(rawThId, 128)
                  ) {
                    return {
                      status: 403,
                      code: 'STAFF_ROLE_MAPPING_CONFLICT',
                      message: 'ID terapis pada Staff Master atau staff_roles tidak valid.',
                    };
                  }
                }
              }
              const resolvedTherapistId =
                masterTherapistId || roleTherapistId || textId(staff.uid) || staffSnap.id;
              if (!isValidBookingHistoryDocId(resolvedTherapistId, 128)) {
                return {
                  status: 403,
                  code: 'PERMISSION_DENIED',
                  message: 'Identitas terapis tidak valid.',
                };
              }
              const therapistDocSnap = await transaction.get(
                adminDb.collection('therapists').doc(resolvedTherapistId)
              );
              const therapistData = snapExists(therapistDocSnap)
                ? therapistDocSnap.data() || {}
                : null;
              if (therapistData) {
                if (isStaffDisabled(therapistData)) {
                  return {
                    status: 403,
                    code: 'STAFF_INACTIVE',
                    message: 'Akun terapis sedang tidak aktif.',
                  };
                }
                if (
                  hasUidConflict(therapistData) ||
                  (therapistData.staffId != null &&
                    therapistData.staffId !== '' &&
                    (typeof therapistData.staffId !== 'string' ||
                      !aliases.has(textId(therapistData.staffId)))) ||
                  (therapistData.id != null &&
                    therapistData.id !== '' &&
                    (typeof therapistData.id !== 'string' ||
                      textId(therapistData.id) !== resolvedTherapistId))
                ) {
                  return {
                    status: 403,
                    code: 'STAFF_ROLE_MAPPING_CONFLICT',
                    message: 'Profil terapis mengalami konflik identitas.',
                  };
                }
              }
              const trustedTherapistIds = new Set([...aliases, resolvedTherapistId]);
              if (roleTherapistId && !trustedTherapistIds.has(roleTherapistId)) {
                return {
                  status: 403,
                  code: 'STAFF_ROLE_MAPPING_CONFLICT',
                  message: 'ID terapis pada staff_roles tidak sesuai dengan Staff Master.',
                };
              }

              for (const rawAssign of [
                bookingData.therapistId,
                bookingData.assignedTherapistId,
              ]) {
                if (rawAssign !== undefined && rawAssign !== null && rawAssign !== '') {
                  if (
                    typeof rawAssign !== 'string' ||
                    !isValidBookingHistoryDocId(rawAssign, 128)
                  ) {
                    return {
                      status: 403,
                      code: 'PERMISSION_DENIED',
                      message: 'Atribut penugasan terapis pada pesanan tidak valid.',
                    };
                  }
                }
              }
              const assignedIds = [
                textId(bookingData.therapistId),
                textId(bookingData.assignedTherapistId),
              ].filter(Boolean);
              if (
                !assignedIds.length ||
                assignedIds.some((id) => !trustedTherapistIds.has(id))
              ) {
                return {
                  status: 403,
                  code: 'PERMISSION_DENIED',
                  message: 'Pesanan ini tidak ditugaskan kepada terapis aktif saat ini.',
                };
              }
              accessLevel = 'therapist';
            } else {
              return {
                status: 403,
                code: 'PERMISSION_DENIED',
                message: 'Peran staf tidak memiliki wewenang membaca data pelacakan pesanan.',
              };
            }
          } else {
            // Non-staff authenticated caller (Customer): require verified non-conflicting UID ownership
            for (const rawOwnerField of [
              bookingData.customerAuthUid,
              bookingData.authUserId,
              bookingData.customerUid,
              bookingData.userId,
              bookingData.uid,
            ]) {
              if (rawOwnerField !== undefined && rawOwnerField !== null && rawOwnerField !== '') {
                if (
                  typeof rawOwnerField !== 'string' ||
                  rawOwnerField.trim() !== rawOwnerField ||
                  !isValidBookingHistoryDocId(rawOwnerField, 128)
                ) {
                  return {
                    status: 403,
                    code: 'BOOKING_OWNERSHIP_MALFORMED',
                    message: 'Atribut kepemilikan pesanan tidak valid.',
                  };
                }
              }
            }

            const bookingCustomerAuthUid = textId(bookingData.customerAuthUid);
            const bookingAuthUserId = textId(bookingData.authUserId);
            const legacyCustomerUid = textId(bookingData.customerUid);
            const legacyUserId = textId(bookingData.userId);
            const legacyUid = textId(bookingData.uid);

            if (!bookingCustomerAuthUid && !bookingAuthUserId) {
              return {
                status: 403,
                code: 'BOOKING_OWNERSHIP_MISSING',
                message: 'Pesanan tidak memiliki ikatan UID pelanggan terotentikasi.',
              };
            }

            const presentOwnerUids = new Set(
              [
                bookingCustomerAuthUid,
                bookingAuthUserId,
                legacyCustomerUid,
                legacyUserId,
                legacyUid,
              ].filter(Boolean)
            );
            if (presentOwnerUids.size > 1) {
              return {
                status: 403,
                code: 'BOOKING_OWNERSHIP_CONFLICT',
                message: 'Kepemilikan UID pesanan mengalami konflik.',
              };
            }

            if (!presentOwnerUids.has(verifiedUid)) {
              return {
                status: 403,
                code: 'FOREIGN_BOOKING',
                message: 'Akses ke pesanan pelanggan lain ditolak.',
              };
            }

            const rawBookingCustId = bookingData.customerId;
            let bookingCustomerId = '';
            if (rawBookingCustId !== undefined && rawBookingCustId !== null && rawBookingCustId !== '') {
              if (
                typeof rawBookingCustId !== 'string' ||
                rawBookingCustId.trim() !== rawBookingCustId ||
                !isValidBookingHistoryDocId(rawBookingCustId, 128)
              ) {
                return {
                  status: 403,
                  code: 'BOOKING_OWNERSHIP_MALFORMED',
                  message: 'ID pelanggan pada pesanan tidak valid.',
                };
              }
              bookingCustomerId = rawBookingCustId;
              if (
                bookingCustomerId.startsWith('cust_u_') &&
                bookingCustomerId !== `cust_u_${verifiedUid}` &&
                bookingCustomerId !== `cust_u_${verifiedUid.slice(0, 10)}`
              ) {
                return {
                  status: 403,
                  code: 'FOREIGN_CUSTOMER_PROFILE',
                  message: 'ID profil pelanggan pada pesanan tidak sesuai dengan sesi.',
                };
              }
            }

            const custByAuthUserQuery = adminDb
              .collection('customers')
              .where('authUserId', '==', verifiedUid)
              .limit(2);
            const custByCanonicalQuery = adminDb
              .collection('customers')
              .where('customerAuthUid', '==', verifiedUid)
              .limit(2);
            const [custByAuthUserSnap, custByCanonicalSnap, targetBookingCustSnap] =
              await Promise.all([
                transaction.get(custByAuthUserQuery),
                transaction.get(custByCanonicalQuery),
                bookingCustomerId
                  ? transaction.get(adminDb.collection('customers').doc(bookingCustomerId))
                  : Promise.resolve(null),
              ]);

            const ownedProfiles = new Map<string, any>();
            for (const d of [
              ...(custByAuthUserSnap?.docs || []),
              ...(custByCanonicalSnap?.docs || []),
            ]) {
              if (snapExists(d)) ownedProfiles.set(d.id, d);
            }

            if (ownedProfiles.size > 1) {
              return {
                status: 403,
                code: 'CUSTOMER_OWNERSHIP_CONFLICT',
                message: 'Kepemilikan profil pelanggan tidak unik atau mengalami konflik.',
              };
            }

            const profilesToValidate = new Map<string, any>(ownedProfiles);
            if (snapExists(targetBookingCustSnap)) {
              profilesToValidate.set(targetBookingCustSnap.id, targetBookingCustSnap);
            }

            if (
              ownedProfiles.size === 1 &&
              bookingCustomerId &&
              snapExists(targetBookingCustSnap) &&
              !ownedProfiles.has(bookingCustomerId)
            ) {
              const targetCustData = targetBookingCustSnap.data() || {};
              if (
                targetCustData.authUserId != null ||
                targetCustData.customerAuthUid != null ||
                bookingCustomerId.startsWith('cust_u_')
              ) {
                return {
                  status: 403,
                  code: 'CUSTOMER_OWNERSHIP_CONFLICT',
                  message: 'Profil pelanggan pada pesanan tidak sesuai dengan profil akun aktif.',
                };
              }
            }

            for (const [profId, profSnap] of profilesToValidate.entries()) {
              const profile = profSnap.data() || {};
              if (
                profile.id !== undefined &&
                profile.id !== null &&
                profile.id !== '' &&
                (typeof profile.id !== 'string' || profile.id !== profId)
              ) {
                return {
                  status: 403,
                  code: 'CUSTOMER_OWNERSHIP_MALFORMED',
                  message: 'Identitas profil pelanggan tidak sesuai.',
                };
              }
              for (const rawProfUid of [profile.authUserId, profile.customerAuthUid]) {
                if (rawProfUid !== undefined && rawProfUid !== null && rawProfUid !== '') {
                  if (
                    typeof rawProfUid !== 'string' ||
                    rawProfUid.trim() !== rawProfUid ||
                    !isValidBookingHistoryDocId(rawProfUid, 128) ||
                    rawProfUid !== verifiedUid
                  ) {
                    return {
                      status: 403,
                      code: 'CUSTOMER_OWNERSHIP_CONFLICT',
                      message: 'Atribut kepemilikan profil pelanggan mengalami konflik.',
                    };
                  }
                }
              }
              const acctType = textId(profile.accountType).toUpperCase();
              const acctStatus = textId(profile.accountStatus).toUpperCase();
              const profStatus = textId(profile.status).toUpperCase();
              const crmStatus = textId(profile.crmStatus).toLowerCase();
              const custStatus = textId(profile.customerStatus).toLowerCase();

              if (
                (acctType && acctType !== 'CUSTOMER') ||
                acctStatus === 'DISABLED' ||
                acctStatus === 'NOT_REGISTERED' ||
                acctStatus === 'INACTIVE' ||
                [
                  'DISABLED',
                  'INACTIVE',
                  'ARCHIVED',
                  'BLOCKED',
                  'DELETED',
                  'DELETION_REQUESTED',
                ].includes(profStatus) ||
                ['archived', 'blocked'].includes(crmStatus) ||
                ['archived', 'blocked'].includes(custStatus)
              ) {
                return {
                  status: 403,
                  code: 'CUSTOMER_PROFILE_INACTIVE',
                  message: 'Profil pelanggan sedang tidak aktif atau tidak memenuhi syarat.',
                };
              }
            }

            if (
              cleanCanonicalPhone &&
              !verifyTrackingPhoneMatch(bookingData.customerWhatsApp, cleanCanonicalPhone)
            ) {
              return {
                status: 403,
                code: 'PHONE_MISMATCH',
                message: 'Nomor WhatsApp tidak cocok dengan data reservasi.',
              };
            }

            accessLevel = 'owner';
          }
        } else {
          // Unauthenticated Guest: strictly restricted to unowned guest bookings with verified phone.
          // All lookup/ownership/phone denials normalize to the identical generic response (A5).
          for (const ownerField of [
            bookingData.customerAuthUid,
            bookingData.authUserId,
            bookingData.customerUid,
            bookingData.userId,
            bookingData.uid,
          ]) {
            if (ownerField !== undefined && ownerField !== null && ownerField !== '') {
              return guestGenericDenial();
            }
          }

          const rawGuestCustId = bookingData.customerId;
          let guestCustId = '';
          if (rawGuestCustId !== undefined && rawGuestCustId !== null && rawGuestCustId !== '') {
            if (
              typeof rawGuestCustId !== 'string' ||
              rawGuestCustId.trim() !== rawGuestCustId ||
              !isValidBookingHistoryDocId(rawGuestCustId, 128) ||
              rawGuestCustId.startsWith('cust_u_')
            ) {
              return guestGenericDenial();
            }
            guestCustId = rawGuestCustId;
          }

          if (guestCustId) {
            const linkedCustSnap = await transaction.get(
              adminDb.collection('customers').doc(guestCustId)
            );
            if (snapExists(linkedCustSnap)) {
              const linkedCustData = linkedCustSnap.data() || {};
              if (
                linkedCustData.id !== undefined &&
                linkedCustData.id !== null &&
                linkedCustData.id !== '' &&
                (typeof linkedCustData.id !== 'string' || linkedCustData.id !== guestCustId)
              ) {
                return guestGenericDenial();
              }
              for (const profOwnerField of [
                linkedCustData.customerAuthUid,
                linkedCustData.authUserId,
                linkedCustData.authUid,
                linkedCustData.customerUid,
                linkedCustData.userId,
                linkedCustData.uid,
              ]) {
                if (
                  profOwnerField !== undefined &&
                  profOwnerField !== null &&
                  profOwnerField !== ''
                ) {
                  return guestGenericDenial();
                }
              }
              const linkedAcctStatus =
                typeof linkedCustData.accountStatus === 'string'
                  ? linkedCustData.accountStatus.trim().toUpperCase()
                  : '';
              if (
                linkedAcctStatus === 'ACTIVE' ||
                linkedCustData.isRegistered === true ||
                linkedCustData.loginEnabled === true
              ) {
                return guestGenericDenial();
              }
            }
          }

          if (!verifyTrackingPhoneMatch(bookingData.customerWhatsApp, cleanCanonicalPhone)) {
            return guestGenericDenial();
          }

          accessLevel = 'guest';
        }

        // 6. Read & validate booking_status_history across both bookingId and bookingCode
        const histByBookingIdQuery = adminDb
          .collection('booking_status_history')
          .where('bookingId', '==', resolvedBookingId);
        const histByBookingCodeQuery = adminDb
          .collection('booking_status_history')
          .where('bookingCode', '==', resolvedBookingCode);

        const [histByBookingIdSnap, histByBookingCodeSnap] = await Promise.all([
          transaction.get(histByBookingIdQuery),
          transaction.get(histByBookingCodeQuery),
        ]);

        const mergedHistoryMap = new Map<string, { id: string; data: any }>();
        for (const d of [
          ...(histByBookingIdSnap?.docs || []),
          ...(histByBookingCodeSnap?.docs || []),
        ]) {
          if (snapExists(d) && isValidBookingHistoryDocId(d.id, 128)) {
            mergedHistoryMap.set(d.id, { id: d.id, data: d.data() || {} });
          }
        }

        const validHistoryEntries: Array<{ id: string; data: any }> = [];
        for (const item of mergedHistoryMap.values()) {
          const h = item.data;
          if (!h || typeof h !== 'object' || Array.isArray(h)) continue;
          if (
            (h.bookingId !== undefined &&
              h.bookingId !== null &&
              h.bookingId !== '' &&
              (typeof h.bookingId !== 'string' || h.bookingId !== resolvedBookingId)) ||
            (h.bookingCode !== undefined &&
              h.bookingCode !== null &&
              h.bookingCode !== '' &&
              (typeof h.bookingCode !== 'string' ||
                h.bookingCode.trim().toUpperCase() !== resolvedBookingCode))
          ) {
            return !verifiedUid
              ? guestGenericDenial()
              : {
                  status: 409,
                  code: 'BOOKING_HISTORY_CONFLICT',
                  message: 'Riwayat status pesanan mengalami konflik referensi dokumen.',
                };
          }
          const hStatus = textId(h.status);
          if (!hStatus || !ALLOWED_BOOKING_STATUSES.has(hStatus)) continue;
          if (typeof h.timestamp !== 'string' || Number.isNaN(Date.parse(h.timestamp))) continue;
          validHistoryEntries.push(item);
        }

        validHistoryEntries.sort((a, b) => {
          const diff =
            new Date(a.data.timestamp || 0).getTime() -
            new Date(b.data.timestamp || 0).getTime();
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        });

        const deduplicatedHistory: any[] = [];
        for (const item of validHistoryEntries) {
          const h = item.data;
          const cleanStatus = textId(h.status);
          if (
            deduplicatedHistory.length > 0 &&
            deduplicatedHistory[deduplicatedHistory.length - 1].status === cleanStatus
          ) {
            continue;
          }

          // Canonical snapshot ID unconditionally (stored h.id cannot override snapshot identity)
          const entryId = item.id;
          const rawRole = textId(h.updatedByRole);
          const cleanRole = ALLOWED_HISTORY_ROLES.has(rawRole) ? rawRole : 'system';
          const safeUpdatedByName =
            accessLevel === 'guest'
              ? getGuestGenericHistoryActorLabel(cleanRole)
              : sanitizeText(h.updatedByName, 120) || 'Sistem Senzu';
          // Omit raw history notes for guests so private notes/addresses/codes are never exposed
          const rawNoteText =
            accessLevel === 'guest' ? '' : sanitizeText(h.note, 1000);

          const sanitizedEntry: Record<string, any> = {
            id: entryId,
            bookingId: resolvedBookingId,
            bookingCode: resolvedBookingCode,
            status: cleanStatus,
            ...(rawNoteText ? { note: rawNoteText } : {}),
            updatedByRole: cleanRole,
            updatedByName: safeUpdatedByName,
            timestamp: h.timestamp,
            formattedWIB:
              sanitizeText(h.formattedWIB, 80) || formatBookingHistoryWIB(h.timestamp),
          };
          deduplicatedHistory.push(sanitizedEntry);
        }

        const scheduleDate = bookingData.scheduleDate || bookingData.bookingDate || '';
        const scheduleTime = bookingData.scheduleTime || bookingData.timeSlot || '';
        const scheduleAt =
          bookingData.scheduleAt ||
          (scheduleDate && scheduleTime ? `${scheduleDate} ${scheduleTime}` : '');
        const serviceDuration =
          bookingData.serviceDuration || bookingData.durationMinutes || 90;
        const totalAmount =
          bookingData.totalAmount ?? (bookingData.totalPrice || bookingData.price || 0);

        let responseBooking: Record<string, any>;
        if (accessLevel === 'guest') {
          // Strictly redacted guest booking summary: never expose raw phone, full name, street address, coordinates, email, notes, or UIDs
          responseBooking = {
            id: resolvedBookingId,
            bookingCode: resolvedBookingCode,
            status: bookingData.status,
            paymentStatus: bookingData.paymentStatus,
            paymentMethod: bookingData.paymentMethod || '',
            ...(bookingData.paymentDeadline ? { paymentDeadline: bookingData.paymentDeadline } : {}),
            serviceId: bookingData.serviceId || '',
            serviceName: bookingData.serviceName || '',
            ...(bookingData.packageName ? { packageName: bookingData.packageName } : {}),
            serviceDuration,
            durationMinutes: bookingData.durationMinutes || serviceDuration,
            scheduleDate,
            bookingDate: bookingData.bookingDate || scheduleDate,
            scheduleTime,
            timeSlot: bookingData.timeSlot || scheduleTime,
            scheduleAt,
            genderPreference: bookingData.genderPreference || 'Bebas',
            therapistName: bookingData.therapistName || '',
            totalAmount,
            totalPrice: bookingData.totalPrice || totalAmount,
            servicePrice: bookingData.servicePrice || 0,
            homeServiceFee: bookingData.homeServiceFee || 0,
            discountAmount: bookingData.discountAmount || 0,
            area: bookingData.area || '',
            customerName: maskGuestCustomerName(bookingData.customerName),
            customerWhatsApp: maskGuestWhatsApp(bookingData.customerWhatsApp),
            address: maskGuestAddress(bookingData.address, bookingData.area),
            createdAt: bookingData.createdAt || '',
            updatedAt: bookingData.updatedAt || '',
          };
        } else {
          const allowedFieldList =
            accessLevel === 'owner'
              ? OWNER_ALLOWED_BOOKING_FIELDS
              : accessLevel === 'therapist'
              ? THERAPIST_ALLOWED_BOOKING_FIELDS
              : STAFF_ALLOWED_BOOKING_FIELDS;

          responseBooking = projectAllowedBookingFields(bookingData, allowedFieldList, {
            id: resolvedBookingId,
            bookingCode: resolvedBookingCode,
            serviceDuration,
            durationMinutes: bookingData.durationMinutes || serviceDuration,
            scheduleDate,
            bookingDate: bookingData.bookingDate || scheduleDate,
            scheduleTime,
            timeSlot: bookingData.timeSlot || scheduleTime,
            scheduleAt,
            totalAmount,
            totalPrice: bookingData.totalPrice || totalAmount,
          });
        }

        return {
          status: 200,
          accessLevel,
          bookingId: resolvedBookingId,
          bookingCode: resolvedBookingCode,
          booking: responseBooking,
          history: deduplicatedHistory,
        };
      });

      if (txResult.status !== 200) {
        return res.status(txResult.status).json({
          success: false,
          code: txResult.code,
          error: txResult.message,
          message: txResult.message,
        });
      }

      if (mode === 'history') {
        return res.status(200).json({
          success: true,
          accessLevel: txResult.accessLevel,
          bookingId: txResult.bookingId,
          bookingCode: txResult.bookingCode,
          history: txResult.history,
        });
      }

      return res.status(200).json({
        success: true,
        accessLevel: txResult.accessLevel,
        booking: txResult.booking,
        history: txResult.history,
      });
    } catch {
      return res.status(503).json({
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        error: 'Layanan pelacakan pesanan sedang tidak tersedia.',
        message: 'Layanan pelacakan pesanan sedang tidak tersedia.',
      });
    }
  };

  const handleBookingTrackRead = async (req: express.Request, res: express.Response) =>
    executeAuthoritativeBookingRead(req, res, 'track');

  const handleBookingStatusHistoryRead = async (req: express.Request, res: express.Response) =>
    executeAuthoritativeBookingRead(req, res, 'history');

  app.get('/api/bookings/track', handleBookingTrackRead);
  app.post('/api/bookings/track', handleBookingTrackRead);
  app.get('/api/booking-history/read', handleBookingStatusHistoryRead);
  app.post('/api/booking-history/read', handleBookingStatusHistoryRead);
  app.get('/api/booking-status-history/read', handleBookingStatusHistoryRead);
  app.post('/api/booking-status-history/read', handleBookingStatusHistoryRead);
  app.get('/api/booking-history', handleBookingStatusHistoryRead);
  app.get('/api/booking-status-history', handleBookingStatusHistoryRead);
  app.get('/api/bookings/history', handleBookingStatusHistoryRead);
  app.post('/api/bookings/history', handleBookingStatusHistoryRead);
  app.get('/api/bookings/:bookingId/history', handleBookingStatusHistoryRead);

  // In-memory cache for manager status (30s TTL)
  let managerStatusCache: { data: any; cachedAt: number } | null = null;
  const MANAGER_STATUS_TTL_MS = 30 * 1000;

  // Helper to find existing production Manager record in canonical staff_users collection
  async function findProductionManagerStatus() {
    if (managerStatusCache && Date.now() - managerStatusCache.cachedAt < MANAGER_STATUS_TTL_MS) {
      return managerStatusCache.data;
    }

    try {
      if (!db) return { conflict: false, isFullyConfigured: false, manager: null, lookupUnavailable: true, reason: 'database_uninitialized' };
      // Query specifically for manager role docs with a limit instead of loading all staff users
      const qMgr = query(collection(db, 'staff_users'), where('role', '==', 'manager'), limit(5));
      const snap = await getDocs(qMgr);
      const managers: any[] = [];

      for (const d of snap.docs) {
        const u = d.data() as any;
        const isManager = u.role === 'manager';
        const isDemo = u.isDemoAccount === true;
        if (isManager && !isDemo) {
          managers.push({ id: d.id, ...u });
        }
      }

      // Check for multiple conflicting manager records (Requirement 9)
      if (managers.length > 1) {
        const conflictResult = {
          conflict: true,
          count: managers.length,
          message: 'Ditemukan lebih dari satu profil Manager di Master Data. Diperlukan intervensi administrator.',
          managers: managers.map(m => ({ id: m.id, name: m.name, email: m.email })),
        };
        managerStatusCache = { data: conflictResult, cachedAt: Date.now() };
        return conflictResult;
      }

      if (managers.length === 0) {
        const noMgrResult = {
          conflict: false,
          isFullyConfigured: false,
          manager: null,
          lookupUnavailable: false,
        };
        managerStatusCache = { data: noMgrResult, cachedAt: Date.now() };
        return noMgrResult;
      }

      const mgr = managers[0];
      const email = mgr.email ? mgr.email.trim().toLowerCase() : '';

      // Check Firebase Auth account existence and UID linkage (Requirement 3 & 4)
      const hasRealAuthUid = Boolean(mgr.authUserId && !mgr.authUserId.startsWith('mgr_uid_'));
      let authUserExists = hasRealAuthUid; // If already linked with real UID, we know user exists in Auth
      let existingAuthUid = mgr.authUserId || '';

      if (email && !hasRealAuthUid) {
        if (!adminAuth) {
          return {
            conflict: false,
            isFullyConfigured: false,
            manager: mgr,
            lookupUnavailable: true,
            reason: 'admin_auth_uninitialized',
          };
        }
        try {
          const authRecord = await adminAuth.getUserByEmail(email);
          if (authRecord && authRecord.uid) {
            authUserExists = true;
            existingAuthUid = authRecord.uid;
          }
        } catch (err: any) {
          if (err?.code === 'auth/user-not-found') {
            authUserExists = false;
          } else {
            console.warn('Firebase Auth lookup error:', err?.code || err?.message);
            return {
              conflict: false,
              isFullyConfigured: false,
              manager: mgr,
              lookupUnavailable: true,
              reason: err?.code || 'auth_lookup_error',
            };
          }
        }
      }

      const isActive = mgr.isActive !== false && mgr.status !== 'INACTIVE';
      const isLoginActive = mgr.loginAccountStatus === 'AKTIF';

      // Case A: Staff Master exists AND Firebase Auth account exists AND authUserId is properly linked
      const isFullyConfigured = hasRealAuthUid && authUserExists && isActive && isLoginActive;

      const result = {
        conflict: false,
        isFullyConfigured,
        manager: mgr,
        authUserExists,
        hasRealAuthUid,
        isActive,
        isLoginActive,
        lookupUnavailable: false,
      };

      managerStatusCache = { data: result, cachedAt: Date.now() };
      return result;
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota') || err?.message?.includes('quota')) {
        console.warn('Manager status check throttled by Firestore quota limits.');
        const fallbackStatus = {
          conflict: false,
          isFullyConfigured: true,
          manager: null,
          authUserExists: true,
          hasRealAuthUid: true,
          isActive: true,
          isLoginActive: true,
          quotaThrottled: true,
          lookupUnavailable: true,
        };
        return fallbackStatus;
      }
      console.warn('Notice determining manager status:', err?.message || err);
      return {
        conflict: false,
        isFullyConfigured: false,
        manager: null,
        lookupUnavailable: true,
        reason: err?.code || 'status_lookup_error',
      };
    }
  }

  // Constant-time setup key verification (Finding 8)
  function verifySetupKey(providedKey: unknown): boolean {
    const configuredKey = process.env.INITIAL_MANAGER_SETUP_KEY?.trim();
    if (!configuredKey || typeof providedKey !== 'string') {
      return false;
    }
    const cleanProvided = providedKey.trim();
    if (!cleanProvided) {
      return false;
    }
    const expectedBuf = Buffer.from(configuredKey, 'utf8');
    const providedBuf = Buffer.from(cleanProvided, 'utf8');

    if (expectedBuf.length !== providedBuf.length) {
      timingSafeEqual(expectedBuf, expectedBuf);
      return false;
    }
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  // 2. GET /api/bootstrap/status: Check if one-time bootstrap is still permitted or needs reconciliation
  app.get('/api/bootstrap/status', async (req, res) => {
    try {
      const result = await findProductionManagerStatus();

      if (result && result.lookupUnavailable) {
        return res.status(503).json({
          canBootstrap: false,
          status: 'UNAVAILABLE',
          message: 'Layanan inisialisasi Manager sementara tidak tersedia. Silakan coba beberapa saat lagi.',
        });
      }

      if (result && result.conflict) {
        return res.status(409).json({
          canBootstrap: false,
          status: 'CONFLICT',
          message: result.message,
          managers: result.managers,
        });
      }

      if (result && result.manager) {
        const mgr = result.manager;
        const maskedEmail = mgr.email ? mgr.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '';

        if (result.isFullyConfigured) {
          // Case A: Setup is genuinely complete (Requirement 16)
          return res.json({
            canBootstrap: false,
            status: 'COMPLETED',
            message: 'INITIAL SETUP ALREADY COMPLETED',
            managerName: mgr.name || mgr.fullName,
            managerEmail: maskedEmail,
            rawEmail: mgr.email,
            authUserId: mgr.authUserId,
          });
        } else {
          // Case B: Incomplete initialization (Requirement 3 & 4)
          return res.json({
            canBootstrap: false,
            status: 'INCOMPLETE_AUTH',
            message: 'Profil Manager ditemukan, tetapi akun login belum selesai dibuat.',
            managerName: mgr.name || mgr.fullName,
            managerEmail: maskedEmail,
            rawEmail: mgr.email,
            staffId: mgr.uid || mgr.id,
            role: mgr.role,
            needsReconciliation: true,
            authUserExists: result.authUserExists,
            hasRealAuthUid: result.hasRealAuthUid,
          });
        }
      }

      // Check if bootstrap secret is configured (Finding 8)
      const configuredKey = process.env.INITIAL_MANAGER_SETUP_KEY?.trim();
      if (!configuredKey) {
        return res.json({
          canBootstrap: false,
          status: 'DISABLED',
          message: 'Inisialisasi Manager dinonaktifkan: setup key server belum dikonfigurasi.',
        });
      }

      // Ready for first-time bootstrap
      return res.json({
        canBootstrap: true,
        status: 'READY_FOR_BOOTSTRAP',
        message: 'Belum ada akun Manager produksi terdaftar. Inisialisasi siap dilakukan.',
      });
    } catch (err: any) {
      console.error('Bootstrap status check error:', err);
      res.status(500).json({ canBootstrap: false, status: 'ERROR', error: 'Gagal memeriksa status inisialisasi Manager.' });
    }
  });

  // Password Policy: min 12 chars, upper, lower, digit, special symbol
  function validatePasswordPolicy(pass: string): { valid: boolean; reason?: string } {
    if (!pass || pass.length < 12) {
      return { valid: false, reason: 'Password minimal 12 karakter.' };
    }
    const hasUpper = /[A-Z]/.test(pass);
    const hasLower = /[a-z]/.test(pass);
    const hasNumber = /[0-9]/.test(pass);
    const hasSpecial = /[^A-Za-z0-9]/.test(pass);
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      return {
        valid: false,
        reason: 'Password harus memuat kombinasi huruf besar, huruf kecil, angka, dan simbol unik.',
      };
    }
    return { valid: true };
  }

  // 3. POST /api/bootstrap/reconcile-manager: Reconcile existing Manager profile with Firebase Auth (Requirement 5)
  app.post('/api/bootstrap/reconcile-manager', async (req, res) => {
    try {
      const { setupKey, password, confirmPassword } = req.body || {};

      // Verify server-side setup secret key using constant-time comparison (Finding 8)
      if (!verifySetupKey(setupKey)) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_SETUP_KEY',
          message: 'Setup key tidak valid. Silakan periksa kunci rahasia server.',
        });
      }

      // Validate password policy
      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          code: 'PASSWORDS_DO_NOT_MATCH',
          message: 'Konfirmasi password tidak cocok dengan password baru.',
        });
      }

      const pwdCheck = validatePasswordPolicy(password);
      if (!pwdCheck.valid) {
        return res.status(400).json({
          success: false,
          code: 'PASSWORD_REQUIREMENTS_NOT_MET',
          message: pwdCheck.reason,
        });
      }

      // Find existing manager
      const statusRes = await findProductionManagerStatus();
      if (statusRes?.lookupUnavailable) {
        return res.status(503).json({
          success: false,
          code: 'LOOKUP_UNAVAILABLE',
          message: 'Layanan inisialisasi Manager sementara tidak tersedia. Silakan coba beberapa saat lagi.',
        });
      }

      if (!statusRes || !statusRes.manager) {
        return res.status(404).json({
          success: false,
          code: 'MANAGER_NOT_FOUND',
          message: 'Profil Manager tidak ditemukan dalam Master Data Staff.',
        });
      }

      if (statusRes.conflict) {
        return res.status(409).json({
          success: false,
          code: 'CONFLICT',
          message: statusRes.message,
        });
      }

      if (statusRes.isFullyConfigured) {
        return res.status(403).json({
          success: false,
          code: 'PROD_MANAGER_ALREADY_CONFIGURED',
          message: 'Akun Branch Manager produksi sudah aktif dan terkonfigurasi. Operasi bootstrap dikunci untuk keamanan sistem.',
        });
      }

      const existingManager = statusRes.manager;
      const cleanEmail = existingManager.email.trim().toLowerCase();

      // Ensure Firebase Auth account exists or create it
      let realAuthUid = '';

      try {
        // Try creating Firebase Auth account
        const userCred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        realAuthUid = userCred.user.uid;
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          // Account already exists in Firebase Auth: try signing in with provided password to verify or update
          try {
            const loginCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
            realAuthUid = loginCred.user.uid;
          } catch (loginErr: any) {
            // Password might have changed: try to sign in and update password if possible or provide UID
            console.warn('Sign-in during reconciliation noticed:', loginErr.code);
            return res.status(400).json({
              success: false,
              code: 'AUTH_CREDENTIAL_MISMATCH',
              message: 'Akun Firebase Authentication sudah ada untuk email ini. Masukkan kata sandi yang sesuai atau gunakan fitur Lupa Kata Sandi pada halaman Login.',
            });
          }
        } else if (authErr.code === 'auth/operation-not-allowed') {
          return res.status(400).json({
            success: false,
            code: 'OPERATION_NOT_ALLOWED',
            message: 'Login Email & Password belum diaktifkan pada konfigurasi Firebase. Silakan aktifkan provider Email/Password di Firebase Console.',
          });
        } else {
          return res.status(500).json({
            success: false,
            code: 'FIREBASE_AUTH_ERROR',
            message: authErr.message || 'Gagal membuat/menghubungkan akun Firebase Authentication.',
          });
        }
      }

      // Update the EXISTING Staff Master record in place (Requirement 5)
      // DO NOT create a duplicate staff record!
      // Keep original Staff ID (existingManager.uid)
      const now = new Date().toISOString();
      const updatedData = {
        authUserId: realAuthUid,
        authSource: 'firebase_auth',
        loginAccountStatus: 'AKTIF',
        status: 'ACTIVE',
        isActive: true,
        role: 'manager',
        updatedAt: now,
        updatedBy: 'Manager Auth Reconciliation',
      };

      await updateDoc(doc(db, 'staff_users', existingManager.uid), updatedData);

      // Audit Log
      try {
        const logId = `adm_audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await setDoc(doc(db, 'admin_audit_logs', logId), {
          id: logId,
          actorId: existingManager.uid,
          actorRole: 'manager',
          actorName: existingManager.name,
          action: 'staff.auth_reconciled',
          entityType: 'staff',
          entityId: existingManager.uid,
          summary: `Rekonsiliasi Otentikasi: Akun login Firebase Auth (${cleanEmail}) berhasil dihubungkan ke profil Manager "${existingManager.name}".`,
          timestamp: now,
        });
      } catch (logErr) {
        console.warn('Audit log write notice:', logErr);
      }

      return res.json({
        success: true,
        message: 'Akun login Manager berhasil direkonsiliasi dan terhubung ke Firebase Authentication.',
        data: {
          uid: existingManager.uid,
          name: existingManager.name,
          email: cleanEmail,
          role: 'manager',
          branch: 'Senzu Home Palembang R-01 (PLG001)',
          authUserId: realAuthUid,
        },
      });
    } catch (err: any) {
      console.error('Error reconciling manager:', err);
      res.status(500).json({
        success: false,
        code: 'RECONCILIATION_FAILED',
        message: err.message || 'Terjadi kesalahan saat rekonsiliasi akun Manager.',
      });
    }
  });

  // 4. POST /api/bootstrap/initial-manager: One-time first Manager creation
  app.post('/api/bootstrap/initial-manager', async (req, res) => {
    try {
      const { fullName, email, phone, password, confirmPassword, setupKey } = req.body || {};

      // Step A: Verify server-side setup secret key using constant-time comparison (Finding 8)
      if (!verifySetupKey(setupKey)) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_SETUP_KEY',
          message: 'Setup key tidak valid. Silakan periksa kunci rahasia server.',
        });
      }

      // Step B: Double-check if production manager already exists
      const currentStatus = await findProductionManagerStatus();
      if (currentStatus?.lookupUnavailable) {
        return res.status(503).json({
          success: false,
          code: 'LOOKUP_UNAVAILABLE',
          message: 'Layanan inisialisasi Manager sementara tidak tersedia. Silakan coba beberapa saat lagi.',
        });
      }
      if (currentStatus && currentStatus.conflict) {
        return res.status(409).json({
          success: false,
          code: 'CONFLICT',
          message: currentStatus.message,
        });
      }
      if (currentStatus && currentStatus.manager) {
        return res.status(403).json({
          success: false,
          code: currentStatus.isFullyConfigured ? 'ALREADY_COMPLETED' : 'INCOMPLETE_AUTH',
          message: currentStatus.isFullyConfigured
            ? 'INITIAL SETUP ALREADY COMPLETED'
            : 'Profil Manager ditemukan, tetapi akun login belum selesai dibuat.',
        });
      }

      // Step C: Validate inputs
      if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 3) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_NAME',
          message: 'Nama lengkap harus diisi minimal 3 karakter.',
        });
      }

      const cleanEmail = email ? email.trim().toLowerCase() : '';
      if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_EMAIL',
          message: 'Format email tidak valid.',
        });
      }

      const cleanPhone = phone ? phone.trim().replace(/[^0-9+]/g, '') : '';
      if (!cleanPhone || cleanPhone.length < 8) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PHONE',
          message: 'Nomor WhatsApp staf harus valid.',
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          code: 'PASSWORDS_DO_NOT_MATCH',
          message: 'Konfirmasi password tidak cocok dengan password baru.',
        });
      }

      const pwdCheck = validatePasswordPolicy(password);
      if (!pwdCheck.valid) {
        return res.status(400).json({
          success: false,
          code: 'PASSWORD_REQUIREMENTS_NOT_MET',
          message: pwdCheck.reason,
        });
      }

      // Step D: Create genuine Firebase Auth User
      let authUserId = '';
      try {
        const userCred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        authUserId = userCred.user.uid;
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          return res.status(400).json({
            success: false,
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'Email ini sudah terdaftar di Firebase Authentication. Silakan gunakan email lain atau rekonsiliasi.',
          });
        }
        if (authErr.code === 'auth/operation-not-allowed') {
          return res.status(400).json({
            success: false,
            code: 'OPERATION_NOT_ALLOWED',
            message: 'Login Email & Password belum diaktifkan pada konfigurasi Firebase. Silakan aktifkan provider Email/Password di Firebase Console.',
          });
        }
        return res.status(500).json({
          success: false,
          code: 'FIREBASE_AUTH_ERROR',
          message: authErr.message || 'Gagal membuat akun Firebase Authentication.',
        });
      }

      // Step E: Create real Staff Master record in Firestore
      const now = new Date().toISOString();
      const newStaffId = `staff-mgr-${Date.now().toString(36)}`;
      const displayName = fullName.trim().split(' ')[0];

      const staffMasterRecord = {
        uid: newStaffId,
        employeeCode: 'MGR-001',
        name: fullName.trim(),
        displayName: displayName,
        role: 'manager',
        branchId: 'PLG001',
        branchName: 'Senzu Home Palembang R-01',
        email: cleanEmail,
        phone: cleanPhone.startsWith('0') ? '+62' + cleanPhone.substring(1) : cleanPhone,
        whatsapp: cleanPhone.startsWith('0') ? '+62' + cleanPhone.substring(1) : cleanPhone,
        gender: 'Laki-laki',
        activeStatus: 'ACTIVE',
        status: 'ACTIVE',
        isActive: true,
        loginAccountStatus: 'AKTIF',
        isDemoAccount: false,
        isProductionManager: true,
        authUserId: authUserId,
        authSource: 'firebase_auth',
        createdAt: now,
        updatedAt: now,
        updatedBy: 'Initial Manager Bootstrap Setup',
      };

      await setDoc(doc(db, 'staff_users', newStaffId), staffMasterRecord);

      // Step F: Record Admin Audit Log
      try {
        const logId = `adm_audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await setDoc(doc(db, 'admin_audit_logs', logId), {
          id: logId,
          actorId: newStaffId,
          actorRole: 'manager',
          actorName: fullName.trim(),
          action: 'staff.created',
          entityType: 'staff',
          entityId: newStaffId,
          summary: `Inisialisasi Pertama: Akun Manager Produksi "${fullName.trim()}" (${cleanEmail}) berhasil dibuat dan dihubungkan ke Staff Master.`,
          timestamp: now,
        });
      } catch (logErr) {
        console.warn('Audit log write notice:', logErr);
      }

      return res.json({
        success: true,
        message: 'Akun Manager produksi Senzu Home berhasil dibuat dan dihubungkan ke Staff Master.',
        data: {
          uid: newStaffId,
          name: fullName.trim(),
          email: cleanEmail,
          role: 'manager',
          branch: 'Senzu Home Palembang R-01 (PLG001)',
          authUserId: authUserId,
        },
      });
    } catch (err: any) {
      console.error('Error creating initial manager:', err);
      res.status(500).json({
        success: false,
        code: 'SETUP_FAILED',
        message: 'Gagal membuat akun Manager. Silakan coba kembali atau periksa konfigurasi server.',
      });
    }
  });

  // ===========================================================================
  // STAGE 7E: PRIVATE NOTIFICATIONS, AUTHORITATIVE EVENTS & DELIVERY RECORDS
  // ===========================================================================
  type S7Caller = { uid: string; role: string; staffId: string; name: string; therapistIds: Set<string> };
  type S7Source = { type: string; references: Record<string, any>; booking: any; bookingId: string; customerId: string; customerUid: string; therapistId: string; payload: Record<string, any>; version: string; entity: any; ownerUid: string };
  const s7Operational = ['css', 'supervisor', 'manager', 'admin'];
  const s7EventTypes = new Set<string>(["booking.created", "booking.confirmed", "booking.cancelled", "payment.proof_uploaded", "payment.verified", "payment.rejected", "payment.expired", "booking.ready_for_assignment", "therapist.assigned", "therapist.reassigned", "therapist.accepted", "therapist.on_the_way", "therapist.nearby", "therapist.arrived", "treatment.started", "treatment.completed", "tracking.location_stale", "booking.reminder", "supervisor.unassigned_alert", "therapist.not_accepted_alert", "therapist.late_departure_alert", "review.low_rating", "crm.task_due", "loyalty.points_earned", "loyalty.points_redeemed", "loyalty.points_expiring", "membership.tier_upgraded", "membership.tier_renewed", "voucher.issued", "voucher.expiring", "voucher.used", "referral.qualified", "birthday.reward_issued", "therapist.shift_updated", "therapist.off_updated", "therapist.schedule_override", "case.created", "case.assigned", "case.escalated", "case.high_severity", "case.waiting_customer", "case.waiting_manager", "case.resolved", "case.closed", "case.reopened", "recovery.proposed", "recovery.approved", "recovery.rejected", "recovery.completed"]);
  const s7Rates = new Map<string, { count: number; until: number }>();
  const s7GuestRates = new Map<string, { count: number; until: number }>();
  const s7Text = (v: unknown, max = 160): string => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const s7Id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.:@-]{0,159}$/.test(v) && !/^\.+$/.test(v);
  const s7Error = (statusCode: number, code: string, message = 'Permintaan notifikasi tidak dapat diproses.') => Object.assign(new Error(message), { statusCode, code });
  const s7Json = (value: any): any => JSON.parse(JSON.stringify(value));
  const s7Hash = (value: any): string => {
    const sorted = (v: any): any => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
    return createHash('sha256').update(JSON.stringify(sorted(s7Json(value)))).digest('hex');
  };
  const s7NewId = (prefix: string): string => `${prefix}_${randomInt(0, 281474976710655).toString(36)}${randomInt(0, 281474976710655).toString(36)}`;
  const s7Date = (value: any): string => {
    const raw = typeof value?.toDate === 'function' ? value.toDate() : value;
    const date = raw instanceof Date ? raw : new Date(raw || NaN);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  };
  const s7Disabled = (data: any): boolean => !data || data.isActive === false || data.loginEnabled === false ||
    ['INACTIVE', 'DISABLED', 'ARCHIVED', 'DINONAKTIFKAN', 'DELETED', 'TERMINATED', 'SUSPENDED', 'CLOSED'].includes(s7Text(data.status).toUpperCase()) || s7Text(data.loginAccountStatus).toUpperCase() === 'DINONAKTIFKAN';
  const s7UidFields = (data: any, fields: string[]): string => {
    const values: string[] = [];
    for (const field of fields) {
      const value = data?.[field];
      if (value === undefined || value === null || value === '') continue;
      if (!s7Id(value) || value.trim() !== value) throw s7Error(403, 'OWNER_UID_CONFLICT');
      values.push(value);
    }
    if (new Set(values).size > 1) throw s7Error(403, 'OWNER_UID_CONFLICT');
    return values[0] || '';
  };
  function s7Rate(map: Map<string, { count: number; until: number }>, key: string, max: number): void {
    const now = Date.now();
    for (const [k, value] of map) if (value.until <= now) map.delete(k);
    const value = map.get(key);
    if ((!value && map.size >= 5000) || (value && value.count >= max)) throw s7Error(429, 'RATE_LIMITED', 'Permintaan notifikasi terlalu sering. Silakan coba lagi.');
    map.set(key, { count: (value?.count || 0) + 1, until: value?.until || now + 60000 });
  }
  async function s7Verify(req: express.Request): Promise<string> {
    const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
    const names = rawHeaders.filter((_: any, index: number) => index % 2 === 0).map((name: string) => name.toLowerCase());
    if (names.filter((name: string) => name === 'authorization').length > 1 || names.includes('x-firebase-auth')) throw s7Error(401, 'AUTH_HEADER_INVALID');
    const result = await verifyStage7dBearerToken(req);
    if (!result.ok || !result.uid) throw s7Error(result.status || 401, result.code || 'AUTH_REQUIRED', 'Sesi autentikasi tidak valid atau layanan autentikasi belum tersedia.');
    s7Rate(s7Rates, `uid:${result.uid}`, 120);
    s7Rate(s7Rates, `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`, 600);
    if (!adminDb) throw s7Error(503, 'NOTIFICATION_UNAVAILABLE');
    return result.uid;
  }
  function s7Body(body: any, allowed: string[]): Record<string, any> {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw s7Error(400, 'INVALID_NOTIFICATION_PAYLOAD');
    return body;
  }
  function s7References(raw: any): Record<string, any> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw s7Error(400, 'INVALID_EVENT_REFERENCES');
    const result: Record<string, any> = {};
    const ids = ['bookingId', 'bookingCode', 'paymentId', 'customerId', 'therapistId', 'transactionId', 'loyaltyTransactionId', 'customerVoucherId', 'voucherId', 'referralId', 'caseId', 'reviewId'];
    for (const field of ids) if (raw[field] !== undefined && raw[field] !== null && raw[field] !== '') {
      if (!s7Id(raw[field])) throw s7Error(400, 'INVALID_EVENT_REFERENCE');
      result[field] = raw[field];
    }
    if (result.transactionId && result.loyaltyTransactionId && result.transactionId !== result.loyaltyTransactionId) throw s7Error(400, 'REFERENCE_CONFLICT');
    if (result.loyaltyTransactionId) { result.transactionId = result.loyaltyTransactionId; delete result.loyaltyTransactionId; }
    if (raw.date !== undefined) {
      if (typeof raw.date !== 'string' || !/^(?:\d{4}-\d{2}-\d{2}(?: s\/d \d{4}-\d{2}-\d{2})?|Jadwal Mingguan Rutin)$/.test(raw.date)) throw s7Error(400, 'INVALID_ROSTER_DATE');
      result.date = raw.date;
    }
    if (raw.tierStartedAt !== undefined) {
      if (!s7Date(raw.tierStartedAt) || typeof raw.tierStartedAt !== 'string') throw s7Error(400, 'INVALID_TIER_VERSION');
      result.tierStartedAt = s7Date(raw.tierStartedAt);
    }
    if (raw.year !== undefined) {
      if (!Number.isInteger(raw.year) || raw.year < 2000 || raw.year > 2200) throw s7Error(400, 'INVALID_REWARD_YEAR');
      result.year = raw.year;
    }
    return result;
  }
  async function s7WithinReadDeadline<T>(operation: () => Promise<T>, deadlineAt = 0): Promise<T> {
    if (!deadlineAt) return operation();
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw s7Error(503, 'NOTIFICATION_READ_TIMEOUT');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (Date.now() >= deadlineAt) throw s7Error(503, 'NOTIFICATION_READ_TIMEOUT');
          return operation();
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(s7Error(503, 'NOTIFICATION_READ_TIMEOUT')), remaining); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  function s7Reader(transaction: any, deadlineAt = 0): { doc: (collection: string, id: string) => Promise<any>; query: (query: any) => Promise<any> } {
    const cache = new Map<string, Promise<any>>();
    const queries: { query: any; promise: Promise<any> }[] = [];
    return {
      doc(collection: string, id: string) {
        if (deadlineAt && Date.now() >= deadlineAt) throw s7Error(503, 'NOTIFICATION_READ_TIMEOUT');
        if (!s7Id(id)) throw s7Error(409, 'SOURCE_REFERENCE_INVALID');
        const key = `${collection}/${id}`;
        if (!cache.has(key)) cache.set(key, s7WithinReadDeadline(() => transaction.get(adminDb.collection(collection).doc(id)), deadlineAt));
        return cache.get(key)!;
      },
      query: query => {
        if (deadlineAt && Date.now() >= deadlineAt) throw s7Error(503, 'NOTIFICATION_READ_TIMEOUT');
        const prior = queries.find(item => typeof query.isEqual === 'function' && query.isEqual(item.query));
        if (prior) return prior.promise;
        const promise = s7WithinReadDeadline(() => transaction.get(query), deadlineAt); queries.push({ query, promise }); return promise;
      },
    };
  }
  async function s7Caller(read: ReturnType<typeof s7Reader>, uid: string): Promise<S7Caller> {
    const [roleSnap, canonical, legacy, direct] = await Promise.all([
      read.doc('staff_roles', uid), read.query(adminDb.collection('staff_users').where('authUserId', '==', uid).limit(2)),
      read.query(adminDb.collection('staff_users').where('authUid', '==', uid).limit(2)), read.doc('staff_users', uid),
    ]);
    const matches = new Map<string, any>();
    for (const item of [...canonical.docs, ...legacy.docs, ...(direct.exists ? [direct] : [])]) matches.set(item.id, item);
    const role = roleSnap.exists ? roleSnap.data() : null;
    for (const field of ['staffId', 'staffUserId']) if (s7Id(role?.[field]) && !matches.has(role[field])) {
      const linked = await read.doc('staff_users', role[field]);
      if (linked.exists) matches.set(linked.id, linked);
    }
    if (!role && !matches.size) return { uid, role: 'customer', staffId: '', name: 'Pelanggan', therapistIds: new Set() };
    if (!role || matches.size !== 1) throw s7Error(403, 'STAFF_MAPPING_CONFLICT');
    const masterSnap = [...matches.values()][0], master = masterSnap.data();
    const masterUid = s7UidFields(master, ['authUserId', 'authUid']);
    const roleUid = s7UidFields(role, ['authUserId', 'authUid']);
    if ((masterUid && masterUid !== uid) || (!masterUid && masterSnap.id !== uid) || (roleUid && roleUid !== uid)) throw s7Error(403, 'STAFF_UID_MISMATCH');
    if (s7Disabled(master) || s7Disabled(role) || role.isActive !== true) throw s7Error(403, 'STAFF_INACTIVE');
    if (master.isStaffMaster === false || (master.sourceSystem && master.sourceSystem !== 'STAFF_MASTER')) throw s7Error(403, 'STAFF_MASTER_CONFLICT');
    if (typeof master.role !== 'string' || role.role !== master.role || ![...s7Operational, 'therapist', 'staff'].includes(master.role)) throw s7Error(403, 'STAFF_ROLE_MISMATCH');
    const aliases = new Set([uid, masterSnap.id]);
    for (const alias of [master.id, master.uid]) if (alias !== undefined && alias !== null && alias !== '') {
      if (!s7Id(alias)) throw s7Error(403, 'STAFF_MAPPING_CONFLICT'); aliases.add(alias);
    }
    for (const linked of [role.staffId, role.staffUserId]) if (linked !== undefined && linked !== null && linked !== '' && (!s7Id(linked) || !aliases.has(linked))) throw s7Error(403, 'STAFF_MAPPING_CONFLICT');
    if (role.therapistId && master.therapistId && role.therapistId !== master.therapistId) throw s7Error(403, 'THERAPIST_MAPPING_CONFLICT');
    const therapistIds = new Set<string>();
    if (master.role === 'therapist') for (const id of [...aliases, role.therapistId, master.therapistId]) if (s7Id(id)) therapistIds.add(id);
    return { uid, role: master.role, staffId: masterSnap.id, name: s7Text(master.fullName || master.name || master.displayName, 120) || 'Staf Senzu Home', therapistIds };
  }
  async function s7Customer(read: ReturnType<typeof s7Reader>, id: string, expectedUid = ''): Promise<{ id: string; uid: string; name: string }> {
    if (!id) return { id: '', uid: expectedUid, name: 'Pelanggan' };
    const snap = await read.doc('customers', id);
    if (!snap.exists) { if (expectedUid) throw s7Error(409, 'CUSTOMER_PROFILE_MISSING'); return { id, uid: '', name: 'Pelanggan' }; }
    const data = snap.data(), uid = s7UidFields(data, ['authUserId', 'customerAuthUid']);
    if (s7Disabled(data) || (expectedUid && uid && expectedUid !== uid)) throw s7Error(403, 'CUSTOMER_OWNER_CONFLICT');
    return { id: snap.id, uid: uid || expectedUid, name: s7Text(data.name, 120) || 'Pelanggan' };
  }
  async function s7Therapist(read: ReturnType<typeof s7Reader>, therapistId: string, expectedUid = ''): Promise<{ uid: string; name: string }> {
    if (!therapistId) throw s7Error(409, 'THERAPIST_RECIPIENT_UNRESOLVED');
    const [snap, linked] = await Promise.all([read.doc('therapists', therapistId), read.query(adminDb.collection('staff_roles').where('therapistId', '==', therapistId).limit(2))]);
    if (!snap.exists || s7Disabled(snap.data())) throw s7Error(409, 'THERAPIST_RECIPIENT_UNRESOLVED');
    const ownUid = s7UidFields(snap.data(), ['authUserId', 'authUid']);
    const candidates = new Set<string>([ownUid, expectedUid, ...linked.docs.map((d: any) => d.id)].filter(Boolean));
    if (candidates.size !== 1) throw s7Error(409, 'THERAPIST_MAPPING_CONFLICT');
    const uid = [...candidates][0];
    const staff = await s7Caller(read, uid);
    if (staff.role !== 'therapist' || !staff.therapistIds.has(therapistId)) throw s7Error(409, 'THERAPIST_MAPPING_CONFLICT');
    return { uid, name: s7Text(snap.data().name, 120) || staff.name };
  }
  async function s7Booking(read: ReturnType<typeof s7Reader>, refs: Record<string, any>): Promise<{ id: string; data: any; snap: any } | null> {
    if (!refs.bookingId && !refs.bookingCode) return null;
    let snap: any;
    if (refs.bookingId) snap = await read.doc('bookings', refs.bookingId);
    else {
      const found = await read.query(adminDb.collection('bookings').where('bookingCode', '==', refs.bookingCode).limit(2));
      if (found.docs.length !== 1) throw s7Error(found.empty ? 404 : 409, 'BOOKING_REFERENCE_CONFLICT'); snap = found.docs[0];
    }
    if (!snap.exists) throw s7Error(404, 'BOOKING_NOT_FOUND');
    const data = snap.data();
    if (refs.bookingCode && data.bookingCode !== refs.bookingCode) throw s7Error(409, 'BOOKING_REFERENCE_CONFLICT');
    if (data.id !== undefined && data.id !== snap.id) throw s7Error(409, 'BOOKING_REFERENCE_CONFLICT');
    if (s7Id(data.bookingCode)) {
      const duplicates = await read.query(adminDb.collection('bookings').where('bookingCode', '==', data.bookingCode).limit(2));
      if (duplicates.docs.some((d: any) => d.id !== snap.id)) throw s7Error(409, 'BOOKING_REFERENCE_CONFLICT');
    }
    s7UidFields(data, ['customerAuthUid', 'authUserId']);
    return { id: snap.id, data, snap };
  }
  function s7AssertBookingCustomer(caller: S7Caller, source: S7Source): boolean {
    return Boolean(source.ownerUid && source.ownerUid === caller.uid);
  }
  async function s7AssignedCaller(read: ReturnType<typeof s7Reader>, caller: S7Caller, source: S7Source): Promise<boolean> {
    if (caller.role !== 'therapist' || !source.therapistId || !caller.therapistIds.has(source.therapistId)) return false;
    const target = await s7Therapist(read, source.therapistId, s7Text(source.booking?.therapistAuthUid));
    return target.uid === caller.uid;
  }
  async function s7Source(read: ReturnType<typeof s7Reader>, type: string, references: Record<string, any>): Promise<S7Source> {
    const refs = { ...references };
    let booking = await s7Booking(read, refs), entity: any = {}, version = '', entityCustomerId = refs.customerId || '';
    let entityId = '', kind = 'booking';
    const load = async (collection: string, id: string) => { const snap = await read.doc(collection, id); if (!snap.exists) throw s7Error(404, 'NOTIFICATION_SOURCE_NOT_FOUND'); return { ...snap.data(), id: snap.id }; };
    if (type === 'chat.message_received') {
      if (!booking || !s7Id(refs.messageId)) throw s7Error(400, 'CHAT_REFERENCE_INVALID');
      kind = 'chat';
      const message = await read.doc(`booking_chats/${booking.id}/messages`, refs.messageId);
      if (!message.exists) throw s7Error(404, 'CHAT_MESSAGE_NOT_FOUND');
      entity = message.data(); entityId = message.id;
      if (entity.bookingId !== booking.id || !s7Id(entity.senderUid) || !['CUSTOMER','THERAPIST','SYSTEM'].includes(entity.senderType)) throw s7Error(409, 'CHAT_MESSAGE_MISMATCH');
      if (entity.senderType === 'CUSTOMER') {
        if (s7UidFields(booking.data, ['customerAuthUid','authUserId']) !== entity.senderUid) throw s7Error(403, 'CHAT_SENDER_CONFLICT');
        const target = await s7Therapist(read, s7Text(booking.data.therapistId || booking.data.assignedTherapistId), s7Text(booking.data.therapistAuthUid));
        entity = { ...entity, recipientRole: 'therapist', recipientUid: target.uid };
      } else {
        const sender = await s7Caller(read, entity.senderUid);
        if (entity.senderType === 'THERAPIST') {
          const target = await s7Therapist(read, s7Text(booking.data.therapistId || booking.data.assignedTherapistId), s7Text(booking.data.therapistAuthUid));
          if (sender.role !== 'therapist' || target.uid !== entity.senderUid) throw s7Error(403, 'CHAT_SENDER_CONFLICT');
        } else if (!s7Operational.includes(sender.role)) throw s7Error(403, 'CHAT_SENDER_CONFLICT');
        const uid = s7UidFields(booking.data, ['customerAuthUid','authUserId']);
        if (!uid) throw s7Error(409, 'CHAT_RECIPIENT_UNRESOLVED');
        entity = { ...entity, recipientRole: 'customer', recipientUid: uid };
      }
      version = `${booking.id}:${entityId}:${entity.recipientUid}`;
    } else if (type.startsWith('payment.')) {
      kind = 'payment';
      let id = refs.paymentId;
      if (!id && booking?.data.activePaymentId) id = booking.data.activePaymentId;
      if (!id && booking) {
        const found = await read.query(adminDb.collection('payments').where('bookingId', '==', booking.id).limit(2));
        if (found.docs.length !== 1) throw s7Error(409, 'PAYMENT_REFERENCE_REVIEW_REQUIRED'); id = found.docs[0].id;
      }
      if (!id) throw s7Error(400, 'PAYMENT_REFERENCE_REQUIRED');
      entity = await load('payments', id); entityId = id; refs.paymentId = id;
      if (!s7Id(entity.bookingId)) throw s7Error(409, 'PAYMENT_LINKAGE_CONFLICT');
      if (booking && booking.id !== entity.bookingId) throw s7Error(409, 'PAYMENT_LINKAGE_CONFLICT');
      booking = booking || await s7Booking(read, { bookingId: entity.bookingId });
      const uid = s7UidFields(entity, ['customerAuthUid', 'authUserId']);
      const bUid = s7UidFields(booking!.data, ['customerAuthUid', 'authUserId']);
      if ((uid && bUid && uid !== bUid) || (entity.customerId && booking!.data.customerId && entity.customerId !== booking!.data.customerId) || (entity.bookingCode && entity.bookingCode !== booking!.data.bookingCode)) throw s7Error(409, 'PAYMENT_LINKAGE_CONFLICT');
      version = `${entityId}:${type}:${entity.paymentProofUploadedAt || entity.proofUploadedAt || entity.verifiedAt || entity.rejectedAt || entity.expiredAt || entity.createdAt || ''}`;
    } else if (['loyalty.points_earned', 'loyalty.points_redeemed', 'referral.qualified', 'birthday.reward_issued'].includes(type)) {
      kind = 'ledger';
      let id = refs.transactionId;
      if (!id && booking && type.startsWith('loyalty.points_')) {
        const found = await read.query(adminDb.collection('loyalty_transactions').where('bookingId', '==', booking.id).where('transactionType', '==', type.endsWith('earned') ? 'earn' : 'redeem').limit(2));
        if (found.docs.length !== 1) throw s7Error(409, 'LOYALTY_REFERENCE_REVIEW_REQUIRED'); id = found.docs[0].id;
      }
      if (!id) throw s7Error(400, 'LOYALTY_REFERENCE_REQUIRED');
      entity = await load('loyalty_transactions', id); entityId = id; refs.transactionId = id;
      if (!s7Id(entity.customerId) || !Number.isFinite(entity.points) || !Number.isFinite(entity.balanceAfter)) throw s7Error(409, 'LOYALTY_LEDGER_INVALID');
      if (entity.bookingId) {
        if (booking && booking.id !== entity.bookingId) throw s7Error(409, 'LOYALTY_BOOKING_CONFLICT');
        booking = booking || await s7Booking(read, { bookingId: entity.bookingId });
      }
      entityCustomerId = entity.customerId;
      if (refs.customerId && refs.customerId !== entityCustomerId) throw s7Error(409, 'LOYALTY_CUSTOMER_CONFLICT');
      const expected = type === 'loyalty.points_earned' ? 'earn' : type === 'loyalty.points_redeemed' ? 'redeem' : type === 'referral.qualified' ? 'referral_bonus' : 'birthday_bonus';
      if (entity.transactionType !== expected || (expected === 'redeem' ? entity.points >= 0 : entity.points <= 0)) throw s7Error(409, 'LOYALTY_EVENT_MISMATCH');
      if (type === 'referral.qualified') {
        const id = refs.referralId || entity.referenceId;
        const referral = await load('referrals', id);
        if (referral.referrerCustomerId !== entityCustomerId || !['qualified', 'rewarded'].includes(s7Text(referral.status).toLowerCase()) || entity.referenceId !== id || (referral.firstBookingId && referral.firstBookingId !== booking?.id)) throw s7Error(409, 'REFERRAL_LINKAGE_CONFLICT');
        refs.referralId = id; entity.referral = referral;
      }
      if (type === 'birthday.reward_issued') {
        const account = await load('loyalty_accounts', entityCustomerId);
        const year = refs.year || Number(String(entity.referenceId || '').split('_').at(-1));
        if (!Number.isInteger(year) || account.birthdayBenefitUsedYear !== year || entity.referenceId !== `${entityCustomerId}_${year}`) throw s7Error(409, 'BIRTHDAY_LEDGER_CONFLICT');
        refs.year = year;
      }
      version = `${entityId}:${type}`;
    } else if (type === 'membership.tier_upgraded') {
      kind = 'tier';
      if (!s7Id(entityCustomerId)) throw s7Error(400, 'CUSTOMER_REFERENCE_REQUIRED');
      entity = await load('loyalty_accounts', entityCustomerId); entityId = entityCustomerId;
      if (!s7Id(entity.currentTierId) || !s7Date(entity.tierStartedAt)) throw s7Error(409, 'TIER_REFERENCE_INVALID');
      const tier = await load('membership_tiers', entity.currentTierId); entity.tier = tier;
      version = `${entityCustomerId}:${entity.currentTierId}:${entity.tierStartedAt}`;
    } else if (type === 'voucher.issued') {
      kind = 'voucher';
      const id = refs.customerVoucherId || (String(refs.voucherId || '').startsWith('cv_') ? refs.voucherId : '');
      if (!s7Id(id)) throw s7Error(400, 'CUSTOMER_VOUCHER_REFERENCE_REQUIRED');
      entity = await load('customer_vouchers', id); entityId = id; refs.customerVoucherId = id;
      entityCustomerId = entity.customerId;
      if (!s7Id(entityCustomerId) || (refs.customerId && refs.customerId !== entityCustomerId) || (refs.voucherId && refs.voucherId !== id && refs.voucherId !== entity.voucherId)) throw s7Error(409, 'VOUCHER_LINKAGE_CONFLICT');
      version = `${id}:${entity.assignedAt || entity.issuedAt || entity.createdAt || ''}`;
    } else if (type.startsWith('therapist.shift_') || type === 'therapist.off_updated' || type === 'therapist.schedule_override') {
      kind = 'roster';
      if (!s7Id(refs.therapistId) || !refs.date) throw s7Error(400, 'ROSTER_REFERENCE_REQUIRED');
      const therapist = await load('therapists', refs.therapistId);
      let entries: any[];
      if (refs.date === 'Jadwal Mingguan Rutin') {
        if (!therapist.weeklySchedule || typeof therapist.weeklySchedule !== 'object') throw s7Error(409, 'ROSTER_SOURCE_MISSING');
        entries = Object.entries(therapist.weeklySchedule).map(([day, value]) => ({ day, value }));
      } else {
        const dates = refs.date.split(' s/d '), first = dates[0], last = dates[1] || first;
        if (!Number.isFinite(Date.parse(first)) || !Number.isFinite(Date.parse(last)) || last < first) throw s7Error(400, 'INVALID_ROSTER_DATE');
        const roster = await read.query(adminDb.collection('therapist_rosters').where('therapistId', '==', refs.therapistId));
        entries = roster.docs.map((s: any) => ({ ...s.data(), id: s.id })).filter((r: any) => typeof r.date === 'string' && r.date >= first && r.date <= last).map((r: any) => ({ id: r.id, date: r.date, status: r.status, shiftStart: r.shiftStart, shiftEnd: r.shiftEnd, isOff: r.isOff, reason: r.offReason || r.reason || '', updatedAt: r.updatedAt || '' })).sort((a: any, b: any) => a.id.localeCompare(b.id));
        if (!entries.length) throw s7Error(409, 'ROSTER_SOURCE_MISSING');
      }
      entity = { therapist, entries }; entityId = refs.therapistId;
      version = `${entityId}:${refs.date}:${s7Hash(entries)}`;
    } else if (type.startsWith('case.') || type.startsWith('recovery.')) {
      kind = 'case';
      if (!s7Id(refs.caseId)) throw s7Error(400, 'CASE_REFERENCE_REQUIRED');
      const snap = await read.doc('cases', refs.caseId), alternate = snap.exists ? snap : await read.doc('booking_cases', refs.caseId);
      if (!alternate.exists) throw s7Error(404, 'CASE_NOT_FOUND'); entity = { ...alternate.data(), id: alternate.id }; entityId = alternate.id;
      if (booking && entity.bookingId && booking.id !== entity.bookingId) throw s7Error(409, 'CASE_LINKAGE_CONFLICT');
      if (!booking && entity.bookingId) booking = await s7Booking(read, { bookingId: entity.bookingId });
      version = `${entityId}:${type}:${entity.status || ''}:${entity.updatedAt || entity.createdAt || ''}`;
    } else if (type.startsWith('review.')) {
      kind = 'review';
      if (!s7Id(refs.reviewId)) throw s7Error(400, 'REVIEW_REFERENCE_REQUIRED');
      entity = await load('reviews', refs.reviewId); entityId = entity.id;
      if (booking && entity.bookingId !== booking.id) throw s7Error(409, 'REVIEW_LINKAGE_CONFLICT');
      if (!booking && entity.bookingId) booking = await s7Booking(read, { bookingId: entity.bookingId });
      version = `${entityId}:${type}:${entity.createdAt || ''}`;
    }
    if (!booking && !['ledger', 'tier', 'voucher', 'roster'].includes(kind)) throw s7Error(400, 'PERSISTED_SOURCE_REQUIRED');
    const data = booking?.data || null;
    const bookingOwner = data ? s7UidFields(data, ['customerAuthUid', 'authUserId']) : '';
    if (!['ledger', 'tier', 'voucher'].includes(kind)) entityCustomerId = data?.customerId || entityCustomerId;
    if (data && refs.customerId && !['ledger'].includes(kind) && data.customerId !== refs.customerId) throw s7Error(409, 'CUSTOMER_LINKAGE_CONFLICT');
    const expectedUid = kind === 'ledger' && type === 'referral.qualified' ? '' : bookingOwner;
    const customer = await s7Customer(read, entityCustomerId, expectedUid);
    if (kind === 'ledger' && type !== 'referral.qualified' && data?.customerId && data.customerId !== entityCustomerId) throw s7Error(409, 'LOYALTY_CUSTOMER_CONFLICT');
    const therapistId = kind === 'roster' ? refs.therapistId : s7Text(data?.therapistId || data?.assignedTherapistId);
    if (refs.therapistId && therapistId && refs.therapistId !== therapistId) throw s7Error(409, 'THERAPIST_LINKAGE_CONFLICT');
    const payload: Record<string, any> = {
      ...(booking ? { bookingId: booking.id, bookingCode: data.bookingCode, customerName: s7Text(data.customerName, 120), serviceName: s7Text(data.serviceName, 160), scheduleAt: s7Text(data.scheduleAt, 80) || `${s7Text(data.date)} ${s7Text(data.time)}`.trim(), area: s7Text(data.area, 100), totalAmount: data.totalAmount } : {}),
      customerId: customer.id || undefined, customerName: customer.name, therapistId: therapistId || undefined, therapistName: s7Text(data?.therapistName || data?.assignedTherapistName, 120) || undefined,
    };
    if (kind === 'ledger') {
      payload.pointsEarned = Math.max(0, entity.points); payload.pointsRedeemed = Math.abs(entity.points); payload.newBalance = entity.balanceAfter;
      payload.discountAmount = Number(entity.metadata?.discountRp || entity.metadata?.discountAmount || 0);
      payload.pointsReward = entity.points; payload.referredCustomerName = s7Text(entity.referral?.refereeName || entity.referral?.referredCustomerName, 120) || 'Pelanggan';
    }
    if (kind === 'tier') { payload.newTierName = s7Text(entity.tier.name, 100); payload.earningMultiplier = entity.tier.earningMultiplier; }
    if (kind === 'voucher') payload.voucherName = s7Text(entity.voucherName || entity.name, 160) || 'Senzu Voucher';
    if (kind === 'payment') payload.rejectionReason = s7Text(entity.rejectionReason, 250) || 'Silakan hubungi Customer Service';
    if (kind === 'booking') {
      entity = data;
      const stampField: Record<string, string> = { 'booking.created': 'createdAt', 'booking.confirmed': 'confirmedAt', 'booking.cancelled': 'cancelledAt', 'booking.ready_for_assignment': 'paymentVerifiedAt', 'therapist.assigned': 'assignedAt', 'therapist.reassigned': 'assignedAt', 'therapist.accepted': 'acceptedAt', 'therapist.on_the_way': 'onTheWayAt', 'therapist.arrived': 'arrivedAt', 'treatment.started': 'treatmentStartedAt', 'treatment.completed': 'completedAt' };
      version = `${booking!.id}:${type}:${data[stampField[type]] || ''}:${['therapist.assigned','therapist.reassigned'].includes(type) ? therapistId : ''}`;
      if (type === 'therapist.nearby') version = `${booking!.id}:${type}:${therapistId}:${data.assignedAt || ''}`;
      if (type === 'tracking.location_stale') {
        const location = await read.doc('therapist_locations', booking!.id);
        version = `${booking!.id}:${type}:${therapistId}:${location.exists ? s7Date(location.data().updatedAt || location.data().timestamp) : 'missing'}`;
      }
      if (['supervisor.unassigned_alert', 'therapist.not_accepted_alert', 'therapist.late_departure_alert', 'booking.reminder'].includes(type)) version = `${booking!.id}:${type}:${data.scheduleAt || `${data.date} ${data.time}`}:${data.assignedAt || ''}`;
    }
    refs.bookingId = booking?.id || undefined; delete refs.bookingCode;
    return { type, references: s7Json(refs), booking: data, bookingId: booking?.id || '', customerId: customer.id, customerUid: customer.uid, therapistId, payload: s7Json(payload), version, entity, ownerUid: bookingOwner || customer.uid };
  }
  async function s7AuthorizeSource(read: ReturnType<typeof s7Reader>, caller: S7Caller, source: S7Source): Promise<void> {
    if (s7Operational.includes(caller.role)) {
      if (source.type.startsWith('therapist.shift_') || source.type === 'therapist.off_updated' || source.type === 'therapist.schedule_override') {
        if (!['supervisor', 'manager', 'admin'].includes(caller.role)) throw s7Error(403, 'EVENT_PERMISSION_DENIED');
      }
      return;
    }
    const ownerEvents = ['booking.created', 'booking.cancelled', 'payment.proof_uploaded', 'payment.expired', 'therapist.nearby', 'loyalty.points_earned', 'loyalty.points_redeemed', 'membership.tier_upgraded', 'voucher.issued', 'referral.qualified', 'birthday.reward_issued', 'review.low_rating'];
    const owner = source.booking && !['referral.qualified','birthday.reward_issued','membership.tier_upgraded','voucher.issued','loyalty.points_earned','loyalty.points_redeemed'].includes(source.type)
      ? s7AssertBookingCustomer(caller, source) : caller.uid === source.customerUid || s7AssertBookingCustomer(caller, source);
    if ((ownerEvents.includes(source.type) || source.type.startsWith('case.')) && owner) return;
    const therapistEvents = ['therapist.accepted', 'therapist.on_the_way', 'therapist.nearby', 'therapist.arrived', 'treatment.started', 'treatment.completed', 'loyalty.points_earned', 'membership.tier_upgraded', 'referral.qualified'];
    if ((therapistEvents.includes(source.type) || source.type.startsWith('case.')) && await s7AssignedCaller(read, caller, source)) return;
    throw s7Error(403, 'EVENT_PERMISSION_DENIED');
  }
  async function s7Settings(read: ReturnType<typeof s7Reader>): Promise<any> {
    const snap = await read.doc('notification_settings', 'default');
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...(snap.exists ? snap.data() : {}) };
  }
  async function s7Eligible(read: ReturnType<typeof s7Reader>, source: S7Source, settings: any): Promise<void> {
    const b = source.booking || {}, type = source.type, status = s7Text(b.status).toLowerCase(), entity = source.entity;
    const paymentStatus = s7Text(entity.status || b.paymentStatus).toLowerCase();
    const requireState = (valid: any) => { if (!valid) throw s7Error(409, 'EVENT_SOURCE_STATE_MISMATCH'); };
    const progressed = ['confirmed', 'assigned', 'accepted', 'on the way', 'arrived', 'treatment', 'completed'];
    if (type === 'chat.message_received') {
      const chat = await read.doc('booking_chats', source.bookingId);
      requireState(!['completed','cancelled','rescheduled','rejected','dibatalkan','selesai','expired'].includes(status) && !['expired','refunded','payment_rejected'].includes(s7Text(b.paymentStatus).toLowerCase()) && !(chat.exists && s7Text(chat.data().status).toLowerCase() === 'closed'));
    }
    if (type === 'booking.confirmed') requireState(Boolean(b.confirmedAt) || progressed.includes(status));
    if (type === 'booking.cancelled') requireState(['cancelled', 'dibatalkan'].includes(status));
    if (type === 'booking.ready_for_assignment') requireState(['paid', 'verified', 'terverifikasi'].includes(s7Text(b.paymentStatus).toLowerCase()) && !source.therapistId);
    if (['therapist.assigned', 'therapist.reassigned'].includes(type)) requireState(source.therapistId && b.assignedAt && !['cancelled', 'completed'].includes(status));
    if (type === 'therapist.reassigned') requireState(b.isReassigned === true || b.reassignedFromTherapistId);
    const transition: Record<string, [string, string[]]> = {
      'therapist.accepted': ['acceptedAt', ['accepted', 'on the way', 'arrived', 'treatment', 'completed']],
      'therapist.on_the_way': ['onTheWayAt', ['on the way', 'arrived', 'treatment', 'completed']],
      'therapist.arrived': ['arrivedAt', ['arrived', 'treatment', 'completed']],
      'treatment.started': ['treatmentStartedAt', ['treatment', 'completed']],
      'treatment.completed': ['completedAt', ['completed']],
    };
    if (transition[type]) requireState(source.therapistId && (s7Date(b[transition[type][0]]) || transition[type][1].includes(status)));
    if (type === 'payment.proof_uploaded') requireState(typeof entity.paymentProofUrl === 'string' && entity.paymentProofUrl.length > 0 && ['pending_manual_verification', 'paid', 'verified', 'pending_verification'].includes(paymentStatus));
    if (type === 'payment.verified') requireState(['paid', 'verified', 'settled'].includes(paymentStatus));
    if (type === 'payment.rejected') requireState(['payment_rejected', 'rejected'].includes(paymentStatus));
    if (type === 'payment.expired') requireState(paymentStatus === 'expired');
    if (type === 'review.low_rating') requireState(Number(entity.overallRating) <= 2 && Number(entity.overallRating) >= 1);
    if (type === 'case.high_severity') requireState(['HIGH', 'CRITICAL'].includes(entity.severity));
    if (type === 'therapist.nearby' || type === 'tracking.location_stale') {
      const snap = await read.doc('therapist_locations', source.bookingId);
      requireState(snap.exists && source.therapistId && status === 'on the way');
      const loc = snap.data();
      requireState(loc.bookingId === source.bookingId && loc.therapistId === source.therapistId);
      const updated = s7Date(loc.updatedAt || loc.timestamp), age = Date.now() - Date.parse(updated);
      if (type === 'tracking.location_stale') {
        requireState(settings.staleGpsAlert && Number.isFinite(age) && age >= Math.max(1, Number(settings.gpsStaleMinutes) || 3) * 60000);
      } else {
        requireState(settings.nearbyNotification && Number.isFinite(age) && age >= -60000 && age < 5 * 60000);
        const coords = [loc.latitude, loc.longitude, b.latitude, b.longitude];
        requireState(coords.every(v => typeof v === 'number' && Number.isFinite(v)));
        const rad = (n: number) => n * Math.PI / 180;
        const a = Math.sin(rad(loc.latitude - b.latitude) / 2) ** 2 + Math.cos(rad(b.latitude)) * Math.cos(rad(loc.latitude)) * Math.sin(rad(loc.longitude - b.longitude) / 2) ** 2;
        const distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        requireState(distance <= Math.max(0.1, Number(settings.nearbyDistanceKm) || 1));
      }
    }
    if (type === 'supervisor.unassigned_alert' || type === 'therapist.not_accepted_alert' || type === 'therapist.late_departure_alert' || type === 'booking.reminder') {
      const schedule = s7Date(b.scheduleAt) || s7Date(`${b.date}T${b.time}:00+07:00`), until = Date.parse(schedule) - Date.now();
      requireState(Number.isFinite(until) && !['completed', 'cancelled'].includes(status));
      if (type === 'supervisor.unassigned_alert') requireState(!source.therapistId && ['paid', 'verified', 'terverifikasi'].includes(s7Text(b.paymentStatus).toLowerCase()) && until <= Math.max(1, settings.assignmentAlertMinutes) * 60000);
      if (type === 'therapist.not_accepted_alert') requireState(source.therapistId && !b.acceptedAt && Date.now() - Date.parse(s7Date(b.assignedAt)) >= Math.max(1, settings.therapistNotAcceptedMinutes) * 60000);
      if (type === 'therapist.late_departure_alert') requireState(source.therapistId && !b.onTheWayAt && until < -Math.max(1, settings.lateDepartureBufferMinutes) * 60000);
      if (type === 'booking.reminder') requireState(settings.bookingReminder && until > 0 && until <= Math.max(1, settings.reminderMinutes) * 60000);
    }
    if (source.type === 'membership.tier_upgraded' && source.references.tierStartedAt) requireState(s7Date(entity.tierStartedAt) === source.references.tierStartedAt);
  }
  const s7SafeAction = (url: unknown): url is string => typeof url === 'string' && url.length <= 400 && /^\/(?:\?|$|(?:track|css|reconciliation|supervisor|therapist|portal|crm|loyalty)(?:[/?]|$))/.test(url) && !/[\\\u0000-\u0020]/.test(url) && !url.startsWith('//');
  const s7Core = (data: any): any => {
    const result = { ...data }; for (const key of ['read', 'readAt', 'updatedAt']) delete result[key]; return s7Json(result);
  };
  async function s7Unused(read: ReturnType<typeof s7Reader>, collection: string, preferred: string): Promise<string> {
    let id = preferred;
    for (let attempt = 0; attempt < 4; attempt++) { if (!(await read.doc(collection, id)).exists) return id; id = s7NewId(preferred.slice(0, 30)); }
    throw s7Error(503, 'NOTIFICATION_ID_COLLISION');
  }
  function s7ValidateReceipt(data: any, kind: string): void {
    if (!data || data.schemaVersion !== 1 || data.kind !== kind || !s7Id(data.eventId) || !Array.isArray(data.notificationIds) || data.notificationIds.some((id: any) => !s7Id(id)) || !s7Date(data.createdAt) || !data.response || data.response.eventId !== data.eventId || data.responseFingerprint !== s7Hash(data.response)) throw s7Error(409, 'NOTIFICATION_RECEIPT_CORRUPTED');
  }
  async function s7Replay(read: ReturnType<typeof s7Reader>, data: any, kind: string): Promise<any> {
    s7ValidateReceipt(data, kind);
    const event = await read.doc('notification_events', data.eventId);
    if (!event.exists || data.eventFingerprint !== s7Hash(event.data())) throw s7Error(409, 'NOTIFICATION_RECEIPT_CORRUPTED');
    return { ...data.response, isIdempotent: true };
  }
  async function s7Recipients(read: ReturnType<typeof s7Reader>, source: S7Source, settings: any, callerName: string, guest = false): Promise<any[]> {
    if (source.type === 'chat.message_received') return [{ recipientRole: source.entity.recipientRole, recipientUserId: source.entity.recipientUid, title: 'Senzu Home', message: source.entity.recipientRole === 'therapist' ? 'Pesan baru dari customer.' : 'Pesan baru dari terapis Anda.', actionUrl: `/?openChat=${encodeURIComponent(source.bookingId)}`, priority: 'HIGH' }];
    const targets: any[] = resolveNotificationTargets(source.type as any, source.payload, settings);
    if (['therapist.shift_updated', 'therapist.off_updated', 'therapist.schedule_override'].includes(source.type)) {
      const entries = source.entity.entries || [];
      const summaries = entries.slice(0, 10).map((r: any) => r.day ? `${r.day}: ${JSON.stringify(r.value)}` : `${r.date}: ${r.shiftStart || '-'}–${r.shiftEnd || '-'} (${r.status || 'diperbarui'})`).join('; ');
      targets.push({ recipientRole: 'therapist', therapistId: source.therapistId, title: 'Pembaruan Jadwal Kerja', message: `Jadwal ${source.references.date} telah diperbarui oleh ${callerName}. ${summaries}`, actionUrl: '/therapist', priority: 'NORMAL' });
    }
    const resolved: any[] = [];
    (source as any).recipientReviewRoles = [];
    for (const target of targets) {
      if (guest && !['css', 'manager'].includes(target.recipientRole)) continue;
      let uid = '';
      if (target.recipientRole === 'customer') { uid = source.customerUid; if (!uid) { (source as any).recipientReviewRoles.push('customer'); continue; } }
      else if (target.recipientRole === 'therapist') {
        try { uid = (await s7Therapist(read, target.therapistId || source.therapistId, s7Text(source.booking?.therapistAuthUid))).uid; }
        catch (err: any) { if (![403, 409].includes(err.statusCode)) throw err; (source as any).recipientReviewRoles.push('therapist'); continue; }
      } else if (!s7Operational.includes(target.recipientRole)) continue;
      if (!s7SafeAction(target.actionUrl)) throw s7Error(409, 'NOTIFICATION_ACTION_INVALID');
      resolved.push({ recipientRole: target.recipientRole, ...(uid ? { recipientUserId: uid } : {}), title: s7Text(target.title, 200), message: s7Text(target.message, 1000), priority: target.priority, actionUrl: target.actionUrl });
    }
    return resolved;
  }
  async function s7PersistEvent(transaction: any, read: ReturnType<typeof s7Reader>, source: S7Source, caller: S7Caller, settings: any, request: { id: string; fingerprint: string } | null, guest = false): Promise<any> {
    const semanticId = `s7s_${s7Hash([source.type, source.version])}`;
    const guardSnap = await read.doc('notification_private_receipts', semanticId);
    if (guardSnap.exists) {
      const guard = guardSnap.data();
      if (guard.type !== source.type || guard.version !== source.version) throw s7Error(409, 'NOTIFICATION_RECEIPT_CONFLICT');
      const response = await s7Replay(read, guard, 'semantic');
      if (request) transaction.create(adminDb.collection('notification_private_receipts').doc(request.id), { ...guard, kind: 'request', actorUid: caller.uid, requestFingerprint: request.fingerprint });
      return response;
    }
    // Existing voucher checkout writes this alert atomically with the booking.
    if (!guest && source.type === 'booking.created') {
      const receipts = await read.query(adminDb.collection('voucher_checkout_receipts').where('bookingId', '==', source.bookingId).limit(2));
      if (receipts.docs.length > 1) throw s7Error(409, 'CHECKOUT_NOTIFICATION_REVIEW_REQUIRED');
      if (receipts.docs.length === 1) {
        const receipt = receipts.docs[0].data(), eventId = `evt_checkout_${source.bookingId}`;
        if (receipt.schemaVersion !== 2 || receipt.bookingEventId !== eventId || receipt.customerAuthUid !== source.customerUid || receipt.bookingCode !== source.booking.bookingCode || !s7Date(receipt.committedAt)) throw s7Error(409, 'CHECKOUT_NOTIFICATION_REVIEW_REQUIRED');
        const eventSnap = await read.doc('notification_events', eventId);
        if (!eventSnap.exists || eventSnap.data().eventType !== source.type || eventSnap.data().bookingId !== source.bookingId) throw s7Error(409, 'CHECKOUT_NOTIFICATION_REVIEW_REQUIRED');
        const ids: string[] = [];
        for (const role of ['css', 'manager', 'customer']) { const n = await read.doc('notifications', `notif_checkout_${source.bookingId}_${role}`); if (n.exists) ids.push(n.id); }
        const response = { success: true, eventId, notificationIds: ids, isIdempotent: true };
        const guard = { schemaVersion: 1, kind: 'semantic', type: source.type, version: source.version, eventId, notificationIds: ids, createdAt: s7Date(receipt.committedAt), eventFingerprint: s7Hash(eventSnap.data()), response, responseFingerprint: s7Hash(response) };
        transaction.create(adminDb.collection('notification_private_receipts').doc(semanticId), guard);
        if (request) transaction.create(adminDb.collection('notification_private_receipts').doc(request.id), { ...guard, kind: 'request', actorUid: caller.uid, requestFingerprint: request.fingerprint });
        return response;
      }
    }
    await s7Eligible(read, source, settings);
    const targets = await s7Recipients(read, source, settings, caller.name, guest);
    const eventId = await s7Unused(read, 'notification_events', `evt_${semanticId}`), now = new Date().toISOString();
    const eventCreatedAt = guest ? s7Date((source as any).initialCreatedAt) : now;
    if (!eventCreatedAt) throw s7Error(409, 'NOTIFICATION_CREATION_TIME_UNVERIFIED');
    const notifications: any[] = [], deliveries: any[] = [];
    for (const target of targets) {
      const id = await s7Unused(read, 'notifications', `notif_${semanticId}_${target.recipientRole}`);
      const deliveryId = await s7Unused(read, 'notification_deliveries', `del_${s7Hash([id, 'in_app']).slice(0, 40)}`);
      const metadata: any = {}; for (const key of ['bookingId', 'bookingCode', 'customerId', 'therapistId', 'caseId', 'caseCode', 'transactionId', 'customerVoucherId']) if (source.references[key]) metadata[key] = source.references[key];
      notifications.push(s7Json({ id, eventId, eventType: source.type, ...target, ...(source.bookingId ? { bookingId: source.bookingId, bookingCode: source.booking.bookingCode } : {}), ...(source.customerId ? { customerId: source.customerId } : {}), ...(source.therapistId ? { therapistId: source.therapistId } : {}), channel: 'in_app', read: false, readAt: null, createdAt: eventCreatedAt, provenanceId: semanticId, metadata }));
      deliveries.push({ id: deliveryId, notificationId: id, eventId, channel: 'in_app', recipient: target.recipientUserId || target.recipientRole, status: 'delivered', sentAt: now, deliveredAt: now, retryCount: 0, createdAt: now });
      if (settings.pushEnabled) {
        const pushId = await s7Unused(read, 'notification_deliveries', `del_${s7Hash([id, 'push']).slice(0, 40)}`);
        deliveries.push({ id: pushId, notificationId: id, eventId, channel: 'push', recipient: target.recipientUserId || target.recipientRole, status: 'pending', failureReason: 'TRANSPORT_NOT_ATTEMPTED', retryCount: 0, createdAt: now });
      }
      for (const channel of ['whatsapp', 'email']) if (settings[`${channel}Enabled`]) {
        const externalId = await s7Unused(read, 'notification_deliveries', `del_${s7Hash([id, channel]).slice(0, 40)}`);
        deliveries.push({ id: externalId, notificationId: id, eventId, channel, recipient: target.recipientUserId || target.recipientRole, status: 'pending', failureReason: 'PROVIDER_NOT_CONFIGURED', retryCount: 0, createdAt: now });
      }
    }
    const event = s7Json({ id: eventId, eventType: source.type, ...(source.bookingId ? { bookingId: source.bookingId } : {}), actorId: caller.staffId || caller.uid, actorRole: caller.role, payload: source.payload, createdAt: eventCreatedAt, processedAt: now, status: 'processed', targetCount: targets.length, skippedRecipientRoles: (source as any).recipientReviewRoles || [], reviewRequired: Boolean((source as any).recipientReviewRoles?.length) });
    const response = { success: true, eventId, notificationIds: notifications.map(n => n.id), isIdempotent: false };
    const guard = { schemaVersion: 1, kind: 'semantic', type: source.type, version: source.version, source: { type: source.type, references: source.references }, eventId, notificationIds: response.notificationIds, notificationHashes: Object.fromEntries(notifications.map(n => [n.id, s7Hash(s7Core(n))])), createdAt: now, eventFingerprint: s7Hash(event), response, responseFingerprint: s7Hash(response) };
    // All authorization/entity/settings/collision reads above precede the first write.
    transaction.create(adminDb.collection('notification_events').doc(eventId), event);
    notifications.forEach(n => transaction.create(adminDb.collection('notifications').doc(n.id), n));
    deliveries.forEach(d => transaction.create(adminDb.collection('notification_deliveries').doc(d.id), d));
    transaction.create(adminDb.collection('notification_private_receipts').doc(semanticId), guard);
    if (request) transaction.create(adminDb.collection('notification_private_receipts').doc(request.id), { ...guard, kind: 'request', actorUid: caller.uid, requestFingerprint: request.fingerprint });
    return response;
  }
  function s7Audience(data: any, caller: S7Caller): boolean {
    const role = s7Text(data.recipientRole), addressed = [data.recipientUserId, data.recipientId].filter(v => v !== undefined && v !== null && v !== '');
    if (addressed.some(v => !s7Id(v))) return false;
    if (role === 'customer') return caller.role === 'customer' || data.recipientUserId === caller.uid;
    if (role === 'therapist') return caller.role === 'therapist';
    const roles = ['manager', 'admin'].includes(caller.role) ? s7Operational : [caller.role];
    if (!s7Operational.includes(caller.role) || !roles.includes(role)) return false;
    return addressed.every(value => value === caller.uid || value === caller.staffId || value === role);
  }
  async function s7Visible(read: ReturnType<typeof s7Reader>, caller: S7Caller, snap: any): Promise<any | null> {
    if (!snap.exists || !s7Id(snap.id)) return null;
    const data = snap.data();
    if (!s7Audience(data, caller)) return null;
    let source: S7Source, content = data, createdAt = s7Date(data.createdAt);
    try {
      if (data.provenanceId) {
        if (!s7Id(data.provenanceId)) return null;
        const guardSnap = await read.doc('notification_private_receipts', data.provenanceId);
        if (!guardSnap.exists) return null;
        const guard = guardSnap.data();
        s7ValidateReceipt(guard, 'semantic');
        if (guard.notificationHashes?.[snap.id] !== s7Hash(s7Core(data)) || !guard.notificationIds.includes(snap.id) || guard.eventId !== data.eventId || !guard.source || guard.source.type !== data.eventType) return null;
        source = await s7Source(read, guard.source.type, guard.source.references);
        const event = await read.doc('notification_events', guard.eventId);
        if (!event.exists || s7Hash(event.data()) !== guard.eventFingerprint) return null;
      } else {
        // Historic public rows are pointers, never trusted text, actor, URL or identity proof.
        if ((!s7EventTypes.has(data.eventType) && data.eventType !== 'chat.message_received') || !s7Id(data.bookingId)) return null;
        const messageId = data.metadata?.messageId;
        if (data.eventType === 'chat.message_received' && !s7Id(messageId)) return null;
        source = await s7Source(read, data.eventType, { bookingId: data.bookingId, ...(s7Id(data.paymentId) ? { paymentId: data.paymentId } : {}), ...(s7Id(messageId) ? { messageId } : {}) });
        if (data.eventType === 'chat.message_received') {
          const legacy = await read.doc('chat_notification_dispatches', `chat_notif_${messageId}`);
          if (!legacy.exists || legacy.data().bookingId !== source.bookingId || legacy.data().messageId !== messageId || legacy.data().notificationId !== snap.id || legacy.data().recipientUserId !== source.entity.recipientUid) return null;
        }
        if (data.bookingCode && data.bookingCode !== source.booking?.bookingCode) return null;
        const settings = await s7Settings(read);
        await s7Eligible(read, source, settings);
        const targets = await s7Recipients(read, source, settings, 'Sistem Senzu Home');
        const target = targets.find(target => target.recipientRole === data.recipientRole && (!target.recipientUserId || target.recipientUserId === caller.uid));
        if (!target) return null;
        content = { ...target, eventId: s7Id(data.eventId) ? data.eventId : `legacy_${s7Hash([source.type, source.bookingId]).slice(0, 32)}`, eventType: source.type, bookingId: source.bookingId, bookingCode: source.booking?.bookingCode, customerId: source.customerId, therapistId: source.therapistId, read: data.read === true, readAt: s7Date(data.readAt) || null };
        createdAt = s7Date(snap.createTime) || s7Date(source.booking?.createdAt);
      }
      if (data.recipientRole === 'customer') {
        if (source.customerUid !== caller.uid || (source.booking && s7UidFields(source.booking, ['customerAuthUid', 'authUserId']) !== caller.uid)) return null;
        const aliases = new Set([caller.uid, source.customerId]);
        if ([data.recipientUserId, data.recipientId].some(v => v && !aliases.has(v))) return null;
        if (s7UidFields(data, ['customerAuthUid', 'authUserId']) && s7UidFields(data, ['customerAuthUid', 'authUserId']) !== caller.uid) return null;
      }
      if (data.recipientRole === 'therapist') {
        const therapist = await s7Therapist(read, source.therapistId, s7Text(source.booking?.therapistAuthUid));
        if (therapist.uid !== caller.uid) return null;
        const aliases = new Set([caller.uid, caller.staffId, source.therapistId]);
        if ([data.recipientUserId, data.recipientId, data.therapistId].some(v => v && !aliases.has(v))) return null;
      }
    } catch (err: any) { if ([403, 404, 409, 400].includes(err.statusCode)) return null; throw err; }
    if (!s7Date(createdAt) || !s7SafeAction(content.actionUrl) || !s7Id(content.eventId)) return null;
    const result: any = { id: snap.id, eventId: content.eventId, eventType: content.eventType, recipientRole: data.recipientRole, title: s7Text(content.title, 200), message: s7Text(content.message, 1000), actionUrl: content.actionUrl, channel: 'in_app', priority: ['LOW','NORMAL','HIGH','CRITICAL'].includes(content.priority) ? content.priority : 'NORMAL', read: data.read === true, readAt: s7Date(data.readAt) || null, createdAt };
    for (const key of ['bookingId', 'bookingCode', 'customerId', 'therapistId', 'caseId', 'caseCode', 'recipientUserId']) if (s7Id(content[key])) result[key] = content[key];
    return result;
  }
  async function s7Inbox(read: ReturnType<typeof s7Reader>, caller: S7Caller, window?: { limit: number; bookingId?: string; bookingCode?: string }): Promise<any[]> {
    const candidates = new Map<string, any>();
    const collect = async (query: any) => {
      let after: any = null;
      for (let page = 0; page < 50; page++) {
        const snap = await read.query(after ? query.limit(200).startAfter(after) : query.limit(200));
        snap.docs.forEach((d: any) => candidates.set(d.id, d));
        if (snap.docs.length < 200) return;
        after = snap.docs.at(-1);
      }
      throw s7Error(503, 'INBOX_PAGE_LIMIT', 'Daftar notifikasi terlalu besar untuk diproses sekaligus.');
    };
    if (s7Operational.includes(caller.role)) {
      const roles = ['manager', 'admin'].includes(caller.role) ? s7Operational : [caller.role];
      for (const role of roles) await collect(adminDb.collection('notifications').where('recipientRole', '==', role));
    } else {
      const ids = new Set([caller.uid]);
      if (caller.role === 'therapist') caller.therapistIds.forEach(id => ids.add(id));
      else {
        for (const field of ['authUserId', 'customerAuthUid']) {
          const owned = await read.query(adminDb.collection('customers').where(field, '==', caller.uid));
          owned.docs.forEach((d: any) => ids.add(d.id));
        }
      }
      for (const id of ids) for (const field of ['recipientUserId', 'recipientId']) await collect(adminDb.collection('notifications').where(field, '==', id));
      if (caller.role === 'customer') await collect(adminDb.collection('notifications').where('customerAuthUid', '==', caller.uid));
    }
    if (s7Operational.includes(caller.role)) await collect(adminDb.collection('notifications').where('recipientUserId', '==', caller.uid));
    const visible: any[] = [];
    // Candidate order must match the eventual DTO timestamp. Legacy text dates are untrusted;
    // Firestore snapshot creation time is authoritative for legacy rows.
    const candidateTime = (snap: any): number => {
      const data = snap.data(), iso = s7Date(data.provenanceId ? data.createdAt : snap.createTime);
      return iso ? Date.parse(iso) : Infinity; // Resolve unknown legacy dates before stopping early.
    };
    const ordered = [...candidates.values()].map(snap => ({ snap, time: candidateTime(snap) })).sort((a, b) =>
      (a.time === b.time ? 0 : a.time > b.time ? -1 : 1) || b.snap.id.localeCompare(a.snap.id)
    ).map(item => item.snap);
    // Bound source lookups to eight at a time; bulk actions still inspect their full scope.
    for (let offset = 0; offset < ordered.length; offset += 8) {
      const items = await Promise.all(ordered.slice(offset, offset + 8).map(snap => s7Visible(read, caller, snap)));
      for (const item of items) if (item && (!window?.bookingId || item.bookingId === window.bookingId) && (!window?.bookingCode || item.bookingCode === window.bookingCode)) visible.push(item);
      if (window && visible.length >= window.limit) break;
    }
    return visible.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  }
  async function s7Push(notificationIds: string[]): Promise<void> {
    for (const id of notificationIds) {
      const setup = await adminDb.runTransaction(async (transaction: any) => {
        const read = s7Reader(transaction), snap = await read.doc('notifications', id);
        if (!snap.exists) return null;
        const n = snap.data(), guardSnap = n.provenanceId ? await read.doc('notification_private_receipts', n.provenanceId) : null;
        if (!guardSnap?.exists || guardSnap.data().notificationHashes?.[id] !== s7Hash(s7Core(n))) return null;
        const deliveries = await read.query(adminDb.collection('notification_deliveries').where('notificationId', '==', id).where('channel', '==', 'push'));
        if (deliveries.docs.length !== 1 || deliveries.docs[0].data().status !== 'pending') return null;
        const source = await s7Source(read, guardSnap.data().source.type, guardSnap.data().source.references);
        const deviceSnap = await read.query(adminDb.collection('notification_devices').where('role', '==', n.recipientRole));
        const tokens: string[] = [];
        for (const device of deviceSnap.docs) {
          const d = device.data();
          let uid: string;
          try { uid = s7UidFields(d, ['authUid', 'userId']); } catch { continue; }
          if (!uid || d.enabled === false || !/^[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{80,}$/.test(d.token || '') || /^(?:token_|dev_|device_)/i.test(d.token || '')) continue;
          if (n.recipientUserId && n.recipientUserId !== uid) continue;
          try {
            const caller = await s7Caller(read, uid);
            if (n.recipientRole === 'customer') { if (caller.role !== 'customer' || source.customerUid !== uid) continue; }
            else if (n.recipientRole === 'therapist') { if ((await s7Therapist(read, source.therapistId, s7Text(source.booking?.therapistAuthUid))).uid !== uid) continue; }
            else if (caller.role !== n.recipientRole) continue;
            tokens.push(d.token);
          } catch (error: any) { if (![403, 409].includes(error.statusCode)) throw error; }
        }
        return { n, delivery: deliveries.docs[0].ref, tokens: [...new Set(tokens)].slice(0, 500) };
      });
      if (!setup) continue;
      if (!adminMessaging || !setup.tokens.length) {
        await setup.delivery.update({ status: 'pending', failureReason: !adminMessaging ? 'FCM_NOT_CONFIGURED' : 'NO_VERIFIED_FCM_DEVICE', retryCount: 0 });
        continue;
      }
      // A successful FCM response is acceptance by FCM, not proof of display on a handset.
      try {
        const result = await adminMessaging.sendEachForMulticast({ tokens: setup.tokens, notification: { title: setup.n.title, body: setup.n.message }, data: { notificationId: id, actionUrl: setup.n.actionUrl } });
        await setup.delivery.update(result.successCount > 0 ? { status: 'sent', sentAt: new Date().toISOString(), retryCount: 0, acceptedCount: result.successCount, failedCount: result.failureCount, failureReason: result.failureCount ? 'PARTIAL_FCM_ACCEPTANCE' : null } : { status: 'failed', failedAt: new Date().toISOString(), retryCount: 0, failureReason: 'FCM_REJECTED' });
      } catch { await setup.delivery.update({ status: 'failed', failedAt: new Date().toISOString(), retryCount: 0, failureReason: 'FCM_REQUEST_FAILED' }); }
    }
  }
  function s7Route(handler: (req: express.Request, uid: string, deadlineAt: number) => Promise<any>, readTimeoutMs = 0) {
    return async (req: express.Request, res: express.Response) => {
      res.setHeader('Cache-Control', 'no-store');
      const startedAt = Date.now(), deadlineAt = readTimeoutMs ? startedAt + readTimeoutMs : 0;
      try {
        const result = await s7WithinReadDeadline(async () => {
          const uid = await s7Verify(req);
          (req as any).authUid = uid; // Logging marker, derived only from the verified token.
          if (deadlineAt && Date.now() >= deadlineAt) throw s7Error(503, 'NOTIFICATION_READ_TIMEOUT');
          return handler(req, uid, deadlineAt);
        }, deadlineAt);
        res.status(200).json(result);
      }
      catch (error: any) {
        const status = [400, 401, 403, 404, 409, 429, 503].includes(error.statusCode) ? error.statusCode : 503;
        if (readTimeoutMs && status === 503) console.warn(JSON.stringify({
          severity: 'ERROR', event: 'notification_inbox_read_failed',
          code: error.statusCode ? s7Text(error.code, 80) : 'NOTIFICATION_UNAVAILABLE',
          databaseCode: typeof error.code === 'number' || /^[A-Za-z0-9_/-]{1,80}$/.test(error.code || '') ? error.code : 'UNKNOWN',
          phase: (req as any).authUid ? 'database' : 'authentication', latencyMs: Date.now() - startedAt,
        }));
        res.status(status).json({ success: false, code: error.statusCode ? error.code : 'NOTIFICATION_UNAVAILABLE', message: status === 503 ? 'Layanan notifikasi belum tersedia. Silakan coba lagi.' : error.message });
      }
    };
  }
  app.post('/api/notifications/emit', s7Route(async (req, uid) => {
    const body = s7Body(req.body, ['eventType', 'references', 'requestId']);
    if (!s7EventTypes.has(body.eventType) || !s7Id(body.requestId)) throw s7Error(400, 'INVALID_NOTIFICATION_EVENT');
    const refs = s7References(body.references), fingerprint = s7Hash([body.eventType, refs]);
    const requestId = `s7r_${s7Hash(['emit', uid, body.requestId])}`;
    const result = await adminDb.runTransaction(async (transaction: any) => {
      const read = s7Reader(transaction), caller = await s7Caller(read, uid);
      const requestSnap = await read.doc('notification_private_receipts', requestId);
      const source = await s7Source(read, body.eventType, refs);
      await s7AuthorizeSource(read, caller, source);
      if (requestSnap.exists) {
        const saved = requestSnap.data();
        if (saved.actorUid !== uid || saved.requestFingerprint !== fingerprint) throw s7Error(409, 'NOTIFICATION_IDEMPOTENCY_MISMATCH');
        return s7Replay(read, saved, 'request');
      }
      return s7PersistEvent(transaction, read, source, caller, await s7Settings(read), { id: requestId, fingerprint });
    });
    if (!result.isIdempotent) void s7Push(result.notificationIds).catch(() => {});
    return result;
  }));
  app.post('/api/notifications/list', s7Route(async (req, uid, deadlineAt) => {
    const body = s7Body(req.body, ['bookingId', 'bookingCode']);
    if ([body.bookingId, body.bookingCode].some(v => v !== undefined && !s7Id(v))) throw s7Error(400, 'INVALID_NOTIFICATION_FILTER');
    return adminDb.runTransaction(async (transaction: any) => {
      const read = s7Reader(transaction, deadlineAt), caller = await s7Caller(read, uid);
      const items = await s7Inbox(read, caller, { limit: 50, ...body });
      return { success: true, notifications: items.slice(0, 50) };
    }, { readOnly: true });
  }, 20000));
  function s7ActionRequest(body: any, uid: string, action: string): { id: string; fingerprint: string } | null {
    if (body.requestId === undefined) return null; // Existing callers remain authenticated and scoped.
    if (!s7Id(body.requestId)) throw s7Error(400, 'INVALID_NOTIFICATION_REQUEST_ID');
    return { id: `s7a_${s7Hash([uid, action, body.requestId])}`, fingerprint: s7Hash([action, body.notificationId || '']) };
  }
  async function s7ActionReplay(read: ReturnType<typeof s7Reader>, request: { id: string; fingerprint: string } | null, uid: string, action: string): Promise<any | null> {
    if (!request) return null;
    const snap = await read.doc('notification_private_receipts', request.id);
    if (!snap.exists) return null;
    const data = snap.data(), response = data.response;
    if (data.actorUid !== uid || data.action !== action || data.requestFingerprint !== request.fingerprint) throw s7Error(409, 'NOTIFICATION_IDEMPOTENCY_MISMATCH');
    if (data.schemaVersion !== 1 || data.kind !== 'action' || !s7Date(data.createdAt) || !response || response.success !== true || data.responseFingerprint !== s7Hash(response)) throw s7Error(409, 'NOTIFICATION_RECEIPT_INVALID');
    if (['mark-read', 'delete'].includes(action) ? !s7Id(response.notificationId) : typeof response.hasMore !== 'boolean' || !Number.isInteger(response.updatedCount) || response.updatedCount < 0 || !Number.isInteger(response.deletedCount) || response.deletedCount < 0) throw s7Error(409, 'NOTIFICATION_RECEIPT_INVALID');
    return response;
  }
  function s7SaveAction(transaction: any, request: { id: string; fingerprint: string } | null, uid: string, action: string, response: any): any {
    if (request) transaction.create(adminDb.collection('notification_private_receipts').doc(request.id), { schemaVersion: 1, kind: 'action', actorUid: uid, action, requestFingerprint: request.fingerprint, response, responseFingerprint: s7Hash(response), createdAt: new Date().toISOString() });
    return response;
  }
  for (const action of ['mark-read', 'delete']) app.post(`/api/notifications/${action}`, s7Route(async (req, uid) => {
    const body = s7Body(req.body, ['notificationId', 'requestId']);
    if (!s7Id(body.notificationId)) throw s7Error(400, 'INVALID_NOTIFICATION_ID');
    const request = s7ActionRequest(body, uid, action);
    return adminDb.runTransaction(async (transaction: any) => {
      const read = s7Reader(transaction), caller = await s7Caller(read, uid);
      if (action === 'delete' && !s7Operational.includes(caller.role)) throw s7Error(403, 'NOTIFICATION_DELETE_DENIED');
      const replay = await s7ActionReplay(read, request, uid, action);
      if (replay) { if (replay.notificationId !== body.notificationId) throw s7Error(409, 'NOTIFICATION_RECEIPT_INVALID'); return replay; }
      const snap = await read.doc('notifications', body.notificationId), visible = await s7Visible(read, caller, snap);
      if (!visible) throw s7Error(403, 'NOTIFICATION_ACCESS_DENIED');
      if (action === 'delete') transaction.delete(snap.ref);
      else if (!visible.read) transaction.update(snap.ref, { read: true, readAt: new Date().toISOString() });
      return s7SaveAction(transaction, request, uid, action, { success: true, notificationId: snap.id });
    });
  }));
  for (const action of ['mark-all-read', 'clear-read']) app.post(`/api/notifications/${action}`, s7Route(async (req, uid) => {
    const body = s7Body(req.body, ['requestId']), request = s7ActionRequest(body, uid, action);
    return adminDb.runTransaction(async (transaction: any) => {
      const read = s7Reader(transaction), caller = await s7Caller(read, uid);
      if (action === 'clear-read' && !s7Operational.includes(caller.role)) throw s7Error(403, 'NOTIFICATION_DELETE_DENIED');
      const replay = await s7ActionReplay(read, request, uid, action);
      if (replay) return replay;
      const inbox = await s7Inbox(read, caller), targets = inbox.filter(n => action === 'mark-all-read' ? !n.read : n.read), batch = targets.slice(0, 350);
      const now = new Date().toISOString();
      for (const item of batch) {
        const ref = adminDb.collection('notifications').doc(item.id);
        if (action === 'clear-read') transaction.delete(ref); else transaction.update(ref, { read: true, readAt: now });
      }
      return s7SaveAction(transaction, request, uid, action, { success: true, updatedCount: action === 'mark-all-read' ? batch.length : 0, deletedCount: action === 'clear-read' ? batch.length : 0, hasMore: targets.length > batch.length });
    });
  }));
  app.post('/api/notifications/devices/list', s7Route(async (req, uid) => {
    s7Body(req.body, []);
    return adminDb.runTransaction(async (transaction: any) => {
      const read = s7Reader(transaction); await s7Caller(read, uid);
      const snap = await read.query(adminDb.collection('notification_devices').where('userId', '==', uid));
      return { success: true, devices: snap.docs.filter((d: any) => !d.data().authUid || d.data().authUid === uid).map((d: any) => ({ id: d.id, userId: uid, role: d.data().role, enabled: d.data().enabled === true, platform: d.data().platform, createdAt: s7Date(d.data().createdAt), lastSeenAt: s7Date(d.data().lastSeenAt), updatedAt: s7Date(d.data().updatedAt), token: '' })) };
    });
  }));
  app.post('/api/notifications/booking-created-initial', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ack = { success: true, code: 'INITIAL_NOTIFICATION_ACKNOWLEDGED' };
    try {
      const names = [...Object.keys(req.headers || {}), ...(req.rawHeaders || []).filter((_: any, index: number) => index % 2 === 0)].map(k => k.toLowerCase());
      if (names.includes('authorization') || names.includes('x-firebase-auth')) throw s7Error(401, 'AUTH_HEADER_INVALID');
      s7Rate(s7GuestRates, req.ip || req.socket?.remoteAddress || 'unknown', 25);
      const body = s7Body(req.body, ['bookingId']);
      if (!s7Id(body.bookingId)) throw s7Error(400, 'INVALID_BOOKING_ID');
      if (!adminDb) throw s7Error(503, 'NOTIFICATION_UNAVAILABLE');
      const emitted = await adminDb.runTransaction(async (transaction: any) => {
        const read = s7Reader(transaction), snap = await read.doc('bookings', body.bookingId);
        if (!snap.exists) return;
        const data = snap.data();
        for (const key of ['customerAuthUid', 'authUserId', 'customerUid', 'userId', 'uid']) if (data[key] !== undefined && data[key] !== null && data[key] !== '') return;
        if (typeof data.customerId === 'string' && data.customerId.startsWith('cust_u_')) return;
        if (!['Menunggu Pembayaran', 'awaiting_payment', 'Draft', 'Pending'].includes(data.status) || !['', 'unpaid', 'pending', 'menunggu pembayaran'].includes(s7Text(data.paymentStatus).toLowerCase())) return;
        if (!s7Date(snap.createTime)) return;
        if (data.customerId) {
          if (!s7Id(data.customerId)) return;
          const profile = await read.doc('customers', data.customerId);
          if (profile.exists) {
            const p = profile.data();
            for (const key of ['authUserId', 'customerAuthUid', 'authUid']) if (p[key] !== undefined && p[key] !== null && p[key] !== '') return;
            if (s7Disabled(p)) return;
            if (p.isRegistered === true || p.isActive === true || ['active','registered'].includes(s7Text(p.status).toLowerCase())) return;
          }
        }
        const source = await s7Source(read, 'booking.created', { bookingId: body.bookingId });
        if (source.customerUid) return;
        (source as any).initialCreatedAt = s7Date(snap.createTime);
        const guest: S7Caller = { uid: 'system_guest_initial', role: 'system', staffId: '', name: 'Sistem Senzu Home', therapistIds: new Set() };
        return s7PersistEvent(transaction, read, source, guest, await s7Settings(read), null, true);
      });
      if (emitted && !emitted.isIdempotent) void s7Push(emitted.notificationIds).catch(() => {});
      return res.status(200).json(ack);
    } catch (error: any) {
      const status = [400, 401, 429].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(status).json({ success: false, code: error.statusCode ? error.code : 'NOTIFICATION_UNAVAILABLE', message: status === 503 ? 'Layanan notifikasi belum tersedia.' : error.message });
    }
  });
  async function s7DispatchChat(bookingId: string, messageId: string, caller?: S7Caller, requestedSenderType?: string): Promise<any> {
    if (!s7Id(bookingId) || !s7Id(messageId) || !adminDb) throw s7Error(400, 'CHAT_REFERENCE_INVALID');
    const response = await adminDb.runTransaction(async (transaction: any) => {
      const read = s7Reader(transaction), source = await s7Source(read, 'chat.message_received', { bookingId, messageId });
      let verifiedCaller: S7Caller | undefined;
      if (caller) {
        const current = await s7Caller(read, caller.uid);
        verifiedCaller = current;
        if (source.entity.senderUid !== current.uid || (requestedSenderType && source.entity.senderType !== requestedSenderType)) throw s7Error(403, 'FORBIDDEN_MESSAGE_SENDER');
        if (source.entity.senderType === 'CUSTOMER' && !s7AssertBookingCustomer(current, source)) throw s7Error(403, 'FORBIDDEN_MESSAGE_SENDER');
        if (source.entity.senderType === 'THERAPIST' && !await s7AssignedCaller(read, current, source)) throw s7Error(403, 'FORBIDDEN_MESSAGE_SENDER');
        if (source.entity.senderType === 'SYSTEM' && !s7Operational.includes(current.role)) throw s7Error(403, 'FORBIDDEN_MESSAGE_SENDER');
      }
      const settings = await s7Settings(read);
      await s7Eligible(read, source, settings);
      const legacy = await read.doc('chat_notification_dispatches', `chat_notif_${messageId}`);
      if (legacy.exists && legacy.data().bookingId === bookingId && legacy.data().messageId === messageId && legacy.data().recipientUserId === source.entity.recipientUid && s7Id(legacy.data().notificationId)) {
        const old = await read.doc('notifications', legacy.data().notificationId);
        if (old.exists && old.data().bookingId === bookingId && old.data().metadata?.messageId === messageId && old.data().recipientUserId === source.entity.recipientUid) return { success: true, isIdempotent: true, eventId: s7Id(old.data().eventId) ? old.data().eventId : legacy.id, notificationIds: [old.id] };
      }
      const actor: S7Caller = verifiedCaller || await s7Caller(read, source.entity.senderUid);
      return s7PersistEvent(transaction, read, source, actor, settings, null);
    });
    if (!response.isIdempotent) void s7Push(response.notificationIds).catch(() => {});
    return { dispatched: true, isIdempotent: response.isIdempotent, notificationId: response.notificationIds[0] || null };
  }
  // Catch-all 404 for undefined API endpoints
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      error: 'Endpoint API tidak ditemukan atau telah dinonaktifkan untuk keamanan.',
      code: 'NOT_FOUND',
      requestId: (req as any).id,
    });
  });

  // Centralized Error Handler (Prompt 22 E)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const requestId = (req as any).id || 'req_unknown';
    const statusCode =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');

    emitStructuredLog({
      severity: statusCode >= 500 ? 'ERROR' : 'WARNING',
      event: 'uncaught_api_exception',
      requestId,
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode,
      errorCode,
      message: err.message ? String(err.message).slice(0, 300) : 'Unknown server error',
    });

    if (res.headersSent) {
      return next(err);
    }

    res.status(statusCode).json({
      success: false,
      code: errorCode,
      error:
        statusCode >= 500
          ? 'Terjadi kendala pada sistem. Silakan coba beberapa saat lagi.'
          : err.userMessage || err.message || 'Permintaan tidak dapat diproses.',
      requestId,
    });
  });

  // Vite middleware for development vs static serve for production
  const distPath = path.join(process.cwd(), 'dist');
  const distIndexPath = path.join(distPath, 'index.html');

  const isDev =
    process.env.npm_lifecycle_event === 'dev' ||
    process.env.NODE_ENV === 'development';

  const isProduction =
    !isDev &&
    (process.env.NODE_ENV === 'production' ||
      process.env.npm_lifecycle_event === 'start' ||
      Boolean(process.env.K_SERVICE) ||
      Boolean(process.env.K_REVISION));

  if (isProduction && !fs.existsSync(distIndexPath)) {
    console.log('[Server] dist/index.html not found on startup. Executing vite build...');
    try {
      const { execSync } = await import('child_process');
      execSync('npx vite build', { stdio: 'inherit' });
      console.log('[Server] vite build finished successfully.');
    } catch (buildErr) {
      console.error('[Server] Failed to run on-demand vite build:', buildErr);
    }
  }

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
    }
    app.get('*', async (req, res, next) => {
      if (fs.existsSync(distIndexPath)) {
        return res.sendFile(distIndexPath);
      }
      try {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        });
        return vite.middlewares(req, res, next);
      } catch {
        const rootIndex = path.join(process.cwd(), 'index.html');
        if (fs.existsSync(rootIndex)) {
          return res.sendFile(rootIndex);
        }
        return res.status(500).send('Application is starting up. Please refresh in a moment.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    emitStructuredLog({
      severity: 'INFO',
      event: 'server_started',
      port: PORT,
      message: `Server running on http://0.0.0.0:${PORT}`,
    });
  });

  // Graceful shutdown handling for Cloud Run container lifecycle (Prompt 22 N)
  const handleShutdown = (signal: string) => {
    emitStructuredLog({
      severity: 'INFO',
      event: 'server_shutting_down',
      signal,
      message: `Received ${signal}, gracefully terminating HTTP connections...`,
    });
    server.close(() => {
      emitStructuredLog({
        severity: 'INFO',
        event: 'server_closed',
        signal,
        message: 'HTTP server closed safely.',
      });
      process.exit(0);
    });
    setTimeout(() => {
      emitStructuredLog({
        severity: 'WARNING',
        event: 'server_force_shutdown',
        signal,
        message: 'Force exit after 8 seconds drain timeout.',
      });
      process.exit(0);
    }, 8000).unref();
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

startServer();
