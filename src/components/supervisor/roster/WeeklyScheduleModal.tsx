import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Coffee,
  CheckCircle2,
  X,
  Copy,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import {
  Therapist,
  TherapistWeeklySchedule,
  WeeklyScheduleDay,
} from '../../../types';
import {
  saveTherapistWeeklySchedule,
  timeToMinutes,
} from '../../../lib/rosterService';

interface WeeklyScheduleModalProps {
  isOpen: boolean;
  therapist: Therapist | null;
  actorName?: string;
  templates?: any[];
  onClose: () => void;
  onSaved?: () => void;
  onSuccess?: (msg: string) => Promise<void> | void;
}

const DAYS_META: Array<{ day: number; name: string; short: string }> = [
  { day: 1, name: 'Senin', short: 'Sen' },
  { day: 2, name: 'Selasa', short: 'Sel' },
  { day: 3, name: 'Rabu', short: 'Rab' },
  { day: 4, name: 'Kamis', short: 'Kam' },
  { day: 5, name: 'Jumat', short: 'Jum' },
  { day: 6, name: 'Sabtu', short: 'Sab' },
  { day: 0, name: 'Minggu', short: 'Min' },
];

export const WeeklyScheduleModal: React.FC<WeeklyScheduleModalProps> = ({
  isOpen,
  therapist,
  actorName = 'Supervisor Operasional',
  templates,
  onClose,
  onSaved,
  onSuccess,
}) => {
  if (!isOpen || !therapist) return null;

  // Initialize schedule from therapist's existing weeklySchedule or defaultShift
  const [schedule, setSchedule] = useState<TherapistWeeklySchedule>(() => {
    const initial: TherapistWeeklySchedule = {};
    const defaultStart = therapist.defaultShift?.start || '10:00';
    const defaultEnd = therapist.defaultShift?.end || '21:00';
    const offDays = therapist.defaultShift?.offDays || [];

    DAYS_META.forEach(({ day, name }) => {
      if (therapist.weeklySchedule && therapist.weeklySchedule[day]) {
        initial[day] = { ...therapist.weeklySchedule[day] };
      } else {
        const isOff = offDays.includes(day);
        initial[day] = {
          day,
          dayName: name,
          isWorking: !isOff,
          shiftStart: defaultStart,
          shiftEnd: defaultEnd,
          hasBreak: !isOff,
          breakStart: '13:00',
          breakEnd: '14:00',
        };
      }
    });

    return initial;
  });

  const [validationError, setValidationError] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [successNotice, setSuccessNotice] = useState<string>('');

  const handleUpdateDay = (day: number, updates: Partial<WeeklyScheduleDay>) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        ...updates,
      },
    }));
    setValidationError('');
  };

  // Copy Monday schedule to Weekdays (Tuesday - Friday)
  const handleCopyMondayToWeekdays = () => {
    const monday = schedule[1];
    if (!monday) return;

    setSchedule((prev) => {
      const next = { ...prev };
      [2, 3, 4, 5].forEach((d) => {
        next[d] = {
          ...next[d],
          isWorking: monday.isWorking,
          shiftStart: monday.shiftStart,
          shiftEnd: monday.shiftEnd,
          hasBreak: monday.hasBreak,
          breakStart: monday.breakStart,
          breakEnd: monday.breakEnd,
        };
      });
      return next;
    });

    setSuccessNotice('Jadwal Senin berhasil disalin ke Selasa s/d Jumat!');
    setTimeout(() => setSuccessNotice(''), 3000);
  };

  // Copy Monday to all days
  const handleCopyMondayToAllDays = () => {
    const monday = schedule[1];
    if (!monday) return;

    setSchedule((prev) => {
      const next = { ...prev };
      DAYS_META.forEach(({ day }) => {
        next[day] = {
          ...next[day],
          isWorking: monday.isWorking,
          shiftStart: monday.shiftStart,
          shiftEnd: monday.shiftEnd,
          hasBreak: monday.hasBreak,
          breakStart: monday.breakStart,
          breakEnd: monday.breakEnd,
        };
      });
      return next;
    });

    setSuccessNotice('Jadwal Senin disalin ke semua 7 hari!');
    setTimeout(() => setSuccessNotice(''), 3000);
  };

  const handleSave = async () => {
    // Validate each working day
    for (const { day, name } of DAYS_META) {
      const conf = schedule[day];
      if (conf && conf.isWorking) {
        const startMin = timeToMinutes(conf.shiftStart);
        const endMin = timeToMinutes(conf.shiftEnd);

        if (startMin >= endMin) {
          setValidationError(
            `Hari ${name}: Jam masuk (${conf.shiftStart}) harus lebih awal daripada jam pulang (${conf.shiftEnd}).`
          );
          return;
        }

        if (conf.hasBreak && conf.breakStart && conf.breakEnd) {
          const bStartMin = timeToMinutes(conf.breakStart);
          const bEndMin = timeToMinutes(conf.breakEnd);

          if (bStartMin >= bEndMin) {
            setValidationError(
              `Hari ${name}: Jam istirahat mulai (${conf.breakStart}) harus sebelum selesai (${conf.breakEnd}).`
            );
            return;
          }

          if (bStartMin < startMin || bEndMin > endMin) {
            setValidationError(
              `Hari ${name}: Waktu istirahat (${conf.breakStart}-${conf.breakEnd}) harus berada di dalam jam shift (${conf.shiftStart}-${conf.shiftEnd}).`
            );
            return;
          }
        }
      }
    }

    try {
      setIsSaving(true);
      await saveTherapistWeeklySchedule(
        therapist.id,
        therapist.name,
        schedule,
        actorName,
        'Konfigurasi Jadwal Kerja Mingguan 7 Hari'
      );
      if (onSaved) onSaved();
      if (onSuccess) await onSuccess(`Jadwal mingguan untuk ${therapist.name} berhasil disimpan.`);
      onClose();
    } catch (err: any) {
      console.error('Save weekly schedule failed:', err);
      setValidationError('Gagal menyimpan jadwal: ' + (err.message || 'Kesalahan jaringan'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#082A4F] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 text-[#D4AF37]">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                Pengaturan Jadwal Mingguan
              </span>
              <h2 className="text-base sm:text-lg font-bold font-serif text-white mt-0.5">
                Pola Shift Rutin: {therapist.name} ({therapist.gender})
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

        {/* Quick Toolbar */}
        <div className="p-3 sm:px-5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyMondayToWeekdays}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
            >
              <Copy className="w-3.5 h-3.5 text-[#082A4F]" />
              <span>Salin Senin ke Sel–Jum</span>
            </button>
            <button
              type="button"
              onClick={handleCopyMondayToAllDays}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
            >
              <Copy className="w-3.5 h-3.5 text-[#082A4F]" />
              <span>Salin Senin ke Semua Hari</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-500">
            Jadwal ini digunakan otomatis setiap minggu untuk menghitung ketersediaan penugasan.
          </div>
        </div>

        {/* Notices */}
        {successNotice && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{successNotice}</span>
          </div>
        )}

        {validationError && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* 7 Days Table / Cards */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-2.5 text-xs">
          {DAYS_META.map(({ day, name, short }) => {
            const conf = schedule[day] || {
              day,
              dayName: name,
              isWorking: true,
              shiftStart: '10:00',
              shiftEnd: '21:00',
              hasBreak: true,
              breakStart: '13:00',
              breakEnd: '14:00',
            };

            const isWorking = conf.isWorking;

            return (
              <div
                key={day}
                className={`p-3.5 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                  isWorking
                    ? 'bg-white border-slate-200 shadow-2xs'
                    : 'bg-slate-50/80 border-slate-200 text-slate-400'
                }`}
              >
                {/* Day label & Working toggle */}
                <div className="flex items-center gap-3 min-w-[150px]">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                      isWorking
                        ? 'bg-[#082A4F] text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {short}
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{name}</div>
                    <label className="flex items-center gap-1.5 cursor-pointer mt-0.5">
                      <input
                        type="checkbox"
                        checked={isWorking}
                        onChange={(e) =>
                          handleUpdateDay(day, { isWorking: e.target.checked })
                        }
                        className="w-3.5 h-3.5 rounded text-[#082A4F] accent-[#082A4F]"
                      />
                      <span
                        className={`text-[11px] font-bold ${
                          isWorking ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {isWorking ? 'Masuk Kerja' : 'Libur Rutin (Off)'}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Shift Hours */}
                {isWorking ? (
                  <div className="flex flex-wrap items-center gap-3 flex-1 md:justify-end">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span className="text-[11px] text-slate-500 font-medium">Shift:</span>
                      <input
                        type="time"
                        value={conf.shiftStart}
                        onChange={(e) =>
                          handleUpdateDay(day, { shiftStart: e.target.value })
                        }
                        className="px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs w-20 bg-white"
                      />
                      <span className="text-slate-400">-</span>
                      <input
                        type="time"
                        value={conf.shiftEnd}
                        onChange={(e) =>
                          handleUpdateDay(day, { shiftEnd: e.target.value })
                        }
                        className="px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs w-20 bg-white"
                      />
                      <span className="text-[10px] text-slate-400 font-mono">WIB</span>
                    </div>

                    {/* Break Config */}
                    <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                      <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={conf.hasBreak}
                          onChange={(e) =>
                            handleUpdateDay(day, { hasBreak: e.target.checked })
                          }
                          className="w-3.5 h-3.5 rounded text-amber-500 accent-amber-500"
                        />
                        <Coffee className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-slate-600">Break</span>
                      </label>

                      {conf.hasBreak && (
                        <div className="flex items-center gap-1">
                          <input
                            type="time"
                            value={conf.breakStart || '13:00'}
                            onChange={(e) =>
                              handleUpdateDay(day, { breakStart: e.target.value })
                            }
                            className="px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs w-20 bg-white"
                          />
                          <span className="text-slate-400">-</span>
                          <input
                            type="time"
                            value={conf.breakEnd || '14:00'}
                            onChange={(e) =>
                              handleUpdateDay(day, { breakEnd: e.target.value })
                            }
                            className="px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs w-20 bg-white"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-500 italic text-[11px] py-1">
                    Hari libur berkala — Tidak dijadwalkan bertugas
                  </div>
                )}
              </div>
            );
          })}
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
            className="px-5 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
            <span>{isSaving ? 'Menyimpan Jadwal...' : 'Simpan Jadwal Mingguan'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
