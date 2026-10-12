import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  setLogLevel,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);

let dbInstance: Firestore;
try {
  // Use persistent local cache (IndexedDB) with multi-tab manager and auto-detect long polling
  // This drastically reduces Firestore read quotas, caches data locally,
  // prevents WebSocket connection drop errors in reverse proxy/sandbox environments,
  // and allows the application to function smoothly even when quotas are exhausted or offline.
  dbInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
      experimentalAutoDetectLongPolling: true,
    },
    firebaseConfig.firestoreDatabaseId || '(default)'
  );
} catch {
  // Fall back to getFirestore if already initialized or not supported in this runtime
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
}

export const db = dbInstance;

// Set Firestore SDK log level to error to prevent noisy gRPC idle stream warnings
try {
  setLogLevel('error');
} catch {}

export default app;

