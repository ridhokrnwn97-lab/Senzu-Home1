import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, Eye, FileSpreadsheet, Filter, Loader2, RefreshCw, Search, ShieldCheck, X, ZoomIn, ZoomOut } from 'lucide-react';
import * as XLSX from 'xlsx';
import { auth } from '../../lib/firebase';
import { summarizeFatCategories } from '../../server/fatMetrics';
import { FINANCE_COLUMNS, FINANCE_TABLE_MIN_WIDTH, financeColumnVars } from './financeColumns';

interface FatPayment {
  id: string;
  bookingId: string;
  bookingCode: string;
  customerName: string;
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

interface FatPaymentProof {
  url: string;
  mimeType: string;
}

interface ProofView extends FatPaymentProof {
  paymentId: string;
  label: string;
  requestId: number;
  status: 'loading' | 'ready' | 'error';
  imageLoaded: boolean;
  error: string;
}

interface FatPaymentProofResponse {
  success: boolean;
  proofUrl?: string;
  mimeType?: string;
  message?: string;
  error?: string;
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
  const [proof, setProof] = useState<ProofView | null>(null);
  const [proofCache, setProofCache] = useState<Record<string, FatPaymentProof>>({});
  const [zoom, setZoom] = useState(1);
  const proofTriggerRef = useRef<HTMLButtonElement | null>(null);
  const proofCloseRef = useRef<HTMLButtonElement | null>(null);
  const proofDialogRef = useRef<HTMLDivElement | null>(null);
  const proofAbortRef = useRef<AbortController | null>(null);
  const proofRequestRef = useRef(0);

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

  const closeProof = useCallback(() => {
    proofAbortRef.current?.abort();
    proofAbortRef.current = null;
    proofRequestRef.current += 1;
    setProof(null);
    const trigger = proofTriggerRef.current;
    proofTriggerRef.current = null;
    trigger?.focus();
  }, []);

  const openProof = (p: FatPayment, e: React.MouseEvent<HTMLButtonElement>) => {
    if (proof) return;
    proofTriggerRef.current = e.currentTarget;
    const cached = proofCache[p.id];
    const requestId = ++proofRequestRef.current;
    setProof({
      paymentId: p.id,
      label: p.bookingCode || p.id,
      requestId,
      status: cached ? 'ready' : 'loading',
      url: cached?.url || '',
      mimeType: cached?.mimeType || '',
      imageLoaded: false,
      error: '',
    });
    setZoom(1);
  };

  const retryProof = () => {
    if (!proof) return;
    setProofCache(prev => {
      const next = { ...prev };
      delete next[proof.paymentId];
      return next;
    });
    const requestId = ++proofRequestRef.current;
    setProof(cur => cur && cur.paymentId === proof.paymentId
      ? { ...cur, requestId, status: 'loading', url: '', mimeType: '', imageLoaded: false, error: '' }
      : cur);
    setZoom(1);
  };

  const handleProofMediaError = (message: string) => {
    if (!proof) return;
    const current = proof;
    setProofCache(prev => {
      const next = { ...prev };
      delete next[current.paymentId];
      return next;
    });
    setProof(cur => cur && cur.requestId === current.requestId
      ? { ...cur, status: 'error', error: message, imageLoaded: false }
      : cur);
  };

  useEffect(() => {
    if (!proof || proof.status !== 'loading') return;
    const controller = new AbortController();
    proofAbortRef.current = controller;
    const { requestId, paymentId } = proof;
    const loadProof = async () => {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
        const token = await user.getIdToken();
        if (controller.signal.aborted || proofRequestRef.current !== requestId) return;
        const res = await fetch(`/api/fat/payments/${encodeURIComponent(paymentId)}/proof`, {
          method: 'GET', cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const json: FatPaymentProofResponse = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) throw new Error(json.message || json.error || 'Bukti pembayaran tidak dapat dimuat.');
        const url = String(json.proofUrl || '');
        const mimeType = String(json.mimeType || '');
        if (!url) throw new Error('Bukti pembayaran tidak tersedia.');
        if (controller.signal.aborted || proofRequestRef.current !== requestId) return;
        setProofCache(prev => ({ ...prev, [paymentId]: { url, mimeType } }));
        setProof(cur => cur && cur.requestId === requestId && cur.status === 'loading'
          ? { ...cur, status: 'ready', url, mimeType, imageLoaded: false, error: '' }
          : cur);
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === 'AbortError' || proofRequestRef.current !== requestId) return;
        const message = e?.message || 'Bukti pembayaran tidak dapat dimuat.';
        setProof(cur => cur && cur.requestId === requestId && cur.status === 'loading'
          ? { ...cur, status: 'error', error: message, imageLoaded: false }
          : cur);
      } finally {
        if (proofAbortRef.current === controller) proofAbortRef.current = null;
      }
    };
    void loadProof();
    return () => controller.abort();
  }, [proof?.paymentId, proof?.requestId, proof?.status]);

