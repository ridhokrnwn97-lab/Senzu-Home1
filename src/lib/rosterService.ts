import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  Therapist,
  TherapistRoster,
  RosterShiftStatus,
  RosterBreakPeriod,
  TherapistShiftConfig,
  Booking,
  ShiftTemplate,
  TherapistWeeklySchedule,
  WeeklyScheduleDay,
  OperationalShiftStatus,
} from '../types';
import { addOperationalAuditLog } from './dbService';
import { emitEvent } from './notificationService';
import { cleanFirestoreData, getTodayDateWIB } from './utils';

export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10) || 0);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const norm = Math.max(0, totalMinutes);
  const h = Math.floor(norm / 60) % 24;
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const DEFAULT_PALEMBANG_SHIFTS: Record<string, TherapistShiftConfig> = {
  'th-rina': { start: '10:00', end: '21:00', offDays: [1] }, // Senin Libur
  'th-siti': { start: '11:00', end: '22:00', offDays: [2] }, // Selasa Libur
  'th-budi': { start: '10:00', end: '21:00', offDays: [3] }, // Rabu Libur
  'th-fauzi': { start: '11:00', end: '22:00', offDays: [4] }, // Kamis Libur
};

export const DEFAULT_SKILL_MATRIX: Record<string, string[]> = {
  'th-rina': ['srv-sig-60', 'srv-sig-90', 'srv-sig-120'], // All services qualified
  'th-siti': ['srv-sig-60', 'srv-sig-90'],                 // Signature 60 & 90
  'th-budi': ['srv-sig-60', 'srv-sig-90', 'srv-sig-120'], // All services qualified
  'th-fauzi': ['srv-sig-60', 'srv-sig-90'],                // Signature 60 & 90
};

/**
 * Helper to build doc ID for therapist roster
 */
export function buildRosterDocId(therapistId: string, date: string): string {
  return `${therapistId}_${date}`;
}

/**
 * Generate a default roster item for a therapist on a specific date based on weekly schedule or default shift config
 */
export function createDefaultRosterForTherapist(
  therapist: Therapist,
  date: string,
  actorName: string = 'System Default'
): TherapistRoster {
  const [year, month, day] = date.split('-').map((v) => parseInt(v, 10));
  const dateObj = new Date(year, month - 1, day);
  const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, ...

  const weeklyDay = therapist.weeklySchedule?.[dayOfWeek];
  let shiftStart = '10:00';
  let shiftEnd = '21:00';
  let isOffDay = false;
  let defaultBreaks: RosterBreakPeriod[] = [];

  if (weeklyDay) {
    isOffDay = !weeklyDay.isWorking;
    shiftStart = weeklyDay.shiftStart || '10:00';
    shiftEnd = weeklyDay.shiftEnd || '21:00';
    if (weeklyDay.hasBreak && weeklyDay.breakStart && weeklyDay.breakEnd) {
      defaultBreaks = [
        {
          id: `brk-${therapist.id}-${dayOfWeek}`,
          start: weeklyDay.breakStart,
          end: weeklyDay.breakEnd,
          note: 'Istirahat Terjadwal',
        },
      ];
    }
  } else {
    const shiftConfig =
      therapist.defaultShift ||
      DEFAULT_PALEMBANG_SHIFTS[therapist.id] || {
        start: '10:00',
        end: '21:00',
        offDays: [],
      };

    isOffDay = shiftConfig.offDays.includes(dayOfWeek);
    shiftStart = shiftConfig.start;
    shiftEnd = shiftConfig.end;
    defaultBreaks = isOffDay
      ? []
      : [
          {
            id: `brk-${therapist.id}-1`,
            start: '13:00',
            end: '14:00',
            note: 'Istirahat Siang & Sholat',
          },
        ];
  }

  return {
    id: buildRosterDocId(therapist.id, date),
    therapistId: therapist.id,
    therapistName: therapist.name,
    date,
    shiftStart,
    shiftEnd,
    status: isOffDay ? 'off' : 'scheduled',
    breaks: defaultBreaks,
    unavailableReason: isOffDay ? 'Jadwal Libur Rutin Mingguan' : '',
    note: isOffDay ? 'Hari Libur Terjadwal' : 'Shift Reguler Operasional',
    source: 'default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };
}

/**
 * Fetch a single therapist's roster for a specific date (YYYY-MM-DD)
 */
export async function getTherapistRoster(
  therapistId: string,
  date: string
): Promise<TherapistRoster | null> {
  try {
    const docId = buildRosterDocId(therapistId, date);
    const snap = await getDoc(doc(db, 'therapist_rosters', docId));
    if (snap.exists()) {
      return snap.data() as TherapistRoster;
    }
    return null;
  } catch (err) {
    console.warn('Failed to fetch therapist roster:', err);
    return null;
  }
}

/**
 * Fetch daily rosters for a specific date (YYYY-MM-DD)
 */
export async function getDailyRosters(date: string): Promise<TherapistRoster[]> {
  try {
    const q = query(collection(db, 'therapist_rosters'), where('date', '==', date));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as TherapistRoster);
  } catch (err) {
    console.warn('Failed to fetch daily rosters:', err);
    return [];
  }
}

