import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { CreditCard, ExternalLink, RefreshCw } from 'lucide-react';
import { auth } from '../../lib/firebase';
import type { StaffUser } from '../../types';
import { normalizeXenditBookingPreview, type XenditBookingPreviewInput } from '../../lib/xenditBookingPreview';
import { closeReviewedXenditTestAttempt, createXenditTestSession, getLatestXenditTestSession, getXenditTestStatus, readXenditTestSession,
  safeXenditTestLink, type XenditTestSession, type XenditTestStatus } from '../../lib/xenditSandboxService';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-[#4B2B18] hover:bg-slate-50 disabled:opacity-50';
const labels: Record<string, string> = { ACTIVE: 'Menunggu simulasi pembayaran', COMPLETED: 'Sesi Test selesai',
  EXPIRED: 'Sesi Test kedaluwarsa', CANCELED: 'Sesi Test dibatalkan', creating: 'Sedang dibuat',
  uncertain: 'Hasil pembuatan belum pasti', rejected: 'Permintaan ditolak Xendit',
  review_closed: 'Catatan percobaan Test ditutup setelah pemeriksaan' };

export function XenditSandboxCard({ currentUser, bookingPreview }: {
  currentUser: StaffUser; bookingPreview?: XenditBookingPreviewInput | null;
}) {
  const [status, setStatus] = useState<XenditTestStatus | null>(null);
  const [session, setSession] = useState<XenditTestSession | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [recoverySessionId, setRecoverySessionId] = useState('');
  const [dashboardChecked, setDashboardChecked] = useState(false);
  const generation = useRef(0), attempt = useRef(''), attemptInput = useRef(''), inFlight = useRef(false);
  const allowed = ['manager', 'admin'].includes(currentUser.role);
  const bookingCheckout = bookingPreview !== undefined;
  const headingId = React.useId();
  let previewError = '';
  if (bookingCheckout) {
    try { normalizeXenditBookingPreview(bookingPreview); }
    catch (problem: any) { previewError = problem.message; }
  }
  const rupiah = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

  useEffect(() => {
    let controller: AbortController | null = null;
    const off = onAuthStateChanged(auth, user => {
      const gen = ++generation.current;
      controller?.abort(); controller = new AbortController();
      attempt.current = ''; attemptInput.current = ''; inFlight.current = false;
      setStatus(null); setSession(null); setReady(false); setBusy(false); setError('');
      setRecoverySessionId(''); setDashboardChecked(false);
      if (!allowed || !user) return;
      setBusy(true);
      Promise.all([getXenditTestStatus(controller.signal), getLatestXenditTestSession(controller.signal)])
        .then(([configuration, latest]) => {
          if (generation.current !== gen) return;
          setStatus(configuration); setSession(latest); setReady(true);
        }).catch(problem => {
          if (generation.current === gen) setError(problem.message || 'Panel uji belum dapat dimuat.');
        }).finally(() => { if (generation.current === gen) setBusy(false); });
    });
    return () => { generation.current++; controller?.abort(); off(); };
  }, [currentUser.uid, currentUser.role, allowed]);
  useEffect(() => { setRecoverySessionId(''); setDashboardChecked(false); }, [session?.referenceId]);

  const act = async (action: 'load' | 'create' | 'read' | 'new' | 'recover' | 'review-close') => {
    if (!allowed || inFlight.current) return;
    const gen = generation.current, owner = auth.currentUser;
    if (!owner) { setError('Silakan masuk sebagai Manager atau Admin.'); return; }
    const stable = () => generation.current === gen && auth.currentUser === owner;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (action === 'load') {
        const [configuration, latest] = await Promise.all([getXenditTestStatus(), getLatestXenditTestSession()]);
        if (stable()) { setStatus(configuration); setSession(latest); setReady(true); }
      } else if ((action === 'read' || action === 'recover') && session) {
        const value = await readXenditTestSession(session.referenceId, action === 'recover' ? recoverySessionId.trim() : undefined);
        if (stable()) setSession(value);
      } else if (action === 'review-close' && session && dashboardChecked && session.reviewCloseAllowed) {
        const value = await closeReviewedXenditTestAttempt(session.referenceId);
        if (stable()) { setSession(value); setDashboardChecked(false); }
      } else if (action === 'create' || action === 'new') {
        const input = bookingCheckout ? normalizeXenditBookingPreview(bookingPreview) : undefined;
        const fingerprint = JSON.stringify(input || null);
        if (action === 'new') { attempt.current = ''; attemptInput.current = ''; }
        if (attempt.current && attemptInput.current !== fingerprint) {
          throw new Error('Isian berubah setelah percobaan dikirim. Muat ulang dan pulihkan percobaan tersimpan dahulu.');
        }
        if (!attempt.current) attempt.current = crypto.randomUUID();
        attemptInput.current = fingerprint;
        const value = await createXenditTestSession(attempt.current, input);
        if (stable()) setSession(value);
      }
    } catch (problem: any) {
      if (stable()) {
        setError(problem.message || 'Permintaan gagal. Muat ulang untuk memeriksa percobaan sebelumnya.');
        // Creation can succeed at the server even when its response is lost.
        // Refresh the persisted intent; never silently leave the old expired card.
        if (action === 'create' || action === 'new') {
          try { const latest = await getLatestXenditTestSession(); if (stable()) setSession(latest); }
          catch { /* Keep the original error and allow an explicit reload. */ }
        }
      }
    } finally { if (stable()) { inFlight.current = false; setBusy(false); } }
  };
  if (!allowed) return null;
  const terminal = ['rejected', 'review_closed'].includes(session?.creationState || '') || ['COMPLETED', 'EXPIRED', 'CANCELED'].includes(session?.sessionStatus || '');
  const recoverable = session && !session.sessionId && ['creating', 'uncertain'].includes(session.creationState);
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby={headingId}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
      <div className="flex items-center gap-3"><CreditCard className="h-6 w-6 text-[#4B2B18]" /><div>
        <h3 id={headingId} className="font-serif text-lg font-bold text-[#4B2B18]">{bookingCheckout ? 'Xendit — Uji Checkout Booking' : 'Xendit — Mode Tes'}</h3>
        <p className="mt-1 text-xs text-slate-500">Uji koneksi pembayaran sebelum aktivasi pelanggan.</p>
      </div></div>
      <button type="button" className={button} disabled={busy} onClick={() => act('load')}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Muat Ulang</button>
    </div>
    <div className="space-y-4 p-5 sm:p-6">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {bookingCheckout ? 'Uji pembayaran 100% dari ringkasan formulir, khusus Manager/Admin. ' : 'Uji pembayaran tanpa uang nyata. '}
        Tidak membuat atau melunasi pesanan layanan, tidak mengirim terapis, dan tidak masuk pembukuan Accurate. Gunakan fasilitas simulasi Xendit Mode Tes.
      </p>
      {bookingCheckout && <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
        <p>Total pada formulir saat ini: <strong>{bookingPreview ? rupiah(bookingPreview.expectedAmount) : 'Belum tersedia'}</strong>.</p>
        <p>Harga layanan diperiksa ke katalog server. Jarak dan potongan pada formulir hanya disimulasikan; voucher dan poin tidak dipakai atau dikurangi.</p>
        {previewError && <p role="alert" className="text-amber-800">{previewError}</p>}
      </div>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {busy && <p role="status" className="text-sm text-slate-500">Memproses permintaan Xendit...</p>}
      {status && <>
        <p className="text-sm text-slate-700">Konfigurasi: <strong>{status.configured ? 'Secret Test tersedia' : 'Belum siap'}</strong>. {status.message}</p>
        <p className="text-xs text-slate-500">Status ini memeriksa konfigurasi server. Koneksi API dibuktikan setelah sesi Test berhasil dibuat.</p>
        <label className="block space-y-1 text-xs font-semibold text-slate-600">URL webhook Mode Tes
          <input readOnly value={`${window.location.origin}${status.webhookPath}`} onFocus={event => event.target.select()}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-normal text-slate-700" />
        </label>
        <p className="text-xs text-slate-500">Gunakan untuk peristiwa Payment Session Completed dan Expired di Xendit Mode Tes. URL yang sama harus dapat dijangkau Xendit setelah aplikasi dipublikasikan.</p>
      </>}
      {session && <div className="space-y-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
        <p>Status: <strong>{labels[session.sessionStatus || session.creationState] || 'Belum tersedia'}</strong></p>
        <p className="break-all text-xs">Referensi: {session.referenceId}</p>
        <p className="text-xs">Nominal sesi tersimpan: <strong>{rupiah(session.amount)}</strong>.</p>
        {session.bookingPreview && <div className="space-y-1 text-xs">
          <p>Layanan sesi: {session.bookingPreview.serviceName} — {rupiah(session.bookingPreview.servicePrice)}</p>
          <p>Biaya kunjungan: {rupiah(session.bookingPreview.homeServiceFee)} · Potongan simulasi: {rupiah(session.bookingPreview.discountAmount)}</p>
          <p>Ringkasan sesi dikunci saat dibuat. Perubahan formulir berlaku untuk percobaan baru setelah sesi ini selesai.</p>
        </div>}
        {session.expiresAt && <p className="text-xs">Batas sesi: {new Date(session.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</p>}
        <p className="text-xs">Webhook: {session.lastWebhookAt ? 'Sudah diterima dan dicocokkan dengan API Xendit' : 'Belum diterima'}</p>
        <p className="text-xs">Sesi Test selesai tetap tidak mengubah status pembayaran pesanan asli.</p>
        {session.lastError && <p className="text-xs text-amber-800">Hasil terakhir: {session.lastError.upstreamCode || session.lastError.code}{session.lastError.upstreamStatus ? ` (HTTP ${session.lastError.upstreamStatus})` : ''}.</p>}
        {recoverable && <p className="text-xs text-amber-800">ID sesi belum tersimpan. Periksa referensi ini di Tautan Pembayaran pada dashboard Xendit Mode Tes, lalu gunakan pemulihan di bawah. Tombol periksa status tidak akan membuat sesi baru.</p>}
        {session.creationState === 'review_closed' && <p className="text-xs text-slate-600">Penutupan ini mencatat hasil pemeriksaan Manager. Ini bukan konfirmasi pembatalan atau pembayaran di Xendit. Catatan lama dan penerimaan webhook tetap dipertahankan.</p>}
      </div>}
      {recoverable && <div className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
        <p className="font-semibold">Pemulihan percobaan Test</p>
        <label className="block space-y-1 text-xs">Jika sesi ditemukan, masukkan Payment Session ID dari detail Xendit.
          <input aria-label="Payment Session ID" value={recoverySessionId} onChange={event => setRecoverySessionId(event.target.value)}
            placeholder="ps-..." disabled={busy} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <button type="button" className={button} disabled={busy || !status?.configured || !/^ps-[a-zA-Z0-9-]{16,80}$/.test(recoverySessionId.trim())}
          onClick={() => act('recover')}>Cocokkan Sesi Xendit</button>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={dashboardChecked} disabled={busy} onChange={event => setDashboardChecked(event.target.checked)} />
          <span>Saya sudah mencari referensi percobaan ini di Xendit Mode Tes dan tidak menemukan sesinya.</span>
        </label>
        <button type="button" className={button} disabled={busy || !status?.configured || !dashboardChecked || !session.reviewCloseAllowed}
          onClick={() => act('review-close')}>Tutup Percobaan yang Tidak Ditemukan</button>
        {!session.reviewCloseAllowed && <p className="text-xs text-slate-500">Penutupan memerlukan jeda minimal dua menit. Jika ID sesi sudah diterima server, gunakan pemeriksaan status untuk memulihkannya.</p>}
        <p className="text-xs text-slate-500">Tidak mengirim ulang permintaan checkout. Setelah ditutup, percobaan baru hanya dibuat jika Anda menekan tombolnya.</p>
      </div>}
      <div className="flex flex-wrap gap-3">
        {!session && <button type="button" className={button} disabled={busy || !ready || !status?.configured || Boolean(previewError)} onClick={() => act('create')}>{bookingCheckout ? 'Buat Checkout Test sesuai Ringkasan' : 'Buat Checkout Test Rp10.000'}</button>}
        {session && <button type="button" className={button} disabled={busy || !status?.configured} onClick={() => act('read')}>Periksa Status Xendit</button>}
        {session?.checkoutUrl && session.sessionStatus === 'ACTIVE' && <a className={button} href={safeXenditTestLink(session.checkoutUrl)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Buka Checkout Test</a>}
        {terminal && <button type="button" className={button} disabled={busy || !status?.configured || Boolean(previewError)} onClick={() => act('new')}>{bookingCheckout ? 'Buat Checkout Test sesuai Ringkasan' : 'Buat Percobaan Test Baru'}</button>}
      </div>
    </div>
  </section>;
}