  const proofOpen = proof !== null;
  const proofIsPdf = !!proof && (/^application\/pdf\b/i.test(proof.mimeType) || /^data:application\/pdf\b/i.test(proof.url));
  const proofIsImage = !!proof && (/^image\//i.test(proof.mimeType) || /^data:image\//i.test(proof.url));
  useEffect(() => {
    if (proofOpen) proofCloseRef.current?.focus();
  }, [proofOpen]);

  useEffect(() => {
    if (!proofOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeProof(); return; }
      if (e.key !== 'Tab' || !proofDialogRef.current) return;
      const focusables = Array.from(proofDialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [proofOpen, closeProof]);

  useEffect(() => {
    if (!proofOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
    };
  }, [proofOpen]);

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
      return [p.bookingCode, p.customerName, p.bookingId, p.id, p.paymentMethod, p.methodType, p.bankCode, p.provider]
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
      'Nama Pemesan': p.customerName || '-',
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
        <div className="flex flex-wrap flex-col md:flex-row gap-2 md:items-center md:justify-between">
          <div className="flex flex-wrap flex-1 flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari kode booking / nama pemesan / ID transaksi / metode..." className="w-full pl-9 pr-3 py-2 min-h-[40px] border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/30" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-slate-200 bg-white text-sm font-semibold text-[#4B2B18] hover:border-[#8B5A36]/40"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Muat ulang</button>
            <button type="button" onClick={exportExcel} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-[#8B5A36] text-white text-sm font-semibold hover:bg-[#704328] disabled:opacity-50 disabled:cursor-not-allowed"><FileSpreadsheet className="w-4 h-4" /><Download className="w-3.5 h-3.5" />Ekspor</button>
          </div>
        </div>

        {loading && <div className="py-8 flex items-center justify-center gap-2 text-slate-600"><Loader2 className="w-5 h-5 animate-spin" /> Memuat data pembayaran...</div>}
        {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800 flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
        {!loading && !error && filtered.length === 0 && <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">Tidak ada data pembayaran untuk filter saat ini.</div>}

        {!loading && !error && filtered.length > 0 && (
          <>
            <p className="mb-2 text-xs text-slate-500 lg:hidden">Geser tabel ke kanan untuk melihat kolom lainnya.</p>
            <div className="fat-finance-table-scroll w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x">
              <table className="w-full table-fixed text-sm" style={{ ...financeColumnVars(), minWidth: FINANCE_TABLE_MIN_WIDTH }}>
                <colgroup>
                  {FINANCE_COLUMNS.map((col, i) => <col key={col.key} style={{ width: `var(--finance-col-${i})` }} />)}
                </colgroup>
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="sticky left-0 z-30 truncate border-r border-stone-200 bg-stone-50 py-2 pl-2 pr-3" title={FINANCE_COLUMNS[0].label}>{FINANCE_COLUMNS[0].label}</th>
                    <th className="truncate border-r border-stone-200 bg-stone-50 py-2 pr-3 shadow-[2px_0_4px_-2px_rgba(68,41,20,0.25)] sm:sticky sm:left-[var(--finance-col-0)] sm:z-30" title={FINANCE_COLUMNS[1].label}>{FINANCE_COLUMNS[1].label}</th>
                    {FINANCE_COLUMNS.slice(2).map((col) => <th key={col.key} className="truncate py-2 pr-3" title={col.label}>{col.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} className="group border-b last:border-0 align-top hover:bg-stone-50/60">
                      <td className="sticky left-0 z-20 truncate border-r border-stone-200 bg-white py-2 pl-2 pr-3 font-medium text-[#4B2B18] group-hover:bg-stone-50" title={p.bookingCode || '-'}>{p.bookingCode || '-'}</td>
                      <td className="truncate border-r border-stone-200 bg-white py-2 pr-3 text-slate-700 shadow-[2px_0_4px_-2px_rgba(68,41,20,0.25)] group-hover:bg-stone-50 sm:sticky sm:left-[var(--finance-col-0)] sm:z-10" title={p.customerName || '-'}>{p.customerName || '-'}</td>
                      <td className="truncate py-2 pr-3 font-mono text-xs text-slate-600" title={p.id}>{p.id}</td>
                      <td className="truncate py-2 pr-3 font-semibold" title={p.amountValid && typeof p.amount === 'number' ? rupiah(p.amount) : 'Tidak valid'}>{p.amountValid && typeof p.amount === 'number' ? rupiah(p.amount) : <span className="text-rose-700 font-semibold">Tidak valid</span>}</td>
                      <td className="truncate py-2 pr-3" title={statusLabel(p.status)}><span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-semibold ${statusClass(p.status)}`}>{statusLabel(p.status)}</span></td>
                      <td className="truncate py-2 pr-3 text-slate-700" title={p.methodType || p.paymentMethod || p.bankCode || '-'}>{p.methodType || p.paymentMethod || p.bankCode || '-'}</td>
                      <td className="truncate py-2 pr-3 text-slate-600" title={fmtDate(p.createdAt)}>{fmtDate(p.createdAt)}</td>
                      <td className="truncate py-2 pr-3 text-slate-600" title={fmtDate(p.paidAt || p.verifiedAt || p.paymentProofUploadedAt)}>{fmtDate(p.paidAt || p.verifiedAt || p.paymentProofUploadedAt)}</td>
                      <td className="truncate py-2 pr-3 text-slate-700" title={p.hasProof ? 'Lihat bukti pembayaran' : '-'}>
                        {p.hasProof ? (
                          <button type="button" onClick={e => openProof(p, e)} aria-label={`Lihat bukti pembayaran ${p.bookingCode || p.id}`} title="Lihat bukti pembayaran" className="inline-flex items-center gap-1 rounded-lg border border-[#8B5A36]/40 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-[#704328] hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/40">
                            <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />Lihat
                          </button>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-[11px] text-slate-500">Nominal menggunakan <code>PaymentRecord.amount</code> dari koleksi payments. Booking bukan bukti penerimaan uang; satu booking dapat memiliki &gt;1 transaksi. Ekspor bersifat read-only (tanpa mutasi).</p>
      </div>

      {proof && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fat-proof-title"
          aria-describedby="fat-proof-desc"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-3 sm:p-6"
          onClick={e => { if (e.target === e.currentTarget) closeProof(); }}
        >
          <div ref={proofDialogRef} className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h2 id="fat-proof-title" className="text-sm font-bold text-[#4B2B18] sm:text-base">Bukti pembayaran</h2>
                <p id="fat-proof-desc" className="truncate text-xs text-slate-500">{proof.label}</p>
              </div>
              <button ref={proofCloseRef} type="button" onClick={closeProof} aria-label="Tutup bukti pembayaran" title="Tutup" className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/40"><X className="w-5 h-5" aria-hidden="true" /></button>
            </div>
            <div className="flex min-h-[220px] flex-1 overflow-auto bg-slate-50 p-4">
              {proof.status === 'loading' && <div role="status" className="m-auto flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />Mengambil bukti...</div>}
              {proof.status === 'error' && (
                <div role="alert" className="m-auto max-w-sm space-y-3 text-center text-sm text-rose-800">
                  <p className="flex items-center justify-center gap-2 font-semibold"><AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />Bukti tidak dapat dimuat.</p>
                  <p className="text-xs text-slate-600">{proof.error}</p>
                  <div className="flex justify-center gap-2">
                    <button type="button" onClick={retryProof} className="inline-flex min-h-[40px] items-center rounded-xl bg-[#8B5A36] px-3 text-sm font-semibold text-white hover:bg-[#704328] focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/40">Coba lagi</button>
                    <button type="button" onClick={closeProof} className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/40">Tutup</button>
                  </div>
                </div>
              )}
              {proof.status === 'ready' && proofIsPdf && (
                <object data={proof.url} type="application/pdf" title="Pratinjau bukti PDF" className="m-auto h-[65vh] w-full rounded-xl border border-slate-200 bg-white">
                  <div className="m-auto max-w-sm space-y-2 p-4 text-center text-xs text-slate-600">Pratinjau PDF tidak tersedia di browser ini. <a href={proof.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#704328] underline">Buka PDF</a></div>
                </object>
              )}
              {proof.status === 'ready' && !proofIsPdf && !proofIsImage && (
                <div role="alert" className="m-auto max-w-sm space-y-2 text-center text-sm text-slate-700">
                  <p className="font-semibold">Format bukti tidak didukung.</p>
                  <p className="text-xs text-slate-600">Jenis berkas: {proof.mimeType || 'tidak diketahui'}. Bukti tidak ditampilkan sebagai gambar.</p>
                  <button type="button" onClick={retryProof} className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/40">Coba lagi</button>
                </div>
              )}
              {proof.status === 'ready' && proofIsImage && (
                <>
                  {!proof.imageLoaded && <div role="status" className="m-auto flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />Memuat gambar...</div>}
                  <img
                    src={proof.url}
                    alt={`Bukti pembayaran ${proof.label}`}
                    onLoad={() => setProof(cur => cur && cur.requestId === proof.requestId ? { ...cur, imageLoaded: true } : cur)}
                    onError={() => handleProofMediaError('Gambar bukti tidak dapat ditampilkan.')}
                    style={{ zoom }}
                    className={`m-auto max-h-[70vh] max-w-full object-contain ${proof.imageLoaded ? '' : 'hidden'}`}
                  />
                </>
              )}
            </div>
            {proof.status === 'ready' && proofIsImage && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2">
                <span className="text-xs text-slate-500">Perbesar atau perkecil tampilan bukti.</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} disabled={zoom <= 0.5} aria-label="Perkecil bukti" title="Perkecil" className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/40 disabled:cursor-not-allowed disabled:opacity-40"><ZoomOut className="w-4 h-4" aria-hidden="true" /></button>
                  <span className="w-12 text-center text-xs font-semibold text-slate-700" aria-live="polite">{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => setZoom(z => Math.min(2, Math.round((z + 0.25) * 100) / 100))} disabled={zoom >= 2} aria-label="Perbesar bukti" title="Perbesar" className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/40 disabled:cursor-not-allowed disabled:opacity-40"><ZoomIn className="w-4 h-4" aria-hidden="true" /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
