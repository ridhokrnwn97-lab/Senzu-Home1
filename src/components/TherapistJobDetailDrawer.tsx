import React from 'react';
import {
  X,
  MapPin,
  Phone,
  MessageCircle,
  Navigation,
  Clock,
  Calendar,
  AlertCircle,
  Check,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { Booking, BookingStatus } from '../types';
import { TherapistTreatmentTimer } from './TherapistTreatmentTimer';
import { ChatButtonWithBadge } from './chat/ChatButtonWithBadge';

export interface TherapistJobDetailDrawerProps {
  booking: Booking | null;
  isOpen: boolean;
  onClose: () => void;
  onNextStatus: (booking: Booking, nextStatus: BookingStatus) => void;
  isUpdating?: boolean;
  onReportIssue?: (booking: Booking) => void;
  therapistName?: string;
  liveLocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    lastSentTime: string;
  } | null;
  onConfirmStartTreatment?: (booking: Booking) => void;
  isCsAvailable?: boolean;
  getCsWhatsAppUrl?: (msg: string) => string;
  csUnavailableNotice?: string;
  onOpenChat?: (booking: Booking) => void;
}

export const TherapistJobDetailDrawer: React.FC<TherapistJobDetailDrawerProps> = ({
  booking,
  isOpen,
  onClose,
  onNextStatus,
  isUpdating = false,
  onReportIssue,
  therapistName,
  liveLocation,
  onConfirmStartTreatment,
  isCsAvailable = false,
  getCsWhatsAppUrl,
  csUnavailableNotice,
  onOpenChat,
}) => {
  if (!isOpen || !booking) return null;

  const isAssigned =
    booking.status === 'Therapist Assigned' ||
    (booking.status as any) === 'Assigned' ||
    (booking.status as any) === 'therapist_assigned';

  const getMapsUrl = (b: Booking) => {
    if (b.latitude != null && b.longitude != null) {
      return `https://www.google.com/maps/dir/?api=1&destination=${b.latitude},${b.longitude}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      (b.address || '') + ', ' + (b.area || '') + ', Palembang'
    )}`;
  };

  const getWazeUrl = (b: Booking) => {
    if (b.latitude != null && b.longitude != null) {
      return `https://waze.com/ul?ll=${b.latitude},${b.longitude}&navigate=yes`;
    }
    return null;
  };

  const safeCustomerName = booking.customerName || 'Pelanggan';
  const safeCustomerWhatsApp = booking.customerWhatsApp || '';

  return (
    <div
      id="job-detail-drawer-overlay"
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex justify-end animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id={`job-detail-drawer-${booking.bookingCode}`}
        className="w-full max-w-lg bg-white h-full overflow-y-auto flex flex-col shadow-2xl z-50 text-slate-900 border-l border-slate-200"
      >
        {/* Drawer Sticky Top Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#4B2B18] block">
              Detail Tugas Pesanan
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <h2 className="font-mono font-bold text-base text-slate-900">
                {booking.bookingCode}
              </h2>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  isAssigned
                    ? 'bg-purple-100 text-purple-800'
                    : booking.status === 'Accepted'
                    ? 'bg-blue-100 text-blue-800'
                    : booking.status === 'On The Way'
                    ? 'bg-amber-100 text-amber-800'
                    : booking.status === 'Arrived'
                    ? 'bg-teal-100 text-teal-800'
                    : booking.status === 'Treatment'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {booking.status}
              </span>
            </div>
          </div>

          <button
            id="btn-close-job-detail"
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 hover:text-slate-900 flex items-center justify-center transition cursor-pointer"
            aria-label="Tutup Detail"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body Content */}
        <div className="p-5 space-y-4 flex-1">
          {/* Status Alert Banner */}
          <div
            className={`p-4 rounded-2xl text-white shadow-md flex items-center justify-between gap-3 ${
              isAssigned
                ? 'bg-gradient-to-r from-purple-700 to-purple-900 border border-purple-400'
                : booking.status === 'Accepted'
                ? 'bg-gradient-to-r from-blue-700 to-blue-900 border border-blue-400'
                : booking.status === 'On The Way'
                ? 'bg-gradient-to-r from-amber-600 to-amber-800 border border-amber-400'
                : booking.status === 'Arrived'
                ? 'bg-gradient-to-r from-teal-700 to-teal-900 border border-teal-400'
                : 'bg-gradient-to-r from-emerald-700 to-emerald-900 border border-emerald-400'
            }`}
          >
            <div>
              <span className="text-[10px] uppercase tracking-widest text-[#D4AF37] font-bold block">
                STATUS TUGAS
              </span>
              <div className="font-serif font-bold text-base leading-tight mt-0.5">
                {isAssigned
                  ? 'Pesanan Baru Ditugaskan'
                  : booking.status === 'Accepted'
                  ? 'Pesanan Diterima (Siap Berangkat)'
                  : booking.status === 'On The Way'
                  ? 'Menuju Lokasi Customer'
                  : booking.status === 'Arrived'
                  ? 'Anda Telah Tiba di Lokasi'
                  : booking.status === 'Treatment'
                  ? 'Treatment Berlangsung'
                  : 'Selesai'}
              </div>
            </div>
          </div>

          {/* Special View: Live Treatment Timer */}
          {booking.status === 'Treatment' && booking.treatmentStartedAt && (
            <TherapistTreatmentTimer
              startedAt={booking.treatmentStartedAt}
              durationMinutes={booking.serviceDuration}
              serviceName={booking.serviceName}
              onComplete={() => onNextStatus(booking, 'Completed')}
              isProcessing={isUpdating}
            />
          )}

          {/* Special Notice for On The Way */}
          {booking.status === 'On The Way' && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3 shadow-2xs">
              <Navigation className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <strong className="block text-xs font-bold text-amber-950">
                  Tracking GPS Aktif
                </strong>
                <p className="mt-0.5 text-amber-800 leading-relaxed text-[11px]">
                  Untuk tracking optimal, biarkan layar Senzu Home tetap menyala saat berkendara.
                  {liveLocation
                    ? ` Sinyal: ±${liveLocation.accuracy}m (${liveLocation.lastSentTime})`
                    : ' Mendeteksi titik GPS...'}
                </p>
              </div>
            </div>
          )}

          {/* Service & Schedule Box */}
          <div className="bg-[#FAF9F6] p-4 rounded-2xl border border-slate-200 space-y-2.5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-[#4B2B18] text-base leading-tight">
                  {booking.serviceName}
                </h3>
                <div className="flex items-center gap-2 mt-1.5 text-slate-600 text-xs font-medium">
                  <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{booking.serviceDuration} Menit Durasi</span>
                  <span>•</span>
                  <Calendar className="w-3.5 h-3.5 text-[#4B2B18]" />
                  <span>
                    {booking.scheduleDate}, {booking.scheduleTime} WIB
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Customer Info & Contact */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#8B5A36]/10 flex items-center justify-center text-[#4B2B18] font-bold text-sm">
                  {safeCustomerName.charAt(0)}
                </div>
                <div>
                  <span className="font-bold text-slate-900 text-sm block">
                    {safeCustomerName}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {safeCustomerWhatsApp || '-'}
                  </span>
                </div>
              </div>

              {/* Contact Actions */}
              <div className="flex items-center gap-2">
                {onOpenChat && (
                  <ChatButtonWithBadge
                    booking={booking}
                    userRole="therapist"
                    onOpenChat={onOpenChat}
                    variant="button"
                    label="Chat Customer"
                  />
                )}
                {safeCustomerWhatsApp && (
                  <>
                    <a
                      href={`tel:${safeCustomerWhatsApp.replace(/[^0-9+]/g, '')}`}
                      className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-300 text-slate-700 flex items-center justify-center hover:bg-slate-100 transition active:scale-95 shadow-2xs"
                      title="Telepon Customer"
                    >
                      <Phone className="w-4 h-4 text-emerald-600" />
                    </a>
                    <a
                      href={`https://wa.me/${safeCustomerWhatsApp.replace(/[^0-9]/g, '')}?text=Halo%20${encodeURIComponent(
                        safeCustomerName
                      )}%2C%20saya%20${encodeURIComponent(
                        therapistName || 'Terapis'
                      )}%20dari%20Senzu%20Home.`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition active:scale-95 shadow-2xs"
                      title="Chat WhatsApp Customer"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Address & Navigation */}
            <div className="pt-2.5 border-t border-slate-100 text-xs text-slate-700 space-y-2">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold text-slate-900">{booking.area}: </span>
                  <span>{booking.address}</span>
                </div>
              </div>

              {booking.addressNotes && (
                <div className="ml-6 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <strong className="text-slate-800">Patokan / Landmark: </strong>
                  {booking.addressNotes}
                </div>
              )}

              {/* Navigation Links */}
              <div className="pt-1 flex flex-wrap gap-2">
                <a
                  href={getMapsUrl(booking)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 text-xs font-bold text-[#4B2B18] bg-white border-2 border-[#8B5A36]/20 hover:border-[#8B5A36] px-4 py-2.5 rounded-xl transition shadow-2xs active:scale-95 cursor-pointer"
                >
                  <Navigation className="w-4 h-4 text-[#D4AF37]" />
                  <span>Buka Google Maps</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>

                {getWazeUrl(booking) && (
                  <a
                    href={getWazeUrl(booking)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-2xs hover:bg-slate-50 active:scale-95 cursor-pointer"
                  >
                    <span>Waze</span>
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Customer Wellness Notes */}
          {booking.customerNotes && (
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900">
              <strong className="block font-bold">Catatan Khusus Pelanggan:</strong>
              <p className="mt-1 text-[11px] leading-relaxed">{booking.customerNotes}</p>
            </div>
          )}

          {/* Operational Payment Policy */}
          <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-bold text-emerald-900">Pembayaran Lunas Non-Tunai</span>
            </div>
            <span className="text-[10px] text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full font-semibold">
              Dilarang Terima Uang Tunai
            </span>
          </div>

          {/* Emergency & CS Assistance */}
          <div className="pt-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100">
            {onReportIssue && (
              <button
                type="button"
                onClick={() => onReportIssue(booking)}
                className="inline-flex items-center gap-1.5 text-amber-700 hover:text-amber-800 font-bold cursor-pointer min-h-[44px] px-2"
              >
                <AlertCircle className="w-4 h-4" />
                <span>Laporkan Kendala</span>
              </button>
            )}

            {isCsAvailable && getCsWhatsAppUrl ? (
              <a
                href={getCsWhatsAppUrl(
                  `Halo Supervisor / CS Senzu, saya butuh bantuan untuk booking ${booking.bookingCode}`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[#4B2B18] hover:text-[#633C24] font-bold min-h-[44px] px-2 cursor-pointer"
              >
                <HelpCircle className="w-4 h-4 text-[#D4AF37]" />
                <span>Hubungi CS / SPV</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => alert(csUnavailableNotice || 'CS sedang tidak bertugas.')}
                className="inline-flex items-center gap-1.5 text-slate-500 font-bold min-h-[44px] px-2 cursor-pointer"
              >
                <HelpCircle className="w-4 h-4 text-slate-400" />
                <span>Hubungi CS / SPV</span>
              </button>
            )}
          </div>
        </div>

        {/* Drawer Sticky Footer with Primary Action */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 shadow-lg z-10">
          {isAssigned && (
            <button
              id="btn-terima-tugas"
              type="button"
              disabled={isUpdating}
              onClick={() => onNextStatus(booking, 'Accepted')}
              className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-purple-700 hover:bg-purple-800 active:bg-purple-900 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-purple-900/30 cursor-pointer disabled:opacity-50"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-purple-200" />
                  <span>Menerima Tugas...</span>
                </>
              ) : (
                <>
                  <Check className="w-5 h-5 text-purple-200" />
                  <span>TERIMA TUGAS</span>
                </>
              )}
            </button>
          )}

          {booking.status === 'Accepted' && (
            <button
              id="btn-mulai-perjalanan"
              type="button"
              disabled={isUpdating}
              onClick={() => onNextStatus(booking, 'On The Way')}
              className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-amber-900/30 cursor-pointer disabled:opacity-50"
            >
              <Navigation className="w-5 h-5 text-amber-200" />
              <span>
                {isUpdating ? 'Memeriksa GPS...' : 'MULAI PERJALANAN (ON THE WAY)'}
              </span>
            </button>
          )}

          {booking.status === 'On The Way' && (
            <button
              id="btn-sudah-tiba"
              type="button"
              disabled={isUpdating}
              onClick={() => onNextStatus(booking, 'Arrived')}
              className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-teal-900/30 cursor-pointer disabled:opacity-50"
            >
              <MapPin className="w-5 h-5 text-teal-200" />
              <span>{isUpdating ? 'Validasi Lokasi...' : 'SAYA SUDAH TIBA'}</span>
            </button>
          )}

          {booking.status === 'Arrived' && (
            <button
              id="btn-mulai-treatment"
              type="button"
              disabled={isUpdating}
              onClick={() => onConfirmStartTreatment?.(booking)}
              className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-[#8B5A36] hover:bg-[#94603B] active:bg-[#3D2315] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-[#8B5A36]/30 cursor-pointer disabled:opacity-50"
            >
              <Clock className="w-5 h-5 text-[#D4AF37]" />
              <span>MULAI TREATMENT</span>
            </button>
          )}

          {booking.status === 'Treatment' && (
            <div className="text-center text-xs text-slate-500 py-1">
              Gunakan timer di atas untuk menyelesaikan treatment.
            </div>
          )}

          {booking.status === 'Completed' && (
            <div className="text-center text-xs font-bold text-emerald-700 py-2 bg-emerald-50 rounded-xl border border-emerald-200">
              Treatment ini telah selesai dilakukan.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
