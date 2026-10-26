import React, { useState, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  FileCheck,
  PhoneCall,
  UserCheck,
  ChevronRight,
  ShieldAlert,
  ArrowUpRight,
  MessageCircle,
  Calendar,
  MapPin,
  RefreshCw,
  Search,
  Filter,
  User,
  Sparkles,
} from 'lucide-react';
import { Booking } from '../../types';
import { CssWorkItem, WorkItemPriority, WorkItemCategory } from './cssHelpers';
import { cssClaimTask } from '../../lib/dbService';
import { formatRupiah } from '../../lib/utils';

interface CssWorkQueueSectionProps {
  workItems: CssWorkItem[];
  bookings: Booking[];
  currentUserId: string;
  currentUserName: string;
  onSelectBooking: (booking: Booking) => void;
  onOpenVerifyPayment: (bookingId: string) => void;
  onOpenReschedule: (booking: Booking) => void;
  onOpenAddressChange: (booking: Booking) => void;
  onOpenEscalate: (booking: Booking) => void;
  onOpenWhatsApp: (booking: Booking, templateKey?: string) => void;
  onRefresh: () => void;
}

export const CssWorkQueueSection: React.FC<CssWorkQueueSectionProps> = ({
  workItems = [],
  bookings = [],
  currentUserId,
  currentUserName,
  onSelectBooking,
  onOpenVerifyPayment,
  onOpenReschedule,
  onOpenAddressChange,
  onOpenEscalate,
  onOpenWhatsApp,
  onRefresh,
}) => {
  const [filterType, setFilterType] = useState<'ALL' | 'CRITICAL' | 'PAYMENT' | 'CUSTOMER_REQUEST' | 'FIELD_ISSUE' | 'MY_TASKS'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isClaiming, setIsClaiming] = useState<string | null>(null);

  // Filter items
  const filteredItems = useMemo(() => {
    return (workItems || []).filter((item) => {
      // Type Filter
      if (filterType === 'CRITICAL' && item.priority !== 'CRITICAL') return false;
      if (filterType === 'PAYMENT' && !item.category.startsWith('payment_') && item.category !== 'unpaid_approaching_schedule') return false;
      if (filterType === 'CUSTOMER_REQUEST' && !item.category.startsWith('customer_')) return false;
      if (filterType === 'FIELD_ISSUE' && item.category !== 'therapist_issue_reported' && item.category !== 'supervisor_escalation') return false;
      if (filterType === 'MY_TASKS' && item.ownerId !== currentUserId) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          (item.bookingCode || '').toLowerCase().includes(q) ||
          (item.customerName || '').toLowerCase().includes(q) ||
          (item.customerWhatsApp || '').includes(q) ||
          (item.area || '').toLowerCase().includes(q) ||
          (item.title || '').toLowerCase().includes(q) ||
          (item.description || '').toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [workItems, filterType, searchQuery, currentUserId]);

  // Counts
  const criticalCount = workItems.filter((i) => i.priority === 'CRITICAL').length;
  const paymentCount = workItems.filter((i) => i.category.startsWith('payment_') || i.category === 'unpaid_approaching_schedule').length;
  const requestCount = workItems.filter((i) => i.category.startsWith('customer_')).length;
  const issueCount = workItems.filter((i) => i.category === 'therapist_issue_reported' || i.category === 'supervisor_escalation').length;
  const myTaskCount = workItems.filter((i) => i.ownerId === currentUserId).length;

  const handleClaim = async (e: React.MouseEvent, item: CssWorkItem) => {
    e.stopPropagation();
    setIsClaiming(item.bookingId);
    try {
      await cssClaimTask(item.bookingId, item.bookingCode, currentUserId, currentUserName);
      onRefresh();
    } catch (err) {
      console.error('Failed to claim task:', err);
    } finally {
      setIsClaiming(null);
    }
  };

  const handlePrimaryAction = (e: React.MouseEvent, item: CssWorkItem) => {
    e.stopPropagation();
    const booking = bookings.find((b) => b.id === item.bookingId || b.bookingCode === item.bookingCode);
    if (!booking) return;

    switch (item.actionType) {
      case 'verify_payment':
        onOpenVerifyPayment(item.bookingId);
        break;
      case 'process_reschedule':
        onOpenReschedule(booking);
        break;
      case 'update_address':
        onOpenAddressChange(booking);
        break;
      case 'contact_customer':
        onOpenWhatsApp(booking);
        break;
      case 'supervisor_escalate':
        onOpenEscalate(booking);
        break;
      default:
        onSelectBooking(booking);
        break;
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner: Apa yang harus saya kerjakan sekarang? */}
      <div className="bg-gradient-to-r from-[#8B5A36] via-[#94603B] to-[#94603B] rounded-2xl p-4 sm:p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 text-[#F5DF87] text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              Operational Work Queue
            </span>
            {criticalCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/80 border border-red-400 text-white text-[10px] font-bold animate-pulse">
                {criticalCount} KRITIS
              </span>
            )}
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            Perlu Tindakan Operasional
          </h2>
          <p className="text-slate-300 text-xs sm:text-sm max-w-2xl leading-relaxed">
            Pusat kendali tindakan CSS Senzu. Daftar tugas otomatis diurutkan berdasarkan urgensi waktu jadwal, batas pembayaran, permintaan pelanggan, dan kendala terapis di lapangan.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
            title="Muat ulang antrean tugas"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Segarkan Antrean</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-3">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full lg:w-auto pb-1 lg:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
              filterType === 'ALL'
                ? 'bg-[#8B5A36] text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <span>Semua</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-white/20">
              {workItems.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterType('CRITICAL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
              filterType === 'CRITICAL'
                ? 'bg-red-600 text-white shadow-sm shadow-red-200'
                : 'bg-red-50 hover:bg-red-100 text-red-700'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
            <span>Kritis / Mendesak</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-red-200 text-red-800">
              {criticalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterType('PAYMENT')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
              filterType === 'PAYMENT'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-teal-50 hover:bg-teal-100 text-teal-800'
            }`}
          >
            <span>Pembayaran</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-teal-200 text-teal-800">
              {paymentCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterType('CUSTOMER_REQUEST')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
              filterType === 'CUSTOMER_REQUEST'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800'
            }`}
          >
            <span>Permintaan Customer</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-amber-200 text-amber-900">
              {requestCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterType('FIELD_ISSUE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
              filterType === 'FIELD_ISSUE'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-800'
            }`}
          >
            <span>Kendala / Eskalasi</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-purple-200 text-purple-900">
              {issueCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterType('MY_TASKS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
              filterType === 'MY_TASKS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-blue-50 hover:bg-blue-100 text-blue-800'
            }`}
          >
            <span>Tugas Saya</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-blue-200 text-blue-800">
              {myTaskCount}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Cari kode, nama, nomor WA..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36] bg-slate-50/50"
          />
        </div>
      </div>

      {/* Work Queue Items List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-slate-800">
              Tidak Ada Tindakan yang Diperlukan
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Semua bukti pembayaran telah diverifikasi, jadwal terkonfirmasi dengan baik, dan tidak ada eskalasi pending. Luar biasa!
            </p>
          </div>
        ) : (
          (filteredItems || []).map((item) => {
            const booking = bookings.find((b) => b.id === item.bookingId || b.bookingCode === item.bookingCode);
            const isMyTask = item.ownerId === currentUserId;

            // Priority styling
            const priorityBadge = {
              CRITICAL: 'bg-red-500 text-white border-red-600 animate-pulse',
              HIGH: 'bg-amber-500 text-white border-amber-600',
              NORMAL: 'bg-blue-600 text-white border-blue-700',
              LOW: 'bg-slate-500 text-white border-slate-600',
            }[item.priority];

            return (
              <div
                key={item.id}
                onClick={() => booking && onSelectBooking(booking)}
                className={`group bg-white rounded-2xl border p-4 sm:p-5 shadow-sm transition-all duration-200 hover:shadow-md cursor-pointer relative overflow-hidden ${
                  item.priority === 'CRITICAL'
                    ? 'border-red-300 hover:border-red-400 bg-red-50/20'
                    : item.priority === 'HIGH'
                    ? 'border-amber-200 hover:border-amber-300'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Accent line for critical */}
                {item.priority === 'CRITICAL' && (
                  <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-red-500" />
                )}

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pl-1">
                  {/* Left Column: Priority, Category, Description */}
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Priority Tag */}
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase border ${priorityBadge}`}
                      >
                        {item.priority}
                      </span>

                      {/* Category Label */}
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-bold">
                        {item.categoryLabel}
                      </span>

                      {/* Booking Code */}
                      <span className="font-mono font-bold text-xs text-[#4B2B18] bg-slate-100 px-2 py-0.5 rounded">
                        {item.bookingCode}
                      </span>

                      {/* Schedule Countdown / Clock */}
                      {item.scheduleDate && (
                        <span className="text-[11px] text-slate-500 flex items-center gap-1 font-medium">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            {item.scheduleDate} • {item.scheduleTime} WIB
                          </span>
                          {item.minutesToSchedule < 120 && item.minutesToSchedule > 0 && (
                            <span className="text-red-600 font-bold ml-1">
                              ({item.minutesToSchedule} mnt lagi)
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h4 className="text-sm sm:text-base font-bold text-slate-900 group-hover:text-[#4B2B18] transition">
                      {item.title}
                    </h4>

                    {/* Context description */}
                    <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                      {item.description}
                    </p>

                    {/* Metadata chips: Customer, WA, Area, Amount */}
                    <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap pt-1">
                      <span className="font-semibold text-slate-800 flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {item.customerName}
                      </span>
                      <span className="font-mono text-slate-600">
                        {item.customerWhatsApp}
                      </span>
                      <span className="flex items-center gap-1 text-slate-600">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {item.area}
                      </span>
                      <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                        {formatRupiah(item.totalAmount)} ({item.paymentMethod})
                      </span>

                      {item.therapistName && (
                        <span className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">
                          Terapis: {item.therapistName}
                        </span>
                      )}

                      {/* Assignment / Claim Owner */}
                      {item.ownerName ? (
                        <span className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                          <UserCheck className="w-3 h-3" />
                          Ditangani: {item.ownerName}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">
                          Belum Diambil
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex items-center gap-2 self-end lg:self-center shrink-0">
                    {/* Claim Task button if not owned */}
                    {!item.ownerId && (
                      <button
                        type="button"
                        onClick={(e) => handleClaim(e, item)}
                        disabled={isClaiming === item.bookingId}
                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition active:scale-95 flex items-center gap-1"
                        title="Ambil tugas ini sebagai penanggung jawab"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                        <span>{isClaiming === item.bookingId ? 'Memproses...' : 'Ambil Tugas'}</span>
                      </button>
                    )}

                    {/* WhatsApp Quick Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (booking) onOpenWhatsApp(booking);
                      }}
                      className="p-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition"
                      title="Kirim Pesan WhatsApp Cepat"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>

                    {/* Primary Direct Action Button */}
                    <button
                      type="button"
                      onClick={(e) => handlePrimaryAction(e, item)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition flex items-center gap-1.5 shadow-sm active:scale-95 ${
                        item.actionType === 'verify_payment'
                          ? 'bg-teal-600 hover:bg-teal-700 shadow-teal-200'
                          : item.actionType === 'process_reschedule'
                          ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200'
                          : item.actionType === 'update_address'
                          ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                          : item.actionType === 'supervisor_escalate'
                          ? 'bg-red-600 hover:bg-red-700 shadow-red-200'
                          : 'bg-[#8B5A36] hover:bg-[#94603B]'
                      }`}
                    >
                      <span>{item.actionLabel}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
