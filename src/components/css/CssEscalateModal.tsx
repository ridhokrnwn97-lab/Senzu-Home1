import React, { useState } from 'react';
import { AlertTriangle, X, ShieldAlert, Send, ArrowUpRight } from 'lucide-react';
import { Booking } from '../../types';
import { cssEscalateToSupervisor } from '../../lib/dbService';
import { createCase } from '../../lib/caseService';

interface CssEscalateModalProps {
  isOpen: boolean;
  booking: Booking | null;
  onClose: () => void;
  onSuccess: () => void;
  cssStaffName: string;
  cssStaffId: string;
}

const ESCALATION_CATEGORIES = [
  'Terapis Tidak Dapat Dihubungi / No Respon',
  'Terapis Belum Tiba / Terlambat Signifikan',
  'Alamat Pelanggan Sulit / Tidak Ditemukan',
  'Pelanggan Komplain Keras / Menolak Treatment',
  'Pelanggan Meminta Reschedule Mendadak saat OTW',
  'Masalah Pembayaran / Butuh Otorisasi Khusus',
  'Kendala Kesehatan / Kontraindikasi Medis Pelanggan',
  'Terapis Mengalami Kendala Darurat / Kecelakaan',
  'Lainnya (Perlu Keputusan Supervisor)',
];

export const CssEscalateModal: React.FC<CssEscalateModalProps> = ({
  isOpen,
  booking,
  onClose,
  onSuccess,
  cssStaffName,
  cssStaffId,
}) => {
  const [category, setCategory] = useState(ESCALATION_CATEGORIES[0]);
  const [priority, setPriority] = useState<'CRITICAL' | 'HIGH' | 'NORMAL'>('HIGH');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen || !booking) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMsg('Alasan eskalasi wajib diisi.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await cssEscalateToSupervisor(booking, {
        category,
        priority,
        reason: reason.trim(),
        cssStaffName,
        cssStaffId,
      });

      // Synchronize to Unified Operational Case System
      try {
        await createCase({
          booking: {
            id: booking.id,
            bookingCode: booking.bookingCode,
            customerId: booking.customerId,
            customerName: booking.customerName,
            customerWhatsApp: booking.customerWhatsApp,
            therapistId: booking.therapistId,
            therapistName: booking.therapistName,
            branchId: booking.branchId,
          },
          caseType: 'INCIDENT',
          source: 'CSS',
          category,
          severity: priority === 'CRITICAL' ? 'CRITICAL' : priority === 'HIGH' ? 'HIGH' : 'MEDIUM',
          priority: priority === 'CRITICAL' ? 'CRITICAL' : priority === 'HIGH' ? 'HIGH' : 'NORMAL',
          summary: `[Eskalasi CSS] ${category}`,
          description: reason.trim(),
          reportedBy: cssStaffId,
          reportedByName: cssStaffName,
          assignedRole: 'Supervisor',
        });
      } catch (caseErr) {
        console.warn('Could not sync to unified cases collection:', caseErr);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to escalate to supervisor:', err);
      setErrorMsg(err?.message || 'Gagal mengirim eskalasi ke supervisor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="bg-[#8B5A36] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-400/30">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">
                Eskalasi ke Supervisor
              </span>
              <h4 className="font-mono text-base font-bold flex items-center gap-2">
                <span>{booking.bookingCode}</span>
                <span className="text-xs font-normal text-slate-300">({booking.customerName})</span>
              </h4>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1 text-slate-700">
            <div className="flex justify-between">
              <span className="text-slate-500">Jadwal:</span>
              <span className="font-semibold text-[#4B2B18]">
                {booking.scheduleDate} - {booking.scheduleTime} WIB
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Terapis:</span>
              <span className="font-semibold">
                {booking.therapistName || <span className="italic text-slate-400">Belum Assigned</span>}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status Saat Ini:</span>
              <span className="font-bold text-slate-800">{booking.status}</span>
            </div>
          </div>

          {/* Kategori */}
          <div>
            <label className="block font-bold text-slate-800 mb-1">
              Kategori Kendala Operasional:
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36] bg-white font-medium text-slate-800"
            >
              {ESCALATION_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Tingkat Prioritas */}
          <div>
            <label className="block font-bold text-slate-800 mb-1.5">
              Tingkat Prioritas:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPriority('CRITICAL')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  priority === 'CRITICAL'
                    ? 'bg-red-500 text-white border-red-600 shadow-sm shadow-red-200'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                CRITICAL
              </button>
              <button
                type="button"
                onClick={() => setPriority('HIGH')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  priority === 'HIGH'
                    ? 'bg-amber-500 text-white border-amber-600 shadow-sm shadow-amber-200'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                HIGH
              </button>
              <button
                type="button"
                onClick={() => setPriority('NORMAL')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  priority === 'NORMAL'
                    ? 'bg-blue-600 text-white border-blue-700 shadow-sm shadow-blue-200'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                NORMAL
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {priority === 'CRITICAL' && 'Gunakan jika jadwal < 60 menit, darurat lapangan, atau komplain eskalatif.'}
              {priority === 'HIGH' && 'Gunakan bila butuh keputusan cepat dari supervisor dalam 1-2 jam.'}
              {priority === 'NORMAL' && 'Koordinasi berkala tanpa resiko pembatalan mendesak.'}
            </p>
          </div>

          {/* Alasan & Konteks */}
          <div>
            <label className="block font-bold text-slate-800 mb-1">
              Keterangan Lengkap & Rekomendasi Tindakan:
            </label>
            <textarea
              rows={4}
              placeholder="Contoh: Customer komplain terapis terlambat 30 menit dan minta ganti terapis atau reschedule. Sudah coba hubungi terapis namun ponsel tidak aktif..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36]"
            />
          </div>

          <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/60 text-amber-800 text-[11px] flex items-start gap-2">
            <ArrowUpRight className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
            <div>
              Eskalasi ini akan langsung muncul di <strong>Supervisor Control Room</strong> sebagai radar siaga. Status tiket akan menjadi <em>Waiting Supervisor</em>.
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-sm shadow-red-200"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Mengirim...' : 'Kirim Eskalasi ke Supervisor'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
