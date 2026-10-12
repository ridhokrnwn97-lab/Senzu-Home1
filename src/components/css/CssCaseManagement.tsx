import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  MessageCircle,
  Phone,
  User,
  ShieldAlert,
  ChevronRight,
  Plus,
  X,
  FileText,
  Gift,
  RefreshCw,
  Send,
  Eye,
  Check,
  History,
  Tag,
} from 'lucide-react';
import { Booking } from '../../types';
import {
  UnifiedCase,
  CaseEvent,
  CaseStatus,
  CaseSeverity,
  ServiceRecoveryType,
  RootCauseCategory,
  getStaffCaseStatusBadge,
  getCaseSeverityBadge,
  SERVICE_RECOVERY_TYPES,
  ROOT_CAUSE_CATEGORIES,
  COMPLAINT_CATEGORIES,
} from '../../types/case';
import {
  subscribeToCases,
  createCase,
  getCaseTimelineEvents,
  logCaseCustomerContact,
  addCaseInternalNote,
  proposeServiceRecovery,
  deliverServiceRecovery,
  resolveCase,
  closeCase,
  reopenCase,
} from '../../lib/caseService';
import { useCustomerServiceWhatsApp } from '../../lib/supportWhatsApp';
import { formatDateTimeWIB } from '../../lib/utils';

interface CssCaseManagementProps {
  bookings: Booking[];
  currentUser: {
    id: string;
    name: string;
    role: string;
  };
  initialBookingIdToOpen?: string;
  onClearInitialBooking?: () => void;
}

