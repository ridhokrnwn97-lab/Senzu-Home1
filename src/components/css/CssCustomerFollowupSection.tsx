import React, { useState, useMemo } from 'react';
import {
  PhoneCall,
  PhoneOff,
  AlertTriangle,
  Star,
  CheckCircle2,
  Clock,
  MessageCircle,
  ShieldAlert,
  ArrowUpRight,
  User,
  MapPin,
  Calendar,
  Search,
} from 'lucide-react';
import { Booking, CustomerReview } from '../../types';
import { cssFlagCustomerUnreachable, cssUpdateTaskStatus } from '../../lib/dbService';
import { formatRupiah } from '../../lib/utils';

interface CssCustomerFollowupSectionProps {
  bookings: Booking[];
  lowRatingReviews?: CustomerReview[];
  currentUserName: string;
  onSelectBooking: (booking: Booking) => void;
  onOpenWhatsApp: (booking: Booking, templateKey?: string) => void;
  onOpenEscalate: (booking: Booking) => void;
  onRefresh: () => void;
}

export const CssCustomerFollowupSection: React.FC<CssCustomerFollowupSectionProps> = ({
  bookings = [],
  lowRatingReviews = [],
  currentUserName,
  onSelectBooking,
  onOpenWhatsApp,
  onOpenEscalate,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'ALL' | 'UNREACHABLE' | 'LOW_RATING' | 'ESCALATED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Unreachable customers
  const unreachableBookings = useMemo(() => {
    return (bookings || []).filter(
      (b) => (b.unreachableCount || 0) > 0 && !['Completed', 'Cancelled'].includes(b.status)
    );
  }, [bookings]);

  // Escalated bookings
  const escalatedBookings = useMemo(() => {
    return (bookings || []).filter((b) => b.escalation && b.escalation.status !== 'resolved');
  }, [bookings]);

  // Handle Mark Unreachable
  const handleFlagUnreachable = async (booking: Booking) => {
    setProcessingId(booking.id);
    try {
      await cssFlagCustomerUnreachable(booking, currentUserName);
      onRefresh();
    } catch (err) {
      console.error('Failed to flag unreachable:', err);
    } finally {
      setProcessingId(null);
    }
  };

  // Handle Mark Followup Resolved
  const handleResolveTask = async (booking: Booking) => {
    setProcessingId(booking.id);
    try {
      await cssUpdateTaskStatus(booking.id, 'Resolved', currentUserName);
      onRefresh();
    } catch (err) {
      console.error('Failed to resolve task:', err);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] text-amber-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <PhoneOff className="w-3.5 h-3.5" />
            Tidak Merespon
          </div>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {unreachableBookings.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Perlu panggilan berkala</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] text-red-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-red-500 fill-red-500" />
            Service Recovery
          </div>
          <div className="text-2xl font-black text-red-600 mt-1">
            {lowRatingReviews.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Rating ≤ 2 bintang</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] text-purple-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            Eskalasi Supervisor
          </div>
          <div className="text-2xl font-black text-purple-600 mt-1">
            {escalatedBookings.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Sedang dipantau</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'ALL'
                ? 'bg-[#8B5A36] text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Semua Follow-up
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('UNREACHABLE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'UNREACHABLE'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800'
            }`}
          >
            Tidak Merespon ({unreachableBookings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('LOW_RATING')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'LOW_RATING'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-red-50 hover:bg-red-100 text-red-700'
            }`}
          >
            Rating Rendah ({lowRatingReviews.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ESCALATED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'ESCALATED'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-800'
            }`}
          >
            Eskalasi Supervisor ({escalatedBookings.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Cari kode booking, nama..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36] bg-slate-50/50"
          />
        </div>
      </div>

      {/* Content List */}
      <div className="space-y-3">
        {/* Section 1: Unreachable */}
        {(activeTab === 'ALL' || activeTab === 'UNREACHABLE') && (
          <>
            {(unreachableBookings || []).map((b) => (
              <div
                key={b.id}
                onClick={() => onSelectBooking(b)}
                className="bg-white rounded-2xl border border-amber-200 hover:border-amber-300 p-4 sm:p-5 shadow-sm transition cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                      TIDAK MERESPON #{b.unreachableCount}
                    </span>
                    <span className="font-mono font-bold text-xs text-[#4B2B18]">
                      {b.bookingCode}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      Jadwal: {b.scheduleDate} {b.scheduleTime} WIB
                    </span>
                  </div>

                  <h4 className="font-bold text-sm text-slate-900">
                    Pelanggan: {b.customerName} ({b.customerWhatsApp})
                  </h4>

                  <p className="text-xs text-slate-600">
                    Percobaan kontak terakhir:{' '}
                    {b.lastContactAttemptAt
                      ? new Date(b.lastContactAttemptAt).toLocaleTimeString('id-ID')
                      : '-'}. Di area {b.area}.
                  </p>
                </div>

                <div
                  className="flex items-center gap-2 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onOpenWhatsApp(b, 'remind_payment_urgent')}
                    className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>WhatsApp</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleFlagUnreachable(b)}
                    disabled={processingId === b.id}
                    className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold transition flex items-center gap-1"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>+1 Catat Tidak Respon</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenEscalate(b)}
                    className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition flex items-center gap-1"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Eskalasi</span>
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Section 2: Escalations */}
        {(activeTab === 'ALL' || activeTab === 'ESCALATED') && (
          <>
            {(escalatedBookings || []).map((b) => (
              <div
                key={b.id}
                onClick={() => onSelectBooking(b)}
                className="bg-white rounded-2xl border border-purple-200 hover:border-purple-300 p-4 sm:p-5 shadow-sm transition cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-purple-600 text-white text-[10px] font-bold">
                      ESKALASI: {b.escalation?.priority || 'HIGH'}
                    </span>
                    <span className="font-mono font-bold text-xs text-[#4B2B18]">
                      {b.bookingCode}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      Status: {b.escalation?.status?.toUpperCase()}
                    </span>
                  </div>

                  <h4 className="font-bold text-sm text-slate-900">
                    {b.escalation?.category || 'Kendala Operasional'} ({b.customerName})
                  </h4>

                  <p className="text-xs text-slate-600">
                    Alasan: "{b.escalation?.reason}". Dieskalasi oleh {b.escalation?.escalatedByName} pada {b.escalation?.escalatedAt ? new Date(b.escalation.escalatedAt).toLocaleTimeString('id-ID') : '-'}.
                  </p>
                </div>

                <div
                  className="flex items-center gap-2 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onSelectBooking(b)}
                    className="px-4 py-2 rounded-xl bg-[#8B5A36] text-white text-xs font-bold transition hover:bg-[#94603B]"
                  >
                    Pantau Tiket
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Section 3: Low Rating Service Recovery */}
        {(activeTab === 'ALL' || activeTab === 'LOW_RATING') && (
          <>
            {(lowRatingReviews || []).map((r) => {
              const booking = bookings.find((b) => b.id === r.bookingId || b.bookingCode === r.bookingCode);
              return (
                <div
                  key={r.id}
                  className="bg-white rounded-2xl border border-red-200 hover:border-red-300 p-4 sm:p-5 shadow-sm transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center gap-1">
                        <Star className="w-3 h-3 fill-white" />
                        {r.overallRating} Bintang
                      </span>
                      <span className="font-mono font-bold text-xs text-[#4B2B18]">
                        {r.bookingCode}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        Terapis: {r.therapistName || '-'}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm text-slate-900">
                      Pelanggan: {r.customerName}
                    </h4>

                    <p className="text-xs text-slate-600 bg-red-50 p-2.5 rounded-xl border border-red-100 italic">
                      "{r.comment}"
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {booking && (
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(booking, 'low_rating_service_recovery')}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm shadow-emerald-200"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Kirim Permohonan Maaf</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {unreachableBookings.length === 0 && escalatedBookings.length === 0 && lowRatingReviews.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <div className="font-bold text-slate-800 text-sm">Tidak Ada Kendala / Follow-up Aktif</div>
            <div className="text-xs mt-1">Semua pelanggan terhubung lancar dan tidak ada komplain yang tertunda.</div>
          </div>
        )}
      </div>
    </div>
  );
};
