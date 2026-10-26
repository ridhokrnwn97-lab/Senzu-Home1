import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  User,
  X,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { Therapist, Booking } from '../../../types';
import { setTherapistUnavailableRange } from '../../../lib/rosterService';

interface UnavailableRangeModalProps {
  isOpen: boolean;
  therapist: Therapist | null;
  defaultDate?: string;
  allBookings?: Booking[];
  bookings?: Booking[];
  actorName?: string;
  onClose: () => void;
  onSaved?: () => void;
  onSuccess?: (msg: string) => Promise<void> | void;
  onOpenReassignment?: (booking: Booking) => void;
  onOpenAssignModal?: (booking: Booking) => void;
}

const REASONS = [
  'Sakit',
  'Izin',
  'Keperluan Pribadi',
  'Emergency',
  'Operational Hold',
  'Lainnya',
];

export const UnavailableRangeModal: React.FC<UnavailableRangeModalProps> = ({
  isOpen,
  therapist,
  defaultDate,
  allBookings = [],
  bookings = [],
  actorName = 'Supervisor Operasional',
  onClose,
  onSaved,
  onSuccess,
  onOpenReassignment,
  onOpenAssignModal,
}) => {
  if (!isOpen || !therapist) return null;

  const resolvedBookings = allBookings.length > 0 ? allBookings : bookings;

  const todayStr = useMemo(() => defaultDate || new Date().toISOString().split('T')[0], [defaultDate]);
  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [statusType, setStatusType] = useState<'unavailable' | 'leave' | 'off'>('unavailable');
  const [reason, setReason] = useState<string>('Sakit');
  const [customReason, setCustomReason] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Detect affected bookings in the date range
  const affectedBookings = useMemo(() => {
    if (!startDate || !endDate) return [];
    return (resolvedBookings || []).filter(
      (b) =>
        b &&
        b.therapistId === therapist.id &&
        b.scheduleDate >= startDate &&
        b.scheduleDate <= endDate &&
        b.status !== 'Cancelled' &&
        b.status !== 'Completed'
    );
  }, [resolvedBookings, therapist.id, startDate, endDate]);

  const handleSave = async () => {
    if (startDate > endDate) {
      setError('Tanggal mulai tidak boleh lebih lambat daripada tanggal selesai.');
      return;
    }

    const effectiveReason = reason === 'Lainnya' ? customReason || 'Keperluan Lain' : reason;

    try {
      setIsSaving(true);
      await setTherapistUnavailableRange(
        therapist.id,
        therapist.name,
        startDate,
        endDate,
        statusType,
        effectiveReason,
        note,
        actorName
      );
      if (onSaved) onSaved();
      if (onSuccess) await onSuccess(`Status tidak tersedia untuk ${therapist.name} berhasil disimpan.`);
      onClose();
    } catch (err: any) {
      console.error('Failed to set unavailable range:', err);
      setError('Gagal memperbarui status: ' + (err.message || 'Kesalahan jaringan'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-rose-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 text-rose-200">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-rose-200 uppercase tracking-wider">
                Status Ketidakhadiran
              </span>
              <h2 className="text-base sm:text-lg font-bold font-serif text-white mt-0.5">
                Tandai Tidak Tersedia: {therapist.name}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-rose-200 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Status Selection */}
          <div>
            <label className="font-bold text-slate-700 block mb-1.5">Tipe Status:</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStatusType('unavailable')}
                className={`p-2.5 rounded-xl border font-bold text-center transition cursor-pointer ${
                  statusType === 'unavailable'
                    ? 'bg-rose-50 border-rose-500 text-rose-800 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Unavailable / Kendala
              </button>
              <button
                type="button"
                onClick={() => setStatusType('leave')}
                className={`p-2.5 rounded-xl border font-bold text-center transition cursor-pointer ${
                  statusType === 'leave'
                    ? 'bg-amber-50 border-amber-500 text-amber-800 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Izin / Cuti
              </button>
              <button
                type="button"
                onClick={() => setStatusType('off')}
                className={`p-2.5 rounded-xl border font-bold text-center transition cursor-pointer ${
                  statusType === 'off'
                    ? 'bg-slate-100 border-slate-500 text-slate-800 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Off Duty (Libur)
              </button>
            </div>
          </div>

          {/* Date Range Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Tanggal Mulai:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Tanggal Selesai:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
              />
            </div>
          </div>

          {/* Reason Selection */}
          <div>
            <label className="font-bold text-slate-700 block mb-1.5">Alasan:</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`px-3 py-2 rounded-xl border text-left font-semibold transition cursor-pointer text-[11px] ${
                    reason === r
                      ? 'bg-[#8B5A36] text-white border-[#8B5A36]'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            {reason === 'Lainnya' && (
              <input
                type="text"
                placeholder="Tulis alasan spesifik..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="mt-2 w-full p-2.5 rounded-xl border border-slate-300 text-xs"
              />
            )}
          </div>

          {/* Additional Notes */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Catatan Internal Supervisor:
            </label>
            <textarea
              rows={2}
              placeholder="Catatan tambahan (cth: konfirmasi via WhatsApp, izin disetujui Pak Wahyu)..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-300 text-xs"
            />
          </div>

          {/* Impact on Bookings Alert (Prompt 25) */}
          {affectedBookings.length > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
              <div className="flex items-center gap-2 text-amber-900 font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Peringatan: {affectedBookings.length} Pesanan Terdampak</span>
              </div>
              <p className="text-[11px] text-amber-800">
                Terapis memiliki pesanan aktif pada rentang tanggal tersebut. Anda disarankan meninjau dan mengalihkan pesanan ke terapis lain.
              </p>

              <div className="max-h-36 overflow-y-auto space-y-1.5 pt-1">
                {(affectedBookings || []).map((b) => (
                  <div
                    key={b.id}
                    className="p-2 rounded-lg bg-white border border-amber-200 flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#4B2B18]">
                        {b.bookingCode}
                      </span>
                      <span className="text-slate-600">
                        {b.scheduleDate} • {b.scheduleTime} WIB
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        (onOpenAssignModal || onOpenReassignment)?.(b);
                      }}
                      className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    >
                      <span>Reassign</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
          >
            Batal
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4 text-white" />
            <span>{isSaving ? 'Menyimpan Status...' : 'Simpan Status Unavailable'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
