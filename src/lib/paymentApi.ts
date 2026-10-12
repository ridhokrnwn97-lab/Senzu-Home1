import { auth } from './firebase';

/** Payment writes never fall back to direct client writes or locally invented success. */
export async function paymentRequest(path: string, body: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Silakan masuk untuk mengakses pembayaran.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna telah berubah.');
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || 'Layanan pembayaran tidak tersedia. Silakan coba kembali.');
  }
  return result;
}
