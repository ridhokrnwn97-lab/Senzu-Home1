import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
  setLogLevel,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);

// Silence internal Firestore SDK console errors (such as multi-tab lease contention or idle stream disconnects)
try {
  setLogLevel('silent');
} catch {}

let dbInstance: Firestore;
try {
  // Use in-memory local cache with auto-detect long polling to avoid IndexedDB
  // primary lease contention ('Apply remote event', 'Backfill Indexes', 'Collect garbage')
  // across preview iframes and multiple tabs while maintaining reliable connections.
  dbInstance = initializeFirestore(
    app,
    {
      localCache: memoryLocalCache(),
      experimentalAutoDetectLongPolling: true,
    },
    firebaseConfig.firestoreDatabaseId || '(default)'
  );
} catch {
  // Fall back to getFirestore if already initialized or not supported in this runtime
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
}

export const db = dbInstance;

export default app;

