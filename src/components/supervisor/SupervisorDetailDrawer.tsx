import React, { useState, useEffect } from 'react';
import {
  X,
  Phone,
  MessageCircle,
  MapPin,
  Calendar,
  Clock,
  UserCheck,
  SlidersHorizontal,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  History,
  FileText,
  Send,
  ExternalLink,
} from 'lucide-react';
import { Booking, Therapist, BookingStatusHistory } from '../../types';
import { isPaymentPaid, getPaymentStatusBadgeStyle } from '../../lib/paymentService';
import {
  getBookingStatusHistory,
  supervisorAddInternalNote,
  supervisorResolveIssue,
} from '../../lib/dbService';
import { useAuth } from '../../context/AuthContext';

interface SupervisorDetailDrawerProps {
  booking: Booking | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenAssign: (booking: Booking) => void;
  onOpenOverride: (booking: Booking) => void;
  onRefresh?: () => void;
}

export const SupervisorDetailDrawer: React.FC<SupervisorDetailDrawerProps> = ({
  booking,
  isOpen,
  onClose,
  onOpenAssign,
  onOpenOverride,
  onRefresh,
}) => {
  const { currentUser } = useAuth();
  const [historyList, setHistoryList] = useState<BookingStatusHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [issueResolution, setIssueResolution] = useState('');
  const [isResolvingIssue, setIsResolvingIssue] = useState(false);
  const [successNotice, setSuccessNotice] = useState('');

  useEffect(() => {
    if (booking && isOpen) {
      setIsLoadingHistory(true);
      getBookingStatusHistory(booking.bookingCode)
        .then((hist) => setHistoryList(hist))
        .catch((err) => console.warn('History fetch notice:', err))
        .finally(() => setIsLoadingHistory(false));
      setNewNote('');
      setIssueResolution('');
      setSuccessNotice('');
    }
  }, [booking, isOpen]);

  if (!isOpen || !booking) return null;

  const isPaid = isPaymentPaid(booking.paymentStatus);
  const payBadge = getPaymentStatusBadgeStyle(booking.paymentStatus);
  const isTerminal = ['Completed', 'Cancelled'].includes(booking.status);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    setIsSavingNote(true);
    try {
      await supervisorAddInternalNote(
        booking.id,
        booking.bookingCode,
        newNote.trim(),
        currentUser?.name || 'Supervisor'
      );
      setSuccessNotice('Catatan internal berhasil ditambahkan.');
      setNewNote('');
      setTimeout(() => setSuccessNotice(''), 3000);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert(`Gagal menyimpan catatan: ${err.message || err}`);
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleResolveIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueResolution.trim()) return;

    setIsResolvingIssue(true);
    try {
      await supervisorResolveIssue(
        booking.id,
        booking.bookingCode,
        issueResolution.trim(),
        currentUser?.name || 'Supervisor'
      );
      setSuccessNotice('Kendala operasional berhasil diselesaikan.');
      setIssueResolution('');
      setTimeout(() => setSuccessNotice(''), 3000);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert(`Gagal menyelesaikan kendala: ${err.message || err}`);
    } finally {
      setIsResolvingIssue(false);
    }
  };

  const mapDestinationQuery =
    booking.latitude && booking.longitude
      ? `${booking.latitude},${booking.longitude}`
      : encodeURIComponent(`${booking.address}, ${booking.area}, Palembang`);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        {/* Drawer Header */}
        <div className="px-5 py-4 bg-[#082A4F] text-white flex items-center justify-between flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-base sm:text-lg text-[#D4AF37]">
                {booking.bookingCode}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-bold">
                {booking.status}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5 font-medium">
              {booking.serviceName} • Rp {booking.totalAmount.toLocaleString('id-ID')}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs text-slate-700">
          {successNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 font-semibold flex items-center gap-2 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* Quick Info Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-[#FAF9F6] rounded-2xl border border-slate-200">
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Tanggal</span>
              <strong className="text-slate-800 font-mono text-xs">
                {booking.scheduleDate}
              </strong>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Waktu WIB</span>
              <strong className="text-[#082A4F] font-mono text-xs">
                {booking.scheduleTime} WIB
              </strong>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Durasi Sesi</span>
              <strong className="text-slate-800 text-xs">
                {booking.serviceDuration} Menit
              </strong>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Pembayaran</span>
              <span
                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${payBadge.bg} ${payBadge.text} ${payBadge.border}`}
              >
                {payBadge.label}
              </span>
            </div>
          </div>

          {/* Customer & Location Card */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs text-[#082A4F] uppercase tracking-wider">
                Pelanggan & Lokasi Layanan
              </h4>
              <span className="text-[11px] font-bold text-[#082A4F]">
                Pref: {booking.genderPreference || 'Bebas'}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-900">{booking.customerName}</div>
              <div className="text-slate-500 font-mono flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{booking.customerWhatsApp}</span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl space-y-1.5">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-800">{booking.area}</div>
                  <div className="text-slate-600 leading-relaxed">{booking.address}</div>
                </div>
              </div>
              {booking.addressNotes && (
                <div className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                  <strong>Patokan:</strong> {booking.addressNotes}
                </div>
              )}
            </div>

            {/* External Links */}
            <div className="flex items-center gap-2 pt-1">
              <a
                href={`https://wa.me/${booking.customerWhatsApp.replace(/\D/g, '')}?text=Halo%20${encodeURIComponent(booking.customerName)},%20kami%20dari%20Supervisor%20Senzu%20Home%20mengenai%20pesanan%20${booking.bookingCode}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>WhatsApp Pelanggan</span>
              </a>

              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${mapDestinationQuery}`}
                target="_blank"
                rel="noreferrer"
                className="py-2 px-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1"
                title="Buka Navigasi Google Maps"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Navigasi Peta</span>
              </a>
            </div>
          </div>

          {/* Therapist Information */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs text-[#082A4F] uppercase tracking-wider">
                Terapis Ditugaskan
              </h4>
              {booking.therapistName ? (
                <span className="text-emerald-700 font-bold text-[11px] flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Ditugaskan</span>
                </span>
              ) : (
                <span className="text-amber-700 font-bold text-[11px] bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  Belum Ada Terapis
                </span>
              )}
            </div>

            {booking.therapistName ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                <div>
                  <div className="font-bold text-sm text-slate-900">{booking.therapistName}</div>
                  <div className="text-[11px] text-slate-500">Status Tugas: {booking.status}</div>
                </div>

                {!isTerminal && (
                  <button
                    type="button"
                    onClick={() => onOpenAssign(booking)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200 text-xs font-bold transition cursor-pointer"
                  >
                    Ganti Terapis
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between">
                <span className="text-xs text-amber-900">
                  {isPaid ? 'Pesanan siap ditugaskan ke terapis.' : 'Menunggu verifikasi pembayaran lunas.'}
                </span>

                {!isTerminal && (
                  <button
                    type="button"
                    onClick={() => onOpenAssign(booking)}
                    disabled={!isPaid}
                    className="px-3 py-1.5 rounded-lg bg-[#082A4F] text-white hover:bg-[#0E3D73] text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Tugaskan Sekarang
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Therapist Issue Report (Kendala Lapangan) */}
          {booking.issueReport && (
            <div className="p-4 rounded-2xl border border-rose-300 bg-rose-50/70 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xs text-rose-900">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>Kendala Lapangan: {booking.issueReport.category}</span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    (booking.issueReport as any).status === 'resolved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {(booking.issueReport as any).status === 'resolved' ? 'Selesai' : 'Perlu Solusi'}
                </span>
              </div>

              <div className="p-3 bg-white rounded-xl border border-rose-200 text-slate-800 leading-relaxed">
                "{booking.issueReport.note}"
              </div>

              {(booking.issueReport as any).status === 'resolved' ? (
                <div className="text-[11px] text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                  <strong>Solusi:</strong> {(booking.issueReport as any).resolutionNote}
                </div>
              ) : (
                <form onSubmit={handleResolveIssue} className="space-y-2 pt-1">
                  <input
                    type="text"
                    required
                    placeholder="Tuliskan tindakan/solusi supervisor..."
                    value={issueResolution}
                    onChange={(e) => setIssueResolution(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-rose-200 bg-white text-xs"
                  />
                  <button
                    type="submit"
                    disabled={isResolvingIssue || !issueResolution.trim()}
                    className="w-full py-2 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isResolvingIssue ? 'Menyelesaikan...' : 'Tandai Kendala Selesai'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Internal Supervisor Notes */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs text-[#082A4F] uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>Catatan Internal Supervisor</span>
              </h4>
              <span className="text-[10px] text-slate-400">Hanya staf internal</span>
            </div>

            {booking.internalNotes ? (
              <div className="p-3 bg-[#FAF9F6] rounded-xl border border-slate-200 text-slate-700 whitespace-pre-wrap leading-relaxed font-mono text-[11px]">
                {booking.internalNotes}
              </div>
            ) : (
              <p className="text-slate-400 italic text-[11px]">
                Belum ada catatan internal pada booking ini.
              </p>
            )}

            <form onSubmit={handleAddNote} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Tambahkan catatan internal..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#082A4F] bg-slate-50"
              />
              <button
                type="submit"
                disabled={isSavingNote || !newNote.trim()}
                className="p-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white transition cursor-pointer disabled:opacity-40"
                title="Kirim Catatan"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>

          {/* Audit Trail & Status History Timeline */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
            <h4 className="font-bold text-xs text-[#082A4F] uppercase tracking-wider flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              <span>Jejak Audit Status (Timeline)</span>
            </h4>

            {isLoadingHistory ? (
              <div className="py-4 text-center text-slate-400">Memuat riwayat status...</div>
            ) : historyList.length === 0 ? (
              <div className="py-4 text-center text-slate-400">Belum ada riwayat tercatat.</div>
            ) : (
              <div className="space-y-2.5 border-l-2 border-[#082A4F]/20 pl-3 ml-2">
                {(historyList || []).map((hist) => (
                  <div key={hist.id} className="relative space-y-0.5">
                    <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-[#082A4F]"></span>
                    <div className="flex items-center justify-between">
                      <strong className="text-slate-900 font-bold">{hist.status}</strong>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {hist.formattedWIB}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Oleh: <strong>{hist.updatedByName}</strong> ({hist.updatedByRole})
                    </div>
                    {hist.note && (
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-1.5 rounded mt-1">
                        {hist.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Bottom Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenOverride(booking)}
            className="px-3.5 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Override Operasional</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold transition cursor-pointer"
          >
            Tutup Drawer
          </button>
        </div>
      </div>
    </div>
  );
};
