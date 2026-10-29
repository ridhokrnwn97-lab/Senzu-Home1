import {
  Therapist,
  Booking,
  AppSettings,
  TherapistRoster,
  TherapistEligibilityResult,
  ScheduleConflict,
  OperationalSettings,
  ServiceItem,
} from '../types';
import { calculateDistanceKm } from './dbService';
import { DEFAULT_SKILL_MATRIX, DEFAULT_PALEMBANG_SHIFTS } from './rosterService';

export type { TherapistEligibilityResult, ScheduleConflict };

/**
 * Convert "HH:mm" time string into minutes from midnight (0-1439)
 */
export function timeToMinutes(timeStr?: string): number {
  if (!timeStr) return 720; // fallback 12:00
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  return h * 60 + m;
}

/**
 * Convert minutes from midnight back into "HH:mm"
 */
export function minutesToTime(minutes: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.round(minutes)));
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface TravelEstimate {
  distanceKm: number;
  estimatedMinutes: number;
  originLabel: string;
}

/**
 * Estimate travel time between coordinates in Palembang traffic
 * Base speed: ~25 km/h for urban transit + 10 min parking & staging buffer
 * Minimum travel window: 15 minutes
 */
export function estimatePalembangTravel(
  lat1?: number,
  lon1?: number,
  lat2?: number,
  lon2?: number,
  operationalSettings?: Partial<OperationalSettings>
): TravelEstimate {
  const transitSpeed = operationalSettings?.transitSpeedKmH ?? 25;
  const parkingBuffer = operationalSettings?.parkingStagingBufferMinutes ?? 10;
  const minTravel = operationalSettings?.travelBufferMinutes ?? 15;

  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return {
      distanceKm: 4.5,
      estimatedMinutes: Math.max(minTravel, 20),
      originLabel: 'Estimasi Area Kota Palembang',
    };
  }

  const distanceKm = Math.max(0.1, calculateDistanceKm(lat1, lon1, lat2, lon2));
  // Palembang traffic model: configurable speed (default 25 km/h) + parking buffer
  const travelMinutes = Math.max(minTravel, Math.ceil((distanceKm / transitSpeed) * 60) + parkingBuffer);

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    estimatedMinutes: travelMinutes,
    originLabel: `${distanceKm.toFixed(1)} km`,
  };
}

/**
 * Evaluate single therapist eligibility for a booking
 */
