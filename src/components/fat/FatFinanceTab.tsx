import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, FileSpreadsheet, Filter, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import * as XLSX from 'xlsx';
import { auth } from '../../lib/firebase';
import { summarizeFatCategories } from '../../server/fatMetrics';

interface FatPayment {
  id: string;
  bookingId: string;
  bookingCode: string;
  amount: number | null;
  amountValid: boolean;
  status: string;
  statusCategory: string;
  paymentMethod: string;
  methodType: string;
  bankCode: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string;
  verifiedAt: string;
  paymentProofUploadedAt: string;
  hasProof: boolean;
  rejectedAt: string;
  expiredAt: string;
  refundedAt: string;
  refundAmount: number | null;
  refundAmountValid: boolean | null;
  currency: string;
}

interface FatPaymentsResponse {
  success: boolean;
  payments?: FatPayment[];
  count?: number;
  limit?: number;
  truncated?: boolean;
  hasMore?: boolean;
  invalidAmountCount?: number;
  note?: string;
  message?: string;
}

const statusLabel = (s: string) => {
  switch (String(s || '').toLowerCase()) {
    case 'paid': return 'Terverifikasi (Paid)';
    case 'pending_payment': return 'Menunggu Pembayaran';
    case 'pending_manual_verification':
    case 'pending': return 'Menunggu Verifikasi';
    case 'payment_rejected':
    case 'failed': return 'Ditolak/Gagal';
    case 'expired': return 'Kedaluwarsa';
    case 'cancelled': return 'Dibatalkan';
    case 'verified':
    case 'settled': return 'Terverifikasi (Paid)';
    case 'pending_verification': return 'Menunggu Verifikasi';
    case 'refunded': return 'Refunded';
    case 'partially_refunded': return 'Refund Sebagian';
    case 'unpaid': return 'Belum Bayar';
    default: return s || '-';
  }
};

const statusClass = (s: string) => {
  const v = String(s || '').toLowerCase();
  if (v === 'paid' || v === 'verified' || v === 'settled') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (v === 'pending_payment' || v === 'pending_manual_verification' || v === 'pending' || v === 'pending_verification') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (v === 'payment_rejected' || v === 'failed') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (v === 'expired') return 'bg-slate-100 text-slate-700 border-slate-300';
  if (v === 'refunded' || v === 'partially_refunded') return 'bg-purple-50 text-purple-700 border-purple-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
};

async function fetchFatPayments(): Promise<FatPaymentsResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
  const token = await user.getIdToken();
  const res = await fetch('/api/fat/payments', { method: 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.message || json?.error || 'Gagal memuat data pembayaran FAT.');
  return json as FatPaymentsResponse;
}

