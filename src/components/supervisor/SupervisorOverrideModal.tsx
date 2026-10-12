import React, { useState } from 'react';
import {
  X,
  SlidersHorizontal,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { Booking, BookingStatus } from '../../types';
import { supervisorOverrideStatus } from '../../lib/dbService';
import { useAuth } from '../../context/AuthContext';

interface SupervisorOverrideModalProps {
  booking: Booking | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const ALLOWED_OVERRIDE_STATUSES: { status: BookingStatus; label: string; desc: string }[] = [
  {
    status: 'Arrived',
    label: 'Arrived (Sudah Tiba di Lokasi)',
    desc: 'Gunakan jika terapis telah tiba namun sinyal GPS terhambat atau perangkat error.',
  },
  {
    status: 'Treatment',
    label: 'Treatment (Sesi Sedang Berjalan)',
    desc: 'Gunakan jika layanan pemijatan sudah dimulai oleh terapis.',
  },
  {
    status: 'Completed',
    label: 'Completed (Selesai Manual)',
    desc: 'Gunakan untuk menyelesaikan pesanan jika sesi telah berakhir dan diverifikasi.',
  },
  {
    status: 'Confirmed',
    label: 'Confirmed (Kembalikan ke Antrean Konfirmasi)',
    desc: 'Gunakan untuk me-reset status order ke siap penugasan.',
  },
];

export const SupervisorOverrideModal: React.FC<SupervisorOverrideModalProps> = ({
  booking,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { currentUser } = useAuth();
  const [selectedStatus, setSelectedStatus] = useState<BookingStatus>('Arrived');
  const [reason, setReason] = useState<string>('Verifikasi manual di lapangan oleh Supervisor');
  const [internalNote, setInternalNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  React.useEffect(() => {
    if (booking) {
      setSelectedStatus(booking.status === 'On The Way' ? 'Arrived' : 'Completed');
      setReason('Verifikasi manual di lapangan oleh Supervisor');
      setInternalNote('');
      setErrorMsg('');
    }
  }, [booking]);

  if (!isOpen || !booking) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMsg('Alasan override wajib diisi untuk catatan audit trail.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await supervisorOverrideStatus(
        booking,
        selectedStatus,
        currentUser?.name || 'Supervisor',
        reason,
        internalNote
      );
      onSuccess(`Status booking ${booking.bookingCode} berhasil di-override ke "${selectedStatus}".`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal melakukan override.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-3xl border border-slate-200 shadow-2xl overflow-hidden my-auto flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-amber-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-white">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg">
                Override Status Operasional
              </h3>
              <p className="text-xs text-amber-100 font-mono">
                Order #{booking.bookingCode} • Status Saat Ini: {booking.status}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              Tindakan ini akan <strong>mengubah status secara paksa</strong> dan tercatat permanen di <strong>Audit Trail Operasional</strong>. Pastikan Anda telah melakukan konfirmasi via telepon atau koordinasi lapangan.
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {/* Status Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-800 block">
              Pilih Status Baru yang Diinginkan:
            </label>
            <div className="space-y-2">
              {ALLOWED_OVERRIDE_STATUSES.map((item) => {
                const isSelected = selectedStatus === item.status;
                return (
                  <label
                    key={item.status}
                    className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                      isSelected
                        ? 'border-amber-600 bg-amber-50/60 ring-1 ring-amber-600'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="status"
                      value={item.status}
                      checked={isSelected}
                      onChange={() => setSelectedStatus(item.status)}
                      className="mt-1 accent-amber-700 cursor-pointer"
                    />
                    <div className="text-xs space-y-0.5">
                      <div className="font-bold text-slate-900">{item.label}</div>
                      <div className="text-slate-500 leading-tight">{item.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Reason Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-800 block">
              Alasan Override (Wajib dicatat di Audit Trail):
            </label>
            <input
              type="text"
              required
              placeholder="Contoh: Terapis sudah tiba di alamat, GPS HP mati karena baterai drop"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-600 bg-slate-50/50"
            />
          </div>

          {/* Internal Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-800 block">
              Catatan Tambahan Supervisor (Opsional):
            </label>
            <textarea
              rows={2}
              placeholder="Catatan verifikasi internal..."
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-600 bg-slate-50/50 resize-none"
            />
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
            >
              Batal
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>{isSubmitting ? 'Menyimpan Override...' : 'Simpan Override Status'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
