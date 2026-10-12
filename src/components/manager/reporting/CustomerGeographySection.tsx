import React from 'react';
import { MapPin, Users, DollarSign, Award, AlertCircle } from 'lucide-react';
import { AreaMetricsRow } from '../../../lib/reportingService';
import { CustomerCRM } from '../../../types/crm';
import { formatRupiah } from '../../../lib/utils';

interface CustomerGeographySectionProps {
  areas: AreaMetricsRow[];
  customers: CustomerCRM[];
  onSelectArea?: (areaName: string) => void;
}

export const CustomerGeographySection: React.FC<CustomerGeographySectionProps> = ({
  areas = [],
  customers = [],
  onSelectArea,
}) => {
  const safeAreas = areas || [];
  const safeCustomers = customers || [];

  // Aggregate CRM Segments
  const segmentCounts: Record<string, number> = {
    NEW: 0,
    ACTIVE: 0,
    REPEAT: 0,
    HIGH_VALUE: 0,
    AT_RISK: 0,
    INACTIVE: 0,
    VIP: 0,
  };

  safeCustomers.forEach((c) => {
    const seg = c.customerSegment || 'NEW';
    if (segmentCounts[seg] !== undefined) {
      segmentCounts[seg] += 1;
    } else {
      segmentCounts.NEW += 1;
    }
  });

  const totalCustomers = Math.max(1, safeCustomers.length);

  const segmentLabels: { key: string; label: string; desc: string; color: string }[] = [
    { key: 'NEW', label: 'Pelanggan Baru', desc: 'Baru pertama kali mencoba', color: 'bg-blue-500' },
    { key: 'ACTIVE', label: 'Aktif', desc: 'Rutin reservasi berkala', color: 'bg-emerald-500' },
    { key: 'REPEAT', label: 'Repeat', desc: 'Telah berkunjung ≥ 2x', color: 'bg-purple-500' },
    { key: 'HIGH_VALUE', label: 'High Value', desc: 'Pengeluaran di atas rata-rata', color: 'bg-[#B89628]' },
    { key: 'VIP', label: 'VIP Priority', desc: 'Pelanggan istimewa Senzu', color: 'bg-[#082A4F]' },
    { key: 'AT_RISK', label: 'At Risk', desc: 'Melewati siklus biasanya', color: 'bg-amber-500' },
    { key: 'INACTIVE', label: 'Tidak Aktif', desc: 'Belum booking > 60 hari', color: 'bg-slate-400' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Column 1 & 2: Top Areas in Palembang */}
      <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-[#082A4F] text-base flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#B89628]" />
              Sebaran Wilayah &amp; Kecamatan Palembang
            </h3>
            <p className="text-xs text-slate-500">
              Peringkat order, pendapatan home service fee, dan rasio pembatalan per area
            </p>
          </div>
        </div>

        {areas.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
            Belum ada data pemetaan wilayah untuk periode ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Kecamatan / Area</th>
                  <th className="py-2.5 px-3 text-right">Total Booking</th>
                  <th className="py-2.5 px-3 text-right">Selesai</th>
                  <th className="py-2.5 px-3 text-right">Omzet Terealisasi</th>
                  <th className="py-2.5 px-3 text-right">Rata² Transport</th>
                  <th className="py-2.5 px-3 text-center">Rasio Batal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(safeAreas || []).map((a, idx) => (
                  <tr
                    key={a.areaName}
                    onClick={() => onSelectArea && onSelectArea(a.areaName)}
                    className="hover:bg-slate-50/80 transition cursor-pointer"
                    title="Klik untuk memfilter laporan berdasarkan area ini"
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-[#082A4F] flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-600 text-[10px] flex items-center justify-center font-mono">
                          {idx + 1}
                        </span>
                        {a.areaName}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 font-semibold">
                      {a.bookingCount}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-700 font-semibold">
                      {a.completedCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#082A4F]">
                      {formatRupiah(a.realizedRevenue)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {formatRupiah(a.avgHomeServiceFee)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          a.cancellationRate > 15
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {a.cancellationRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Column 3: CRM Customer Segments */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-bold text-[#082A4F] text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-[#082A4F]" />
            Segmentasi Pelanggan (CRM)
          </h3>
          <p className="text-xs text-slate-500">
            Profil {customers.length} basis data customer terdaftar
          </p>
        </div>

        <div className="space-y-3">
          {(segmentLabels || []).map((seg) => {
            const count = segmentCounts[seg.key] || 0;
            const pct = +((count / totalCustomers) * 100).toFixed(1);

            return (
              <div key={seg.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${seg.color}`} />
                    <span className="font-semibold text-slate-700">{seg.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium text-slate-500">
                    <span className="font-bold text-[#082A4F]">{count}</span>
                    <span className="text-[11px]">({pct}%)</span>
                  </div>
                </div>

                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${seg.color} rounded-full`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
