import React, { useState } from 'react';
import {
  X,
  Star,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Heart,
  MessageSquare
} from 'lucide-react';
import { Booking } from '../types';
import { CustomerReview, REVIEW_TAG_OPTIONS } from '../types/crm';
import { submitCustomerReview } from '../lib/crmService';

interface CustomerReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking;
  existingReview?: CustomerReview | null;
  onReviewSubmitted?: (review: CustomerReview) => void;
}

export const CustomerReviewModal: React.FC<CustomerReviewModalProps> = ({
  isOpen,
  onClose,
  booking,
  existingReview,
  onReviewSubmitted,
}) => {
  const [overallRating, setOverallRating] = useState<number>(existingReview?.overallRating || 5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  
  // Detailed dimensions
  const [serviceRating, setServiceRating] = useState<number>(existingReview?.serviceRating || 5);
  const [professionalismRating, setProfessionalismRating] = useState<number>(existingReview?.professionalismRating || 5);
  const [punctualityRating, setPunctualityRating] = useState<number>(existingReview?.punctualityRating || 5);
  const [hygieneRating, setHygieneRating] = useState<number>(existingReview?.hygieneRating || 5);
  const [showDetailedRatings, setShowDetailedRatings] = useState<boolean>(false);

  const [selectedTags, setSelectedTags] = useState<string[]>(existingReview?.tags || []);
  const [comment, setComment] = useState<string>(existingReview?.comment || '');
  const [isAnonymous, setIsAnonymous] = useState<boolean>(existingReview?.isAnonymous || false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  if (!isOpen) return null;

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (overallRating < 1 || overallRating > 5) {
      setErrorMsg('Silakan pilih rating 1 sampai 5 bintang.');
      return;
    }

    setIsSubmitting(true);
    try {
      const review = await submitCustomerReview({
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        customerId: booking.customerId || `cust_${booking.customerWhatsApp.replace(/[^0-9]/g, '')}`,
        customerName: booking.customerName,
        therapistId: booking.therapistId,
        therapistName: booking.therapistName,
        serviceId: booking.serviceId,
        serviceName: booking.serviceName,
        overallRating,
        serviceRating: showDetailedRatings ? serviceRating : overallRating,
        professionalismRating: showDetailedRatings ? professionalismRating : overallRating,
        punctualityRating: showDetailedRatings ? punctualityRating : overallRating,
        hygieneRating: showDetailedRatings ? hygieneRating : overallRating,
        comment: comment.trim(),
        tags: selectedTags,
        isAnonymous,
        publishApproved: true,
        publishAnonymously: isAnonymous,
        status: 'active',
      });

      setIsSuccess(true);
      if (onReviewSubmitted) {
        onReviewSubmitted(review);
      }
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
      }, 2000);
    } catch (err: any) {
      console.error('Submit review error:', err);
      setErrorMsg(err.message || 'Gagal menyimpan ulasan. Silakan coba kembali.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#8B5A36] to-[#94603B] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center">
              <Star className="w-5 h-5 text-[#D4AF37] fill-[#D4AF37]" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg">Penilaian Layanan</h3>
              <p className="text-xs text-slate-300">
                {booking.serviceName} • {booking.bookingCode}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {isSuccess ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h4 className="text-lg font-bold text-[#4B2B18] font-serif">
              Terima Kasih Atas Ulasan Anda!
            </h4>
            <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
              Masukan Anda sangat berharga untuk menjaga standar kenyamanan dan higienitas layanan
              Senzu Home Palembang.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Therapist Info */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                  Terapis Yang Bertugas
                </span>
                <span className="font-bold text-slate-800 text-sm">
                  {booking.therapistName || 'Terapis Senzu Home'}
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold text-[11px] border border-emerald-200">
                Treatment Selesai
              </span>
            </div>

            {/* Star Rating Picker */}
            <div className="text-center space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Bagaimana pengalaman treatment Anda secara keseluruhan?
              </label>
              <div className="flex items-center justify-center gap-2 py-2">
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = (hoverRating || overallRating) >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setOverallRating(star)}
                      className="p-1 focus:outline-none transition-transform hover:scale-125 cursor-pointer"
                    >
                      <Star
                        className={`w-8 h-8 sm:w-9 sm:h-9 ${
                          active
                            ? 'text-amber-400 fill-amber-400 drop-shadow-sm'
                            : 'text-slate-200 fill-slate-100'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="text-xs font-semibold text-[#4B2B18]">
                {overallRating === 5 && '⭐️⭐️⭐️⭐️⭐️ Luar Biasa & Sangat Memuaskan'}
                {overallRating === 4 && '⭐️⭐️⭐️⭐️ Sangat Bagus & Nyaman'}
                {overallRating === 3 && '⭐️⭐️⭐️ Cukup Baik'}
                {overallRating === 2 && '⭐️⭐️ Kurang Memuaskan'}
                {overallRating === 1 && '⭐️ Perlu Perbaikan Nyata'}
              </div>
            </div>

            {/* Low rating reassurance */}
            {overallRating <= 2 && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-800">
                  <ShieldCheck className="w-4 h-4 text-amber-600" />
                  Komitmen Jaminan Layanan Senzu
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Kami sangat memprioritaskan kenyamanan Anda. Masukan ini akan langsung diteruskan ke
                  tim Quality & Supervisor Senzu untuk evaluasi dan tindak lanjut segera.
                </p>
              </div>
            )}

            {/* Quick Feedback Tags */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Hal yang paling Anda sukai:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REVIEW_TAG_OPTIONS.map((tag) => {
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#8B5A36] text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      {isSelected ? '✓ ' : '+ '}
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Comment Textarea */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Catatan Tambahan (Opsional):</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  {comment.length}/500
                </span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Ceritakan pengalaman Anda, tekanan pijatan, atau kesan selama treatment..."
                className="w-full p-3 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#8B5A36] focus:border-transparent"
              />
            </div>

            {/* Detailed Dimensions Accordion (Optional) */}
            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowDetailedRatings(!showDetailedRatings)}
                className="text-xs text-[#4B2B18] font-semibold flex items-center gap-1 hover:underline cursor-pointer"
              >
                <span>{showDetailedRatings ? '− Sembunyikan' : '+ Berikan Nilai Rinci Tiap Aspek'}</span>
              </button>

              {showDetailedRatings && (
                <div className="mt-3 space-y-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Teknik & Kualitas Pijat:</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setServiceRating(s)}
                          className={`w-6 h-6 rounded text-[11px] font-bold ${
                            serviceRating >= s ? 'bg-amber-400 text-slate-900' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Sikap & Profesionalitas:</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setProfessionalismRating(s)}
                          className={`w-6 h-6 rounded text-[11px] font-bold ${
                            professionalismRating >= s ? 'bg-amber-400 text-slate-900' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Ketepatan Waktu:</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPunctualityRating(s)}
                          className={`w-6 h-6 rounded text-[11px] font-bold ${
                            punctualityRating >= s ? 'bg-amber-400 text-slate-900' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Kebersihan & Higienitas:</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setHygieneRating(s)}
                          className={`w-6 h-6 rounded text-[11px] font-bold ${
                            hygieneRating >= s ? 'bg-amber-400 text-slate-900' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Anonymous Toggle */}
            <div className="flex items-center gap-2 pt-1">
              <input
                id="check-anon"
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="w-4 h-4 rounded text-[#4B2B18] focus:ring-[#8B5A36] border-slate-300"
              />
              <label htmlFor="check-anon" className="text-xs text-slate-600 cursor-pointer select-none">
                Sembunyikan nama lengkap saya (Tampilkan sebagai anonim)
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B89628] hover:from-[#E5C158] hover:to-[#C9A432] text-[#4B2B18] text-xs font-bold shadow-md transition disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <span>Menyimpan Ulasan...</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Kirim Penilaian</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
