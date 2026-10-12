import { Booking, PaymentRecord, CustomerReview, OperationalAlert, OperationalSettings } from '../../types';
import { normalizeIndonesianPhone } from '../../lib/crmService';
import { formatRupiah } from '../../lib/utils';

export type WorkItemPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export type WorkItemCategory =
  | 'payment_proof_new'
  | 'payment_proof_reuploaded'
  | 'payment_rejected_pending'
  | 'unpaid_approaching_schedule'
  | 'customer_reschedule_request'
  | 'customer_address_request'
  | 'customer_cancel_request'
  | 'customer_unreachable'
  | 'therapist_issue_reported'
  | 'supervisor_escalation'
  | 'low_rating_recovery';

export interface CssWorkItem {
  id: string;
  bookingId: string;
  bookingCode: string;
  customerId: string;
  customerName: string;
  customerWhatsApp: string;
  area: string;
  category: WorkItemCategory;
  categoryLabel: string;
  priority: WorkItemPriority;
  title: string;
  description: string;
  scheduleDate: string;
  scheduleTime: string;
  scheduleAt: string;
  minutesToSchedule: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  bookingStatus: string;
  therapistName?: string;
  ownerId?: string;
  ownerName?: string;
  taskStatus: 'Open' | 'In Progress' | 'Waiting Customer' | 'Waiting Supervisor' | 'Resolved' | 'Closed';
  createdAt: string;
  lastUpdated: string;
  actionType:
    | 'verify_payment'
    | 'contact_customer'
    | 'process_reschedule'
    | 'update_address'
    | 'process_cancel'
    | 'supervisor_escalate'
    | 'open_detail';
  actionLabel: string;
  meta?: Record<string, any>;
}

/**
 * Calculates minutes from current time to a booking schedule in WIB (Asia/Jakarta)
 */
export function getMinutesToSchedule(scheduleDate: string, scheduleTime: string): number {
  if (!scheduleDate || !scheduleTime) return 9999;
  try {
    const [hh, mm] = scheduleTime.split(':').map((v) => parseInt(v, 10));
    // Parse in WIB (UTC+7)
    const schedDate = new Date(`${scheduleDate}T${String(hh || 0).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00+07:00`);
    const now = new Date();
    return Math.round((schedDate.getTime() - now.getTime()) / 60000);
  } catch {
    return 9999;
  }
}

/**
 * Computes all actionable work items for the CSS operational workspace
 */
