import React, { useState } from 'react';
import { AlertCircle, X, Send, PhoneCall, CheckCircle2 } from 'lucide-react';
import { Booking } from '../types';
import { reportBookingIssue } from '../lib/dbService';
import { createCase } from '../lib/caseService';
import { useCustomerServiceWhatsApp, getWaMeTarget } from '../lib/supportWhatsApp';

interface TherapistIssueModalProps {
  booking: Booking;
  therapistId: string;
  therapistName: string;
  supervisorPhone?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const ISSUE_CATEGORIES = [
  'Customer tidak dapat dihubungi',
  'Alamat sulit ditemukan / akses tertutup',
  'Customer meminta perubahan layanan / durasi',
  'Kendala perjalanan / kendaraan / cuaca',
  'Kendala selama treatment',
  'Lainnya',
];

export const TherapistIssueModal: React.FC<TherapistIssueModalProps> = ({
  booking,
  therapistId,
  therapistName,
  supervisorPhone,
  onClose,
  onSuccess,
}) => {
  const [category, setCategory] = useState(ISSUE_CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Centralized Official Senzu WhatsApp
  const { isAvailable, whatsAppNumber, unavailableNotice } = useCustomerServiceWhatsApp();

  const activeSupervisorPhone =
    supervisorPhone &&
    !supervisorPhone.includes('1239876') &&
    !supervisorPhone.includes('1271710700')
      ? supervisorPhone
      : whatsAppNumber;

  const targetDigits = getWaMeTarget(activeSupervisorPhone);
  const supervisorWaUrl = targetDigits
    ? `https://wa.me/${targetDigits}?text=Halo%20Supervisor%20Senzu%2C%20saya%20${encodeURIComponent(
        therapistName
      )}%20ingin%20melaporkan%20kendala%20pesanan%20${encodeURIComponent(booking.bookingCode)}%3A%20${encodeURIComponent(
        category
      )}%20-%20${encodeURIComponent(note || 'Mohon bantuan.')}`
    : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) {
      alert('Mohon tuliskan penjelasan singkat kendala yang dialami.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Create unified operational case for Supervisor
      await createCase({
        caseType: 'THERAPIST_ISSUE',
        source: 'Therapist',
        booking: {
          id: booking.id,
          bookingCode: booking.bookingCode,
          customerId: booking.customerId,
          customerName: booking.customerName,
          customerWhatsApp: booking.customerWhatsApp,
          therapistId,
          therapistName,
          branchId: booking.branchId,
        },
        category,
        severity: category.includes('treatment') || category.includes('kendaraan') ? 'HIGH' : 'MEDIUM',
        summary: `${category}: ${note.trim().substring(0, 60)}`,
        description: note.trim(),
        reportedBy: therapistId,
        reportedByName: therapistName,
        assignedRole: 'Supervisor',
      });

      // 2. Keep backward compatibility with existing issue report
      await reportBookingIssue(
        booking.id,
        booking.bookingCode,
        booking.status,
        therapistId,
        therapistName,
        category,
        note.trim()
      );
      onSuccess(`Laporan kendala berhasil dikirimkan ke Supervisor & CSS.`);
      onClose();
    } catch (err) {
      console.error('Failed to report issue:', err);
      alert('Gagal mengirim laporan kendala. Silakan coba kembali atau hubungi Supervisor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-scale-in text-slate-800 space-y-4">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-[#082A4F]">Laporkan Kendala</h3>
              <p className="text-[11px] text-slate-500 font-mono">{booking.bookingCode} • {booking.customerName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Kategori Kendala:
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-[#082A4F] focus:border-transparent outline-none"
            >
              {ISSUE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Penjelasan Kendala:
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Jelaskan secara singkat kendala yang terjadi..."
              className="w-full text-xs p-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-[#082A4F] focus:border-transparent outline-none resize-none"
              required
            />
          </div>

          {/* Quick Direct Link to Supervisor */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs flex items-center justify-between gap-2">
            <span className="text-[11px] text-amber-900 leading-snug">
              Butuh bantuan darurat segera?
            </span>
            {isAvailable && supervisorWaUrl ? (
              <a
                href={supervisorWaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition shrink-0 active:scale-95 cursor-pointer"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>WA Supervisor</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => alert(unavailableNotice)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 text-slate-600 font-bold text-[11px] transition shrink-0 cursor-pointer"
                title={unavailableNotice}
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>WA Supervisor</span>
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="w-1/3 min-h-[46px] py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition active:scale-95 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-2/3 min-h-[46px] py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white text-xs font-bold flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50 cursor-pointer shadow-md shadow-[#082A4F]/20"
            >
              <Send className="w-4 h-4 text-[#D4AF37]" />
              <span>{isSubmitting ? 'Mengirim...' : 'Kirim Laporan'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
