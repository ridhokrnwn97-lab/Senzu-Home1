import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { CreditCard, ExternalLink, RefreshCw } from 'lucide-react';
import { auth } from '../../lib/firebase';
import type { StaffUser } from '../../types';
import { createXenditTestSession, getLatestXenditTestSession, getXenditTestStatus, readXenditTestSession,
  safeXenditTestLink, type XenditTestSession, type XenditTestStatus } from '../../lib/xenditSandboxService';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-[#082A4F] hover:bg-slate-50 disabled:opacity-50';
const labels: Record<string, string> = { ACTIVE: 'Menunggu simulasi pembayaran', COMPLETED: 'Sesi Test selesai',
  EXPIRED: 'Sesi Test kedaluwarsa', CANCELED: 'Sesi Test dibatalkan', creating: 'Sedang dibuat',
  uncertain: 'Hasil pembuatan belum pasti', rejected: 'Permintaan ditolak Xendit' };

export function XenditSandboxCard({ currentUser }: { currentUser: StaffUser }) {
  const [status, setStatus] = useState<XenditTestStatus | null>(null);
  const [session, setSession] = useState<XenditTestSession | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const generation = useRef(0), attempt = useRef(''), inFlight = useRef(false);
  const allowed = ['manager', 'admin'].includes(currentUser.role);

  useEffect(() => {
    let controller: AbortController | null = null;
    const off = onAuthStateChanged(auth, user => {
      const gen = ++generation.current;
      controller?.abort(); controller = new AbortController();
      attempt.current = ''; inFlight.current = false;
      setStatus(null); setSession(null); setReady(false); setBusy(false); setError('');
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

  const act = async (action: 'load' | 'create' | 'read' | 'new') => {
    if (!allowed || inFlight.current) return;
    const gen = generation.current, owner = auth.currentUser;
    if (!owner) { setError('Silakan masuk sebagai Manager atau Admin.'); return; }
    const stable = () => generation.current === gen && auth.currentUser === owner;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (action === 'load') {
        const [configuration, latest] = await Promise.all([getXenditTestStatus(), getLatestXenditTestSession()]);
        if (stable()) { setStatus(configuration); setSession(latest); setReady(true); }
      } else if (action === 'read' && session) {
        const value = await readXenditTestSession(session.referenceId);
        if (stable()) setSession(value);
      } else if (action === 'create' || action === 'new') {
        if (action === 'new') attempt.current = '';
        if (!attempt.current) attempt.current = crypto.randomUUID();
        const value = await createXenditTestSession(attempt.current);
        if (stable()) setSession(value);
      }
    } catch (problem: any) {
      if (stable()) setError(problem.message || 'Permintaan gagal. Muat ulang untuk memeriksa percobaan sebelumnya.');
    } finally { if (stable()) { inFlight.current = false; setBusy(false); } }
  };
  if (!allowed) return null;
  const terminal = session?.creationState === 'rejected' || ['COMPLETED', 'EXPIRED', 'CANCELED'].includes(session?.sessionStatus || '');
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="xendit-test-heading">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
      <div className="flex items-center gap-3"><CreditCard className="h-6 w-6 text-[#082A4F]" /><div>
        <h3 id="xendit-test-heading" className="font-serif text-lg font-bold text-[#082A4F]">Xendit — Mode Tes</h3>
        <p className="mt-1 text-xs text-slate-500">Uji koneksi pembayaran sebelum aktivasi pelanggan.</p>
      </div></div>
      <button type="button" className={button} disabled={busy} onClick={() => act('load')}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Muat Ulang</button>
    </div>
    <div className="space-y-4 p-5 sm:p-6">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Simulasi Rp10.000 tanpa uang nyata. Tidak melunasi booking, tidak mengirim terapis, dan tidak masuk pembukuan Accurate. Gunakan simulasi pada checkout Xendit Mode Tes.</p>
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
        {session.expiresAt && <p className="text-xs">Batas sesi: {new Date(session.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</p>}
        <p className="text-xs">Webhook: {session.lastWebhookAt ? 'Sudah diterima dan dicocokkan dengan API Xendit' : 'Belum diterima'}</p>
        <p className="text-xs">Sesi Test selesai tetap tidak mengubah status pembayaran pesanan asli.</p>
        {['creating', 'uncertain'].includes(session.creationState) && <p className="text-xs text-amber-800">Jangan membuat transaksi pengganti. Periksa sesi di dashboard Xendit dan tunggu webhook; permintaan dengan hasil belum pasti tidak dikirim ulang otomatis.</p>}
      </div>}
      <div className="flex flex-wrap gap-3">
        {!session && <button type="button" className={button} disabled={busy || !ready || !status?.configured} onClick={() => act('create')}>Buat Checkout Test Rp10.000</button>}
        {session && <button type="button" className={button} disabled={busy || !status?.configured} onClick={() => act('read')}>Periksa Status Xendit</button>}
        {session?.checkoutUrl && session.sessionStatus === 'ACTIVE' && <a className={button} href={safeXenditTestLink(session.checkoutUrl)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Buka Checkout Test</a>}
        {terminal && <button type="button" className={button} disabled={busy || !status?.configured} onClick={() => act('new')}>Buat Percobaan Test Baru</button>}
      </div>
    </div>
  </section>;
}
