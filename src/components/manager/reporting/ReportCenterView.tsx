import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Search,
  Filter,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Calendar,
  DollarSign,
  User,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Building2,
} from 'lucide-react';
import {
  ReportCategoryKey,
  ReportFilterState,
  INITIAL_REPORT_FILTER,
  filterBookings,
  computeTopKpiMetrics,
  computeServiceMetrics,
  computeTherapistMetrics,
  computeAreaMetrics,
  computePaymentMetrics,
  computeCssSlaMetrics,
  computeRatingMetrics,
  computeFunnelStages,
  computeDataQualityReport,
  exportReportToExcel,
  getDateRangeForPreset,
  ExportReportType,
} from '../../../lib/reportingService';
import {
  Booking,
  ServiceItem,
  Therapist,
  Branch,
  ServiceArea,
  OperationalSettings,
} from '../../../types';
import { CustomerCRM, CustomerReview } from '../../../types/crm';
import { TherapistRoster } from '../../../types/roster';
import { DashboardFilters } from './DashboardFilters';
import { BookingDetailDrawer } from './BookingDetailDrawer';
import { MetricDefinitionsModal } from './MetricDefinitionsModal';
import { formatRupiah, formatDateTimeWIB } from '../../../lib/utils';

interface ReportCenterViewProps {
  bookings: Booking[];
  services: ServiceItem[];
  therapists: Therapist[];
  branches: Branch[];
  areas: ServiceArea[];
  customers: CustomerCRM[];
  reviews: CustomerReview[];
  rosters: TherapistRoster[];
  settings?: OperationalSettings;
  currentUserId?: string;
  initialCategory?: ReportCategoryKey;
}