export function evaluateTherapistEligibility(
  therapist: Therapist,
  booking: Booking,
  allBookings: Booking[],
  roster?: TherapistRoster,
  favoriteTherapistId?: string,
  settings?: AppSettings,
  operationalSettings?: Partial<OperationalSettings>,
  servicesList?: ServiceItem[]
): TherapistEligibilityResult {
  const hardConflicts: ScheduleConflict[] = [];
  const softWarnings: ScheduleConflict[] = [];
  const minTravelBuffer = operationalSettings?.travelBufferMinutes ?? 15;

  const bookingDate = booking.scheduleDate;
  const bookingStartMin = timeToMinutes(booking.scheduleTime);
  const duration = booking.serviceDuration || 90;
  const bookingEndMin = bookingStartMin + duration;

  // 1. Employee Active check
  if (therapist.isActive === false) {
    hardConflicts.push({
      severity: 'HARD',
      code: 'THERAPIST_UNAVAILABLE',
      message: 'Terapis non-aktif dari operasional perusahaan.',
    });
  }

  // 2. Schedule Priority Resolution (1. Date-specific override, 2. Off/Unavailable, 3. Weekly default, 4. No schedule)
  const [bYear, bMonth, bDay] = bookingDate.split('-').map((v) => parseInt(v, 10));
  const dateObj = new Date(bYear, bMonth - 1, bDay);
  const dayOfWeek = isNaN(dateObj.getDay()) ? 0 : dateObj.getDay();

  const weeklyDay = therapist.weeklySchedule?.[dayOfWeek];
  const hasConfiguredSchedule = Boolean(
    roster?.shiftStart ||
    weeklyDay?.shiftStart ||
    therapist.defaultShift?.start ||
    DEFAULT_PALEMBANG_SHIFTS[therapist.id]
  );

  if (!hasConfiguredSchedule) {
    hardConflicts.push({
      severity: 'HARD',
      code: 'NO_SCHEDULE',
      message: 'Jadwal belum diatur. Terapis belum memiliki jadwal kerja terkonfigurasi.',
    });
  }

  // Priority 1: Date-specific override from roster, Priority 3: Weekly default
  const shiftStartStr =
    roster?.shiftStart ||
    weeklyDay?.shiftStart ||
    therapist.defaultShift?.start ||
    DEFAULT_PALEMBANG_SHIFTS[therapist.id]?.start ||
    '10:00';

  const shiftEndStr =
    roster?.shiftEnd ||
    weeklyDay?.shiftEnd ||
    therapist.defaultShift?.end ||
    DEFAULT_PALEMBANG_SHIFTS[therapist.id]?.end ||
    '21:00';

  const shiftStartMin = timeToMinutes(shiftStartStr);
  const shiftEndMin = timeToMinutes(shiftEndStr);

  const isWeeklyOff = weeklyDay
    ? !weeklyDay.isWorking
    : (therapist.defaultShift?.offDays || []).includes(dayOfWeek);

  const rosterStatus =
    roster?.status ||
    (isWeeklyOff ? 'off' : therapist.status === 'off' ? 'off' : 'scheduled');

  // Priority 2: Off / Unavailable validation
  if (rosterStatus === 'off') {
    hardConflicts.push({
      severity: 'HARD',
      code: 'THERAPIST_OFF',
      message: `Terapis berstatus Off Duty / Libur pada tanggal ini (${roster?.unavailableReason || (isWeeklyOff ? 'Jadwal Libur Rutin Mingguan' : 'Jadwal Libur')}).`,
    });
  } else if (rosterStatus === 'leave') {
    hardConflicts.push({
      severity: 'HARD',
      code: 'THERAPIST_LEAVE',
      message: `Terapis sedang Izin / Cuti (${roster?.unavailableReason || 'Izin Operasional'}).`,
    });
  } else if (rosterStatus === 'unavailable') {
    hardConflicts.push({
      severity: 'HARD',
      code: 'THERAPIST_UNAVAILABLE',
      message: `Terapis tidak dapat bertugas (${roster?.unavailableReason || 'Kendala Lapangan'}).`,
    });
  }

  // Shift Start & End boundaries
  if (bookingStartMin < shiftStartMin) {
    hardConflicts.push({
      severity: 'HARD',
      code: 'BEFORE_SHIFT',
      message: `Jadwal pesanan (${booking.scheduleTime} WIB) sebelum shift dimulai (${shiftStartStr} WIB).`,
    });
  }

  if (bookingEndMin > shiftEndMin) {
    const overtimeMinutes = bookingEndMin - shiftEndMin;
    if (overtimeMinutes > 30) {
      hardConflicts.push({
        severity: 'HARD',
        code: 'AFTER_SHIFT_HARD',
        message: `MELEWATI JAM SHIFT: Selesai (${minutesToTime(bookingEndMin)} WIB) melewati batas shift (${shiftEndStr} WIB) hingga ${overtimeMinutes} menit.`,
      });
    } else {
      softWarnings.push({
        severity: 'SOFT',
        code: 'AFTER_SHIFT_SOFT',
        message: `MELEWATI JAM SHIFT: Selesai (${minutesToTime(bookingEndMin)} WIB) melewati akhir shift (${shiftEndStr} WIB) sebesar ${overtimeMinutes} menit.`,
      });
    }
  }

  // 3. Gender preference check
  const genderPref = booking.genderPreference;
  const isGenderMatch =
    !genderPref ||
    genderPref === 'Bebas' ||
    (genderPref === 'Perempuan' && therapist.gender === 'Perempuan') ||
    (genderPref === 'Laki-laki' && therapist.gender === 'Laki-laki');

  if (!isGenderMatch) {
    hardConflicts.push({
      severity: 'HARD',
      code: 'GENDER_MISMATCH',
      message: `Gender (${therapist.gender}) tidak sesuai dengan preferensi pelanggan (${genderPref}).`,
    });
  }

  // 4. Skill Matrix / Service capability check (Prompt 15A & Prompt 17A Master Data)
  const qualifiedServices =
    therapist.serviceIds && therapist.serviceIds.length > 0
      ? therapist.serviceIds
      : DEFAULT_SKILL_MATRIX[therapist.id] || ['srv-sig-90', 'srv-sig-120'];

  // Check 1: Direct serviceId match or 'all'
  let isSkillMatch =
    !booking.serviceId ||
    qualifiedServices.includes(booking.serviceId) ||
    qualifiedServices.includes('all');

  // Check 2: Prompt 17A dynamic skill matching via requiredSkillIds
  if (!isSkillMatch && servicesList && servicesList.length > 0 && booking.serviceId) {
    const bookedService = servicesList.find((s) => s.id === booking.serviceId);
    if (
      bookedService?.requiredSkillIds &&
      bookedService.requiredSkillIds.length > 0 &&
      therapist.skillIds &&
      therapist.skillIds.length > 0
    ) {
      // If therapist has all required skills (or any if only 1 required)
      const hasAllRequiredSkills = bookedService.requiredSkillIds.every((reqSkillId) =>
        therapist.skillIds?.includes(reqSkillId)
      );
      if (hasAllRequiredSkills) {
        isSkillMatch = true;
      }
    }
  }

  if (!isSkillMatch) {
    hardConflicts.push({
      severity: 'HARD',
      code: 'SKILL_MISMATCH',
      message: `Terapis belum tersertifikasi untuk layanan "${booking.serviceName}".`,
    });
  }

  // 5. Breaks overlap check (Prompt 20: Do not recommend automatically if overlaps break)
  const effectiveBreaks =
    roster?.breaks && roster.breaks.length > 0
      ? roster.breaks
      : weeklyDay?.hasBreak && weeklyDay.breakStart && weeklyDay.breakEnd
      ? [
          {
            id: `weekly-brk-${therapist.id}`,
            start: weeklyDay.breakStart,
            end: weeklyDay.breakEnd,
            note: 'Istirahat Rutin Mingguan',
          },
        ]
      : [];

  if (effectiveBreaks.length > 0) {
    for (const brk of effectiveBreaks) {
      const brkStartMin = timeToMinutes(brk.start);
      const brkEndMin = timeToMinutes(brk.end);

      // Overlap with break
      const overlapBreak = !(bookingEndMin <= brkStartMin || bookingStartMin >= brkEndMin);
      if (overlapBreak) {
        hardConflicts.push({
          severity: 'HARD',
          code: 'BREAK_OVERLAP',
          message: `BREAK CONFLICT: Jadwal pesanan beririsan dengan waktu istirahat terapis (${brk.start}-${brk.end} WIB - ${brk.note || 'Istirahat'}).`,
        });
      }
    }
  }

  // 6. Schedule Conflicts & Travel Buffers between same-day bookings
  const sameDayBookings = allBookings.filter(
    (b) =>
      b.id !== booking.id &&
      b.therapistId === therapist.id &&
      b.scheduleDate === bookingDate &&
      !['Completed', 'Cancelled'].includes(b.status)
  );

  let closestTravelEstimate: TravelEstimate = {
    distanceKm: 0,
    estimatedMinutes: 15,
    originLabel: 'Senzu Base',
  };

  sameDayBookings.forEach((existing) => {
    const existingStartMin = timeToMinutes(existing.scheduleTime);
    const existingDuration = existing.serviceDuration || 90;
    const existingEndMin = existingStartMin + existingDuration;

    // Direct overlap of treatment time (Prompt 21: JADWAL BENTROK)
    const isDirectOverlap = !(bookingEndMin <= existingStartMin || bookingStartMin >= existingEndMin);

    if (isDirectOverlap) {
      hardConflicts.push({
        severity: 'HARD',
        code: 'OVERLAPPING_BOOKING',
        message: `JADWAL BENTROK: Bentrok jadwal langsung dengan pesanan ${existing.bookingCode} (${existing.scheduleTime} WIB - ${minutesToTime(existingEndMin)} WIB, ${existing.serviceName}).`,
        conflictingBookingId: existing.id,
        conflictingBookingCode: existing.bookingCode,
      });
      return;
    }

    // Travel time between existing and candidate booking
    if (existingEndMin <= bookingStartMin) {
      // Existing job finishes before candidate booking
      const availableWindowMin = bookingStartMin - existingEndMin;
      const travel = estimatePalembangTravel(
        existing.latitude,
        existing.longitude,
        booking.latitude,
        booking.longitude,
        operationalSettings
      );
      closestTravelEstimate = travel;

      if (availableWindowMin < minTravelBuffer) {
        hardConflicts.push({
          severity: 'HARD',
          code: 'TIGHT_TRAVEL',
          message: `Jarak waktu tempuh dari order ${existing.bookingCode} hanya ${availableWindowMin} menit (dibutuhkan min. ${minTravelBuffer} menit).`,
          conflictingBookingId: existing.id,
          conflictingBookingCode: existing.bookingCode,
        });
      } else if (availableWindowMin < travel.estimatedMinutes) {
        softWarnings.push({
          severity: 'SOFT',
          code: 'TIGHT_TRAVEL',
          message: `Waktu perjalanan sangat ketat (${availableWindowMin}m vs estimasi ${travel.estimatedMinutes}m dari order ${existing.bookingCode} sejauh ${travel.distanceKm} km).`,
          conflictingBookingId: existing.id,
          conflictingBookingCode: existing.bookingCode,
        });
      }
    } else if (bookingEndMin <= existingStartMin) {
      // Candidate booking finishes before existing job starts
      const availableWindowMin = existingStartMin - bookingEndMin;
      const travel = estimatePalembangTravel(
        booking.latitude,
        booking.longitude,
        existing.latitude,
        existing.longitude,
        operationalSettings
      );

      if (availableWindowMin < minTravelBuffer) {
        hardConflicts.push({
          severity: 'HARD',
          code: 'TIGHT_TRAVEL',
          message: `Jarak waktu tempuh menuju order berikutnya (${existing.bookingCode}) hanya ${availableWindowMin} menit (dibutuhkan min. ${minTravelBuffer} menit).`,
          conflictingBookingId: existing.id,
          conflictingBookingCode: existing.bookingCode,
        });
      } else if (availableWindowMin < travel.estimatedMinutes) {
        softWarnings.push({
          severity: 'SOFT',
          code: 'TIGHT_TRAVEL',
          message: `Waktu perjalanan menuju order ${existing.bookingCode} sangat ketat (${availableWindowMin}m vs estimasi ${travel.estimatedMinutes}m).`,
          conflictingBookingId: existing.id,
          conflictingBookingCode: existing.bookingCode,
        });
      }
    }
  });

  // 7. Workload check
  if (sameDayBookings.length >= 4) {
    softWarnings.push({
      severity: 'SOFT',
      code: 'HIGH_WORKLOAD',
      message: `Beban kerja tinggi: Terapis sudah memiliki ${sameDayBookings.length} order pada tanggal ini.`,
    });
  }

  // 8. Determine Overall Status
  let status: 'ELIGIBLE' | 'WARNING' | 'INELIGIBLE' = 'ELIGIBLE';
  if (hardConflicts.length > 0) {
    status = 'INELIGIBLE';
  } else if (softWarnings.length > 0) {
    status = 'WARNING';
  }

  // 9. Recommendation Score Calculation
  let score = 100;

  const isFavoriteForCustomer =
    !!favoriteTherapistId && favoriteTherapistId === therapist.id;

  if (isFavoriteForCustomer) {
    score += 35; // Significant boost for customer preferred/favorite therapist
  }

  if (isGenderMatch && genderPref && genderPref !== 'Bebas') {
    score += 20; // Matched specific customer preference
  }

  // Rating bonus (e.g. 4.95 * 4 = ~20)
  score += Math.round((therapist.rating || 4.8) * 4);

  // Workload balancing (-8 per job today)
  score -= sameDayBookings.length * 8;

  // Penalties
  score -= softWarnings.length * 25;
  if (hardConflicts.length > 0) {
    score = Math.max(0, score - 150);
  }

  return {
    therapist,
    roster,
    status,
    score,
    hardConflicts,
    softWarnings,
    isGenderMatch,
    isSkillMatch,
    isFavoriteForCustomer,
    sameDayJobCount: sameDayBookings.length,
    estimatedTravelMinutes: closestTravelEstimate.estimatedMinutes,
    travelContext: closestTravelEstimate.originLabel,
  };
}

