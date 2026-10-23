import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import type { StaffUser } from '../../types';
import { accurateProcessingAction, PROCESSING_ACK, type ProcessingPreviewView, type ProcessingStatusView } from '../../lib/accurateProcessingService';

const money = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 }).format(n);
const today = () => new Date(Date.now() + 25200000).toISOString().slice(0, 10);
const label: Record<string, string> = { pending: 'Menunggu jurnal', sending: 'Hasil pengiriman perlu dipastikan', retry: 'Menunggu pemeriksaan ulang', review: 'Perlu pemeriksaan Finance', confirmed: 'Terverifikasi di Accurate' };
export function AccurateProcessingFeeCard({ currentUser }: { currentUser: StaffUser }) {
  const allowed = ['manager', 'admin'].includes(currentUser.role);
  const [status, setStatus] = useState<ProcessingStatusView | null>(null), [preview, setPreview] = useState<ProcessingPreviewView | null>(null);
  const [from, setFrom] = useState(''), [to, setTo] = useState(today), [sample, setSample] = useState(''), [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), flight = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const off = onAuthStateChanged(auth, user => {
      const version = ++generation.current; controller.current?.abort(); controller.current = null; flight.current = false;
      setBusy(false); setStatus(null); setPreview(null); setFrom(''); setTo(today()); setSample(''); setAck(false); setError('');
      if (!user || !allowed) return;
      const c = new AbortController(); controller.current = c; flight.current = true; setBusy(true);
      accurateProcessingAction('processingStatus', {}, c.signal).then(v => { if (version === generation.current) { setStatus(v.processing); setFrom(v.processing.fromDate || ''); } })
        .catch(() => { if (version === generation.current) setError('Status processing fee belum dapat dimuat.'); })
        .finally(() => { if (version === generation.current) { flight.current = false; setBusy(false); } });
    });
    return () => { generation.current++; controller.current?.abort(); off(); };
  }, [currentUser.uid, currentUser.role, allowed]);
  if (!allowed) return null;
  const sampleIds = [...new Set(sample.trim().split(/[\s,]+/).filter(Boolean))];
  const ready = !!preview?.charges.length && preview.fromDate === from && sampleIds.length > 0 &&
    sampleIds.every(id => preview.charges.some(c => c.transactionId === id));
  const act = async (action: Parameters<typeof accurateProcessingAction>[0], id?: string) => {
    if (flight.current) return;
    const version = generation.current, c = new AbortController(); controller.current = c; flight.current = true; setBusy(true); setError('');
    try {
      const body = action === 'processingPreview' ? { fromDate: from, toDate: to } : action === 'activateProcessing' ?
        { fromDate: from, expectedTransactionIds: sampleIds, acknowledgement: PROCESSING_ACK } : action === 'reconcileProcessing' ? { id } : {};
      const v = await accurateProcessingAction(action, body, c.signal);
      if (version === generation.current) { if (action === 'processingPreview') setPreview(v.preview); else setStatus(v.processing); setAck(false); }
    } catch (e: any) { if (version === generation.current) setError(e?.message || 'Pemeriksaan belum berhasil.'); }
    finally { if (version === generation.current) { flight.current = false; setBusy(false); } }
  };
  return <section aria-label="Processing fee harian Xendit" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
    <h3 className="font-bold text-slate-900">Processing fee harian Xendit</h3>
    <p>Potongan processing fee dan PPN-nya dicatat terpisah dari biaya booking. Nominal mengikuti debit saldo final di Xendit; tidak dihitung dari tarif atau jumlah booking lunas.</p>
    <p>Jurnal: debit Beban Administrasi Xendit (600031), kredit Saldo Xendit (110103). Setiap ID potongan mendapat satu nomor SHPF tetap.</p>
    <p>Status: <strong>{status?.enabled ? 'Aktif' : status ? 'Belum aktif / dijeda' : 'Belum dimuat'}</strong>{status?.fromDate ? ` · sejak tanggal potongan ${status.fromDate} WIB` : ''}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => act('processingStatus')}>Muat Ulang Processing Fee</button>
      <button type="button" disabled={busy || !status?.enabled} onClick={() => act('runProcessing')}>Proses Processing Fee Sekarang</button>
      <button type="button" disabled={busy || !status?.enabled} onClick={() => act('pauseProcessing')}>Jeda Processing Fee</button>
    </div>
    {status?.lastScanAt && <p>Pemindaian terakhir: {new Date(status.lastScanAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB · rentang {status.lastScanFromDate} sampai {status.lastScanToDate}.</p>}
    {status?.issue && <p role="alert">Pemeriksaan tertahan: {status.issue}. Periksa bukti; jangan membuat jurnal pengganti untuk hasil pengiriman yang belum pasti.</p>}
    <fieldset disabled={busy} className="space-y-3">
      <legend>Periksa potongan aktual (tanpa mencatat)</legend>
      <label className="block">Tanggal awal WIB <input aria-label="Tanggal awal processing fee" type="date" value={from} max={today()} onChange={e => { setFrom(e.target.value); setPreview(null); setAck(false); }} /></label>
      <label className="block">Tanggal akhir WIB <input aria-label="Tanggal akhir processing fee" type="date" value={to} max={today()} onChange={e => { setTo(e.target.value); setPreview(null); setAck(false); }} /></label>
      <button type="button" disabled={!from || !to || from > to} onClick={() => { setPreview(null); act('processingPreview'); }}>Pratinjau Potongan Harian</button>
    </fieldset>
    {preview && <div className="overflow-auto">
      <p>Rentang {preview.fromDate} sampai {preview.toDate}: processing fee {money(preview.feeAmount)} + PPN {money(preview.vatAmount)} = <strong>{money(preview.totalAmount)}</strong>. Tidak membuat jurnal.</p>
      {!preview.charges.length && <p>Belum ditemukan potongan final pada rentang ini. Ini tidak berarti tidak ada biaya yang akan ditagih kemudian.</p>}
      <table className="w-full text-sm"><caption>Potongan aktual dari Xendit</caption><thead><tr><th>Tanggal WIB</th><th>Jenis</th><th>Nominal</th><th>ID transaksi</th></tr></thead><tbody>
        {preview.charges.map(c => <tr key={c.transactionId}><td>{c.date}</td><td>{c.type === 'PROCESSING_FEE_VAT_DEDUCTION' ? 'PPN processing fee' : 'Processing fee'}</td><td>{money(c.amount)}</td><td>{c.transactionId}</td></tr>)}
      </tbody></table>
      {!!preview.otherOutflowCount && <p>{preview.otherOutflowCount} debit jenis lain tidak dicatat otomatis oleh modul processing fee. Perlu rekonsiliasi tersendiri.</p>}
    </div>}
    {!status?.enabled && <fieldset disabled={busy} className="space-y-3">
      <legend>Aktivasi pencatatan potongan</legend>
      <label className="block">ID transaksi potongan contoh dari dashboard Xendit <textarea aria-label="ID contoh potongan Xendit" value={sample} onChange={e => { setSample(e.target.value); setAck(false); }} className="block w-full border rounded p-2" /></label>
      <p>ID contoh harus muncul pada pratinjau. Tanggal awal aktivasi tetap dipertahankan saat dijeda dan dilanjutkan.</p>
      <label className="block"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> Finance menyetujui processing fee dan PPN-nya sebagai beban, serta memastikan potongan sejak tanggal awal belum dijurnal manual dengan nomor lain.</label>
      <button type="button" disabled={!status || !ack || !ready} onClick={() => act('activateProcessing')}>Aktifkan Processing Fee Otomatis</button>
    </fieldset>}
    {!!status?.jobs.length && <div className="overflow-auto"><table className="w-full text-sm"><caption>30 catatan potongan terbaru</caption><thead><tr><th>Tanggal</th><th>Nominal</th><th>Jurnal</th><th>Status</th></tr></thead><tbody>
      {status.jobs.map(r => <tr key={r.id}><td>{r.date}</td><td>{money(r.amount)}</td><td>{r.number}<br />{r.transactionId}</td><td>{label[r.state]}{r.issue && <p>{r.issue}</p>}
        {['review', 'sending', 'retry'].includes(r.state) && <button type="button" disabled={busy} onClick={() => act('reconcileProcessing', r.id)}>Cocokkan Jurnal Tersimpan</button>}</td></tr>)}
    </tbody></table></div>}
    <p>Pemindaian berjalan melalui jadwal Accurate yang sudah ada: riwayat awal dipindai bertahap, lalu 31 hari terakhir diperiksa ulang. Potongan yang muncul atau berubah di luar rentang itu perlu pemeriksaan ulang per tanggal. Status terverifikasi berarti jurnal telah dibaca kembali dari Accurate.</p>
    <p>Biaya pembayaran hari ini dapat dipotong pada hari berikutnya. Modul ini tidak membuktikan saldo total Xendit sudah sama dengan Accurate, tidak mencatat saldo awal lama, refund, atau pencairan bank.</p>
    {busy && <p role="status">Memeriksa processing fee…</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
