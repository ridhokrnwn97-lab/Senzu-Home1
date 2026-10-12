import React from 'react';
import {
  Clock,
  Coffee,
  Calendar,
  SlidersHorizontal,
  ShieldAlert,
  Copy,
  User,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  ChevronRight,
} from 'lucide-react';
import { Therapist, TherapistRoster, Booking, ShiftTemplate } from '../../../types';
import { deriveOperationalShiftStatus } from '../../../lib/rosterService';

interface TherapistScheduleMasterTableProps {
  therapists: Therapist[];
  rosters: TherapistRoster[];
  bookings: Booking[];
  selectedDate: string;
  templates?: ShiftTemplate[];
  onOpenEditShift?: (therapist: Therapist) => void;
  onEditShift?: (therapist: Therapist) => void;
  onOpenWeeklySchedule?: (therapist: Therapist) => void;
  onEditWeeklySchedule?: (therapist: Therapist) => void;
  onOpenUnavailable?: (therapist: Therapist) => void;
  onSetUnavailableRange?: (therapist: Therapist) => void;
  onOpenCopySchedule?: (therapist: Therapist) => void;
  onSelectBooking?: (booking: Booking) => void;
  onOpenAssignModal?: (booking: Booking) => void;
  onRefresh?: () => Promise<void>;
}

