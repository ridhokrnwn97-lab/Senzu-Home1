import React from 'react';
import {
  X,
  User,
  CheckCircle2,
  Clock,
  Navigation,
  Star,
  RotateCcw,
  Calendar,
  AlertTriangle,
  Award,
} from 'lucide-react';
import { TherapistMetricsRow } from '../../../lib/reportingService';
import { Booking } from '../../../types';
import { formatRupiah, formatDateIndo, formatDateTimeWIB } from '../../../lib/utils';

interface TherapistDrilldownModalProps {
  therapistRow: TherapistMetricsRow | null;
  bookings: Booking[];
  onClose: () => void;
}

export const TherapistDrilldownModal: React.FC<TherapistDrilldownModalProps> = ({
  therapistRow,
  bookings = [],
  onClose,
}) => {
  if (!therapistRow) return null;

  // Filter therapist's bookings in this period
  const safeBookings = bookings || [];
  const thBookings = safeBookings.filter(
    (b) => b.therapistId === therapistRow.therapistId || b.assignedTherapistName === therapistRow.therapistName
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#8B5A36] text-white border-b border-[#D4AF37]/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] font-bold">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  {therapistRow.therapistName}
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-white/10 text-white">
                  {therapistRow.gender === 'F' ? 'Terapis Wanita' : 'Terapis Pria'}
                </span>
                {therapistRow.isActive ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300">
                    Aktif
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-500/20 text-slate-300">
                    Off Duty
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300">
                Laporan Kinerja &amp; Kapasitas Operasional Detail (WIB)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 bg-slate-50/50 text-xs">
          {/* Top KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Jobs Completed */}
            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                Layanan Selesai
              </span>
              <div className="text-lg font-bold text-[#4B2B18]">
                {therapistRow.jobsCompleted}
              </div>
              <span className="text-[10px] text-slate-400">Total job berstatus Completed</span>
            </div>

            {/* Utilization */}
            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                Utilisasi Jam Kerja
              </span>
              <div className="text-lg font-bold text-[#4B2B18]">
                {therapistRow.rosterDataComplete && therapistRow.utilizationPct !== null ? (
                  <span className="text-emerald-700">{therapistRow.utilizationPct}%</span>
                ) : (
                  <span className="text-amber-600 text-xs font-semibold">Roster Belum Lengkap</span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">
                {therapistRow.rosterDataComplete
                  ? `${therapistRow.plannedTreatmentMinutes} / ${therapistRow.scheduledShiftMinutes} mnt`
                  : 'Perlu input jadwal di Roster'}
              </span>
            </div>

            {/* On-Time Arrival */}
            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                Ketepatan Waktu Tiba
              </span>
              <div className="text-lg font-bold text-[#4B2B18]">
                {therapistRow.onTimeRate !== null ? (
                  <span className={therapistRow.onTimeRate >= 85 ? 'text-emerald-700' : 'text-amber-700'}>
                    {therapistRow.onTimeRate}%
                  </span>
                ) : (
                  <span className="text-slate-400 text-xs">—</span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">
                {therapistRow.onTimeArrivals} tepat / {therapistRow.totalArrivalsTracked} terlacak
              </span>
            </div>

            {/* Rating */}
            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                Rating Kepuasan
              </span>
              <div className="text-lg font-bold text-[#4B2B18] flex items-center gap-1">
                {therapistRow.averageRating !== null ? (
                  <>
                    <Star className="w-4 h-4 fill-amber-400 text-amber-500" />
                    <span>{therapistRow.averageRating}</span>
                    <span className="text-xs text-slate-400 font-normal">
                      ({therapistRow.ratingCount})
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400 text-xs">Belum ada review</span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">Rata-rata ulasan customer</span>
            </div>
          </div>

          {/* Operational Efficiency Card */}
          <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
            <h4 className="font-bold text-[#4B2B18] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#B89628]" />
              Detail Ketepatan &amp; Mobilitas Terapis
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
                <span className="text-[11px] text-slate-500 block">Rata-rata Waktu Respons Terima</span>
                <span className="text-sm font-bold text-[#4B2B18]">
                  {therapistRow.avgAcceptanceMinutes !== null ? `${therapistRow.avgAcceptanceMinutes} Menit` : '—'}
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">Waktu penugasan ke konfirmasi terima</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
                <span className="text-[11px] text-slate-500 block">Rata-rata Waktu Tempuh (Travel)</span>
                <span className="text-sm font-bold text-[#4B2B18]">
                  {therapistRow.avgTravelMinutes !== null ? `${therapistRow.avgTravelMinutes} Menit` : '—'}
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">Durasi meluncur hingga tiba di lokasi</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
                <span className="text-[11px] text-slate-500 block">Riwayat Reassignment</span>
                <span className="text-sm font-bold text-[#4B2B18]">
                  {therapistRow.reassignedCount} Kali
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5">Keterlibatan operasional pergantian terapis</p>
              </div>
            </div>

            {/* Punctuality Breakdown Bar */}
            <div className="pt-2">
              <div className="flex items-center justify-between text-[11px] mb-1 font-semibold text-slate-600">
                <span>Distribusi Ketibaan Lokasi:</span>
                <span>
                  {therapistRow.earlyArrivals} Lebih Awal • {therapistRow.onTimeArrivals - therapistRow.earlyArrivals} Tepat Waktu • {therapistRow.lateArrivals} Terlambat
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full flex overflow-hidden">
                {therapistRow.totalArrivalsTracked > 0 ? (
                  <>
                    <div
                      style={{ width: `${(therapistRow.earlyArrivals / therapistRow.totalArrivalsTracked) * 100}%` }}
                      className="bg-blue-500 h-full"
                      title={`Lebih Awal: ${therapistRow.earlyArrivals}`}
                    />
                    <div
                      style={{
                        width: `${
                          ((therapistRow.onTimeArrivals - therapistRow.earlyArrivals) /
                            therapistRow.totalArrivalsTracked) *
                          100
                        }%`,
                      }}
                      className="bg-emerald-500 h-full"
                      title={`Tepat Waktu: ${therapistRow.onTimeArrivals - therapistRow.earlyArrivals}`}
                    />
                    <div
                      style={{ width: `${(therapistRow.lateArrivals / therapistRow.totalArrivalsTracked) * 100}%` }}
                      className="bg-rose-500 h-full"
                      title={`Terlambat: ${therapistRow.lateArrivals}`}
                    />
                  </>
                ) : (
                  <div className="w-full h-full bg-slate-200" />
                )}
              </div>
            </div>
          </div>

          {/* Bookings Table */}
          <div className="space-y-2">
            <h4 className="font-bold text-[#4B2B18] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#4B2B18]" />
              Daftar Reservasi yang Ditangani ({thBookings.length})
            </h4>

            {thBookings.length === 0 ? (
              <p className="text-slate-400 italic text-center p-4 bg-white rounded-xl border border-slate-200">
                Tidak ada reservasi untuk terapis ini pada filter yang dipilih.
              </p>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-2.5">Kode</th>
                      <th className="p-2.5">Tanggal &amp; Jam</th>
                      <th className="p-2.5">Treatment</th>
                      <th className="p-2.5">Customer</th>
                      <th className="p-2.5 text-center">Status</th>
                      <th className="p-2.5 text-right">Nilai (Rp)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(thBookings || []).map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/80">
                        <td className="p-2.5 font-mono font-bold text-[#4B2B18]">
                          {b.bookingCode || b.id}
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {b.scheduleDate} {b.scheduleTime}
                        </td>
                        <td className="p-2.5 font-medium text-slate-700">
                          {b.serviceNameSnapshot || b.serviceName}
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {b.customerName}
                        </td>
                        <td className="p-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              (b.status || '').toLowerCase() === 'completed'
                                ? 'bg-emerald-50 text-emerald-700'
                                : (b.status || '').toLowerCase() === 'cancelled'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="p-2.5 text-right font-semibold text-slate-700">
                          {formatRupiah(b.totalAmount || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#8B5A36] hover:bg-[#8B5A36]/90 text-white text-xs font-semibold rounded-xl transition shadow-xs"
          >
            Tutup Drilldown
          </button>
        </div>
      </div>
    </div>
  );
};
