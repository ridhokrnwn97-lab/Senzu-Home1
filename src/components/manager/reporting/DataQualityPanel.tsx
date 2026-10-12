import React from 'react';
import { ShieldAlert, CheckCircle2, AlertTriangle, Database, Info } from 'lucide-react';
import { DataQualityReport } from '../../../lib/reportingService';

interface DataQualityPanelProps {
  dataQuality: DataQualityReport;
}

export const DataQualityPanel: React.FC<DataQualityPanelProps> = ({ dataQuality }) => {
  const score = dataQuality.completenessScore ?? (dataQuality as any).overallCompletenessPct ?? 100;
  const isHealthy = score >= 90;

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              isHealthy ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}
          >
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-[#082A4F] text-base">
              Panel Kualitas &amp; Kelengkapan Data Operasional
            </h3>
            <p className="text-xs text-slate-500">
              Audit integritas catatan sistem untuk menjamin keakuratan laporan dan audit log
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${
              isHealthy
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            Skor Kelengkapan: {score}%
          </span>
        </div>
      </div>

      {/* Issues Breakdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Missing arrivedAt */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Tanpa Waktu Tiba (arrivedAt)
          </span>
          <div className="text-lg font-bold text-[#082A4F]">
            {dataQuality.missingArrivedAt ?? (dataQuality as any).missingArrivedAtCount ?? 0}
          </div>
          <span className="text-[10px] text-slate-400">Dari booking selesai dikerjakan</span>
        </div>

        {/* Missing Roster */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Terapis Tanpa Shift Roster
          </span>
          <div className="text-lg font-bold text-[#082A4F]">
            {dataQuality.therapistsMissingRoster ?? (dataQuality as any).missingRosterCount ?? 0}
          </div>
          <span className="text-[10px] text-slate-400">Perlu input jadwal di Master Roster</span>
        </div>

        {/* Missing Payment Status */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Tanpa Status Pembayaran
          </span>
          <div className="text-lg font-bold text-[#082A4F]">
            {dataQuality.missingPaymentStatus ?? (dataQuality as any).missingPaymentStatusCount ?? 0}
          </div>
          <span className="text-[10px] text-slate-400">Record tanpa kepastian lunas/pending</span>
        </div>

        {/* Missing Area */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
            Tanpa Wilayah / Area
          </span>
          <div className="text-lg font-bold text-[#082A4F]">
            {dataQuality.missingArea ?? (dataQuality as any).missingAreaCount ?? 0}
          </div>
          <span className="text-[10px] text-slate-400">Tidak terpetakan di kecamatan</span>
        </div>
      </div>

      {/* Warning Messages */}
      {(dataQuality?.warnings || []).length > 0 ? (
        <div className="space-y-1.5 pt-1">
          {(dataQuality?.warnings || []).map((w, idx) => (
            <div
              key={idx}
              className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Seluruh atribut data operasional dan keuangan pada periode ini lengkap dan memenuhi standar audit.</span>
        </div>
      )}
    </div>
  );
};