/**
 * Fetch rosters for a date range (YYYY-MM-DD to YYYY-MM-DD)
 */
export async function getRostersDateRange(
  startDate: string,
  endDate: string
): Promise<TherapistRoster[]> {
  try {
    const q = query(
      collection(db, 'therapist_rosters'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as TherapistRoster);
  } catch (err) {
    console.warn('Failed to fetch rosters range:', err);
    return [];
  }
}

/**
 * Realtime subscription to daily rosters for a date
 */
export function subscribeToDailyRosters(
  date: string,
  callback: (rosters: TherapistRoster[]) => void
) {
  const q = query(collection(db, 'therapist_rosters'), where('date', '==', date));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as TherapistRoster);
      callback(list);
    },
    (err) => {
      console.warn('Subscribe daily rosters notice:', err);
    }
  );
}

/**
 * Ensure daily rosters exist for a list of therapists on a given date.
 * If some or all do not exist yet, initializes them and saves to Firestore.
 */
export async function ensureDailyRosters(
  therapists: Therapist[],
  date: string,
  actorName: string = 'Supervisor Operasional'
): Promise<TherapistRoster[]> {
  try {
    const existing = await getDailyRosters(date);
    const existingMap = new Map((existing || []).map((r) => [r.therapistId, r]));

    const missingTherapists = (therapists || []).filter((th) => !existingMap.has(th.id));

    if (missingTherapists.length > 0) {
      for (const th of missingTherapists) {
        const newRoster = createDefaultRosterForTherapist(th, date, actorName);
        await setDoc(doc(db, 'therapist_rosters', newRoster.id), cleanFirestoreData(newRoster));
        existingMap.set(th.id, newRoster);
      }
    }

    return Array.from(existingMap.values());
  } catch (err) {
    console.warn('Ensure daily rosters notice:', err);
    return (therapists || []).map((th) => createDefaultRosterForTherapist(th, date, actorName));
  }
}

/**
 * Save / update a therapist roster document
 */
export async function saveTherapistRoster(
  roster: TherapistRoster,
  actorName: string,
  auditNote?: string
): Promise<void> {
  const docRef = doc(db, 'therapist_rosters', roster.id);
  const updatedRoster: TherapistRoster = {
    ...roster,
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };

  await setDoc(docRef, cleanFirestoreData(updatedRoster), { merge: true });

  // Record audit log
  await addOperationalAuditLog({
    therapistId: roster.therapistId,
    therapistName: roster.therapistName,
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    oldValue: roster.status,
    newValue: `${roster.status} (${roster.shiftStart}-${roster.shiftEnd})`,
    reason: auditNote || `Pembaruan roster tanggal ${roster.date}`,
    note: roster.note || roster.unavailableReason || 'Pembaruan roster',
  });
}

/**
 * Set therapist operational status for a specific date (e.g. mark off, leave, unavailable, break)
 * Defensively normalizes arguments so calls like (therapistId, status) or (therapistId, therapistName, date, status, ...)
 * work seamlessly without creating corrupted IDs or passing undefined fields to Firestore.
 */
