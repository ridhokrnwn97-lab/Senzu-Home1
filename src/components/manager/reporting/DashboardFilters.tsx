import React, { useState } from 'react';
import {
  Calendar,
  Filter,
  RotateCcw,
  Building2,
  Sparkles,
  User,
  MapPin,
  CreditCard,
  CheckCircle,
  Users,
  ChevronDown,
} from 'lucide-react';
import {
  DateFilterPreset,
  ReportFilterState,
  INITIAL_REPORT_FILTER,
  getDateRangeForPreset,
} from '../../../lib/reportingService';
import { Branch, ServiceItem, Therapist, ServiceArea } from '../../../types';

interface DashboardFiltersProps {
  filters: ReportFilterState;
  onChange: (newFilters: ReportFilterState) => void;
  branches: Branch[];
  services: ServiceItem[];
  therapists: Therapist[];
  areas: ServiceArea[];
}

export const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  filters,
  onChange,
  branches = [],
  services = [],
  therapists = [],
  areas = [],
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const presets: { id: DateFilterPreset; label: string }[] = [
    { id: 'today', label: 'Hari Ini' },
    { id: 'yesterday', label: 'Kemarin' },
    { id: 'last_7_days', label: '7 Hari' },
    { id: 'last_30_days', label: '30 Hari' },
    { id: 'this_month', label: 'Bulan Ini' },
    { id: 'last_month', label: 'Bulan Lalu' },
    { id: 'custom', label: 'Kustom' },
  ];

  const handlePresetSelect = (preset: DateFilterPreset) => {
    const range = getDateRangeForPreset(preset, filters.startDate, filters.endDate);
    onChange({
      ...filters,
      datePreset: preset,
      startDate: range.startDate,
      endDate: range.endDate,
    });
  };

  const handleReset = () => {
    const range = getDateRangeForPreset(INITIAL_REPORT_FILTER.datePreset);
    onChange({
      ...INITIAL_REPORT_FILTER,
      startDate: range.startDate,
      endDate: range.endDate,
    });
  };

  const activeAdvancedCount = [
    filters.branchId !== 'ALL',
    filters.serviceId !== 'ALL',
    filters.therapistId !== 'ALL',
    filters.areaName !== 'ALL',
    filters.paymentMethod !== 'ALL',
    filters.bookingStatus !== 'ALL',
    filters.customerType !== 'ALL',
  ].filter(Boolean).length;

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3.5">
      {/* Top Row: Presets & Date Inputs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Preset Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
          <span className="text-xs font-bold text-[#4B2B18] mr-1 hidden sm:inline flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-[#B89628]" />
            Periode:
          </span>
          {(presets || []).map((p) => {
            const isSelected = filters.datePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePresetSelect(p.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition cursor-pointer ${
                  isSelected
                    ? 'bg-[#8B5A36] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-[#4B2B18]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Custom Date Pickers & Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) =>
                onChange({
                  ...filters,
                  datePreset: 'custom',
                  startDate: e.target.value,
                })
              }
              className="bg-transparent text-slate-700 font-medium text-xs focus:outline-hidden"
            />
            <span className="text-slate-400 font-medium">s/d</span>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) =>
                onChange({
                  ...filters,
                  datePreset: 'custom',
                  endDate: e.target.value,
                })
              }
              className="bg-transparent text-slate-700 font-medium text-xs focus:outline-hidden"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition ${
              showAdvanced || activeAdvancedCount > 0
                ? 'bg-[#D4AF37]/15 border-[#D4AF37] text-[#4B2B18]'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Detail</span>
            {activeAdvancedCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#8B5A36] text-white text-[10px] flex items-center justify-center font-bold">
                {activeAdvancedCount}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {(activeAdvancedCount > 0 || filters.datePreset !== 'last_30_days') && (
            <button
              type="button"
              onClick={handleReset}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition flex items-center gap-1"
              title="Reset seluruh filter"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Advanced Filters Drawer */}
      {showAdvanced && (
        <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5 animate-in fade-in slide-in-from-top-1">
          {/* Branch */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <Building2 className="w-3 h-3 text-slate-400" /> Cabang
            </label>
            <select
              value={filters.branchId}
              onChange={(e) => onChange({ ...filters, branchId: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-[#8B5A36] focus:outline-hidden"
            >
              <option value="ALL">Semua Cabang</option>
              {(branches || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Service */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-slate-400" /> Layanan
            </label>
            <select
              value={filters.serviceId}
              onChange={(e) => onChange({ ...filters, serviceId: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-[#8B5A36] focus:outline-hidden truncate"
            >
              <option value="ALL">Semua Layanan</option>
              {(services || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration} mnt)
                </option>
              ))}
            </select>
          </div>

          {/* Therapist */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <User className="w-3 h-3 text-slate-400" /> Terapis
            </label>
            <select
              value={filters.therapistId}
              onChange={(e) => onChange({ ...filters, therapistId: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-[#8B5A36] focus:outline-hidden"
            >
              <option value="ALL">Semua Terapis</option>
              {(therapists || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Area */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-slate-400" /> Area Palembang
            </label>
            <select
              value={filters.areaName}
              onChange={(e) => onChange({ ...filters, areaName: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-[#8B5A36] focus:outline-hidden"
            >
              <option value="ALL">Semua Wilayah</option>
              {(areas || []).map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Method */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <CreditCard className="w-3 h-3 text-slate-400" /> Metode Bayar
            </label>
            <select
              value={filters.paymentMethod}
              onChange={(e) => onChange({ ...filters, paymentMethod: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-[#8B5A36] focus:outline-hidden"
            >
              <option value="ALL">Semua Metode</option>
              <option value="qris">QRIS Senzu</option>
              <option value="bni">Bank BNI</option>
              <option value="mandiri">Bank Mandiri</option>
              <option value="bri">Bank BRI</option>
              <option value="cash">Tunai (Histori/Demo)</option>
            </select>
          </div>

          {/* Booking Status */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-slate-400" /> Status Booking
            </label>
            <select
              value={filters.bookingStatus}
              onChange={(e) => onChange({ ...filters, bookingStatus: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-[#8B5A36] focus:outline-hidden"
            >
              <option value="ALL">Semua Status</option>
              <option value="completed">Completed (Selesai)</option>
              <option value="confirmed">Confirmed</option>
              <option value="treatment">Treatment</option>
              <option value="on the way">On The Way</option>
              <option value="menunggu pembayaran">Menunggu Bayar</option>
              <option value="cancelled">Cancelled (Batal)</option>
            </select>
          </div>

          {/* Customer Type */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <Users className="w-3 h-3 text-slate-400" /> Tipe Customer
            </label>
            <select
              value={filters.customerType}
              onChange={(e) => onChange({ ...filters, customerType: e.target.value as any })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-[#8B5A36] focus:outline-hidden"
            >
              <option value="ALL">Semua Customer</option>
              <option value="NEW">Customer Baru</option>
              <option value="REPEAT">Repeat Customer</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
