import React, { useState } from 'react';
import {
  Copy,
  Calendar,
  Users,
  CheckCircle2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Therapist } from '../../../types';
import {
  copyTherapistRosterDateToRange,
  copyWeeklyScheduleBetweenTherapists,
} from '../../../lib/rosterService';

interface CopyScheduleModalProps {
  isOpen: boolean;
  therapists: Therapist[];
  currentTherapist?: Therapist | null;
  currentDate?: string;
  sourceDate?: string;
  preselectedTherapistId?: string;
  actorName?: string;
  onClose: () => void;
  onSuccess: (msg: string) => Promise<void> | void;
}

export const CopyScheduleModal: React.FC<CopyScheduleModalProps> = ({
  isOpen,
  therapists = [],
  currentTherapist,
  currentDate,
  sourceDate: initialSourceDate,
  preselectedTherapistId,
  actorName = 'Supervisor Operasional',
  onClose,
  onSuccess,
}) => {
  if (!isOpen) return null;

  const defaultDate = initialSourceDate || currentDate || new Date().toISOString().split('T')[0];
  const [mode, setMode] = useState<'date_range' | 'therapist_to_therapist'>('date_range');

  // Date range copy
  const [sourceTherapistId, setSourceTherapistId] = useState<string>(
    preselectedTherapistId || currentTherapist?.id || (therapists || [])[0]?.id || ''
  );
  const [sourceDate, setSourceDate] = useState<string>(defaultDate);
  const [targetStartDate, setTargetStartDate] = useState<string>(defaultDate);
  const [targetEndDate, setTargetEndDate] = useState<string>(defaultDate);

  // Therapist to therapist copy
  const [targetTherapistIds, setTargetTherapistIds] = useState<string[]>([]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [showConfirm, setShowConfirm] = useState<boolean>(false);

  const sourceTherapist = therapists.find((t) => t.id === sourceTherapistId);

  const handleToggleTargetTherapist = (id: string) => {
    setTargetTherapistIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleExecuteCopy = async () => {
    if (!sourceTherapist) {
      setError('Pilih terapis sumber.');
      return;
    }

    try {
      setIsSubmitting(true);

      if (mode === 'date_range') {
        if (targetStartDate > targetEndDate) {
          setError('Tanggal mulai tidak boleh melebihi tanggal selesai.');
          setIsSubmitting(false);
          return;
        }

        const count = await copyTherapistRosterDateToRange(
          sourceTherapist.id,
          sourceTherapist.name,
          sourceDate,
          targetStartDate,
          targetEndDate,
          actorName
        );

        setShowConfirm(false);
        onSuccess(`Berhasil menyalin jadwal ke ${count} tanggal untuk ${sourceTherapist.name}!`);
        onClose();
      } else {
        if (targetTherapistIds.length === 0) {
          setError('Pilih minimal satu terapis tujuan.');
          setIsSubmitting(false);
          return;
        }

        await copyWeeklyScheduleBetweenTherapists(
          sourceTherapist,
          targetTherapistIds,
          therapists,
          actorName
        );

        setShowConfirm(false);
        onSuccess(
          `Berhasil menyalin jadwal mingguan dari ${sourceTherapist.name} ke ${targetTherapistIds.length} terapis tujuan!`
        );
        onClose();
      }
    } catch (err: any) {
      console.error('Copy schedule failed:', err);
      setError('Gagal menyalin jadwal: ' + (err.message || 'Kesalahan jaringan'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#8B5A36] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 text-[#D4AF37]">
              <Copy className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                Salin Jadwal & Roster
              </span>
              <h2 className="text-base sm:text-lg font-bold font-serif text-white mt-0.5">
                Duplikasi Jadwal Kerja Terapis
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('date_range')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-center ${
              mode === 'date_range'
                ? 'bg-white text-[#4B2B18] shadow-2xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Salin ke Rentang Tanggal
          </button>
          <button
            type="button"
            onClick={() => setMode('therapist_to_therapist')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-center ${
              mode === 'therapist_to_therapist'
                ? 'bg-white text-[#4B2B18] shadow-2xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Salin Antar Terapis (Pola Mingguan)
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Source Therapist */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">Terapis Sumber:</label>
            <select
              value={sourceTherapistId}
              onChange={(e) => setSourceTherapistId(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-300 text-xs bg-white"
            >
              {(therapists || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.gender})
                </option>
              ))}
            </select>
          </div>

          {mode === 'date_range' ? (
            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Ambil Jadwal dari Tanggal:
                </label>
                <input
                  type="date"
                  value={sourceDate}
                  onChange={(e) => setSourceDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Terapkan Mulai Tanggal:
                  </label>
                  <input
                    type="date"
                    value={targetStartDate}
                    onChange={(e) => setTargetStartDate(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Sampai Tanggal:
                  </label>
                  <input
                    type="date"
                    value={targetEndDate}
                    onChange={(e) => setTargetEndDate(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="font-bold text-slate-700 block">
                Pilih Terapis Tujuan (Menerima Pola Shift dari {sourceTherapist?.name}):
              </label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
                {(therapists || [])
                  .filter((t) => t && t.id !== sourceTherapistId)
                  .map((th) => {
                    const isChecked = targetTherapistIds.includes(th.id);
                    return (
                      <label
                        key={th.id}
                        className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-2 cursor-pointer transition ${
                          isChecked
                            ? 'bg-[#8B5A36] text-white border-[#8B5A36]'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTargetTherapist(th.id)}
                          className="w-3.5 h-3.5 rounded text-[#D4AF37] accent-[#D4AF37]"
                        />
                        <span className="truncate">{th.name}</span>
                      </label>
                    );
                  })}
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
            onClick={() => setShowConfirm(true)}
            className="px-5 py-2.5 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
            <span>Salin Jadwal</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-70 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500 text-white shadow-xs">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Konfirmasi Penimpaan Jadwal
                </h3>
                <p className="text-slate-600 mt-1">
                  Menyalin jadwal akan menimpa konfigurasi shift pada target terpilih. Lanjutkan?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteCopy}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white font-bold flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
                <span>{isSubmitting ? 'Menyalin...' : 'Ya, Timpa & Salin'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
