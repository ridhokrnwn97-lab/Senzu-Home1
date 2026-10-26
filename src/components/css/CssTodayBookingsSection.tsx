import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  User,
  MapPin,
  Search,
  MessageCircle,
  Eye,
  ArrowUpDown,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import { Booking } from '../../types';
import { formatRupiah } from '../../lib/utils';
import { getPaymentStatusBadgeStyle, isPaymentPaid } from '../../lib/paymentService';

interface CssTodayBookingsSectionProps {
  bookings: Booking[];
  onSelectBooking: (booking: Booking) => void;
  onOpenReschedule: (booking: Booking) => void;
  onOpenCancel: (booking: Booking) => void;
  onOpenWhatsApp: (booking: Booking) => void;
  onRefresh: () => void;
}

export const CssTodayBookingsSection: React.FC<CssTodayBookingsSectionProps> = ({
  bookings = [],
  onSelectBooking,
  onOpenReschedule,
  onOpenCancel,
  onOpenWhatsApp,
  onRefresh,
}) => {
  const [filterTab, setFilterTab] = useState<'ALL' | 'UNPAID' | 'UNASSIGNED' | 'ACTIVE' | 'COMPLETED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter today's bookings
  const todayStr = useMemo(() => {
    // Current date in WIB (UTC+7)
    const now = new Date();
    const wibOffset = 7 * 60;
    const localOffset = now.getTimezoneOffset();
    const wibDate = new Date(now.getTime() + (wibOffset + localOffset) * 60000);
    return wibDate.toISOString().split('T')[0];
  }, []);

  const todayBookings = useMemo(() => {
    return (bookings || []).filter((b) => b.scheduleDate === todayStr);
  }, [bookings, todayStr]);

  // Statistics
  const totalToday = todayBookings.length;
  const completedToday = todayBookings.filter((b) => b.status === 'Completed').length;
  const activeToday = todayBookings.filter((b) => ['Accepted', 'On The Way', 'Treatment'].includes(b.status)).length;
  const unassignedToday = todayBookings.filter((b) => !b.therapistId && !['Cancelled', 'Completed'].includes(b.status)).length;
  const unpaidToday = todayBookings.filter((b) => b.paymentStatus === 'unpaid' || b.paymentStatus === 'UNPAID').length;

  // Filtered
  const filteredBookings = useMemo(() => {
    return todayBookings
      .filter((b) => {
        if (filterTab === 'UNPAID' && !(b.paymentStatus === 'unpaid' || b.paymentStatus === 'UNPAID')) return false;
        if (filterTab === 'UNASSIGNED' && (!!b.therapistId || ['Cancelled', 'Completed'].includes(b.status))) return false;
        if (filterTab === 'ACTIVE' && !['Accepted', 'On The Way', 'Treatment'].includes(b.status)) return false;
        if (filterTab === 'COMPLETED' && b.status !== 'Completed') return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matches =
            (b.bookingCode || '').toLowerCase().includes(q) ||
            (b.customerName || '').toLowerCase().includes(q) ||
            (b.customerWhatsApp || '').includes(q) ||
            (b.area || '').toLowerCase().includes(q) ||
            (b.serviceName || '').toLowerCase().includes(q) ||
            (b.therapistName && b.therapistName.toLowerCase().includes(q));
          if (!matches) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by schedule time ascending (earliest first)
        return (a.scheduleTime || '').localeCompare(b.scheduleTime || '');
      });
  }, [todayBookings, filterTab, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Today Overview Metric Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
            Total Jadwal Hari Ini
          </div>
          <div className="text-2xl font-black text-[#4B2B18] mt-1">{totalToday}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{todayStr} (WIB)</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] text-amber-600 font-semibold uppercase tracking-wider">
            Belum Lunas
          </div>
          <div className="text-2xl font-black text-amber-600 mt-1">{unpaidToday}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Perlu konfirmasi bayar</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] text-purple-600 font-semibold uppercase tracking-wider">
            Belum Ditugaskan
          </div>
          <div className="text-2xl font-black text-purple-600 mt-1">{unassignedToday}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Antre di Supervisor</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] text-emerald-600 font-semibold uppercase tracking-wider">
            Selesai / Sedang Jalan
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-1">
            {completedToday} <span className="text-xs font-normal text-slate-400">/ {activeToday} OTW</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Progress pelayanan</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setFilterTab('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterTab === 'ALL'
                ? 'bg-[#8B5A36] text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Semua Hari Ini ({todayBookings.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('UNPAID')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterTab === 'UNPAID'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800'
            }`}
          >
            Belum Lunas ({unpaidToday})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('UNASSIGNED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterTab === 'UNASSIGNED'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-800'
            }`}
          >
            Menunggu Terapis ({unassignedToday})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('ACTIVE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterTab === 'ACTIVE'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-blue-50 hover:bg-blue-100 text-blue-800'
            }`}
          >
            Sedang Berjalan ({activeToday})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('COMPLETED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterTab === 'COMPLETED'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
            }`}
          >
            Selesai ({completedToday})
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Cari kode, nama, terapis..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36] bg-slate-50/50"
          />
        </div>
      </div>

      {/* Bookings Table / Cards */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#8B5A36] text-white uppercase text-[11px] font-semibold tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Jam (WIB)</th>
                <th className="py-3.5 px-4">Kode Booking</th>
                <th className="py-3.5 px-4">Customer & WA</th>
                <th className="py-3.5 px-4">Layanan & Total</th>
                <th className="py-3.5 px-4">Area & Lokasi</th>
                <th className="py-3.5 px-4">Pembayaran</th>
                <th className="py-3.5 px-4">Terapis</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    Tidak ada reservasi yang sesuai dengan kriteria hari ini.
                  </td>
                </tr>
              ) : (
                (filteredBookings || []).map((b) => {
                  const paymentStyle = getPaymentStatusBadgeStyle(b.paymentStatus);
                  const isPaid = isPaymentPaid(b.paymentStatus);

                  return (
                    <tr
                      key={b.id}
                      onClick={() => onSelectBooking(b)}
                      className="hover:bg-slate-50/80 transition cursor-pointer"
                    >
                      {/* Jam */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-sm text-[#4B2B18] flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{b.scheduleTime} WIB</span>
                        </div>
                      </td>

                      {/* Kode */}
                      <td className="py-3.5 px-4 font-mono font-bold text-[#4B2B18]">
                        {b.bookingCode}
                      </td>

                      {/* Customer */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{b.customerName}</div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                          <span>{b.customerWhatsApp}</span>
                        </div>
                      </td>

                      {/* Layanan & Total */}
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-800">{b.serviceName}</div>
                        <div className="text-[11px] font-bold text-slate-900 mt-0.5">
                          {formatRupiah(b.totalAmount)}
                        </div>
                      </td>

                      {/* Area */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-slate-800 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{b.area}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate" title={b.address}>
                          {b.address}
                        </div>
                      </td>

                      {/* Payment */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-lg text-[10px] border font-bold ${paymentStyle.bg} ${paymentStyle.text} ${paymentStyle.border}`}
                        >
                          {paymentStyle.label}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">{b.paymentMethod}</div>
                      </td>

                      {/* Terapis */}
                      <td className="py-3.5 px-4">
                        {b.therapistName ? (
                          <div className="font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md inline-block">
                            {b.therapistName}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">
                            Belum Ditugaskan
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            b.status === 'Completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : b.status === 'Cancelled'
                              ? 'bg-red-100 text-red-800'
                              : b.status === 'Treatment'
                              ? 'bg-pink-100 text-pink-800'
                              : b.status === 'On The Way'
                              ? 'bg-sky-100 text-sky-800'
                              : b.status === 'Confirmed'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>

                      {/* Action */}
                      <td
                        className="py-3.5 px-4 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {/* WhatsApp */}
                          <button
                            type="button"
                            onClick={() => onOpenWhatsApp(b)}
                            title="Kirim Pesan WhatsApp"
                            className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </button>

                          {/* Detail */}
                          <button
                            type="button"
                            onClick={() => onSelectBooking(b)}
                            title="Lihat Detail & Tindakan"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Reschedule */}
                          {b.status !== 'Completed' && b.status !== 'Cancelled' && (
                            <button
                              type="button"
                              onClick={() => onOpenReschedule(b)}
                              title="Reschedule Jadwal"
                              className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 transition"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