export async function setTherapistRosterStatus(
  therapistId: string,
  arg2?: string,
  arg3?: string,
  arg4?: RosterShiftStatus | string,
  arg5?: string,
  arg6?: string,
  arg7?: string
): Promise<void> {
  const validStatuses: RosterShiftStatus[] = [
    'scheduled',
    'working',
    'break',
    'off',
    'leave',
    'unavailable',
    'completed',
  ];

  const todayWIB = getTodayDateWIB();

  const isDate = (val?: string): boolean => Boolean(val && /^\d{4}-\d{2}-\d{2}$/.test(val));
  const toRosterStatus = (val?: string): RosterShiftStatus | null => {
    if (!val) return null;
    if (val === 'available' || val === 'scheduled') return 'scheduled';
    if (val === 'on_duty' || val === 'working') return 'working';
    if (validStatuses.includes(val as RosterShiftStatus)) return val as RosterShiftStatus;
    return null;
  };

  const rawArgs = [arg2, arg3, arg4, arg5, arg6, arg7];

  // 1. Resolve date
  let actualDate = todayWIB;
  const foundDate = rawArgs.find((a) => typeof a === 'string' && isDate(a));
  if (foundDate && typeof foundDate === 'string') {
    actualDate = foundDate;
  }

  // 2. Resolve status
  let actualStatus: RosterShiftStatus = 'scheduled';
  const foundStatus = rawArgs
    .map((a) => (typeof a === 'string' ? toRosterStatus(a) : null))
    .find((s) => s !== null);
  if (foundStatus) {
    actualStatus = foundStatus;
  }

  // 3. Resolve therapistName
  let actualTherapistName = 'Terapis';
  if (typeof arg2 === 'string' && !isDate(arg2) && !toRosterStatus(arg2)) {
    actualTherapistName = arg2;
  } else if (typeof arg3 === 'string' && !isDate(arg3) && !toRosterStatus(arg3)) {
    actualTherapistName = arg3;
  }

  // 4. Resolve reason & note
  let actualUnavailableReason = '';
  let actualNote = '';
  if (actualStatus === 'break') {
    actualUnavailableReason = (arg5 as string) || (arg4 as string) || 'Istirahat Mandiri';
    actualNote = (arg6 as string) || (arg5 as string) || 'Terapis sedang istirahat mandiri';
  } else if (actualStatus === 'off') {
    actualUnavailableReason = (arg5 as string) || (arg4 as string) || 'Selesai Shift';
    actualNote = (arg6 as string) || (arg5 as string) || 'Terapis selesai shift';
  } else {
    actualUnavailableReason = (arg5 as string) || '';
    actualNote = (arg6 as string) || (arg5 as string) || (arg4 as string) || 'Terapis aktif dan siap menerima booking';
  }

  // 5. Resolve actor
  let actualActor = 'Supervisor';
  if (typeof arg7 === 'string' && arg7.trim()) {
    actualActor = arg7;
  } else if (actualTherapistName && actualTherapistName !== 'Terapis') {
    actualActor = actualTherapistName;
  }

  // Safety fallback: ensure actualDate is valid YYYY-MM-DD
  if (!isDate(actualDate)) {
    actualDate = todayWIB;
  }

  const rosterId = buildRosterDocId(therapistId, actualDate);
  const docRef = doc(db, 'therapist_rosters', rosterId);
  let currentRoster: TherapistRoster | null = null;
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      currentRoster = snap.data() as TherapistRoster;
    }
  } catch (err) {
    console.warn('[RosterService] getDoc notice, falling back:', err);
  }

  const sanitizedBreaks = (currentRoster?.breaks || []).map((b) => ({
    id: b.id || `brk-${Date.now()}`,
    start: b.start || '13:00',
    end: b.end || '14:00',
    note: b.note || '',
  }));

  const updated: TherapistRoster = {
    id: rosterId,
    therapistId,
    therapistName: actualTherapistName || currentRoster?.therapistName || 'Terapis',
    date: actualDate,
    shiftStart: currentRoster?.shiftStart || '10:00',
    shiftEnd: currentRoster?.shiftEnd || '21:00',
    status: actualStatus,
    breaks: sanitizedBreaks,
    unavailableReason: actualUnavailableReason || '',
    note: actualNote || '',
    createdAt: currentRoster?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actualActor,
  };

  try {
    await setDoc(docRef, cleanFirestoreData(updated), { merge: true });
  } catch (fsErr) {
    console.warn('[RosterService] Direct setDoc failed, attempting /api/therapist/update-availability:', fsErr);
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
    const res = await fetch('/api/therapist/update-availability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        therapistId,
        therapistName: actualTherapistName || currentRoster?.therapistName || 'Terapis',
        date: actualDate,
        status: actualStatus,
        unavailableReason: actualUnavailableReason || '',
        note: actualNote || '',
        actor: actualActor,
      }),
    });
    if (!res.ok) {
      throw fsErr;
    }
  }

  try {
    await addOperationalAuditLog({
      therapistId,
      therapistName: actualTherapistName || currentRoster?.therapistName || 'Terapis',
      action: 'shift_change',
      actorRole: 'supervisor',
      actorName: actualActor,
      oldValue: currentRoster?.status || 'unknown',
      newValue: actualStatus,
      reason: actualUnavailableReason || `Perubahan status shift ke ${actualStatus}`,
      note: actualNote || `Roster tanggal ${actualDate}`,
    });
  } catch (auditErr) {
    console.warn('[RosterService] Operational audit log notice:', auditErr);
  }
}

