import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  X,
  Send,
  CheckCircle2,
  Paperclip,
  Clock,
  ShieldCheck,
  MessageCircle,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { Booking } from '../../types';
import {
  COMPLAINT_CATEGORIES,
  ComplaintCategory,
  UnifiedCase,
  getCustomerFriendlyCaseStatus,
} from '../../types/case';
import { createCase, getCasesByBookingId } from '../../lib/caseService';
import { useCustomerServiceWhatsApp } from '../../lib/supportWhatsApp';
import { optimizeFileForFirestore } from '../../lib/imageOptimizer';

interface CustomerComplaintModalProps {
  booking: Booking;
  customerWhatsApp: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CustomerComplaintModal: React.FC<CustomerComplaintModalProps> = ({
  booking,
  customerWhatsApp,
  onClose,
  onSuccess,
}) => {
  const [existingCase, setExistingCase] = useState<UnifiedCase | null>(null);
  const [isLoadingExisting, setIsLoadingExisting] = useState(true);

  const [category, setCategory] = useState<ComplaintCategory>('Schedule issue');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentName, setAttachmentName] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedCase, setSubmittedCase] = useState<UnifiedCase | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const { isAvailable, openWhatsApp, whatsAppNumber } = useCustomerServiceWhatsApp();

  useEffect(() => {
    let isMounted = true;
    async function loadActiveCase() {
      setIsLoadingExisting(true);
      try {
        const cases = await getCasesByBookingId(booking.id);
        if (isMounted) {
          // Find most recent case
          if (cases.length > 0) {
            setExistingCase(cases[0]);
          }
        }
      } catch (err) {
        console.warn('Could not load existing cases for customer:', err);
      } finally {
        if (isMounted) setIsLoadingExisting(false);
      }
    }
    loadActiveCase();
    return () => {
      isMounted = false;
    };
  }, [booking.id]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert('Ukuran lampiran maksimal 15MB.');
      return;
    }

    try {
      setAttachmentName(file.name);
      const optimized = await optimizeFileForFirestore(file, {
        maxDimension: 1200,
        initialQuality: 0.75,
        maxOutputSizeBytes: 400 * 1024,
      });
      setAttachmentUrl(optimized.dataUrl);
    } catch (err: any) {
      alert(err?.message || 'Gagal memproses lampiran.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim() || !description.trim()) {
      setErrorMsg('Mohon isi judul dan penjelasan kendala.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const attachments = attachmentUrl
        ? [
            {
              id: `att_${Date.now()}`,
              name: attachmentName || 'lampiran_kendala.jpg',
              url: attachmentUrl,
              uploadedBy: customerWhatsApp || booking.customerWhatsApp || 'customer',
              uploadedByName: booking.customerName,
              uploadedAt: new Date().toISOString(),
              isCustomerVisible: true,
            },
          ]
        : undefined;

      const newCase = await createCase({
        caseType: 'COMPLAINT',
        source: 'Customer App',
        booking: {
          id: booking.id,
          bookingCode: booking.bookingCode,
          customerId: booking.customerId,
          customerName: booking.customerName,
          customerWhatsApp: booking.customerWhatsApp || customerWhatsApp,
          therapistId: booking.therapistId,
          therapistName: booking.therapistName,
          branchId: booking.branchId,
        },
        category,
        severity: category.includes('tidak datang') || category.includes('attitude') ? 'HIGH' : 'MEDIUM',
        summary: summary.trim(),
        description: description.trim(),
        reportedBy: customerWhatsApp || booking.customerWhatsApp || 'customer',
        reportedByName: booking.customerName,
        assignedRole: 'CSS',
        attachments,
      });

      setSubmittedCase(newCase);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Failed to submit customer complaint:', err);
      setErrorMsg(err.message || 'Gagal mengirim laporan kendala. Silakan coba kembali.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeDisplayCase = submittedCase || existingCase;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#8B5A36] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg">Bantuan & Kendala Layanan</h3>
              <p className="text-xs text-slate-300">
                {booking.serviceName} • {booking.bookingCode}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {isLoadingExisting ? (
            <div className="py-8 text-center text-sm text-slate-500">Memeriksa status laporan...</div>
          ) : activeDisplayCase && activeDisplayCase.status !== 'CLOSED' ? (
            /* VIEW ACTIVE CASE STATUS */
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-[#4B2B18]">
                    {activeDisplayCase.caseCode}
                  </span>
                  {(() => {
                    const badge = getCustomerFriendlyCaseStatus(activeDisplayCase.status);
                    return (
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${badge.bgClass} ${badge.textClass} ${badge.borderClass}`}
                      >
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>

                <div>
                  <h4 className="text-sm font-bold text-slate-800">{activeDisplayCase.summary}</h4>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-3">{activeDisplayCase.description}</p>
                </div>

                {activeDisplayCase.customerVisibleNote && (
                  <div className="mt-2 p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-700">
                    <span className="font-bold text-[#4B2B18] block mb-1">Catatan dari Tim Senzu:</span>
                    {activeDisplayCase.customerVisibleNote}
                  </div>
                )}

                <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
                  <Clock className="w-3.5 h-3.5" />
                  Dilaporkan pada: {new Date(activeDisplayCase.reportedAt).toLocaleString('id-ID')}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Tim Customer Service Senzu Home sedang memproses kendala Anda secara langsung. Kami akan
                  menghubungi Anda melalui WhatsApp resmi Senzu jika diperlukan koordinasi lebih lanjut.
                </p>
                {isAvailable && (
                  <button
                    type="button"
                    onClick={() =>
                      openWhatsApp(
                        `Halo CS Senzu Home, saya ingin menanyakan perkembangan penanganan kendala saya [${activeDisplayCase.caseCode}] pada pesanan ${booking.bookingCode}.`
                      )
                    }
                    className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition pt-1 cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" /> Hubungi CS via WhatsApp ({whatsAppNumber})
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 bg-[#8B5A36] hover:bg-[#94603B] text-white text-sm font-bold rounded-xl transition cursor-pointer"
              >
                Tutup
              </button>
            </div>
          ) : (
            /* NEW COMPLAINT FORM */
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Jenis Kendala:
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
                  className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-[#8B5A36] focus:border-transparent outline-none"
                >
                  {COMPLAINT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Judul Kendala Singkat:
                </label>
                <input
                  type="text"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Contoh: Terapis belum tiba melewati waktu yang dijadwalkan"
                  className="w-full text-xs p-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-[#8B5A36] focus:border-transparent outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Penjelasan Detail:
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mohon ceritakan kronologi atau hal yang perlu kami bantu secara lengkap..."
                  className="w-full text-xs p-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-[#8B5A36] focus:border-transparent outline-none resize-none"
                  required
                />
              </div>

              {/* Attachment */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Lampiran Foto / Screenshot (Opsional):
                </label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 cursor-pointer transition">
                    <Paperclip className="w-3.5 h-3.5" />
                    Pilih Berkas
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  {attachmentName && (
                    <span className="text-xs text-slate-600 truncate max-w-xs">{attachmentName}</span>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-[#8B5A36] hover:bg-[#94603B] text-white text-sm font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? (
                    'Mengirim Laporan...'
                  ) : (
                    <>
                      <Send className="w-4 h-4" /> Kirim Laporan Kendala
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
