import React from 'react';
import { ShieldCheck, Clock, CheckCircle2, XCircle, AlertCircle, Award } from 'lucide-react';
import { CssSlaMetrics } from '../../../lib/reportingService';

interface CssSlaPerformanceSectionProps {
  metrics: CssSlaMetrics;
}

export const CssSlaPerformanceSection: React.FC<CssSlaPerformanceSectionProps> = ({
  metrics,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-[#082A4F] text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#B89628]" />
            Kinerja Layanan Pelanggan (CSS) &amp; SLA Pembayaran
          </h3>
          <p className="text-xs text-slate-500">
            Kecepatan verifikasi bukti transfer / QRIS terhadap target SLA operasional ({metrics.targetSlaMinutes} Menit)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
              metrics.slaAchievementRate >= 90
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : metrics.slaAchievementRate >= 75
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            Pencapaian SLA: {metrics.slaAchievementRate}%
          </span>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Proofs Uploaded */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Bukti Bayar Masuk
          </span>
          <div className="text-lg font-bold text-[#082A4F]">
            {metrics.proofUploadedCount}
          </div>
          <span className="text-[10px] text-slate-400">Total berkas diunggah</span>
        </div>

        {/* Verified */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Terverifikasi Lunas
          </span>
          <div className="text-lg font-bold text-emerald-700">
            {metrics.verifiedCount}
          </div>
          <span className="text-[10px] text-slate-400">Bukti valid disetujui CSS</span>
        </div>

        {/* Rejected */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Bukti Ditolak
          </span>
          <div className="text-lg font-bold text-rose-600">
            {metrics.rejectedCount}
          </div>
          <span className="text-[10px] text-slate-400">Tidak sesuai / buram</span>
        </div>

        {/* Average Verification Time */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Rata-rata Verifikasi
          </span>
          <div className="text-lg font-bold text-[#082A4F]">
            {metrics.avgVerificationMinutes} mnt
          </div>
          <span className="text-[10px] text-slate-400">
            Median: {metrics.medianVerificationMinutes} mnt
          </span>
        </div>
      </div>

      {/* SLA Progress Bar & Breakdown */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-slate-700">Distribusi Kepatuhan SLA Verifikasi:</span>
          <span className="text-slate-500 font-normal text-[11px]">
            {metrics.withinSlaCount} Sesuai SLA (&le;{metrics.targetSlaMinutes} mnt) • {metrics.overSlaCount} Melewati SLA
          </span>
        </div>

        <div className="w-full h-3 bg-slate-100 rounded-full flex overflow-hidden">
          {metrics.withinSlaCount + metrics.overSlaCount > 0 ? (
            <>
              <div
                style={{ width: `${metrics.slaAchievementRate}%` }}
                className="bg-emerald-500 h-full transition-all duration-300"
                title={`Sesuai SLA: ${metrics.withinSlaCount}`}
              />
              <div
                style={{ width: `${100 - metrics.slaAchievementRate}%` }}
                className="bg-rose-500 h-full transition-all duration-300"
                title={`Melewati SLA: ${metrics.overSlaCount}`}
              />
            </>
          ) : (
            <div className="w-full h-full bg-slate-200" />
          )}
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
          Target SLA ditetapkan pada Pengaturan Operasional (<strong>{metrics.targetSlaMinutes} Menit</strong>). Tim CSS diharapkan segera memverifikasi bukti bayar agar status reservasi dapat dikonfirmasi dan jadwal terapis terlindungi.
        </p>
      </div>
    </div>
  );
};
