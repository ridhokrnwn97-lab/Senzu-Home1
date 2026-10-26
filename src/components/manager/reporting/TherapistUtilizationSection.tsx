import React, { useState } from 'react';
import { User, Clock, Star, AlertCircle, CheckCircle2, ChevronRight, Activity } from 'lucide-react';
import { TherapistMetricsRow } from '../../../lib/reportingService';
import { TherapistDrilldownModal } from './TherapistDrilldownModal';
import { Booking } from '../../../types';

interface TherapistUtilizationSectionProps {
  therapists: TherapistMetricsRow[];
  bookings: Booking[];
}

export const TherapistUtilizationSection: React.FC<TherapistUtilizationSectionProps> = ({
  therapists = [],
  bookings = [],
}) => {
  const [selectedTherapist, setSelectedTherapist] = useState<TherapistMetricsRow | null>(null);

  const safeTherapists = therapists || [];

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-[#4B2B18] text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#B89628]" />
            Kapasitas &amp; Utilisasi Kerja Terapis
          </h3>
          <p className="text-xs text-slate-500">
            Beban jam kerja, utilisasi shift roster, ketepatan waktu tiba, dan kepuasan pelanggan
          </p>
        </div>
        <div className="text-[11px] text-slate-400 italic">
          *Klik baris terapis untuk melihat rincian drilldown
        </div>
      </div>

      {/* Table */}
      {safeTherapists.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
          Belum ada data terapis untuk periode ini.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <th className="py-2.5 px-3">Terapis</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Job Selesai</th>
                <th className="py-2.5 px-3 text-right">Durasi Treatment</th>
                <th className="py-2.5 px-3 text-right">Shift Roster</th>
                <th className="py-2.5 px-3 text-center">Utilisasi (%)</th>
                <th className="py-2.5 px-3 text-center">Tepat Waktu (%)</th>
                <th className="py-2.5 px-3 text-center">Waktu Tempuh</th>
                <th className="py-2.5 px-3 text-center">Rating</th>
                <th className="py-2.5 px-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {(safeTherapists || []).map((t, idx) => (
                <tr
                  key={t.therapistId}
                  onClick={() => setSelectedTherapist(t)}
                  className="hover:bg-slate-50/80 transition cursor-pointer group"
                >
                  <td className="py-2.5 px-3">
                    <div className="font-bold text-[#4B2B18] flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-mono text-[10px]">
                        {idx + 1}
                      </div>
                      <div>
                        <span>{t.therapistName}</span>
                        <span className="text-[10px] text-slate-400 block font-normal">
                          {t.gender === 'F' ? 'Wanita' : 'Pria'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {t.isActive ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">
                        Aktif
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
                        Off
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[#4B2B18] font-bold">
                    {t.jobsCompleted}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600 font-mono">
                    {t.plannedTreatmentMinutes} mnt
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600 font-mono">
                    {t.rosterDataComplete ? `${t.scheduledShiftMinutes} mnt` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {t.rosterDataComplete && t.utilizationPct !== null ? (
                      <div className="inline-flex items-center gap-1.5">
                        <div className="w-12 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              t.utilizationPct > 80
                                ? 'bg-amber-500'
                                : t.utilizationPct >= 50
                                ? 'bg-emerald-500'
                                : 'bg-blue-400'
                            }`}
                            style={{ width: `${Math.min(100, t.utilizationPct)}%` }}
                          />
                        </div>
                        <span className="font-bold text-[11px] text-slate-700 w-8 text-right">
                          {t.utilizationPct}%
                        </span>
                      </div>
                    ) : (
                      <span
                        className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded"
                        title="Roster kerja pada rentang tanggal ini belum terdata lengkap"
                      >
                        Roster Belum Lengkap
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {t.onTimeRate !== null ? (
                      <span
                        className={`font-semibold px-1.5 py-0.5 rounded text-[11px] ${
                          t.onTimeRate >= 85
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {t.onTimeRate}%
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">Belum Ada Data</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center text-slate-600 font-mono">
                    {t.avgTravelMinutes !== null ? `${t.avgTravelMinutes} mnt` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {t.averageRating !== null ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold text-[11px]">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                        {t.averageRating}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      type="button"
                      className="p-1 rounded text-slate-400 group-hover:text-[#4B2B18] group-hover:bg-slate-100 transition"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drilldown Modal */}
      {selectedTherapist && (
        <TherapistDrilldownModal
          therapistRow={selectedTherapist}
          bookings={bookings}
          onClose={() => setSelectedTherapist(null)}
        />
      )}
    </div>
  );
};