/**
 * Evaluate all therapists and group them into Recommended, Available, Warning, and Ineligible
 */
export function rankTherapistsForBooking(
  therapists: Therapist[],
  booking: Booking,
  allBookings: Booking[],
  rosters: TherapistRoster[] = [],
  favoriteTherapistId?: string,
  settings?: AppSettings,
  operationalSettings?: Partial<OperationalSettings>,
  servicesList?: ServiceItem[]
): {
  recommended: TherapistEligibilityResult[];
  available: TherapistEligibilityResult[];
  warning: TherapistEligibilityResult[];
  ineligible: TherapistEligibilityResult[];
  allScored: TherapistEligibilityResult[];
} {
  const rosterMap = new Map((rosters || []).map((r) => [r.therapistId, r]));

  const allScored = (therapists || []).map((th) => {
    const roster = rosterMap.get(th.id);
    return evaluateTherapistEligibility(
      th,
      booking,
      allBookings,
      roster,
      favoriteTherapistId,
      settings,
      operationalSettings,
      servicesList
    );
  });

  // Sort descending by score
  allScored.sort((a, b) => b.score - a.score);

  const recommended: TherapistEligibilityResult[] = [];
  const available: TherapistEligibilityResult[] = [];
  const warning: TherapistEligibilityResult[] = [];
  const ineligible: TherapistEligibilityResult[] = [];

  allScored.forEach((item) => {
    if (item.status === 'INELIGIBLE') {
      ineligible.push(item);
    } else if (item.status === 'WARNING') {
      warning.push(item);
    } else {
      // Eligible
      if (item.isFavoriteForCustomer || item.score >= 125) {
        recommended.push(item);
      } else {
        available.push(item);
      }
    }
  });

  // If recommended is empty, move top eligible into recommended
  if (recommended.length === 0 && available.length > 0) {
    recommended.push(available.shift()!);
  }

  return {
    recommended,
    available,
    warning,
    ineligible,
    allScored,
  };
}
