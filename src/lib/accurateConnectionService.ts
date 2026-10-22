import { auth } from './firebase';
import { ACCURATE_APP_NAME, ACCURATE_COMPANY, ACCURATE_MASTERS,
  type AccurateConfiguration, type AccurateConnectionCheck } from './accurateContracts';

async function request(action: 'configuration' | 'check', signal?: AbortSignal) {
  const user = auth.currentUser;
  if (!user) throw new Error('Silakan masuk sebagai Manager atau Admin.');
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna telah berubah.');
  const response = await fetch(`/api/integrations/accurate/${action}`, { method: 'POST', cache: 'no-store', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70000)]) : AbortSignal.timeout(70000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  const value = await response.json().catch(() => null);
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna telah berubah.');
  if (!response.ok || value?.success !== true) throw new Error('Pemeriksaan Accurate belum berhasil.' +
    (typeof value?.code === 'string' && /^[A-Z_]{1,60}$/.test(value.code) ? ` Kode: ${value.code}.` : ' Coba muat ulang.'));
  if (value.mode !== 'connection_only' || value.writesEnabled !== false) throw new Error('Mode koneksi Accurate tidak valid.');
  return value;
}
export async function readAccurateConfiguration(signal?: AbortSignal): Promise<AccurateConfiguration> {
  const v = await request('configuration', signal);
  if (['configured', 'apiTokenPresent', 'signatureSecretPresent', 'databaseIdPinned'].some(k => typeof v[k] !== 'boolean')) {
    throw new Error('Respons konfigurasi Accurate tidak valid.');
  }
  return v;
}
export async function checkAccurateConnection(signal?: AbortSignal): Promise<AccurateConnectionCheck> {
  const v = await request('check', signal);
  if (v.connected !== true || v.companyName !== ACCURATE_COMPANY || v.applicationName !== ACCURATE_APP_NAME ||
      !Number.isSafeInteger(v.databaseId) || v.databaseId <= 0 || typeof v.databaseIdPinned !== 'boolean' ||
      !['administrator', 'operator'].includes(v.access) || typeof v.checkedAt !== 'string' || !Number.isFinite(Date.parse(v.checkedAt)) ||
      typeof v.mastersMatch !== 'boolean' || !Array.isArray(v.checks) || v.checks.length !== ACCURATE_MASTERS.length ||
      v.checks.some((r: any, i: number) => r?.code !== ACCURATE_MASTERS[i].code || r.kind !== ACCURATE_MASTERS[i].kind ||
        r.name !== ACCURATE_MASTERS[i].name || !['match', 'mismatch', 'unverified'].includes(r.status) || typeof r.note !== 'string') ||
      v.mastersMatch !== v.checks.every((r: any) => r.status === 'match')) throw new Error('Respons pemeriksaan Accurate tidak valid.');
  return v;
}
