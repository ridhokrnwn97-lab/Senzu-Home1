import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Gift,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  Search,
  Filter,
  Check,
  X,
  FileText,
  User,
  History,
  Tag,
  Building2,
  ChevronRight,
  CreditCard,
} from 'lucide-react';
import { Booking } from '../../types';
import {
  UnifiedCase,
  CaseEvent,
  RefundRequestStatus,
  getStaffCaseStatusBadge,
  getCaseSeverityBadge,
} from '../../types/case';
import {
  subscribeToCases,
  getCaseTimelineEvents,
  approveServiceRecovery,
  updateManualRefundStatus,
  closeCase,
} from '../../lib/caseService';
import { formatDateTimeWIB } from '../../lib/utils';

interface ManagerCaseGovernanceProps {
  currentUser: {
    id: string;
    name: string;
    role: string;
  };
}

export const ManagerCaseGovernance: React.FC<ManagerCaseGovernanceProps> = ({ currentUser }) => {
  const [cases, setCases] = useState<UnifiedCase[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'approvals' | 'refunds' | 'all' | 'analytics'>('approvals');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Case
  const [selectedCase, setSelectedCase] = useState<UnifiedCase | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<CaseEvent[]>([]);

  // Approval Modal
  const [showApprovalModal, setShowApprovalModal] = useState<boolean>(false);
  const [approvalDecision, setApprovalDecision] = useState<'approve' | 'reject'>('approve');
  const [approvalNote, setApprovalNote] = useState<string>('');

  // Voucher details if approving voucher
  const [voucherDiscountAmount, setVoucherDiscountAmount] = useState<number>(50000);
  const [voucherMinSpend, setVoucherMinSpend] = useState<number>(100000);
  const [voucherExpiryDays, setVoucherExpiryDays] = useState<number>(30);

  // Manual Refund Status Modal
  const [showRefundModal, setShowRefundModal] = useState<boolean>(false);
  const [newRefundStatus, setNewRefundStatus] = useState<RefundRequestStatus>('COMPLETED_MANUAL');
  const [refundNotes, setRefundNotes] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToCases((items) => {
      setCases(items);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (selectedCase) {
      const updated = cases.find((c) => c.id === selectedCase.id);
      if (updated) setSelectedCase(updated);
    }
  }, [cases]);

  useEffect(() => {
    if (!selectedCase) {
      setTimelineEvents([]);
      return;
    }
    getCaseTimelineEvents(selectedCase.id)
      .then((evts) => setTimelineEvents(evts))
      .catch((err) => console.warn('Timeline error:', err));
  }, [selectedCase?.id]);

  // Pending Approvals count
  const pendingApprovals = cases.filter(
    (c) => c.recovery && c.recovery.status === 'PROPOSED'
  );

  // Pending manual refunds
  const pendingRefunds = cases.filter(
    (c) =>
      c.recovery &&
      (c.recovery.refundStatus === 'REVIEW_REQUIRED' ||
        (c.recovery.refundStatus as any) === 'REQUESTED' ||
        c.recovery.refundStatus === 'APPROVED' ||
        c.recovery.refundStatus === 'PROCESSING_MANUAL')
  );

  const filteredCases = cases.filter((c) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        (c.caseCode || '').toLowerCase().includes(q) ||
        (c.bookingCode || '').toLowerCase().includes(q) ||
        (c.customerName || '').toLowerCase().includes(q) ||
        (c.summary || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    if (activeTab === 'approvals') {
      return c.recovery && c.recovery.status === 'PROPOSED';
    }
    if (activeTab === 'refunds') {
      return c.recovery && c.recovery.refundStatus !== 'NOT_REQUIRED';
    }
    return true;
  });

  // Handle Approve / Reject Service Recovery
  const handleApprovalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;

    try {
      if (approvalDecision === 'approve') {
        await approveServiceRecovery({
          caseItem: selectedCase,
          decision: 'APPROVE',
          reason: approvalNote.trim() || undefined,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role === 'admin' ? 'Admin' : 'Manager',
        });
        alert('Service recovery berhasil disetujui.');
      } else {
        await approveServiceRecovery({
          caseItem: selectedCase,
          decision: 'REJECT',
          reason: approvalNote.trim() || 'Ditolak oleh Manager sesuai kebijakan.',
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role === 'admin' ? 'Admin' : 'Manager',
        });
        alert('Pengajuan service recovery ditolak.');
      }
      setShowApprovalModal(false);
      setApprovalNote('');
    } catch (err: any) {
      alert(err.message || 'Gagal memproses persetujuan recovery.');
    }
  };

  // Handle Update Refund Status
  const handleUpdateRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    try {
      await updateManualRefundStatus({
        caseItem: selectedCase,
        newStatus: newRefundStatus,
        note: refundNotes.trim() || undefined,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowRefundModal(false);
      setRefundNotes('');
      alert('Status refund manual berhasil diperbarui.');
    } catch (err: any) {
      alert(err.message || 'Gagal memperbarui status refund.');
    }
  };

  // Analytics aggregation
  const totalClosed = cases.filter((c) => c.status === 'CLOSED').length;
  const categoryCounts = cases.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-xl font-bold font-serif text-[#4B2B18] flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#4B2B18]" />
            Tata Kelola Komplain & Persetujuan Recovery (Manager)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Otorisasi pemulihan layanan (Voucher, Refund Manual, Reschedule), pengawasan kepatuhan SOP & tren masalah.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pendingApprovals.length > 0 && (
            <span className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold animate-pulse">
              {pendingApprovals.length} Menunggu Persetujuan
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('approvals')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'approvals'
                  ? 'bg-[#8B5A36] text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Gift className="w-3.5 h-3.5" />
              <span>Menunggu Persetujuan ({pendingApprovals.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('refunds')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'refunds'
                  ? 'bg-[#8B5A36] text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Refund Manual ({pendingRefunds.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-[#8B5A36] text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Semua Kasus ({cases.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'analytics'
                  ? 'bg-[#8B5A36] text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Analisis Masalah & Tren</span>
            </button>
          </div>

          {activeTab !== 'analytics' && (
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari kasus..."
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'analytics' ? (
        /* ANALYTICS VIEW */
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500">Total Kasus Tercatat</span>
              <div className="text-2xl font-bold text-[#4B2B18] mt-1">{cases.length}</div>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500">Tingkat Penyelesaian (Closure Rate)</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">
                {cases.length > 0 ? Math.round((totalClosed / cases.length) * 100) : 0}%
              </div>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500">Total Recovery Diberikan</span>
              <div className="text-2xl font-bold text-purple-600 mt-1">
                {cases.filter((c) => c.recovery && c.recovery.status === 'APPROVED').length}
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3">
            <h4 className="font-bold text-slate-800 text-sm">Distribusi Kategori Kendala</h4>
            <div className="space-y-2">
              {(Object.entries(categoryCounts) as [string, number][])
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .map(([cat, count]) => {
                  const pct = Math.round((Number(count) / (cases.length || 1)) * 100);
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold text-slate-700">{cat}</span>
                        <span className="text-slate-500 font-mono">
                          {count} kasus ({pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-[#8B5A36] h-2 rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      ) : (
        /* CASES LIST VIEW */
        <div className="grid grid-cols-1 gap-3">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
              Memuat data kasus tata kelola...
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
              {activeTab === 'approvals'
                ? 'Tidak ada pengajuan recovery yang menunggu persetujuan.'
                : 'Tidak ada kasus yang ditemukan.'}
            </div>
          ) : (
            (filteredCases || []).map((c) => {
              const statusBadge = getStaffCaseStatusBadge(c.status);
              const severityBadge = getCaseSeverityBadge(c.severity);

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedCase(c)}
                  className={`p-4 rounded-2xl bg-white border transition shadow-xs hover:shadow-md cursor-pointer space-y-3 ${
                    selectedCase?.id === c.id ? 'border-[#8B5A36] ring-1 ring-[#8B5A36]' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#4B2B18] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        {c.caseCode}
                      </span>
                      <strong className="text-xs text-slate-800">{c.category}</strong>
                      <span className="text-[11px] text-slate-400">
                        • Booking: {c.bookingCode}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${severityBadge.badgeClass}`}>
                        {severityBadge.label}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${statusBadge.badgeClass}`}>
                        {statusBadge.label}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="md:col-span-2 space-y-1">
                      <h4 className="font-bold text-slate-900">{c.summary}</h4>
                      <p className="text-slate-600 line-clamp-2 text-xs">{c.description}</p>

                      {c.recovery && (
                        <div className="mt-2 p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold flex items-center gap-1">
                              <Gift className="w-3.5 h-3.5 text-amber-600" />
                              Usulan: {c.recovery.type}
                            </span>
                            <span className="text-[10px] uppercase font-mono font-bold bg-amber-200/60 px-2 py-0.5 rounded">
                              {c.recovery.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-800">{c.recovery.description}</p>
                          {c.recovery.refundStatus !== 'NOT_REQUIRED' && (
                            <div className="text-[11px] text-blue-800 font-semibold pt-1 border-t border-amber-200/60">
                              Refund Manual: {c.recovery.refundStatus}
                              {c.recovery.refundAmount ? ` (Rp ${c.recovery.refundAmount.toLocaleString('id-ID')})` : ''}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1 text-[11px] text-slate-600">
                      <div>Pelanggan: <strong className="text-slate-800">{c.customerName}</strong></div>
                      <div>Terapis: <strong className="text-slate-800">{c.therapistName || '-'}</strong></div>
                      <div>Penanggung Jawab: <strong className="text-slate-800">{c.assignedRole}</strong></div>
                      <div className="pt-1 border-t border-slate-200 text-slate-400">
                        {new Date(c.reportedAt).toLocaleDateString('id-ID')}
                      </div>
                    </div>
                  </div>

                  {/* Actions preview */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                    {c.recovery?.status === 'PROPOSED' ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCase(c);
                          setShowApprovalModal(true);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Tinjau & Beri Keputusan Recovery</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        Status Recovery: {c.recovery ? c.recovery.status : 'Tidak ada'}
                      </span>
                    )}

                    <span className="text-[11px] text-[#4B2B18] font-semibold flex items-center gap-1">
                      Buka Rincian Kasus <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* DRAWER FOR SELECTED CASE */}
      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 text-xs">
            {/* Header */}
            <div className="p-4 bg-[#8B5A36] text-white flex items-center justify-between shrink-0">
              <div>
                <span className="font-mono text-xs font-bold bg-white/20 px-2 py-0.5 rounded">
                  {selectedCase.caseCode}
                </span>
                <h3 className="font-serif font-bold text-sm mt-1">{selectedCase.summary}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCase(null)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Recovery Decision Action Bar */}
              {selectedCase.recovery?.status === 'PROPOSED' && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-900 flex items-center gap-1.5">
                      <Gift className="w-4 h-4 text-amber-700" />
                      Usulan Service Recovery Menunggu Otorisasi
                    </span>
                  </div>
                  <p className="text-amber-800 text-xs">
                    Tipe: <strong>{selectedCase.recovery.type}</strong> — {selectedCase.recovery.description}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setApprovalDecision('approve');
                        setShowApprovalModal(true);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Setujui (Approve)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setApprovalDecision('reject');
                        setShowApprovalModal(true);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Tolak (Reject)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Manual Refund Action Bar if relevant */}
              {selectedCase.recovery && selectedCase.recovery.refundStatus !== 'NOT_REQUIRED' && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-blue-900 block">Status Refund Manual:</span>
                    <span className="text-blue-800 font-mono font-bold">
                      {selectedCase.recovery.refundStatus}
                      {selectedCase.recovery.refundAmount
                        ? ` (Rp ${selectedCase.recovery.refundAmount.toLocaleString('id-ID')})`
                        : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRefundModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
                  >
                    Perbarui Status Refund
                  </button>
                </div>
              )}

              {/* Overview Details */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>Booking: <strong>{selectedCase.bookingCode}</strong></div>
                  <div>Pelanggan: <strong>{selectedCase.customerName}</strong></div>
                  <div>Terapis: <strong>{selectedCase.therapistName || '-'}</strong></div>
                  <div>Kategori: <strong>{selectedCase.category}</strong></div>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-1">Deskripsi Kasus:</span>
                <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-700 whitespace-pre-wrap">
                  {selectedCase.description}
                </div>
              </div>

              {selectedCase.internalNotes && (
                <div>
                  <span className="font-bold text-amber-800 block mb-1">Catatan Investigasi Internal:</span>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 whitespace-pre-wrap font-mono text-[11px]">
                    {selectedCase.internalNotes}
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-slate-500" /> Jejak Kronologi Kasus:
                </span>
                {(timelineEvents || []).map((evt) => (
                  <div key={evt.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-0.5">
                    <div className="flex items-center justify-between font-bold text-slate-900">
                      <span>{evt.summary}</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        {new Date(evt.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {evt.details && <p className="text-[11px] text-slate-600">{evt.details}</p>}
                    <div className="text-[10px] text-slate-400">Oleh: {evt.actorName} ({evt.actorRole})</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* APPROVAL MODAL */}
      {showApprovalModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-3 text-xs">
            <h4 className="font-bold text-[#4B2B18] text-sm">
              {approvalDecision === 'approve'
                ? 'Konfirmasi Persetujuan Service Recovery'
                : 'Tolak Pengajuan Service Recovery'}
            </h4>

            <form onSubmit={handleApprovalSubmit} className="space-y-3">
              {approvalDecision === 'approve' && selectedCase.recovery?.type.includes('Voucher') && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
                  <span className="font-bold text-amber-900 block">Parameter Penerbitan Voucher Otomatis:</span>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-0.5">Nominal Potongan (Rp):</label>
                    <input
                      type="number"
                      value={voucherDiscountAmount}
                      onChange={(e) => setVoucherDiscountAmount(Number(e.target.value))}
                      className="w-full p-1.5 rounded-lg border border-slate-300"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-0.5">Minimal Transaksi (Rp):</label>
                    <input
                      type="number"
                      value={voucherMinSpend}
                      onChange={(e) => setVoucherMinSpend(Number(e.target.value))}
                      className="w-full p-1.5 rounded-lg border border-slate-300"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-0.5">Masa Berlaku (Hari):</label>
                    <input
                      type="number"
                      value={voucherExpiryDays}
                      onChange={(e) => setVoucherExpiryDays(Number(e.target.value))}
                      className="w-full p-1.5 rounded-lg border border-slate-300"
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Catatan Manager {approvalDecision === 'reject' ? '(Alasan Penolakan)' : '(Opsional)'}:
                </label>
                <textarea
                  rows={3}
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  placeholder={
                    approvalDecision === 'approve'
                      ? 'Disetujui sesuai kebijakan kompensasi...'
                      : 'Tuliskan pertimbangan penolakan...'
                  }
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none"
                  required={approvalDecision === 'reject'}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApprovalModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className={`px-3 py-1.5 rounded-lg text-white font-bold cursor-pointer ${
                    approvalDecision === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {approvalDecision === 'approve' ? 'Setujui & Terbitkan' : 'Tolak Usulan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REFUND STATUS MODAL */}
      {showRefundModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-3 text-xs">
            <h4 className="font-bold text-[#4B2B18] text-sm">Perbarui Status Refund Manual</h4>
            <form onSubmit={handleUpdateRefund} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Status Refund Baru:</label>
                <select
                  value={newRefundStatus}
                  onChange={(e) => setNewRefundStatus(e.target.value as RefundRequestStatus)}
                  className="w-full p-2 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="APPROVED">APPROVED (Disetujui untuk Diproses)</option>
                  <option value="PROCESSING_MANUAL">PROCESSING_MANUAL (Sedang Diproses Transfer)</option>
                  <option value="COMPLETED_MANUAL">COMPLETED_MANUAL (Dana Telah Ditransfer ke Rekening Pelanggan)</option>
                  <option value="REJECTED">REJECTED (Permohonan Refund Ditolak)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Nomor Rekening / Bukti Transfer Manual:
                </label>
                <textarea
                  rows={3}
                  value={refundNotes}
                  onChange={(e) => setRefundNotes(e.target.value)}
                  placeholder="Contoh: Transfer via BCA ref: TRF-99281 ke Rek BCA 829103... a/n Pelanggan"
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRefundModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
                >
                  Simpan Status Refund
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
