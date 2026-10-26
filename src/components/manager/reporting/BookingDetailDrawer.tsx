import React from 'react';
import {
  X,
  Calendar,
  Clock,
  User,
  MapPin,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Phone,
  FileText,
} from 'lucide-react';
import { Booking } from '../../../types';
import { formatRupiah, formatDateTimeWIB } from '../../../lib/utils';
import { formatDistanceDisplay } from '../../../lib/distanceFeeService';

interface BookingDetailDrawerProps {
  booking: Booking | null;
  onClose: () => void;
}

export const BookingDetailDrawer: React.FC<BookingDetailDrawerProps> = ({
  booking,
  onClose,
}) => {
  if (!booking) return null;

  const isCompleted = (booking.status || '').toLowerCase() === 'completed';
  const isPaid = (booking.paymentStatus || '').toLowerCase() === 'paid';
  const isCancelled = (booking.status || '').toLowerCase() === 'cancelled';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="px-6 py-4 bg-[#8B5A36] text-white flex items-center justify-between border-b border-[#D4AF37]/30">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold tracking-wider text-[#D4AF37]">
                {booking.bookingCode || booking.id}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isCompleted
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : isCancelled
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'bg-blue-500/20 text-blue-300'
                }`}
              >
                {booking.status}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Detail Snapshot Reservasi &amp; Jejak Waktu (WIB)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Customer Card */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-[#4B2B18] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#B89628]" />
              Data Pelanggan
            </h4>
            <div className="grid grid-cols-2 gap-2 text-slate-700">
              <div>
                <span className="text-[11px] text-slate-400 block">Nama Customer:</span>
                <span className="font-semibold text-slate-800">{booking.customerName}</span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">No. WhatsApp / HP:</span>
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-slate-400" />
                  {booking.customerWhatsApp || (booking as any).customerPhone || '—'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-[11px] text-slate-400 block">Alamat / Lokasi Layanan:</span>
                <span className="font-medium text-slate-700 flex items-start gap-1 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-[#4B2B18] shrink-0 mt-0.5" />
                  <span>{booking.address || (booking as any).customerAddress || (booking as any).locationAddress || 'Alamat tidak tertera'}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Service Snapshot Card */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-[#4B2B18] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#B89628]" />
              Layanan &amp; Jadwal
            </h4>
            <div className="grid grid-cols-2 gap-2 text-slate-700">
              <div>
                <span className="text-[11px] text-slate-400 block">Nama Treatment:</span>
                <span className="font-semibold text-[#4B2B18]">
                  {booking.serviceNameSnapshot || booking.serviceName}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Durasi Treatment:</span>
                <span className="font-semibold text-slate-800">
                  {booking.durationMinutesSnapshot || (booking as any).serviceDurationSnapshot || booking.serviceDuration || 90} Menit
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Tanggal &amp; Waktu:</span>
                <span className="font-semibold text-slate-800">
                  {booking.scheduleDate} • {booking.scheduleTime} WIB
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Terapis Bertugas:</span>
                <span className="font-semibold text-slate-800">
                  {booking.assignedTherapistName || booking.therapistName || 'Belum Ditugaskan'}
                </span>
              </div>
            </div>
          </div>

          {/* Financial Breakdown Card */}
          <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2 shadow-xs">
            <h4 className="font-bold text-[#4B2B18] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5 text-[#B89628]" />
              Rincian Biaya &amp; Pembayaran
            </h4>
            <div className="space-y-1.5 pt-1 text-slate-600">
              <div className="flex justify-between">
                <span>Jarak Customer (Snapshot):</span>
                <span className="font-medium text-slate-800">{formatDistanceDisplay(booking.distanceKm)}</span>
              </div>
              <div className="flex justify-between">
                <span>Harga Layanan (Snapshot):</span>
                <span>{formatRupiah(booking.servicePriceSnapshot || booking.servicePrice || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Biaya Home Service:</span>
                <span className={`font-medium ${booking.homeServiceFee === 0 ? 'text-emerald-700 font-bold' : ''}`}>
                  {booking.homeServiceFee === 0 ? 'GRATIS' : formatRupiah(booking.homeServiceFeeSnapshot ?? booking.homeServiceFee ?? (booking as any).transportFee ?? 0)}
                </span>
              </div>
              {Boolean(booking.voucherDiscount) && (
                <div className="flex justify-between text-emerald-700">
                  <span>Diskon Voucher ({booking.voucherCode}):</span>
                  <span>-{formatRupiah(booking.voucherDiscount || 0)}</span>
                </div>
              )}
              {Boolean(booking.pointsDiscount) && (
                <div className="flex justify-between text-emerald-700">
                  <span>Diskon Poin Loyalty:</span>
                  <span>-{formatRupiah(booking.pointsDiscount || 0)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm text-[#4B2B18] pt-2 border-t border-slate-200">
                <span>Total Transaksi:</span>
                <span>{formatRupiah(booking.totalAmount || 0)}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">Status Pembayaran:</span>
              <span
                className={`font-bold px-2 py-0.5 rounded ${
                  isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {booking.paymentStatus || 'PENDING'}
              </span>
            </div>
            {booking.paymentMethod && (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Metode Bayar:</span>
                <span className="font-medium text-slate-700 uppercase">
                  {booking.paymentMethod}
                </span>
              </div>
            )}
          </div>

          {/* Operational Timestamps */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-[#4B2B18] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#4B2B18]" />
              Jejak Audit Waktu Operasional (WIB)
            </h4>
            <div className="space-y-1.5 font-mono text-[11px] text-slate-600">
              <div className="flex justify-between">
                <span>Booking Dibuat:</span>
                <span>{formatDateTimeWIB(booking.createdAt)}</span>
              </div>
              {(booking as any).proofUploadedAt && (
                <div className="flex justify-between">
                  <span>Bukti Bayar Diunggah:</span>
                  <span>{formatDateTimeWIB((booking as any).proofUploadedAt)}</span>
                </div>
              )}
              {(booking as any).verifiedAt && (
                <div className="flex justify-between">
                  <span>Pembayaran Diverifikasi:</span>
                  <span>{formatDateTimeWIB((booking as any).verifiedAt)}</span>
                </div>
              )}
              {booking.assignedAt && (
                <div className="flex justify-between">
                  <span>Terapis Ditugaskan:</span>
                  <span>{formatDateTimeWIB(booking.assignedAt)}</span>
                </div>
              )}
              {booking.acceptedAt && (
                <div className="flex justify-between">
                  <span>Terapis Menerima:</span>
                  <span>{formatDateTimeWIB(booking.acceptedAt)}</span>
                </div>
              )}
              {booking.onTheWayAt && (
                <div className="flex justify-between">
                  <span>Terapis Meluncur:</span>
                  <span>{formatDateTimeWIB(booking.onTheWayAt)}</span>
                </div>
              )}
              {booking.arrivedAt && (
                <div className="flex justify-between text-emerald-800 font-semibold">
                  <span>Tiba di Lokasi:</span>
                  <span>{formatDateTimeWIB(booking.arrivedAt)}</span>
                </div>
              )}
              {booking.treatmentStartedAt && (
                <div className="flex justify-between">
                  <span>Treatment Dimulai:</span>
                  <span>{formatDateTimeWIB(booking.treatmentStartedAt)}</span>
                </div>
              )}
              {booking.completedAt && (
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>Selesai (Completed):</span>
                  <span>{formatDateTimeWIB(booking.completedAt)}</span>
                </div>
              )}
              {(booking as any).cancelledAt && (
                <div className="flex justify-between text-rose-600 font-bold">
                  <span>Dibatalkan:</span>
                  <span>{formatDateTimeWIB((booking as any).cancelledAt)}</span>
                </div>
              )}
            </div>

            {booking.cancellationReason && (
              <div className="mt-2 p-2 bg-rose-50 rounded-lg text-rose-800 border border-rose-200">
                <span className="font-bold block">Alasan Pembatalan:</span>
                <span>{booking.cancellationReason}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
