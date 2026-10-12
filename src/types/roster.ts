import type { Therapist } from '../types';

export type RosterShiftStatus =
  | 'scheduled'
  | 'working'
  | 'break'
  | 'off'
  | 'leave'
  | 'unavailable'
  | 'completed';

export interface RosterBreakPeriod {
  id: string;
  start: string; // HH:mm e.g. "12:30"
  end: string;   // HH:mm e.g. "13:30"
  note?: string;
}

export interface TherapistRoster {
  id: string; // Document ID: `${therapistId}_${date}`
  therapistId: string;
  therapistName: string;
  date: string; // YYYY-MM-DD in Asia/Jakarta (WIB)
  shiftStart: string; // HH:mm
  shiftEnd: string;   // HH:mm
  status: RosterShiftStatus;
  breaks: RosterBreakPeriod[];
  unavailableReason?:
    | 'Sakit'
    | 'Izin'
    | 'Emergency'
    | 'Kendala Kendaraan'
    | 'Pribadi'
    | 'Operational Hold'
    | 'Lainnya'
    | string;
  note?: string;
  source?: 'default' | 'override';
  createdAt: string; // ISO
  updatedAt: string; // ISO
  updatedBy: string; // Supervisor name
}

export interface ShiftTemplate {
  id: string;
  name: string; // e.g. "Shift Pagi", "Shift Reguler", "Shift Siang", "Weekend"
  shiftStart: string; // HH:mm
  shiftEnd: string;   // HH:mm
  breakStart?: string; // HH:mm
  breakEnd?: string;   // HH:mm
  hasBreak: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface WeeklyScheduleDay {
  day: number; // 0 = Minggu, 1 = Senin, 2 = Selasa, 3 = Rabu, 4 = Kamis, 5 = Jumat, 6 = Sabtu
  dayName: string;
  isWorking: boolean;
  shiftStart: string; // HH:mm
  shiftEnd: string;   // HH:mm
  breakStart?: string;
  breakEnd?: string;
  hasBreak: boolean;
}

export type TherapistWeeklySchedule = Record<number, WeeklyScheduleDay>;

export type OperationalShiftStatus =
  | 'Belum Mulai Shift'
  | 'Aktif'
  | 'Break'
  | 'Assigned'
  | 'On The Way'
  | 'Treatment'
  | 'Selesai Shift'
  | 'Off'
  | 'Unavailable'
  | 'Jadwal Belum Diatur';

export type ConflictSeverity = 'HARD' | 'SOFT';

export interface ScheduleConflict {
  severity: ConflictSeverity;
  code:
    | 'OVERLAPPING_BOOKING'
    | 'THERAPIST_OFF'
    | 'THERAPIST_LEAVE'
    | 'THERAPIST_UNAVAILABLE'
    | 'SKILL_MISMATCH'
    | 'GENDER_MISMATCH'
    | 'BEFORE_SHIFT'
    | 'AFTER_SHIFT_HARD'
    | 'AFTER_SHIFT_SOFT'
    | 'BREAK_OVERLAP'
    | 'TIGHT_TRAVEL'
    | 'HIGH_WORKLOAD'
    | 'NO_SCHEDULE';
  message: string;
  conflictingBookingId?: string;
  conflictingBookingCode?: string;
}

export interface TherapistEligibilityResult {
  therapist: Therapist;
  roster?: TherapistRoster;
  status: 'ELIGIBLE' | 'WARNING' | 'INELIGIBLE';
  score: number;
  hardConflicts: ScheduleConflict[];
  softWarnings: ScheduleConflict[];
  isGenderMatch: boolean;
  isSkillMatch: boolean;
  isFavoriteForCustomer: boolean;
  sameDayJobCount: number;
  estimatedTravelMinutes: number;
  travelContext?: string;
}

export interface DailyRosterCapacity {
  date: string;
  totalTherapists: number;
  scheduledCount: number;
  workingCount: number;
  onBreakCount: number;
  offCount: number;
  totalBookings: number;
  serviceCoverage: Record<string, { serviceName: string; availableTherapistCount: number }>;
}