export const ReportCenterView: React.FC<ReportCenterViewProps> = ({
  bookings = [],
  services = [],
  therapists = [],
  branches = [],
  areas = [],
  customers = [],
  reviews = [],
  rosters = [],
  settings,
  currentUserId = 'MANAGER_OPERATIONAL',
  initialCategory = 'sales',
}) => {
  const [activeCategory, setActiveCategory] = useState<ReportCategoryKey>(initialCategory);
  const [filters, setFilters] = useState<ReportFilterState>(INITIAL_REPORT_FILTER);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('date');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showDefinitions, setShowDefinitions] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // 1. Filter bookings
  const customerMap = useMemo(() => {
    return new Map((customers || []).map((c) => [(c as any).customerId || c.id, c]));
  }, [customers]);

  const filteredBookings = useMemo(() => {
    return filterBookings(bookings, filters, customerMap);
  }, [bookings, filters, customerMap]);

  // 2. Compute metrics for this filtered slice
  const topKpis = useMemo(() => computeTopKpiMetrics(filteredBookings, bookings), [filteredBookings, bookings]);
  const serviceRows = useMemo(() => computeServiceMetrics(filteredBookings, services, reviews), [filteredBookings, services, reviews]);
  const therapistRows = useMemo(
    () => computeTherapistMetrics(filteredBookings, therapists, rosters, settings || null, reviews),
    [filteredBookings, therapists, rosters, settings, reviews]
  );
  const areaRows = useMemo(() => computeAreaMetrics(filteredBookings, areas), [filteredBookings, areas]);
  const paymentRows = useMemo(() => computePaymentMetrics(filteredBookings), [filteredBookings]);
  const cssSla = useMemo(
    () => computeCssSlaMetrics(filteredBookings, (settings as any)?.paymentVerificationTargetMinutes || (settings as any)?.paymentVerificationSlaMinutes || 120),
    [filteredBookings, settings]
  );
  const ratingMetrics = useMemo(() => computeRatingMetrics(reviews), [reviews]);
  const funnelStages = useMemo(() => computeFunnelStages(filteredBookings), [filteredBookings]);
  const dataQuality = useMemo(() => computeDataQualityReport(filteredBookings, therapists, rosters), [filteredBookings, therapists, rosters]);

  const categories: { key: ReportCategoryKey; label: string; desc: string }[] = [
    { key: 'sales', label: 'Penjualan & Reservasi', desc: 'Daftar transaksi, omzet, dan status reservasi' },
    { key: 'service', label: 'Kinerja Layanan', desc: 'Peringkat omzet dan durasi paket treatment' },
    { key: 'customer', label: 'Pelanggan & CRM', desc: 'Basis data customer dan frekuensi booking' },
    { key: 'therapist', label: 'Terapis & Kapasitas', desc: 'Beban kerja, shift roster, dan ketepatan tiba' },
    { key: 'funnel', label: 'Funnel Operasional', desc: 'Perjalanan proses dan bottleneck waktu tunggu' },
    { key: 'css', label: 'CSS & SLA Bayar', desc: 'Verifikasi bukti transfer dan pencapaian SLA' },
    { key: 'payment', label: 'Rekap Pembayaran', desc: 'Kanal transfer, QRIS, dan penolakan bukti' },
    { key: 'area', label: 'Wilayah Palembang', desc: 'Sebaran kecamatan dan transport fee' },
    { key: 'cancellation', label: 'Analisis Pembatalan', desc: 'Daftar booking batal dan alasan customer' },
    { key: 'rating', label: 'Rating & Review', desc: 'Ulasan kepuasan dan service recovery' },
    { key: 'loyalty', label: 'Loyalty & Reward', desc: 'Poin, voucher, dan tier keanggotaan' },
  ];

  // 3. Search filter for the active table
  const searchFilteredBookings = useMemo(() => {
    let result = filteredBookings;
    if (activeCategory === 'cancellation') {
      result = result.filter((b) => (b.status || '').toLowerCase() === 'cancelled');
    }
    if (!searchQuery.trim()) return result;

    const q = searchQuery.toLowerCase().trim();
    return result.filter(
      (b) =>
        (b.bookingCode || '').toLowerCase().includes(q) ||
        (b.customerName || '').toLowerCase().includes(q) ||
        (b.customerWhatsApp || (b as any).customerPhone || '').toLowerCase().includes(q) ||
        (b.serviceName || '').toLowerCase().includes(q) ||
        (b.therapistName || '').toLowerCase().includes(q) ||
        (b.assignedTherapistName || '').toLowerCase().includes(q)
    );
  }, [filteredBookings, searchQuery, activeCategory]);

  // 4. Sorting
  const sortedBookings = useMemo(() => {
    return [...searchFilteredBookings].sort((a, b) => {
      let valA: any = a.scheduleDate;
      let valB: any = b.scheduleDate;

      if (sortField === 'amount') {
        valA = a.totalAmount || 0;
        valB = b.totalAmount || 0;
      } else if (sortField === 'customer') {
        valA = (a.customerName || '').toLowerCase();
        valB = (b.customerName || '').toLowerCase();
      } else if (sortField === 'status') {
        valA = (a.status || '').toLowerCase();
        valB = (b.status || '').toLowerCase();
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [searchFilteredBookings, sortField, sortAsc]);

  // 5. Pagination
  const totalPages = Math.max(1, Math.ceil(sortedBookings.length / pageSize));
  const paginatedBookings = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedBookings.slice(start, start + pageSize);
  }, [sortedBookings, currentPage, pageSize]);

  // Sort handler
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Export handler
  const handleExport = async () => {
    try {
      setIsExporting(true);
      const reportTypeMap: Record<string, ExportReportType> = {
        sales: 'booking_detail',
        service: 'service_performance',
        customer: 'customer_summary',
        therapist: 'therapist_performance',
        funnel: 'operational_sla',
        css: 'operational_sla',
        payment: 'payment_summary',
        area: 'booking_detail',
        cancellation: 'cancellation',
        rating: 'service_performance',
        loyalty: 'customer_summary',
      };
      const reportType: ExportReportType = reportTypeMap[activeCategory] || 'booking_detail';
      const range = getDateRangeForPreset(filters.datePreset, filters.startDate, filters.endDate);

      await exportReportToExcel(
        {
          reportType,
          filterLabel: range.label,
          startDate: range.startDate,
          endDate: range.endDate,
          branchName: 'Senzu Palembang Riau',
          exportedBy: {
            id: currentUserId,
            name: 'Manager Operasional',
            role: 'manager',
          },
        },
        {
          bookings: filteredBookings,
          services,
          therapists,
          customers,
          rosters,
          reviews,
          settings,
        }
      );

      const catObj = categories.find((c) => c.key === activeCategory);
      setExportSuccessMsg(`Berhasil mengekspor Laporan ${catObj?.label || ''} ke format Excel resmi Senzu.`);
      setTimeout(() => setExportSuccessMsg(null), 5000);
    } catch (err: any) {
      console.error('Export error:', err);
      setExportSuccessMsg('Gagal mengekspor data: ' + (err?.message || 'Error'));
      setTimeout(() => setExportSuccessMsg(null), 6000);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Banner with Title & Quick Info */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#8B5A36] text-[#D4AF37] flex items-center justify-center font-bold">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-[#4B2B18] tracking-tight">
              Pusat Laporan &amp; Audit Operasional (Report Center)
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Sistem pelaporan resmi manajemen Senzu Home. Seluruh data terhubung langsung ke Firestore dan disinkronkan ke zona waktu Asia/Jakarta (WIB).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowDefinitions(true)}
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-[#4B2B18] transition flex items-center gap-1.5"
          >
            <HelpCircle className="w-3.5 h-3.5 text-[#B89628]" />
            <span>Kamus Metrik</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-[#8B5A36] hover:bg-[#8B5A36]/90 text-white shadow-xs transition flex items-center gap-2 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>{isExporting ? 'Memproses...' : 'Ekspor Laporan (.xlsx)'}</span>
          </button>
        </div>
      </div>

      {/* Success Toast */}
      {exportSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{exportSuccessMsg}</span>
        </div>
      )}

      {/* Unified Filters Component */}
      <DashboardFilters
        filters={filters}
        onChange={(newFilters) => {
          setFilters(newFilters);
          setCurrentPage(1);
        }}
        branches={branches}
        services={services}
        therapists={therapists}
        areas={areas}
      />

      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none border-b border-slate-200">
        {(categories || []).map((c) => {
          const isActive = activeCategory === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setActiveCategory(c.key);
                setCurrentPage(1);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                isActive
                  ? 'bg-[#8B5A36] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-[#4B2B18]'
              }`}
            >
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>

      {/* Dynamic Content based on Active Category */}
      {/* 1. SALES / CANCELLATION BOOKINGS TABLE */}
      {(activeCategory === 'sales' || activeCategory === 'cancellation') && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          {/* Table Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari kode booking, nama customer, tlp..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#8B5A36]"
              />
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                Menampilkan <strong>{paginatedBookings.length}</strong> dari{' '}
                <strong>{searchFilteredBookings.length}</strong> baris
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700"
              >
                <option value={10}>10 Baris</option>
                <option value={25}>25 Baris</option>
                <option value={50}>50 Baris</option>
              </select>
            </div>
          </div>

          {/* Table */}
          {paginatedBookings.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
              Belum ada data untuk filter dan pencarian saat ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="py-2.5 px-3">Kode Booking</th>
                    <th
                      className="py-2.5 px-3 cursor-pointer hover:text-[#4B2B18]"
                      onClick={() => handleSort('date')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Jadwal (WIB)</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      className="py-2.5 px-3 cursor-pointer hover:text-[#4B2B18]"
                      onClick={() => handleSort('customer')}
                    >
                      <div className="flex items-center gap-1">
                        <span>Pelanggan</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th className="py-2.5 px-3">Layanan / Durasi</th>
                    <th className="py-2.5 px-3">Terapis Bertugas</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-center">Pembayaran</th>
                    <th
                      className="py-2.5 px-3 text-right cursor-pointer hover:text-[#4B2B18]"
                      onClick={() => handleSort('amount')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Nilai (Rp)</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {(paginatedBookings || []).map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => setSelectedBooking(b)}
                      className="hover:bg-slate-50/80 transition cursor-pointer"
                      title="Klik untuk membuka detail snapshot reservasi"
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-[#4B2B18]">
                        {b.bookingCode || b.id}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        {b.scheduleDate} <span className="text-slate-400">{b.scheduleTime}</span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {b.customerName}
                        {(b.customerWhatsApp || (b as any).customerPhone) && (
                          <span className="block text-[10px] text-slate-400 font-normal">
                            {b.customerWhatsApp || (b as any).customerPhone}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {b.serviceNameSnapshot || b.serviceName}
                        <span className="text-slate-400 text-[10px] ml-1">
                          ({b.durationMinutesSnapshot || (b as any).serviceDurationSnapshot || b.serviceDuration || (b as any).duration || 90}m)
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {b.assignedTherapistName || b.therapistName || (
                          <span className="text-slate-400 italic">Belum assign</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            (b.status || '').toLowerCase() === 'completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : (b.status || '').toLowerCase() === 'cancelled'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            (b.paymentStatus || '').toLowerCase() === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {b.paymentStatus || 'PENDING'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-[#4B2B18] whitespace-nowrap">
                        {formatRupiah(b.totalAmount || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
              <span className="text-slate-500">
                Halaman <strong>{currentPage}</strong> dari <strong>{totalPages}</strong>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. SERVICE PERFORMANCE TABLE */}
      {activeCategory === 'service' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Analisis Performa Layanan &amp; Treatment
            </h3>
            <p className="text-xs text-slate-500">
              Rincian volume booking, omzet terealisasi, pangsa pasar, dan evaluasi kepuasan per layanan
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Treatment</th>
                  <th className="py-2.5 px-3 text-center">Durasi</th>
                  <th className="py-2.5 px-3 text-right">Booking</th>
                  <th className="py-2.5 px-3 text-right">Selesai</th>
                  <th className="py-2.5 px-3 text-right">Omzet Terealisasi</th>
                  <th className="py-2.5 px-3 text-right">Rata-rata Tiket</th>
                  <th className="py-2.5 px-3 text-center">Pangsa (%)</th>
                  <th className="py-2.5 px-3 text-center">Rating</th>
                  <th className="py-2.5 px-3 text-center">Status Master</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(serviceRows || []).map((s, idx) => (
                  <tr key={`${s.serviceName}_${s.duration}_${idx}`} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-[#4B2B18]">{s.serviceName}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{s.duration} mnt</td>
                    <td className="py-2.5 px-3 text-right">{s.bookingCount}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700 font-semibold">{s.completedCount}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#4B2B18]">{formatRupiah(s.realizedRevenue)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{formatRupiah(s.averageTicket)}</td>
                    <td className="py-2.5 px-3 text-center font-bold">{s.sharePct}%</td>
                    <td className="py-2.5 px-3 text-center">
                      {s.averageRating !== null ? `${s.averageRating}★ (${s.ratingCount})` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {s.isActive ? 'Aktif' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. CUSTOMER & CRM */}
      {activeCategory === 'customer' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Pelanggan &amp; Customer Relationship Management (CRM)
            </h3>
            <p className="text-xs text-slate-500">
              Profil pelanggan, riwayat pemesanan, dan segmentasi retensi
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Nama Pelanggan</th>
                  <th className="py-2.5 px-3">No. WhatsApp</th>
                  <th className="py-2.5 px-3 text-center">Segmentasi</th>
                  <th className="py-2.5 px-3 text-right">Total Booking</th>
                  <th className="py-2.5 px-3 text-right">Total Belanja</th>
                  <th className="py-2.5 px-3 text-right">Poin Loyalty</th>
                  <th className="py-2.5 px-3">Kunjungan Terakhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(customers || []).map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-[#4B2B18]">{c.name}</td>
                    <td className="py-2.5 px-3 text-slate-600">{c.phone}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#8B5A36]/10 text-[#4B2B18]">
                        {c.customerSegment || 'NEW'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">{c.totalBookings || 0}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#4B2B18]">{formatRupiah(c.totalSpend || (c as any).totalSpent || 0)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#B89628] font-bold">{(c as any).loyaltyPoints || 0} pts</td>
                    <td className="py-2.5 px-3 text-slate-500">{c.lastBookingAt || (c as any).lastBookingDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. THERAPIST CAPACITY */}
      {activeCategory === 'therapist' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Kapasitas &amp; Utilisasi Terapis
            </h3>
            <p className="text-xs text-slate-500">
              Evaluasi waktu kerja terjadwal, jam treatment aktual, utilisasi kapasitas, dan ketepatan kedatangan
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Terapis</th>
                  <th className="py-2.5 px-3 text-center">Gender</th>
                  <th className="py-2.5 px-3 text-right">Job Selesai</th>
                  <th className="py-2.5 px-3 text-right">Durasi Treatment</th>
                  <th className="py-2.5 px-3 text-right">Shift Roster</th>
                  <th className="py-2.5 px-3 text-center">Utilisasi (%)</th>
                  <th className="py-2.5 px-3 text-center">Tepat Waktu (%)</th>
                  <th className="py-2.5 px-3 text-center">Waktu Tempuh</th>
                  <th className="py-2.5 px-3 text-center">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(therapistRows || []).map((t) => (
                  <tr key={t.therapistId} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-[#4B2B18]">{t.therapistName}</td>
                    <td className="py-2.5 px-3 text-center">{t.gender === 'F' ? 'Wanita' : 'Pria'}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#4B2B18]">{t.jobsCompleted}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{t.plannedTreatmentMinutes} mnt</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {t.rosterDataComplete ? `${t.scheduledShiftMinutes} mnt` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {t.rosterDataComplete && t.utilizationPct !== null ? (
                        <span className="font-bold text-[#4B2B18]">{t.utilizationPct}%</span>
                      ) : (
                        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                          Roster Belum Lengkap
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {t.onTimeRate !== null ? (
                        <span className="font-semibold text-emerald-700">{t.onTimeRate}%</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono">
                      {t.avgTravelMinutes !== null ? `${t.avgTravelMinutes} mnt` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {t.averageRating !== null ? `${t.averageRating}★` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. FUNNEL & BOTTLENECK */}
      {activeCategory === 'funnel' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Funnel Operasional &amp; Durasi Antar Tahap
            </h3>
            <p className="text-xs text-slate-500">
              Analisis alur konversi dari pembuatan reservasi hingga penyelesaian layanan
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Tahapan Funnel</th>
                  <th className="py-2.5 px-3 text-right">Jumlah Reservasi</th>
                  <th className="py-2.5 px-3 text-center">Porsi (%)</th>
                  <th className="py-2.5 px-3 text-right">Rata² Waktu Tunggu</th>
                  <th className="py-2.5 px-3 text-right">Median Waktu Tunggu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(funnelStages || []).map((st) => (
                  <tr key={st.key} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-[#4B2B18]">{st.label}</td>
                    <td className="py-2.5 px-3 text-right font-bold">{st.count}</td>
                    <td className="py-2.5 px-3 text-center">{st.pctOfTotal}%</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {st.avgWaitMin !== null ? `${st.avgWaitMin} Menit` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {st.medianWaitMin !== null ? `${st.medianWaitMin} Menit` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. CSS & SLA */}
      {activeCategory === 'css' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan SLA Verifikasi Pembayaran Customer Service (CSS)
            </h3>
            <p className="text-xs text-slate-500">
              Evaluasi kecepatan penanganan bukti transfer terhadap batas SLA ({cssSla.targetSlaMinutes} Menit)
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-[11px] text-slate-500 block">Bukti Masuk:</span>
              <span className="text-lg font-bold text-[#4B2B18]">{cssSla.proofUploadedCount}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Terverifikasi:</span>
              <span className="text-lg font-bold text-emerald-700">{cssSla.verifiedCount}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Ditolak:</span>
              <span className="text-lg font-bold text-rose-600">{cssSla.rejectedCount}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Pencapaian SLA:</span>
              <span className="text-lg font-bold text-[#4B2B18]">{cssSla.slaAchievementRate}%</span>
            </div>
          </div>
        </div>
      )}

      {/* 7. PAYMENT SUMMARY */}
      {activeCategory === 'payment' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Rekapitulasi Metode &amp; Kanal Pembayaran
            </h3>
            <p className="text-xs text-slate-500">
              Total penerimaan bruto per rekening bank dan QRIS Senzu
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Kanal Pembayaran</th>
                  <th className="py-2.5 px-3 text-right">Jumlah Transaksi</th>
                  <th className="py-2.5 px-3 text-right">Total Dana Terbayar</th>
                  <th className="py-2.5 px-3 text-center">Pangsa (%)</th>
                  <th className="py-2.5 px-3 text-center">Bukti Ditolak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(paymentRows || []).map((pm) => (
                  <tr key={pm.methodKey} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-[#4B2B18]">{pm.methodLabel}</td>
                    <td className="py-2.5 px-3 text-right">{pm.transactionCount}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#4B2B18]">{formatRupiah(pm.paidAmount)}</td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#B89628]">{pm.sharePct}%</td>
                    <td className="py-2.5 px-3 text-center text-rose-600 font-semibold">{pm.rejectedProofCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 8. AREA & GEOGRAPHY */}
      {activeCategory === 'area' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Sebaran Wilayah &amp; Kecamatan Palembang
            </h3>
            <p className="text-xs text-slate-500">
              Peringkat permintaan layanan dan biaya transportasi home service antar kecamatan
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Kecamatan</th>
                  <th className="py-2.5 px-3 text-right">Total Booking</th>
                  <th className="py-2.5 px-3 text-right">Selesai</th>
                  <th className="py-2.5 px-3 text-right">Omzet Terealisasi</th>
                  <th className="py-2.5 px-3 text-right">Rata² Transport Fee</th>
                  <th className="py-2.5 px-3 text-center">Rasio Batal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(areaRows || []).map((a) => (
                  <tr key={a.areaName} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-[#4B2B18]">{a.areaName}</td>
                    <td className="py-2.5 px-3 text-right">{a.bookingCount}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700 font-semibold">{a.completedCount}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#4B2B18]">{formatRupiah(a.realizedRevenue)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{formatRupiah(a.avgHomeServiceFee)}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="font-semibold text-rose-600">{a.cancellationRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 10. RATING & REVIEWS */}
      {activeCategory === 'rating' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Kepuasan Pelanggan &amp; Rating Layanan
            </h3>
            <p className="text-xs text-slate-500">
              Rangkuman ulasan bintang 1 s/d 5 dan catatan feedback customer
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Kode Booking</th>
                  <th className="py-2.5 px-3 text-center">Rating</th>
                  <th className="py-2.5 px-3">Ulasan / Komentar</th>
                  <th className="py-2.5 px-3 text-center">Status Pemulihan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(reviews || []).map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-bold text-[#4B2B18]">{r.customerName}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{r.bookingCode}</td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#B89628]">{r.overallRating}★</td>
                    <td className="py-2.5 px-3 text-slate-700 italic">"{r.comment}"</td>
                    <td className="py-2.5 px-3 text-center">
                      {r.overallRating && r.overallRating <= ratingMetrics.lowRatingThreshold ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800">
                          {(r as any).isResolved ? 'Resolved' : 'Needs Recovery'}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 11. LOYALTY & REWARDS */}
      {activeCategory === 'loyalty' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h3 className="font-bold text-[#4B2B18] text-base">
              Laporan Program Retensi, Poin &amp; Voucher
            </h3>
            <p className="text-xs text-slate-500">
              Evaluasi perputaran poin reward dan penggunaan voucher diskon reservasi
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            <div>
              <span className="text-[11px] text-slate-500 block">Total Pelanggan Terdaftar:</span>
              <span className="text-lg font-bold text-[#4B2B18]">{customers.length}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Total Poin Beredar:</span>
              <span className="text-lg font-bold text-[#B89628]">
                {customers.reduce((sum, c) => sum + ((c as any).loyaltyPoints || (c as any).pointsBalance || 0), 0)} pts
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Diskon Voucher Terpakai:</span>
              <span className="text-lg font-bold text-emerald-700">
                {formatRupiah(filteredBookings.reduce((sum, b) => sum + (b.voucherDiscount || 0), 0))}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Diskon Poin Terpakai:</span>
              <span className="text-lg font-bold text-emerald-700">
                {formatRupiah(filteredBookings.reduce((sum, b) => sum + (b.pointsDiscount || 0), 0))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Drilldown Drawer for Booking Detail */}
      {selectedBooking && (
        <BookingDetailDrawer
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
        />
      )}

      {/* Metric Definitions Modal */}
      <MetricDefinitionsModal
        isOpen={showDefinitions}
        onClose={() => setShowDefinitions(false)}
      />
    </div>
  );
};