export const TherapistScheduleMasterTable: React.FC<TherapistScheduleMasterTableProps> = ({
  therapists = [],
  rosters = [],
  bookings = [],
  selectedDate,
  templates = [],
  onOpenEditShift,
  onEditShift,
  onOpenWeeklySchedule,
  onEditWeeklySchedule,
  onOpenUnavailable,
  onSetUnavailableRange,
  onOpenCopySchedule,
  onSelectBooking,
  onOpenAssignModal,
  onRefresh,
}) => {
  const triggerEditShift = onOpenEditShift || onEditShift;
  const triggerWeeklySchedule = onOpenWeeklySchedule || onEditWeeklySchedule;
  const triggerUnavailable = onOpenUnavailable || onSetUnavailableRange;
  const triggerCopySchedule = onOpenCopySchedule;

  const [bYear, bMonth, bDay] = selectedDate.split('-').map((v) => parseInt(v, 10));
  const dateObj = new Date(bYear, bMonth - 1, bDay);
  const dayOfWeek = isNaN(dateObj.getDay()) ? 0 : dateObj.getDay();

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Table Header / Summary */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
        <div>
          <h3 className="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2">
            <User className="w-4 h-4 text-[#D4AF37]" />
            <span>Daftar Shift & Ketersediaan Terapis ({therapists.length} Terapis)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Konfigurasi jadwal kerja, jam istirahat, dan status operasional armada untuk tanggal{' '}
            <strong className="text-[#082A4F]">{selectedDate}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
            {(rosters || []).filter((r) => r?.status === 'scheduled').length} Bertugas
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold border border-slate-200">
            {(rosters || []).filter((r) => r?.status !== 'scheduled').length} Off/Libur
          </span>
        </div>
      </div>

      {/* Responsive Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
              <th className="py-3 px-4">Terapis</th>
              <th className="py-3 px-3">Jam Shift ({selectedDate})</th>
              <th className="py-3 px-3">Istirahat / Break</th>
              <th className="py-3 px-3">Status Operasional</th>
              <th className="py-3 px-3">Pesanan Berikutnya</th>
              <th className="py-3 px-4 text-right">Aksi Konfigurasi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(therapists || []).map((therapist) => {
              const roster = (rosters || []).find((r) => r?.therapistId === therapist.id);
              const weeklyDay = therapist.weeklySchedule?.[dayOfWeek];

              // Find today's bookings for this therapist
              const therapistBookings = (bookings || [])
                .filter(
                  (b) =>
                    b &&
                    b.therapistId === therapist.id &&
                    b.scheduleDate === selectedDate &&
                    !['Cancelled'].includes(b.status)
                )
                .sort((a, b) => a.scheduleTime.localeCompare(b.scheduleTime));

              // Active / Next booking
              const nextBooking = therapistBookings.find(
                (b) => b.status !== 'Completed'
              );

              // Derive status pill
              const operationalStatus = deriveOperationalShiftStatus(
                therapist,
                roster || null,
                nextBooking || null
              );

              const shiftStart =
                roster?.shiftStart ||
                weeklyDay?.shiftStart ||
                therapist.defaultShift?.start ||
                '10:00';
              const shiftEnd =
                roster?.shiftEnd ||
                weeklyDay?.shiftEnd ||
                therapist.defaultShift?.end ||
                '21:00';

              const breaks = roster?.breaks && roster.breaks.length > 0
                ? roster.breaks
                : weeklyDay?.hasBreak && weeklyDay.breakStart && weeklyDay.breakEnd
                ? [{ id: 'wb', start: weeklyDay.breakStart, end: weeklyDay.breakEnd, note: 'Istirahat' }]
                : [];

              const isDateOverride = Boolean(roster?.source === 'override' || (roster && roster.updatedAt));

              return (
                <tr
                  key={therapist.id}
                  className="hover:bg-slate-50/80 transition group"
                >
                  {/* Therapist Col */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-xs text-[#082A4F] shrink-0">
                        {therapist.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{therapist.name}</span>
                          {isDateOverride && (
                            <span
                              className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200"
                              title="Override Khusus Tanggal Ini"
                            >
                              Override
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{therapist.gender}</span>
                          <span>•</span>
                          <span className="font-mono text-[10px]">{therapist.phone}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Shift Hours */}
                  <td className="py-3 px-3">
                    {roster?.status === 'off' || (!roster && weeklyDay && !weeklyDay.isWorking) ? (
                      <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 font-semibold text-[11px]">
                        Libur (Off Duty)
                      </span>
                    ) : roster?.status === 'leave' ? (
                      <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-800 font-semibold text-[11px] border border-amber-200">
                        Izin / Cuti
                      </span>
                    ) : roster?.status === 'unavailable' ? (
                      <span className="px-2 py-1 rounded-md bg-rose-50 text-rose-800 font-semibold text-[11px] border border-rose-200">
                        Unavailable ({roster.unavailableReason || 'Kendala'})
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 text-slate-800 font-mono font-bold">
                        <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>{shiftStart} - {shiftEnd} WIB</span>
                      </div>
                    )}
                  </td>

                  {/* Breaks */}
                  <td className="py-3 px-3">
                    {breaks.length > 0 ? (
                      <div className="space-y-1">
                        {(breaks || []).map((b, idx) => (
                          <div
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px] font-semibold"
                          >
                            <Coffee className="w-3 h-3 text-amber-600" />
                            <span>{b.start} - {b.end}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 text-[11px] italic">Tanpa Break</span>
                    )}
                  </td>

                  {/* Operational Status Pill */}
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${operationalStatus.badgeColor} ${operationalStatus.textColor} border border-current/20`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                      <span>{operationalStatus.status}</span>
                    </span>
                  </td>

                  {/* Next Booking */}
                  <td className="py-3 px-3">
                    {nextBooking ? (
                      <div
                        onClick={() => onSelectBooking?.(nextBooking)}
                        className="cursor-pointer hover:underline text-[11px] space-y-0.5"
                      >
                        <div className="font-mono font-bold text-[#082A4F] flex items-center gap-1">
                          <span>{nextBooking.bookingCode}</span>
                          <span className="text-slate-500 font-normal">({nextBooking.scheduleTime} WIB)</span>
                        </div>
                        <div className="text-slate-500 truncate max-w-[140px]">
                          {nextBooking.serviceName}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-[11px] italic">Tidak ada antrean</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => triggerEditShift?.(therapist)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-[#082A4F] hover:text-white text-slate-700 font-bold text-[11px] transition cursor-pointer"
                        title="Atur Shift & Break Khusus Tanggal Ini"
                      >
                        Atur Shift
                      </button>

                      <button
                        type="button"
                        onClick={() => triggerWeeklySchedule?.(therapist)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#082A4F] hover:bg-slate-100 transition cursor-pointer"
                        title="Atur Pola Jadwal Mingguan (7 Hari)"
                      >
                        <Calendar className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => triggerUnavailable?.(therapist)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                        title="Tandai Sakit / Izin / Unavailable"
                      >
                        <ShieldAlert className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => triggerCopySchedule?.(therapist)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                        title="Salin Jadwal ke Hari Lain atau Terapis Lain"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
