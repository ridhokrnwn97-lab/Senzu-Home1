import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Clock,
  Users,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Coffee,
  UserCheck,
  Shield,
  SlidersHorizontal,
  Settings,
  Plus,
  Trash2,
  X,
  MapPin,
  Car,
  Heart,
  Briefcase,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  Therapist,
  Booking,
  TherapistRoster,
  RosterShiftStatus,
  RosterBreakPeriod,
  ServiceItem,
  AppSettings,
} from '../../types';
import {
  ensureDailyRosters,
  saveTherapistRoster,
  setTherapistRosterStatus,
  updateTherapistSkillMatrix,
  DEFAULT_SKILL_MATRIX,
  DEFAULT_PALEMBANG_SHIFTS,
  buildRosterDocId,
  getRosterTemplates,
  analyzeShiftImpactOnBookings,
  ShiftTemplate,
  ShiftImpactAnalysis,
} from '../../lib/rosterService';
import { TherapistScheduleMasterTable } from './roster/TherapistScheduleMasterTable';
import { WeeklyScheduleModal } from './roster/WeeklyScheduleModal';
import { UnavailableRangeModal } from './roster/UnavailableRangeModal';
import { ShiftTemplatesAndBulkModal } from './roster/ShiftTemplatesAndBulkModal';
import { CopyScheduleModal } from './roster/CopyScheduleModal';
import { ShiftConflictWarningModal } from './roster/ShiftConflictWarningModal';
import { Copy } from 'lucide-react';
import { timeToMinutes, minutesToTime } from '../../lib/schedulingEngine';
import { useAuth } from '../../context/AuthContext';

interface SupervisorRosterCalendarViewProps {
  therapists: Therapist[];
  bookings: Booking[];
  services: ServiceItem[];
  settings?: AppSettings;
  onSelectBooking?: (booking: Booking) => void;
  onOpenAssignModal?: (booking: Booking) => void;
}

// Operational range: 10:00 to 22:00 (720 minutes)
const TIMELINE_START_HOUR = 10;
const TIMELINE_END_HOUR = 22;
const TOTAL_TIMELINE_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60; // 720 min