/**
 * Update therapist skill matrix (which services they are certified/qualified to perform)
 */
export async function updateTherapistSkillMatrix(
  therapistId: string,
  therapistName: string,
  serviceIds: string[],
  actorName: string
): Promise<void> {
  const docRef = doc(db, 'therapists', therapistId);
  await updateDoc(docRef, { serviceIds });

  await addOperationalAuditLog({
    therapistId,
    therapistName,
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    newValue: `Layanan: ${serviceIds.join(', ')}`,
    reason: `Pembaruan Skill Matrix Terapis`,
    note: `Kualifikasi layanan diperbarui oleh Supervisor`,
  });
}

/**
 * Update default shift template for a therapist
 */
export async function updateTherapistDefaultShift(
  therapistId: string,
  therapistName: string,
  shiftConfig: TherapistShiftConfig,
  actorName: string
): Promise<void> {
  const docRef = doc(db, 'therapists', therapistId);
  await updateDoc(docRef, { defaultShift: shiftConfig });

  await addOperationalAuditLog({
    therapistId,
    therapistName,
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    newValue: `Shift Default: ${shiftConfig.start}-${shiftConfig.end}, Libur: ${shiftConfig.offDays.join(',')}`,
    reason: `Pembaruan Template Shift Mingguan`,
    note: `Jadwal shift default diperbarui oleh Supervisor`,
  });
}

/**
 * Send in-app notification to therapist when supervisor updates their shift
 */
export async function notifyTherapistShiftChange(
  therapistId: string,
  therapistName: string,
  date: string,
  changeSummary: string,
  actorName: string
): Promise<void> {
  try {
    await emitEvent(
      'therapist.shift_updated',
      {
        therapistId,
        therapistName,
        date,
        changeSummary,
        actorName,
        rosterId: buildRosterDocId(therapistId, date),
      },
      ['therapist']
    );
  } catch (err) {
    console.warn('Failed to send shift notification to therapist:', err);
  }
}

/**
 * Analyze impact of a proposed shift change or status change on existing bookings.
 * Detects if existing bookings fall outside the new shift, overlap with breaks, or if therapist is set OFF/UNAVAILABLE.
 */
export interface ShiftImpactAnalysis {
  hasConflict: boolean;
  affectedBookings: Array<{
    booking: Booking;
    reason: string;
    code: 'OUTSIDE_SHIFT' | 'OVERLAP_BREAK' | 'THERAPIST_OFF_OR_UNAVAILABLE';
  }>;
}

