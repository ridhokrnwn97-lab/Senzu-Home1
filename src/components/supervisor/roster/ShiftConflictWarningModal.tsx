import React from 'react';
import { AlertTriangle, Clock, Calendar, User, ArrowRight, X } from 'lucide-react';
import { Booking } from '../../../types';
import { ShiftImpactAnalysis } from '../../../lib/rosterService';

interface ShiftConflictWarningModalProps {
  isOpen: boolean;
  therapistName?: string;
  targetDate?: string;
  impact: ShiftImpactAnalysis;
  isSaving?: boolean;
  onClose: () => void;
  onProceedSave?: () => void;
  onConfirmProceed?: () => Promise<void> | void;
  onOpenReassignment?: (booking: Booking) => void;
  onOpenAssignModal?: (booking: any) => void;
}

export const ShiftConflictWarningModal: React.FC<ShiftConflictWarningModalProps> = ({
  isOpen,
  therapistName = 'Terapis',
  targetDate = '',
  impact,
  isSaving = false,
  onClose,
  onProceedSave,
  onConfirmProceed,
  onOpenReassignment,
  onOpenAssignModal,
}) => {
  if (!isOpen || !impact?.hasConflict) return null;
  const affectedList = impact?.affectedBookings || [];

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-rose-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-rose-50 border-b border-rose-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500 text-white shadow-xs mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 uppercase tracking-wider">
                Peringatan Bentrok Jadwal
              </span>
              <h2 className="text-base sm:text-lg font-bold text-rose-950 mt-1">
                Perubahan Shift Memengaruhi {affectedList.length} Booking
              </h2>
              <p className="text-xs text-rose-800 mt-0.5">
                Terapis <strong>{therapistName}</strong> memiliki pesanan aktif pada tanggal <strong>{targetDate}</strong> yang terdampak oleh perubahan jadwal ini.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conflict List */}
        <div className="p-4 sm:p-5 space-y-3 overflow-y-auto flex-1 text-xs">
          <p className="text-slate-600">
            Berikut rincian pesanan yang berbenturan dengan konfigurasi shift baru:
          </p>

          <div className="space-y-2.5">
            {(affectedList || []).map(({ booking, reason, code }) => (
              <div
                key={booking.id}
                className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-50 transition space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-rose-900 bg-white px-2 py-0.5 rounded border border-rose-200">
                      {booking.bookingCode}
                    </span>
                    <span className="text-[11px] font-bold text-slate-700">
                      {booking.customerName}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-200 text-rose-900 uppercase">
                    {code}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600 text-[11px]">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-rose-600" />
                    <span>{booking.scheduleTime} WIB ({booking.serviceDuration || 90} mnt)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>{booking.serviceName}</span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-white/80 border border-rose-200/80 text-[11px] text-rose-800 font-medium">
                  {reason}
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      (onOpenAssignModal || onOpenReassignment)?.(booking);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] flex items-center gap-1.5 transition cursor-pointer border border-indigo-200"
                  >
                    <span>Alihkan ke Terapis Lain (Reassign)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
          >
            Batal Ubah Shift
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onConfirmProceed || onProceedSave}
              className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <span>{isSaving ? 'Menyimpan...' : 'Tetap Simpan & Tandai Konflik'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
