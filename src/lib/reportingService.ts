import * as XLSX from 'xlsx';
import {
  Booking,
  Therapist,
  OperationalSettings,
  Branch,
  ServiceArea,
  ServiceItem,
} from '../types';
import { CustomerCRM, CustomerReview } from '../types/crm';
import { PaymentRecord } from '../types/payment';
import { TherapistRoster } from '../types/roster';
import { formatRupiah, formatDateTimeWIB, getTodayDateWIB, formatDateIndo } from './utils';
import { recordAdminAuditLog } from './masterDataService';

// ==========================================
// 1. FILTER TYPES & PRESETS
// ==========================================

export type DateFilterPreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'custom';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;
}

export interface ReportFilterState {
  datePreset: DateFilterPreset;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  branchId: string;  // 'ALL' or branchId
  serviceId: string; // 'ALL' or serviceId
  therapistId: string; // 'ALL' or therapistId
  areaName: string;  // 'ALL' or areaName
  paymentMethod: string; // 'ALL' or 'qris' | 'bni' | 'mandiri' | 'bri' | etc.
  bookingStatus: string; // 'ALL' or status
  customerType: 'ALL' | 'NEW' | 'REPEAT';
}

export const INITIAL_REPORT_FILTER: ReportFilterState = {
  datePreset: 'last_30_days',
  startDate: '',
  endDate: '',
  branchId: 'ALL',
  serviceId: 'ALL',
  therapistId: 'ALL',
  areaName: 'ALL',
  paymentMethod: 'ALL',
  bookingStatus: 'ALL',
  customerType: 'ALL',
};

export type ReportCategoryKey =
  | 'sales'
  | 'service'
  | 'customer'
  | 'therapist'
  | 'funnel'
  | 'css'
  | 'css_sla'
  | 'payment'
  | 'area'
  | 'cancellation'
  | 'rating'
  | 'loyalty'
  | 'feedback'
  | 'quality';

// ==========================================
// 2. DATE CALCULATION HELPERS (WIB)
// ==========================================

/**
 * Calculates start and end dates (YYYY-MM-DD) for a given preset in Asia/Jakarta (WIB)
 */
