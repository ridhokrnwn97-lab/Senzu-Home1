import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { defaultMetaAdsSettings, validateMetaAdsSettings, type MetaAdsSettings } from './metaAdsSettings';

// Existing settings rules: public configuration reads; only active Manager/Admin writes.
const settingsRef = () => doc(db, 'settings', 'meta_ads');

export async function getMetaAdsSettings(): Promise<MetaAdsSettings> {
  const snapshot = await getDocFromServer(settingsRef());
  return snapshot.exists() ? validateMetaAdsSettings(snapshot.data()) : defaultMetaAdsSettings();
}

export async function saveMetaAdsSettings(input: MetaAdsSettings): Promise<MetaAdsSettings> {
  const settings = validateMetaAdsSettings(input), session = auth.currentUser;
  if (!session?.uid) throw new Error('Silakan masuk sebagai Manager atau Admin.');
  const stable = () => {
    if (auth.currentUser !== session || auth.currentUser?.uid !== session.uid) throw new Error('Sesi berubah. Muat ulang pengaturan sebelum menyimpan.');
  };
  const next = { ...settings, revision: settings.revision + 1 };
  await runTransaction(db, async transaction => {
    stable();
    const reference = settingsRef(), snapshot = await transaction.get(reference);
    stable();
    const current = snapshot.exists() ? validateMetaAdsSettings(snapshot.data()) : defaultMetaAdsSettings();
    if (current.revision !== settings.revision) throw new Error('Pengaturan telah diubah pengguna lain. Muat ulang, lalu ulangi perubahan Anda.');
    // Authorization is enforced by existing Firestore Rules, never by caller-supplied roles.
    transaction.set(reference, { ...next, updatedAt: serverTimestamp() });
  });
  stable();
  return next;
}
