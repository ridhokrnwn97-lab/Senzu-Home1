import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { CheckCircle2, CreditCard, RefreshCw } from 'lucide-react';
import type { Booking } from '../../types';
import { auth } from '../../lib/firebase';
import { createLivePayment, readLivePayment, checkLivePayment, rememberLiveReturn } from '../../lib/xenditLiveService';
import { safeLiveCheckoutUrl, type XenditLiveSession } from '../../lib/xenditLiveContracts';
import { formatRupiah } from '../../lib/utils';

export function XenditLivePaymentPage({ booking, onOpenTracking, onBackToBooking }: {
  booking: Booking; onOpenTracking?: (code: string) => void; onBackToBooking?: () => void;
}) {
  const [session, setSession] = useState<XenditLiveSession | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const generation = useRef(0), serial = useRef(0), inFlight = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const off = onAuthStateChanged(auth, user => {
      clearInterval(timer); const gen = ++generation.current;
      serial.current++; inFlight.current = false; setSession(null); setReady(false); setError(''); setBusy(false);
      if (!user) { setError('Masuk ke akun pemesan untuk melihat status pembayaran.'); return; }
      const read = async () => {
        if (inFlight.current || document.visibilityState === 'hidden') return;
        const version = ++serial.current;
        try {
          const result = await readLivePayment(booking.id);
          if (generation.current === gen && serial.current === version) { setSession(result); setReady(true); }
        } catch (e: any) { if (generation.current === gen && serial.current === version) setError(e.message); }
      };
      void read(); timer = setInterval(read, 15000);
    });
    return () => { generation.current++; serial.current++; clearInterval(timer); off(); };
  }, [booking.id]);
  const act = async (action: 'create' | 'read' | 'check') => {
    if (inFlight.current) return;
    const gen = generation.current, version = ++serial.current;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await (action === 'create' ? createLivePayment(booking.id) : action === 'check' ? checkLivePayment(booking.id) : readLivePayment(booking.id));
      if (generation.current === gen && serial.current === version) { setSession(result); setReady(true); }
    } catch (e: any) {
      if (generation.current === gen && serial.current === version) {
        setError(e.message || 'Pembayaran belum dapat diproses.');
        // A failed browser response must never cause another create request.
        if (action === 'create') {
          try { const saved = await readLivePayment(booking.id); if (generation.current === gen && serial.current === version) { setSession(saved); setReady(true); } } catch {}
        }
      }
    } finally { if (generation.current === gen && serial.current === version) { inFlight.current = false; setBusy(false); } }
  };
  const paid = session?.paymentStatus === 'paid' && session.sessionStatus === 'COMPLETED';
  const ended = ['EXPIRED', 'CANCELED'].includes(session?.sessionStatus || '') || session?.creationState === 'rejected';
  const waiting = session && !session.sessionId && ['creating', 'uncertain'].includes(session.creationState);
  const button = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-senzu-brand disabled:opacity-50';
  return <section aria-label="Pembayaran Xendit" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <div className="flex items-start gap-3"><CreditCard className="mt-1 h-6 w-6 text-senzu-brand" /><div>
      <h2 className="text-xl font-bold text-senzu-brand">Pembayaran Senzu Home</h2>
      <p className="mt-1 text-sm text-slate-500">Pesanan {booking.bookingCode}</p>
    </div></div>
    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-sm text-slate-600">Total pembayaran</p>
      <strong className="text-2xl text-senzu-brand">{formatRupiah(session?.amount ?? booking.totalAmount)}</strong>
      <p className="mt-2 text-sm text-slate-600">Pembayaran 100% diperlukan sebelum terapis berangkat.</p>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {paid ? <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
      <p className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" />Pembayaran diterima</p>
      <p className="mt-1 text-sm">{session.reconciliationRequired ? 'Pembayaran memerlukan pemeriksaan Customer Service. Jadwal layanan belum dikonfirmasi otomatis.' : 'Pembayaran penuh telah dikonfirmasi Xendit. Pantau status penugasan terapis pada pesanan Anda.'}</p>
    </div> : <>
      <p role="status" className="text-sm text-slate-700">{ended ? 'Sesi pembayaran telah ditutup. Hubungi Customer Service untuk kelanjutan pesanan ini.' : waiting ? 'Pembayaran sedang diproses. Muat ulang status pesanan ini atau hubungi Customer Service dengan kode pesanan Anda.' : 'Menunggu pembayaran melalui Xendit.'}</p>
      {session?.expiresAt && <p className="text-xs text-slate-500">Batas sesi: {new Date(session.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</p>}
      {!session && <button type="button" className={`${button} w-full bg-senzu-brand text-white`} disabled={busy || !ready} onClick={() => act('create')}>Siapkan Pembayaran Xendit</button>}
      {session?.sessionStatus === 'ACTIVE' && session.checkoutUrl && <a className={`${button} w-full bg-senzu-brand text-white`}
        href={safeLiveCheckoutUrl(session.checkoutUrl)} onClick={() => rememberLiveReturn(booking.id)}>Lanjut ke Pembayaran Xendit</a>}
    </>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className={button} disabled={busy} onClick={() => act('read')}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Muat Ulang Status</button>
      {session?.sessionId && !paid && <button type="button" className={button} disabled={busy} onClick={() => act('check')}>Periksa ke Xendit</button>}
      {onOpenTracking && <button type="button" className={button} onClick={() => onOpenTracking(booking.bookingCode)}>Lihat Pesanan</button>}
      {onBackToBooking && paid && <button type="button" className={button} onClick={onBackToBooking}>Kembali</button>}
    </div>
    <p className="text-xs text-slate-500">Status pembayaran diperbarui setelah verifikasi Xendit. Kembali dari halaman checkout belum berarti pembayaran selesai.</p>
  </section>;
}