export const FatFinanceTab: React.FC = () => {
  const [payments, setPayments] = useState<FatPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [meta, setMeta] = useState({ limit: 1000, truncated: false, hasMore: false, invalidAmountCount: 0 });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await fetchFatPayments();
      setPayments(Array.isArray(data.payments) ? data.payments : []);
      setMeta({
        limit: typeof data.limit === 'number' ? data.limit : 1000,
        truncated: data.truncated === true,
        hasMore: data.hasMore === true,
        invalidAmountCount: typeof data.invalidAmountCount === 'number' ? data.invalidAmountCount : 0,
      });
    } catch (e: any) {
      setError(e?.message || 'Data pembayaran FAT belum dapat dimuat.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rupiah = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const fmtDate = (s: string) => s ? new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

  const methods = useMemo(() => {
    const set = new Set<string>();
    payments.forEach(p => { const m = (p.methodType || p.paymentMethod || p.bankCode || '').toString().trim(); if (m) set.add(m); });
    return Array.from(set).sort();
  }, [payments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter(p => {
      const st = String(p.status || '').toLowerCase();
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      const m = (p.methodType || p.paymentMethod || p.bankCode || '').toLowerCase();
      if (methodFilter !== 'all' && m !== methodFilter.toLowerCase()) return false;
      if (!q) return true;
      return [p.bookingCode, p.bookingId, p.id, p.paymentMethod, p.methodType, p.bankCode, p.provider]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [payments, search, statusFilter, methodFilter]);

  const summary = useMemo(() => {
    const s = summarizeFatCategories(filtered);
    return {
      count: filtered.length,
      paid: s.paid.count, paidAmt: s.paid.amount,
      pending: s.pending.count, pendingAmt: s.pending.amount,
      rejected: s.rejected.count, rejectedAmt: s.rejected.amount,
    };
  }, [filtered]);

  const exportExcel = () => {
    const rows = filtered.map(p => ({
      'ID Transaksi': p.id,
      'Kode Booking': p.bookingCode || '-',
      'Booking ID': p.bookingId || '-',
      'Nominal (IDR)': p.amountValid && typeof p.amount === 'number' ? p.amount : '',
      'Nominal Valid': p.amountValid ? 'Ya' : 'Tidak',
      'Status': statusLabel(p.status),
      'Metode': p.methodType || p.paymentMethod || p.bankCode || '-',
      'Provider': p.provider || '-',
      'Bukti Terunggah': p.hasProof ? 'Ya' : 'Tidak',
      'Dibuat': fmtDate(p.createdAt),
      'Dibayar': fmtDate(p.paidAt),
      'Diverifikasi': fmtDate(p.verifiedAt),
      'Nominal refund transaksi — sumber belum diverifikasi': p.refundAmount ?? '',
      'Catatan Sumber': 'PaymentRecord.amount (payments), read-only proyeksi backend FAT',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FAT Payments');
    XLSX.writeFile(wb, `fat-payments-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
        <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          <p className="font-semibold">Finance read-only (backend projection)</p>
          <p className="mt-0.5">Data berasal dari endpoint <code className="bg-amber-100 px-1 rounded">/api/fat/payments</code> (proyeksi minimum koleksi <code className="bg-amber-100 px-1 rounded">payments</code>, tanpa akses Firestore langsung). Tidak ada aksi verifikasi, penolakan, koreksi, atau perubahan status/refund. PII diminimalkan (tanpa tampilan data sensitif berlebih).</p>
        </div>
      </div>

      {(meta.truncated || meta.invalidAmountCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs sm:text-sm text-amber-900 space-y-1">
          <p className="font-semibold">Peringatan kelengkapan & integritas data</p>
          {meta.truncated && <p>Data dibatasi maksimum {meta.limit} transaksi (kemungkinan masih ada data lain). KPI/ekspor Finance tidak mewakili seluruh transaksi dan bukan total keseluruhan.</p>}
          {meta.invalidAmountCount > 0 && <p>{meta.invalidAmountCount} transaksi memiliki nominal tidak valid; nominal tersebut tidak dihitung dalam total.</p>}
          <p>Nominal refund resmi bersumber dari <span className="font-mono">cases.recovery.refundAmount</span>. Kolom ekspor bertanda &quot;sumber belum diverifikasi&quot; bukan agregat refund resmi.</p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-3"><div className="text-xs text-slate-500">Transaksi (terfilter)</div><div className="text-lg font-bold text-[#4B2B18]">{summary.count}</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3"><div className="text-xs text-slate-500">Paid</div><div className="text-lg font-bold text-emerald-700">{summary.paid}</div><div className="text-[11px] text-emerald-700">{rupiah(summary.paidAmt)}</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3"><div className="text-xs text-slate-500">Pending</div><div className="text-lg font-bold text-amber-700">{summary.pending}</div><div className="text-[11px] text-amber-700">{rupiah(summary.pendingAmt)}</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3"><div className="text-xs text-slate-500">Ditolak/Gagal</div><div className="text-lg font-bold text-rose-700">{summary.rejected}</div><div className="text-[11px] text-rose-700">{rupiah(summary.rejectedAmt)}</div></div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
          <div className="flex flex-1 flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari kode booking / ID transaksi / metode..." className="w-full pl-9 pr-3 py-2 min-h-[40px] border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/30" />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 min-h-[40px] border border-slate-200 rounded-xl text-sm bg-white">
                <option value="all">Semua status</option>
                <option value="paid">Paid</option>
                <option value="pending_payment">Menunggu pembayaran</option>
                <option value="pending_manual_verification">Pending verifikasi</option>
                <option value="pending">Pending</option>
                <option value="payment_rejected">Ditolak</option>
                <option value="failed">Gagal</option>
                <option value="expired">Kedaluwarsa</option>
                <option value="cancelled">Dibatalkan</option>
                <option value="unpaid">Unpaid</option>
                <option value="refunded">Refunded</option>
                <option value="partially_refunded">Refund sebagian</option>
              </select>
              <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)} className="px-3 py-2 min-h-[40px] border border-slate-200 rounded-xl text-sm bg-white max-w-[180px]">
                <option value="all">Semua metode</option>
                {methods.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-slate-200 bg-white text-sm font-semibold text-[#4B2B18] hover:border-[#8B5A36]/40"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Muat ulang</button>
            <button type="button" onClick={exportExcel} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-[#8B5A36] text-white text-sm font-semibold hover:bg-[#704328] disabled:opacity-50 disabled:cursor-not-allowed"><FileSpreadsheet className="w-4 h-4" /><Download className="w-3.5 h-3.5" />Ekspor</button>
          </div>
        </div>

        {loading && <div className="py-8 flex items-center justify-center gap-2 text-slate-600"><Loader2 className="w-5 h-5 animate-spin" /> Memuat data pembayaran...</div>}
        {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800 flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
        {!loading && !error && filtered.length === 0 && <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">Tidak ada data pembayaran untuk filter saat ini.</div>}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2 pr-3">Kode Booking</th>
                  <th className="py-2 pr-3">Transaksi</th>
                  <th className="py-2 pr-3">Nominal</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Metode</th>
                  <th className="py-2 pr-3">Dibuat</th>
                  <th className="py-2 pr-3">Dibayar/Diverifikasi</th>
                  <th className="py-2">Bukti</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 font-medium text-[#4B2B18] whitespace-nowrap">{p.bookingCode || '-'}</td>
                    <td className="py-2 pr-3 text-slate-600 font-mono text-xs max-w-[140px] truncate" title={p.id}>{p.id}</td>
                    <td className="py-2 pr-3 font-semibold whitespace-nowrap">{p.amountValid && typeof p.amount === 'number' ? rupiah(p.amount) : <span className="text-rose-700 font-semibold">Tidak valid</span>}</td>
                    <td className="py-2 pr-3"><span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-semibold ${statusClass(p.status)}`}>{statusLabel(p.status)}</span></td>
                    <td className="py-2 pr-3 text-slate-700">{p.methodType || p.paymentMethod || p.bankCode || '-'}</td>
                    <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{fmtDate(p.createdAt)}</td>
                    <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{fmtDate(p.paidAt || p.verifiedAt || p.paymentProofUploadedAt)}</td>
                    <td className="py-2 text-slate-700">{p.hasProof ? 'Ada' : 'Tidak ada'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-500">Nominal menggunakan <code>PaymentRecord.amount</code> dari koleksi payments. Booking bukan bukti penerimaan uang; satu booking dapat memiliki &gt;1 transaksi. Ekspor bersifat read-only (tanpa mutasi).</p>
      </div>
    </div>
  );
};
