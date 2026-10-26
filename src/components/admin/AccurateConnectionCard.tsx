import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import type { StaffUser } from '../../types';
import type { AccurateConfiguration, AccurateConnectionCheck } from '../../lib/accurateContracts';
import { readAccurateConfiguration, checkAccurateConnection } from '../../lib/accurateConnectionService';

export function AccurateConnectionCard({ currentUser }: { currentUser: StaffUser }) {
  const allowed = ['manager', 'admin'].includes(currentUser.role);
  const [configuration, setConfiguration] = useState<AccurateConfiguration | null>(null);
  const [result, setResult] = useState<AccurateConnectionCheck | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0), inFlight = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const off = onAuthStateChanged(auth, user => {
      const version = ++generation.current;
      controller.current?.abort(); controller.current = null;
      setConfiguration(null); setResult(null); setError(''); setBusy(false); inFlight.current = false;
      if (!user || !allowed) return;
      const request = new AbortController(); controller.current = request;
      inFlight.current = true; setBusy(true);
      readAccurateConfiguration(request.signal).then(c => { if (generation.current === version) setConfiguration(c); })
        .catch(() => { if (generation.current === version) setError('Konfigurasi Accurate belum dapat dimuat. Coba muat ulang.'); })
        .finally(() => { if (generation.current === version) { inFlight.current = false; setBusy(false); } });
    });
    return () => { generation.current++; controller.current?.abort(); off(); };
  }, [currentUser.uid, currentUser.role, allowed]);
  if (!allowed) return null;
  const act = async (action: 'configuration' | 'check') => {
    if (inFlight.current) return;
    const version = generation.current, request = new AbortController(); controller.current = request;
    inFlight.current = true; setBusy(true); setError(''); setResult(null);
    try {
      if (action === 'check') {
        const value = await checkAccurateConnection(request.signal);
        if (generation.current === version) setResult(value);
      } else {
        setConfiguration(null);
        const value = await readAccurateConfiguration(request.signal);
        if (generation.current === version) setConfiguration(value);
      }
    } catch (e: any) { if (generation.current === version) setError(e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'Pemeriksaan belum selesai. Coba kembali.' : e.message); }
    finally { if (generation.current === version) { inFlight.current = false; setBusy(false); } }
  };
  return <section aria-label="Accurate Online — Koneksi" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h3 className="text-lg font-bold text-[#4B2B18]">Accurate Online — Koneksi</h3>
    <p className="text-sm text-slate-600">Periksa koneksi ke PT KSBONE UNTUK KITA serta akun dan layanan Senzu Home.</p>
    <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900"><strong>Panel ini hanya memeriksa koneksi.</strong> Pemeriksaan ini membaca data; tidak membuat faktur, penerimaan penjualan, atau jurnal. Status pengiriman ada pada panel Pencatatan Transaksi.</p>
    {configuration && <div className="space-y-1 text-sm text-slate-700">
      <p>API Token: {configuration.apiTokenPresent ? 'tersedia' : 'belum tersedia atau format tidak valid'}.</p>
      <p>Signature Secret: {configuration.signatureSecretPresent ? 'tersedia' : 'belum tersedia atau format tidak valid'}.</p>
      <p>Kelengkapan Secrets: <strong>{configuration.configured ? 'siap diperiksa' : 'perlu dilengkapi'}</strong>.</p>
    </div>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => act('configuration')} className="min-h-[44px] rounded-lg border px-4 py-2 text-sm font-semibold text-[#4B2B18] disabled:opacity-50">Muat Ulang Konfigurasi Accurate</button>
      <button type="button" disabled={busy || !configuration?.configured} onClick={() => act('check')} className="min-h-[44px] rounded-lg bg-[#8B5A36] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Periksa Koneksi dan Master</button>
    </div>
    {busy && <p role="status" className="text-sm text-slate-600">Sedang memeriksa Accurate…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {result && <div className="space-y-3 text-sm text-slate-700">
      <p role="status" className={`rounded-lg p-3 ${result.mastersMatch ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{result.mastersMatch ? 'Koneksi berhasil. Seluruh master yang diperiksa cocok.' : 'Koneksi berhasil. Ada master yang perlu diperiksa.'}</p>
      <p>{result.companyName} · ID database: <strong>{result.databaseId}</strong> · Hak API: {result.access === 'administrator' ? 'Administrator' : 'Operator'}.</p>
      <p className="text-xs">Diperiksa: {new Date(result.checkedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Hasil pemeriksaan akun dan layanan Accurate</caption>
        <thead><tr className="border-b"><th scope="col" className="p-2">Kode</th><th scope="col" className="p-2">Akun / Layanan</th><th scope="col" className="p-2">Hasil</th></tr></thead>
        <tbody>{result.checks.map(row => <tr key={row.code} className="border-b"><td className="whitespace-nowrap p-2">{row.code}</td><td className="p-2">{row.name}</td><td className={`p-2 ${row.status === 'match' ? 'text-emerald-800' : 'text-amber-900'}`}>{row.note}</td></tr>)}</tbody>
      </table></div>
    </div>}
    <details className="rounded-xl border p-4 text-sm text-slate-600"><summary className="cursor-pointer font-semibold">Pengaturan koneksi</summary>
      <p className="mt-3">Simpan <code>ACCURATE_API_TOKEN</code> dan <code>ACCURATE_SIGNATURE_SECRET</code> di Secrets server. Nilainya tidak dimasukkan melalui panel ini.</p>
      <p className="mt-2">Kelengkapan Secrets belum membuktikan koneksi berhasil. Gunakan tombol pemeriksaan untuk menguji API Accurate.</p>
    </details>
  </section>;
}