export function getDateRangeForPreset(
  preset: DateFilterPreset,
  customStart?: string,
  customEnd?: string
): DateRange {
  const todayWIB = getTodayDateWIB();
  const [yearStr, monthStr, dayStr] = todayWIB.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1; // 0-indexed
  const d = parseInt(dayStr, 10);

  const dateObj = new Date(Date.UTC(y, m, d));

  const formatUtcDate = (date: Date): string => {
    const yy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  switch (preset) {
    case 'today':
      return {
        startDate: todayWIB,
        endDate: todayWIB,
        label: 'Hari Ini',
      };
    case 'yesterday': {
      const yest = new Date(dateObj);
      yest.setUTCDate(dateObj.getUTCDate() - 1);
      const yestStr = formatUtcDate(yest);
      return {
        startDate: yestStr,
        endDate: yestStr,
        label: 'Kemarin',
      };
    }
    case 'last_7_days': {
      const past7 = new Date(dateObj);
      past7.setUTCDate(dateObj.getUTCDate() - 6);
      return {
        startDate: formatUtcDate(past7),
        endDate: todayWIB,
        label: '7 Hari Terakhir',
      };
    }
    case 'last_30_days': {
      const past30 = new Date(dateObj);
      past30.setUTCDate(dateObj.getUTCDate() - 29);
      return {
        startDate: formatUtcDate(past30),
        endDate: todayWIB,
        label: '30 Hari Terakhir',
      };
    }
    case 'this_month': {
      const firstDay = new Date(Date.UTC(y, m, 1));
      return {
        startDate: formatUtcDate(firstDay),
        endDate: todayWIB,
        label: 'Bulan Ini',
      };
    }
    case 'last_month': {
      const firstDayLastMonth = new Date(Date.UTC(y, m - 1, 1));
      const lastDayLastMonth = new Date(Date.UTC(y, m, 0)); // Day 0 of this month is last day of prev month
      return {
        startDate: formatUtcDate(firstDayLastMonth),
        endDate: formatUtcDate(lastDayLastMonth),
        label: 'Bulan Lalu',
      };
    }
    case 'custom':
    default:
      return {
        startDate: customStart || todayWIB,
        endDate: customEnd || todayWIB,
        label: 'Kustom',
      };
  }
}

/**
 * Calculates previous equivalent date range for fair period-over-period comparison.
 */
export function getPreviousEquivalentRange(
  preset: DateFilterPreset,
  startDate: string,
  endDate: string
): { startDate: string; endDate: string; label: string } | null {
  if (!startDate || !endDate) return null;

  try {
    const s = new Date(`${startDate}T00:00:00Z`);
    const e = new Date(`${endDate}T00:00:00Z`);
    const diffDays = Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    if (preset === 'last_month' || preset === 'this_month') {
      const [sy, sm] = startDate.split('-').map(Number);
      const prevMonthFirst = new Date(Date.UTC(sy, sm - 2, 1));
      const prevMonthLast = new Date(Date.UTC(sy, sm - 1, 0));
      return {
        startDate: prevMonthFirst.toISOString().substring(0, 10),
        endDate: prevMonthLast.toISOString().substring(0, 10),
        label: 'Bulan Sebelumnya',
      };
    }

    // Default: N days immediately preceding startDate
    const prevEnd = new Date(s);
    prevEnd.setUTCDate(s.getUTCDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setUTCDate(prevEnd.getUTCDate() - (diffDays - 1));

    return {
      startDate: prevStart.toISOString().substring(0, 10),
      endDate: prevEnd.toISOString().substring(0, 10),
      label: `${diffDays} Hari Sebelumnya`,
    };
  } catch {
    return null;
  }
}

// ==========================================
// 3. BOOKING FILTERING ENGINE
// ==========================================

export function filterBookings(
  bookings: Booking[],
  filters: ReportFilterState,
  customerMap?: Map<string, CustomerCRM>
): Booking[] {
  const { startDate, endDate, branchId, serviceId, therapistId, areaName, paymentMethod, bookingStatus, customerType } = filters;

  return bookings.filter((b) => {
    // 1. Date filter (by scheduleDate, fallback to createdAt WIB date)
    const bookingDate = b.scheduleDate || (b.createdAt ? b.createdAt.substring(0, 10) : '');
    if (startDate && bookingDate < startDate) return false;
    if (endDate && bookingDate > endDate) return false;

    // 2. Branch filter
    if (branchId !== 'ALL' && b.branchId && b.branchId !== branchId) {
      return false;
    }

    // 3. Service filter
    if (serviceId !== 'ALL') {
      const currentServiceId = b.serviceId;
      const currentServiceName = b.serviceNameSnapshot || b.serviceName || '';
      const sIdLower = (serviceId || '').toLowerCase();
      if (currentServiceId !== serviceId && !currentServiceName.toLowerCase().includes(sIdLower)) {
        return false;
      }
    }

    // 4. Therapist filter
    if (therapistId !== 'ALL') {
      if (b.therapistId !== therapistId && b.assignedTherapistName !== therapistId) {
        return false;
      }
    }

    // 5. Area filter
    if (areaName !== 'ALL') {
      const bArea = (b.areaName || b.customerArea || b.addressDistrict || '').toLowerCase();
      if (!bArea.includes((areaName || '').toLowerCase())) {
        return false;
      }
    }

    // 6. Payment method filter
    if (paymentMethod !== 'ALL') {
      const bMethod = (b.paymentMethod || '').toLowerCase();
      if (!bMethod.includes((paymentMethod || '').toLowerCase())) {
        return false;
      }
    }

    // 7. Booking status filter
    if (bookingStatus !== 'ALL') {
      const bStatus = (b.status || '').toLowerCase();
      if (bStatus !== (bookingStatus || '').toLowerCase()) {
        return false;
      }
    }

    // 8. Customer type filter (NEW vs REPEAT)
    if (customerType !== 'ALL' && customerMap) {
      const custId = b.customerId || `cust_${b.customerWhatsApp?.replace(/[^0-9]/g, '')}`;
      const cust = customerMap.get(custId);
      const isRepeat = cust ? (cust.completedBookings >= 2 || cust.totalBookings >= 2) : false;
      if (customerType === 'REPEAT' && !isRepeat) return false;
      if (customerType === 'NEW' && isRepeat) return false;
    }

    return true;
  });
}

// ==========================================
// 4. AUTHORITATIVE METRICS ENGINE
// ==========================================

export interface TopKpiMetrics {
  realizedRevenue: number;     // Booking status = Completed AND Payment status = Paid
  bookingValue: number;        // Non-cancelled total amount
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  uniqueCustomers: number;
  newCustomers: number;        // First completed booking occurred in this period
  repeatCustomers: number;     // Has >= 2 completed bookings
  averageOrderValue: number;   // Realized Revenue / Completed Paid Bookings
  cancellationRate: number;    // Cancelled / Total Valid Bookings %
  repeatRate: number;          // Repeat / Completed Customers %
  // Growth vs previous equivalent period (null if no previous data)
  revenueGrowthPct: number | null;
  bookingsGrowthPct: number | null;
  completedGrowthPct: number | null;
  aovGrowthPct: number | null;
}

export function computeTopKpiMetrics(
  currentBookings: Booking[],
  previousBookings?: Booking[] | null,
  allCustomers: CustomerCRM[] = [],
  startDate: string = '',
  endDate: string = ''
): TopKpiMetrics {
  // Current period computations
  let realizedRevenue = 0;
  let bookingValue = 0;
  let completedPaidCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;

  const currentCustomerKeys = new Set<string>();
  const completedCustomerKeys = new Set<string>();

  currentBookings.forEach((b) => {
    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    const isCancelled = (b.status || '').toLowerCase() === 'cancelled';
    const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';
    const amount = Number(b.totalAmount) || 0;

    const custKey = b.customerId || b.customerWhatsApp?.replace(/[^0-9]/g, '') || b.customerName;
    if (custKey) {
      currentCustomerKeys.add(custKey);
    }

    if (!isCancelled) {
      bookingValue += amount;
    } else {
      cancelledCount += 1;
    }

    if (isCompleted) {
      completedCount += 1;
      if (custKey) {
        completedCustomerKeys.add(custKey);
      }
      if (isPaid) {
        realizedRevenue += amount;
        completedPaidCount += 1;
      }
    }
  });

  const totalBookings = currentBookings.length;
  const uniqueCustomers = currentCustomerKeys.size;
  const averageOrderValue = completedPaidCount > 0 ? Math.round(realizedRevenue / completedPaidCount) : 0;
  const cancellationRate = totalBookings > 0 ? +((cancelledCount / totalBookings) * 100).toFixed(1) : 0;

  // Authoritative Customer CRM metrics
  // New Customer: Customer whose first completed treatment falls inside the selected period
  let newCustomers = 0;
  let repeatCustomers = 0;

  const customerMap = new Map<string, CustomerCRM>();
  allCustomers.forEach((c) => {
    customerMap.set(c.id, c);
    if (c.normalizedPhone) {
      customerMap.set(c.normalizedPhone.replace(/[^0-9]/g, ''), c);
    }
  });

  completedCustomerKeys.forEach((key) => {
    const cust = customerMap.get(key);
    if (cust) {
      const firstCompleted = cust.firstCompletedBookingAt || cust.firstBookingAt;
      if (firstCompleted) {
        const firstDate = firstCompleted.substring(0, 10);
        if (firstDate >= startDate && firstDate <= endDate) {
          newCustomers += 1;
        }
      }
      if (cust.completedBookings >= 2) {
        repeatCustomers += 1;
      }
    }
  });

  const completedCustomersCount = completedCustomerKeys.size;
  const repeatRate = completedCustomersCount > 0 ? +((repeatCustomers / completedCustomersCount) * 100).toFixed(1) : 0;

  // Growth comparison vs previous period
  let revenueGrowthPct: number | null = null;
  let bookingsGrowthPct: number | null = null;
  let completedGrowthPct: number | null = null;
  let aovGrowthPct: number | null = null;

  if (previousBookings && previousBookings.length > 0) {
    let prevRev = 0;
    let prevCompPaid = 0;
    let prevComp = 0;

    previousBookings.forEach((b) => {
      const isCompleted = (b.status || '').toLowerCase() === 'completed';
      const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';
      const amount = Number(b.totalAmount) || 0;
      if (isCompleted) {
        prevComp += 1;
        if (isPaid) {
          prevRev += amount;
          prevCompPaid += 1;
        }
      }
    });

    const prevAov = prevCompPaid > 0 ? Math.round(prevRev / prevCompPaid) : 0;

    if (prevRev > 0) {
      revenueGrowthPct = +(((realizedRevenue - prevRev) / prevRev) * 100).toFixed(1);
    }
    if (previousBookings.length > 0) {
      bookingsGrowthPct = +(((totalBookings - previousBookings.length) / previousBookings.length) * 100).toFixed(1);
    }
    if (prevComp > 0) {
      completedGrowthPct = +(((completedCount - prevComp) / prevComp) * 100).toFixed(1);
    }
    if (prevAov > 0) {
      aovGrowthPct = +(((averageOrderValue - prevAov) / prevAov) * 100).toFixed(1);
    }
  }

  return {
    realizedRevenue,
    bookingValue,
    totalBookings,
    completedBookings: completedCount,
    cancelledBookings: cancelledCount,
    uniqueCustomers,
    newCustomers,
    repeatCustomers,
    averageOrderValue,
    cancellationRate,
    repeatRate,
    revenueGrowthPct,
    bookingsGrowthPct,
    completedGrowthPct,
    aovGrowthPct,
  };
}

// ==========================================
// 5. TREND TIMELINE GENERATION (SVG CHART READY)
// ==========================================

export interface TrendDayData {
  date: string;          // YYYY-MM-DD
  dayLabel: string;      // e.g. "10 Sep" or "Sen, 10"
  realizedRevenue: number;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
}

export function generateDailyTrendData(
  bookings: Booking[],
  startDate: string,
  endDate: string
): TrendDayData[] {
  if (!startDate || !endDate) return [];

  const map = new Map<string, TrendDayData>();

  // Initialize continuous date range to prevent gaps
  try {
    const cur = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    while (cur <= end) {
      const dateStr = cur.toISOString().substring(0, 10);
      const parts = dateStr.split('-');
      const dayLabel = `${parts[2]}/${parts[1]}`;

      map.set(dateStr, {
        date: dateStr,
        dayLabel,
        realizedRevenue: 0,
        totalBookings: 0,
        completedBookings: 0,
        cancelledBookings: 0,
      });

      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } catch (e) {
    console.warn('Daily trend initialization error:', e);
  }

  // Populate from real bookings
  bookings.forEach((b) => {
    const dateStr = b.scheduleDate || (b.createdAt ? b.createdAt.substring(0, 10) : '');
    const entry = map.get(dateStr);
    if (!entry) return;

    entry.totalBookings += 1;
    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    const isCancelled = (b.status || '').toLowerCase() === 'cancelled';
    const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';
    const amount = Number(b.totalAmount) || 0;

    if (isCompleted) {
      entry.completedBookings += 1;
      if (isPaid) {
        entry.realizedRevenue += amount;
      }
    }
    if (isCancelled) {
      entry.cancelledBookings += 1;
    }
  });

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ==========================================
// 6. SERVICE PERFORMANCE METRICS
// ==========================================

export interface ServiceMetricsRow {
  serviceId: string;
  serviceName: string;
  duration: number;
  bookingCount: number;
  completedCount: number;
  realizedRevenue: number;
  averageTicket: number;
  sharePct: number;
  averageRating: number | null;
  ratingCount: number;
  isActive: boolean;
}

export function computeServiceMetrics(
  bookings: Booking[],
  masterServices: ServiceItem[],
  reviews: CustomerReview[]
): ServiceMetricsRow[] {
  const serviceMap = new Map<string, ServiceMetricsRow>();

  // Map reviews by serviceId or serviceName
  const reviewRatingsMap = new Map<string, { totalRating: number; count: number }>();
  reviews.forEach((r) => {
    if (r.overallRating && r.status !== 'hidden') {
      const key = r.serviceId || r.serviceName;
      const current = reviewRatingsMap.get(key) || { totalRating: 0, count: 0 };
      current.totalRating += r.overallRating;
      current.count += 1;
      reviewRatingsMap.set(key, current);
    }
  });

  // Calculate total realized revenue across all bookings
  let grandTotalRevenue = 0;
  bookings.forEach((b) => {
    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';
    if (isCompleted && isPaid) {
      grandTotalRevenue += Number(b.totalAmount) || 0;
    }
  });

  // Group by service snapshot name & duration
  bookings.forEach((b) => {
    const serviceName = b.serviceNameSnapshot || b.serviceName || 'Layanan Tidak Dikenal';
    const serviceId = b.serviceId || serviceName;
    const duration = b.durationMinutesSnapshot || b.serviceDuration || 60;
    const key = `${serviceName}_${duration}`;

    let row = serviceMap.get(key);
    if (!row) {
      // Find matching in master data to check active status
      const master = masterServices.find(
        (s) => s.id === b.serviceId || (s.name && s.name.toLowerCase() === (serviceName || '').toLowerCase())
      );
      const isActive = master ? master.isActive !== false : true;

      // Review stats
      const revStats = reviewRatingsMap.get(b.serviceId || '') || reviewRatingsMap.get(serviceName);
      const avgRating = revStats && revStats.count > 0 ? +(revStats.totalRating / revStats.count).toFixed(1) : null;
      const rCount = revStats ? revStats.count : 0;

      row = {
        serviceId,
        serviceName,
        duration,
        bookingCount: 0,
        completedCount: 0,
        realizedRevenue: 0,
        averageTicket: 0,
        sharePct: 0,
        averageRating: avgRating,
        ratingCount: rCount,
        isActive,
      };
      serviceMap.set(key, row);
    }

    row.bookingCount += 1;
    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';
    const amount = Number(b.totalAmount) || 0;

    if (isCompleted) {
      row.completedCount += 1;
      if (isPaid) {
        row.realizedRevenue += amount;
      }
    }
  });

  // Compute average ticket and share %
  const result = Array.from(serviceMap.values()).map((row) => {
    const avgTicket = row.completedCount > 0 ? Math.round(row.realizedRevenue / row.completedCount) : 0;
    const sharePct = grandTotalRevenue > 0 ? +((row.realizedRevenue / grandTotalRevenue) * 100).toFixed(1) : 0;
    return {
      ...row,
      averageTicket: avgTicket,
      sharePct,
    };
  });

  // Sort by realized revenue descending
  return result.sort((a, b) => b.realizedRevenue - a.realizedRevenue);
}

// ==========================================
// 7. THERAPIST PERFORMANCE & CAPACITY METRICS
// ==========================================

export interface TherapistMetricsRow {
  therapistId: string;
  therapistName: string;
  gender: string;
  isActive: boolean;
  jobsCompleted: number;
  plannedTreatmentMinutes: number;
  actualTreatmentMinutes: number;
  hasActualMinutes: boolean;
  scheduledShiftMinutes: number;
  rosterDataComplete: boolean;
  utilizationPct: number | null; // null if roster incomplete
  onTimeArrivals: number;
  lateArrivals: number;
  earlyArrivals: number;
  totalArrivalsTracked: number;
  onTimeRate: number | null;    // null if no arrivals tracked
  avgAcceptanceMinutes: number | null;
  avgTravelMinutes: number | null;
  averageRating: number | null;
  ratingCount: number;
  reassignedCount: number;
}

export function computeTherapistMetrics(
  bookings: Booking[],
  therapists: Therapist[],
  rosters: TherapistRoster[],
  operationalSettings: OperationalSettings | null,
  reviews: CustomerReview[]
): TherapistMetricsRow[] {
  const lateToleranceMin = operationalSettings?.lateDepartureBufferMinutes || 15;

  // Map reviews by therapistId
  const therapistReviewMap = new Map<string, { totalRating: number; count: number }>();
  reviews.forEach((r) => {
    if (r.therapistId && r.overallRating && r.status !== 'hidden') {
      const cur = therapistReviewMap.get(r.therapistId) || { totalRating: 0, count: 0 };
      cur.totalRating += r.overallRating;
      cur.count += 1;
      therapistReviewMap.set(r.therapistId, cur);
    }
  });

  // Map scheduled minutes from rosters
  const therapistRosterMap = new Map<string, { scheduledMinutes: number; rosterCount: number }>();
  rosters.forEach((ros) => {
    if (ros.status !== 'off' && ros.status !== 'leave' && ros.status !== 'unavailable') {
      const cur = therapistRosterMap.get(ros.therapistId) || { scheduledMinutes: 0, rosterCount: 0 };
      if (ros.shiftStart && ros.shiftEnd) {
        const [sh, sm] = ros.shiftStart.split(':').map(Number);
        const [eh, em] = ros.shiftEnd.split(':').map(Number);
        let shiftMin = (eh * 60 + em) - (sh * 60 + sm);
        if (shiftMin < 0) shiftMin += 24 * 60; // crossing midnight

        // subtract breaks
        let breakMin = 0;
        if (ros.breaks && Array.isArray(ros.breaks)) {
          ros.breaks.forEach((b) => {
            if (b.start && b.end) {
              const [bsh, bsm] = b.start.split(':').map(Number);
              const [beh, bem] = b.end.split(':').map(Number);
              let bM = (beh * 60 + bem) - (bsh * 60 + bsm);
              if (bM < 0) bM += 24 * 60;
              breakMin += bM;
            }
          });
        }
        cur.scheduledMinutes += Math.max(0, shiftMin - breakMin);
        cur.rosterCount += 1;
        therapistRosterMap.set(ros.therapistId, cur);
      }
    }
  });

  // Aggregate bookings per therapist
  const therapistData = new Map<
    string,
    {
      jobsCompleted: number;
      plannedTreatmentMinutes: number;
      actualTreatmentMinutes: number;
      hasActualMinutes: boolean;
      onTimeArrivals: number;
      lateArrivals: number;
      earlyArrivals: number;
      totalArrivalsTracked: number;
      acceptanceDurations: number[];
      travelDurations: number[];
      reassignedCount: number;
    }
  >();

  // Initialize for all active therapists
  therapists.forEach((th) => {
    therapistData.set(th.id, {
      jobsCompleted: 0,
      plannedTreatmentMinutes: 0,
      actualTreatmentMinutes: 0,
      hasActualMinutes: false,
      onTimeArrivals: 0,
      lateArrivals: 0,
      earlyArrivals: 0,
      totalArrivalsTracked: 0,
      acceptanceDurations: [],
      travelDurations: [],
      reassignedCount: 0,
    });
  });

  bookings.forEach((b) => {
    const thId = b.therapistId;
    if (!thId) return;

    let data = therapistData.get(thId);
    if (!data) {
      data = {
        jobsCompleted: 0,
        plannedTreatmentMinutes: 0,
        actualTreatmentMinutes: 0,
        hasActualMinutes: false,
        onTimeArrivals: 0,
        lateArrivals: 0,
        earlyArrivals: 0,
        totalArrivalsTracked: 0,
        acceptanceDurations: [],
        travelDurations: [],
        reassignedCount: 0,
      };
      therapistData.set(thId, data);
    }

    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    const durationMin = b.durationMinutesSnapshot || b.serviceDuration || 60;

    if (isCompleted) {
      data.jobsCompleted += 1;
      data.plannedTreatmentMinutes += durationMin;

      // Actual duration calculation
      if (b.treatmentStartedAt && b.completedAt) {
        const start = new Date(b.treatmentStartedAt).getTime();
        const end = new Date(b.completedAt).getTime();
        const diffMin = Math.round((end - start) / 60000);
        if (diffMin > 10 && diffMin < 360) {
          data.actualTreatmentMinutes += diffMin;
          data.hasActualMinutes = true;
        } else {
          data.actualTreatmentMinutes += durationMin;
        }
      } else {
        data.actualTreatmentMinutes += durationMin;
      }
    }

    // Arrival punctuality
    if (b.arrivedAt && b.scheduleDate && b.scheduleTime) {
      try {
        const schedTime = new Date(`${b.scheduleDate}T${b.scheduleTime}:00+07:00`).getTime();
        const arrTime = new Date(b.arrivedAt).getTime();
        if (!isNaN(schedTime) && !isNaN(arrTime)) {
          const diffMinutes = Math.round((arrTime - schedTime) / 60000);
          data.totalArrivalsTracked += 1;
          if (diffMinutes < -5) {
            data.earlyArrivals += 1;
            data.onTimeArrivals += 1;
          } else if (diffMinutes <= lateToleranceMin) {
            data.onTimeArrivals += 1;
          } else {
            data.lateArrivals += 1;
          }
        }
      } catch {
        // Safe skip on unparseable date
      }
    }

    // Acceptance duration
    if (b.acceptedAt && (b.assignedAt || b.createdAt)) {
      const refTime = new Date(b.assignedAt || b.createdAt).getTime();
      const accTime = new Date(b.acceptedAt).getTime();
      const diffMin = Math.round((accTime - refTime) / 60000);
      if (diffMin >= 0 && diffMin < 120) {
        data.acceptanceDurations.push(diffMin);
      }
    }

    // Travel duration
    if (b.arrivedAt && b.onTheWayAt) {
      const otw = new Date(b.onTheWayAt).getTime();
      const arr = new Date(b.arrivedAt).getTime();
      const diffMin = Math.round((arr - otw) / 60000);
      if (diffMin >= 0 && diffMin < 180) {
        data.travelDurations.push(diffMin);
      }
    }

    // Reassignment flag
    if (b.isReassigned || b.reassignedFromTherapistId) {
      data.reassignedCount += 1;
    }
  });

  // Build final rows
  const rows: TherapistMetricsRow[] = (therapists || []).map((th) => {
    const data = therapistData.get(th.id) || {
      jobsCompleted: 0,
      plannedTreatmentMinutes: 0,
      actualTreatmentMinutes: 0,
      hasActualMinutes: false,
      onTimeArrivals: 0,
      lateArrivals: 0,
      earlyArrivals: 0,
      totalArrivalsTracked: 0,
      acceptanceDurations: [],
      travelDurations: [],
      reassignedCount: 0,
    };

    const roster = therapistRosterMap.get(th.id);
    const scheduledShiftMinutes = roster ? roster.scheduledMinutes : 0;
    const rosterDataComplete = Boolean(roster && roster.rosterCount > 0);

    let utilizationPct: number | null = null;
    if (rosterDataComplete && scheduledShiftMinutes > 0) {
      const activeMin = data.hasActualMinutes ? data.actualTreatmentMinutes : data.plannedTreatmentMinutes;
      utilizationPct = Math.min(100, +((activeMin / scheduledShiftMinutes) * 100).toFixed(1));
    }

    const onTimeRate =
      data.totalArrivalsTracked > 0
        ? +((data.onTimeArrivals / data.totalArrivalsTracked) * 100).toFixed(1)
        : null;

    const avgAcceptanceMinutes =
      data.acceptanceDurations.length > 0
        ? +(data.acceptanceDurations.reduce((a, b) => a + b, 0) / data.acceptanceDurations.length).toFixed(1)
        : null;

    const avgTravelMinutes =
      data.travelDurations.length > 0
        ? +(data.travelDurations.reduce((a, b) => a + b, 0) / data.travelDurations.length).toFixed(1)
        : null;

    const rInfo = therapistReviewMap.get(th.id);
    const averageRating = rInfo && rInfo.count > 0 ? +(rInfo.totalRating / rInfo.count).toFixed(1) : null;
    const ratingCount = rInfo ? rInfo.count : 0;

    return {
      therapistId: th.id,
      therapistName: th.name,
      gender: th.gender || 'F',
      isActive: th.status !== 'off',
      jobsCompleted: data.jobsCompleted,
      plannedTreatmentMinutes: data.plannedTreatmentMinutes,
      actualTreatmentMinutes: data.actualTreatmentMinutes,
      hasActualMinutes: data.hasActualMinutes,
      scheduledShiftMinutes,
      rosterDataComplete,
      utilizationPct,
      onTimeArrivals: data.onTimeArrivals,
      lateArrivals: data.lateArrivals,
      earlyArrivals: data.earlyArrivals,
      totalArrivalsTracked: data.totalArrivalsTracked,
      onTimeRate,
      avgAcceptanceMinutes,
      avgTravelMinutes,
      averageRating,
      ratingCount,
      reassignedCount: data.reassignedCount,
    };
  });

  return rows.sort((a, b) => b.jobsCompleted - a.jobsCompleted);
}

// ==========================================
// 8. AREA PERFORMANCE METRICS
// ==========================================

export interface AreaMetricsRow {
  areaName: string;
  bookingCount: number;
  completedCount: number;
  realizedRevenue: number;
  avgHomeServiceFee: number;
  cancellationCount: number;
  cancellationRate: number;
}

export function computeAreaMetrics(
  bookings: Booking[],
  serviceAreas: ServiceArea[]
): AreaMetricsRow[] {
  const map = new Map<
    string,
    {
      bookingCount: number;
      completedCount: number;
      realizedRevenue: number;
      totalHomeServiceFee: number;
      cancellationCount: number;
    }
  >();

  // Pre-seed with known master service areas
  serviceAreas.forEach((sa) => {
    if (sa.isActive !== false) {
      map.set(sa.name, {
        bookingCount: 0,
        completedCount: 0,
        realizedRevenue: 0,
        totalHomeServiceFee: 0,
        cancellationCount: 0,
      });
    }
  });

  bookings.forEach((b) => {
    const areaName = b.areaName || b.customerArea || b.addressDistrict || 'Lainnya';
    let data = map.get(areaName);
    if (!data) {
      data = {
        bookingCount: 0,
        completedCount: 0,
        realizedRevenue: 0,
        totalHomeServiceFee: 0,
        cancellationCount: 0,
      };
      map.set(areaName, data);
    }

    data.bookingCount += 1;
    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    const isCancelled = (b.status || '').toLowerCase() === 'cancelled';
    const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';
    const amount = Number(b.totalAmount) || 0;
    const fee = Number(b.homeServiceFeeSnapshot || b.homeServiceFee) || 0;

    data.totalHomeServiceFee += fee;

    if (isCompleted) {
      data.completedCount += 1;
      if (isPaid) {
        data.realizedRevenue += amount;
      }
    }
    if (isCancelled) {
      data.cancellationCount += 1;
    }
  });

  const result: AreaMetricsRow[] = Array.from(map.entries()).map(([areaName, data]) => {
    const avgHomeServiceFee = data.bookingCount > 0 ? Math.round(data.totalHomeServiceFee / data.bookingCount) : 0;
    const cancellationRate = data.bookingCount > 0 ? +((data.cancellationCount / data.bookingCount) * 100).toFixed(1) : 0;

    return {
      areaName,
      bookingCount: data.bookingCount,
      completedCount: data.completedCount,
      realizedRevenue: data.realizedRevenue,
      avgHomeServiceFee,
      cancellationCount: data.cancellationCount,
      cancellationRate,
    };
  });

  return result.sort((a, b) => b.bookingCount - a.bookingCount);
}

// ==========================================
// 9. PAYMENT REPORTING METRICS
// ==========================================

export interface PaymentMetricsRow {
  methodKey: string;
  methodLabel: string;
  isLegacyCash: boolean;
  transactionCount: number;
  paidAmount: number;
  sharePct: number;
  rejectedProofCount: number;
  avgVerificationMinutes: number | null;
}

export function computePaymentMetrics(
  bookings: Booking[],
  payments: PaymentRecord[] = []
): PaymentMetricsRow[] {
  const map = new Map<
    string,
    {
      methodLabel: string;
      isLegacyCash: boolean;
      transactionCount: number;
      paidAmount: number;
      rejectedProofCount: number;
      verificationDurations: number[];
    }
  >();

  // Initialize official payment methods
  const methods = [
    { key: 'qris', label: 'QRIS Senzu', isLegacy: false },
    { key: 'bni', label: 'Bank BNI', isLegacy: false },
    { key: 'mandiri', label: 'Bank Mandiri', isLegacy: false },
    { key: 'bri', label: 'Bank BRI', isLegacy: false },
  ];

  methods.forEach((m) => {
    map.set(m.key, {
      methodLabel: m.label,
      isLegacyCash: m.isLegacy,
      transactionCount: 0,
      paidAmount: 0,
      rejectedProofCount: 0,
      verificationDurations: [],
    });
  });

  let grandPaidAmount = 0;

  // Process payment records first for authoritative transaction data
  const paymentMapByBookingId = new Map<string, PaymentRecord>();
  payments.forEach((p) => {
    if (p.bookingId) {
      paymentMapByBookingId.set(p.bookingId, p);
    }
    const rawMethod = (p.methodType || p.paymentMethod || '').toLowerCase();
    const isCash = rawMethod.includes('cash') || rawMethod.includes('tunai');
    let key = isCash ? 'cash_legacy' : rawMethod.includes('qris') ? 'qris' : rawMethod.includes('bni') ? 'bni' : rawMethod.includes('mandiri') ? 'mandiri' : rawMethod.includes('bri') ? 'bri' : 'other';

    let row = map.get(key);
    if (!row) {
      row = {
        methodLabel: isCash ? 'Tunai / Cash (Histori/Demo)' : key.toUpperCase(),
        isLegacyCash: isCash,
        transactionCount: 0,
        paidAmount: 0,
        rejectedProofCount: 0,
        verificationDurations: [],
      };
      map.set(key, row);
    }

    row.transactionCount += 1;
    if (p.status === 'paid' || (p.status as string) === 'PAID') {
      const amt = Number(p.amount) || 0;
      row.paidAmount += amt;
      grandPaidAmount += amt;
    }
    if (p.status === 'payment_rejected') {
      row.rejectedProofCount += 1;
    }

    if (p.verifiedAt && p.proofUploadedAt) {
      const vTime = new Date(p.verifiedAt).getTime();
      const uTime = new Date(p.proofUploadedAt).getTime();
      const diffMin = Math.round((vTime - uTime) / 60000);
      if (diffMin >= 0 && diffMin < 1440) {
        row.verificationDurations.push(diffMin);
      }
    }
  });

  // Also check bookings in case payment records were not created yet (fallback)
  if (payments.length === 0) {
    bookings.forEach((b) => {
      const rawMethod = (b.paymentMethod || 'qris').toLowerCase();
      const isCash = rawMethod.includes('cash') || rawMethod.includes('tunai');
      let key = isCash ? 'cash_legacy' : rawMethod.includes('qris') ? 'qris' : rawMethod.includes('bni') ? 'bni' : rawMethod.includes('mandiri') ? 'mandiri' : rawMethod.includes('bri') ? 'bri' : 'other';

      let row = map.get(key);
      if (!row) {
        row = {
          methodLabel: isCash ? 'Tunai / Cash (Histori/Demo)' : key.toUpperCase(),
          isLegacyCash: isCash,
          transactionCount: 0,
          paidAmount: 0,
          rejectedProofCount: 0,
          verificationDurations: [],
        };
        map.set(key, row);
      }

      row.transactionCount += 1;
      const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';
      if (isPaid) {
        const amt = Number(b.totalAmount) || 0;
        row.paidAmount += amt;
        grandPaidAmount += amt;
      }
    });
  }

  const result: PaymentMetricsRow[] = Array.from(map.entries()).map(([key, data]) => {
    const sharePct = grandPaidAmount > 0 ? +((data.paidAmount / grandPaidAmount) * 100).toFixed(1) : 0;
    const avgVerificationMinutes =
      data.verificationDurations.length > 0
        ? +(data.verificationDurations.reduce((a, b) => a + b, 0) / data.verificationDurations.length).toFixed(1)
        : null;

    return {
      methodKey: key,
      methodLabel: data.methodLabel,
      isLegacyCash: data.isLegacyCash,
      transactionCount: data.transactionCount,
      paidAmount: data.paidAmount,
      sharePct,
      rejectedProofCount: data.rejectedProofCount,
      avgVerificationMinutes,
    };
  });

  return result.sort((a, b) => b.paidAmount - a.paidAmount);
}

// ==========================================
// 10. OPERATIONAL FUNNEL & BOTTLENECKS
// ==========================================

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  pctOfTotal: number;
  avgWaitMin: number | null;
  medianWaitMin: number | null;
}

export function computeOperationalFunnel(bookings: Booking[]): FunnelStage[] {
  const total = bookings.length;
  if (total === 0) {
    return [
      { key: 'created', label: 'Booking Dibuat', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'proof_uploaded', label: 'Bukti Bayar Diunggah', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'verified', label: 'Pembayaran Lunas', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'confirmed', label: 'Reservasi Dikonfirmasi', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'assigned', label: 'Terapis Ditugaskan', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'accepted', label: 'Diterima Terapis', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'on_the_way', label: 'Menuju Lokasi', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'arrived', label: 'Tiba di Lokasi', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'treatment', label: 'Treatment Dimulai', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
      { key: 'completed', label: 'Treatment Selesai', count: 0, pctOfTotal: 0, avgWaitMin: null, medianWaitMin: null },
    ];
  }

  // Transitions collector
  const waitDurations: Record<string, number[]> = {
    proof_uploaded: [],
    verified: [],
    confirmed: [],
    assigned: [],
    accepted: [],
    on_the_way: [],
    arrived: [],
    treatment: [],
    completed: [],
  };

  let cProof = 0;
  let cVerified = 0;
  let cConfirmed = 0;
  let cAssigned = 0;
  let cAccepted = 0;
  let cOtw = 0;
  let cArrived = 0;
  let cTreatment = 0;
  let cCompleted = 0;

  bookings.forEach((b) => {
    const isCancelled = (b.status || '').toLowerCase() === 'cancelled';
    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    const isPaid = (b.paymentStatus || '').toLowerCase() === 'paid';

    if (b.paymentProofUrl || b.paymentProofUploadedAt) {
      cProof += 1;
      if (b.createdAt && b.paymentProofUploadedAt) {
        const diff = Math.round((new Date(b.paymentProofUploadedAt).getTime() - new Date(b.createdAt).getTime()) / 60000);
        if (diff >= 0 && diff < 1440) waitDurations.proof_uploaded.push(diff);
      }
    }

    if (isPaid || b.paymentVerifiedAt) {
      cVerified += 1;
      const refProof = b.paymentProofUploadedAt || b.createdAt;
      if (refProof && b.paymentVerifiedAt) {
        const diff = Math.round((new Date(b.paymentVerifiedAt).getTime() - new Date(refProof).getTime()) / 60000);
        if (diff >= 0 && diff < 1440) waitDurations.verified.push(diff);
      }
    }

    if (b.confirmedAt || isPaid || isCompleted) {
      cConfirmed += 1;
    }

    if (b.therapistId || b.assignedAt) {
      cAssigned += 1;
      const refConf = b.confirmedAt || b.paymentVerifiedAt || b.createdAt;
      if (refConf && b.assignedAt) {
        const diff = Math.round((new Date(b.assignedAt).getTime() - new Date(refConf).getTime()) / 60000);
        if (diff >= 0 && diff < 1440) waitDurations.assigned.push(diff);
      }
    }

    if (b.acceptedAt) {
      cAccepted += 1;
      const refAss = b.assignedAt || b.confirmedAt;
      if (refAss && b.acceptedAt) {
        const diff = Math.round((new Date(b.acceptedAt).getTime() - new Date(refAss).getTime()) / 60000);
        if (diff >= 0 && diff < 300) waitDurations.accepted.push(diff);
      }
    }

    if (b.onTheWayAt) {
      cOtw += 1;
      if (b.acceptedAt && b.onTheWayAt) {
        const diff = Math.round((new Date(b.onTheWayAt).getTime() - new Date(b.acceptedAt).getTime()) / 60000);
        if (diff >= 0 && diff < 300) waitDurations.on_the_way.push(diff);
      }
    }

    if (b.arrivedAt) {
      cArrived += 1;
      if (b.onTheWayAt && b.arrivedAt) {
        const diff = Math.round((new Date(b.arrivedAt).getTime() - new Date(b.onTheWayAt).getTime()) / 60000);
        if (diff >= 0 && diff < 180) waitDurations.arrived.push(diff);
      }
    }

    if (b.treatmentStartedAt) {
      cTreatment += 1;
      if (b.arrivedAt && b.treatmentStartedAt) {
        const diff = Math.round((new Date(b.treatmentStartedAt).getTime() - new Date(b.arrivedAt).getTime()) / 60000);
        if (diff >= 0 && diff < 120) waitDurations.treatment.push(diff);
      }
    }

    if (isCompleted) {
      cCompleted += 1;
      if (b.treatmentStartedAt && b.completedAt) {
        const diff = Math.round((new Date(b.completedAt).getTime() - new Date(b.treatmentStartedAt).getTime()) / 60000);
        if (diff >= 0 && diff < 360) waitDurations.completed.push(diff);
      }
    }
  });

  const calcAvgMedian = (arr: number[]): { avg: number | null; med: number | null } => {
    if (!arr || arr.length === 0) return { avg: null, med: null };
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
    return { avg, med };
  };

  const stages: { key: string; label: string; count: number; waitKey?: string }[] = [
    { key: 'created', label: '1. Reservasi Masuk', count: total },
    { key: 'proof_uploaded', label: '2. Bukti Bayar Diunggah', count: cProof, waitKey: 'proof_uploaded' },
    { key: 'verified', label: '3. Pembayaran Terverifikasi', count: cVerified, waitKey: 'verified' },
    { key: 'confirmed', label: '4. Reservasi Dikonfirmasi', count: cConfirmed, waitKey: 'confirmed' },
    { key: 'assigned', label: '5. Terapis Ditugaskan', count: cAssigned, waitKey: 'assigned' },
    { key: 'accepted', label: '6. Diterima Terapis', count: cAccepted, waitKey: 'accepted' },
    { key: 'on_the_way', label: '7. Terapis Meluncur', count: cOtw, waitKey: 'on_the_way' },
    { key: 'arrived', label: '8. Tiba di Lokasi', count: cArrived, waitKey: 'arrived' },
    { key: 'treatment', label: '9. Treatment Dimulai', count: cTreatment, waitKey: 'treatment' },
    { key: 'completed', label: '10. Layanan Selesai', count: cCompleted, waitKey: 'completed' },
  ];

  return (stages || []).map((s) => {
    const pct = total > 0 ? +((s.count / total) * 100).toFixed(1) : 0;
    const dur = s.waitKey ? calcAvgMedian(waitDurations[s.waitKey]) : { avg: null, med: null };
    return {
      key: s.key,
      label: s.label,
      count: s.count,
      pctOfTotal: pct,
      avgWaitMin: dur.avg,
      medianWaitMin: dur.med,
    };
  });
}

export const computeFunnelStages = computeOperationalFunnel;

// ==========================================
// 11. CSS SLA PERFORMANCE
// ==========================================

export interface CssSlaMetrics {
  proofUploadedCount: number;
  verifiedCount: number;
  rejectedCount: number;
  avgVerificationMinutes: number;
  medianVerificationMinutes: number;
  withinSlaCount: number;
  overSlaCount: number;
  slaAchievementRate: number;
  targetSlaMinutes: number;
}

export function computeCssSlaMetrics(
  paymentsOrBookings: (PaymentRecord | Booking)[],
  operationalSettings?: OperationalSettings | number | null
): CssSlaMetrics {
  const targetSla = typeof operationalSettings === 'number'
    ? operationalSettings
    : operationalSettings?.paymentVerificationSlaMinutes || 120;

  let proofUploadedCount = 0;
  let verifiedCount = 0;
  let rejectedCount = 0;
  let withinSlaCount = 0;
  let overSlaCount = 0;
  const durations: number[] = [];

  (paymentsOrBookings as any[]).forEach((p) => {
    const hasProof = Boolean(p.proofUploadedAt || p.paymentProofUrl || p.paymentProofUploadedAt);
    if (hasProof) {
      proofUploadedCount += 1;
    }
    const isPaid = p.status === 'paid' || (p.status as string) === 'PAID' || p.paymentStatus === 'paid' || p.paymentStatus === 'PAID';
    if (isPaid) {
      verifiedCount += 1;
      const vDate = p.verifiedAt || p.paymentVerifiedAt;
      const uDate = p.proofUploadedAt || p.paymentProofUploadedAt || p.createdAt;
      if (vDate && uDate) {
        const v = new Date(vDate).getTime();
        const u = new Date(uDate).getTime();
        const diffMin = Math.round((v - u) / 60000);
        if (diffMin >= 0 && diffMin < 2880) {
          durations.push(diffMin);
          if (diffMin <= targetSla) {
            withinSlaCount += 1;
          } else {
            overSlaCount += 1;
          }
        }
      }
    } else if (p.status === 'payment_rejected' || p.paymentStatus === 'payment_rejected') {
      rejectedCount += 1;
    }
  });

  const sorted = [...durations].sort((a, b) => a - b);
  const avgVerificationMinutes =
    sorted.length > 0 ? +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1) : 0;
  const mid = Math.floor(sorted.length / 2);
  const medianVerificationMinutes =
    sorted.length > 0
      ? sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid]
      : 0;

  const totalEvaluated = withinSlaCount + overSlaCount;
  const slaAchievementRate = totalEvaluated > 0 ? +((withinSlaCount / totalEvaluated) * 100).toFixed(1) : 100;

  return {
    proofUploadedCount,
    verifiedCount,
    rejectedCount,
    avgVerificationMinutes,
    medianVerificationMinutes,
    withinSlaCount,
    overSlaCount,
    slaAchievementRate,
    targetSlaMinutes: targetSla,
  };
}

// ==========================================
// 12. RATING & REVIEWS DISTRIBUTION
// ==========================================

export interface RatingReportMetrics {
  averageRating: number | null;
  totalReviews: number;
  distribution: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
  lowRatingCount: number;
  openRecoveryCount: number;
  resolvedRecoveryCount: number;
  lowRatingThreshold: number;
}

export function computeRatingMetrics(
  reviews: CustomerReview[],
  operationalSettings?: OperationalSettings | null
): RatingReportMetrics {
  const threshold = operationalSettings?.lowRatingThreshold || 2;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let totalRatingSum = 0;
  let totalReviews = 0;
  let lowRatingCount = 0;
  let openRecoveryCount = 0;
  let resolvedRecoveryCount = 0;

  reviews.forEach((r) => {
    if (r.status !== 'hidden' && r.overallRating) {
      const rating = Math.min(5, Math.max(1, Math.round(r.overallRating))) as 1 | 2 | 3 | 4 | 5;
      distribution[rating] += 1;
      totalRatingSum += r.overallRating;
      totalReviews += 1;

      if (r.overallRating <= threshold) {
        lowRatingCount += 1;
        if (r.serviceRecoveryStatus === 'open' || r.serviceRecoveryStatus === 'contacted') {
          openRecoveryCount += 1;
        } else if (r.serviceRecoveryStatus === 'resolved' || r.serviceRecoveryStatus === 'closed') {
          resolvedRecoveryCount += 1;
        }
      }
    }
  });

  const averageRating = totalReviews > 0 ? +(totalRatingSum / totalReviews).toFixed(1) : null;

  return {
    averageRating,
    totalReviews,
    distribution,
    lowRatingCount,
    openRecoveryCount,
    resolvedRecoveryCount,
    lowRatingThreshold: threshold,
  };
}

// ==========================================
// 13. DATA QUALITY & COMPLETENESS REPORT
// ==========================================

export interface DataQualityReport {
  completenessScore: number; // 0 - 100%
  totalBookings: number;
  missingArrivedAt: number;
  missingPaymentStatus: number;
  missingArea: number;
  therapistsMissingRoster: number;
  warnings: string[];
}

export function computeDataQualityReport(
  bookings: Booking[],
  therapists: Therapist[],
  rosters: TherapistRoster[]
): DataQualityReport {
  let missingArrivedAt = 0;
  let missingPaymentStatus = 0;
  let missingArea = 0;
  const warnings: string[] = [];

  bookings.forEach((b) => {
    const isCompleted = (b.status || '').toLowerCase() === 'completed';
    if (isCompleted && !b.arrivedAt) {
      missingArrivedAt += 1;
    }
    if (!b.paymentStatus) {
      missingPaymentStatus += 1;
    }
    if (!b.areaName && !b.customerArea && !b.addressDistrict) {
      missingArea += 1;
    }
  });

  const rosterTherapistIds = new Set((rosters || []).map((r) => r.therapistId));
  const therapistsMissingRoster = therapists.filter((t) => t.status !== 'off' && !rosterTherapistIds.has(t.id)).length;

  if (missingArrivedAt > 0) {
    warnings.push(`${missingArrivedAt} booking selesai tidak memiliki catatan waktu tiba (arrivedAt).`);
  }
  if (missingPaymentStatus > 0) {
    warnings.push(`${missingPaymentStatus} booking tidak memiliki status verifikasi pembayaran spesifik.`);
  }
  if (missingArea > 0) {
    warnings.push(`${missingArea} booking tidak terpetakan ke wilayah kecamatan / area Palembang.`);
  }
  if (therapistsMissingRoster > 0) {
    warnings.push(`${therapistsMissingRoster} terapis aktif belum memiliki data roster kerja pada periode ini.`);
  }

  // Calculate completeness score (penalizing missing data)
  const total = Math.max(1, bookings.length);
  const penalty =
    (missingArrivedAt / total) * 30 +
    (missingPaymentStatus / total) * 20 +
    (missingArea / total) * 20 +
    (therapistsMissingRoster / Math.max(1, therapists.length)) * 30;

  const completenessScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    completenessScore,
    totalBookings: bookings.length,
    missingArrivedAt,
    missingPaymentStatus,
    missingArea,
    therapistsMissingRoster,
    warnings,
  };
}

// ==========================================
// 14. EXCEL EXPORT ENGINE (MULTI-TYPE)
// ==========================================

export type ExportReportType =
  | 'booking_detail'
  | 'revenue_summary'
  | 'service_performance'
  | 'therapist_performance'
  | 'customer_summary'
  | 'operational_sla'
  | 'payment_summary'
  | 'cancellation';

export interface ExportContext {
  reportType: ExportReportType;
  filterLabel: string;
  startDate: string;
  endDate: string;
  branchName: string;
  exportedBy: {
    id: string;
    name: string;
    role: string;
  };
}

/**
 * Robust, multi-type Excel exporter that reuses XLSX, preserves standard operational
 * columns, adds authoritative metadata, and records audit trail.
 */
export async function exportReportToExcel(
  context: ExportContext,
  data: {
    bookings: Booking[];
    services?: ServiceItem[];
    therapists?: Therapist[];
    customers?: CustomerCRM[];
    payments?: PaymentRecord[];
    rosters?: TherapistRoster[];
    reviews?: CustomerReview[];
    settings?: OperationalSettings | null;
  }
): Promise<void> {
  const { reportType, filterLabel, startDate, endDate, branchName, exportedBy } = context;
  const now = new Date();
  const timestampWIB = formatDateTimeWIB(now);

  const wb = XLSX.utils.book_new();

  // 1. Prepare Metadata Sheet Header
  const metadataRows = [
    ['SENZU HOME REFLEXOLOGY & WELLNESS — LAPORAN MANAJEMEN'],
    [`Jenis Laporan: ${getReportTypeTitle(reportType)}`],
    [`Periode: ${filterLabel} (${startDate} s/d ${endDate})`],
    [`Cabang: ${branchName}`],
    [`Diekspor Oleh: ${exportedBy.name} (${exportedBy.role.toUpperCase()})`],
    [`Waktu Ekspor: ${timestampWIB}`],
    ['Zona Waktu: Asia/Jakarta (WIB)'],
    [], // Blank line
  ];

  let sheetData: any[][] = [];

  switch (reportType) {
    case 'booking_detail': {
      // PRESERVE REQUIRED OPERATIONAL COLUMNS:
      // Nama Terapis, Durasi Treatment, Jenis Treatment, Nama Pelanggan, Tanggal Refleksi, Jam Refleksi, Pembayaran, Keterangan
      const header = [
        'Kode Booking',
        'Nama Pelanggan',
        'Nomor WhatsApp',
        'Tanggal Refleksi',
        'Jam Refleksi',
        'Jenis Treatment',
        'Durasi Treatment (Menit)',
        'Nama Terapis',
        'Status Reservasi',
        'Status Pembayaran',
        'Metode Pembayaran',
        'Harga Layanan',
        'Biaya Transport (Home Service)',
        'Diskon',
        'Total Pembayaran',
        'Alamat Lengkap',
        'Area / Kecamatan',
        'Keterangan / Catatan',
        'Waktu Dibuat (WIB)',
      ];

      const rows = (data.bookings || []).map((b) => [
        b.bookingCode || b.id,
        b.customerName || '-',
        b.customerWhatsApp || '-',
        b.scheduleDate ? formatDateIndo(b.scheduleDate) : '-',
        b.scheduleTime || '-',
        b.serviceNameSnapshot || b.serviceName || '-',
        b.durationMinutesSnapshot || b.serviceDuration || 60,
        b.assignedTherapistName || b.preferredTherapistName || 'Belum Ditugaskan',
        b.status || '-',
        b.paymentStatus || 'UNPAID',
        b.paymentMethod || '-',
        b.servicePriceSnapshot || b.servicePrice || 0,
        b.homeServiceFeeSnapshot || b.homeServiceFee || 0,
        b.discountAmount || 0,
        b.totalAmount || 0,
        b.customerAddress || '-',
        b.areaName || b.customerArea || b.addressDistrict || '-',
        b.notes || b.cancellationReason || '-',
        b.createdAt ? formatDateTimeWIB(b.createdAt) : '-',
      ]);

      sheetData = [...metadataRows, header, ...rows];
      break;
    }

    case 'revenue_summary': {
      const header = ['Tanggal', 'Jumlah Booking Masuk', 'Booking Selesai', 'Booking Dibatalkan', 'Omzet Terealisasi (Rp)', 'Rata-rata Order (AOV)'];
      const trend = generateDailyTrendData(data.bookings, startDate, endDate);
      const rows = (trend || []).map((t) => {
        const aov = t.completedBookings > 0 ? Math.round(t.realizedRevenue / t.completedBookings) : 0;
        return [
          t.date,
          t.totalBookings,
          t.completedBookings,
          t.cancelledBookings,
          t.realizedRevenue,
          aov,
        ];
      });

      sheetData = [...metadataRows, header, ...rows];
      break;
    }

    case 'service_performance': {
      const header = ['Layanan / Treatment', 'Durasi (Menit)', 'Total Booking', 'Booking Selesai', 'Omzet Terealisasi (Rp)', 'Rata-rata Tiket (Rp)', 'Pangsa Pasar (%)', 'Rating Rata-rata', 'Status Layanan'];
      const metrics = computeServiceMetrics(data.bookings, data.services || [], data.reviews || []);
      const rows = (metrics || []).map((m) => [
        m.serviceName,
        m.duration,
        m.bookingCount,
        m.completedCount,
        m.realizedRevenue,
        m.averageTicket,
        `${m.sharePct}%`,
        m.averageRating ? `${m.averageRating}★ (${m.ratingCount})` : 'Belum Ada Rating',
        m.isActive ? 'Aktif' : 'Non-Aktif',
      ]);

      sheetData = [...metadataRows, header, ...rows];
      break;
    }

    case 'therapist_performance': {
      const header = ['Nama Terapis', 'Gender', 'Status', 'Jobs Selesai', 'Durasi Treatment (Rencana Menit)', 'Durasi Aktual (Menit)', 'Jam Kerja Roster (Menit)', 'Utilisasi (%)', 'Total Tiba Terlacak', 'Tepat Waktu (%)', 'Rata-rata Respons Terima (Menit)', 'Rata-rata Waktu Meluncur (Menit)', 'Rating Layanan', 'Total Reassignment'];
      const metrics = computeTherapistMetrics(data.bookings, data.therapists || [], data.rosters || [], data.settings || null, data.reviews || []);
      const rows = (metrics || []).map((m) => [
        m.therapistName,
        m.gender === 'F' ? 'Wanita' : 'Pria',
        m.isActive ? 'Aktif' : 'Off',
        m.jobsCompleted,
        m.plannedTreatmentMinutes,
        m.actualTreatmentMinutes,
        m.scheduledShiftMinutes,
        m.rosterDataComplete && m.utilizationPct !== null ? `${m.utilizationPct}%` : 'Data Roster Belum Lengkap',
        m.totalArrivalsTracked,
        m.onTimeRate !== null ? `${m.onTimeRate}%` : 'Belum Ada Data Tiba',
        m.avgAcceptanceMinutes !== null ? m.avgAcceptanceMinutes : '-',
        m.avgTravelMinutes !== null ? m.avgTravelMinutes : '-',
        m.averageRating ? `${m.averageRating}★ (${m.ratingCount})` : 'Belum Ada Rating',
        m.reassignedCount,
      ]);

      sheetData = [...metadataRows, header, ...rows];
      break;
    }

    case 'customer_summary': {
      const header = ['ID Pelanggan', 'Nama Pelanggan', 'Nomor Telepon', 'Segment CRM', 'Total Booking', 'Booking Selesai', 'Total Belanja (Rp)', 'Rata-rata Order (Rp)', 'Layanan Favorit', 'Terapis Favorit', 'Booking Terakhir'];
      const rows = (data.customers || []).map((c) => [
        c.id,
        c.name,
        c.phone || c.normalizedPhone || '-',
        c.customerSegment || 'NEW',
        c.totalBookings || c.totalBooking || 0,
        c.completedBookings || c.completedBooking || 0,
        c.totalSpend || 0,
        c.averageOrderValue || 0,
        c.favoriteServiceName || c.favoriteTreatment || '-',
        c.favoriteTherapistName || c.favoriteTherapist || '-',
        c.lastBookingAt ? formatDateTimeWIB(c.lastBookingAt) : '-',
      ]);

      sheetData = [...metadataRows, header, ...rows];
      break;
    }

    case 'operational_sla': {
      const header = ['Tahapan Operasional', 'Total Reservasi Berada / Melewati Tahap Ini', 'Porsi dari Total (%)', 'Rata-rata Durasi Menunggu (Menit)', 'Median Durasi Menunggu (Menit)'];
      const funnel = computeOperationalFunnel(data.bookings);
      const rows = (funnel || []).map((f) => [
        f.label,
        f.count,
        `${f.pctOfTotal}%`,
        f.avgWaitMin !== null ? f.avgWaitMin : '-',
        f.medianWaitMin !== null ? f.medianWaitMin : '-',
      ]);

      sheetData = [...metadataRows, header, ...rows];
      break;
    }

    case 'payment_summary': {
      const header = ['Metode Pembayaran', 'Status Akun', 'Jumlah Transaksi', 'Total Terbayar (Rp)', 'Pangsa Pasar (%)', 'Bukti Ditolak', 'Rata-rata Verifikasi (Menit)'];
      const payMetrics = computePaymentMetrics(data.bookings, data.payments || []);
      const rows = (payMetrics || []).map((p) => [
        p.methodLabel,
        p.isLegacyCash ? 'Histori / Demo' : 'Metode Aktif',
        p.transactionCount,
        p.paidAmount,
        `${p.sharePct}%`,
        p.rejectedProofCount,
        p.avgVerificationMinutes !== null ? p.avgVerificationMinutes : '-',
      ]);

      sheetData = [...metadataRows, header, ...rows];
      break;
    }

    case 'cancellation': {
      const header = ['Kode Booking', 'Nama Pelanggan', 'Layanan', 'Tanggal Refleksi', 'Jam Refleksi', 'Alasan Pembatalan', 'Total Nilai (Rp)', 'Dibatalkan Pada (WIB)'];
      const cancelled = data.bookings.filter((b) => (b.status || '').toLowerCase() === 'cancelled');
      const rows = (cancelled || []).map((b) => [
        b.bookingCode || b.id,
        b.customerName || '-',
        b.serviceNameSnapshot || b.serviceName || '-',
        b.scheduleDate || '-',
        b.scheduleTime || '-',
        b.cancellationReason || 'Tidak Ada Alasan',
        b.totalAmount || 0,
        b.updatedAt ? formatDateTimeWIB(b.updatedAt) : '-',
      ]);

      sheetData = [...metadataRows, header, ...rows];
      break;
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Column auto-width estimation
  const colWidths: any[] = [];
  sheetData.forEach((row) => {
    row.forEach((cell, i) => {
      const len = String(cell || '').length;
      colWidths[i] = Math.max(colWidths[i] || 10, Math.min(50, len + 2));
    });
  });
  ws['!cols'] = (colWidths || []).map((w) => ({ wch: w }));

  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');

  // Filename format: Senzu_[Type]_[StartDate]_[EndDate].xlsx
  const filename = `Senzu_${reportType}_${startDate}_sd_${endDate}.xlsx`;
  XLSX.writeFile(wb, filename);

  // Record Audit Trail in Firestore
  try {
    await recordAdminAuditLog({
      actorId: exportedBy.id,
      actorRole: exportedBy.role as any,
      actorName: exportedBy.name,
      action: 'report.exported',
      entityType: 'report',
      entityId: `rep_${reportType}_${Date.now()}`,
      summary: `Mengekspor laporan ${getReportTypeTitle(reportType)} (${filterLabel}, ${startDate} s/d ${endDate}) ke Excel`,
      newValue: JSON.stringify({
        reportType,
        startDate,
        endDate,
        branchName,
        rowCount: sheetData.length,
      }),
    });
  } catch (err) {
    console.warn('Audit log report export warning:', err);
  }
}

function getReportTypeTitle(type: ExportReportType): string {
  switch (type) {
    case 'booking_detail':
      return 'Rincian Operasional & Reservasi';
    case 'revenue_summary':
      return 'Ringkasan Omzet & Tren Harian';
    case 'service_performance':
      return 'Kinerja Layanan & Treatment';
    case 'therapist_performance':
      return 'Kapasitas & Utilisasi Terapis';
    case 'customer_summary':
      return 'Ringkasan Pelanggan & CRM';
    case 'operational_sla':
      return 'Funnel Operasional & SLA';
    case 'payment_summary':
      return 'Rekapitulasi Pembayaran & Metode';
    case 'cancellation':
      return 'Analisis Pembatalan (Cancellation)';
    default:
      return 'Laporan Bisnis';
  }
}
