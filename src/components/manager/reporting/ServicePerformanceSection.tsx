import React, { useState } from 'react';
import { Sparkles, Star, Clock, DollarSign, Layers } from 'lucide-react';
import { ServiceMetricsRow } from '../../../lib/reportingService';
import { formatRupiah } from '../../../lib/utils';

interface ServicePerformanceSectionProps {
  services: ServiceMetricsRow[];
  onSelectService?: (serviceName: string) => void;
}

export const ServicePerformanceSection: React.FC<ServicePerformanceSectionProps> = ({
  services = [],
  onSelectService,
}) => {
  const [durationFilter, setDurationFilter] = useState<number | 'ALL'>('ALL');

  const safeServices = services || [];
  const filteredServices = safeServices.filter((s) => {
    if (durationFilter !== 'ALL' && s.duration !== durationFilter) return false;
    return true;
  });

  const availableDurations = Array.from(new Set((safeServices || []).map((s) => s.duration))).sort((a: number, b: number) => a - b);

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-[#4B2B18] text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#B89628]" />
            Kinerja Layanan &amp; Paket Treatment
          </h3>
          <p className="text-xs text-slate-500">
            Peringkat omzet terealisasi, volume booking, dan rating kepuasan pelanggan
          </p>
        </div>

        {/* Duration Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Durasi:
          </span>
          <button
            type="button"
            onClick={() => setDurationFilter('ALL')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition ${
              durationFilter === 'ALL'
                ? 'bg-[#8B5A36] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Semua
          </button>
          {(availableDurations || []).map((dur) => (
            <button
              key={dur}
              type="button"
              onClick={() => setDurationFilter(dur)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition ${
                durationFilter === dur
                  ? 'bg-[#8B5A36] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {dur} Menit
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filteredServices.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
          Belum ada data treatment untuk filter yang dipilih.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <th className="py-2.5 px-3">Layanan / Treatment</th>
                <th className="py-2.5 px-3 text-center">Durasi</th>
                <th className="py-2.5 px-3 text-right">Total Booking</th>
                <th className="py-2.5 px-3 text-right">Selesai</th>
                <th className="py-2.5 px-3 text-right">Omzet Terealisasi</th>
                <th className="py-2.5 px-3 text-right">Rata-rata Tiket</th>
                <th className="py-2.5 px-3 text-center">Pangsa Pasar</th>
                <th className="py-2.5 px-3 text-center">Rating</th>
                <th className="py-2.5 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {(filteredServices || []).map((s, idx) => (
                <tr
                  key={`${s.serviceName}_${s.duration}_${idx}`}
                  className="hover:bg-slate-50/80 transition cursor-pointer"
                  onClick={() => onSelectService && onSelectService(s.serviceName)}
                  title="Klik untuk memfilter laporan berdasarkan treatment ini"
                >
                  <td className="py-2.5 px-3">
                    <div className="font-bold text-[#4B2B18] flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-600 text-[10px] flex items-center justify-center font-mono">
                        {idx + 1}
                      </span>
                      {s.serviceName}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                    <span className="bg-slate-100 px-2 py-0.5 rounded-md">
                      {s.duration} mnt
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700 font-semibold">
                    {s.bookingCount}
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-700 font-semibold">
                    {s.completedCount}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-[#4B2B18]">
                    {formatRupiah(s.realizedRevenue)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600">
                    {formatRupiah(s.averageTicket)}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="inline-flex items-center gap-1.5">
                      <div className="w-12 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#B89628] rounded-full"
                          style={{ width: `${Math.min(100, s.sharePct)}%` }}
                        />
                      </div>
                      <span className="font-semibold text-[11px] text-slate-700 w-8 text-right">
                        {s.sharePct}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {s.averageRating !== null ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold text-[11px]">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                        {s.averageRating}
                        <span className="text-slate-400 text-[10px]">({s.ratingCount})</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {s.isActive ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">
                        Aktif
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
                        Inactive
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