export function computeCssWorkQueue(
  bookings: Booking[] = [],
  payments: PaymentRecord[] = [],
  lowRatingReviews: CustomerReview[] = [],
  operationalSettings?: Partial<OperationalSettings>
): CssWorkItem[] {
  const items: CssWorkItem[] = [];
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const paymentVerificationSlaMinutes = operationalSettings?.paymentVerificationSlaMinutes ?? 120;
  const paymentUrgentSlaMinutes = operationalSettings?.paymentUrgentSlaMinutes ?? 30;
  const maxUnreachableAttempts = operationalSettings?.maxUnreachableAttempts ?? 3;
  const lowRatingThreshold = operationalSettings?.lowRatingThreshold ?? 2;

  // Map payments by bookingId
  const paymentByBookingId = new Map<string, PaymentRecord>();
  (payments || []).forEach((p) => {
    paymentByBookingId.set(p.bookingId, p);
  });

  // 1. Scan Bookings
  (bookings || []).forEach((b) => {
    const isTerminal = ['Completed', 'Cancelled'].includes(b.status);
    const isToday = b.scheduleDate === todayStr;
    const minsToSchedule = getMinutesToSchedule(b.scheduleDate, b.scheduleTime);
    const payment = paymentByBookingId.get(b.id);

    // Skip completed bookings unless there is an unresolved escalation or issue
    if (isTerminal && !b.escalation && !b.issueReport) {
      return;
    }

    // A. Customer Requested Reschedule
    if (b.customerRequest && b.customerRequest.type === 'reschedule' && b.customerRequest.status === 'pending') {
      items.push({
        id: `req_resched_${b.id}`,
        bookingId: b.id,
        bookingCode: b.bookingCode,
        customerId: b.customerId,
        customerName: b.customerName,
        customerWhatsApp: b.customerWhatsApp,
        area: b.area,
        category: 'customer_reschedule_request',
        categoryLabel: 'Permintaan Reschedule',
        priority: minsToSchedule <= 120 ? 'CRITICAL' : 'HIGH',
        title: `Pelanggan Meminta Ubah Jadwal (${b.bookingCode})`,
        description: b.customerRequest.details || 'Pelanggan meminta perubahan waktu/tanggal reservasi.',
        scheduleDate: b.scheduleDate,
        scheduleTime: b.scheduleTime,
        scheduleAt: b.scheduleAt,
        minutesToSchedule: minsToSchedule,
        totalAmount: b.totalAmount,
        paymentMethod: b.paymentMethod,
        paymentStatus: b.paymentStatus,
        bookingStatus: b.status,
        therapistName: b.therapistName,
        ownerId: b.cssOwnerId,
        ownerName: b.cssOwnerName,
        taskStatus: b.taskStatus || 'Open',
        createdAt: b.customerRequest.requestedAt || b.updatedAt,
        lastUpdated: b.updatedAt,
        actionType: 'process_reschedule',
        actionLabel: 'Proses Reschedule',
      });
    }

    // B. Customer Requested Address Change
    if (b.customerRequest && b.customerRequest.type === 'address_change' && b.customerRequest.status === 'pending') {
      const isUrgent = b.status === 'On The Way' || (isToday && minsToSchedule <= 90);
      items.push({
        id: `req_addr_${b.id}`,
        bookingId: b.id,
        bookingCode: b.bookingCode,
        customerId: b.customerId,
        customerName: b.customerName,
        customerWhatsApp: b.customerWhatsApp,
        area: b.area,
        category: 'customer_address_request',
        categoryLabel: 'Perubahan Alamat',
        priority: isUrgent ? 'CRITICAL' : 'HIGH',
        title: `Pelanggan Meminta Perubahan Alamat (${b.bookingCode})`,
        description: b.customerRequest.details || 'Pelanggan menginformasikan alamat baru atau patokan tambahan.',
        scheduleDate: b.scheduleDate,
        scheduleTime: b.scheduleTime,
        scheduleAt: b.scheduleAt,
        minutesToSchedule: minsToSchedule,
        totalAmount: b.totalAmount,
        paymentMethod: b.paymentMethod,
        paymentStatus: b.paymentStatus,
        bookingStatus: b.status,
        therapistName: b.therapistName,
        ownerId: b.cssOwnerId,
        ownerName: b.cssOwnerName,
        taskStatus: b.taskStatus || 'Open',
        createdAt: b.customerRequest.requestedAt || b.updatedAt,
        lastUpdated: b.updatedAt,
        actionType: 'update_address',
        actionLabel: 'Update Alamat',
      });
    }

    // C. Customer Requested Cancellation
    if (b.customerRequest && b.customerRequest.type === 'cancellation' && b.customerRequest.status === 'pending') {
      items.push({
        id: `req_cancel_${b.id}`,
        bookingId: b.id,
        bookingCode: b.bookingCode,
        customerId: b.customerId,
        customerName: b.customerName,
        customerWhatsApp: b.customerWhatsApp,
        area: b.area,
        category: 'customer_cancel_request',
        categoryLabel: 'Permintaan Batal',
        priority: 'HIGH',
        title: `Pelanggan Meminta Pembatalan (${b.bookingCode})`,
        description: b.customerRequest.details || 'Pelanggan meminta pesanan dibatalkan.',
        scheduleDate: b.scheduleDate,
        scheduleTime: b.scheduleTime,
        scheduleAt: b.scheduleAt,
        minutesToSchedule: minsToSchedule,
        totalAmount: b.totalAmount,
        paymentMethod: b.paymentMethod,
        paymentStatus: b.paymentStatus,
        bookingStatus: b.status,
        therapistName: b.therapistName,
        ownerId: b.cssOwnerId,
        ownerName: b.cssOwnerName,
        taskStatus: b.taskStatus || 'Open',
        createdAt: b.customerRequest.requestedAt || b.updatedAt,
        lastUpdated: b.updatedAt,
        actionType: 'process_cancel',
        actionLabel: 'Proses Pembatalan',
      });
    }

    // D. Unpaid & Approaching Schedule (< paymentVerificationSlaMinutes or < paymentUrgentSlaMinutes)
    const isUnpaid = b.paymentStatus === 'unpaid' || b.paymentStatus === 'UNPAID';
    if (!isTerminal && isUnpaid && b.status === 'Menunggu Pembayaran') {
      if (minsToSchedule <= paymentVerificationSlaMinutes && minsToSchedule > -60) {
        const isCritical = minsToSchedule <= paymentUrgentSlaMinutes;
        items.push({
          id: `unpaid_near_${b.id}`,
          bookingId: b.id,
          bookingCode: b.bookingCode,
          customerId: b.customerId,
          customerName: b.customerName,
          customerWhatsApp: b.customerWhatsApp,
          area: b.area,
          category: 'unpaid_approaching_schedule',
          categoryLabel: isCritical ? 'Segera Expired' : 'Mendekati Jadwal',
          priority: isCritical ? 'CRITICAL' : 'HIGH',
          title: `Belum Dibayar: ${b.bookingCode} (${minsToSchedule > 0 ? `${minsToSchedule} mnt lagi` : 'Jadwal lewat'})`,
          description: `Reservasi ${b.customerName} (${formatRupiah(b.totalAmount)}) belum dibayar. Perlu follow up konfirmasi kesiapan transfer atau batalkan agar slot terapis bebas.`,
          scheduleDate: b.scheduleDate,
          scheduleTime: b.scheduleTime,
          scheduleAt: b.scheduleAt,
          minutesToSchedule: minsToSchedule,
          totalAmount: b.totalAmount,
          paymentMethod: b.paymentMethod,
          paymentStatus: b.paymentStatus,
          bookingStatus: b.status,
          therapistName: b.therapistName,
          ownerId: b.cssOwnerId,
          ownerName: b.cssOwnerName,
          taskStatus: b.taskStatus || 'Open',
          createdAt: b.createdAt,
          lastUpdated: b.updatedAt,
          actionType: 'contact_customer',
          actionLabel: 'Hubungi Customer',
        });
      }
    }

    // E. Customer Unreachable Follow-up
    if ((b.unreachableCount || 0) > 0 && !isTerminal) {
      const isUnreachableMax = (b.unreachableCount || 0) >= maxUnreachableAttempts;
      items.push({
        id: `unreach_${b.id}`,
        bookingId: b.id,
        bookingCode: b.bookingCode,
        customerId: b.customerId,
        customerName: b.customerName,
        customerWhatsApp: b.customerWhatsApp,
        area: b.area,
        category: 'customer_unreachable',
        categoryLabel: `Tidak Merespon (#${b.unreachableCount})`,
        priority: minsToSchedule <= 60 || isUnreachableMax ? 'CRITICAL' : 'NORMAL',
        title: `Customer Tidak Merespon: ${b.customerName} (${b.bookingCode})`,
        description: `Percobaan kontak terakhir: ${b.lastContactAttemptAt ? new Date(b.lastContactAttemptAt).toLocaleTimeString('id-ID') : '-'}. Sudah ${b.unreachableCount}x dicoba.`,
        scheduleDate: b.scheduleDate,
        scheduleTime: b.scheduleTime,
        scheduleAt: b.scheduleAt,
        minutesToSchedule: minsToSchedule,
        totalAmount: b.totalAmount,
        paymentMethod: b.paymentMethod,
        paymentStatus: b.paymentStatus,
        bookingStatus: b.status,
        therapistName: b.therapistName,
        ownerId: b.cssOwnerId,
        ownerName: b.cssOwnerName,
        taskStatus: b.taskStatus || 'Waiting Customer',
        createdAt: b.lastContactAttemptAt || b.updatedAt,
        lastUpdated: b.updatedAt,
        actionType: 'contact_customer',
        actionLabel: 'Coba Hubungi Lagi',
      });
    }

    // F. Therapist Reported Field Issue (Kendala Lapangan dari Terapis)
    if (b.issueReport && (b.issueReport as any).status !== 'resolved') {
      items.push({
        id: `th_issue_${b.id}`,
        bookingId: b.id,
        bookingCode: b.bookingCode,
        customerId: b.customerId,
        customerName: b.customerName,
        customerWhatsApp: b.customerWhatsApp,
        area: b.area,
        category: 'therapist_issue_reported',
        categoryLabel: 'Kendala Lapangan',
        priority: 'CRITICAL',
        title: `Laporan Terapis: ${b.issueReport.category} (${b.bookingCode})`,
        description: `Terapis ${b.therapistName || ''} melaporkan: "${b.issueReport.note}". CSS bantu koordinasi pelanggan.`,
        scheduleDate: b.scheduleDate,
        scheduleTime: b.scheduleTime,
        scheduleAt: b.scheduleAt,
        minutesToSchedule: minsToSchedule,
        totalAmount: b.totalAmount,
        paymentMethod: b.paymentMethod,
        paymentStatus: b.paymentStatus,
        bookingStatus: b.status,
        therapistName: b.therapistName,
        ownerId: b.cssOwnerId,
        ownerName: b.cssOwnerName,
        taskStatus: b.taskStatus || 'Open',
        createdAt: b.issueReport.reportedAt,
        lastUpdated: b.issueReport.reportedAt,
        actionType: 'contact_customer',
        actionLabel: 'Bantu Terapis & Kontak',
      });
    }

    // G. Active Supervisor Escalation
    if (b.escalation && b.escalation.status !== 'resolved') {
      items.push({
        id: `esc_${b.id}`,
        bookingId: b.id,
        bookingCode: b.bookingCode,
        customerId: b.customerId,
        customerName: b.customerName,
        customerWhatsApp: b.customerWhatsApp,
        area: b.area,
        category: 'supervisor_escalation',
        categoryLabel: 'Eskalasi Supervisor',
        priority: b.escalation.priority || 'HIGH',
        title: `Eskalasi [${b.escalation.status.toUpperCase()}]: ${b.escalation.category} (${b.bookingCode})`,
        description: `Dieskalasi oleh ${b.escalation.escalatedByName}: "${b.escalation.reason}". ${b.escalation.resolutionNote ? `Update: ${b.escalation.resolutionNote}` : 'Menunggu tindakan Supervisor.'}`,
        scheduleDate: b.scheduleDate,
        scheduleTime: b.scheduleTime,
        scheduleAt: b.scheduleAt,
        minutesToSchedule: minsToSchedule,
        totalAmount: b.totalAmount,
        paymentMethod: b.paymentMethod,
        paymentStatus: b.paymentStatus,
        bookingStatus: b.status,
        therapistName: b.therapistName,
        ownerId: b.cssOwnerId,
        ownerName: b.cssOwnerName,
        taskStatus: b.taskStatus || 'Waiting Supervisor',
        createdAt: b.escalation.escalatedAt,
        lastUpdated: b.updatedAt,
        actionType: 'open_detail',
        actionLabel: 'Pantau Eskalasi',
      });
    }
  });

  // 2. Scan Payments for verification items
  payments.forEach((p) => {
    const booking = bookings.find((b) => b.id === p.bookingId || b.bookingCode === p.bookingCode);
    const minsToSchedule = booking ? getMinutesToSchedule(booking.scheduleDate, booking.scheduleTime) : 999;

    // A. Pending Manual Verification (Bukti Baru / Upload Ulang)
    if (p.status === 'pending_manual_verification') {
      const isReupload = !!p.rejectedAt;
      const isNear = minsToSchedule <= 120;

      items.push({
        id: `pay_verify_${p.id}`,
        bookingId: p.bookingId,
        bookingCode: p.bookingCode,
        customerId: p.customerId,
        customerName: p.customerName,
        customerWhatsApp: p.customerWhatsApp,
        area: booking?.area || '-',
        category: isReupload ? 'payment_proof_reuploaded' : 'payment_proof_new',
        categoryLabel: isReupload ? 'Bukti Upload Ulang' : 'Bukti Baru',
        priority: isNear ? 'CRITICAL' : isReupload ? 'HIGH' : 'HIGH',
        title: `${isReupload ? 'Bukti Pembayaran Diunggah Ulang' : 'Bukti Pembayaran Perlu Dicek'}: ${p.bookingCode}`,
        description: `Customer ${p.customerName} mengunggah bukti ${p.paymentMethod} sebesar ${formatRupiah(p.amount)}. ${isReupload ? `(Sebelumnya ditolak: ${p.rejectionReason})` : ''}`,
        scheduleDate: booking?.scheduleDate || '',
        scheduleTime: booking?.scheduleTime || '',
        scheduleAt: booking?.scheduleAt || '',
        minutesToSchedule: minsToSchedule,
        totalAmount: p.amount,
        paymentMethod: p.paymentMethod,
        paymentStatus: p.status,
        bookingStatus: booking?.status || 'Menunggu Pembayaran',
        therapistName: booking?.therapistName,
        ownerId: booking?.cssOwnerId,
        ownerName: booking?.cssOwnerName,
        taskStatus: booking?.taskStatus || 'Open',
        createdAt: p.paymentProofUploadedAt || p.updatedAt,
        lastUpdated: p.updatedAt,
        actionType: 'verify_payment',
        actionLabel: 'Verifikasi Bukti',
        meta: { paymentId: p.id },
      });
    }

    // B. Rejected Payment yet to be followed up
    if (p.status === 'payment_rejected' && !p.paymentProofUploadedAt) {
      // Payment rejected, customer has not re-uploaded
      const isNear = minsToSchedule <= paymentVerificationSlaMinutes;
      items.push({
        id: `pay_rej_${p.id}`,
        bookingId: p.bookingId,
        bookingCode: p.bookingCode,
        customerId: p.customerId,
        customerName: p.customerName,
        customerWhatsApp: p.customerWhatsApp,
        area: booking?.area || '-',
        category: 'payment_rejected_pending',
        categoryLabel: 'Pembayaran Ditolak',
        priority: isNear ? 'CRITICAL' : 'NORMAL',
        title: `Pembayaran Ditolak Belum Upload Bukti Baru: ${p.bookingCode}`,
        description: `Alasan tolak: "${p.rejectionReason}". Pelanggan ${p.customerName} belum mengunggah perbaikan bukti transfer.`,
        scheduleDate: booking?.scheduleDate || '',
        scheduleTime: booking?.scheduleTime || '',
        scheduleAt: booking?.scheduleAt || '',
        minutesToSchedule: minsToSchedule,
        totalAmount: p.amount,
        paymentMethod: p.paymentMethod,
        paymentStatus: p.status,
        bookingStatus: booking?.status || 'Menunggu Pembayaran',
        therapistName: booking?.therapistName,
        ownerId: booking?.cssOwnerId,
        ownerName: booking?.cssOwnerName,
        taskStatus: booking?.taskStatus || 'Waiting Customer',
        createdAt: p.rejectedAt || p.updatedAt,
        lastUpdated: p.updatedAt,
        actionType: 'contact_customer',
        actionLabel: 'Follow-up Customer',
        meta: { paymentId: p.id },
      });
    }
  });

  // 3. Scan Low Rating Reviews for Service Recovery (<= lowRatingThreshold stars)
  lowRatingReviews
    .filter((rev) => (rev.overallRating || 5) <= lowRatingThreshold)
    .forEach((rev) => {
      if (rev.serviceRecoveryStatus !== 'resolved' && rev.serviceRecoveryStatus !== 'closed') {
      const booking = bookings.find((b) => b.id === rev.bookingId || b.bookingCode === rev.bookingCode);
      items.push({
        id: `review_low_${rev.id}`,
        bookingId: rev.bookingId,
        bookingCode: rev.bookingCode,
        customerId: rev.customerId,
        customerName: rev.customerName,
        customerWhatsApp: booking?.customerWhatsApp || '',
        area: booking?.area || '-',
        category: 'low_rating_recovery',
        categoryLabel: `Rating Rendah (${rev.overallRating}★)`,
        priority: rev.overallRating === 1 ? 'HIGH' : 'NORMAL',
        title: `Service Recovery: Ulasan ${rev.overallRating} Bintang (${rev.bookingCode})`,
        description: `Pelanggan: "${rev.comment}". Perlu dihubungi oleh CSS untuk mendengar masukan & pemulihan kepuasan.`,
        scheduleDate: booking?.scheduleDate || '',
        scheduleTime: booking?.scheduleTime || '',
        scheduleAt: booking?.scheduleAt || '',
        minutesToSchedule: 9999,
        totalAmount: booking?.totalAmount || 0,
        paymentMethod: booking?.paymentMethod || 'Transfer',
        paymentStatus: 'paid',
        bookingStatus: 'Completed',
        therapistName: rev.therapistName || booking?.therapistName,
        ownerId: booking?.cssOwnerId,
        ownerName: booking?.cssOwnerName,
        taskStatus: rev.serviceRecoveryStatus === 'contacted' ? 'In Progress' : 'Open',
        createdAt: rev.createdAt,
        lastUpdated: rev.createdAt,
        actionType: 'contact_customer',
        actionLabel: 'Sapa & Pulihkan Kepuasan',
        meta: { reviewId: rev.id },
      });
    }
  });

  // Sort logic:
  // 1. Priority: CRITICAL (4) > HIGH (3) > NORMAL (2) > LOW (1)
  // 2. Schedule proximity: smallest minutesToSchedule (closest first)
  // 3. Oldest unresolved item (createdAt ascending)
  const priorityWeight: Record<WorkItemPriority, number> = {
    CRITICAL: 4,
    HIGH: 3,
    NORMAL: 2,
    LOW: 1,
  };

  items.sort((a, b) => {
    const pDiff = priorityWeight[b.priority] - priorityWeight[a.priority];
    if (pDiff !== 0) return pDiff;

    // Both have upcoming schedule
    if (a.minutesToSchedule < 1440 && b.minutesToSchedule < 1440) {
      return a.minutesToSchedule - b.minutesToSchedule;
    }

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return items;
}

/**
 * Standard CSS WhatsApp Message Templates (Pre-configured with real data)
 */
export function generateWhatsAppMessage(
  templateKey:
    | 'confirm_payment_details'
    | 'remind_payment_urgent'
    | 'payment_verified'
    | 'payment_rejected'
    | 'reschedule_confirmation'
    | 'address_clarification'
    | 'therapist_on_the_way'
    | 'cancellation_confirmation'
    | 'low_rating_service_recovery',
  booking: Booking,
  extraParams?: {
    rejectionReason?: string;
    newDate?: string;
    newTime?: string;
    reviewComment?: string;
  }
): string {
  const customerName = booking.customerName || 'Pelanggan';
  const bookingCode = booking.bookingCode;
  const serviceName = booking.serviceName;
  const scheduleDate = booking.scheduleDate;
  const scheduleTime = booking.scheduleTime;
  const totalRupiah = formatRupiah(booking.totalAmount);
  const address = booking.address;

  switch (templateKey) {
    case 'confirm_payment_details':
      return `Halo Kak ${customerName}, terima kasih telah memesan layanan Senzu Home Service. 💆‍♀️✨

Berikut detail reservasi Anda:
• Kode Booking: *${bookingCode}*
• Layanan: *${serviceName}* (${booking.serviceDuration} Menit)
• Jadwal: *${scheduleDate}* pukul *${scheduleTime} WIB*
• Alamat: *${address}*
• Total Pembayaran: *${totalRupiah}*

Untuk pembayaran, silakan transfer ke rekening resmi Senzu (PT KSBONE UNTUK KITA):
- BNI: *7009999772*
- Mandiri: *1120025626768*
- BRI: *005901003894560*
- Atau via QRIS resmi Senzu

Setelah transfer, mohon upload bukti pembayaran melalui link pelacakan atau kirimkan via WhatsApp ini. Terima kasih! 🙏`;

    case 'remind_payment_urgent':
      return `Halo Kak ${customerName}, kami mengingatkan kembali untuk reservasi Senzu Home:
• Kode Booking: *${bookingCode}*
• Jadwal: *${scheduleDate}* pukul *${scheduleTime} WIB* (Mendekati jadwal)
• Total: *${totalRupiah}*

Agar terapis terbaik kami dapat segera dipersiapkan dan meluncur tepat waktu, mohon selesaikan pembayaran dan kirimkan bukti transfer. 
Bila ada kendala jadwal, mohon kabari kami ya Kak. Terima kasih! 🙏`;

    case 'payment_verified':
      return `Halo Kak ${customerName}, pembayaran untuk reservasi *${bookingCode}* (${serviceName}) sebesar *${totalRupiah}* telah berhasil DIVERIFIKASI! ✅

Jadwal Anda telah *TERKONFIRMASI*:
📅 Tanggal: *${scheduleDate}*
⏰ Pukul: *${scheduleTime} WIB*
📍 Alamat: *${address}*

Supervisor kami sedang mempersiapkan terapis profesional untuk kunjungan ini. Anda dapat memantau status pesanan secara realtime melalui link pelacakan Senzu. Terima kasih! ✨`;

    case 'payment_rejected':
      return `Halo Kak ${customerName}, mohon maaf bukti pembayaran untuk booking *${bookingCode}* belum dapat kami verifikasi karena:
⚠️ *${extraParams?.rejectionReason || 'Nominal tidak sesuai / bukti belum terbaca jelas'}*

Mohon periksa kembali mutasi rekening atau kirimkan bukti transfer yang valid agar pesanan Anda dapat segera kami konfirmasi. Tim kami siap membantu Kak. Terima kasih! 🙏`;

    case 'reschedule_confirmation':
      return `Halo Kak ${customerName}, jadwal reservasi Senzu Home dengan kode *${bookingCode}* telah berhasil DIUBAH menjadi:
📅 Tanggal Baru: *${extraParams?.newDate || scheduleDate}*
⏰ Waktu Baru: *${extraParams?.newTime || scheduleTime} WIB*
📍 Alamat: *${address}*

Terapis kami akan hadir sesuai jadwal baru ini. Sampai jumpa dan selamat menikmati treatment dari Senzu Home! 💆‍♀️`;

    case 'address_clarification':
      return `Halo Kak ${customerName}, sehubungan dengan reservasi Senzu Home *${bookingCode}* untuk jadwal ${scheduleDate} ${scheduleTime} WIB:

Bolehkah kami meminta konfirmasi patokan lokasi / nomor rumah lebih spesifik agar terapis kami dapat tiba di lokasi dengan lancar dan tepat waktu?
Alamat terdaftar: *${address}*

Terima kasih atas bantuannya Kak! 🙏`;

    case 'therapist_on_the_way':
      return `Halo Kak ${customerName}, kabar baik! Terapis Senzu *${booking.therapistName || ''}* saat ini SEDANG DALAM PERJALANAN menuju lokasi Anda 🛵💨.

Estimasi tiba mendekati pukul *${scheduleTime} WIB*.
Mohon pastikan ruangan siap dan nomor kontak dapat dihubungi. Anda juga dapat memantau posisi GPS terapis secara live di aplikasi Senzu. Terima kasih! ✨`;

    case 'cancellation_confirmation':
      return `Halo Kak ${customerName}, reservasi Senzu Home dengan kode *${bookingCode}* telah RESMI DIBATALKAN.

Bila Anda sudah melakukan pembayaran, tim kami akan segera memproses penyesuaian/pengembalian sesuai ketentuan yang berlaku. Terima kasih telah menghubungi Senzu, semoga kami dapat melayani Anda di kesempatan berikutnya. 🙏`;

    case 'low_rating_service_recovery':
      return `Halo Kak ${customerName}, kami dari Manajemen & Layanan Pelanggan Senzu Home Service. 

Kami membaca ulasan Kakak pada pemesanan *${bookingCode}* dan memohon maaf yang sebesar-besarnya bila pengalaman treatment kemarin belum memenuhi ekspektasi Kakak. 😔

Kenyamanan dan kepuasan Kakak adalah prioritas utama kami. Bolehkah kami mendengar lebih lanjut kendala yang Kakak alami agar kami dapat segera melakukan perbaikan dan memberikan solusi terbaik untuk Kakak? Terima kasih banyak Kak. 🙏`;

    default:
      return `Halo Kak ${customerName}, kami dari Customer Service Senzu Home Service mengenai pemesanan *${bookingCode}*. Ada yang bisa kami bantu? 🙏`;
  }
}

/**
 * Generates direct wa.me URL
 */
export function getWhatsAppDeepLink(phone: string, text: string): string {
  const { cleanDigits } = normalizeIndonesianPhone(phone);
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${cleanDigits}?text=${encodedText}`;
}
