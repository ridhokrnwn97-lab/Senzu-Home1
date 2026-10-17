import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import path from 'path';
import fs from 'fs';

// Load service account key from filesystem
const serviceAccountPath = path.join(process.cwd(), 'src/server/serviceAccountKey.json');
let serviceAccount: any = {};

try {
  if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
  }
} catch (e) {
  console.warn('[FirebaseAdmin] Warning reading service account key:', e);
}

// Default project configuration fallback matching Senzu Home
let projectId = serviceAccount?.projectId || 'gen-lang-client-0466978413';
let firestoreDatabaseId = serviceAccount?.firestoreDatabaseId || 'ai-studio-senzuhome-cf81d161-42d7-42e4-96ab-3268a47c01d5';

// Try to read API key from firebase-applet-config.json for fallback Identity Toolkit
let apiKeyFromConfig = '';
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (cfg.apiKey) apiKeyFromConfig = cfg.apiKey;
  }
} catch (e) {
  console.warn('[FirebaseAdmin] Warning reading config file:', e);
}

// Single instance initialization across hot reloads
const ADMIN_APP_NAME = '[DEFAULT]';
let adminApp: App;

const existingApps = getApps();
const existingApp = existingApps.find((app) => app.name === ADMIN_APP_NAME);

if (!existingApp) {
  adminApp = initializeApp(
    {
      projectId,
      credential: cert(serviceAccount),
    },
    ADMIN_APP_NAME
  );
  console.log(`[FirebaseAdmin] Initialized Firebase Admin for project: ${projectId}`);
} else {
  adminApp = existingApp;
}

export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp, firestoreDatabaseId);

let adminMessagingInstance: Messaging | null = null;
try {
  adminMessagingInstance = getMessaging(adminApp);
} catch (e) {
  console.warn('[FirebaseAdmin] Warning initializing FCM messaging:', e);
}
export const adminMessaging = adminMessagingInstance;
export { adminApp, projectId, firestoreDatabaseId, FieldValue };
