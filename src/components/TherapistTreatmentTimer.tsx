import React, { useState, useEffect } from 'react';
import { Clock, AlertTriangle, CheckCircle2, Flame } from 'lucide-react';
import { formatDateTimeWIB } from '../lib/utils';

interface TherapistTreatmentTimerProps {
  startedAt: string; // ISO string
  durationMinutes: number;
  serviceName: string;
  onComplete: () => void;
  isProcessing?: boolean;
}

export const TherapistTreatmentTimer: React.FC<TherapistTreatmentTimerProps> = ({
  startedAt,
  durationMinutes,
  serviceName,
  onComplete,
  isProcessing = false,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    const startMs = new Date(startedAt).getTime();
    if (isNaN(startMs)) return 0;
    return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  });

  const [showEarlyWarning, setShowEarlyWarning] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    const startMs = new Date(startedAt).getTime();
    if (isNaN(startMs)) return;

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((now - startMs) / 1000));
      setElapsedSeconds(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const totalPlannedSeconds = durationMinutes * 60;
  const progressPercent = Math.min(100, Math.round((elapsedSeconds / totalPlannedSeconds) * 100));
  const isOvertime = elapsedSeconds > totalPlannedSeconds;
  const overtimeSeconds = isOvertime ? elapsedSeconds - totalPlannedSeconds : 0;

  // Format Elapsed HH:MM:SS
  const formatTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const startMs = new Date(startedAt).getTime();
  const startTimeStr = !isNaN(startMs)
    ? new Date(startMs).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' WIB'
    : '-';

  const endMs = !isNaN(startMs) ? startMs + totalPlannedSeconds * 1000 : null;
  const endTimeStr = endMs
    ? new Date(endMs).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' WIB'
    : '-';

  // Handle completion check (warn if early < 80% of duration)
  const handleInitiateComplete = () => {
    const earlyThresholdSeconds = totalPlannedSeconds * 0.75;
    if (elapsedSeconds < earlyThresholdSeconds) {
      setShowEarlyWarning(true);
    } else {
      setShowConfirmModal(true);
    }
  };

  return (
    <div className="bg-gradient-to-b from-[#082A4F] to-[#0A335E] rounded-3xl p-6 text-white shadow-xl border border-[#D4AF37]/40 space-y-5 animate-fade-in">
      {/* Timer Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
            Treatment Berlangsung
          </span>
        </div>
        <span className="text-xs bg-white/10 px-3 py-1 rounded-full text-slate-200 font-semibold border border-white/15">
          Target: {durationMinutes} Menit
        </span>
      </div>

      {/* Main Digital Clock */}
      <div className="text-center py-2">
        <div className="font-mono text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-wider text-white drop-shadow-md">
          {formatTime(elapsedSeconds)}
        </div>
        <div className="text-xs text-slate-300 font-medium mt-1">
          {serviceName}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-slate-300 font-medium">
          <span>Progres Waktu</span>
          <span className={isOvertime ? 'text-amber-300 font-bold' : 'text-emerald-400 font-bold'}>
            {progressPercent}%
          </span>
        </div>
        <div className="w-full h-2.5 bg-white/15 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              isOvertime
                ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                : 'bg-gradient-to-r from-emerald-400 to-[#D4AF37]'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Start and Estimated End Times */}
      <div className="grid grid-cols-2 gap-3 bg-white/10 p-3 rounded-2xl border border-white/10 text-xs">
        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
            Dimulai
          </span>
          <span className="font-bold text-white font-mono text-sm">{startTimeStr}</span>
        </div>
        <div className="border-l border-white/15 pl-3">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
            Estimasi Selesai
          </span>
          <span className="font-bold text-[#FDF3CD] font-mono text-sm">{endTimeStr}</span>
        </div>
      </div>

      {/* Overtime Notice */}
      {isOvertime && (
        <div className="p-3 bg-amber-500/20 border border-amber-400/50 rounded-2xl text-amber-200 text-xs flex items-center gap-2.5 animate-pulse">
          <Flame className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span>
            Durasi treatment telah melewati waktu layanan (+{formatTime(overtimeSeconds)}). Anda dapat menyelesaikan jika telah tuntas.
          </span>
        </div>
      )}

      {/* Primary Action Button */}
      <button
        type="button"
        disabled={isProcessing}
        onClick={handleInitiateComplete}
        className="w-full min-h-[56px] py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-emerald-900/40 cursor-pointer disabled:opacity-50"
      >
        <CheckCircle2 className="w-5 h-5 text-emerald-200" />
        <span>{isProcessing ? 'Menyimpan...' : 'SELESAIKAN TREATMENT'}</span>
      </button>

      {/* Early Completion Warning Modal */}
      {showEarlyWarning && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-slate-900 shadow-2xl border border-amber-300 text-center space-y-4 animate-scale-in">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#082A4F]">Layanan Belum Selesai Penuh?</h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Treatment baru berjalan <strong>{Math.floor(elapsedSeconds / 60)} menit</strong> dari durasi <strong>{durationMinutes} menit</strong>.
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowEarlyWarning(false);
                  onComplete();
                }}
                className="w-full min-h-[48px] py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition active:scale-95 cursor-pointer"
              >
                Tetap Selesaikan (Customer Minta Lebih Cepat)
              </button>
              <button
                type="button"
                onClick={() => setShowEarlyWarning(false)}
                className="w-full min-h-[44px] py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition active:scale-95 cursor-pointer"
              >
                Kembali Lanjutkan Treatment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Normal Completion Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-slate-900 shadow-2xl border border-emerald-300 text-center space-y-4 animate-scale-in">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#082A4F]">Konfirmasi Selesai Treatment</h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Pastikan sesi pijat & refleksi telah selesai, perlengkapan telah dirapikan, dan customer merasa puas.
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowConfirmModal(false);
                  onComplete();
                }}
                className="w-full min-h-[48px] py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition active:scale-95 cursor-pointer shadow-md shadow-emerald-600/20"
              >
                Ya, Selesaikan Treatment Sekarang
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="w-full min-h-[44px] py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition active:scale-95 cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
