import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Filter,
  Calendar,
  User,
  CreditCard,
  Sparkles,
  CheckCircle
} from 'lucide-react';
import { Booking, ServiceItem, Therapist } from '../types';
import { exportBookingsToExcel, formatRupiah } from '../lib/utils';

interface ExcelReportViewProps {
  bookings: Booking[];
  services: ServiceItem[];
  therapists: Therapist[];
}

export const ExcelReportView: React.FC<ExcelReportViewProps> = ({
  bookings = [],
  services = [],
  therapists = [],
}) => {
  // Filter States
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTherapist, setSelectedTherapist] = useState('ALL');
  const [selectedTreatment, setSelectedTreatment] = useState('ALL');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('ALL');
  const [selectedBookingStatus, setSelectedBookingStatus] = useState('ALL');
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const filteredBookings = useMemo(() => {
    return (bookings || []).filter((b) => {
      // Date filter
      if (startDate && b.scheduleDate < startDate) return false;
      if (endDate && b.scheduleDate > endDate) return false;

      // Therapist filter
      if (selectedTherapist !== 'ALL') {
        if (b.therapistName !== selectedTherapist && b.therapistId !== selectedTherapist) {
          return false;
        }
      }

      // Treatment filter
      if (selectedTreatment !== 'ALL' && b.serviceName !== selectedTreatment) {
        return false;
      }

      // Payment filter
      if (selectedPaymentStatus !== 'ALL' && b.paymentStatus !== selectedPaymentStatus) {
        return false;
      }

      // Booking status filter
      if (selectedBookingStatus !== 'ALL' && b.status !== selectedBookingStatus) {
        return false;
      }

      return true;
    });
  }, [
    bookings,
    startDate,
    endDate,
    selectedTherapist,
    selectedTreatment,
    selectedPaymentStatus,
    selectedBookingStatus,
  ]);

  const handleExport = () => {
    exportBookingsToExcel(filteredBookings);
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 4000);
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedTherapist('ALL');
    setSelectedTreatment('ALL');
    setSelectedPaymentStatus('ALL');
    setSelectedBookingStatus('ALL');
  };

  // KPI Summary for the filtered set
  const paidCompletedRows = filteredBookings.filter(
    (b) => b.status === 'Completed' && b.paymentStatus === 'PAID'
  );
  const totalRealizedRevenue = paidCompletedRows.reduce(
    (sum, b) => sum + (b.totalAmount || 0),
    0
  );
  const paidCount = filteredBookings.filter((b) => b.paymentStatus === 'PAID').length;
  const unpaidCount = filteredBookings.filter((b) => b.paymentStatus !== 'PAID').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold font-serif text-[#082A4F] flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-[#B89628]" />
            Laporan Senzu Home
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Ekspor data operasional dan rekapitulasi refleksi ke format Excel (.xlsx) resmi
          </p>
        </div>

        <button
          id="btn-export-excel"
          type="button"
          onClick={handleExport}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white font-bold text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export Excel (.xlsx)</span>
        </button>
      </div>

      {downloadSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs sm:text-sm flex items-center gap-2 animate-fade-in font-medium">
          <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>File spreadsheet Excel berhasil diexport dan diunduh ke perangkat Anda!</span>
        </div>
      )}

      {/* Summary KPI Cards for Report */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-slate-500 font-semibold block">Total Baris Laporan</span>
          <span className="text-xl font-bold text-[#082A4F]">{filteredBookings.length} Order</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-slate-500 font-semibold block">Revenue (Completed + PAID)</span>
          <span className="text-xl font-bold text-emerald-700">
            {formatRupiah(totalRealizedRevenue)}
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-slate-500 font-semibold block">Status Pembayaran PAID</span>
          <span className="text-xl font-bold text-emerald-600">{paidCount} Order</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-slate-500 font-semibold block">Status Pembayaran UNPAID</span>
          <span className="text-xl font-bold text-amber-600">{unpaidCount} Order</span>
        </div>
      </div>

      {/* Filter Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="text-xs font-bold text-[#082A4F] flex items-center gap-1.5 uppercase tracking-wider">
            <Filter className="w-4 h-4 text-[#B89628]" />
            Filter Data Laporan
          </div>
          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs text-slate-500 hover:text-[#082A4F] font-semibold underline"
          >
            Reset Filter
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          {/* Start Date */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Tanggal Mulai:</label>
            <input
              id="filter-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F]"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Tanggal Akhir:</label>
            <input
              id="filter-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F]"
            />
          </div>

          {/* Therapist */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Therapist:</label>
            <select
              id="filter-therapist"
              value={selectedTherapist}
              onChange={(e) => setSelectedTherapist(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
            >
              <option value="ALL">Semua Therapist</option>
              {(therapists || []).map((th) => (
                <option key={th.id} value={th.name}>
                  {th.name}
                </option>
              ))}
            </select>
          </div>

          {/* Treatment */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Treatment:</label>
            <select
              id="filter-treatment"
              value={selectedTreatment}
              onChange={(e) => setSelectedTreatment(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
            >
              <option value="ALL">Semua Jenis Treatment</option>
              {(services || []).map((srv) => (
                <option key={srv.id} value={srv.name}>
                  {srv.name}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Status */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Status Pembayaran:</label>
            <select
              id="filter-payment"
              value={selectedPaymentStatus}
              onChange={(e) => setSelectedPaymentStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
            >
              <option value="ALL">Semua (PAID & UNPAID)</option>
              <option value="PAID">PAID</option>
              <option value="UNPAID">UNPAID</option>
            </select>
          </div>

          {/* Booking Status */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Status Booking:</label>
            <select
              id="filter-status"
              value={selectedBookingStatus}
              onChange={(e) => setSelectedBookingStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
            >
              <option value="ALL">Semua Status</option>
              <option value="Menunggu Pembayaran">Menunggu Pembayaran</option>
              <option value="Pembayaran Terverifikasi">Pembayaran Terverifikasi</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Therapist Assigned">Therapist Assigned</option>
              <option value="Accepted">Accepted</option>
              <option value="On The Way">On The Way</option>
              <option value="Arrived">Arrived</option>
              <option value="Treatment">Treatment</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Rescheduled">Rescheduled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Preview Table of Excel Rows */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-800">
            Pratinjau Data Laporan ({filteredBookings.length} baris siap diekspor)
          </div>
          <span className="text-[11px] text-slate-500">
            Kolom sesuai format wajib standar akuntansi Senzu Home
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#082A4F] text-white uppercase text-[10px] font-semibold tracking-wider">
              <tr>
                <th className="py-3 px-3">No</th>
                <th className="py-3 px-3">Kode Booking</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Nama Terapis</th>
                <th className="py-3 px-3">Layanan</th>
                <th className="py-3 px-3">Durasi</th>
                <th className="py-3 px-3">Total Biaya</th>
                <th className="py-3 px-3">Metode</th>
                <th className="py-3 px-3">Pembayaran</th>
                <th className="py-3 px-3">Pelanggan</th>
                <th className="py-3 px-3">Tanggal & Jam</th>
                <th className="py-3 px-3">Wilayah</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-slate-400">
                    Tidak ada data booking yang cocok dengan kriteria filter.
                  </td>
                </tr>
              ) : (
                (filteredBookings || []).map((b, idx) => (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3 text-slate-400">{idx + 1}</td>
                    <td className="py-3 px-3 font-mono font-bold text-[#082A4F]">
                      {b.bookingCode}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                        {b.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800">
                      {b.therapistName || '-'}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800">{b.serviceName}</td>
                    <td className="py-3 px-3 text-slate-600">{b.serviceDuration}m</td>
                    <td className="py-3 px-3 font-semibold text-slate-900">
                      {formatRupiah(b.totalAmount || 0)}
                    </td>
                    <td className="py-3 px-3 text-slate-600">{b.paymentMethod}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          b.paymentStatus === 'PAID'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {b.paymentStatus === 'PAID' ? 'PAID' : 'UNPAID'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-900">
                      <div>{b.customerName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{b.customerWhatsApp}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      <div>{b.scheduleDate}</div>
                      <div className="text-[10px] text-slate-500">{b.scheduleTime || '-'} WIB</div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 max-w-[150px] truncate" title={b.address}>
                      {b.area}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
