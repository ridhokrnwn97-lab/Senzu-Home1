import React from 'react';
import { Star, Award, AlertTriangle, CheckCircle2, Gift, CreditCard, ShieldAlert } from 'lucide-react';
import { RatingReportMetrics, PaymentMetricsRow } from '../../../lib/reportingService';
import { CustomerReview } from '../../../types/crm';
import { formatRupiah } from '../../../lib/utils';

interface RatingAndLoyaltySectionProps {
  ratingMetrics: RatingReportMetrics;
  paymentMetrics: PaymentMetricsRow[];
  reviews: CustomerReview[];
}

export const RatingAndLoyaltySection: React.FC<RatingAndLoyaltySectionProps> = ({
  ratingMetrics,
  paymentMetrics = [],
  reviews = [],
}) => {
  const safeReviews = reviews || [];
  const safePaymentMetrics = paymentMetrics || [];

  const lowRatingReviews = safeReviews.filter(
    (r) => r.overallRating && r.overallRating <= (ratingMetrics?.lowRatingThreshold || 3) && r.status !== 'hidden'
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Column 1: Rating Kepuasan & Pemulihan Layanan */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-[#4B2B18] text-base flex items-center gap-2">
              <Star className="w-4 h-4 text-[#B89628] fill-amber-400" />
              Rating Kepuasan &amp; Service Recovery
            </h3>
            <p className="text-xs text-slate-500">
              Evaluasi ulasan pelanggan dan tindak lanjut rating rendah (≤{ratingMetrics.lowRatingThreshold}★)
            </p>
          </div>
          {ratingMetrics.averageRating !== null && (
            <div className="text-right">
              <div className="text-2xl font-bold text-[#4B2B18] flex items-center gap-1 justify-end">
                <span>{ratingMetrics.averageRating}</span>
                <span className="text-xs text-slate-400 font-normal">/ 5.0</span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">
                {ratingMetrics.totalReviews} total ulasan
              </span>
            </div>
          )}
        </div>

        {/* Rating Breakdown Bars */}
        <div className="space-y-2">
          {[5, 4, 3, 2, 1].map((stars) => {
            const count = ratingMetrics.distribution[stars as 1 | 2 | 3 | 4 | 5] || 0;
            const pct = ratingMetrics.totalReviews > 0 ? +((count / ratingMetrics.totalReviews) * 100).toFixed(1) : 0;

            return (
              <div key={stars} className="flex items-center gap-2 text-xs">
                <span className="w-8 font-semibold text-slate-600 flex items-center gap-0.5">
                  {stars} <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                </span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      stars >= 4 ? 'bg-amber-400' : stars === 3 ? 'bg-amber-300' : 'bg-rose-400'
                    }`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <span className="w-16 text-right font-medium text-slate-600 text-[11px]">
                  {count} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>

        {/* Low Rating Alert Card */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/90 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              Kasus Rating Rendah (Service Recovery)
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
              {ratingMetrics.lowRatingCount} Kasus
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
            <span>Perlu Penanganan (Open): <strong>{ratingMetrics.openRecoveryCount}</strong></span>
            <span>Telah Selesai (Resolved): <strong>{ratingMetrics.resolvedRecoveryCount}</strong></span>
          </div>

          {lowRatingReviews.length > 0 && (
            <div className="pt-2 border-t border-slate-200/60 space-y-1.5 max-h-36 overflow-y-auto text-[11px]">
              {(lowRatingReviews || []).map((r) => (
                <div key={r.id} className="p-2 bg-white rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="text-[#4B2B18]">{r.customerName} ({r.overallRating}★)</span>
                    <span className="text-slate-400 font-mono text-[10px]">{r.bookingCode}</span>
                  </div>
                  <p className="text-slate-600 italic mt-0.5 line-clamp-1">"{r.comment}"</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Payment Methods Share & Rejected Proofs */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-[#4B2B18] text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#4B2B18]" />
              Rekapitulasi Kanal Pembayaran
            </h3>
            <p className="text-xs text-slate-500">
              Porsi volume, total rupiah terbayar, dan penolakan bukti transfer
            </p>
          </div>
        </div>

        {safePaymentMetrics.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
            Belum ada data transaksi pembayaran untuk periode ini.
          </div>
        ) : (
          <div className="space-y-3">
            {(safePaymentMetrics || []).map((pm) => (
              <div
                key={pm.methodKey}
                className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-[#4B2B18]">
                      {pm.methodLabel}
                    </span>
                    {pm.isLegacyCash && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-semibold">
                        Histori / Demo
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-[#4B2B18]">
                    {formatRupiah(pm.paidAmount)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{pm.transactionCount} Transaksi Sukses</span>
                  <div className="flex items-center gap-2 font-semibold">
                    {pm.rejectedProofCount > 0 && (
                      <span className="text-rose-600">
                        {pm.rejectedProofCount} Ditolak
                      </span>
                    )}
                    <span className="text-[#B89628]">{pm.sharePct}% Pangsa</span>
                  </div>
                </div>

                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#8B5A36] rounded-full"
                    style={{ width: `${Math.min(100, pm.sharePct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
