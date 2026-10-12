import React from 'react';
import {
  DollarSign,
  CalendarCheck,
  CheckCircle2,
  Users,
  UserPlus,
  Repeat,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import { TopKpiMetrics } from '../../../lib/reportingService';
import { formatRupiah } from '../../../lib/utils';

interface DashboardTopKpiProps {
  metrics: TopKpiMetrics;
  onDrilldown?: (categoryKey: string) => void;
  onOpenDefinitions?: () => void;
}

export const DashboardTopKpi: React.FC<DashboardTopKpiProps> = ({
  metrics,
  onDrilldown,
  onOpenDefinitions,
}) => {
  const renderComparisonBadge = (val: number | null) => {
    if (val === null || isNaN(val)) {
      return (
        <span className="text-[11px] font-medium text-slate-400 inline-flex items-center gap-0.5">
          <Minus className="w-3 h-3" /> vs periode lalu
        </span>
      );
    }
    if (val > 0) {
      return (
        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
          <ArrowUpRight className="w-3 h-3" /> +{val}%
        </span>
      );
    }
    if (val < 0) {
      return (
        <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
          <ArrowDownRight className="w-3 h-3" /> {val}%
        </span>
      );
    }
    return (
      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
        0.0%
      </span>
    );
  };

  const cards = [
    {
      id: 'kpi-realized-revenue',
      title: 'Omzet Terealisasi',
      value: formatRupiah(metrics.realizedRevenue),
      subtext: `Nilai Pipeline: ${formatRupiah(metrics.bookingValue)}`,
      badge: renderComparisonBadge(metrics.revenueGrowthPct),
      icon: DollarSign,
      iconBg: 'bg-[#B89628]/15 text-[#8C6D1F]',
      borderHover: 'hover:border-[#D4AF37]',
      drilldownKey: 'sales',
      tooltip: 'Booking Selesai & Lunas',
    },
    {
      id: 'kpi-total-bookings',
      title: 'Total Booking',
      value: metrics.totalBookings.toLocaleString('id-ID'),
      subtext: 'Seluruh reservasi terdaftar',
      badge: renderComparisonBadge(metrics.bookingsGrowthPct),
      icon: CalendarCheck,
      iconBg: 'bg-[#082A4F]/10 text-[#082A4F]',
      borderHover: 'hover:border-[#082A4F]/40',
      drilldownKey: 'sales',
      tooltip: 'Semua status booking',
    },
    {
      id: 'kpi-completed-bookings',
      title: 'Booking Selesai',
      value: metrics.completedBookings.toLocaleString('id-ID'),
      subtext: `${metrics.totalBookings > 0 ? ((metrics.completedBookings / metrics.totalBookings) * 100).toFixed(1) : 0}% penyelesaian`,
      badge: renderComparisonBadge(metrics.completedGrowthPct),
      icon: CheckCircle2,
      iconBg: 'bg-emerald-50 text-emerald-600',
      borderHover: 'hover:border-emerald-400',
      drilldownKey: 'sales',
      tooltip: 'Status Completed',
    },
    {
      id: 'kpi-unique-customers',
      title: 'Customer Unik',
      value: metrics.uniqueCustomers.toLocaleString('id-ID'),
      subtext: 'Pelanggan aktif berinteraksi',
      badge: null,
      icon: Users,
      iconBg: 'bg-blue-50 text-blue-600',
      borderHover: 'hover:border-blue-400',
      drilldownKey: 'customer',
      tooltip: 'Jumlah entitas pelanggan',
    },
    {
      id: 'kpi-new-customers',
      title: 'Customer Baru',
      value: metrics.newCustomers.toLocaleString('id-ID'),
      subtext: 'Pertama kali selesai di periode ini',
      badge: null,
      icon: UserPlus,
      iconBg: 'bg-indigo-50 text-indigo-600',
      borderHover: 'hover:border-indigo-400',
      drilldownKey: 'customer',
      tooltip: 'First treatment in period',
    },
    {
      id: 'kpi-repeat-customers',
      title: 'Repeat Customer',
      value: metrics.repeatCustomers.toLocaleString('id-ID'),
      subtext: `Repeat Rate: ${metrics.repeatRate}%`,
      badge: (
        <span className="text-[11px] font-semibold text-[#082A4F] bg-[#082A4F]/10 px-1.5 py-0.5 rounded">
          {metrics.repeatRate}% loyal
        </span>
      ),
      icon: Repeat,
      iconBg: 'bg-purple-50 text-purple-600',
      borderHover: 'hover:border-purple-400',
      drilldownKey: 'customer',
      tooltip: 'Pelanggan dengan ≥2 treatment',
    },
    {
      id: 'kpi-aov',
      title: 'Average Order Value (AOV)',
      value: formatRupiah(metrics.averageOrderValue),
      subtext: 'Rata-rata belanja per booking lunas',
      badge: renderComparisonBadge(metrics.aovGrowthPct),
      icon: TrendingUp,
      iconBg: 'bg-amber-50 text-amber-700',
      borderHover: 'hover:border-amber-400',
      drilldownKey: 'sales',
      tooltip: 'Omzet ÷ Booking Lunas',
    },
    {
      id: 'kpi-cancellation-rate',
      title: 'Cancellation Rate',
      value: `${metrics.cancellationRate}%`,
      subtext: `${metrics.cancelledBookings} pesanan dibatalkan`,
      badge: (
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${metrics.cancellationRate > 10 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
          {metrics.cancelledBookings} batal
        </span>
      ),
      icon: AlertCircle,
      iconBg: metrics.cancellationRate > 10 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600',
      borderHover: 'hover:border-rose-400',
      drilldownKey: 'cancellation',
      tooltip: 'Cancelled ÷ Total Bookings',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#082A4F]">
          Ringkasan Indikator Kinerja Utama (Executive KPI)
        </h3>
        {onOpenDefinitions && (
          <button
            type="button"
            onClick={onOpenDefinitions}
            className="text-xs text-[#082A4F] hover:text-[#B89628] font-semibold flex items-center gap-1 transition"
          >
            <span>Definisi Metrik</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {(cards || []).map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.id}
              id={c.id}
              onClick={() => onDrilldown && onDrilldown(c.drilldownKey)}
              role="button"
              tabIndex={0}
              className={`p-4 bg-white rounded-xl border border-slate-200/90 shadow-xs cursor-pointer transition-all duration-200 ${c.borderHover} hover:shadow-md group relative overflow-hidden`}
              title={`${c.title}: ${c.tooltip}. Klik untuk melihat rincian laporan.`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-500 leading-snug line-clamp-1">
                  {c.title}
                </span>
                <div className={`p-2 rounded-lg shrink-0 ${c.iconBg} transition-transform group-hover:scale-110`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xl font-bold text-[#082A4F] tracking-tight truncate">
                  {c.value}
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                  <span className="text-slate-500 truncate text-[11px]">
                    {c.subtext}
                  </span>
                  {c.badge}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
