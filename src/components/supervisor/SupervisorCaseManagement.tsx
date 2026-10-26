import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  UserCheck,
  Phone,
  FileText,
  Gift,
  Check,
  ChevronRight,
  X,
  History,
  AlertCircle,
} from 'lucide-react';
import { Booking, Therapist } from '../../types';
import {
  UnifiedCase,
  CaseEvent,
  CaseSeverity,
  getStaffCaseStatusBadge,
  getCaseSeverityBadge,
  ROOT_CAUSE_CATEGORIES,
  SERVICE_RECOVERY_TYPES,
} from '../../types/case';
import {
  subscribeToCases,
  getCaseTimelineEvents,
  addCaseInternalNote,
  assignCase,
  proposeServiceRecovery,
  resolveCase,
  closeCase,
} from '../../lib/caseService';

interface SupervisorCaseManagementProps {
  bookings: Booking[];
  therapists: Therapist[];
  currentUser: {
    id: string;
    name: string;
    role: string;
  };
}

export const SupervisorCaseManagement: React.FC<SupervisorCaseManagementProps> = ({
  bookings,
  therapists,
  currentUser,
}) => {
  const [cases, setCases] = useState<UnifiedCase[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCase, setSelectedCase] = useState<UnifiedCase | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<CaseEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'pending' | 'therapist_issues' | 'high_critical' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals inside drawer
  const [showNoteModal, setShowNoteModal] = useState<boolean>(false);
  const [noteContent, setNoteContent] = useState<string>('');

  const [showResolveModal, setShowResolveModal] = useState<boolean>(false);
  const [resolutionSummary, setResolutionSummary] = useState<string>('');
  const [rootCause, setRootCause] = useState<string>(ROOT_CAUSE_CATEGORIES[0]);
  const [correctiveAction, setCorrectiveAction] = useState<string>('');

  const [showRecoveryModal, setShowRecoveryModal] = useState<boolean>(false);
  const [recoveryType, setRecoveryType] = useState<string>(SERVICE_RECOVERY_TYPES[0]);
  const [recoveryDesc, setRecoveryDesc] = useState<string>('');
  const [recoveryAmount, setRecoveryAmount] = useState<number>(0);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToCases((items) => {
      setCases(items || []);
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
    setLoadingTimeline(true);
    getCaseTimelineEvents(selectedCase.id)
      .then((evts) => setTimelineEvents(evts))
      .catch((err) => console.warn('Failed to load timeline:', err))
      .finally(() => setLoadingTimeline(false));
  }, [selectedCase?.id]);

  const filteredCases = (cases || []).filter((c) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        (c.caseCode || '').toLowerCase().includes(q) ||
        (c.bookingCode || '').toLowerCase().includes(q) ||
        (c.customerName || '').toLowerCase().includes(q) ||
        (c.therapistName || '').toLowerCase().includes(q) ||
        (c.summary || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    if (activeTab === 'pending') {
      return c.status !== 'RESOLVED' && c.status !== 'CLOSED';
    }
    if (activeTab === 'therapist_issues') {
      return c.caseType === 'THERAPIST_ISSUE' || c.source === 'Therapist';
    }
    if (activeTab === 'high_critical') {
      return (c.severity === 'HIGH' || c.severity === 'CRITICAL') && c.status !== 'CLOSED';
    }
    return true;
  });

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !noteContent.trim()) return;
    try {
      await addCaseInternalNote({
        caseItem: selectedCase,
        note: `[Supervisor Note] ${noteContent.trim()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowNoteModal(false);
      setNoteContent('');
      const evts = await getCaseTimelineEvents(selectedCase.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan catatan.');
    }
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !resolutionSummary.trim()) return;
    try {
      await resolveCase({
        caseItem: selectedCase,
        resolutionSummary: resolutionSummary.trim(),
        rootCauseCategory: rootCause,
        correctiveAction: correctiveAction.trim() || undefined,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowResolveModal(false);
      setResolutionSummary('');
      setCorrectiveAction('');
      const evts = await getCaseTimelineEvents(selectedCase.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal menyelesaikan kasus.');
    }
  };

  const handleProposeRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !recoveryDesc.trim()) return;
    try {
      await proposeServiceRecovery({
        caseItem: selectedCase,
        recoveryType,
        description: recoveryDesc.trim(),
        refundAmount: recoveryAmount > 0 ? recoveryAmount : undefined,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowRecoveryModal(false);
      setRecoveryDesc('');
      setRecoveryAmount(0);
      const evts = await getCaseTimelineEvents(selectedCase.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal mengajukan recovery.');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h3 className="text-base font-bold font-serif text-[#4B2B18] flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            Penanganan Insiden & Eskalasi Lapangan (Supervisor)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Investigasi kendala terapis, keterlambatan armada, kepatuhan SOP treatment, dan tindakan perbaikan operasional.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-xl font-bold">
            {(cases || []).filter((c) => c.status !== 'CLOSED').length} Insiden Aktif
          </span>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'pending', label: 'Perlu Investigasi' },
              { id: 'therapist_issues', label: 'Kendala Terapis' },
              { id: 'high_critical', label: 'Urgensi Tinggi' },
              { id: 'all', label: 'Semua Kasus' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-[#8B5A36] text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari insiden..."
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-[#8B5A36]"
            />
          </div>
        </div>
      </div>

      {/* Cases List */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          Memuat data insiden...
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          Tidak ada insiden operasional aktif yang membutuhkan penanganan.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {(filteredCases || []).map((c) => {
            const statusBadge = getStaffCaseStatusBadge(c.status);
            const severityBadge = getCaseSeverityBadge(c.severity);

            return (
              <div
                key={c.id}
                onClick={() => setSelectedCase(c)}
                className={`p-3.5 rounded-xl bg-white border transition shadow-xs hover:shadow-md cursor-pointer space-y-2.5 ${
                  selectedCase?.id === c.id ? 'border-[#8B5A36] ring-1 ring-[#8B5A36]' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
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

                <div className="text-xs text-slate-700">
                  <h4 className="font-bold text-slate-900">{c.summary}</h4>
                  <p className="line-clamp-2 text-slate-600 text-[11px] mt-0.5">{c.description}</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                  <div className="flex items-center gap-3">
                    <span>Pelanggan: <strong className="text-slate-700">{c.customerName}</strong></span>
                    {c.therapistName && (
                      <span>Terapis: <strong className="text-slate-700">{c.therapistName}</strong></span>
                    )}
                  </div>
                  <span className="text-[#4B2B18] font-semibold flex items-center gap-1">
                    Detail Investigasi <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer */}
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-1 border-b border-slate-100 pb-3">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Catatan Supervisor</span>
                </button>

                {!selectedCase.recovery || selectedCase.recovery.status === 'NOT_PROPOSED' ? (
                  <button
                    type="button"
                    onClick={() => setShowRecoveryModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Gift className="w-3.5 h-3.5 text-amber-600" />
                    <span>Usulkan Recovery</span>
                  </button>
                ) : null}

                {selectedCase.status !== 'RESOLVED' && selectedCase.status !== 'CLOSED' && (
                  <button
                    type="button"
                    onClick={() => setShowResolveModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1 cursor-pointer ml-auto"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Selesaikan Insiden</span>
                  </button>
                )}
              </div>

              {/* Overview */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>Booking: <strong>{selectedCase.bookingCode}</strong></div>
                  <div>Pelanggan: <strong>{selectedCase.customerName}</strong></div>
                  <div>Terapis: <strong>{selectedCase.therapistName || '-'}</strong></div>
                  <div>Sumber Laporan: <strong>{selectedCase.source}</strong></div>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-1">Kronologi Kendala:</span>
                <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-700 whitespace-pre-wrap">
                  {selectedCase.description}
                </div>
              </div>

              {selectedCase.internalNotes && (
                <div>
                  <span className="font-bold text-amber-800 block mb-1">Catatan Internal & Investigasi:</span>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 whitespace-pre-wrap font-mono text-[11px]">
                    {selectedCase.internalNotes}
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-slate-500" /> Jejak Investigasi:
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

      {/* Note Modal */}
      {showNoteModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-3 text-xs">
            <h4 className="font-bold text-[#4B2B18] text-sm">Catatan Investigasi Supervisor</h4>
            <textarea
              rows={4}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Catatan hasil investigasi terapis, rute, atau tindakan lapangan..."
              className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none"
              required
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleAddNote}
                className="px-3 py-1.5 rounded-lg bg-[#8B5A36] text-white font-bold cursor-pointer"
              >
                Simpan Catatan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {showResolveModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-3 text-xs">
            <h4 className="font-bold text-[#4B2B18] text-sm">Selesaikan Insiden Operasional</h4>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Akar Masalah:</label>
              <select
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                className="w-full p-2 rounded-xl border border-slate-300"
              >
                {ROOT_CAUSE_CATEGORIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Solusi / Tindakan yang Diambil:</label>
              <textarea
                rows={3}
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                placeholder="Contoh: Penggantian terapis ke Sister Siti, waktu mulai digeser 15 menit..."
                className="w-full p-2 rounded-xl border border-slate-300 resize-none"
                required
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Tindakan Korektif untuk Terapis:</label>
              <textarea
                rows={2}
                value={correctiveAction}
                onChange={(e) => setCorrectiveAction(e.target.value)}
                placeholder="Contoh: Coaching briefing ketepatan waktu sebelum keberangkatan..."
                className="w-full p-2 rounded-xl border border-slate-300 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResolveModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleResolve}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold cursor-pointer"
              >
                Selesaikan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Propose Recovery Modal */}
      {showRecoveryModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-3 text-xs">
            <h4 className="font-bold text-[#4B2B18] text-sm">Usulkan Service Recovery</h4>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Tipe Pemulihan:</label>
              <select
                value={recoveryType}
                onChange={(e) => setRecoveryType(e.target.value)}
                className="w-full p-2 rounded-xl border border-slate-300"
              >
                {SERVICE_RECOVERY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Alasan / Rincian:</label>
              <textarea
                rows={3}
                value={recoveryDesc}
                onChange={(e) => setRecoveryDesc(e.target.value)}
                placeholder="Jelaskan alasan kompensasi yang diusulkan..."
                className="w-full p-2 rounded-xl border border-slate-300 resize-none"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRecoveryModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleProposeRecovery}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold cursor-pointer"
              >
                Ajukan ke Manager
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