export function analyzeShiftImpactOnBookings(
  therapistId: string,
  targetDate: string,
  newShiftStart: string,
  newShiftEnd: string,
  newStatus: RosterShiftStatus,
  newBreaks: RosterBreakPeriod[] = [],
  bookings: Booking[] = []
): ShiftImpactAnalysis {
  const activeBookings = bookings.filter(
    (b) =>
      b.therapistId === therapistId &&
      b.scheduleDate === targetDate &&
      b.status !== 'Cancelled' &&
      b.status !== 'Completed'
  );

  const affectedBookings: ShiftImpactAnalysis['affectedBookings'] = [];

  if (newStatus === 'off' || newStatus === 'leave' || newStatus === 'unavailable') {
    activeBookings.forEach((b) => {
      affectedBookings.push({
        booking: b,
        code: 'THERAPIST_OFF_OR_UNAVAILABLE',
        reason: `Terapis diset status ${newStatus.toUpperCase()} padahal memiliki pesanan aktif pukul ${b.scheduleTime} WIB.`,
      });
    });
    return {
      hasConflict: affectedBookings.length > 0,
      affectedBookings,
    };
  }

  const shiftStartMin = timeToMinutes(newShiftStart);
  const shiftEndMin = timeToMinutes(newShiftEnd);

  for (const b of activeBookings) {
    const bookingStartMin = timeToMinutes(b.scheduleTime);
    const duration = b.serviceDuration || 90;
    const bookingEndMin = bookingStartMin + duration;

    // 1. Booking before shift start
    if (bookingStartMin < shiftStartMin) {
      affectedBookings.push({
        booking: b,
        code: 'OUTSIDE_SHIFT',
        reason: `Jadwal pesanan (${b.scheduleTime} WIB) mendahului jam shift masuk (${newShiftStart} WIB).`,
      });
      continue;
    }

    // 2. Booking extends past shift end
    if (bookingEndMin > shiftEndMin) {
      const overtime = bookingEndMin - shiftEndMin;
      affectedBookings.push({
        booking: b,
        code: 'OUTSIDE_SHIFT',
        reason: `Pesanan selesai (${minutesToTime(bookingEndMin)} WIB) melewati batas shift pulang (${newShiftEnd} WIB) sebesar ${overtime} menit.`,
      });
      continue;
    }

    // 3. Booking overlaps break
    for (const brk of newBreaks) {
      const brkStartMin = timeToMinutes(brk.start);
      const brkEndMin = timeToMinutes(brk.end);
      const isOverlap = !(bookingEndMin <= brkStartMin || bookingStartMin >= brkEndMin);
      if (isOverlap) {
        affectedBookings.push({
          booking: b,
          code: 'OVERLAP_BREAK',
          reason: `Pesanan berbenturan dengan waktu istirahat terapis (${brk.start}-${brk.end} WIB).`,
        });
        break;
      }
    }
  }

  return {
    hasConflict: affectedBookings.length > 0,
    affectedBookings,
  };
}

/**
 * Derive operational dynamic shift status for a therapist today
 */
