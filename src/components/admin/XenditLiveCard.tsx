import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import type { StaffUser } from '../../types';
import { readLiveConfiguration, recoverLivePayment, inspectLivePayment } from '../../lib/xenditLiveService';
import type { XenditLiveSession } from '../../lib/xenditLiveContracts';

export function XenditLiveCard({ currentUser }: { currentUser: StaffUser }) {
  const [configuration, setConfiguration] = useState<any>(null), [error, setError] = useState(''), [result, setResult] = useState('');
  const [bookingId, setBookingId] = useState(''), [sessionId, setSessionId] = useState(''), [busy, setBusy] = useState(false);
  const [inspected,setInspected] = useState<XenditLiveSession | null>(null);
  const gen = useRef(0), inFlight = useRef(false);
  const sourceLabels = {webhook:'Webhook',check:'Tombol Periksa ke Xendit',recovery:'Pencocokan sesi oleh Manager',create:'Respons pembuatan sesi'};
  const allowed = ['manager', 'admin'].includes(currentUser.role);
  useEffect(() => {
    const off = onAuthStateChanged(auth, user => {
      const version = ++gen.current; setConfiguration(null); setError(''); setResult(''); setInspected(null); setBookingId(''); setSessionId(''); inFlight.current = false; setBusy(false);
      if (!user || !allowed) return;
      readLiveConfiguration().then(c => { if (gen.current === version) setConfiguration(c); })
        .catch(e => { if (gen.current === version) setError(e.message); });
    });
    return () => { gen.current++; off(); };
  }, [currentUser.uid, currentUser.role, allowed]);
  if (!allowed) return null;
  const act = async (action: 'configuration' | 'inspect' | 'recover') => {
    if (inFlight.current) return;
    const version = gen.current; inFlight.current = true; setBusy(true); setError(''); setResult('');
    try {
      if (action !== 'configuration') {
        const value = await (action === 'inspect' ? inspectLivePayment(bookingId.trim()) : recoverLivePayment(bookingId.trim(), sessionId.trim()));
        if (gen.current === version) {
          setInspected(value);
          setResult(value ? `${action === 'inspect' ? 'Status tersimpan' : 'Sesi cocok'}. Status: ${value.sessionStatus || value.creationState}. Nominal: Rp${value.amount.toLocaleString('id-ID')}.` : 'Pesanan ini belum memiliki sesi Xendit.');
        }
      } else {
        const value = await readLiveConfiguration(); if (gen.current === version) setConfiguration(value);
      }
    } catch (e: any) { if (gen.current === version) setError(e.message); }
    finally { if (gen.current === version) { inFlight.current = false; setBusy(false); } }
  };
  return <section aria-label="Xendit — Pembayaran Pelanggan" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h3 className="text-lg font-bold text-[#4B2B18]">Xendit — Pembayaran Pelanggan</h3>
    <p className="text-sm text-slate-600">Pembayaran Live menagih uang nyata. Checkout dibuat dari pesanan pelanggan, dengan total penuh yang diverifikasi server.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {result && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{result}</p>}
    {configuration && <div className="space-y-2 text-sm text-slate-700">
      <p>Pembayaran pelanggan: <strong>{configuration.available ? 'Aktif' : 'Belum aktif'}</strong>.</p>
      <p>Secret Live: {configuration.liveKeyPresent ? 'tersedia' : 'belum tersedia'} · Token webhook Live: {configuration.liveTokenPresent ? 'tersedia' : 'belum tersedia'} · Business ID: {configuration.businessIdPresent ? 'tersedia' : 'belum tersedia'}.</p>
      <p>Verifikasi jarak layanan: {configuration.routeKeyPresent ? 'key tersedia' : 'key belum tersedia'}.</p>
      <p className="text-xs text-slate-500">Status konfigurasi belum membuktikan pembayaran Live berhasil. Simpan secret hanya di Secrets server.</p>
      <label className="block space-y-1 text-xs">URL webhook Live<input readOnly value={`${window.location.origin}${configuration.webhookPath}`} className="w-full rounded-lg border p-2" /></label>
    </div>}
    <button type="button" disabled={busy} onClick={() => act('configuration')} className="min-h-[44px] rounded-lg border px-4 py-2 font-semibold text-[#4B2B18] disabled:opacity-50">Muat Ulang Konfigurasi</button>
    <div className="space-y-3 rounded-xl border p-4 text-sm text-slate-700">
      <label className="block">ID Booking<input disabled={busy} value={bookingId} onChange={e => { setBookingId(e.target.value); setInspected(null); setResult(''); }} placeholder="bk_SH-..." className="mt-1 w-full rounded-lg border p-2" /></label>
      <button type="button" disabled={busy || !/^[A-Za-z0-9_-]{1,128}$/.test(bookingId.trim())} onClick={() => act('inspect')}
        className="min-h-[44px] rounded-lg border px-4 py-2 font-semibold disabled:opacity-50">Lihat Status Tersimpan</button>
      <p className="text-xs text-slate-500">Membaca catatan aplikasi tanpa memanggil API Xendit atau membuat checkout.</p>
      {inspected && <div className="space-y-1 text-xs">
        <p className="break-all">Referensi: {inspected.referenceId}</p>
        <p>Status pembayaran: {inspected.paymentStatus}{inspected.reconciliationRequired ? ' — perlu pemeriksaan Customer Service' : ''}.</p>
        <p>Konfirmasi lunas pertama: {inspected.paidSource ? sourceLabels[inspected.paidSource] : 'Belum ada'}.</p>
        <p>Webhook terverifikasi terakhir: {inspected.lastWebhookAt ? `${new Date(inspected.lastWebhookAt).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'})} WIB` : 'Belum ada'}.</p>
        <p>Pemeriksaan API terakhir: {inspected.lastCheckedAt ? `${new Date(inspected.lastCheckedAt).toLocaleString('id-ID', {timeZone:'Asia/Jakarta'})} WIB` : 'Belum ada'}.</p>
      </div>}
    </div>
    <details className="rounded-xl border p-4 text-sm text-slate-700"><summary className="cursor-pointer font-semibold">Pulihkan pembayaran dengan ID sesi Xendit</summary>
      <div className="mt-4 space-y-3"><p>Gunakan hanya jika checkout pesanan sudah dibuat tetapi ID sesi belum tersimpan. Pencocokan tidak membuat checkout baru.</p>
        <label className="block">Payment Session ID<input disabled={busy} value={sessionId} onChange={e => setSessionId(e.target.value)} placeholder="ps-..." className="mt-1 w-full rounded-lg border p-2" /></label>
        <button type="button" disabled={busy || !/^[A-Za-z0-9_-]{1,128}$/.test(bookingId.trim()) || !/^ps-[A-Za-z0-9-]{16,80}$/.test(sessionId.trim())}
          onClick={() => act('recover')} className="min-h-[44px] rounded-lg border px-4 py-2 font-semibold disabled:opacity-50">Cocokkan Sesi Live</button>
      </div>
    </details>
  </section>;
}
