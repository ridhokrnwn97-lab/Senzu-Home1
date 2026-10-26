import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Calendar,
  Clock,
  UserCheck,
  Sparkles,
  MapPin,
  Lock,
  ChevronRight,
  Eye,
  RefreshCw,
  Phone,
  MessageCircle,
  AlertTriangle,
  CheckCircle2,
  Car,
  MoreVertical,
  SlidersHorizontal,
  LayoutGrid,
  Table as TableIcon,
} from 'lucide-react';
import { Booking, Therapist, TherapistLocation, PALEMBANG_AREAS } from '../../types';
import { isPaymentPaid, getPaymentStatusBadgeStyle } from '../../lib/paymentService';
import { OperationsFilterType } from './SupervisorKpiSummary';

interface SupervisorOperationsTableProps {
  bookings: Booking[];
  therapists: Therapist[];
  activeLocations: Record<string, TherapistLocation>;
  activeFilter: OperationsFilterType;
  onFilterChange: (filter: OperationsFilterType) => void;
  onOpenBookingDetail: (booking: Booking) => void;
  onOpenAssignModal: (booking: Booking) => void;
  onOpenOverrideModal: (booking: Booking) => void;
}

export const SupervisorOperationsTable: React.FC<SupervisorOperationsTableProps> = ({
  bookings = [],
  therapists = [],
  activeLocations = {},
  activeFilter,
  onFilterChange,
  onOpenBookingDetail,
  onOpenAssignModal,
  onOpenOverrideModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<'TODAY' | 'TOMORROW' | 'ALL'>('TODAY');
  const [onlyAtRisk, setOnlyAtRisk] = useState(false);
  const [viewMode, setViewMode] = useState<'TABLE' | 'CARDS'>('TABLE');

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Helper for Punctuality & Time calculations
  const calculateTimingState = (b: Booking) => {
    const now = new Date();
    const nowMillis = now.getTime();

    let scheduleMillis = 0;
    if (b.scheduleDate && b.scheduleTime) {
      const [hh, mm] = b.scheduleTime.split(':').map((v) => parseInt(v, 10));
      const sched = new Date(`${b.scheduleDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`);
      scheduleMillis = sched.getTime();
    }

    const diffMinutes = scheduleMillis ? Math.round((scheduleMillis - nowMillis) / 60000) : 999;
    const isToday = b.scheduleDate === todayStr;

    // Late risk check
    const isLateRisk =
      isToday &&
      ['Confirmed', 'Therapist Assigned', 'Accepted'].includes(b.status) &&
      diffMinutes <= 35;

    // ETA check if On The Way
    const therapistLoc = b.therapistId ? activeLocations[b.therapistId] : null;

    return {
      diffMinutes,
      isToday,
      isLateRisk,
      therapistLoc,
    };
  };

  // Filtered List
  const filteredBookings = useMemo(() => {
    return (bookings || []).filter((b) => {
      // Date Filter
      if (dateFilter === 'TODAY' && b.scheduleDate !== todayStr) return false;
      if (dateFilter === 'TOMORROW' && b.scheduleDate !== tomorrowStr) return false;

      // Area Filter
      if (selectedArea !== 'ALL' && b.area !== selectedArea) return false;

      // Risk Filter
      const timing = calculateTimingState(b);
      if (onlyAtRisk && !timing.isLateRisk && !b.issueReport) return false;

      // KPI/Status Filter
      const isPaid = isPaymentPaid(b.paymentStatus);
      const isTerminal = ['Completed', 'Cancelled'].includes(b.status);

      switch (activeFilter) {
        case 'TODAY':
          if (b.scheduleDate !== todayStr) return false;
          break;
        case 'ACTIVE':
          if (isTerminal) return false;
          break;
        case 'UNASSIGNED':
          if (b.therapistId || !isPaid || isTerminal) return false;
          break;
        case 'ASSIGNED':
          if (!['Therapist Assigned', 'Accepted'].includes(b.status)) return false;
          break;
        case 'OTW':
          if (b.status !== 'On The Way') return false;
          break;
        case 'TREATMENT':
          if (!['Arrived', 'Treatment'].includes(b.status)) return false;
          break;
        case 'COMPLETED':
          if (b.status !== 'Completed') return false;
          break;
        case 'UNPAID':
          if (isPaid || isTerminal) return false;
          break;
        case 'RISK':
          if (!timing.isLateRisk && !b.issueReport) return false;
          break;
        case 'ALL':
        default:
          break;
      }

      // Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesCode = b.bookingCode?.toLowerCase().includes(query);
        const matchesCust = b.customerName?.toLowerCase().includes(query);
        const matchesPhone = b.customerWhatsApp?.toLowerCase().includes(query);
        const matchesTh = b.therapistName?.toLowerCase().includes(query);
        const matchesArea = b.area?.toLowerCase().includes(query);
        const matchesService = b.serviceName?.toLowerCase().includes(query);

        if (!matchesCode && !matchesCust && !matchesPhone && !matchesTh && !matchesArea && !matchesService) {
          return false;
        }
      }

      return true;
    });
  }, [bookings, activeFilter, dateFilter, selectedArea, onlyAtRisk, searchQuery, todayStr, tomorrowStr]);

  // Helper for Status Badge
  const getStatusBadge = (status: Booking['status']) => {
    switch (status) {
      case 'Completed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Treatment':
        return 'bg-teal-100 text-teal-800 border-teal-300';
      case 'Arrived':
        return 'bg-cyan-100 text-cyan-800 border-cyan-300';
      case 'On The Way':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'Accepted':
        return 'bg-indigo-100 text-indigo-800 border-indigo-300';
      case 'Therapist Assigned':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'Confirmed':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'Cancelled':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-4 sm:p-5">
      {/* Control Bar: Filters, Search, Date & View Modes */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari kode booking, pelanggan, terapis, no WA, area..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36] focus:border-[#8B5A36] bg-slate-50/60 font-medium"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Selector */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setDateFilter('TODAY')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                dateFilter === 'TODAY' ? 'bg-[#8B5A36] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hari Ini
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('TOMORROW')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                dateFilter === 'TOMORROW' ? 'bg-[#8B5A36] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Besok
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                dateFilter === 'ALL' ? 'bg-[#8B5A36] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua
            </button>
          </div>

          {/* Area Selector */}
          <select
            value={selectedArea}
            onChange={(e) => setSelectedArea(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium bg-white focus:ring-2 focus:ring-[#8B5A36]"
          >
            <option value="ALL">Semua Area Palembang</option>
            {PALEMBANG_AREAS.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>

          {/* Risk Toggle */}
          <button
            type="button"
            onClick={() => setOnlyAtRisk(!onlyAtRisk)}
            className={`px-3 py-2 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              onlyAtRisk
                ? 'bg-rose-50 border-rose-300 text-rose-700 shadow-xs'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            <span>Risiko Terlambat</span>
          </button>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setViewMode('TABLE')}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'TABLE' ? 'bg-[#8B5A36] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Tampilan Tabel"
            >
              <TableIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('CARDS')}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'CARDS' ? 'bg-[#8B5A36] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Tampilan Kartu"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Active Filter Indicator */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span>Menampilkan <strong>{filteredBookings.length}</strong> pesanan</span>
          {activeFilter !== 'ALL' && (
            <span className="px-2 py-0.5 rounded-full bg-[#8B5A36]/10 text-[#4B2B18] font-bold text-[10px]">
              Filter: {activeFilter}
            </span>
          )}
        </div>

        {activeFilter !== 'ALL' && (
          <button
            type="button"
            onClick={() => onFilterChange('ALL')}
            className="text-[#4B2B18] hover:underline font-semibold text-[11px] cursor-pointer"
          >
            Reset Semua Filter
          </button>
        )}
      </div>

      {/* Table Mode */}
      {viewMode === 'TABLE' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#8B5A36] text-white uppercase text-[11px] font-semibold tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Jadwal & Jam</th>
                <th className="py-3.5 px-4">Kode & Layanan</th>
                <th className="py-3.5 px-4">Customer & Lokasi</th>
                <th className="py-3.5 px-4">Pembayaran</th>
                <th className="py-3.5 px-4">Status Order</th>
                <th className="py-3.5 px-4">Terapis</th>
                <th className="py-3.5 px-4">Ketepatan Waktu</th>
                <th className="py-3.5 px-4 text-center">Aksi Cepat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="max-w-xs mx-auto space-y-2">
                      <Clock className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="font-semibold text-slate-600">Tidak ada order pada kriteria ini</p>
                      <p className="text-[11px] text-slate-400">
                        Coba sesuaikan filter status, tanggal, atau kata kunci pencarian Anda.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                (filteredBookings || []).map((b) => {
                  const isPaid = isPaymentPaid(b.paymentStatus);
                  const payBadge = getPaymentStatusBadgeStyle(b.paymentStatus);
                  const timing = calculateTimingState(b);
                  const isTerminal = ['Completed', 'Cancelled'].includes(b.status);

                  return (
                    <tr
                      key={b.id}
                      className={`hover:bg-slate-50/90 transition ${
                        timing.isLateRisk ? 'bg-rose-50/40' : b.issueReport ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      {/* Schedule */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{b.scheduleDate}</div>
                        <div className="text-[11px] font-mono text-[#4B2B18] font-bold">
                          {b.scheduleTime} WIB
                        </div>
                        {timing.isToday && !isTerminal && (
                          <span
                            className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${
                              timing.diffMinutes < 0
                                ? 'bg-rose-100 text-rose-800'
                                : timing.diffMinutes <= 45
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {timing.diffMinutes < 0
                              ? `Lewat ${Math.abs(timing.diffMinutes)}m`
                              : `${timing.diffMinutes}m lagi`}
                          </span>
                        )}
                      </td>

                      {/* Code & Service */}
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-[#4B2B18] flex items-center gap-1.5">
                          <span>{b.bookingCode}</span>
                          {b.issueReport && (
                            <span
                              className="w-2 h-2 rounded-full bg-rose-500"
                              title="Terapis melaporkan kendala"
                            ></span>
                          )}
                        </div>
                        <div className="text-[11px] font-medium text-slate-700">{b.serviceName}</div>
                        <div className="text-[10px] text-slate-400">
                          {b.serviceDuration} Menit • Rp {b.totalAmount.toLocaleString('id-ID')}
                        </div>
                      </td>

                      {/* Customer & Area */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{b.customerName}</div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{b.customerWhatsApp}</span>
                        </div>
                        <div className="text-[10px] text-slate-600 font-medium truncate max-w-xs mt-0.5">
                          {b.area}
                        </div>
                        {b.genderPreference && b.genderPreference !== 'Bebas' && (
                          <div className="text-[9px] text-[#4B2B18] font-bold">
                            Pref: {b.genderPreference}
                          </div>
                        )}
                      </td>

                      {/* Payment */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-[10px] border font-bold ${payBadge.bg} ${payBadge.text} ${payBadge.border}`}
                        >
                          {payBadge.label}
                        </span>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {b.paymentMethod}
                        </div>
                      </td>

                      {/* Order Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusBadge(
                            b.status
                          )}`}
                        >
                          {b.status}
                        </span>
                        {b.internalNotes && (
                          <div className="text-[9px] text-slate-500 italic mt-0.5 max-w-[120px] truncate" title={b.internalNotes}>
                            Note: {b.internalNotes}
                          </div>
                        )}
                      </td>

                      {/* Therapist */}
                      <td className="py-3 px-4">
                        {b.therapistName ? (
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                              <span>{b.therapistName}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Terapis Ditugaskan
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className="text-[11px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              Belum Ditugaskan
                            </span>
                            {!isPaid && (
                              <div className="text-[9px] text-slate-400 mt-0.5">
                                Menunggu Verif Bayar
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Timing & ETA */}
                      <td className="py-3 px-4">
                        {timing.isLateRisk ? (
                          <div className="flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>Risiko Terlambat</span>
                          </div>
                        ) : b.status === 'On The Way' ? (
                          <div className="flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                            <Car className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" />
                            <span>Dalam Perjalanan</span>
                          </div>
                        ) : b.status === 'Treatment' ? (
                          <div className="flex items-center gap-1 text-[11px] font-bold text-teal-800 bg-teal-50 px-2 py-1 rounded-lg border border-teal-200">
                            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>Sedang Berjalan</span>
                          </div>
                        ) : b.status === 'Completed' ? (
                          <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-800">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Tepat Waktu</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">Sesuai Jadwal</span>
                        )}
                      </td>

                      {/* Quick Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Detail Drawer */}
                          <button
                            type="button"
                            onClick={() => onOpenBookingDetail(b)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition cursor-pointer"
                            title="Buka Detail Order"
                          >
                            <Eye className="w-4 h-4 text-[#4B2B18]" />
                          </button>

                          {/* Assign / Reassign Button */}
                          {!isTerminal && (
                            <button
                              type="button"
                              onClick={() => onOpenAssignModal(b)}
                              disabled={!isPaid}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                                !isPaid
                                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                                  : b.therapistId
                                  ? 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200'
                                  : 'bg-[#8B5A36] text-white hover:bg-[#94603B] shadow-2xs'
                              }`}
                              title={
                                !isPaid
                                  ? 'Pembayaran belum terverifikasi'
                                  : b.therapistId
                                  ? 'Ganti Terapis (Reassign)'
                                  : 'Tugaskan Terapis (Assign)'
                              }
                            >
                              <UserCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
                              <span>{b.therapistId ? 'Ganti' : 'Tugaskan'}</span>
                            </button>
                          )}

                          {/* Override button */}
                          {!isTerminal && (
                            <button
                              type="button"
                              onClick={() => onOpenOverrideModal(b)}
                              className="p-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 transition cursor-pointer"
                              title="Override Status Operasional"
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>
                          )}

                          {/* Quick WhatsApp */}
                          <a
                            href={`https://wa.me/${b.customerWhatsApp.replace(/\D/g, '')}?text=Halo%20${encodeURIComponent(b.customerName)},%20kami%20dari%20Supervisor%20Senzu%20Home%20mengenai%20pesanan%20${b.bookingCode}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition cursor-pointer"
                            title="Hubungi WhatsApp Pelanggan"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Cards Mode (Responsive Mobile-Friendly) */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredBookings.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-400">
              Tidak ada order pada filter ini.
            </div>
          ) : (
            (filteredBookings || []).map((b) => {
              const isPaid = isPaymentPaid(b.paymentStatus);
              const payBadge = getPaymentStatusBadgeStyle(b.paymentStatus);
              const timing = calculateTimingState(b);
              const isTerminal = ['Completed', 'Cancelled'].includes(b.status);

              return (
                <div
                  key={b.id}
                  className={`p-4 rounded-2xl border transition shadow-xs flex flex-col justify-between gap-3 bg-white ${
                    timing.isLateRisk ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div>
                        <div className="font-mono font-bold text-sm text-[#4B2B18]">
                          {b.bookingCode}
                        </div>
                        <div className="text-xs font-semibold text-slate-800 mt-0.5">
                          {b.serviceName}
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadge(
                            b.status
                          )}`}
                        >
                          {b.status}
                        </span>
                        <div className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">
                          {b.scheduleTime} WIB
                        </div>
                      </div>
                    </div>

                    <div className="text-xs space-y-1 text-slate-600">
                      <div>
                        Cust: <strong>{b.customerName}</strong> ({b.customerWhatsApp})
                      </div>
                      <div className="truncate">
                        Area: <strong>{b.area}</strong>
                      </div>
                      {b.genderPreference && b.genderPreference !== 'Bebas' && (
                        <div className="text-[11px] text-[#4B2B18] font-bold">
                          Preferensi Terapis: {b.genderPreference}
                        </div>
                      )}
                    </div>

                    {/* Therapist Info */}
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            b.therapistName ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        ></span>
                        <span className="font-semibold text-slate-800">
                          {b.therapistName || 'Belum Ditugaskan'}
                        </span>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${payBadge.bg} ${payBadge.text} ${payBadge.border}`}
                      >
                        {payBadge.label}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => onOpenBookingDetail(b)}
                      className="flex-1 py-2 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-[#4B2B18] transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Detail</span>
                    </button>

                    {!isTerminal && (
                      <button
                        type="button"
                        onClick={() => onOpenAssignModal(b)}
                        disabled={!isPaid}
                        className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                          !isPaid
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            : 'bg-[#8B5A36] text-white hover:bg-[#94603B] shadow-xs'
                        }`}
                      >
                        <UserCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>{b.therapistId ? 'Ganti' : 'Assign'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
