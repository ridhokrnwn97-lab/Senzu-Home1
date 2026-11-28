import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Landmark, Loader2, RefreshCw, ShieldCheck, Wallet, BookOpen, ReceiptText, Layers } from 'lucide-react';
import type { StaffUser } from '../../types';
import { auth } from '../../lib/firebase';
import { FatFinanceTab } from './FatFinanceTab';
import { FatAccountingTab } from './FatAccountingTab';
import { FatTaxTab } from './FatTaxTab';
import { FatCatalogTab } from './FatCatalogTab';

interface FatDashboardProps {
  currentUser: StaffUser;
}

type FatTab = 'overview' | 'finance' | 'accounting' | 'tax' | 'catalog';

type FatRefundAnomalies = {
  duplicateRefundCompletionEvents: number;
  paymentLinkedToMultipleCases: number;
  refundPaymentIdWithoutHistoryId: number;
  refundPaymentHistoryIdWithoutPaymentId: number;
  rejectedWithActiveLinkage: number;
  legacyMissingCompletionGuard: number;
};

interface FatOverviewResponse {
  success: boolean;
  period?: { type: string; label: string; timezone: string; generatedAt: string };
  payments?: {
    transactionCount: number;
    paid: { count: number; amount: number };
    pending: { count: number; amount: number };
    rejected: { count: number; amount: number };
    unpaid: { count: number };
    expired: { count: number };
    refundedOrPartiallyRefundedPayments: { count: number };
    cancelled?: { count: number; amount: number };
    unknown?: { count: number; amount: number };
    invalidAmountCount?: number;
    reconciliation?: { totalDocuments: number; classified: number; unknown: number; failed: number; reconciled: boolean };
  };
  refunds?: { source: string; caseCount: number; completedManualCount: number; amountTotal: number; amountCompletedManual: number; invalidAmountCount?: number; countingBasis?: string; note?: string; anomalies?: FatRefundAnomalies };
  meta?: { paymentsComplete?: boolean; refundsComplete?: boolean; paymentsLimit?: number | null; refundsLimit?: number | null; paymentsScanned?: number; casesScanned?: number; anomaliesScopedToLatest?: number | null; anomaliesScope?: { scannedCount: number; limit: number; hasMore: boolean } };
  notes?: string[];
  message?: string;
}

const tabs: Array<{ id: FatTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: Landmark },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'accounting', label: 'Accounting', icon: BookOpen },
  { id: 'tax', label: 'Tax', icon: ReceiptText },
  { id: 'catalog', label: 'Katalog', icon: Layers },
];

async function getFatJson<T>(path: string): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
  const token = await user.getIdToken();
  const res = await fetch(path, { method: 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.message || json?.error || 'Gagal memuat data FAT.');
  return json as T;
}

