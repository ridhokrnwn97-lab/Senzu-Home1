import React, { useState, useMemo, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Clock,
  AlertCircle,
  FileSpreadsheet,
  Download,
  Search,
  Filter,
  Calendar,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  CreditCard,
  Building,
  RotateCcw,
} from 'lucide-react';
import { Booking, PaymentRecord } from '../types';
import {
  subscribeToAllPayments,
  getPaymentStatusBadgeStyle,
  getPaymentStatusLabel,
} from '../lib/paymentService';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { formatDistanceDisplay } from '../lib/distanceFeeService';
import * as XLSX from 'xlsx';

interface PaymentReconciliationViewProps {
  bookings: Booking[];
  onRefresh?: () => void;
}

export const PaymentReconciliationView: React.FC<PaymentReconciliationViewProps> = ({
  bookings = [],
}) => {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [methodFilter, setMethodFilter] = useState('ALL');

  // Modal detail
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);

  // Real-time payments subscription
  useEffect(() => {
    const unsub = subscribeToAllPayments((list) => {
      setPayments(list);
      setIsLoading(false);
    });
    return () => unsub();
  }, []);

  // Map of bookingId -> Booking object for quick lookup
  const bookingMap = useMemo(() => {
    const map = new Map<string, Booking>();
    (bookings || []).forEach((b) => {
      map.set(b.id, b);
      if (b.bookingCode) map.set(b.bookingCode, b);
    });
    return map;
  }, [bookings]);

  // Combined reconciliation items
  const reconciliationItems = useMemo(() => {
    return (bookings || []).map((b) => {
      const associatedPayment = payments.find(
        (p) => p.bookingId === b.id || p.bookingCode === b.bookingCode
      );

      const pStatus = (associatedPayment?.status || b.paymentStatus || 'unpaid').toString().toLowerCase();
      const pMethod = associatedPayment?.paymentMethod || b.paymentMethod || 'Manual';

      return {
        booking: b,
        payment: associatedPayment || null,
        bookingCode: b.bookingCode || '',
        customerName: b.customerName || '',
        customerWhatsApp: b.customerWhatsApp || '',
        serviceName: b.serviceName || '',
        serviceDuration: b.serviceDuration,
        scheduleDate: b.scheduleDate,
        scheduleTime: b.scheduleTime || '14:00',
        therapistName: b.therapistName || '-',
        servicePrice: b.servicePrice || 0,
        homeServiceFee: b.homeServiceFee || 0,
        totalAmount: (b.servicePrice || 0) + (b.homeServiceFee || 0),
        paymentMethod: pMethod,
        paymentStatus: pStatus,
        verifiedBy: associatedPayment?.verifiedByName || '-',
        verifiedAt: associatedPayment?.verifiedAt || '-',
        createdAt: b.createdAt,
      };
    });
  }, [bookings, payments]);

  // Filtered list
  const filteredItems = useMemo(() => {
    return reconciliationItems.filter((item) => {
      const q = (searchTerm || '').toLowerCase();
      const matchSearch =
        (item.bookingCode || '').toLowerCase().includes(q) ||
        (item.customerName || '').toLowerCase().includes(q) ||
        (item.customerWhatsApp || '').includes(searchTerm || '') ||
        (item.therapistName || '').toLowerCase().includes(q);

      const matchStatus =
        statusFilter === 'ALL' ||
        (item.paymentStatus || '').toLowerCase() === (statusFilter || '').toLowerCase();

      const matchMethod =
        methodFilter === 'ALL' ||
        (item.paymentMethod || '').toLowerCase().includes((methodFilter || '').toLowerCase());

      const matchDate =
        (!startDate || item.scheduleDate >= startDate) &&
        (!endDate || item.scheduleDate <= endDate);

      return matchSearch && matchStatus && matchMethod && matchDate;
    });
  }, [reconciliationItems, searchTerm, statusFilter, methodFilter, startDate, endDate]);

  // KPI Metrics (Strict Accounting Rules)
  const kpis = useMemo(() => {
    const totalCount = filteredItems.length;
    const paidItems = filteredItems.filter((i) => i.paymentStatus === 'paid');
    const paidRevenue = paidItems.reduce((acc, i) => acc + i.totalAmount, 0);

    const pendingItems = filteredItems.filter(
      (i) => i.paymentStatus === 'pending_manual_verification'
    );
    const pendingAmount = pendingItems.reduce((acc, i) => acc + i.totalAmount, 0);

    const rejectedCount = filteredItems.filter(
      (i) => i.paymentStatus === 'payment_rejected'
    ).length;

    const unpaidCount = filteredItems.filter((i) => i.paymentStatus === 'unpaid').length;

    const refundedCount = filteredItems.filter(
      (i) => i.paymentStatus === 'refunded' || i.paymentStatus === 'partially_refunded'
    ).length;

    return {
      totalCount,
      paidCount: paidItems.length,
      paidRevenue,
      pendingCount: pendingItems.length,
      pendingAmount,
      rejectedCount,
      unpaidCount,
      refundedCount,
    };
  }, [filteredItems]);

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    const dataToExport = (filteredItems || []).map((item, idx) => {
      const isHistoricalCash =
        (item.paymentMethod || '').toLowerCase().includes('cash') ||
        (item.paymentMethod || '').toLowerCase().includes('tunai');
      const methodLabel = isHistoricalCash ? 'Cash (Historical)' : item.paymentMethod;

      return {
        No: idx + 1,
        'Kode Booking': item.bookingCode,
        'Nama Pelanggan': item.customerName,
        'No. WhatsApp': item.customerWhatsApp,
        'Tanggal Treatment': item.scheduleDate,
        'Jam Mulai (WIB)': item.scheduleTime,
        'Jenis Treatment': item.serviceName,
        'Durasi (Menit)': item.serviceDuration,
        'Nama Terapis': item.therapistName,
        'Biaya Treatment (Rp)': item.servicePrice,
        'Home Service Fee (Rp)': item.homeServiceFee,
        'Total Pembayaran (Rp)': item.totalAmount,
        'Metode Pembayaran': methodLabel,
        'Status Pembayaran': getPaymentStatusLabel(item.paymentStatus),
        'Status Booking': item.booking.status,
        'Diverifikasi Oleh': item.verifiedBy,
        'Waktu Verifikasi': item.verifiedAt ? new Date(item.verifiedAt).toLocaleString('id-ID') : '-',
        'Tanggal Dibuat': item.createdAt ? new Date(item.createdAt).toLocaleString('id-ID') : '-',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekonsiliasi Pembayaran');

    // Auto column widths
    const colWidths = [
      { wch: 5 },  // No
      { wch: 18 }, // Kode Booking
      { wch: 22 }, // Pelanggan
      { wch: 16 }, // WA
      { wch: 15 }, // Tanggal
      { wch: 10 }, // Jam
      { wch: 24 }, // Treatment
      { wch: 12 }, // Durasi
      { wch: 18 }, // Terapis
      { wch: 16 }, // Biaya
      { wch: 16 }, // Fee
      { wch: 18 }, // Total
      { wch: 18 }, // Metode
      { wch: 18 }, // Status Bayar
      { wch: 18 }, // Status Booking
      { wch: 16 }, // Verifikator
      { wch: 20 }, // Waktu
      { wch: 20 }, // Dibuat
    ];
    worksheet['!cols'] = colWidths;

    const filename = `Senzu_Home_Rekonsiliasi_Pembayaran_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'No',
      'Kode Booking',
      'Nama Pelanggan',
      'No WhatsApp',
      'Tanggal Treatment',
      'Jam Treatment',
      'Jenis Treatment',
      'Durasi Menit',
      'Nama Terapis',
      'Biaya Treatment',
      'Home Service Fee',
      'Total Pembayaran',
      'Metode Pembayaran',
      'Status Pembayaran',
      'Status Booking',
      'Diverifikasi Oleh',
      'Waktu Verifikasi',
    ];

    const rows = (filteredItems || []).map((item, idx) => {
      const isHistoricalCash =
        (item.paymentMethod || '').toLowerCase().includes('cash') ||
        (item.paymentMethod || '').toLowerCase().includes('tunai');
      const methodLabel = isHistoricalCash ? 'Cash (Historical)' : item.paymentMethod;

      return [
        idx + 1,
        `"${item.bookingCode}"`,
        `"${item.customerName}"`,
        `"${item.customerWhatsApp}"`,
        item.scheduleDate,
        item.scheduleTime,
        `"${item.serviceName}"`,
        item.serviceDuration,
        `"${item.therapistName}"`,
        item.servicePrice,
        item.homeServiceFee,
        item.totalAmount,
        `"${methodLabel}"`,
        `"${getPaymentStatusLabel(item.paymentStatus)}"`,
        `"${item.booking.status}"`,
        `"${item.verifiedBy}"`,
        `"${item.verifiedAt}"`,
      ];
    });

    const csvContent = [headers.join(','), ...(rows || []).map((e) => e.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `Senzu_Home_Rekonsiliasi_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header & Export Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[#4B2B18] text-xs font-bold mb-1">
            <Building className="w-3.5 h-3.5 text-[#B89628]" />
            Keuangan & Rekonsiliasi Senzu Home
          </div>
          <h2 className="font-serif text-2xl font-bold text-[#4B2B18]">
            Rekonsiliasi Pembayaran
          </h2>
          <p className="text-xs text-slate-500">
            Laporan settlement, audit transaksi transfer bank & QRIS Senzu secara real-time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-4 py-2.5 min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-4 py-2.5 min-h-[44px] rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#D4AF37]" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Paid Revenue */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Total Pendapatan Lunas</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="font-serif font-bold text-lg sm:text-xl text-[#4B2B18]">
              {formatRupiah(kpis.paidRevenue)}
            </span>
            <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
              {kpis.paidCount} transaksi lunas
            </div>
          </div>
        </div>

        {/* Pending Verification */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Menunggu Verifikasi</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="font-serif font-bold text-lg sm:text-xl text-blue-900">
              {formatRupiah(kpis.pendingAmount)}
            </span>
            <div className="text-[11px] text-blue-700 font-semibold mt-0.5">
              {kpis.pendingCount} bukti menunggu dicek
            </div>
          </div>
        </div>

        {/* Unpaid */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Belum Bayar</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="font-serif font-bold text-lg sm:text-xl text-amber-900">
              {kpis.unpaidCount} Order
            </span>
            <div className="text-[11px] text-slate-400 mt-0.5">Belum unggah bukti</div>
          </div>
        </div>

        {/* Rejected Payments */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Pembayaran Ditolak</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="font-serif font-bold text-lg sm:text-xl text-rose-900">
              {kpis.rejectedCount}
            </span>
            <div className="text-[11px] text-rose-700 font-semibold mt-0.5">Perlu konfirmasi ulang</div>
          </div>
        </div>

        {/* Total Bookings Filtered */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Total Order</span>
            <div className="w-8 h-8 rounded-xl bg-[#8B5A36]/10 text-[#4B2B18] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="font-serif font-bold text-lg sm:text-xl text-[#4B2B18]">
              {kpis.totalCount} Order
            </span>
            <div className="text-[11px] text-slate-400 mt-0.5">Data terfilter</div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari Kode, Pelanggan, WA..."
              className="w-full pl-10 pr-3.5 py-2 min-h-[40px] rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36] focus:outline-none"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36] focus:outline-none bg-white font-medium text-slate-700"
            >
              <option value="ALL">Semua Status Bayar</option>
              <option value="paid">Lunas (Paid)</option>
              <option value="pending_manual_verification">Menunggu Verifikasi</option>
              <option value="unpaid">Belum Bayar</option>
              <option value="payment_rejected">Ditolak (Rejected)</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>

          {/* Method Filter */}
          <div>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36] focus:outline-none bg-white font-medium text-slate-700"
            >
              <option value="ALL">Semua Metode Pembayaran</option>
              <option value="qris">QRIS Senzu</option>
              <option value="bni">Transfer BNI</option>
              <option value="mandiri">Transfer Bank Mandiri</option>
              <option value="bri">Transfer Bank BRI</option>
              <option value="cash">Cash (Historical)</option>
            </select>
          </div>

          {/* Start Date */}
          <div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36] focus:outline-none bg-white font-medium text-slate-700"
              placeholder="Dari Tanggal"
            />
          </div>

          {/* End Date */}
          <div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 min-h-[40px] rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36] focus:outline-none bg-white font-medium text-slate-700"
              placeholder="Sampai Tanggal"
            />
          </div>
        </div>

        {(searchTerm || statusFilter !== 'ALL' || methodFilter !== 'ALL' || startDate || endDate) && (
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span>Ditemukan {filteredItems.length} transaksi sesuai kriteria.</span>
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('ALL');
                setMethodFilter('ALL');
                setStartDate('');
                setEndDate('');
              }}
              className="text-[#4B2B18] font-bold hover:underline"
            >
              Reset Filter
            </button>
          </div>
        )}
      </div>

      {/* Main Reconciliation Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF9F6] border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Kode Booking</th>
                <th className="px-4 py-3">Pelanggan</th>
                <th className="px-4 py-3">Jadwal Treatment</th>
                <th className="px-4 py-3">Layanan</th>
                <th className="px-4 py-3">Terapis</th>
                <th className="px-4 py-3 text-right">Biaya Treatment</th>
                <th className="px-4 py-3 text-right">Home Service Fee</th>
                <th className="px-4 py-3 text-right">Total (Rp)</th>
                <th className="px-4 py-3">Metode</th>
                <th className="px-4 py-3">Status Bayar</th>
                <th className="px-4 py-3">Verifikator</th>
                <th className="px-4 py-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-slate-400">
                    Tidak ada data transaksi yang cocok dengan filter.
                  </td>
                </tr>
              ) : (
                (filteredItems || []).map((item) => {
                  const style = getPaymentStatusBadgeStyle(item.paymentStatus);
                  return (
                    <tr key={item.booking.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3 font-mono font-bold text-[#4B2B18]">
                        {item.bookingCode}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{item.customerName}</div>
                        <div className="text-[11px] text-slate-500">{item.customerWhatsApp}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{item.scheduleDate}</div>
                        <div className="text-[11px] text-slate-500">{item.scheduleTime} WIB</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{item.serviceName}</div>
                        <div className="text-[10px] text-slate-400">{item.serviceDuration}m</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.therapistName}</td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatRupiah(item.servicePrice)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        <div>
                          {item.homeServiceFee === 0 ? (
                            <span className="text-emerald-700 font-bold text-xs">GRATIS</span>
                          ) : (
                            formatRupiah(item.homeServiceFee)
                          )}
                        </div>
                        {item.booking.distanceKm !== undefined && (
                          <div className="text-[10px] text-slate-400">
                            {formatDistanceDisplay(item.booking.distanceKm)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#4B2B18]">
                        {formatRupiah(item.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {(item.paymentMethod || '').toLowerCase().includes('cash') ||
                        (item.paymentMethod || '').toLowerCase().includes('tunai') ? (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[11px]" title="Metode bayar historis (tidak berlaku untuk booking baru)">
                            Cash (Historical)
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px]">
                            {item.paymentMethod}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] border font-bold ${style.bg} ${style.text} ${style.border}`}
                        >
                          {style.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-500">
                        <div>{item.verifiedBy}</div>
                        {item.verifiedAt !== '-' && (
                          <div className="text-[10px] text-slate-400">
                            {new Date(item.verifiedAt).toLocaleDateString('id-ID')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.payment?.paymentProofUrl && (
                          <button
                            type="button"
                            onClick={() => setSelectedPayment(item.payment)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                            title="Lihat Bukti Bayar"
                          >
                            <Eye className="w-4 h-4 text-[#4B2B18]" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Preview Bukti */}
      {selectedPayment && selectedPayment.paymentProofUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 relative">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-[#4B2B18] text-base">Bukti Pembayaran</h4>
                <p className="text-xs text-slate-500">{selectedPayment.bookingCode}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPayment(null)}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
              >
                Tutup
              </button>
            </div>
            <div className="p-2 bg-slate-50 rounded-2xl border border-slate-200 text-center">
              <img
                src={selectedPayment.paymentProofUrl}
                alt="Bukti Transfer"
                className="max-h-[60vh] mx-auto object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