export function deriveOperationalShiftStatus(
  therapist: Therapist,
  roster?: TherapistRoster | null,
  activeBooking?: Booking | null,
  nowWib?: Date
): {
  status: OperationalShiftStatus;
  badgeColor: string;
  textColor: string;
  description: string;
} {
  // If therapist is inactive globally
  if (therapist.isActive === false) {
    return {
      status: 'Unavailable',
      badgeColor: 'bg-zinc-100 border-zinc-300 text-zinc-600',
      textColor: 'text-zinc-600',
      description: 'Terapis Non-Aktif Perusahaan',
    };
  }

  // If active booking in progress or assigned
  if (activeBooking) {
    if (activeBooking.status === 'Treatment') {
      return {
        status: 'Treatment',
        badgeColor: 'bg-purple-100 border-purple-300 text-purple-800',
        textColor: 'text-purple-700',
        description: `Sedang Melayani (${activeBooking.bookingCode})`,
      };
    }
    if (activeBooking.status === 'On The Way' || activeBooking.status === 'Arrived') {
      return {
        status: 'On The Way',
        badgeColor: 'bg-blue-100 border-blue-300 text-blue-800',
        textColor: 'text-blue-700',
        description: `Sedang Perjalanan (${activeBooking.bookingCode})`,
      };
    }
    if (activeBooking.status === 'Therapist Assigned' || activeBooking.status === 'Accepted') {
      return {
        status: 'Assigned',
        badgeColor: 'bg-indigo-100 border-indigo-300 text-indigo-800',
        textColor: 'text-indigo-700',
        description: `Ditugaskan (${activeBooking.bookingCode})`,
      };
    }
  }

  // Check Off / Unavailable / Leave
  if (roster?.status === 'off' || therapist.status === 'off') {
    return {
      status: 'Off',
      badgeColor: 'bg-slate-100 border-slate-300 text-slate-700',
      textColor: 'text-slate-600',
      description: roster?.unavailableReason || 'Libur Operasional',
    };
  }

  if (roster?.status === 'leave' || roster?.status === 'unavailable') {
    return {
      status: 'Unavailable',
      badgeColor: 'bg-rose-100 border-rose-300 text-rose-800',
      textColor: 'text-rose-700',
      description: roster?.unavailableReason || 'Tidak Tersedia',
    };
  }

  // Check if schedule is defined
  const shiftStart = roster?.shiftStart || therapist.defaultShift?.start;
  const shiftEnd = roster?.shiftEnd || therapist.defaultShift?.end;

  if (!shiftStart || !shiftEnd) {
    return {
      status: 'Jadwal Belum Diatur',
      badgeColor: 'bg-amber-50 border-amber-300 text-amber-800',
      textColor: 'text-amber-700',
      description: 'Jadwal belum diatur',
    };
  }

  // Evaluate against current time
  const now = nowWib || new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMin = timeToMinutes(shiftStart);
  const endMin = timeToMinutes(shiftEnd);

  if (currentMinutes < startMin) {
    return {
      status: 'Belum Mulai Shift',
      badgeColor: 'bg-sky-50 border-sky-300 text-sky-800',
      textColor: 'text-sky-700',
      description: `Shift mulai ${shiftStart} WIB`,
    };
  }

  if (currentMinutes > endMin) {
    return {
      status: 'Selesai Shift',
      badgeColor: 'bg-zinc-100 border-zinc-300 text-zinc-700',
      textColor: 'text-zinc-600',
      description: `Shift berakhir ${shiftEnd} WIB`,
    };
  }

  // Check if current time is within break
  const activeBreak = (roster?.breaks || []).find((brk) => {
    const bStart = timeToMinutes(brk.start);
    const bEnd = timeToMinutes(brk.end);
    return currentMinutes >= bStart && currentMinutes < bEnd;
  });

  if (activeBreak || roster?.status === 'break' || therapist.status === 'break') {
    return {
      status: 'Break',
      badgeColor: 'bg-amber-100 border-amber-300 text-amber-800',
      textColor: 'text-amber-700',
      description: activeBreak ? `Istirahat (${activeBreak.start}-${activeBreak.end})` : 'Sedang Istirahat',
    };
  }

  // In shift and ready
  return {
    status: 'Aktif',
    badgeColor: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    textColor: 'text-emerald-700',
    description: `Bertugas (${shiftStart}-${shiftEnd} WIB)`,
  };
}

/**
 * Fetch all roster shift templates
 */
export async function getRosterTemplates(): Promise<ShiftTemplate[]> {
  try {
    const q = query(collection(db, 'roster_templates'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ShiftTemplate);
  } catch (err) {
    console.warn('Failed to fetch roster templates:', err);
    return [];
  }
}

/**
 * Subscribe to shift templates in realtime
 */
export function subscribeToRosterTemplates(
  callback: (templates: ShiftTemplate[]) => void
) {
  const q = query(collection(db, 'roster_templates'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as ShiftTemplate);
      callback(list);
    },
    (err) => console.warn('Subscribe roster templates error:', err)
  );
}

/**
 * Save or update a shift template
 */
export async function saveRosterTemplate(
  template: ShiftTemplate,
  actorName: string
): Promise<void> {
  const docRef = doc(db, 'roster_templates', template.id);
  const data: ShiftTemplate = {
    ...template,
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };
  await setDoc(docRef, cleanFirestoreData(data), { merge: true });

  await addOperationalAuditLog({
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    newValue: `Template: ${template.name} (${template.shiftStart}-${template.shiftEnd})`,
    reason: `Simpan Template Shift`,
    note: `Template shift ${template.name} disimpan`,
  });
}

/**
 * Delete a shift template
 */
export async function deleteRosterTemplate(
  templateId: string,
  templateName: string,
  actorName: string
): Promise<void> {
  await deleteDoc(doc(db, 'roster_templates', templateId));

  await addOperationalAuditLog({
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    oldValue: templateName,
    newValue: 'Dihapus',
    reason: `Hapus Template Shift`,
    note: `Template shift ${templateName} dihapus`,
  });
}

