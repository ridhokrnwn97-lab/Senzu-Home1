import React, { useState } from 'react';
import { TrendingUp, BarChart2, Calendar, Info } from 'lucide-react';
import { TrendDayData } from '../../../lib/reportingService';
import { formatRupiah, formatDateIndo } from '../../../lib/utils';

interface RevenueBookingTrendChartsProps {
  trendData: TrendDayData[];
  dateRangeLabel: string;
}

export const RevenueBookingTrendCharts: React.FC<RevenueBookingTrendChartsProps> = ({
  trendData = [],
  dateRangeLabel,
}) => {
  const [activeTab, setActiveTab] = useState<'revenue' | 'bookings'>('revenue');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const safeTrendData = trendData || [];
  const totalRevenue = safeTrendData.reduce((acc, cur) => acc + cur.realizedRevenue, 0);
  const totalBookings = safeTrendData.reduce((acc, cur) => acc + cur.totalBookings, 0);
  const totalCompleted = safeTrendData.reduce((acc, cur) => acc + cur.completedBookings, 0);
  const totalCancelled = safeTrendData.reduce((acc, cur) => acc + cur.cancelledBookings, 0);

  // Check if all zero
  const hasRevenueData = totalRevenue > 0;
  const hasBookingData = totalBookings > 0;

  // Max calculations for scaling
  const maxRevenue = Math.max(1, ...(safeTrendData || []).map((d) => d.realizedRevenue));
  const maxBookings = Math.max(1, ...(safeTrendData || []).map((d) => Math.max(d.totalBookings, d.completedBookings, d.cancelledBookings)));

  // SVG dimensions
  const chartHeight = 220;
  const chartWidth = 700;
  const paddingX = 40;
  const paddingY = 25;
  const usableWidth = chartWidth - paddingX * 2;
  const usableHeight = chartHeight - paddingY * 2;

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
      {/* Header with Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-[#4B2B18] text-base flex items-center gap-2">
            {activeTab === 'revenue' ? (
              <TrendingUp className="w-4 h-4 text-[#B89628]" />
            ) : (
              <BarChart2 className="w-4 h-4 text-[#4B2B18]" />
            )}
            {activeTab === 'revenue' ? 'Tren Omzet Terealisasi Harian' : 'Tren Volume Reservasi Harian'}
          </h3>
          <p className="text-xs text-slate-500">
            {dateRangeLabel} • {trendData.length} hari terdata dalam zona waktu WIB
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setActiveTab('revenue');
              setHoveredIndex(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
              activeTab === 'revenue'
                ? 'bg-white text-[#4B2B18] shadow-xs'
                : 'text-slate-600 hover:text-[#4B2B18]'
            }`}
          >
            Omzet (Rp)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('bookings');
              setHoveredIndex(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
              activeTab === 'bookings'
                ? 'bg-white text-[#4B2B18] shadow-xs'
                : 'text-slate-600 hover:text-[#4B2B18]'
            }`}
          >
            Volume Booking
          </button>
        </div>
      </div>

      {/* Main Chart Area */}
      {trendData.length === 0 || (activeTab === 'revenue' && !hasRevenueData) || (activeTab === 'bookings' && !hasBookingData) ? (
        <div className="h-64 flex flex-col items-center justify-center text-center p-8 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
          <Calendar className="w-10 h-10 text-slate-300 mb-2" />
          <p className="text-sm font-semibold text-slate-600">Belum ada data untuk periode ini.</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm">
            {activeTab === 'revenue'
              ? 'Tidak ada transaksi dengan status booking selesai dan pembayaran lunas pada rentang tanggal yang dipilih.'
              : 'Tidak ada aktivitas reservasi yang tercatat pada rentang tanggal yang dipilih.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Summary Pills */}
          <div className="flex items-center gap-4 text-xs font-medium flex-wrap pb-1">
            {activeTab === 'revenue' ? (
              <>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-3 h-3 rounded-sm bg-[#B89628]" />
                  <span>Total Omzet: <strong>{formatRupiah(totalRevenue)}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-500">
                  <span>Rata-rata Harian: <strong>{formatRupiah(Math.round(totalRevenue / Math.max(1, trendData.length)))}</strong></span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-3 h-3 rounded-sm bg-[#8B5A36]" />
                  <span>Booking Masuk: <strong>{totalBookings}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-3 h-3 rounded-sm bg-emerald-600" />
                  <span>Selesai: <strong>{totalCompleted}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-3 h-3 rounded-sm bg-rose-500" />
                  <span>Batal: <strong>{totalCancelled}</strong></span>
                </div>
              </>
            )}
          </div>

          {/* SVG Chart Container */}
          <div className="relative w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-auto min-w-[550px] overflow-visible"
            >
              {/* Background Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = paddingY + usableHeight * (1 - ratio);
                return (
                  <g key={ratio}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={chartWidth - paddingX}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={paddingX - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[9px] fill-slate-400 font-mono"
                    >
                      {activeTab === 'revenue'
                        ? ratio === 0
                          ? 'Rp0'
                          : ratio === 1
                          ? `${Math.round(maxRevenue / 1000)}k`
                          : `${Math.round((maxRevenue * ratio) / 1000)}k`
                        : Math.round(maxBookings * ratio)}
                    </text>
                  </g>
                );
              })}

              {/* Chart Series Bars or Areas */}
              {(safeTrendData || []).map((d, idx) => {
                const step = usableWidth / (safeTrendData.length || 1);
                const barWidth = Math.max(3, Math.min(24, step * 0.65));
                const x = paddingX + idx * step + step / 2;

                const revHeight = maxRevenue > 0 ? (d.realizedRevenue / maxRevenue) * usableHeight : 0;
                const bookHeight = maxBookings > 0 ? (d.totalBookings / maxBookings) * usableHeight : 0;
                const compHeight = maxBookings > 0 ? (d.completedBookings / maxBookings) * usableHeight : 0;
                const cancHeight = maxBookings > 0 ? (d.cancelledBookings / maxBookings) * usableHeight : 0;

                const isHovered = hoveredIndex === idx;

                return (
                  <g
                    key={d.date}
                    className="cursor-pointer transition-opacity"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Hover Highlight Column */}
                    {isHovered && (
                      <rect
                        x={x - step / 2}
                        y={paddingY}
                        width={step}
                        height={usableHeight}
                        fill="#8B5A36"
                        fillOpacity="0.04"
                      />
                    )}

                    {activeTab === 'revenue' ? (
                      /* Revenue Bar */
                      <rect
                        x={x - barWidth / 2}
                        y={paddingY + usableHeight - revHeight}
                        width={barWidth}
                        height={revHeight}
                        fill={isHovered ? '#B89628' : '#D4AF37'}
                        rx="3"
                        className="transition-all duration-150"
                      />
                    ) : (
                      /* Bookings Multi-bars */
                      <g>
                        {/* Total Created Bar */}
                        <rect
                          x={x - barWidth / 2}
                          y={paddingY + usableHeight - bookHeight}
                          width={barWidth / 2}
                          height={bookHeight}
                          fill="#8B5A36"
                          opacity={isHovered ? 1 : 0.85}
                          rx="2"
                        />
                        {/* Completed Bar */}
                        <rect
                          x={x}
                          y={paddingY + usableHeight - compHeight}
                          width={barWidth / 2}
                          height={compHeight}
                          fill="#059669"
                          opacity={isHovered ? 1 : 0.85}
                          rx="2"
                        />
                      </g>
                    )}

                    {/* Date Label on X-axis (spaced for readability) */}
                    {(trendData.length <= 15 || idx % Math.ceil(trendData.length / 10) === 0) && (
                      <text
                        x={x}
                        y={chartHeight - 6}
                        textAnchor="middle"
                        className="text-[9px] fill-slate-500 font-medium"
                      >
                        {d.dayLabel}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Interactive Tooltip Card */}
            {hoveredIndex !== null && trendData[hoveredIndex] && (
              <div
                className="absolute top-2 right-4 bg-[#8B5A36] text-white p-3 rounded-xl shadow-xl text-xs space-y-1 z-10 pointer-events-none border border-[#D4AF37]/40 min-w-[200px]"
              >
                <div className="font-bold text-[#D4AF37] border-b border-white/10 pb-1 flex items-center justify-between">
                  <span>{formatDateIndo(trendData[hoveredIndex].date)}</span>
                  <span className="font-mono text-[10px] text-slate-300">WIB</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-300">Omzet Terealisasi:</span>
                  <span className="font-bold text-white">
                    {formatRupiah(trendData[hoveredIndex].realizedRevenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Total Booking:</span>
                  <span className="font-semibold text-white">
                    {trendData[hoveredIndex].totalBookings}
                  </span>
                </div>
                <div className="flex items-center justify-between text-emerald-300">
                  <span>Selesai:</span>
                  <span className="font-semibold">
                    {trendData[hoveredIndex].completedBookings}
                  </span>
                </div>
                <div className="flex items-center justify-between text-rose-300">
                  <span>Dibatalkan:</span>
                  <span className="font-semibold">
                    {trendData[hoveredIndex].cancelledBookings}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
