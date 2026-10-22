import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import type { StaffUser } from '../../types';
import { ACCURATE_NET_PREVIEW_ERRORS, XENDIT_STATE_EXPECTED, xenditObservedStateLabel,
  type AccurateSyncStatus, type AccurateSyncPreview, type AccurateXenditNetPreview, type AccurateXenditStateDiagnostic } from '../../lib/accurateSyncContracts';
import { accurateSyncAction, accurateSyncPreview, accurateXenditNetPreview } from '../../lib/accurateSyncService';

const money = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const feeMoney = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const stateLabel = { queued: 'Menunggu', processing: 'Diproses', waiting_service: 'Menunggu treatment', retry: 'Akan diperiksa ulang', review: 'Perlu pemeriksaan', complete: 'Selesai' };
export function AccurateSyncCard({ currentUser }: { currentUser: StaffUser }) {
  const allowed = ['manager', 'admin'].includes(currentUser.role);
  const [status, setStatus] = useState<AccurateSyncStatus | null>(null), [preview, setPreview] = useState<AccurateSyncPreview | null>(null);
  const [netPreview, setNetPreview] = useState<AccurateXenditNetPreview | null>(null);
  const [stateDiagnostic, setStateDiagnostic] = useState<AccurateXenditStateDiagnostic | null>(null);
  const [booking, setBooking] = useState(''), [ack, setAck] = useState(false), [tax, setTax] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), flight = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const off = onAuthStateChanged(auth, user => {
      const version = ++generation.current; controller.current?.abort(); controller.current = null;
      flight.current = false; setBusy(false); setStatus(null); setPreview(null); setNetPreview(null); setStateDiagnostic(null); setBooking(''); setAck(false); setTax(false); setError('');
      if (!user || !allowed) return;
      const c = new AbortController(); controller.current = c; flight.current = true; setBusy(true);
      accurateSyncAction('status', undefined, c.signal).then(v => { if (generation.current === version) setStatus(v); })
        .catch(() => { if (generation.current === version) setError('Status pencatatan belum dapat dimuat. Coba muat ulang.'); })
        .finally(() => { if (generation.current === version) { flight.current = false; setBusy(false); } });
    });
    return () => { generation.current++; controller.current?.abort(); off(); };
  }, [currentUser.uid, currentUser.role, allowed]);
  if (!allowed) return null;
  const normalized = booking.trim().startsWith('SH-') ? `bk_${booking.trim()}` : booking.trim();
  const act = async (action: 'status' | 'preview' | 'netPreview' | 'activate' | 'pause' | 'run' | 'retry') => {
    if (flight.current) return;
    const version = generation.current, c = new AbortController(); controller.current = c;
    flight.current = true; setBusy(true); setError('');
    if (action === 'status') setStatus(null);
    try {
      if (action === 'netPreview') {
        setNetPreview(null); setStateDiagnostic(null); setAck(false); setTax(false);
        const v = await accurateXenditNetPreview(normalized, c.signal);
        if (generation.current === version) { if (v.mode === 'xendit_state_diagnostic_v1') setStateDiagnostic(v); else setNetPreview(v); }
      } else if (action === 'preview') {
        setPreview(null); setAck(false); setTax(false);
        const v = await accurateSyncPreview(normalized, c.signal); if (generation.current === version) setPreview(v);
      } else {
        const v = await accurateSyncAction(action, action === 'retry' ? normalized : undefined, c.signal);
        if (generation.current === version) { setStatus(v); if (action === 'activate') { setAck(false); setTax(false); } }
      }
    } catch (e: any) {
      if (generation.current === version) {
        // A known Xendit read failure does not invalidate the already loaded
        // accounting status. Auth/account changes still clear state separately.
        if (action !== 'netPreview' || !Object.values(ACCURATE_NET_PREVIEW_ERRORS).includes(e?.message)) setStatus(null);
        setAck(false); setTax(false);
        setError(e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'Permintaan belum selesai. Muat ulang status sebelum mencoba kembali.' : e.message);
      }
    } finally { if (generation.current === version) { flight.current = false; setBusy(false); } }
  };
  const button = 'min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-[#082A4F] disabled:opacity-50';
  return <section aria-label="Accurate Online — Pencatatan Transaksi" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h3 className="text-lg font-bold text-[#082A4F]">Accurate Online — Pencatatan Transaksi</h3>
    <p className="text-sm text-slate-600">Pembayaran Xendit Live masuk ke Uang Muka Penjualan dan Saldo Xendit. Saat treatment selesai, uang muka dipakai melunasi faktur layanan.</p>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Aktivasi membuat dokumen akuntansi pada PT KSBONE UNTUK KITA, database 2974047. Booking lama, pembayaran manual, dan simulasi Test tidak dimasukkan otomatis. Biaya Xendit, pencairan bank, pembatalan, dan refund memerlukan pemeriksaan terpisah.</p>
    {status && <div className="space-y-1 text-sm text-slate-700">
      <p>Pengiriman: <strong>{status.enabled && status.writesConfigured ? 'Aktif' : status.activatedAt ? 'Dijeda' : 'Belum aktif'}</strong>.</p>
      <p>{status.writesConfigured ? 'Konfigurasi server mengizinkan pengiriman setelah aktivasi Manager.' : 'Pengiriman dari server belum diizinkan.'}</p>
      {status.activatedAt && <p>Booking yang dibuat sejak {new Date(status.activatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB dapat masuk antrean. Saat pengiriman dijeda, antrean baru tetap disimpan.</p>}
      <p>{status.schedulerConfigured ? 'Token pemicu berkala tersedia; pelaksanaan jadwal otomatis perlu diverifikasi.' : 'Pemicu berkala belum dikonfigurasi. Pengiriman dan pemeriksaan ulang tanpa aktivitas aplikasi belum terjamin.'}</p>
    </div>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className={button} disabled={busy} onClick={() => act('status')}>Muat Ulang Status Pencatatan</button>
      <button type="button" className={button} disabled={busy || !status?.enabled || !status.writesConfigured} onClick={() => act('run')}>Proses Antrean Sekarang</button>
      <button type="button" className={button} disabled={busy || !status?.enabled} onClick={() => act('pause')}>Jeda Pengiriman Accurate</button>
    </div>
    <div className="space-y-3 rounded-xl border p-4 text-sm text-slate-700">
      <h4 className="font-semibold">Pratinjau booking dan periksa pemetaan</h4>
      <p>Pratinjau hanya membaca data. Gunakan kode booking yang sudah dibayar melalui Xendit Live untuk memeriksa akun, layanan, dan rincian nominal.</p>
      <label className="block">Kode atau ID booking<input aria-label="Booking untuk pratinjau Accurate" value={booking} disabled={busy} onChange={e => { setBooking(e.target.value); setPreview(null); setNetPreview(null); setStateDiagnostic(null); setAck(false); setTax(false); setError(''); }} placeholder="SH-261022-NUOUN atau bk_SH-…" className="mt-1 block min-h-[44px] w-full rounded-lg border p-2" /></label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} disabled={busy || !normalized} onClick={() => act('preview')}>Pratinjau Tanpa Mencatat</button>
        <button type="button" className={button} disabled={busy || !normalized} onClick={() => act('netPreview')}>Pratinjau Biaya &amp; Neto Xendit</button>
        <button type="button" className={button} disabled={busy || !normalized || !status?.enabled || !status.writesConfigured} onClick={() => act('retry')}>Periksa Ulang Booking dalam Antrean</button>
      </div>
      {preview && <div role="status" className="space-y-1 rounded-lg bg-blue-50 p-3 text-blue-950">
        <p><strong>{preview.bookingCode}</strong> · {preview.itemCode || 'Belum dipetakan'}</p>
        <p>Layanan {money(preview.servicePrice)} + kunjungan {money(preview.visitFee)} − diskon {money(preview.discount)} = <strong>{money(preview.amount)}</strong>.</p>
        <p>{preview.note}</p><p>Pratinjau ini tidak membuat dokumen atau memasukkan booking ke antrean.</p>
      </div>}
      {stateDiagnostic && <div role="alert" aria-label="Pemeriksaan status API Xendit" className="space-y-3 rounded-lg bg-amber-50 p-3 text-amber-950">
        <h4 className="font-semibold">Status API Xendit perlu diperiksa</h4>
        <p><strong>{stateDiagnostic.bookingCode}</strong> · Neto belum terverifikasi.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left">Perbandingan status yang dibaca dari API</caption>
          <thead><tr><th scope="col" className="p-1">Kolom</th><th scope="col" className="p-1">Dari API</th><th scope="col" className="p-1">Disyaratkan</th></tr></thead>
          <tbody>{(['type', 'status', 'cashflow'] as const).map(field => <tr key={field} className="border-t border-amber-200">
            <th scope="row" className="p-1">{field}</th><td className="p-1">{xenditObservedStateLabel(stateDiagnostic.checks[field])}</td><td className="p-1">{XENDIT_STATE_EXPECTED[field]}</td>
          </tr>)}</tbody>
        </table></div>
        <p>Diperiksa {new Date(stateDiagnostic.checkedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB. Nilai tidak dikenali disembunyikan.</p>
        <p>Ini hasil pemeriksaan status, bukan konfirmasi neto. Tidak ada pencatatan biaya atau perubahan pembayaran.</p>
      </div>}
      {netPreview && <div role="status" aria-label="Hasil biaya dan neto Xendit" className="space-y-3 rounded-lg bg-blue-50 p-3 text-blue-950">
        <p><strong>{netPreview.bookingCode}</strong> · {netPreview.channelCategory} / {netPreview.channelCode}</p>
        <table className="w-full text-sm"><caption className="mb-2 text-left font-semibold">Neto pembayaran di Xendit</caption>
          <tbody>
            <tr><th scope="row" className="py-1 text-left font-normal">Pembayaran bruto</th><td className="text-right">{feeMoney(netPreview.grossAmount)}</td></tr>
            <tr><th scope="row" className="py-1 text-left font-normal">Biaya transaksi</th><td className="text-right">−{feeMoney(netPreview.xenditFee)}</td></tr>
            <tr><th scope="row" className="py-1 text-left font-normal">PPN atas biaya transaksi</th><td className="text-right">−{feeMoney(netPreview.valueAddedTax)}</td></tr>
            <tr className="border-t border-blue-200"><th scope="row" className="py-2 text-left">Neto pembayaran</th><td className="text-right font-bold">{feeMoney(netPreview.netAmount)}</td></tr>
          </tbody>
        </table>
        <p>Biaya final dan settlement pembayaran terverifikasi di Xendit. Diperiksa {new Date(netPreview.checkedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</p>
        <p>Processing fee harian dan PPN-nya belum termasuk. Potongan tersebut perlu dicocokkan terpisah dengan laporan Xendit, tanpa dibagi otomatis ke booking.</p>
        <p><strong>Ini belum membuktikan dana masuk rekening bank.</strong> Cocokkan laporan pencairan Xendit dengan mutasi rekening.</p>
        <p>Pratinjau hanya membaca Xendit. Tidak mencatat biaya ke Accurate atau mengubah pembayaran. Perlakuan pajak biaya menunggu pemeriksaan Finance.</p>
        <details><summary className="cursor-pointer">Referensi pemeriksaan</summary><div className="mt-2 space-y-1 break-all text-xs">
          <p>Referensi: {netPreview.referenceId}</p><p>Payment: {netPreview.paymentId}</p><p>Transaksi: {netPreview.transactionId}</p>
          <p>Pembaruan data Xendit: {new Date(netPreview.transactionUpdatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</p>
        </div></details>
      </div>}
    </div>
    {!status?.enabled && <div className="space-y-3 rounded-xl border p-4 text-sm text-slate-700">
      <h4 className="font-semibold">Aktivasi pencatatan booking baru</h4>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={ack} onChange={e => setAck(e.target.checked)} />Saya memahami bahwa aktivasi membuat uang muka, penerimaan, dan faktur untuk booking baru melalui Xendit Live.</label>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={tax} onChange={e => setTax(e.target.checked)} />Finance sudah memastikan transaksi ini dicatat tanpa tambahan pajak. Jika penjualan memerlukan pajak, aktivasi menunggu penyesuaian.</label>
      <button type="button" className="min-h-[44px] rounded-lg bg-[#082A4F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !status?.writesConfigured || !preview?.itemCode || !ack || !tax} onClick={() => act('activate')}>{status?.activatedAt ? 'Lanjutkan Pengiriman Accurate' : 'Aktifkan Pencatatan Booking Baru'}</button>
      <p>Jeda menghentikan pengiriman berikutnya. Dokumen yang sudah terkirim tetap tersimpan di Accurate.</p>
    </div>}
    {busy && <p role="status" className="text-sm text-slate-600">Memeriksa data…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {status && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left font-semibold">20 catatan antrean terbaru</caption>
      <thead><tr className="border-b"><th scope="col" className="p-2">Booking</th><th scope="col" className="p-2">Nominal</th><th scope="col" className="p-2">Status</th><th scope="col" className="p-2">Dokumen</th></tr></thead>
      <tbody>{status.jobs.map(j => <tr key={j.id} className="border-b align-top"><td className="whitespace-nowrap p-2">{j.bookingCode}</td><td className="whitespace-nowrap p-2">{money(j.amount)}</td><td className="min-w-[200px] p-2"><strong>{stateLabel[j.state]}</strong><p>{j.note}</p></td><td className="space-y-1 p-2">
        <p>Uang muka: {j.downPaymentNumber} ({j.confirmed.includes('down_payment') ? 'terverifikasi' : 'belum terverifikasi'})</p>
        <p>Penerimaan: {j.receiptNumber} ({j.confirmed.includes('receipt') ? 'terverifikasi' : 'belum terverifikasi'})</p>
        <p>Faktur: {j.invoiceNumber} ({j.confirmed.includes('invoice') ? 'terverifikasi' : 'belum terverifikasi'})</p>
      </td></tr>)}</tbody>
    </table>{status.jobs.length === 0 && <p className="mt-3 text-sm text-slate-600">Belum ada booking dalam antrean pencatatan.</p>}</div>}
  </section>;
}