export const FatDashboard: React.FC<FatDashboardProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<FatTab>('overview');
  const [overview, setOverview] = useState<FatOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await getFatJson<FatOverviewResponse>('/api/fat/overview');
      setOverview(data);
    } catch (e: any) {
      setError(e?.message || 'Ringkasan FAT belum dapat dimuat.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === 'overview') void loadOverview(); }, [activeTab, loadOverview]);

  const rupiah = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const p = overview?.payments;
  const r = overview?.refunds;

  return (
    <div className="bg-[#FAF9F6] p-3 sm:p-4 md:p-6 lg:p-8 rounded-3xl min-h-screen space-y-4 sm:space-y-6">
      <header className="bg-gradient-to-br from-[#4B2B18] to-[#8B5A36] text-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 md:p-6 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-semibold tracking-wide">
              <Landmark className="w-3.5 h-3.5 text-[#D4AF37]" />
              Finance, Accounting, and Tax (FAT)
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold font-serif">Dashboard FAT (Read-only)</h1>
            <p className="text-xs sm:text-sm text-white/80">Monitoring keuangan, akuntansi, dan status pajak berbasis proyeksi data aktual dari backend (tanpa akses Firestore operasional langsung).</p>
          </div>
          <div className="bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm">
            <div className="font-semibold">{currentUser.name || currentUser.displayName || 'Staf FAT'}</div>
            <div className="text-white/75">Peran: {String(currentUser.role || 'fat').toUpperCase()} · Akses read-only</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] sm:text-xs text-amber-100">
          <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
          Akses dibatasi: tanpa menu operasional Manager/Admin/CSS/Supervisor/CRM dan tanpa kontrol mutasi/verifikasi/sinkronisasi.
        </div>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Navigasi FAT">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setActiveTab(t.id)} className={`flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold whitespace-nowrap border transition ${active ? 'bg-[#8B5A36] text-white border-[#8B5A36] shadow-sm' : 'bg-white text-[#4B2B18] border-slate-200 hover:border-[#8B5A36]/40'}`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </nav>

      {activeTab === 'overview' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-600">Periode: <span className="font-semibold text-[#4B2B18]">{overview?.period?.label || 'Memuat...'}</span> {overview?.period?.generatedAt ? <span className="text-slate-400">· diperbarui {new Date(overview.period.generatedAt).toLocaleString('id-ID')}</span> : null}</div>
            <button type="button" onClick={() => void loadOverview()} className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#4B2B18] hover:border-[#8B5A36]/40"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Muat ulang</button>
          </div>
          {loading && !overview && <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center gap-3 text-slate-600"><Loader2 className="w-5 h-5 animate-spin" /> Memuat ringkasan FAT...</div>}
          {error && <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-800 flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
          {!loading && !error && !overview && <div className="bg-white border border-slate-200 rounded-2xl p-6 text-sm text-slate-500 text-center">Belum ada data ringkasan untuk ditampilkan.</div>}
          {overview && p && r && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-4"><p className="text-xs text-slate-500 font-medium">Transaksi Pembayaran</p><p className="text-xl sm:text-2xl font-bold text-[#4B2B18]">{p.transactionCount}</p><p className="text-[11px] text-slate-400 mt-0.5">per transaksi (bukan per booking)</p></div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4"><p className="text-xs text-slate-500 font-medium">Pembayaran Berhasil (Paid)</p><p className="text-xl sm:text-2xl font-bold text-emerald-700">{p.paid.count}</p><p className="text-[11px] text-emerald-700 font-semibold mt-0.5">{rupiah(p.paid.amount)}</p></div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4"><p className="text-xs text-slate-500 font-medium">Pembayaran Tertunda</p><p className="text-xl sm:text-2xl font-bold text-amber-700">{p.pending.count}</p><p className="text-[11px] text-amber-700 font-semibold mt-0.5">{rupiah(p.pending.amount)}</p></div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4"><p className="text-xs text-slate-500 font-medium">Pembayaran Ditolak/Gagal</p><p className="text-xl sm:text-2xl font-bold text-rose-700">{p.rejected.count}</p><p className="text-[11px] text-rose-700 font-semibold mt-0.5">{rupiah(p.rejected.amount)}</p></div>
              </div>
              {((p.invalidAmountCount || 0) > 0 || (r.invalidAmountCount || 0) > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs sm:text-sm text-amber-900">
                  <p className="font-semibold">Peringatan integritas nominal</p>
                  <p className="mt-0.5">{p.invalidAmountCount || 0} transaksi pembayaran dan {r.invalidAmountCount || 0} kasus refund memiliki nominal tidak valid. Nominal tersebut tidak dimasukkan ke total nominal; periksa data sumber.</p>
                </div>
              )}
              {(p.reconciliation?.reconciled === false || overview.meta?.paymentsComplete === false || overview.meta?.refundsComplete === false) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs sm:text-sm text-amber-900">
                  <p className="font-semibold">Peringatan kelengkapan data</p>
                  <p className="mt-0.5">{p.reconciliation?.reconciled === false ? 'Total dokumen tidak sama dengan classified + unknown + failed. ' : ''}{overview.meta?.paymentsComplete === false || overview.meta?.refundsComplete === false ? 'Data belum lengkap; angka pada ringkasan bukan total keseluruhan.' : ''}</p>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-2">
                  <h2 className="font-bold text-[#4B2B18]">Status Pembayaran Lainnya</h2>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Unpaid</div><div className="font-bold text-slate-800">{p.unpaid.count}</div></div>
                    <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Expired</div><div className="font-bold text-slate-800">{p.expired.count}</div></div>
                    <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Cancelled</div><div className="font-bold text-slate-800">{p.cancelled?.count ?? 0}</div><div className="text-[11px] text-slate-500">{rupiah(p.cancelled?.amount ?? 0)}</div></div>
                    <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Status tidak dikenal</div><div className="font-bold text-slate-800">{p.unknown?.count ?? 0}</div><div className="text-[11px] text-slate-500">{rupiah(p.unknown?.amount ?? 0)}</div></div>
                    <div className="bg-slate-50 rounded-xl p-3 col-span-2"><div className="text-slate-500 text-xs">Payment status refunded/partially_refunded (transaksi)</div><div className="font-bold text-slate-800">{p.refundedOrPartiallyRefundedPayments.count}</div></div>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-2">
                  <h2 className="font-bold text-[#4B2B18]">Ringkasan Refund</h2>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Kasus refund (semua status)</div><div className="font-bold text-slate-800">{r.caseCount}</div><div className="text-[11px] text-slate-500">{rupiah(r.amountTotal)}</div></div>
                    <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Dikonfirmasi Selesai (Manual)</div><div className="font-bold text-slate-800">{r.completedManualCount}</div><div className="text-[11px] text-slate-500">{rupiah(r.amountCompletedManual)}</div></div>
                  </div>
                  <p className="text-xs text-slate-500">Sumber: <span className="font-mono">{r.source}</span>. {r.note || ''}</p>
                  <p className="text-xs text-slate-500">Dikonfirmasi Selesai (Manual) adalah konfirmasi Manager, bukan verifikasi payment gateway.</p>
                  {r.anomalies && (
                    <>
                      <p className="text-xs text-amber-700">
                        Anomali: duplikat completion {r.anomalies.duplicateRefundCompletionEvents} · payment multi-case {r.anomalies.paymentLinkedToMultipleCases} · linkage tidak lengkap {r.anomalies.refundPaymentIdWithoutHistoryId + r.anomalies.refundPaymentHistoryIdWithoutPaymentId} · REJECTED berlinkage {r.anomalies.rejectedWithActiveLinkage} · legacy tanpa guard {r.anomalies.legacyMissingCompletionGuard}
                      </p>
                      {Number(overview.meta?.anomaliesScope?.scannedCount ?? overview.meta?.anomaliesScopedToLatest ?? 0) > 0 && (
                        <p className="text-[11px] text-amber-700">
                          Pemeriksaan duplikat completion dan legacy guard mencakup {overview.meta?.anomaliesScope?.scannedCount ?? overview.meta?.anomaliesScopedToLatest} dokumen terbaru (batas {overview.meta?.anomaliesScope?.limit ?? 1000}){overview.meta?.anomaliesScope?.hasMore ? ' — parsial, masih ada dokumen lain' : ''}. Angka 0 bukan bukti tidak ada anomali pada seluruh data.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs sm:text-sm text-amber-900 space-y-1">
                <p className="font-semibold">Definisi & batasan metrik</p>
                <ul className="list-disc pl-5 space-y-0.5">{(overview.notes || []).map((n, i) => <li key={i}>{n}</li>)}</ul>
                <p className="font-medium">Pendapatan bersih tidak ditampilkan karena hubungan pembayaran dan refund belum selalu dapat dipastikan secara otomatis.</p>
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === 'finance' && <FatFinanceTab />}
      {activeTab === 'accounting' && <FatAccountingTab />}
      {activeTab === 'tax' && <FatTaxTab />}
      {activeTab === 'catalog' && <FatCatalogTab />}
    </div>
  );
};
