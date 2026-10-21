import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import type { Booking } from '../../types';
import { XenditLivePaymentPage } from './XenditLivePaymentPage';

/** A redirect opens a read-only status view; it never settles or creates payment. */
export function XenditLiveReturn() {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('xendit') === 'returned');
  const [booking, setBooking] = useState<Booking | null>(null), [message, setMessage] = useState('Memuat status pesanan...');
  useEffect(() => {
    if (!open) return;
    let gen = 0;
    const off = onAuthStateChanged(auth, async user => {
      const current = ++gen; setBooking(null);
      if (!user) { setMessage('Masuk ke akun pemesan, lalu buka pesanan Anda untuk melihat hasil pembayaran.'); return; }
      let id = '';
      try { id = sessionStorage.getItem(`senzu:xendit-live-return:${user.uid}`) || ''; } catch {}
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) { setMessage('Buka Pesanan Saya untuk melihat status pembayaran Anda.'); return; }
      try {
        const snap = await getDoc(doc(db, 'bookings', id)), data = snap.data();
        if (current !== gen) return;
        if (!snap.exists() || data?.customerAuthUid !== user.uid || data?.authUserId !== user.uid || data?.gatewayEnvironment !== 'live') throw new Error();
        setBooking({ ...data, id: snap.id } as Booking);
      } catch { if (current === gen) setMessage('Status belum dapat dimuat. Buka Pesanan Saya dan periksa pesanan yang sama.'); }
    });
    return () => { gen++; off(); };
  }, [open]);
  const close = () => {
    const url = new URL(window.location.href); url.searchParams.delete('xendit');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`); setOpen(false);
  };
  if (!open) return null;
  return <div role="dialog" aria-modal="true" aria-label="Hasil pembayaran" className="fixed inset-0 z-[90] overflow-y-auto bg-slate-900/70 p-4">
    <div className="mx-auto my-8 max-w-2xl space-y-3 rounded-3xl bg-white p-4">
      <div className="flex justify-end"><button type="button" onClick={close} className="min-h-[44px] px-4 font-semibold text-[#082A4F]">Tutup</button></div>
      {booking ? <XenditLivePaymentPage booking={booking} /> : <p role="status" className="p-6 text-slate-700">{message}</p>}
    </div>
  </div>;
}
