import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import path from 'path';
import fs from 'fs';

// Load service account key from filesystem or environment if available
const serviceAccountPath = path.join(process.cwd(), 'src/server/serviceAccountKey.json');
let serviceAccount: any = null;

try {
  if (fs.existsSync(serviceAccountPath)) {
    const raw = fs.readFileSync(serviceAccountPath, 'utf-8').trim();
    if (raw) {
      serviceAccount = JSON.parse(raw);
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
} catch (e) {
  console.warn('[FirebaseAdmin] Warning reading service account key:', e);
}

// Try to read projectId, firestoreDatabaseId, and API key from firebase-applet-config.json
let apiKeyFromConfig = '';
let configProjectId = '';
let configDatabaseId = '';
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (cfg.apiKey) apiKeyFromConfig = cfg.apiKey;
    if (cfg.projectId) configProjectId = cfg.projectId;
    if (cfg.firestoreDatabaseId) configDatabaseId = cfg.firestoreDatabaseId;
  }
} catch (e) {
  console.warn('[FirebaseAdmin] Warning reading config file:', e);
}

// Default project configuration fallback matching Senzu Home
let projectId =
  serviceAccount?.project_id ||
  serviceAccount?.projectId ||
  configProjectId ||
  'gen-lang-client-0466978413';
let firestoreDatabaseId =
  serviceAccount?.firestoreDatabaseId ||
  configDatabaseId ||
  'ai-studio-senzuhome-cf81d161-42d7-42e4-96ab-3268a47c01d5';

const hasValidServiceAccount = Boolean(
  serviceAccount &&
    typeof (serviceAccount.project_id || serviceAccount.projectId) === 'string' &&
    typeof (serviceAccount.private_key || serviceAccount.privateKey) === 'string' &&
    typeof (serviceAccount.client_email || serviceAccount.clientEmail) === 'string'
);

// Single instance initialization across hot reloads
const ADMIN_APP_NAME = '[DEFAULT]';
let adminApp: App;

const existingApps = getApps();
const existingApp = existingApps.find((app) => app.name === ADMIN_APP_NAME);

if (!existingApp) {
  if (hasValidServiceAccount) {
    adminApp = initializeApp(
      {
        projectId,
        credential: cert(serviceAccount),
      },
      ADMIN_APP_NAME
    );
    console.log(`[FirebaseAdmin] Initialized Firebase Admin with service account for project: ${projectId}`);
  } else {
    adminApp = initializeApp(
      {
        projectId,
      },
      ADMIN_APP_NAME
    );
    console.log(`[FirebaseAdmin] Initialized Firebase Admin with Application Default Credentials for project: ${projectId}`);
  }
} else {
  adminApp = existingApp;
}

const rawAdminAuth: Auth = getAuth(adminApp);

async function verifyIdTokenWithFallback(idToken: string, checkRevoked?: boolean): Promise<any> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Invalid ID token');
  }
  const cleanToken = idToken.trim();
  try {
    return await rawAdminAuth.verifyIdToken(cleanToken, checkRevoked);
  } catch (adminErr) {
    if (apiKeyFromConfig) {
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKeyFromConfig}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: cleanToken }),
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as any;
        const user = data?.users?.[0];
        if (user?.localId) {
          return {
            uid: user.localId,
            sub: user.localId,
            email: user.email ? String(user.email).trim().toLowerCase() : undefined,
            email_verified: Boolean(user.emailVerified),
          };
        }
      }
    }
    throw adminErr;
  }
}

export const adminAuth: Auth = new Proxy(rawAdminAuth, {
  get(target, prop, receiver) {
    if (prop === 'verifyIdToken') {
      return verifyIdTokenWithFallback;
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export const adminDb: Firestore = getFirestore(adminApp, firestoreDatabaseId);

let adminMessagingInstance: Messaging | null = null;
try {
  adminMessagingInstance = getMessaging(adminApp);
} catch (e) {
  console.warn('[FirebaseAdmin] Warning initializing FCM messaging:', e);
}
export const adminMessaging = adminMessagingInstance;
export { adminApp, projectId, firestoreDatabaseId, FieldValue };
