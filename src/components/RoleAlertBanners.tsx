import React from 'react';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  UserCheck,
  CreditCard,
  ChevronRight,
  Sparkles,
  MapPin,
} from 'lucide-react';

export interface RoleAlertCounts {
  pendingPaymentVerification?: number;
  readyForAssignment?: number;
  unassignedPaidBookings?: number;
  activeMissions?: number;
  pendingTherapistAcceptance?: number;
  criticalAlerts?: number;
}

export interface RoleAlertBannerProps {
  role: 'css' | 'supervisor' | 'therapist';
  counts?: RoleAlertCounts;
  onActionClick?: (filterKey: string) => void;
}

export const RoleAlertBanners: React.FC<RoleAlertBannerProps> = ({
  role,
  counts = {},
  onActionClick,
}: RoleAlertBannerProps) => {
  if (role === 'css') {
    const hasPendingVerification = (counts?.pendingPaymentVerification || 0) > 0;
    if (!hasPendingVerification && !(counts?.criticalAlerts || 0)) return null;

    return (
      <div className="mb-4 space-y-2">
        {hasPendingVerification && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 sm:p-4 flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 text-amber-800 rounded-lg flex-shrink-0">
                <CreditCard className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-amber-900">
                  {counts?.pendingPaymentVerification || 0} Bukti Pembayaran Perlu Verifikasi
                </h4>
                <p className="text-[11px] sm:text-xs text-amber-700">
                  Customer telah mengunggah bukti transfer. Segera verifikasi agar supervisor dapat menugaskan terapis.
                </p>
              </div>
            </div>
            {onActionClick && (
              <button
                type="button"
                onClick={() => onActionClick('pending_verification')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition cursor-pointer whitespace-nowrap"
              >
                <span>Periksa Sekarang</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (role === 'supervisor') {
    const unassigned = counts?.unassignedPaidBookings || counts?.readyForAssignment || 0;
    const hasUnassigned = unassigned > 0;

    return (
      <div className="mb-4 space-y-2">
        {hasUnassigned && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 sm:p-4 flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 text-[#4B2B18] rounded-lg flex-shrink-0">
                <UserCheck className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-[#4B2B18]">
                  {unassigned} Pesanan Lunas Siap Ditugaskan
                </h4>
                <p className="text-[11px] sm:text-xs text-blue-800">
                  Pembayaran customer telah diverifikasi CSS. Pilih dan tugaskan terapis terbaik untuk jadwal ini.
                </p>
              </div>
            </div>
            {onActionClick && (
              <button
                type="button"
                onClick={() => onActionClick('ready_for_assignment')}
                className="px-3 py-1.5 rounded-lg bg-[#8B5A36] hover:bg-[#94603B] text-[#FDF3CD] font-bold text-xs flex items-center gap-1 shadow-xs transition cursor-pointer whitespace-nowrap"
              >
                <span>Tugaskan Terapis</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (role === 'therapist') {
    const pendingAccept = counts?.pendingTherapistAcceptance || 0;
    if (pendingAccept <= 0) return null;

    return (
      <div
        id="alert-banner-new-assignments"
        onClick={() => onActionClick?.('new_assignments')}
        className="mb-4 bg-amber-50 border-2 border-amber-300 rounded-xl p-3.5 sm:p-4 flex items-center justify-between gap-3 shadow-sm animate-pulse cursor-pointer hover:bg-amber-100/80 transition"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-200 text-amber-900 rounded-xl flex-shrink-0">
            <Sparkles className="w-5 h-5 text-[#4B2B18]" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-amber-900">
              {pendingAccept} Tugas Baru Diberikan!
            </h4>
            <p className="text-[11px] sm:text-xs text-amber-800">
              Supervisor telah menugaskan order untuk Anda. Harap konfirmasi penerimaan pesanan.
            </p>
          </div>
        </div>
        {onActionClick && (
          <button
            id="btn-buka-tugas"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onActionClick('new_assignments');
            }}
            className="px-3.5 py-2.5 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] active:bg-[#3D2315] text-[#FDF3CD] font-bold text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer whitespace-nowrap select-none touch-manipulation active:scale-95 shrink-0"
          >
            <span>Buka Tugas</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  return null;
};
