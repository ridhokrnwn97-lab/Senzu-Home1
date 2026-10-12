import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  CheckCircle,
  XCircle,
  Users,
  Award,
  MapPin,
  Calendar,
  Sparkles,
  PieChart,
  BarChart3,
  Percent
} from 'lucide-react';
import { Booking, CustomerCRM, Therapist } from '../types';
import { formatRupiah, getTodayDateWIB } from '../lib/utils';

interface ManagementDashboardProps {
  bookings: Booking[];
  customers: CustomerCRM[];
  therapists: Therapist[];
}

export const ManagementDashboard: React.FC<ManagementDashboardProps> = ({
  bookings,
  customers,
  therapists,
}) => {
  const [filterMode, setFilterMode] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const todayStr = getTodayDateWIB();
  const now = new Date();

  // Calculate start of this week (Monday)
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek - 1));
  const weekStartStr = monday.toISOString().split('T')[0];

  // Calculate start of this month in Asia/Jakarta
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;

  // Filter Bookings
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (customStart && b.scheduleDate < customStart) return false;
      if (customEnd && b.scheduleDate > customEnd) return false;

      if (!customStart && !customEnd) {
        if (filterMode === 'today') {
          return b.scheduleDate === todayStr;
        }
        if (filterMode === 'week') {
          return b.scheduleDate >= weekStartStr;
        }
        if (filterMode === 'month') {
          return b.scheduleDate >= monthStartStr;
        }
      }
      return true;
    });
  }, [bookings, filterMode, customStart, customEnd, todayStr, weekStartStr, monthStartStr]);

  // Analytics - Strict Rule: Revenue ONLY counts Completed + PAID bookings
  const totalBooking = filteredBookings.length;
  const paidCompletedBookings = filteredBookings.filter(
    (b) => b.status === 'Completed' && b.paymentStatus === 'PAID'
  );
  const completedBookings = filteredBookings.filter((b) => b.status === 'Completed');
  const cancelledBookings = filteredBookings.filter((b) => b.status === 'Cancelled');
  const totalRevenue = paidCompletedBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

  // AOV (Average Order Value) strictly on Paid Completed orders
  const aov = paidCompletedBookings.length > 0 ? Math.round(totalRevenue / paidCompletedBookings.length) : 0;

  // Repeat Customer %
  const repeatCustomerCount = customers.filter((c) => (c.totalBooking || 0) > 1).length;
  const repeatCustomerPercentage =
    customers.length > 0 ? Math.round((repeatCustomerCount / customers.length) * 100) : 0;

  // Active Therapists
  const activeTherapistsCount = therapists.filter((t) => t.status !== 'off').length;

  // Top Therapist
  const therapistFrequency: Record<string, number> = {};
  filteredBookings.forEach((b) => {
    if (b.therapistName) {
      therapistFrequency[b.therapistName] = (therapistFrequency[b.therapistName] || 0) + 1;
    }
  });
  const topTherapistEntry = Object.entries(therapistFrequency).sort((a, b) => b[1] - a[1])[0];
  const topTherapist = topTherapistEntry ? `${topTherapistEntry[0]} (${topTherapistEntry[1]} order)` : '-';

  // Top Treatment
  const treatmentFrequency: Record<string, number> = {};
  filteredBookings.forEach((b) => {
    treatmentFrequency[b.serviceName] = (treatmentFrequency[b.serviceName] || 0) + 1;
  });
  const topTreatmentEntry = Object.entries(treatmentFrequency).sort((a, b) => b[1] - a[1])[0];
  const topTreatment = topTreatmentEntry ? `${topTreatmentEntry[0]} (${topTreatmentEntry[1]} order)` : '-';

  // Top Area in Palembang
  const areaFrequency: Record<string, number> = {};
  filteredBookings.forEach((b) => {
    if (b.area) {
      areaFrequency[b.area] = (areaFrequency[b.area] || 0) + 1;
    }
  });
  const topAreaEntry = Object.entries(areaFrequency).sort((a, b) => b[1] - a[1])[0];
  const topArea = topAreaEntry ? `${topAreaEntry[0]} (${topAreaEntry[1]} order)` : '-';

  return (
    <div className="space-y-6">
      {/* Header & Date Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold font-serif text-[#082A4F] flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-[#B89628]" />
            Executive Management Dashboard
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Analisis metrik bisnis, performa terapis, dan pendapatan Senzu Home Palembang
          </p>
        </div>

        {/* Quick Filter Buttons */}
        <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              setFilterMode('today');
              setCustomStart('');
              setCustomEnd('');
            }}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterMode === 'today' && !customStart ? 'bg-[#082A4F] text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Hari Ini
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterMode('week');
              setCustomStart('');
              setCustomEnd('');
            }}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterMode === 'week' && !customStart ? 'bg-[#082A4F] text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Minggu Ini
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterMode('month');
              setCustomStart('');
              setCustomEnd('');
            }}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterMode === 'month' && !customStart ? 'bg-[#082A4F] text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Bulan Ini
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterMode('all');
              setCustomStart('');
              setCustomEnd('');
            }}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterMode === 'all' && !customStart ? 'bg-[#082A4F] text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Semua
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Revenue */}
        <div className="col-span-2 bg-gradient-to-br from-[#082A4F] to-[#0D3B6F] text-white p-5 rounded-2xl border border-[#D4AF37]/40 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold text-[#D4AF37] tracking-wider">
              Total Revenue
            </span>
            <DollarSign className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div className="my-2">
            <div className="text-2xl sm:text-3xl font-bold font-serif text-[#FDF3CD]">
              {formatRupiah(totalRevenue)}
            </div>
            <p className="text-[11px] text-slate-300">Dari {paidCompletedBookings.length} pesanan Completed & Lunas (PAID)</p>
          </div>
          <div className="text-[10px] text-emerald-300 font-semibold flex items-center gap-1">
            <span>AOV (Rata-rata Order): {formatRupiah(aov)}</span>
          </div>
        </div>

        {/* Total Bookings */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Total Booking</span>
            <ShoppingBag className="w-4 h-4 text-[#082A4F]" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-[#082A4F]">{totalBooking}</div>
          </div>
          <div className="text-[10px] text-slate-400">Periode terpilih</div>
        </div>

        {/* Completed */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Completed</span>
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-emerald-700">{completedBookings.length}</div>
          </div>
          <div className="text-[10px] text-emerald-600 font-semibold">
            {totalBooking > 0 ? Math.round((completedBookings.length / totalBooking) * 100) : 0}% Sukses
          </div>
        </div>

        {/* Cancelled */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Cancelled</span>
            <XCircle className="w-4 h-4 text-red-500" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-red-700">{cancelledBookings.length}</div>
          </div>
          <div className="text-[10px] text-slate-400">Tingkat pembatalan</div>
        </div>

        {/* Repeat Customer % */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Repeat Cust %</span>
            <Percent className="w-4 h-4 text-[#B89628]" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-[#B89628]">{repeatCustomerPercentage}%</div>
          </div>
          <div className="text-[10px] text-slate-400">Dari {customers.length} data CRM</div>
        </div>
      </div>

      {/* Top Performers Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top Therapist */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-[#B89628] flex items-center justify-center flex-shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Top Therapist
            </span>
            <div className="text-sm sm:text-base font-bold text-[#082A4F]">{topTherapist}</div>
            <p className="text-[11px] text-slate-500">
              Total {therapists.length} terapis aktif terdaftar
            </p>
          </div>
        </div>

        {/* Top Treatment */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-[#082A4F] flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Top Treatment
            </span>
            <div className="text-sm sm:text-base font-bold text-[#082A4F]">{topTreatment}</div>
            <p className="text-[11px] text-slate-500">Layanan paling diminati keluarga</p>
          </div>
        </div>

        {/* Top Area */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Top Area Palembang
            </span>
            <div className="text-sm sm:text-base font-bold text-[#082A4F] truncate max-w-[200px]">
              {topArea}
            </div>
            <p className="text-[11px] text-slate-500">Kecamatan order terpadat</p>
          </div>
        </div>
      </div>

      {/* Visual Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Treatment Distribution */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[#082A4F] flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#B89628]" />
            Distribusi Layanan Treatment
          </h3>

          <div className="space-y-3">
            {Object.entries(treatmentFrequency).length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">Belum ada pesanan pada filter ini.</p>
            ) : (
              Object.entries(treatmentFrequency).map(([name, count]) => {
                const pct = Math.round((count / (totalBooking || 1)) * 100);
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold text-slate-700">
                      <span>{name}</span>
                      <span>{count} Order ({pct}%)</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#082A4F] to-[#D4AF37] rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Palembang Area Distribution */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[#082A4F] flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#B89628]" />
            Distribusi Wilayah Palembang
          </h3>

          <div className="space-y-3">
            {Object.entries(areaFrequency).length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">Belum ada pesanan pada filter ini.</p>
            ) : (
              Object.entries(areaFrequency).slice(0, 5).map(([areaName, count]) => {
                const pct = Math.round((count / (totalBooking || 1)) * 100);
                return (
                  <div key={areaName} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold text-slate-700">
                      <span className="truncate max-w-[200px]">{areaName}</span>
                      <span>{count} Order ({pct}%)</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-600 to-teal-600 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
