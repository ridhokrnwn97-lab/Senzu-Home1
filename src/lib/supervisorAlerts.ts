import { Booking, Therapist, TherapistLocation, OperationalAlert, OperationalSettings } from '../types';
import { isPaymentPaid } from './paymentService';

export function computeOperationalAlerts(
  bookings: Booking[],
  therapists: Therapist[],
  activeLocations: Record<string, TherapistLocation>,
  acknowledgedAlertIds: Set<string> = new Set(),
  operationalSettings?: Partial<OperationalSettings>
): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  const now = new Date();
  const nowMillis = now.getTime();
  const todayStr = now.toISOString().split('T')[0];

  // If supervisor alerts are explicitly disabled in operational settings, return empty
  if (operationalSettings?.supervisorAlertsEnabled === false) {
    return [];
  }

  const unassignedAlertMinutes = operationalSettings?.unassignedAlertMinutes ?? 90;
  const acceptanceTimeoutMinutes = operationalSettings?.therapistAcceptanceTimeoutMinutes ?? 10;
  const acceptanceWarningMinutes = Math.max(5, Math.round(acceptanceTimeoutMinutes * 0.8));
  const lateDepartureBufferMinutes = operationalSettings?.lateDepartureBufferMinutes ?? 35;
  const gpsStaleMinutes = operationalSettings?.gpsStaleMinutes ?? 3;
  const gpsCriticalStaleMinutes = operationalSettings?.gpsCriticalStaleMinutes ?? 8;
  const overtimeBufferMinutes = operationalSettings?.treatmentOvertimeBufferMinutes ?? 15;

  bookings.forEach((booking) => {
    const isToday = booking.scheduleDate === todayStr;
    const isPaid = isPaymentPaid(booking.paymentStatus);
    const isTerminal = ['Completed', 'Cancelled'].includes(booking.status);

    if (isTerminal) {
      // Check early completion review
      if (booking.earlyCompletion && !acknowledgedAlertIds.has(`early_${booking.id}`)) {
        alerts.push({
          id: `early_${booking.id}`,
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          therapistId: booking.therapistId,
          therapistName: booking.therapistName,
          type: 'early_completion',
          priority: 'LOW',
          title: `Tinjau Selesai Lebih Awal (${booking.bookingCode})`,
          message: `Sesi ${booking.serviceName} selesai < 75% estimasi waktu normal. Mohon verifikasi kepuasan pelanggan.`,
          actionLabel: 'Lihat Detail',
          actionType: 'open_detail',
          status: 'open',
          createdAt: booking.completedAt || booking.updatedAt,
          updatedAt: booking.updatedAt,
        });
      }
      return;
    }

    // 1. Issue Reported by Therapist (Kendala Operasional)
    if (
      booking.issueReport &&
      (booking.issueReport as any).status !== 'resolved' &&
      !acknowledgedAlertIds.has(`issue_${booking.id}`)
    ) {
      alerts.push({
        id: `issue_${booking.id}`,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        therapistId: booking.therapistId,
        therapistName: booking.therapistName,
        type: 'issue_reported',
        priority: 'CRITICAL',
        title: `Kendala Lapangan: ${booking.issueReport.category} (${booking.bookingCode})`,
        message: `${booking.therapistName || 'Terapis'}: "${booking.issueReport.note}"`,
        actionLabel: 'Selesaikan Kendala',
        actionType: 'resolve_issue',
        status: 'open',
        createdAt: booking.issueReport.reportedAt,
        updatedAt: booking.issueReport.reportedAt,
      });
    }

    // 1b. Escalation from CSS (Eskalasi CSS ke Supervisor)
    if (
      booking.escalation &&
      booking.escalation.status !== 'resolved' &&
      !acknowledgedAlertIds.has(`css_esc_${booking.id}`)
    ) {
      alerts.push({
        id: `css_esc_${booking.id}`,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        therapistId: booking.therapistId,
        therapistName: booking.therapistName,
        type: 'css_escalation',
        priority: booking.escalation.priority || 'HIGH',
        title: `Eskalasi CSS: ${booking.escalation.category || 'Kendala Operasional'} (${booking.bookingCode})`,
        message: `${booking.escalation.escalatedByName || 'Tim CSS'}: "${booking.escalation.reason}"`,
        actionLabel: 'Tindaklanjuti',
        actionType: 'open_detail',
        status: 'open',
        createdAt: booking.escalation.escalatedAt,
        updatedAt: booking.escalation.escalatedAt,
      });
    }

    // Parse schedule date & time for time comparisons
    let scheduleMillis = 0;
    if (booking.scheduleDate && booking.scheduleTime) {
      const [hh, mm] = booking.scheduleTime.split(':').map((v) => parseInt(v, 10));
      const schedDate = new Date(`${booking.scheduleDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`);
      scheduleMillis = schedDate.getTime();
    }

    const minutesToSchedule = scheduleMillis ? Math.round((scheduleMillis - nowMillis) / 60000) : 999;

    // 2. Unassigned Paid Bookings
    if (!booking.therapistId && isPaid && !acknowledgedAlertIds.has(`unassigned_${booking.id}`)) {
      const isUrgent = isToday && minutesToSchedule <= unassignedAlertMinutes;
      alerts.push({
        id: `unassigned_${booking.id}`,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        type: 'unassigned_paid',
        priority: isUrgent ? 'CRITICAL' : 'HIGH',
        title: `Belum Ditugaskan: ${booking.bookingCode}`,
        message: `Pembayaran Lunas untuk jadwal ${booking.scheduleDate} ${booking.scheduleTime} WIB (${booking.customerName} - ${booking.area}). ${isUrgent ? `Waktu tersisa ${Math.max(0, minutesToSchedule)} menit!` : ''}`,
        actionLabel: 'Tugaskan Sekarang',
        actionType: 'assign',
        status: 'open',
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      });
    }

    // 3. Therapist Acceptance Delayed (> acceptanceWarningMinutes mins assigned, still not accepted)
    if (booking.status === 'Therapist Assigned' && booking.therapistId && !acknowledgedAlertIds.has(`accept_delay_${booking.id}`)) {
      const assignedTime = new Date(booking.updatedAt).getTime();
      const minsSinceAssigned = Math.round((nowMillis - assignedTime) / 60000);
      if (minsSinceAssigned >= acceptanceWarningMinutes) {
        alerts.push({
          id: `accept_delay_${booking.id}`,
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          therapistId: booking.therapistId,
          therapistName: booking.therapistName,
          type: 'acceptance_delayed',
          priority: minsSinceAssigned >= acceptanceTimeoutMinutes ? 'CRITICAL' : 'HIGH',
          title: `Terapis Belum Konfirmasi Terima (${booking.bookingCode})`,
          message: `${booking.therapistName} belum menerima tugas setelah ${minsSinceAssigned} menit (Batas SLA: ${acceptanceTimeoutMinutes} mnt). Pertimbangkan hubungi atau ganti terapis.`,
          actionLabel: 'Ganti Terapis',
          actionType: 'reassign',
          status: 'open',
          createdAt: booking.updatedAt,
          updatedAt: booking.updatedAt,
        });
      }
    }

    // 4. Late Departure Risk
    if (isToday && ['Confirmed', 'Therapist Assigned', 'Accepted'].includes(booking.status) && !acknowledgedAlertIds.has(`late_risk_${booking.id}`)) {
      if (minutesToSchedule <= lateDepartureBufferMinutes) {
        alerts.push({
          id: `late_risk_${booking.id}`,
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          therapistId: booking.therapistId,
          therapistName: booking.therapistName,
          type: 'late_risk',
          priority: 'CRITICAL',
          title: `Risiko Terlambat: ${booking.bookingCode}`,
          message: `Jadwal pukul ${booking.scheduleTime} WIB (${minutesToSchedule > 0 ? `${minutesToSchedule} mnt lagi` : 'Sudah terlewat'}). Terapis ${booking.therapistName || '(Belum Ada)'} belum berstatus On The Way.`,
          actionLabel: booking.therapistId ? 'Hubungi Terapis' : 'Tugaskan Cepat',
          actionType: booking.therapistId ? 'contact_therapist' : 'assign',
          status: 'open',
          createdAt: booking.updatedAt,
          updatedAt: booking.updatedAt,
        });
      }
    }

    // 5. GPS Stale for On The Way therapists (> gpsStaleMinutes without update)
    if (booking.status === 'On The Way' && booking.therapistId && !acknowledgedAlertIds.has(`gps_stale_${booking.id}`)) {
      const loc = activeLocations[booking.therapistId];
      if (!loc) {
        alerts.push({
          id: `gps_stale_${booking.id}`,
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          therapistId: booking.therapistId,
          therapistName: booking.therapistName,
          type: 'gps_stale',
          priority: 'HIGH',
          title: `GPS Terapis Tidak Aktif (${booking.therapistName})`,
          message: `Terapis berstatus Meluncur untuk order ${booking.bookingCode} namun sinyal GPS belum terdeteksi.`,
          actionLabel: 'Pantau Tracking',
          actionType: 'view_tracking',
          status: 'open',
          createdAt: booking.updatedAt,
          updatedAt: booking.updatedAt,
        });
      } else {
        const lastPingAgeMins = Math.round((nowMillis - (loc.updatedAtMillis || new Date(loc.timestamp).getTime())) / 60000);
        if (lastPingAgeMins >= gpsStaleMinutes) {
          alerts.push({
            id: `gps_stale_${booking.id}`,
            bookingId: booking.id,
            bookingCode: booking.bookingCode,
            therapistId: booking.therapistId,
            therapistName: booking.therapistName,
            type: 'gps_stale',
            priority: lastPingAgeMins >= gpsCriticalStaleMinutes ? 'CRITICAL' : 'HIGH',
            title: `GPS Stale: ${booking.therapistName} (${lastPingAgeMins} mnt lalu)`,
            message: `Pembaruan lokasi terakhir ${lastPingAgeMins} menit lalu untuk order ${booking.bookingCode} (Batas Normal: ${gpsStaleMinutes} mnt). Pastikan perangkat terapis online.`,
            actionLabel: 'Pantau Tracking',
            actionType: 'view_tracking',
            status: 'open',
            createdAt: loc.timestamp,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    // 6. Treatment Overtime (elapsed > serviceDuration + overtimeBufferMinutes)
    if (booking.status === 'Treatment' && booking.treatmentStartedAt && !acknowledgedAlertIds.has(`overtime_${booking.id}`)) {
      const startMillis = new Date(booking.treatmentStartedAt).getTime();
      const elapsedMins = Math.round((nowMillis - startMillis) / 60000);
      const plannedDuration = booking.serviceDuration || 90;
      if (elapsedMins >= plannedDuration + overtimeBufferMinutes) {
        alerts.push({
          id: `overtime_${booking.id}`,
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          therapistId: booking.therapistId,
          therapistName: booking.therapistName,
          type: 'overtime',
          priority: 'NORMAL',
          title: `Treatment Melewati Durasi (+${elapsedMins - plannedDuration} mnt)`,
          message: `Order ${booking.bookingCode} (${booking.serviceName}) berjalan selama ${elapsedMins} menit (estimasi normal: ${plannedDuration} mnt, toleransi: +${overtimeBufferMinutes} mnt).`,
          actionLabel: 'Lihat Detail',
          actionType: 'open_detail',
          status: 'open',
          createdAt: booking.treatmentStartedAt,
          updatedAt: booking.updatedAt,
        });
      }
    }
  });

  // Sort: CRITICAL first, then HIGH, then NORMAL, then LOW
  const priorityWeight: Record<OperationalAlert['priority'], number> = {
    CRITICAL: 4,
    HIGH: 3,
    NORMAL: 2,
    LOW: 1,
  };

  alerts.sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority]);

  return alerts;
}