/**
 * Save a therapist's full 7-day default weekly schedule
 */
export async function saveTherapistWeeklySchedule(
  therapistId: string,
  therapistName: string,
  weeklySchedule: TherapistWeeklySchedule,
  actorName: string,
  reason: string = 'Pembaruan Jadwal Kerja Mingguan'
): Promise<void> {
  const offDays: number[] = [];
  Object.values(weeklySchedule).forEach((day) => {
    if (!day.isWorking) {
      offDays.push(day.day);
    }
  });

  const firstWorking = Object.values(weeklySchedule).find((d) => d.isWorking) || {
    shiftStart: '10:00',
    shiftEnd: '21:00',
  };

  const defaultShift: TherapistShiftConfig = {
    start: firstWorking.shiftStart,
    end: firstWorking.shiftEnd,
    offDays,
  };

  const docRef = doc(db, 'therapists', therapistId);
  await updateDoc(docRef, {
    weeklySchedule,
    defaultShift,
    updatedAt: new Date().toISOString(),
  });

  await addOperationalAuditLog({
    therapistId,
    therapistName,
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    newValue: `Jadwal Mingguan: Libur [${offDays.join(',')}], Jam: ${defaultShift.start}-${defaultShift.end}`,
    reason,
    note: `Konfigurasi jadwal mingguan 7 hari disimpan`,
  });

  // Notify therapist of weekly schedule change
  await notifyTherapistShiftChange(
    therapistId,
    therapistName,
    'Jadwal Mingguan Rutin',
    `Pola kerja 7 hari Anda telah diperbarui (${defaultShift.start}-${defaultShift.end} WIB)`,
    actorName
  );
}

/**
 * Bulk apply a shift to multiple therapists over a date range
 */
export async function bulkApplyRosterSchedule(
  therapistIds: string[],
  therapists: Therapist[],
  startDate: string,
  endDate: string,
  shiftStart: string,
  shiftEnd: string,
  status: RosterShiftStatus,
  breaks: RosterBreakPeriod[],
  unavailableReason: string,
  actorName: string,
  note: string = 'Terapkan shift massal'
): Promise<number> {
  const startObj = new Date(startDate);
  const endObj = new Date(endDate);
  let count = 0;

  for (let d = new Date(startObj); d <= endObj; d.setDate(d.getDate() + 1)) {
    const curDateStr = d.toISOString().split('T')[0];

    for (const thId of therapistIds) {
      const th = therapists.find((t) => t.id === thId);
      const thName = th?.name || 'Terapis';
      const rosterId = buildRosterDocId(thId, curDateStr);

      const rosterItem: TherapistRoster = {
        id: rosterId,
        therapistId: thId,
        therapistName: thName,
        date: curDateStr,
        shiftStart,
        shiftEnd,
        status,
        breaks: status === 'off' || status === 'leave' || status === 'unavailable' ? [] : breaks,
        unavailableReason: status !== 'scheduled' && status !== 'working' ? unavailableReason : '',
        note,
        source: 'override',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: actorName,
      };

      await setDoc(doc(db, 'therapist_rosters', rosterId), cleanFirestoreData(rosterItem), { merge: true });
      count++;

      // Notify therapist
      notifyTherapistShiftChange(
        thId,
        thName,
        curDateStr,
        `Shift: ${shiftStart}-${shiftEnd} (${status})`,
        actorName
      );
    }
  }

  await addOperationalAuditLog({
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    newValue: `Terapkan massal ke ${therapistIds.length} terapis (${startDate} s/d ${endDate}): ${shiftStart}-${shiftEnd}, Status: ${status}`,
    reason: `Terapkan Jadwal Massal`,
    note: `${count} entri shift tanggal berhasil diperbarui`,
  });

  return count;
}

/**
 * Mark a therapist as unavailable or on leave for a date range
 */