export const CssCaseManagement: React.FC<CssCaseManagementProps> = ({
  bookings = [],
  currentUser,
  initialBookingIdToOpen,
  onClearInitialBooking,
}) => {
  const [cases, setCases] = useState<UnifiedCase[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeFilterTab, setActiveFilterTab] = useState<
    'all_active' | 'need_contact' | 'payment_issues' | 'low_rating' | 'waiting_manager' | 'resolved_closed'
  >('all_active');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');

  // Detail Drawer State
  const [selectedCase, setSelectedCase] = useState<UnifiedCase | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<CaseEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState<boolean>(false);

  // Modals inside drawer
  const [showContactModal, setShowContactModal] = useState<boolean>(false);
  const [contactChannel, setContactChannel] = useState<'whatsapp' | 'phone' | 'in_app'>('whatsapp');
  const [contactDirection, setContactDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [contactSummary, setContactSummary] = useState<string>('');
  const [contactOutcome, setContactOutcome] = useState<'pending' | 'informed' | 'accepted' | 'declined'>('informed');

  const [showNoteModal, setShowNoteModal] = useState<boolean>(false);
  const [noteContent, setNoteContent] = useState<string>('');

  const [showRecoveryModal, setShowRecoveryModal] = useState<boolean>(false);
  const [recoveryType, setRecoveryType] = useState<string>(SERVICE_RECOVERY_TYPES[0]);
  const [recoveryDescription, setRecoveryDescription] = useState<string>('');
  const [recoveryRefundAmount, setRecoveryRefundAmount] = useState<number>(0);

  const [showDeliverModal, setShowDeliverModal] = useState<boolean>(false);
  const [deliverOutcome, setDeliverOutcome] = useState<'informed' | 'accepted' | 'declined'>('accepted');
  const [deliverNote, setDeliverNote] = useState<string>('');

  const [showResolveModal, setShowResolveModal] = useState<boolean>(false);
  const [resolutionSummary, setResolutionSummary] = useState<string>('');
  const [rootCause, setRootCause] = useState<string>(ROOT_CAUSE_CATEGORIES[0]);
  const [correctiveAction, setCorrectiveAction] = useState<string>('');

  // Quick Create Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createBookingId, setCreateBookingId] = useState<string>('');
  const [createCategory, setCreateCategory] = useState<string>(COMPLAINT_CATEGORIES[0]);
  const [createSeverity, setCreateSeverity] = useState<CaseSeverity>('MEDIUM');
  const [createSummary, setCreateSummary] = useState<string>('');
  const [createDesc, setCreateDesc] = useState<string>('');
  const [createInternalNote, setCreateInternalNote] = useState<string>('');

  const { isAvailable, openWhatsApp, whatsAppNumber } = useCustomerServiceWhatsApp();

  // Subscribe to realtime cases
  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToCases((items) => {
      setCases(items);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Sync selected case with realtime updates
  useEffect(() => {
    if (selectedCase) {
      const updated = cases.find((c) => c.id === selectedCase.id);
      if (updated) {
        setSelectedCase(updated);
      }
    }
  }, [cases]);

  // If opened from a specific booking
  useEffect(() => {
    if (initialBookingIdToOpen && cases.length > 0) {
      const found = cases.find((c) => c.bookingId === initialBookingIdToOpen);
      if (found) {
        setSelectedCase(found);
      } else {
        // Open create modal pre-filled with this booking
        setCreateBookingId(initialBookingIdToOpen);
        setShowCreateModal(true);
      }
      if (onClearInitialBooking) onClearInitialBooking();
    }
  }, [initialBookingIdToOpen, cases]);

  // Load timeline events when case is selected
  useEffect(() => {
    if (!selectedCase) {
      setTimelineEvents([]);
      return;
    }
    setLoadingTimeline(true);
    getCaseTimelineEvents(selectedCase.id)
      .then((events) => setTimelineEvents(events))
      .catch((err) => console.warn('Failed to load timeline events:', err))
      .finally(() => setLoadingTimeline(false));
  }, [selectedCase?.id]);

  // Filtered Cases
  const filteredCases = cases.filter((c) => {
    // Severity Filter
    if (severityFilter !== 'ALL' && c.severity !== severityFilter) {
      return false;
    }

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchCode = (c.caseCode || '').toLowerCase().includes(q);
      const matchBooking = (c.bookingCode || '').toLowerCase().includes(q);
      const matchCust = (c.customerName || '').toLowerCase().includes(q) || (c.customerPhone || '').includes(q);
      const matchTherapist = (c.therapistName || '').toLowerCase().includes(q);
      const matchSummary = (c.summary || '').toLowerCase().includes(q);
      if (!matchCode && !matchBooking && !matchCust && !matchTherapist && !matchSummary) {
        return false;
      }
    }

    // Tabs
    if (activeFilterTab === 'all_active') {
      return c.status !== 'CLOSED';
    }
    if (activeFilterTab === 'need_contact') {
      return c.status === 'OPEN' || c.status === 'WAITING_CUSTOMER' || (c as any).customerContactOutcome === 'pending';
    }
    if (activeFilterTab === 'payment_issues') {
      return c.caseType === 'PAYMENT_ISSUE' || (c.category || '').toLowerCase().includes('payment');
    }
    if (activeFilterTab === 'low_rating') {
      return c.caseType === 'LOW_RATING' || c.rating !== undefined;
    }
    if (activeFilterTab === 'waiting_manager') {
      return c.status === 'WAITING_MANAGER' || (c.recovery && c.recovery.status === 'PROPOSED');
    }
    if (activeFilterTab === 'resolved_closed') {
      return c.status === 'RESOLVED' || c.status === 'CLOSED';
    }

    return true;
  });

  // Action Handlers
  const handleOpenWhatsAppChat = (c: UnifiedCase) => {
    const text = `Halo Kak ${c.customerName}, saya ${currentUser.name} dari Customer Support Senzu Home terkait pesanan ${c.bookingCode}. Kami menerima laporan kendala "${c.summary}" dan ingin memastikan semuanya tertangani dengan baik.`;
    openWhatsApp(text, c.customerPhone);
  };

  const handleLogContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !contactSummary.trim()) return;
    try {
      await logCaseCustomerContact({
        caseItem: selectedCase,
        channel: contactChannel,
        direction: contactDirection,
        summary: contactSummary.trim(),
        outcome: contactOutcome,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowContactModal(false);
      setContactSummary('');
      // Refresh timeline
      const evts = await getCaseTimelineEvents(selectedCase.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal mencatat kontak pelanggan.');
    }
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !noteContent.trim()) return;
    try {
      await addCaseInternalNote({
        caseItem: selectedCase,
        note: noteContent.trim(),
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowNoteModal(false);
      setNoteContent('');
      const evts = await getCaseTimelineEvents(selectedCase.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal menambahkan catatan internal.');
    }
  };

  const handleProposeRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !recoveryDescription.trim()) return;
    try {
      await proposeServiceRecovery({
        caseItem: selectedCase,
        recoveryType,
        description: recoveryDescription.trim(),
        refundAmount: recoveryRefundAmount > 0 ? recoveryRefundAmount : undefined,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowRecoveryModal(false);
      setRecoveryDescription('');
      setRecoveryRefundAmount(0);
      const evts = await getCaseTimelineEvents(selectedCase.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal mengajukan service recovery.');
    }
  };

  const handleDeliverRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    try {
      await deliverServiceRecovery({
        caseItem: selectedCase,
        customerOutcome: deliverOutcome,
        customerOutcomeNote: deliverNote.trim() || undefined,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      setShowDeliverModal(false);
      setDeliverNote('');
      const evts = await getCaseTimelineEvents(selectedCase.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan status penyampaian recovery.');
    }
  };

  const handleResolveCaseSubmit = async (e: React.FormEvent) => {
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

  const handleCloseCase = async (c: UnifiedCase) => {
    if (!window.confirm(`Yakin ingin menutup kasus ${c.caseCode}? Pastikan semua tindak lanjut telah tuntas.`)) {
      return;
    }
    try {
      await closeCase({
        caseItem: c,
        closureReason: 'Tindak lanjut operasional dan komunikasi pelanggan telah diselesaikan.',
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
      });
      const evts = await getCaseTimelineEvents(c.id);
      setTimelineEvents(evts);
    } catch (err: any) {
      alert(err.message || 'Gagal menutup kasus.');
    }
  };

  const handleCreateCaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createBookingId || !createSummary.trim() || !createDesc.trim()) {
      alert('Pilih booking dan lengkapi ringkasan kendala.');
      return;
    }

    const b = bookings.find((item) => item.id === createBookingId);
    if (!b) {
      alert('Pesanan tidak ditemukan.');
      return;
    }

    try {
      const newCase = await createCase({
        caseType: 'COMPLAINT',
        source: 'CSS',
        booking: {
          id: b.id,
          bookingCode: b.bookingCode,
          customerId: b.customerId,
          customerName: b.customerName,
          customerWhatsApp: b.customerWhatsApp,
          therapistId: b.therapistId,
          therapistName: b.therapistName,
          branchId: b.branchId,
        },
        category: createCategory,
        severity: createSeverity,
        summary: createSummary.trim(),
        description: createDesc.trim(),
        internalNotes: createInternalNote.trim() || undefined,
        reportedBy: currentUser.id,
        reportedByName: currentUser.name,
        assignedRole: 'CSS',
      });

      setShowCreateModal(false);
      setCreateSummary('');
      setCreateDesc('');
      setCreateInternalNote('');
      setSelectedCase(newCase);
    } catch (err: any) {
      alert(err.message || 'Gagal membuat kasus baru.');
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Top Header & Counters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-xl font-bold font-serif text-[#082A4F] flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-amber-500" />
            Manajemen Komplain & Pemulihan Layanan (CSS)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Penanganan terpadu keluhan pelanggan, evaluasi rating rendah, koordinasi operasional & penyampaian recovery.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateBookingId(bookings[0]?.id || '');
            setShowCreateModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0A3663] text-white text-xs font-bold transition shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Buat Kasus / Komplain Baru</span>
        </button>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[11px] font-medium text-slate-500">Kasus Aktif</span>
          <div className="text-2xl font-bold text-[#082A4F] mt-1">
            {cases.filter((c) => c.status !== 'CLOSED').length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white border border-amber-200 bg-amber-50/20 shadow-xs">
          <span className="text-[11px] font-medium text-amber-700">Perlu Kontak Pelanggan</span>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {cases.filter((c) => c.status === 'OPEN' || c.status === 'WAITING_CUSTOMER').length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white border border-rose-200 bg-rose-50/20 shadow-xs">
          <span className="text-[11px] font-medium text-rose-700">Tinggi / Kritis</span>
          <div className="text-2xl font-bold text-rose-600 mt-1">
            {cases.filter((c) => (c.severity === 'HIGH' || c.severity === 'CRITICAL') && c.status !== 'CLOSED').length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <span className="text-[11px] font-medium text-emerald-700">Selesai / Ditutup</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1">
            {cases.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length}
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2 sm:pb-0 sm:border-0">
            {[
              { id: 'all_active', label: 'Semua Aktif' },
              { id: 'need_contact', label: 'Perlu Kontak' },
              { id: 'payment_issues', label: 'Kendala Bayar' },
              { id: 'low_rating', label: 'Rating Rendah' },
              { id: 'waiting_manager', label: 'Menunggu Manager' },
              { id: 'resolved_closed', label: 'Tuntas' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilterTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeFilterTab === tab.id
                    ? 'bg-[#082A4F] text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Severity Dropdown */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="text-xs p-1.5 rounded-lg border border-slate-300 bg-white font-medium outline-none"
            >
              <option value="ALL">Semua Urgensi</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari berdasarkan Kode Kasus (SC-...), Kode Booking, Nama Pelanggan, atau Ringkasan..."
            className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#082A4F] outline-none"
          />
        </div>
      </div>

      {/* Cases List */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          Memuat daftar kasus operasional...
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200 space-y-2">
          <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="font-semibold text-slate-600">Tidak ada kasus yang sesuai dengan kriteria filter saat ini.</p>
          <p>Semua laporan dan komplain operasional telah tertangani dengan baik.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {(filteredCases || []).map((c) => {
            const statusBadge = getStaffCaseStatusBadge(c.status);
            const severityBadge = getCaseSeverityBadge(c.severity);

            return (
              <div
                key={c.id}
                onClick={() => setSelectedCase(c)}
                className={`p-4 rounded-2xl bg-white border transition shadow-xs hover:shadow-md cursor-pointer space-y-3 ${
                  selectedCase?.id === c.id ? 'border-[#082A4F] ring-1 ring-[#082A4F]' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#082A4F] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                      {c.caseCode}
                    </span>
                    <span className="text-xs font-semibold text-slate-600">
                      {c.category}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      • Dari: {c.source}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${severityBadge.badgeClass}`}>
                      {severityBadge.label}
                    </span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${statusBadge.badgeClass}`}>
                      {statusBadge.label}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="md:col-span-2 space-y-1">
                    <h4 className="font-bold text-slate-900 line-clamp-1">{c.summary}</h4>
                    <p className="text-slate-600 text-xs line-clamp-2">{c.description}</p>

                    {c.recovery && (
                      <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium">
                        <Gift className="w-3.5 h-3.5 text-amber-600" />
                        <span>Recovery: <strong>{c.recovery.type}</strong> ({c.recovery.status})</span>
                        {c.recovery.voucherCode && <span className="font-mono font-bold">[{c.recovery.voucherCode}]</span>}
                      </div>
                    )}
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1 text-[11px] text-slate-600">
                    <div className="flex justify-between">
                      <span>Booking:</span>
                      <strong className="text-slate-800">{c.bookingCode}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Pelanggan:</span>
                      <strong className="text-slate-800 truncate max-w-[120px]">{c.customerName}</strong>
                    </div>
                    {c.therapistName && (
                      <div className="flex justify-between">
                        <span>Terapis:</span>
                        <strong className="text-slate-800 truncate max-w-[120px]">{c.therapistName}</strong>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-500 pt-1 border-t border-slate-200/60">
                      <span>Lapor:</span>
                      <span>{new Date(c.reportedAt).toLocaleDateString('id-ID')}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom action pill bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenWhatsAppChat(c);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Chat WhatsApp</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCase(c);
                        setShowContactModal(true);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Catat Kontak</span>
                    </button>
                  </div>

                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    Buka Detail <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================= */}
      {/* DRAWER / DETAIL MODAL FOR SELECTED CASE */}
      {/* ========================================================= */}
      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 bg-[#082A4F] text-white flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold bg-white/20 px-2.5 py-0.5 rounded-md">
                    {selectedCase.caseCode}
                  </span>
                  <span className="text-xs text-slate-300">
                    {selectedCase.category}
                  </span>
                </div>
                <h3 className="font-serif font-bold text-base mt-1 line-clamp-1">
                  {selectedCase.summary}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCase(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Status & Severity Badges */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  {(() => {
                    const st = getStaffCaseStatusBadge(selectedCase.status);
                    const sv = getCaseSeverityBadge(selectedCase.severity);
                    return (
                      <>
                        <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${st.badgeClass}`}>
                          {st.label}
                        </span>
                        <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${sv.badgeClass}`}>
                          {sv.label}
                        </span>
                      </>
                    );
                  })()}
                </div>

                <div className="text-slate-500 text-[11px]">
                  Ditugaskan ke: <strong className="text-slate-800">{selectedCase.assignedRole}</strong>
                  {selectedCase.assignedStaffName && ` (${selectedCase.assignedStaffName})`}
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-b border-slate-100 pb-3">
                <button
                  type="button"
                  onClick={() => handleOpenWhatsAppChat(selectedCase)}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Hubungi Pelanggan</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowContactModal(true)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Catat Kontak</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowNoteModal(true)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Catatan Internal</span>
                </button>

                {/* Propose or Deliver Recovery */}
                {!selectedCase.recovery || selectedCase.recovery.status === 'NOT_PROPOSED' || selectedCase.recovery.status === 'REJECTED' ? (
                  <button
                    type="button"
                    onClick={() => setShowRecoveryModal(true)}
                    className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Gift className="w-3.5 h-3.5 text-amber-600" />
                    <span>Ajukan Service Recovery</span>
                  </button>
                ) : selectedCase.recovery.status === 'APPROVED' && !selectedCase.recovery.deliveredAt ? (
                  <button
                    type="button"
                    onClick={() => setShowDeliverModal(true)}
                    className="px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Sampaikan Recovery ke Pelanggan</span>
                  </button>
                ) : null}

                {/* Resolve or Close */}
                {selectedCase.status !== 'RESOLVED' && selectedCase.status !== 'CLOSED' ? (
                  <button
                    type="button"
                    onClick={() => setShowResolveModal(true)}
                    className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs ml-auto"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Selesaikan Kasus</span>
                  </button>
                ) : selectedCase.status === 'RESOLVED' ? (
                  <button
                    type="button"
                    onClick={() => handleCloseCase(selectedCase)}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs ml-auto"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Tutup Kasus Resmi</span>
                  </button>
                ) : null}
              </div>

              {/* Booking & Customer Snapshot */}
              <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="space-y-1">
                  <span className="text-slate-400 font-medium">Informasi Pelanggan</span>
                  <div className="font-bold text-slate-800">{selectedCase.customerName}</div>
                  <div className="text-slate-600">{selectedCase.customerPhone}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-400 font-medium">Informasi Reservasi</span>
                  <div className="font-bold text-slate-800">{selectedCase.bookingCode}</div>
                  <div className="text-slate-600">
                    Terapis: {selectedCase.therapistName || 'Belum ditugaskan'}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <span className="font-bold text-slate-700 block">Kronologi / Penjelasan Kendala:</span>
                <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-800 whitespace-pre-wrap">
                  {selectedCase.description}
                </div>
              </div>

              {/* Internal Notes (Confidential) */}
              {selectedCase.internalNotes && (
                <div className="space-y-1.5">
                  <span className="font-bold text-rose-700 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" /> Catatan Internal (Rahasia / Tidak Terlihat Pelanggan):
                  </span>
                  <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200 text-slate-800 whitespace-pre-wrap font-mono text-[11px]">
                    {selectedCase.internalNotes}
                  </div>
                </div>
              )}

              {/* Recovery Status Banner */}
              {selectedCase.recovery && (
                <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gift className="w-4 h-4 text-amber-600" />
                      <strong className="text-slate-800">Pemulihan Layanan (Service Recovery)</strong>
                    </div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                      Status: {selectedCase.recovery.status}
                    </span>
                  </div>

                  <p className="text-slate-700 text-xs">
                    Tipe: <strong>{selectedCase.recovery.type}</strong> — {selectedCase.recovery.description}
                  </p>

                  {selectedCase.recovery.voucherCode && (
                    <div className="p-2 bg-white rounded-lg border border-amber-200 text-amber-900 font-mono font-bold text-xs">
                      Kode Voucher Recovery: {selectedCase.recovery.voucherCode}
                    </div>
                  )}

                  {selectedCase.recovery.refundStatus !== 'NOT_REQUIRED' && (
                    <div className="p-2 bg-white rounded-lg border border-blue-200 text-blue-900 text-xs">
                      Status Refund: <strong>{selectedCase.recovery.refundStatus}</strong>
                      {selectedCase.recovery.refundAmount ? ` (Rp ${selectedCase.recovery.refundAmount.toLocaleString('id-ID')})` : ''}
                    </div>
                  )}

                  {selectedCase.recovery.deliveredAt && (
                    <div className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Disampaikan pada {new Date(selectedCase.recovery.deliveredAt).toLocaleString('id-ID')} (Hasil: {selectedCase.recovery.customerOutcome})
                    </div>
                  )}
                </div>
              )}

              {/* Resolution Banner */}
              {selectedCase.resolution && (
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <strong className="text-emerald-900">Solusi & Tindakan Korektif (Resolved)</strong>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {new Date(selectedCase.resolution.resolvedAt).toLocaleDateString('id-ID')}
                    </span>
                  </div>
                  <p className="text-slate-800 text-xs">
                    <strong>Ringkasan:</strong> {selectedCase.resolution.summary}
                  </p>
                  {selectedCase.resolution.rootCauseCategory && (
                    <div className="text-slate-600 text-xs">
                      <strong>Akar Masalah:</strong> {selectedCase.resolution.rootCauseCategory}
                    </div>
                  )}
                  {selectedCase.resolution.correctiveAction && (
                    <div className="text-slate-600 text-xs">
                      <strong>Tindakan Korektif:</strong> {selectedCase.resolution.correctiveAction}
                    </div>
                  )}
                </div>
              )}

              {/* Timeline of Events */}
              <div className="space-y-3 pt-2">
                <h4 className="font-bold text-slate-800 flex items-center gap-2">
                  <History className="w-4 h-4 text-slate-500" />
                  Jejak Kronologi Kasus (Timeline & Audit)
                </h4>

                {loadingTimeline ? (
                  <div className="py-4 text-center text-slate-400">Memuat kronologi...</div>
                ) : timelineEvents.length === 0 ? (
                  <div className="py-4 text-center text-slate-400">Belum ada aktivitas tercatat.</div>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    {(timelineEvents || []).map((evt) => (
                      <div key={evt.id} className="relative space-y-1">
                        <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-[#082A4F] ring-4 ring-white" />
                        <div className="flex items-center justify-between">
                          <strong className="text-slate-900 text-xs">{evt.summary}</strong>
                          <span className="text-[10px] text-slate-400">
                            {new Date(evt.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {evt.details && <p className="text-slate-600 text-[11px]">{evt.details}</p>}
                        <div className="text-[10px] text-slate-400">
                          Oleh: {evt.actorName} ({evt.actorRole})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: LOG CUSTOMER CONTACT */}
      {/* ========================================================= */}
      {showContactModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-[#082A4F]">Catat Kontak Pelanggan</h3>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleLogContactSubmit} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Saluran Kontak:</label>
                <select
                  value={contactChannel}
                  onChange={(e) => setContactChannel(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="whatsapp">WhatsApp Resmi</option>
                  <option value="phone">Panggilan Telepon Langsung</option>
                  <option value="in_app">Pesan In-App</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Arah Komunikasi:</label>
                <select
                  value={contactDirection}
                  onChange={(e) => setContactDirection(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="outbound">Outbound (CSS Menghubungi Pelanggan)</option>
                  <option value="inbound">Inbound (Pelanggan Menghubungi CSS)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Hasil Komunikasi:</label>
                <select
                  value={contactOutcome}
                  onChange={(e) => setContactOutcome(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="informed">Pelanggan Terinformasi / Menunggu Respons</option>
                  <option value="accepted">Pelanggan Menerima Penjelasan / Solusi</option>
                  <option value="declined">Pelanggan Menolak / Masih Tidak Puas</option>
                  <option value="pending">Belum Tersambung / Menunggu Dihubungi Kembali</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Ringkasan Pembicaraan:</label>
                <textarea
                  rows={3}
                  value={contactSummary}
                  onChange={(e) => setContactSummary(e.target.value)}
                  placeholder="Tuliskan poin penting yang disampaikan ke pelanggan..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowContactModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#082A4F] hover:bg-[#0A3663] text-white font-bold cursor-pointer"
                >
                  Simpan Catatan Kontak
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: ADD INTERNAL NOTE */}
      {/* ========================================================= */}
      {showNoteModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-[#082A4F]">Tambah Catatan Internal</h3>
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleAddNoteSubmit} className="space-y-3">
              <p className="text-slate-500 text-[11px]">
                Catatan ini hanya dapat dilihat oleh tim operasional internal (CSS, Supervisor, Manager).
              </p>
              <textarea
                rows={4}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Tuliskan investigasi, observasi lapangan, atau instruksi internal..."
                className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                required
              />

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#082A4F] hover:bg-[#0A3663] text-white font-bold cursor-pointer"
                >
                  Simpan Catatan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: PROPOSE SERVICE RECOVERY */}
      {/* ========================================================= */}
      {showRecoveryModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-[#082A4F]">Ajukan Pemulihan Layanan (Service Recovery)</h3>
              <button
                type="button"
                onClick={() => setShowRecoveryModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleProposeRecoverySubmit} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Bentuk Pemulihan Layanan:</label>
                <select
                  value={recoveryType}
                  onChange={(e) => setRecoveryType(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  {SERVICE_RECOVERY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {recoveryType.includes('Refund') && (
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Nominal Refund Manual (Rp):</label>
                  <input
                    type="number"
                    value={recoveryRefundAmount}
                    onChange={(e) => setRecoveryRefundAmount(Number(e.target.value))}
                    placeholder="Contoh: 150000"
                    className="w-full p-2.5 rounded-xl border border-slate-300"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Refund manual memerlukan review & persetujuan Manager.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Alasan & Rencana Penawaran:</label>
                <textarea
                  rows={3}
                  value={recoveryDescription}
                  onChange={(e) => setRecoveryDescription(e.target.value)}
                  placeholder="Contoh: Diskon voucher 20% untuk kompensasi keterlambatan 30 menit."
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRecoveryModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
                >
                  Ajukan ke Manager
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: DELIVER RECOVERY */}
      {/* ========================================================= */}
      {showDeliverModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-[#082A4F]">Sampaikan Recovery ke Pelanggan</h3>
              <button
                type="button"
                onClick={() => setShowDeliverModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleDeliverRecoverySubmit} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Hasil Tanggapan Pelanggan:</label>
                <select
                  value={deliverOutcome}
                  onChange={(e) => setDeliverOutcome(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  <option value="accepted">Pelanggan Menerima dengan Baik</option>
                  <option value="informed">Pelanggan Telah Diinformasikan</option>
                  <option value="declined">Pelanggan Menolak Kompensasi</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Catatan Komunikasi Penyampaian:</label>
                <textarea
                  rows={3}
                  value={deliverNote}
                  onChange={(e) => setDeliverNote(e.target.value)}
                  placeholder="Contoh: Voucher telah dikirimkan via WhatsApp dan pelanggan mengonfirmasi puas dengan penanganan."
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeliverModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold cursor-pointer"
                >
                  Tandai Telah Disampaikan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: RESOLVE CASE */}
      {/* ========================================================= */}
      {showResolveModal && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-[#082A4F]">Selesaikan Kasus (Resolve)</h3>
              <button
                type="button"
                onClick={() => setShowResolveModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleResolveCaseSubmit} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Akar Masalah (Root Cause):</label>
                <select
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                >
                  {ROOT_CAUSE_CATEGORIES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Ringkasan Solusi (Wajib):</label>
                <textarea
                  rows={2}
                  value={resolutionSummary}
                  onChange={(e) => setResolutionSummary(e.target.value)}
                  placeholder="Ringkas tindakan yang telah diambil..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Tindakan Pencegahan / Korektif:</label>
                <textarea
                  rows={2}
                  value={correctiveAction}
                  onChange={(e) => setCorrectiveAction(e.target.value)}
                  placeholder="Langkah antisipasi agar kendala tidak berulang..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowResolveModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
                >
                  Simpan Penyelesaian
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: CREATE MANUAL CASE */}
      {/* ========================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-[#082A4F]">Buat Kasus / Komplain Manual</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleCreateCaseSubmit} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Pilih Pesanan Terkait:</label>
                <select
                  value={createBookingId}
                  onChange={(e) => setCreateBookingId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                  required
                >
                  <option value="">-- Pilih Pesanan --</option>
                  {(bookings || []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bookingCode} - {b.customerName} ({b.serviceName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Kategori Kendala:</label>
                  <select
                    value={createCategory}
                    onChange={(e) => setCreateCategory(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                  >
                    {COMPLAINT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Tingkat Urgensi (Severity):</label>
                  <select
                    value={createSeverity}
                    onChange={(e) => setCreateSeverity(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Judul Ringkasan:</label>
                <input
                  type="text"
                  value={createSummary}
                  onChange={(e) => setCreateSummary(e.target.value)}
                  placeholder="Contoh: Pelanggan komplain terapis terlambat 40 menit"
                  className="w-full p-2.5 rounded-xl border border-slate-300 outline-none focus:ring-2 focus:ring-[#082A4F]"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Deskripsi Detail:</label>
                <textarea
                  rows={3}
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="Kronologi dan fakta lapangan..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Catatan Internal Awal (Opsional):</label>
                <textarea
                  rows={2}
                  value={createInternalNote}
                  onChange={(e) => setCreateInternalNote(e.target.value)}
                  placeholder="Instruksi atau catatan untuk rekan CSS / Supervisor..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 resize-none outline-none focus:ring-2 focus:ring-[#082A4F]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#082A4F] hover:bg-[#0A3663] text-white font-bold cursor-pointer"
                >
                  Buat Kasus
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