export const SupervisorRosterCalendarView: React.FC<SupervisorRosterCalendarViewProps> = ({
  therapists = [],
  bookings = [],
  services = [],
  settings,
  onSelectBooking,
  onOpenAssignModal,
}) => {
  const { currentUser } = useAuth();

  // Selected Date state (defaults to today in YYYY-MM-DD)
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [activeTab, setActiveTab] = useState<'today' | 'tomorrow' | 'week' | 'custom'>('today');

  // Daily rosters for selected date
  const [rosters, setRosters] = useState<TherapistRoster[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notice, setNotice] = useState<string>('');

  // Shift & Skill Management Drawer
  const [editingTherapist, setEditingTherapist] = useState<Therapist | null>(null);
  const [drawerRoster, setDrawerRoster] = useState<TherapistRoster | null>(null);
  const [drawerSkills, setDrawerSkills] = useState<string[]>([]);
  const [isSavingDrawer, setIsSavingDrawer] = useState<boolean>(false);
  const [copyToNext7Days, setCopyToNext7Days] = useState<boolean>(false);

  // Quick break state
  const [newBreakStart, setNewBreakStart] = useState<string>('13:00');
  const [newBreakEnd, setNewBreakEnd] = useState<string>('14:00');
  const [newBreakNote, setNewBreakNote] = useState<string>('Istirahat & Makan');

  // Sub-view switcher: master table vs timeline
  const [subView, setSubView] = useState<'master_table' | 'timeline'>('master_table');

  // Reusable shift templates
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);

  // Modals state
  const [isWeeklyModalOpen, setIsWeeklyModalOpen] = useState<boolean>(false);
  const [weeklyTherapist, setWeeklyTherapist] = useState<Therapist | null>(null);

  const [isUnavailableModalOpen, setIsUnavailableModalOpen] = useState<boolean>(false);
  const [unavailableTherapist, setUnavailableTherapist] = useState<Therapist | null>(null);

  const [isTemplatesBulkModalOpen, setIsTemplatesBulkModalOpen] = useState<boolean>(false);
  const [templatesBulkMode, setTemplatesBulkMode] = useState<'templates' | 'bulk_apply'>('bulk_apply');

  const [isCopyModalOpen, setIsCopyModalOpen] = useState<boolean>(false);
  const [copyTherapist, setCopyTherapist] = useState<Therapist | null>(null);

  const [isConflictWarningOpen, setIsConflictWarningOpen] = useState<boolean>(false);
  const [conflictImpact, setConflictImpact] = useState<ShiftImpactAnalysis | null>(null);
  const [pendingSaveHandler, setPendingSaveHandler] = useState<(() => Promise<void>) | null>(null);

  // Load templates on mount
  useEffect(() => {
    getRosterTemplates()
      .then(setTemplates)
      .catch((err) => console.warn('Load templates err:', err));
  }, []);

  // Load / initialize daily rosters whenever selectedDate or therapists change
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    ensureDailyRosters(therapists, selectedDate, currentUser?.name || 'Supervisor Operasional')
      .then((data) => {
        if (isMounted) {
          setRosters(data);
        }
      })
      .catch((err) => {
        console.warn('Failed to ensure rosters for date:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedDate, therapists, currentUser]);

  // Handle Tab Quick Clicks
  const handleSelectQuickTab = (tab: 'today' | 'tomorrow' | 'week') => {
    setActiveTab(tab);
    const now = new Date();
    if (tab === 'today') {
      setSelectedDate(now.toISOString().split('T')[0]);
    } else if (tab === 'tomorrow') {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      setSelectedDate(tomorrow.toISOString().split('T')[0]);
    } else {
      // 7-day view sets date to today as start
      setSelectedDate(now.toISOString().split('T')[0]);
    }
  };

  const handleCustomDateChange = (date: string) => {
    setActiveTab('custom');
    setSelectedDate(date);
  };

  const handleStepDay = (delta: number) => {
    const [y, m, d] = selectedDate.split('-').map((v) => parseInt(v, 10));
    const target = new Date(y, m - 1, d + delta);
    setSelectedDate(target.toISOString().split('T')[0]);
    setActiveTab('custom');
  };

  // Filter same-day bookings
  const sameDayBookings = useMemo(() => {
    return (bookings || []).filter(
      (b) => b && b.scheduleDate === selectedDate && b.status !== 'Cancelled'
    );
  }, [bookings, selectedDate]);

  // Capacity & coverage calculations
  const rosterMap = useMemo(() => {
    return new Map((rosters || []).map((r) => [r.therapistId, r]));
  }, [rosters]);

  const capacitySummary = useMemo(() => {
    let working = 0;
    let scheduled = 0;
    let onBreak = 0;
    let off = 0;

    rosters.forEach((r) => {
      if (r.status === 'off' || r.status === 'leave' || r.status === 'unavailable') {
        off++;
      } else if (r.status === 'working') {
        working++;
      } else if (r.status === 'break') {
        onBreak++;
      } else {
        scheduled++;
      }
    });

    // Skill coverage
    const serviceMap: Record<string, number> = {};
    services.forEach((s) => {
      let count = 0;
      therapists.forEach((th) => {
        const thRoster = rosterMap.get(th.id);
        const isOff = thRoster?.status === 'off' || thRoster?.status === 'leave' || thRoster?.status === 'unavailable';
        if (!isOff) {
          const skills = th.serviceIds || DEFAULT_SKILL_MATRIX[th.id] || ['srv-sig-60', 'srv-sig-90'];
          if (skills.includes(s.id) || skills.includes('all')) {
            count++;
          }
        }
      });
      serviceMap[s.id] = count;
    });

    return {
      total: therapists.length,
      working,
      scheduled,
      onBreak,
      off,
      activeOnShift: therapists.length - off,
      serviceMap,
    };
  }, [rosters, therapists, services, rosterMap]);

  // Detect Roster & Schedule Conflicts for this day
  const detectedConflicts = useMemo(() => {
    const conflicts: Array<{
      id: string;
      booking: Booking;
      therapistName: string;
      reason: string;
      severity: 'HARD' | 'SOFT';
    }> = [];

    sameDayBookings.forEach((b) => {
      if (!b.therapistId) return;
      const th = therapists.find((t) => t.id === b.therapistId);
      const thRoster = rosterMap.get(b.therapistId);

      if (thRoster && ['off', 'leave', 'unavailable'].includes(thRoster.status)) {
        conflicts.push({
          id: `off_${b.id}`,
          booking: b,
          therapistName: th?.name || b.therapistName || 'Terapis',
          reason: `Terapis berstatus ${thRoster.status.toUpperCase()} (${thRoster.unavailableReason || 'Libur'}) tetapi masih memiliki order aktif.`,
          severity: 'HARD',
        });
      }

      // Check overlaps with other same-day bookings for same therapist
      const bStart = timeToMinutes(b.scheduleTime);
      const bEnd = bStart + (b.serviceDuration || 90);

      sameDayBookings.forEach((b2) => {
        if (b.id !== b2.id && b.therapistId === b2.therapistId) {
          const b2Start = timeToMinutes(b2.scheduleTime);
          const b2End = b2Start + (b2.serviceDuration || 90);

          if (!(bEnd <= b2Start || bStart >= b2End)) {
            if (b.id < b2.id) {
              conflicts.push({
                id: `overlap_${b.id}_${b2.id}`,
                booking: b,
                therapistName: th?.name || b.therapistName || 'Terapis',
                reason: `Jadwal bertabrakan langsung dengan order ${b2.bookingCode} (${b2.scheduleTime} WIB).`,
                severity: 'HARD',
              });
            }
          }
        }
      });
    });

    return conflicts;
  }, [sameDayBookings, therapists, rosterMap]);

  // Open Shift Drawer for a Therapist
  const handleOpenShiftDrawer = (th: Therapist) => {
    setEditingTherapist(th);
    const existing = rosterMap.get(th.id) || {
      id: buildRosterDocId(th.id, selectedDate),
      therapistId: th.id,
      therapistName: th.name,
      date: selectedDate,
      shiftStart: th.defaultShift?.start || '10:00',
      shiftEnd: th.defaultShift?.end || '21:00',
      status: 'scheduled',
      breaks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.name || 'Supervisor',
    };

    setDrawerRoster({ ...existing });
    const currentSkills = th.serviceIds || DEFAULT_SKILL_MATRIX[th.id] || ['srv-sig-60', 'srv-sig-90'];
    setDrawerSkills([...currentSkills]);
    setCopyToNext7Days(false);
  };

  // Apply Template to Current Drawer
  const handleApplyTemplateToDrawer = (templateId: string) => {
    if (!templateId || !drawerRoster) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;

    const newBreaks: RosterBreakPeriod[] =
      tpl.hasBreak && tpl.breakStart && tpl.breakEnd
        ? [
            {
              id: `brk_${Date.now()}`,
              start: tpl.breakStart,
              end: tpl.breakEnd,
              note: 'Break Template',
            },
          ]
        : [];

    setDrawerRoster({
      ...drawerRoster,
      shiftStart: tpl.shiftStart,
      shiftEnd: tpl.shiftEnd,
      breaks: newBreaks,
    });
  };

  // Perform actual save after validation / confirmation
  const executeSaveDrawer = async () => {
    if (!editingTherapist || !drawerRoster) return;
    setIsSavingDrawer(true);

    try {
      const actor = currentUser?.name || 'Supervisor Operasional';

      // 1. Save daily roster with source 'override'
      await saveTherapistRoster(
        { ...drawerRoster, source: 'override' },
        actor,
        `Pembaruan shift harian & override tanggal`
      );

      // 2. Save skill matrix
      await updateTherapistSkillMatrix(
        editingTherapist.id,
        editingTherapist.name,
        drawerSkills,
        actor
      );

      // 3. If copyToNext7Days checked, apply shift hours to next 7 days
      if (copyToNext7Days) {
        const [y, m, d] = selectedDate.split('-').map((v) => parseInt(v, 10));
        for (let i = 1; i <= 6; i++) {
          const nextDateObj = new Date(y, m - 1, d + i);
          const nextDateStr = nextDateObj.toISOString().split('T')[0];
          const nextRoster: TherapistRoster = {
            ...drawerRoster,
            id: buildRosterDocId(editingTherapist.id, nextDateStr),
            date: nextDateStr,
            updatedAt: new Date().toISOString(),
            updatedBy: actor,
            source: 'override',
          };
          await saveTherapistRoster(nextRoster, actor, `Salin shift 7 hari`);
        }
      }

      setNotice(`Shift & kualifikasi ${editingTherapist.name} berhasil diperbarui.`);
      setTimeout(() => setNotice(''), 3500);

      // Refresh local rosters
      const updatedList = await ensureDailyRosters(therapists, selectedDate, actor);
      setRosters(updatedList);

      setEditingTherapist(null);
      setDrawerRoster(null);
      setIsConflictWarningOpen(false);
      setConflictImpact(null);
      setPendingSaveHandler(null);
    } catch (err: any) {
      alert(`Gagal menyimpan perubahan shift: ${err.message || err}`);
    } finally {
      setIsSavingDrawer(false);
    }
  };

  // Save Shift Drawer with Pre-Save Impact Analysis
  const handleSaveDrawer = async () => {
    if (!editingTherapist || !drawerRoster) return;

    // Shift hours validation
    if (drawerRoster.status === 'scheduled') {
      const startMin = timeToMinutes(drawerRoster.shiftStart);
      const endMin = timeToMinutes(drawerRoster.shiftEnd);
      if (startMin >= endMin) {
        alert('Jam mulai shift harus lebih awal daripada jam selesai shift.');
        return;
      }

      if (drawerRoster.breaks && drawerRoster.breaks.length > 0) {
        for (const b of drawerRoster.breaks) {
          const bStart = timeToMinutes(b.start);
          const bEnd = timeToMinutes(b.end);
          if (bStart >= bEnd) {
            alert(`Jam mulai istirahat (${b.start}) harus sebelum selesai (${b.end}).`);
            return;
          }
          if (bStart < startMin || bEnd > endMin) {
            alert(`Waktu istirahat (${b.start}-${b.end}) harus di dalam jam shift (${drawerRoster.shiftStart}-${drawerRoster.shiftEnd}).`);
            return;
          }
        }
      }
    }

    // Impact analysis for existing bookings
    const impact = analyzeShiftImpactOnBookings(
      editingTherapist.id,
      selectedDate,
      drawerRoster.shiftStart,
      drawerRoster.shiftEnd,
      drawerRoster.status,
      drawerRoster.breaks || [],
      bookings
    );

    if (impact.hasConflict) {
      setConflictImpact(impact);
      setPendingSaveHandler(() => async () => {
        await executeSaveDrawer();
      });
      setIsConflictWarningOpen(true);
      return;
    }

    await executeSaveDrawer();
  };

  // Add break inside drawer
  const handleAddBreak = () => {
    if (!drawerRoster) return;
    const newBreak: RosterBreakPeriod = {
      id: `brk_${Date.now()}`,
      start: newBreakStart,
      end: newBreakEnd,
      note: newBreakNote || 'Istirahat',
    };

    setDrawerRoster({
      ...drawerRoster,
      breaks: [...(drawerRoster.breaks || []), newBreak],
    });
  };

  // Remove break inside drawer
  const handleRemoveBreak = (breakId: string) => {
    if (!drawerRoster) return;
    setDrawerRoster({
      ...drawerRoster,
      breaks: (drawerRoster.breaks || []).filter((b) => b?.id !== breakId),
    });
  };

  // Toggle skill in drawer
  const handleToggleSkill = (serviceId: string) => {
    setDrawerSkills((prev) =>
      (prev || []).includes(serviceId)
        ? (prev || []).filter((id) => id !== serviceId)
        : [...(prev || []), serviceId]
    );
  };

  // Timeline Helper: calculate left percentage and width percentage
  const getTimelinePosition = (startMinutes: number, durationMinutes: number) => {
    const timelineStartMin = TIMELINE_START_HOUR * 60; // 600
    const clampedStart = Math.max(timelineStartMin, startMinutes);
    const clampedEnd = Math.min(timelineStartMin + TOTAL_TIMELINE_MINUTES, startMinutes + durationMinutes);
    const visibleDuration = Math.max(0, clampedEnd - clampedStart);

    const leftPercent = ((clampedStart - timelineStartMin) / TOTAL_TIMELINE_MINUTES) * 100;
    const widthPercent = (visibleDuration / TOTAL_TIMELINE_MINUTES) * 100;

    return {
      left: `${Math.max(0, Math.min(100, leftPercent))}%`,
      width: `${Math.max(1, Math.min(100, widthPercent))}%`,
    };
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Calendar Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-[#082A4F] text-[#D4AF37] font-mono text-[10px] font-bold uppercase tracking-wider">
                ROSTER OPERASIONAL
              </span>
              <span className="text-xs text-slate-500 font-medium">Kota Palembang</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold font-serif text-[#082A4F] mt-1 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#D4AF37]" />
              <span>Jadwal & Ketersediaan Armada Terapis</span>
            </h2>
            <p className="text-xs text-slate-500">
              Manajemen shift harian, matriks keahlian, jendela istirahat, dan pencegahan bentrok jadwal
            </p>
          </div>

          {/* Quick Date Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleSelectQuickTab('today')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  activeTab === 'today'
                    ? 'bg-[#082A4F] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Hari Ini
              </button>
              <button
                type="button"
                onClick={() => handleSelectQuickTab('tomorrow')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  activeTab === 'tomorrow'
                    ? 'bg-[#082A4F] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Besok
              </button>
            </div>

            {/* Stepper Date Picker */}
            <div className="flex items-center gap-1 bg-[#FAF9F6] border border-slate-200 rounded-xl px-2 py-1 shadow-2xs">
              <button
                type="button"
                onClick={() => handleStepDay(-1)}
                className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition cursor-pointer"
                title="Hari Sebelumnya"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleCustomDateChange(e.target.value)}
                className="text-xs font-mono font-bold text-[#082A4F] bg-transparent border-0 focus:ring-0 p-0 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => handleStepDay(1)}
                className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition cursor-pointer"
                title="Hari Berikutnya"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Notice feedback */}
        {notice && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Operational Conflict Banner */}
        {detectedConflicts.length > 0 && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 space-y-2 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-900">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Terdeteksi {detectedConflicts.length} Potensi Konflik Jadwal Tanggal {selectedDate}!</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800 bg-rose-200/80 px-2 py-0.5 rounded">
                Perlu Tindakan
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {(detectedConflicts || []).map((c) => (
                <div
                  key={c.id}
                  className="bg-white p-2 rounded-lg border border-rose-200 flex items-center justify-between gap-2 shadow-2xs"
                >
                  <div className="truncate">
                    <strong className="text-slate-900">{c.booking.bookingCode}</strong> ({c.therapistName}):{' '}
                    <span className="text-rose-700">{c.reason}</span>
                  </div>
                  {onOpenAssignModal && (
                    <button
                      type="button"
                      onClick={() => onOpenAssignModal(c.booking)}
                      className="px-2 py-1 rounded bg-[#082A4F] text-white text-[10px] font-bold hover:bg-[#0E3D73] transition cursor-pointer whitespace-nowrap"
                    >
                      Alihkan
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Capacity & Shift Overview Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <div className="bg-[#FAF9F6] border border-slate-200 p-3 rounded-xl">
            <span className="text-[10px] text-slate-500 block font-semibold uppercase">Total Armada</span>
            <strong className="text-lg text-[#082A4F] font-mono">{capacitySummary.total}</strong>
            <span className="text-[10px] text-slate-400 block">Terapis Terdaftar</span>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
            <span className="text-[10px] text-emerald-800 block font-semibold uppercase">Standby / Bertugas</span>
            <strong className="text-lg text-emerald-700 font-mono">{capacitySummary.activeOnShift}</strong>
            <span className="text-[10px] text-emerald-600 block">Siap Melayani</span>
          </div>

          <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl">
            <span className="text-[10px] text-blue-800 block font-semibold uppercase">Jadwal Istirahat</span>
            <strong className="text-lg text-blue-700 font-mono">{capacitySummary.onBreak}</strong>
            <span className="text-[10px] text-blue-600 block">Break Window</span>
          </div>

          <div className="bg-slate-100 border border-slate-200 p-3 rounded-xl">
            <span className="text-[10px] text-slate-600 block font-semibold uppercase">Off / Libur</span>
            <strong className="text-lg text-slate-700 font-mono">{capacitySummary.off}</strong>
            <span className="text-[10px] text-slate-500 block">Tidak Bertugas</span>
          </div>

          <div className="bg-[#082A4F]/5 border border-[#082A4F]/20 p-3 rounded-xl">
            <span className="text-[10px] text-[#082A4F] block font-semibold uppercase">Order Hari Ini</span>
            <strong className="text-lg text-[#082A4F] font-mono">{sameDayBookings.length}</strong>
            <span className="text-[10px] text-slate-500 block">Sesi Terjadwal</span>
          </div>

          <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl">
            <span className="text-[10px] text-amber-800 block font-semibold uppercase">Cakupan Layanan</span>
            <div className="text-[10px] font-bold text-amber-900 mt-1 space-y-0.5">
              <div>Sig 60m: {capacitySummary.serviceMap['srv-sig-60'] || 0} terapis</div>
              <div>Sig 90m: {capacitySummary.serviceMap['srv-sig-90'] || 0} terapis</div>
              <div>Sig 120m: {capacitySummary.serviceMap['srv-sig-120'] || 0} terapis</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-View Navigation Switcher & Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setSubView('master_table')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              subView === 'master_table'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Tabel Master & Shift</span>
          </button>
          <button
            type="button"
            onClick={() => setSubView('timeline')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
              subView === 'timeline'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Visual Timeline & Slot</span>
          </button>
        </div>

        {/* Global Toolbar Actions */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setTemplatesBulkMode('bulk_apply');
              setIsTemplatesBulkModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
            title="Terapkan jadwal / shift ke beberapa terapis sekaligus"
          >
            <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Terapkan Massal</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTemplatesBulkMode('templates');
              setIsTemplatesBulkModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
            title="Kelola daftar template shift siap pakai"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Template Shift</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCopyTherapist(therapists[0] || null);
              setIsCopyModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
            title="Salin jadwal terapis ke tanggal lain"
          >
            <Copy className="w-3.5 h-3.5 text-[#082A4F]" />
            <span>Salin Jadwal</span>
          </button>
        </div>
      </div>

      {/* Main View: Either Master Table OR Timeline */}
      {subView === 'master_table' ? (
        <TherapistScheduleMasterTable
          therapists={therapists}
          bookings={bookings}
          selectedDate={selectedDate}
          rosters={rosters}
          templates={templates}
          onOpenEditShift={(th) => handleOpenShiftDrawer(th)}
          onEditShift={(th) => handleOpenShiftDrawer(th)}
          onOpenWeeklySchedule={(th) => {
            setWeeklyTherapist(th);
            setIsWeeklyModalOpen(true);
          }}
          onEditWeeklySchedule={(th) => {
            setWeeklyTherapist(th);
            setIsWeeklyModalOpen(true);
          }}
          onOpenUnavailable={(th) => {
            setUnavailableTherapist(th);
            setIsUnavailableModalOpen(true);
          }}
          onSetUnavailableRange={(th) => {
            setUnavailableTherapist(th);
            setIsUnavailableModalOpen(true);
          }}
          onOpenCopySchedule={(th) => {
            setCopyTherapist(th);
            setIsCopyModalOpen(true);
          }}
          onOpenAssignModal={onOpenAssignModal}
          onSelectBooking={(b) => {
            if (onOpenAssignModal) {
              onOpenAssignModal(b);
            }
          }}
          onRefresh={async () => {
            const actor = currentUser?.name || 'Supervisor Operasional';
            const updated = await ensureDailyRosters(therapists, selectedDate, actor);
            setRosters(updated);
          }}
        />
      ) : (
        /* Visual Timeline & Roster Matrix */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4 overflow-x-auto">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 min-w-[760px]">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#D4AF37]" />
            <h3 className="text-sm font-bold font-serif text-[#082A4F]">
              Timeline Operasional Harian (10:00 - 22:00 WIB)
            </h3>
          </div>

          {/* Color Legend */}
          <div className="flex items-center gap-3 text-[11px] text-slate-600 font-medium">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-[#082A4F]"></span>
              <span>Order Treatment</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-[#D4AF37]"></span>
              <span>Buffer Perjalanan</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-amber-200 border border-amber-400"></span>
              <span>Istirahat (Break)</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-slate-200 border border-slate-300"></span>
              <span>Off / Di Luar Shift</span>
            </div>
          </div>
        </div>

        {/* Timeline Grid Table */}
        <div className="min-w-[860px] space-y-2">
          {/* Time axis header */}
          <div className="grid grid-cols-12 gap-1 text-[10px] font-mono text-slate-400 pl-[230px] border-b border-slate-100 pb-1">
            {Array.from({ length: TIMELINE_END_HOUR - TIMELINE_START_HOUR }).map((_, i) => {
              const hour = TIMELINE_START_HOUR + i;
              return (
                <div key={hour} className="text-left">
                  {String(hour).padStart(2, '0')}:00
                </div>
              );
            })}
          </div>

          {/* Therapist Rows */}
          {isLoading ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Memuat data roster dan jadwal armada...
            </div>
          ) : (
            (therapists || []).map((th) => {
              const roster = rosterMap.get(th.id);
              const isOff = roster?.status === 'off' || roster?.status === 'leave' || roster?.status === 'unavailable';
              const thBookings = (sameDayBookings || []).filter((b) => b?.therapistId === th.id);

              const shiftStartMin = timeToMinutes(roster?.shiftStart || '10:00');
              const shiftEndMin = timeToMinutes(roster?.shiftEnd || '21:00');

              return (
                <div
                  key={th.id}
                  className={`p-2 rounded-xl border transition flex items-center gap-3 ${
                    isOff
                      ? 'bg-slate-50/60 border-slate-200'
                      : 'bg-white hover:border-slate-300 border-slate-200'
                  }`}
                >
                  {/* Left: Therapist Info & Shift Action */}
                  <div className="w-[220px] flex-shrink-0 flex items-center justify-between pr-2 border-r border-slate-100">
                    <div className="space-y-0.5 truncate">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900 truncate">
                          {th.name}
                        </span>
                        <span className="text-[10px] text-slate-500">({th.gender[0]})</span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span
                          className={`px-1.5 py-0.2 rounded font-semibold ${
                            isOff
                              ? 'bg-slate-200 text-slate-700'
                              : roster?.status === 'working'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {isOff ? roster?.status.toUpperCase() : `${roster?.shiftStart}-${roster?.shiftEnd}`}
                        </span>
                        <span className="text-slate-400">• {thBookings.length} order</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenShiftDrawer(th)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-[#082A4F] hover:bg-slate-100 transition cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                      title="Kelola Shift & Skill"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>

                  {/* Right: Visual Timeline Track */}
                  <div className="flex-1 h-9 bg-slate-100 rounded-lg relative overflow-hidden border border-slate-200 shadow-inner">
                    {/* Hourly divider ticks */}
                    {Array.from({ length: TIMELINE_END_HOUR - TIMELINE_START_HOUR }).map((_, i) => (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 border-r border-slate-200/80 pointer-events-none"
                        style={{ left: `${(i / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)) * 100}%` }}
                      />
                    ))}

                    {/* If OFF / LEAVE, gray out entire timeline */}
                    {isOff ? (
                      <div className="absolute inset-0 bg-slate-200/70 flex items-center justify-center text-[10px] font-bold text-slate-600">
                        {roster?.status.toUpperCase()} ({roster?.unavailableReason || 'Tidak Bertugas'})
                      </div>
                    ) : (
                      <>
                        {/* Outside of shift shading (left of shift start) */}
                        {shiftStartMin > TIMELINE_START_HOUR * 60 && (
                          <div
                            className="absolute top-0 bottom-0 bg-slate-200/50"
                            style={{
                              left: '0%',
                              width: `${((shiftStartMin - TIMELINE_START_HOUR * 60) / TOTAL_TIMELINE_MINUTES) * 100}%`,
                            }}
                          />
                        )}

                        {/* Outside of shift shading (right of shift end) */}
                        {shiftEndMin < TIMELINE_END_HOUR * 60 && (
                          <div
                            className="absolute top-0 bottom-0 bg-slate-200/50"
                            style={{
                              left: `${((shiftEndMin - TIMELINE_START_HOUR * 60) / TOTAL_TIMELINE_MINUTES) * 100}%`,
                              right: '0%',
                            }}
                          />
                        )}

                        {/* Breaks blocks */}
                        {roster?.breaks?.map((brk) => {
                          const bStart = timeToMinutes(brk.start);
                          const bDur = timeToMinutes(brk.end) - bStart;
                          const pos = getTimelinePosition(bStart, bDur);
                          return (
                            <div
                              key={brk.id}
                              style={{ left: pos.left, width: pos.width }}
                              className="absolute top-1 bottom-1 rounded bg-amber-200/90 border border-amber-400 flex items-center justify-center text-[9px] font-bold text-amber-900 z-5 shadow-2xs truncate px-1"
                              title={`Istirahat: ${brk.start}-${brk.end} (${brk.note})`}
                            >
                              <Coffee className="w-2.5 h-2.5 mr-0.5 flex-shrink-0" />
                              <span className="truncate">Break {brk.start}</span>
                            </div>
                          );
                        })}

                        {/* Bookings & Travel Buffers */}
                        {(thBookings || []).map((b) => {
                          const bStartMin = timeToMinutes(b.scheduleTime);
                          const duration = b.serviceDuration || 90;
                          const bEndMin = bStartMin + duration;

                          // Booking position
                          const bookingPos = getTimelinePosition(bStartMin, duration);

                          // Travel buffer before (15m)
                          const bufferBeforePos = getTimelinePosition(bStartMin - 15, 15);
                          // Travel buffer after (15m)
                          const bufferAfterPos = getTimelinePosition(bEndMin, 15);

                          return (
                            <React.Fragment key={b.id}>
                              {/* Travel buffer before */}
                              <div
                                style={{ left: bufferBeforePos.left, width: bufferBeforePos.width }}
                                className="absolute top-2 bottom-2 bg-[#D4AF37]/50 rounded-xs z-6"
                                title="Buffer Perjalanan (15m)"
                              />

                              {/* Actual Booking Block */}
                              <div
                                style={{ left: bookingPos.left, width: bookingPos.width }}
                                onClick={() => onSelectBooking && onSelectBooking(b)}
                                className="absolute top-0.5 bottom-0.5 bg-[#082A4F] text-[#D4AF37] hover:bg-[#0E3D73] rounded-md px-1.5 py-0.5 flex items-center justify-between text-[9px] font-bold cursor-pointer z-10 shadow-xs transition truncate"
                                title={`Order ${b.bookingCode}: ${b.customerName} (${b.scheduleTime} WIB, ${duration}m, ${b.area})`}
                              >
                                <span className="truncate font-mono">{b.bookingCode}</span>
                                <span className="text-white text-[8px] truncate hidden sm:inline ml-1 font-normal">
                                  {b.scheduleTime}
                                </span>
                              </div>

                              {/* Travel buffer after */}
                              <div
                                style={{ left: bufferAfterPos.left, width: bufferAfterPos.width }}
                                className="absolute top-2 bottom-2 bg-[#D4AF37]/50 rounded-xs z-6"
                                title="Buffer Perjalanan (15m)"
                              />
                            </React.Fragment>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      {/* Shift & Skill Management Drawer */}
      {editingTherapist && drawerRoster && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl flex flex-col justify-between overflow-y-auto animate-slide-left">
            {/* Drawer Header */}
            <div className="p-5 bg-[#082A4F] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] text-[#D4AF37] font-mono font-bold uppercase tracking-wider">
                  MANAJEMEN SHIFT & ROSTER
                </span>
                <h3 className="text-lg font-bold font-serif">{editingTherapist.name}</h3>
                <p className="text-xs text-slate-300 font-mono">
                  Tanggal: {selectedDate} • Gender: {editingTherapist.gender}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setEditingTherapist(null)}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="p-5 space-y-5 flex-1 overflow-y-auto text-xs">
              {/* Operational Status */}
              <div className="space-y-2">
                <label className="font-bold text-slate-800 block text-xs">
                  Status Shift Operasional:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(['scheduled', 'working', 'break', 'off', 'leave', 'unavailable'] as RosterShiftStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setDrawerRoster({ ...drawerRoster, status: st })}
                      className={`p-2 rounded-xl border text-center font-bold capitalize transition cursor-pointer ${
                        drawerRoster.status === st
                          ? 'bg-[#082A4F] text-white border-[#082A4F] shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {st === 'off' ? 'Off (Libur)' : st === 'leave' ? 'Izin / Cuti' : st === 'unavailable' ? 'Unavailable' : st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unavailable / Off Reason */}
              {['off', 'leave', 'unavailable'].includes(drawerRoster.status) && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <label className="font-bold text-slate-800 block text-xs">
                    Alasan / Kategori Tidak Bertugas:
                  </label>
                  <select
                    value={drawerRoster.unavailableReason || 'Jadwal Libur Rutin'}
                    onChange={(e) => setDrawerRoster({ ...drawerRoster, unavailableReason: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium"
                  >
                    <option value="Jadwal Libur Rutin">Jadwal Libur Rutin Mingguan</option>
                    <option value="Sakit">Sakit (Medical Leave)</option>
                    <option value="Izin Pribadi / Keluarga">Izin Pribadi / Acara Keluarga</option>
                    <option value="Emergency Lapangan">Emergency Lapangan</option>
                    <option value="Kendala Kendaraan">Kendala Kendaraan / Masalah Transportasi</option>
                    <option value="Operational Hold">Penahanan Operasional Supervisor</option>
                  </select>
                </div>
              )}

              {/* Quick Shift Template Selector */}
              {templates.length > 0 && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Terapkan dari Template Shift:</span>
                    </span>
                    <span className="text-[10px] text-slate-400">Otomatis isi jam & break</span>
                  </div>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        handleApplyTemplateToDrawer(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <option value="">-- Pilih Template Shift Siap Pakai --</option>
                    {(templates || []).map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.shiftStart} - {tpl.shiftEnd} WIB)
                        {tpl.hasBreak ? ` • Break ${tpl.breakStart}-${tpl.breakEnd}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Shift Hours */}
              <div className="space-y-2">
                <label className="font-bold text-slate-800 block text-xs">
                  Jam Kerja Shift:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-slate-500 block mb-1">Mulai Shift (HH:mm)</span>
                    <input
                      type="time"
                      value={drawerRoster.shiftStart ?? '10:00'}
                      onChange={(e) => setDrawerRoster({ ...drawerRoster, shiftStart: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block mb-1">Selesai Shift (HH:mm)</span>
                    <input
                      type="time"
                      value={drawerRoster.shiftEnd ?? '22:00'}
                      onChange={(e) => setDrawerRoster({ ...drawerRoster, shiftEnd: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Breaks Management */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <Coffee className="w-4 h-4 text-amber-600" />
                    <span>Jadwal Istirahat (Breaks):</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {drawerRoster.breaks?.length || 0} periode
                  </span>
                </div>

                {/* Breaks list */}
                <div className="space-y-1.5">
                  {drawerRoster.breaks?.map((brk) => (
                    <div
                      key={brk.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 font-medium"
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-amber-700" />
                        <span className="font-mono font-bold">{brk.start} - {brk.end}</span>
                        <span className="text-amber-700 text-[11px]">• {brk.note}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveBreak(brk.id)}
                        className="text-rose-600 hover:text-rose-800 p-1 cursor-pointer"
                        title="Hapus Break"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add new break row */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-[10px] font-bold text-slate-600 uppercase block">Tambah Periode Break</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="time"
                      value={newBreakStart}
                      onChange={(e) => setNewBreakStart(e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                    />
                    <input
                      type="time"
                      value={newBreakEnd}
                      onChange={(e) => setNewBreakEnd(e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Keterangan (cth: Istirahat Siang & Sholat)..."
                      value={newBreakNote}
                      onChange={(e) => setNewBreakNote(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddBreak}
                      className="px-3 py-1.5 bg-[#082A4F] text-white rounded-lg text-xs font-bold hover:bg-[#0E3D73] transition cursor-pointer flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Skill Matrix / Service Capabilities */}
              <div className="space-y-2">
                <label className="font-bold text-slate-800 block text-xs flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                  <span>Matriks Keahlian Layanan (Skill Matrix):</span>
                </label>
                <p className="text-[11px] text-slate-500">
                  Tentukan jenis layanan yang diizinkan untuk dikerjakan oleh terapis ini.
                </p>
                <div className="space-y-1.5">
                  {(services || []).map((srv) => {
                    const isChecked = drawerSkills.includes(srv.id) || drawerSkills.includes('all');
                    return (
                      <label
                        key={srv.id}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer ${
                          isChecked
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleSkill(srv.id)}
                            className="w-4 h-4 rounded text-[#082A4F] accent-[#082A4F]"
                          />
                          <span>{srv.name}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {srv.duration} Menit
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Copy to 7 Days Option */}
              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                <label className="flex items-start gap-2.5 cursor-pointer text-xs font-bold text-indigo-950">
                  <input
                    type="checkbox"
                    checked={copyToNext7Days}
                    onChange={(e) => setCopyToNext7Days(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-700 accent-indigo-700 mt-0.5"
                  />
                  <div>
                    <span>Terapkan jam shift ini ke 7 hari ke depan</span>
                    <p className="text-[10px] text-indigo-700 font-normal mt-0.5">
                      Menyalin pengaturan jam kerja ke hari berikutnya tanpa perlu mengatur ulang secara manual.
                    </p>
                  </div>
                </label>
              </div>

              {/* Internal Notes */}
              <div>
                <label className="font-bold text-slate-800 block text-xs mb-1">
                  Catatan Operasional Supervisor:
                </label>
                <textarea
                  rows={2}
                  placeholder="Catatan tambahan (cth: izin pulang cepat, pertukaran shift armada)..."
                  value={drawerRoster.note || ''}
                  onChange={(e) => setDrawerRoster({ ...drawerRoster, note: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-xs"
                />
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setEditingTherapist(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
              >
                Batal
              </button>

              <button
                type="button"
                onClick={handleSaveDrawer}
                disabled={isSavingDrawer}
                className="px-5 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
                <span>{isSavingDrawer ? 'Menyimpan Perubahan...' : 'Simpan Shift & Roster'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL 1: Weekly Schedule Modal */}
      {isWeeklyModalOpen && weeklyTherapist && (
        <WeeklyScheduleModal
          isOpen={isWeeklyModalOpen}
          therapist={weeklyTherapist}
          templates={templates}
          onClose={() => {
            setIsWeeklyModalOpen(false);
            setWeeklyTherapist(null);
          }}
          onSuccess={async (msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(''), 3500);
            const actor = currentUser?.name || 'Supervisor Operasional';
            const updated = await ensureDailyRosters(therapists, selectedDate, actor);
            setRosters(updated);
          }}
        />
      )}

      {/* MODAL 2: Unavailable Range Modal */}
      {isUnavailableModalOpen && unavailableTherapist && (
        <UnavailableRangeModal
          isOpen={isUnavailableModalOpen}
          therapist={unavailableTherapist}
          bookings={bookings}
          onClose={() => {
            setIsUnavailableModalOpen(false);
            setUnavailableTherapist(null);
          }}
          onSuccess={async (msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(''), 3500);
            const actor = currentUser?.name || 'Supervisor Operasional';
            const updated = await ensureDailyRosters(therapists, selectedDate, actor);
            setRosters(updated);
          }}
          onOpenAssignModal={onOpenAssignModal}
        />
      )}

      {/* MODAL 3: Shift Templates & Bulk Apply Modal */}
      {isTemplatesBulkModalOpen && (
        <ShiftTemplatesAndBulkModal
          isOpen={isTemplatesBulkModalOpen}
          initialMode={templatesBulkMode}
          therapists={therapists}
          bookings={bookings}
          selectedDate={selectedDate}
          onClose={() => setIsTemplatesBulkModalOpen(false)}
          onSuccess={async (msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(''), 3500);
            const refreshed = await getRosterTemplates();
            setTemplates(refreshed);
            const actor = currentUser?.name || 'Supervisor Operasional';
            const updated = await ensureDailyRosters(therapists, selectedDate, actor);
            setRosters(updated);
          }}
          onOpenAssignModal={onOpenAssignModal}
        />
      )}

      {/* MODAL 4: Copy Schedule Modal */}
      {isCopyModalOpen && copyTherapist && (
        <CopyScheduleModal
          isOpen={isCopyModalOpen}
          therapists={therapists}
          sourceDate={selectedDate}
          preselectedTherapistId={copyTherapist.id}
          onClose={() => {
            setIsCopyModalOpen(false);
            setCopyTherapist(null);
          }}
          onSuccess={async (msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(''), 3500);
            const actor = currentUser?.name || 'Supervisor Operasional';
            const updated = await ensureDailyRosters(therapists, selectedDate, actor);
            setRosters(updated);
          }}
        />
      )}

      {/* MODAL 5: Shift Conflict Warning Modal */}
      {isConflictWarningOpen && conflictImpact && (
        <ShiftConflictWarningModal
          isOpen={isConflictWarningOpen}
          impact={conflictImpact}
          isSaving={isSavingDrawer}
          onClose={() => {
            setIsConflictWarningOpen(false);
            setConflictImpact(null);
            setPendingSaveHandler(null);
          }}
          onConfirmProceed={async () => {
            if (pendingSaveHandler) {
              await pendingSaveHandler();
            }
          }}
          onOpenAssignModal={(booking) => {
            setIsConflictWarningOpen(false);
            if (onOpenAssignModal) {
              onOpenAssignModal(booking);
            }
          }}
        />
      )}
    </div>
  );
};