export async function setTherapistUnavailableRange(
  therapistId: string,
  therapistName: string,
  startDate: string,
  endDate: string,
  status: 'leave' | 'unavailable' | 'off',
  reason: string,
  note: string,
  actorName: string
): Promise<number> {
  const startObj = new Date(startDate);
  const endObj = new Date(endDate);
  let count = 0;

  for (let d = new Date(startObj); d <= endObj; d.setDate(d.getDate() + 1)) {
    const curDateStr = d.toISOString().split('T')[0];
    const rosterId = buildRosterDocId(therapistId, curDateStr);

    const rosterItem: TherapistRoster = {
      id: rosterId,
      therapistId,
      therapistName,
      date: curDateStr,
      shiftStart: '10:00',
      shiftEnd: '21:00',
      status,
      breaks: [],
      unavailableReason: reason,
      note: note || `Status tidak bertugas (${reason})`,
      source: 'override',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    };

    await setDoc(doc(db, 'therapist_rosters', rosterId), cleanFirestoreData(rosterItem), { merge: true });
    count++;
  }

  await addOperationalAuditLog({
    therapistId,
    therapistName,
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    newValue: `Status ${status.toUpperCase()} (${startDate} s/d ${endDate}): ${reason}`,
    reason: `Status Tidak Tersedia Rentang Tanggal`,
    note: note || reason,
  });

  await notifyTherapistShiftChange(
    therapistId,
    therapistName,
    `${startDate} s/d ${endDate}`,
    `Status Anda diubah menjadi ${status.toUpperCase()} (${reason})`,
    actorName
  );

  return count;
}

/**
 * Copy a therapist's schedule from one date to a target date range
 */
export async function copyTherapistScheduleToDateRange(
  therapistId: string,
  therapistName: string,
  sourceDate: string,
  targetStartDate: string,
  targetEndDate: string,
  actorName: string
): Promise<number> {
  const sourceRoster = await getTherapistRoster(therapistId, sourceDate);
  const shiftStart = sourceRoster?.shiftStart || '10:00';
  const shiftEnd = sourceRoster?.shiftEnd || '21:00';
  const status = sourceRoster?.status || 'scheduled';
  const breaks = sourceRoster?.breaks || [];
  const unavailableReason = sourceRoster?.unavailableReason || '';

  const startObj = new Date(targetStartDate);
  const endObj = new Date(targetEndDate);
  let count = 0;

  for (let d = new Date(startObj); d <= endObj; d.setDate(d.getDate() + 1)) {
    const curDateStr = d.toISOString().split('T')[0];
    const rosterId = buildRosterDocId(therapistId, curDateStr);

    const rosterItem: TherapistRoster = {
      id: rosterId,
      therapistId,
      therapistName,
      date: curDateStr,
      shiftStart,
      shiftEnd,
      status,
      breaks,
      unavailableReason,
      note: `Disalin dari tanggal ${sourceDate}`,
      source: 'override',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    };

    await setDoc(doc(db, 'therapist_rosters', rosterId), cleanFirestoreData(rosterItem), { merge: true });
    count++;
  }

  await addOperationalAuditLog({
    therapistId,
    therapistName,
    action: 'shift_change',
    actorRole: 'supervisor',
    actorName,
    newValue: `Salin jadwal dari ${sourceDate} ke rentang ${targetStartDate} s/d ${targetEndDate}`,
    reason: `Salin Jadwal Terapis`,
    note: `${count} tanggal diperbarui`,
  });

  return count;
}

export { copyTherapistScheduleToDateRange as copyTherapistRosterDateToRange };

/**
 * Copy a therapist's weekly schedule template to other therapists
 */
export async function copyWeeklyScheduleBetweenTherapists(
  sourceTherapist: Therapist,
  targetTherapistIds: string[],
  allTherapists: Therapist[],
  actorName: string
): Promise<number> {
  const schedule = sourceTherapist.weeklySchedule;
  if (!schedule) {
    throw new Error(`Terapis ${sourceTherapist.name} belum memiliki konfigurasi jadwal mingguan.`);
  }

  let count = 0;
  for (const thId of targetTherapistIds) {
    const targetTh = allTherapists.find((t) => t.id === thId);
    if (!targetTh) continue;

    await saveTherapistWeeklySchedule(
      thId,
      targetTh.name,
      schedule,
      actorName,
      `Salin jadwal mingguan dari ${sourceTherapist.name}`
    );
    count++;
  }

  return count;
}

export type { ShiftTemplate, TherapistWeeklySchedule, WeeklyScheduleDay, OperationalShiftStatus };
