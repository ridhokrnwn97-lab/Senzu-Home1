import { registerPaymentAcceptance, assertPaymentLink } from './src/server/paymentAcceptance.ts';
import { randomInt, timingSafeEqual } from 'node:crypto';
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
    syncHistoricalVoucherRedemptions().catch(() => {});
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

    // Check in-memory reconciliation cache (2 minutes operational TTL)
    const cached = reconciliationCache.get(verifiedUid);
    if (cached && Date.now() - cached.verifiedAt < RECONCILIATION_TTL_MS) {
      if (cached.staff?.mustChangePassword !== true) {
        console.log(`[STAFF_ROLE_CACHE_HIT] Verified session served from cache for authUid: ${verifiedUid} (role: ${cached.role})`);
        return res.json({
          success: true,
          reconciled: false,
          role: cached.role,
          staff: cached.staff,
        });
      }
    }

    // 3. Authoritative Staff Master Lookup via Admin Firestore against the named database
    try {
      let matchedDoc: any = null;
      let matchedData: any = null;

      // Primary Search: Query by canonical authUserId
      const snapAuth = await adminDb.collection('staff_users')
        .where('authUserId', '==', verifiedUid)
        .limit(1)
        .get();

      if (!snapAuth.empty) {
        matchedDoc = snapAuth.docs[0];
        matchedData = matchedDoc.data();
      }

      // Secondary Search: Query by legacy authUid
      if (!matchedDoc) {
        const snapLegacy = await adminDb.collection('staff_users')
          .where('authUid', '==', verifiedUid)
          .limit(1)
          .get();

        if (!snapLegacy.empty) {
          matchedDoc = snapLegacy.docs[0];
          matchedData = matchedDoc.data();
        }
      }

      // Tertiary Search: Link existing Staff Master record by verified token email (never body email)
      let wasReconciledByEmail = false;
      if (!matchedDoc && verifiedEmail) {
        const snapEmail = await adminDb.collection('staff_users')
          .where('email', '==', verifiedEmail)
          .limit(2)
          .get();

        if (!snapEmail.empty) {
          if (snapEmail.docs.length > 1) {
            console.warn(`[STAFF_RECONCILE_DENIED] Multiple staff match for email: ${verifiedEmail}`);
            return res.status(409).json({
              success: false,
              code: 'MULTIPLE_STAFF_MATCH',
              message: 'Ditemukan lebih dari satu profil staf di Master Data dengan email yang sama. Hubungi Branch Manager / Administrator.',
            });
          }

          const legacyDoc = snapEmail.docs[0];
          const legacyData = legacyDoc.data() as any;

          // Identity collision check: ensure profile isn't already claimed by another Firebase UID
          if (
            (legacyData.authUserId && legacyData.authUserId !== verifiedUid) ||
            (legacyData.authUid && legacyData.authUid !== verifiedUid)
          ) {
            console.warn(`[STAFF_RECONCILE_DENIED] UID mismatch for staff ${legacyDoc.id}`);
            return res.status(403).json({
              success: false,
              code: 'STAFF_UID_MISMATCH',
              message: 'Akun staf ini sudah tertaut dengan kredensial otentikasi lain.',
            });
          }

          if (
            legacyData.isActive === false ||
            legacyData.status === 'INACTIVE' ||
            legacyData.loginAccountStatus === 'DINONAKTIFKAN'
          ) {
            return res.status(403).json({
              success: false,
              code: 'STAFF_INACTIVE',
              message: 'Akun staf sedang tidak aktif.',
            });
          }

          // Authoritative link using Admin Firestore
          const now = new Date().toISOString();
          await adminDb.collection('staff_users').doc(legacyDoc.id).set({
            authUid: verifiedUid,
            authUserId: verifiedUid,
            updatedAt: now,
            updatedBy: 'trusted admin reconciliation',
          }, { merge: true });

          matchedDoc = legacyDoc;
          matchedData = {
            ...legacyData,
            authUid: verifiedUid,
            authUserId: verifiedUid,
            updatedAt: now,
          };
          wasReconciledByEmail = true;
          console.log(`[Trusted Admin RBAC] Linked staff ${legacyData.name} to UID ${verifiedUid}`);
        }
      }

      if (!matchedDoc || !matchedData) {
        console.warn(`[STAFF_RECONCILE_DENIED] Verified UID ${verifiedUid} not found in Staff Master`);
        return res.status(403).json({
          success: false,
          code: 'STAFF_NOT_REGISTERED',
          message: 'Akun berhasil diautentikasi, namun belum terdaftar di Master Staff. Silakan hubungi Manager.',
        });
      }

      // 4. Verify Active Status
      const isActive =
        matchedData.isActive !== false &&
        matchedData.status !== 'INACTIVE' &&
        matchedData.loginAccountStatus !== 'DINONAKTIFKAN';

      if (!isActive) {
        reconciliationCache.delete(verifiedUid);
        await adminDb.collection('staff_roles').doc(verifiedUid).set({
          authUserId: verifiedUid,
          isActive: false,
          status: 'inactive',
          updatedAt: new Date().toISOString(),
        }, { merge: true }).catch(() => {});

        console.warn(`[STAFF_RECONCILE_DENIED] Staff ${verifiedUid} is inactive.`);
        return res.status(403).json({
          success: false,
          code: 'STAFF_INACTIVE',
          message: 'Akun staf sedang tidak aktif.',
        });
      }

      // Ensure canonical authUserId is recorded in Staff Master
      if (!matchedData.authUid || !matchedData.authUserId) {
        await adminDb.collection('staff_users').doc(matchedDoc.id).set({
          authUid: verifiedUid,
          authUserId: verifiedUid,
          updatedAt: new Date().toISOString(),
          updatedBy: 'trusted admin reconciliation',
        }, { merge: true }).catch(() => {});
      }

      // 5. Authoritative Role Mapping Write to /staff_roles/{verifiedUid} via Admin Firestore
      const verifiedRole = matchedData.role || 'staff';
      const now = new Date().toISOString();

      await adminDb.collection('staff_roles').doc(verifiedUid).set({
        authUserId: verifiedUid,
        staffId: matchedData.uid || matchedDoc.id,
        staffUserId: matchedData.uid || matchedDoc.id,
        therapistId: matchedData.therapistId || matchedData.uid || matchedDoc.id,
        role: verifiedRole,
        name: matchedData.name || '',
        email: matchedData.email || verifiedEmail,
        status: 'active',
        isActive: true,
        branchId: matchedData.branchId || 'PLG001',
        accountType: 'STAFF',
        updatedAt: now,
      }, { merge: true });

      const resolvedStaff = {
        ...matchedData,
        id: matchedDoc.id,
        uid: matchedData.uid || matchedDoc.id,
        authUserId: verifiedUid,
        authUid: verifiedUid,
      };

      reconciliationCache.set(verifiedUid, {
        uid: verifiedUid,
        staffUserId: matchedData.uid || matchedDoc.id,
        role: verifiedRole,
        status: 'active',
        branchId: matchedData.branchId || 'PLG001',
        verifiedAt: Date.now(),
        staff: resolvedStaff,
      });

      console.log(`[STAFF_ROLE_RECONCILED] Verified staff ${verifiedUid} as role ${verifiedRole}`);
      return res.json({
        success: true,
        reconciled: wasReconciledByEmail,
        role: verifiedRole,
        staff: resolvedStaff,
      });
    } catch (err: any) {
      console.error(`[STAFF_AUTHORIZATION_ERROR] Firestore Admin error verifying UID ${verifiedUid}:`, err?.code, err?.message);
      // Fail closed with safe classification per Prompt 9
      return res.status(503).json({
        success: false,
        code: 'STAFF_AUTHORIZATION_UNAVAILABLE',
        message: 'Data akses staf sedang tidak dapat diverifikasi. Silakan coba kembali beberapa saat lagi.',
      });
    }
  });

  // Trusted Endpoint: Complete staff first-time password change and account activation (Server-Authoritative)
  app.post('/api/staff/complete-first-login', async (req, res) => {
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
      let verifiedUid = '';
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

      if (!db) {
        return res.status(500).json({
          success: false,
          code: 'SERVER_UNAVAILABLE',
          message: 'Layanan database server sedang tidak tersedia.',
        });
      }

      // Ensure server process is authenticated as system service for privileged writes
      await ensureServerAuthenticated();

      // 2. Locate Staff Master record by verified Auth UID (DO NOT trust client body parameters)
      let matchedDoc: any = null;
      let matchedData: any = null;

      // Query by canonical authUserId
      const qAuth = query(collection(db, 'staff_users'), where('authUserId', '==', verifiedUid), limit(1));
      const snapAuth = await getDocs(qAuth);
      if (!snapAuth.empty) {
        matchedDoc = snapAuth.docs[0];
        matchedData = matchedDoc.data();
      }

      // Query by legacy authUid
      if (!matchedDoc) {
        const qLegacyAuth = query(collection(db, 'staff_users'), where('authUid', '==', verifiedUid), limit(1));
        const snapLegacy = await getDocs(qLegacyAuth);
        if (!snapLegacy.empty) {
          matchedDoc = snapLegacy.docs[0];
          matchedData = snapLegacy.docs[0].data();
        }
      }

      // Query by document ID == verifiedUid
      if (!matchedDoc) {
        const directSnap = await getDoc(doc(db, 'staff_users', verifiedUid));
        if (directSnap.exists()) {
          matchedDoc = directSnap;
          matchedData = directSnap.data();
        }
      }

      // Fallback: Query by verified email with strict collision and hijacking protection
      if (!matchedDoc && verifiedEmail) {
        const qEmail = query(collection(db, 'staff_users'), where('email', '==', verifiedEmail), limit(2));
        const snapEmail = await getDocs(qEmail);
        if (!snapEmail.empty && snapEmail.docs.length === 1) {
          const candidateDoc = snapEmail.docs[0];
          const candData = candidateDoc.data() as any;
          const existingUid = candData.authUserId || candData.authUid;
          if (!existingUid || existingUid === verifiedUid) {
            matchedDoc = candidateDoc;
            matchedData = candData;
          }
        }
      }

      // Fallback: Query server in-memory staff cache
      if (!matchedDoc) {
        for (const st of serverStaffMasterCache.values()) {
          const sAuthUid = st.authUserId || st.authUid || st.uid;
          if (sAuthUid && sAuthUid === verifiedUid) {
            matchedData = st;
            matchedDoc = { id: st.uid, data: () => st };
            break;
          }
          if (verifiedEmail && st.email && st.email.toLowerCase().trim() === verifiedEmail) {
            matchedData = st;
            matchedDoc = { id: st.uid, data: () => st };
            break;
          }
        }
      }

      if (!matchedDoc || !matchedData) {
        return res.status(404).json({
          success: false,
          code: 'STAFF_NOT_FOUND',
          message: 'Data staf tidak ditemukan di sistem.',
        });
      }

      const staffDocId = matchedDoc.id;

      // 3. Verify staff account is active (Requirement 6 & 21)
      const isActive =
        matchedData.isActive !== false &&
        matchedData.status !== 'INACTIVE' &&
        matchedData.loginAccountStatus !== 'DINONAKTIFKAN';

      if (!isActive) {
        reconciliationCache.delete(verifiedUid);
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_DISABLED',
          message: 'Akun staf sedang tidak aktif.',
        });
      }

      // Canonical role resolution with normalized casing (Requirement 9)
      const canonicalRole = (matchedData.role || 'staff').toLowerCase().trim();
      const now = new Date().toISOString();

      // 4. Update staff_users authoritatively (Privileged Staff Master fields)
      const staffUpdatePayload: Record<string, any> = {
        mustChangePassword: false,
        firstLoginCompleted: true,
        firstLoginCompletedAt: matchedData.firstLoginCompletedAt || now,
        loginAccountStatus: 'AKTIF',
        passwordChangedAt: now,
        lastLoginAt: now,
        updatedAt: now,
        authUserId: verifiedUid,
        authUid: verifiedUid,
        updatedBy: matchedData.name || 'Sistem Aktivasi Staf',
      };

      try {
        await updateDoc(doc(db, 'staff_users', staffDocId), sanitizeForFirestore(staffUpdatePayload));
      } catch (updErr: any) {
        console.error('[CompleteFirstLogin] Failed to update staff_users:', updErr);
        return res.status(500).json({
          success: false,
          code: 'ACTIVATION_UPDATE_FAILED',
          message: 'Perubahan kata sandi berhasil, tetapi aktivasi akun belum selesai. Silakan coba kembali.',
        });
      }

      // 5. Authoritatively synchronize /staff_roles/{authUid} (Requirement 18)
      try {
        await setDoc(
          doc(db, 'staff_roles', verifiedUid),
          sanitizeForFirestore({
            authUserId: verifiedUid,
            staffId: staffDocId,
            staffUserId: staffDocId,
            therapistId: matchedData.therapistId || staffDocId,
            role: canonicalRole,
            name: matchedData.name || '',
            email: matchedData.email || verifiedEmail,
            status: 'active',
            isActive: true,
            branchId: matchedData.branchId || 'PLG001',
            accountType: 'STAFF',
            updatedAt: now,
          }),
          { merge: true }
        );
      } catch (roleErr: any) {
        console.warn('[CompleteFirstLogin] Notice syncing staff_roles:', roleErr?.message);
      }

      // 6. Update in-memory caches
      const resolvedStaff: any = {
        ...matchedData,
        ...staffUpdatePayload,
        id: staffDocId,
        uid: staffDocId,
        authUserId: verifiedUid,
        role: canonicalRole,
      };
      serverStaffMasterCache.set(staffDocId, resolvedStaff);

      reconciliationCache.delete(verifiedUid);
      reconciliationCache.delete(staffDocId);
      reconciliationCache.set(verifiedUid, {
        uid: verifiedUid,
        staffUserId: staffDocId,
        role: canonicalRole,
        status: 'active',
        branchId: matchedData.branchId || 'PLG001',
        verifiedAt: Date.now(),
        staff: resolvedStaff,
      });
      reconciliationCache.set(staffDocId, {
        uid: verifiedUid,
        staffUserId: staffDocId,
        role: canonicalRole,
        status: 'active',
        branchId: matchedData.branchId || 'PLG001',
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
        const histId = `hist_${updatedBookingData.bookingCode || bookingId}_${Date.now()}`;
        setDoc(doc(db, 'booking_status_history', histId), sanitizeForFirestore({
          id: histId,
          bookingId,
          bookingCode: updatedBookingData.bookingCode || '',
          status: 'Accepted',
          note: `Pesanan diterima oleh Terapis ${resolvedTherapistName || 'Senzu'}`,
          updatedByRole: 'therapist',
          updatedByName: resolvedTherapistName || 'Terapis',
          timestamp: now,
          formattedWIB: new Date(now).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
        })).catch((e) => console.warn('History write notice:', e));
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

  // Authoritative historical sync: ensures any booking that ever used a voucher is indexed in /voucher_redemptions
  async function syncHistoricalVoucherRedemptions() {
    if (!db) return;
    try {
      await ensureServerAuthenticated();
      const bookingsSnap = await getDocs(collection(db, 'bookings'));
      let synced = 0;
      for (const bDoc of bookingsSnap.docs) {
        const b = bDoc.data() as any;
        const promo = (b.promoCode || b.voucherCode || '').trim().toUpperCase();
        if (!promo) continue;
        const status = (b.status || '').toLowerCase();
        if (status === 'cancelled' || status === 'batal') continue;

        const voucherId = b.promoId || b.voucherId || (promo === 'SENZUWELCOME' ? 'vch_senzuwelcome' : `vch_${promo.toLowerCase()}`);
        const authUid = b.authUserId || '';
        const phone = b.customerWhatsApp || '';
        const { cleanDigits } = normalizeIndonesianPhoneServer(phone);
        const custId = b.customerId || (cleanDigits ? `cust_${cleanDigits}` : '');

        const redDocId = `vred_${promo}_${bDoc.id}`;
        await setDoc(doc(db, 'voucher_redemptions', redDocId), {
          id: redDocId,
          voucherId,
          voucherCode: promo,
          customerId: custId,
          customerAuthUid: authUid || null,
          customerPhone: phone || null,
          normalizedPhone: cleanDigits ? `+${cleanDigits}` : null,
          bookingId: bDoc.id,
          bookingCode: b.bookingCode || '',
          discountAmount: b.discountAmount || b.voucherDiscount || 20000,
          redeemedAt: b.createdAt || new Date().toISOString(),
          status: 'active',
          source: 'historical_booking',
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(() => {});

        // Set authoritative lock documents for single-use vouchers
        if (authUid) {
          await setDoc(doc(db, 'voucher_redemptions', `vlock_${promo}_uid_${authUid}`), {
            voucherCode: promo,
            voucherId,
            customerAuthUid: authUid,
            bookingId: bDoc.id,
            bookingCode: b.bookingCode || '',
            redeemedAt: b.createdAt || new Date().toISOString(),
            status: 'active'
          }, { merge: true }).catch(() => {});
        }
        if (cleanDigits) {
          await setDoc(doc(db, 'voucher_redemptions', `vlock_${promo}_phone_${cleanDigits}`), {
            voucherCode: promo,
            voucherId,
            customerPhone: cleanDigits,
            bookingId: bDoc.id,
            bookingCode: b.bookingCode || '',
            redeemedAt: b.createdAt || new Date().toISOString(),
            status: 'active'
          }, { merge: true }).catch(() => {});
        }
        if (custId) {
          await setDoc(doc(db, 'voucher_redemptions', `vlock_${promo}_cust_${custId}`), {
            voucherCode: promo,
            voucherId,
            customerId: custId,
            bookingId: bDoc.id,
            bookingCode: b.bookingCode || '',
            redeemedAt: b.createdAt || new Date().toISOString(),
            status: 'active'
          }, { merge: true }).catch(() => {});
        }
        synced++;
      }
      if (synced > 0) {
        console.log(`[Voucher Ledger] Backfilled ${synced} historical voucher redemptions.`);
      }
    } catch (err: any) {
      console.warn('[Voucher Ledger] Historical sync notice:', err.message);
    }
  }

  // POST /api/vouchers/validate - Authoritative Voucher Eligibility Check
  app.post('/api/vouchers/validate', async (req, res) => {
    try {
      const rawCode = (req.body.promoCode || req.body.code || '').trim().toUpperCase();
      if (!rawCode) {
        return res.json({ valid: false, errorMessage: 'Harap masukkan kode promo.' });
      }

      await ensureServerAuthenticated();

      // 1. Fetch voucher from Master Catalog
      let voucher: any = null;
      try {
        const qVoucher = query(collection(db, 'vouchers'), where('code', '==', rawCode), limit(1));
        const snap = await getDocs(qVoucher);
        if (!snap.empty) {
          voucher = snap.docs[0].data();
        } else if (rawCode === 'SENZUWELCOME') {
          const senzuRef = doc(db, 'vouchers', 'vch_senzuwelcome');
          const senzuSnap = await getDoc(senzuRef);
          if (senzuSnap.exists()) {
            voucher = senzuSnap.data();
          } else {
            // Default master voucher seed
            voucher = {
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
            await setDoc(senzuRef, voucher).catch(() => {});
          }
        }
      } catch (e: any) {
        console.warn('Server error querying voucher:', e.message);
      }

      if (!voucher) {
        return res.json({ valid: false, errorMessage: 'Kode promo tidak ditemukan.' });
      }

      // 2. Enabled check
      if (voucher.enabled === false) {
        return res.json({ valid: false, errorMessage: 'Voucher sedang tidak aktif.' });
      }

      // 3. Expiration / Validity period check
      const now = new Date().toISOString();
      if (voucher.validFrom && voucher.validFrom > now) {
        return res.json({ valid: false, errorMessage: 'Promo ini belum dapat digunakan (periode belum dimulai).' });
      }
      if (voucher.validUntil && voucher.validUntil < now) {
        return res.json({ valid: false, errorMessage: 'Voucher sudah tidak berlaku.' });
      }

      // 4. Quota check
      if (voucher.usageLimitTotal && voucher.usageLimitTotal > 0) {
        if ((voucher.currentUsageCount || 0) >= voucher.usageLimitTotal) {
          return res.json({ valid: false, errorMessage: 'Kuota promo sudah habis.' });
        }
      }

      // 5. Minimum spend check
      const servicePrice = Number(req.body.servicePrice) || 0;
      const minSpend = voucher.minimumSpend || voucher.minimumTreatmentPrice || 0;
      if (servicePrice < minSpend) {
        return res.json({
          valid: false,
          errorMessage: `Minimum transaksi untuk promo ini adalah Rp ${minSpend.toLocaleString('id-ID')}.`
        });
      }

      // 6. Service / category / duration restrictions
      if (voucher.applicableServiceIds && voucher.applicableServiceIds.length > 0) {
        if (req.body.serviceId && !voucher.applicableServiceIds.includes(req.body.serviceId)) {
          return res.json({ valid: false, errorMessage: 'Promo tidak berlaku untuk layanan yang dipilih.' });
        }
      }
      if (voucher.applicableCategoryIds && voucher.applicableCategoryIds.length > 0) {
        if (req.body.serviceCategory && !voucher.applicableCategoryIds.includes(req.body.serviceCategory)) {
          return res.json({ valid: false, errorMessage: 'Promo tidak berlaku untuk kategori layanan ini.' });
        }
      }
      if (voucher.minimumTreatmentDuration && req.body.serviceDuration && req.body.serviceDuration < voucher.minimumTreatmentDuration) {
        return res.json({
          valid: false,
          errorMessage: `Promo memerlukan durasi treatment minimal ${voucher.minimumTreatmentDuration} menit.`
        });
      }

      // Customer identity normalization
      const authUid = (req.body.customerAuthUid || '').trim();
      const phoneInput = (req.body.customerWhatsApp || req.body.customerPhone || '').trim();
      const { cleanDigits } = normalizeIndonesianPhoneServer(phoneInput);
      const custId = (req.body.customerId || '').trim();

      // 7. Authoritative Usage Limit Per Customer Check
      const usageLimitPerCustomer = voucher.usageLimitPerCustomer ?? (rawCode === 'SENZUWELCOME' ? 1 : 0);
      if (usageLimitPerCustomer > 0) {
        // Check fast deterministic lock documents first
        let lockFound = false;
        if (authUid) {
          const lockSnap = await getDoc(doc(db, 'voucher_redemptions', `vlock_${rawCode}_uid_${authUid}`));
          if (lockSnap.exists() && lockSnap.data()?.status !== 'cancelled' && lockSnap.data()?.status !== 'batal') {
            lockFound = true;
          }
        }
        if (!lockFound && cleanDigits) {
          const lockSnap = await getDoc(doc(db, 'voucher_redemptions', `vlock_${rawCode}_phone_${cleanDigits}`));
          if (lockSnap.exists() && lockSnap.data()?.status !== 'cancelled' && lockSnap.data()?.status !== 'batal') {
            lockFound = true;
          }
        }
        if (!lockFound && custId) {
          const lockSnap = await getDoc(doc(db, 'voucher_redemptions', `vlock_${rawCode}_cust_${custId}`));
          if (lockSnap.exists() && lockSnap.data()?.status !== 'cancelled' && lockSnap.data()?.status !== 'batal') {
            lockFound = true;
          }
        }

        if (lockFound) {
          return res.json({
            valid: false,
            errorMessage: `Voucher ${voucher.code || rawCode} sudah pernah digunakan pada akun ini.`
          });
        }

        // Check voucher_redemptions collection
        try {
          const qRedemptions = query(collection(db, 'voucher_redemptions'), where('voucherCode', '==', rawCode));
          const redSnap = await getDocs(qRedemptions);
          let timesUsed = 0;
          for (const docSnap of redSnap.docs) {
            const r = docSnap.data() as any;
            if (r.status === 'cancelled' || r.status === 'batal') continue;
            let matches = false;
            if (authUid && r.customerAuthUid === authUid) matches = true;
            if (cleanDigits) {
              const rPhoneDigits = (r.customerPhone || '').replace(/[^0-9]/g, '');
              const rNormDigits = (r.normalizedPhone || '').replace(/[^0-9]/g, '');
              if (rPhoneDigits && (rPhoneDigits.includes(cleanDigits) || cleanDigits.includes(rPhoneDigits))) matches = true;
              if (rNormDigits && (rNormDigits.includes(cleanDigits) || cleanDigits.includes(rNormDigits))) matches = true;
            }
            if (custId && r.customerId === custId) matches = true;
            if (matches) timesUsed++;
          }
          if (timesUsed >= usageLimitPerCustomer) {
            return res.json({
              valid: false,
              errorMessage: `Voucher ${voucher.code || rawCode} sudah pernah digunakan pada akun ini.`
            });
          }
        } catch (err: any) {
          console.warn('Error querying redemptions:', err.message);
        }

        // Check historical bookings in bookings collection
        try {
          const bookingsSnap = await getDocs(collection(db, 'bookings'));
          let bookingsUsed = 0;
          for (const bDoc of bookingsSnap.docs) {
            const b = bDoc.data() as any;
            const bPromo = (b.promoCode || b.voucherCode || '').trim().toUpperCase();
            if (bPromo !== rawCode && b.voucherId !== voucher.id && b.promoId !== voucher.id) continue;
            const bStatus = (b.status || '').toLowerCase();
            if (bStatus === 'cancelled' || bStatus === 'batal') continue;

            let matches = false;
            if (authUid && b.authUserId === authUid) matches = true;
            if (cleanDigits) {
              const bPhoneDigits = (b.customerWhatsApp || '').replace(/[^0-9]/g, '');
              if (bPhoneDigits && (bPhoneDigits.includes(cleanDigits) || cleanDigits.includes(bPhoneDigits))) matches = true;
            }
            if (custId && b.customerId === custId) matches = true;
            if (matches) bookingsUsed++;
          }
          if (bookingsUsed >= usageLimitPerCustomer) {
            return res.json({
              valid: false,
              errorMessage: `Voucher ${voucher.code || rawCode} sudah pernah digunakan pada akun ini.`
            });
          }
        } catch (err: any) {
          console.warn('Error checking bookings collection:', err.message);
        }
      }

      // 8. First Order Only / New Customer Condition
      if (voucher.firstOrderOnly || voucher.newCustomerOnly) {
        let hasPreviousBookings = false;
        try {
          const bookingsSnap = await getDocs(collection(db, 'bookings'));
          for (const bDoc of bookingsSnap.docs) {
            const b = bDoc.data() as any;
            const bStatus = (b.status || '').toLowerCase();
            if (bStatus === 'cancelled' || bStatus === 'batal' || bStatus === 'menunggu pembayaran') continue;

            let matches = false;
            if (authUid && b.authUserId === authUid) matches = true;
            if (cleanDigits) {
              const bPhoneDigits = (b.customerWhatsApp || '').replace(/[^0-9]/g, '');
              if (bPhoneDigits && (bPhoneDigits.includes(cleanDigits) || cleanDigits.includes(bPhoneDigits))) matches = true;
            }
            if (custId && b.customerId === custId) matches = true;
            if (matches) {
              hasPreviousBookings = true;
              break;
            }
          }
        } catch (err: any) {
          console.warn('Error checking first order:', err.message);
        }

        if (!hasPreviousBookings && custId) {
          try {
            const custDoc = await getDoc(doc(db, 'customers', custId));
            if (custDoc.exists()) {
              const cData = custDoc.data() as any;
              if ((cData.completedBookings || 0) > 0 || (cData.totalBookings || 0) > 0) {
                hasPreviousBookings = true;
              }
            }
          } catch {}
        }

        if (hasPreviousBookings) {
          return res.json({
            valid: false,
            errorMessage: 'Voucher ini khusus untuk pesanan pertama.'
          });
        }
      }

      // 9. Calculate discount
      let discountAmount = 0;
      if (voucher.voucherType === 'fixed_discount' || (voucher.voucherType as any) === 'FIXED_AMOUNT') {
        discountAmount = Math.min(voucher.value, servicePrice);
      } else if (
        voucher.voucherType === 'percentage_discount' ||
        voucher.voucherType === 'percentage' ||
        (voucher.voucherType as any) === 'PERCENTAGE'
      ) {
        let disc = Math.floor((servicePrice * voucher.value) / 100);
        if (voucher.maximumDiscount && voucher.maximumDiscount > 0) {
          disc = Math.min(disc, voucher.maximumDiscount);
        }
        discountAmount = Math.min(disc, servicePrice);
      } else if (voucher.voucherType === 'free_home_service_fee') {
        discountAmount = Number(req.body.homeServiceFee) || 0;
      }

      return res.json({
        valid: true,
        voucher,
        discountAmount
      });
    } catch (err: any) {
      console.error('Voucher validation endpoint error:', err);
      res.status(500).json({ valid: false, errorMessage: 'Gagal memvalidasi voucher. Silakan coba kembali.' });
    }
  });

  // POST /api/vouchers/redeem - Server Authoritative Atomic Redemption Writer
  app.post('/api/vouchers/redeem', async (req, res) => {
    try {
      const {
        voucherCode,
        voucherId,
        bookingId,
        bookingCode,
        customerId,
        customerAuthUid,
        customerPhone,
        discountAmount
      } = req.body;

      const code = (voucherCode || '').trim().toUpperCase();
      if (!code || !bookingId) {
        return res.status(400).json({ error: 'Data voucher atau booking tidak lengkap.' });
      }

      await ensureServerAuthenticated();

      const { cleanDigits } = normalizeIndonesianPhoneServer(customerPhone || '');
      const authUid = (customerAuthUid || '').trim();
      const custId = (customerId || '').trim() || (cleanDigits ? `cust_${cleanDigits}` : '');
      const targetVoucherId = voucherId || (code === 'SENZUWELCOME' ? 'vch_senzuwelcome' : `vch_${code.toLowerCase()}`);

      const redDocId = `vred_${code}_${bookingId}`;
      const now = new Date().toISOString();

      // Write redemption record
      await setDoc(doc(db, 'voucher_redemptions', redDocId), {
        id: redDocId,
        voucherId: targetVoucherId,
        voucherCode: code,
        customerId: custId,
        customerAuthUid: authUid || null,
        customerPhone: customerPhone || null,
        normalizedPhone: cleanDigits ? `+${cleanDigits}` : null,
        bookingId,
        bookingCode: bookingCode || '',
        discountAmount: Number(discountAmount) || 0,
        redeemedAt: now,
        status: 'active',
        source: 'booking_submission',
        updatedAt: now
      }, { merge: true });

      // Write deterministic lock documents
      if (authUid) {
        await setDoc(doc(db, 'voucher_redemptions', `vlock_${code}_uid_${authUid}`), {
          voucherCode: code,
          voucherId: targetVoucherId,
          customerAuthUid: authUid,
          bookingId,
          bookingCode: bookingCode || '',
          redeemedAt: now,
          status: 'active'
        }, { merge: true });
      }
      if (cleanDigits) {
        await setDoc(doc(db, 'voucher_redemptions', `vlock_${code}_phone_${cleanDigits}`), {
          voucherCode: code,
          voucherId: targetVoucherId,
          customerPhone: cleanDigits,
          bookingId,
          bookingCode: bookingCode || '',
          redeemedAt: now,
          status: 'active'
        }, { merge: true });
      }
      if (custId) {
        await setDoc(doc(db, 'voucher_redemptions', `vlock_${code}_cust_${custId}`), {
          voucherCode: code,
          voucherId: targetVoucherId,
          customerId: custId,
          bookingId,
          bookingCode: bookingCode || '',
          redeemedAt: now,
          status: 'active'
        }, { merge: true });
      }

      // Increment voucher usage count
      if (targetVoucherId) {
        try {
          const vRef = doc(db, 'vouchers', targetVoucherId);
          await runTransaction(db, async (t) => {
            const vSnap = await t.get(vRef);
            if (vSnap.exists()) {
              const cur = vSnap.data()?.currentUsageCount || 0;
              t.update(vRef, { currentUsageCount: cur + 1, updatedAt: now });
            }
          });
        } catch (vErr) {
          console.warn('Notice updating voucher usage count:', vErr);
        }
      }

      res.json({ success: true, redemptionId: redDocId });
    } catch (err: any) {
      console.error('Voucher redeem endpoint error:', err);
      res.status(500).json({ error: err.message || 'Gagal menyimpan data penggunaan voucher.' });
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

  // Authoritative Chat Notification Dispatcher
  async function dispatchAuthoritativeChatNotification(params: {
    bookingId: string;
    messageId: string;
    senderType: 'CUSTOMER' | 'THERAPIST' | 'SYSTEM';
  }) {
    const { bookingId, messageId, senderType } = params;
    try {
      if (!adminDb) return;
      const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) return;

      const booking = bookingDoc.data() as any;
      const rawStatus = (booking.status || '').toLowerCase().trim();
      const isTerminal = ['completed', 'cancelled', 'rescheduled', 'rejected', 'dibatalkan', 'selesai', 'expired'].includes(rawStatus);

      // Do not dispatch notifications for completed/terminal bookings
      if (isTerminal) return;

      // Idempotency using messageId
      const notifDispatchId = `chat_notif_${messageId}`;
      const dispatchRef = adminDb.collection('chat_notification_dispatches').doc(notifDispatchId);
      const dispatchDoc = await dispatchRef.get();
      if (dispatchDoc.exists) return;

      const isCustomerSender = senderType === 'CUSTOMER';
      let recipientUserId = '';

      if (isCustomerSender) {
        // Recipient is therapist: resolve therapist's Auth UID
        const therapistBusinessId = booking.therapistId || booking.assignedTherapistId;
        if (therapistBusinessId) {
          try {
            const tDoc = await adminDb.collection('therapists').doc(therapistBusinessId).get();
            if (tDoc.exists && tDoc.data()?.authUserId) {
              recipientUserId = tDoc.data()!.authUserId;
            }
          } catch {}
          if (!recipientUserId) {
            try {
              const srSnap = await adminDb.collection('staff_roles')
                .where('therapistId', '==', therapistBusinessId)
                .limit(1)
                .get();
              if (!srSnap.empty) {
                recipientUserId = srSnap.docs[0].id;
              }
            } catch {}
          }
          if (!recipientUserId) {
            recipientUserId = booking.therapistAuthUid || therapistBusinessId;
          }
        }
      } else {
        // Recipient is customer
        recipientUserId = booking.customerAuthUid || booking.authUserId || booking.customerId || '';
      }

      const notifTitle = 'Senzu Home';
      const notifBody = isCustomerSender
        ? 'Pesan baru dari customer.'
        : 'Pesan baru dari terapis Anda.';
      const now = new Date().toISOString();

      await dispatchRef.set({
        id: notifDispatchId,
        messageId,
        bookingId,
        bookingCode: booking.bookingCode || '',
        senderType,
        recipientUserId: recipientUserId || null,
        title: notifTitle,
        body: notifBody,
        createdAt: now,
        dispatchedAt: now,
      });

      // Record in-app notification document for recipient
      if (recipientUserId) {
        const notifId = `inapp_${messageId}`;
        const recipientRole = isCustomerSender ? 'therapist' : 'customer';
        await adminDb.collection('notifications').doc(notifId).set({
          id: notifId,
          eventId: notifDispatchId,
          eventType: 'chat.message_received',
          recipientUserId,
          recipientRole,
          bookingId,
          bookingCode: booking.bookingCode || '',
          title: notifTitle,
          message: notifBody,
          channel: 'in_app',
          priority: 'HIGH',
          read: false,
          readAt: null,
          actionUrl: `/?openChat=${encodeURIComponent(bookingId)}`,
          metadata: {
            bookingId,
            messageId,
            senderType,
          },
          createdAt: now,
        }).catch(() => {});

        // Deliver push notification to registered active devices if available
        try {
          const deviceSnaps = await adminDb.collection('notification_devices')
            .where('userId', '==', recipientUserId)
            .where('enabled', '==', true)
            .get();

          if (!deviceSnaps.empty && adminMessaging) {
            const pushTokens: string[] = [];
            deviceSnaps.docs.forEach((snapDoc) => {
              const dToken = snapDoc.data()?.token;
              if (dToken && typeof dToken === 'string') {
                pushTokens.push(dToken);
              }
            });

            if (pushTokens.length > 0) {
              await adminMessaging.sendEachForMulticast({
                tokens: pushTokens,
                notification: {
                  title: notifTitle,
                  body: notifBody,
                },
                data: {
                  bookingId,
                  messageId,
                  senderType,
                  actionUrl: `/?openChat=${encodeURIComponent(bookingId)}`,
                },
              }).catch((fcmErr: any) => {
                console.warn('[ChatNotification] FCM push delivery notice:', fcmErr?.message || fcmErr);
              });
            }
          }
        } catch (deviceLookupErr) {
          console.warn('[ChatNotification] Device lookup notice:', deviceLookupErr);
        }
      }
    } catch (err) {
      console.warn('[ChatNotification] Dispatch error:', err);
    }
  }

  app.post('/api/chat/notify', async (req, res) => {
    try {
      const { bookingId, messageId, senderType } = req.body || {};
      if (!bookingId || !messageId || !senderType) {
        return res.status(400).json({ success: false, message: 'Parameter tidak lengkap.' });
      }

      await ensureServerAuthenticated();
      if (!adminDb) {
        return res.status(500).json({ success: false, message: 'Database server tidak tersedia.' });
      }

      // Authoritative verification of caller via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Autentikasi diperlukan untuk mengirim notifikasi chat.' });
      }
      const token = authHeader.split('Bearer ')[1]?.trim();
      const verified = await verifyFirebaseIdToken(token);
      if (!verified || !verified.uid) {
        return res.status(401).json({ success: false, message: 'Sesi autentikasi tidak valid.' });
      }
      const authUid = verified.uid;

      const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
      }
      const booking = bookingDoc.data() as any;

      const participant = await resolveChatParticipant(authUid, booking);
      if (!participant.authorized) {
        return res.status(403).json({ success: false, message: participant.error || 'Akses notifikasi chat ditolak.' });
      }

      await dispatchAuthoritativeChatNotification({ bookingId, messageId, senderType });
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

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

  // Public Secure Tracking API: Lookup a booking by code and optional phone for guest tracking
  app.get('/api/bookings/track', async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code.trim().toUpperCase() : '';
      const phone = typeof req.query.phone === 'string' ? req.query.phone.replace(/[^0-9]/g, '') : '';
      if (!code) {
        return res.status(400).json({ error: 'Kode booking wajib diisi.' });
      }

      const q = query(collection(db, 'bookings'), where('bookingCode', '==', code), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) {
        return res.status(404).json({ error: 'Data reservasi tidak ditemukan.' });
      }

      const booking = snap.docs[0].data() as any;

      // If phone is provided, verify match using last 8 digits
      if (phone && phone.length >= 8) {
        const dbPhoneClean = (booking.customerWhatsApp || '').replace(/[^0-9]/g, '');
        const last8Input = phone.slice(-8);
        const last8Db = dbPhoneClean.slice(-8);
        if (last8Input !== last8Db) {
          return res.status(403).json({ error: 'Nomor WhatsApp tidak cocok dengan data reservasi.' });
        }
      }

      // Return sanitized booking record (PII masked for guest lookup)
      const sanitizedBooking = {
        id: snap.docs[0].id,
        bookingCode: booking.bookingCode,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        serviceName: booking.serviceName,
        packageName: booking.packageName,
        serviceDuration: booking.serviceDuration || booking.durationMinutes,
        durationMinutes: booking.durationMinutes || booking.serviceDuration,
        scheduleDate: booking.scheduleDate || booking.bookingDate,
        bookingDate: booking.bookingDate || booking.scheduleDate,
        scheduleTime: booking.scheduleTime || booking.timeSlot,
        timeSlot: booking.timeSlot || booking.scheduleTime,
        scheduleAt: booking.scheduleAt || (booking.scheduleDate && booking.scheduleTime ? `${booking.scheduleDate} ${booking.scheduleTime}` : ''),
        therapistId: booking.therapistId,
        therapistName: booking.therapistName,
        totalAmount: booking.totalAmount ?? (booking.totalPrice || booking.price || 0),
        totalPrice: booking.totalPrice || booking.totalAmount || booking.price || 0,
        servicePrice: booking.servicePrice || 0,
        homeServiceFee: booking.homeServiceFee || 0,
        discountAmount: booking.discountAmount || 0,
        area: booking.area || '',
        customerName: booking.customerName,
        customerWhatsApp: booking.customerWhatsApp ? booking.customerWhatsApp.slice(0, 4) + '****' + booking.customerWhatsApp.slice(-4) : '',
        address: booking.address,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      };

      // Fetch status history
      const historyQ = query(collection(db, 'booking_status_history'), where('bookingCode', '==', code));
      const historySnap = await getDocs(historyQ);
      const history = historySnap.docs
        .map(d => d.data())
        .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return res.json({ booking: sanitizedBooking, history });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal memuat data tracking.' });
    }
  });

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
