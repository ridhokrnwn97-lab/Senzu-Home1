import React from 'react';
import { GitCommit, Clock, ArrowDown, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { FunnelStage } from '../../../lib/reportingService';

interface OperationalFunnelSectionProps {
  funnelStages: FunnelStage[];
  cancelledCount: number;
  totalBookings: number;
}

export const OperationalFunnelSection: React.FC<OperationalFunnelSectionProps> = ({
  funnelStages = [],
  cancelledCount = 0,
  totalBookings = 0,
}) => {
  const safeFunnelStages = funnelStages || [];

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-[#082A4F] text-base flex items-center gap-2">
            <GitCommit className="w-4 h-4 text-[#B89628]" />
            Funnel Operasional &amp; Analisis Bottleneck
          </h3>
          <p className="text-xs text-slate-500">
            Perjalanan reservasi dari order masuk hingga tuntas dan identifikasi waktu tunggu antar tahapan
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
            {cancelledCount} Dibatalkan ({totalBookings > 0 ? ((cancelledCount / totalBookings) * 100).toFixed(1) : 0}%)
          </span>
        </div>
      </div>

      {/* Funnel Visual Layout */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2.5">
          {(safeFunnelStages || []).map((stage, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === safeFunnelStages.length - 1;

            return (
              <div key={stage.key} className="relative">
                {/* Stage Row Card */}
                <div className="p-3 bg-slate-50/70 hover:bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition">
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <div className="w-6 h-6 rounded-full bg-[#082A4F] text-white flex items-center justify-center font-mono text-[10px] font-bold shrink-0">
                      {idx + 1}
                    </div>
                    <div>
                      <span className="font-bold text-[#082A4F] text-xs block">
                        {stage.label}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Porsi: {stage.pctOfTotal}% dari total
                      </span>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="flex-1 max-w-xs hidden md:block">
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#082A4F] rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, stage.pctOfTotal)}%` }}
                      />
                    </div>
                  </div>

                  {/* Numbers & Duration */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-right">
                      <span className="font-bold text-[#082A4F] text-sm block">
                        {stage.count}
                      </span>
                      <span className="text-[10px] text-slate-400">Reservasi</span>
                    </div>

                    {/* Wait duration badge */}
                    <div className="min-w-[120px] text-right">
                      {stage.avgWaitMin !== null ? (
                        <div>
                          <span
                            className={`inline-flex items-center gap-1 font-semibold text-[11px] px-2 py-0.5 rounded ${
                              stage.avgWaitMin > 60
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-slate-200/70 text-slate-700'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            Rata²: {stage.avgWaitMin} mnt
                          </span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            Median: {stage.medianWaitMin ?? '—'} mnt
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Transition Arrow Indicator between rows */}
                {!isLast && (
                  <div className="flex justify-center -my-1 relative z-10">
                    <div className="bg-white rounded-full p-0.5 border border-slate-200 text-slate-400 shadow-xs">
                      <ArrowDown className="w-3 h-3" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottleneck Insight Box */}
        <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200/80 text-blue-900 text-xs flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Indikator Bottleneck:</strong> Analisis durasi antar tahapan di atas menggunakan data aktual dari log status reservasi. Tahapan dengan rata-rata waktu tunggu tinggi menandakan potensi jeda konfirmasi atau persiapan lapangan yang perlu dioptimalkan oleh tim Supervisor &amp; CSS.
          </p>
        </div>
      </div>
    </div>
  );
};
