import type { NotificationRecipientRole, NotificationPriority, NotificationEventType, AdminNotificationSettings } from '../types/notification.ts';
export interface TargetResolution {
  recipientRole: NotificationRecipientRole;
  recipientUserId?: string;
  therapistId?: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  actionUrl: string;
}

export function resolveNotificationTargets(
  eventType: NotificationEventType,
  p: Record<string, any>,
  settings: AdminNotificationSettings
): TargetResolution[] {
  const code = p.bookingCode || 'BOOKING';
  const customerName = p.customerName || 'Pelanggan';
  const therapistName = p.therapistName || 'Terapis Senzu';
  const serviceName = p.serviceName || 'Refleksi & Massage';
  const scheduleAt = p.scheduleAt || p.scheduleDate || 'Jadwal Pesanan';
  const bookingId = p.bookingId || '';

  const targets: TargetResolution[] = [];

  switch (eventType) {
    case 'booking.created':
      if (settings.bookingCreatedAlert) {
        // Notify Customer Service
        targets.push({
          recipientRole: 'css',
          title: 'Booking Baru Diterima',
          message: `Order #${code} dari ${customerName} (${serviceName}) menunggu verifikasi pembayaran.`,
          priority: 'HIGH',
          actionUrl: `/css?booking=${code}`,
        });
        // Notify Manager / Management (operational visibility)
        targets.push({
          recipientRole: 'manager',
          title: 'Booking Baru Diterima',
          message: `Order #${code} dari ${customerName} (${serviceName}) masuk ke sistem. Menunggu verifikasi pembayaran.`,
          priority: 'HIGH',
          actionUrl: `/reconciliation?booking=${code}`,
        });
        // Notify Customer
        targets.push({
          recipientRole: 'customer',
          recipientUserId: p.customerId,
          title: 'Reservasi Senzu Home Diterima',
          message: `Pesanan #${code} (${serviceName}) berhasil dibuat. Silakan lakukan pembayaran agar dapat diproses.`,
          priority: 'NORMAL',
          actionUrl: `/track/${code}`,
        });
      }
      break;

    case 'payment.proof_uploaded':
      if (settings.paymentAlert) {
        targets.push({
          recipientRole: 'css',
          title: 'Bukti Pembayaran Diunggah',
          message: `Customer ${customerName} mengunggah bukti bayar untuk pesanan #${code}. Siap diverifikasi.`,
          priority: 'HIGH',
          actionUrl: `/reconciliation?booking=${code}`,
        });
        targets.push({
          recipientRole: 'manager',
          title: 'Bukti Pembayaran Diunggah',
          message: `Customer ${customerName} mengunggah bukti bayar untuk pesanan #${code}. Siap diverifikasi.`,
          priority: 'NORMAL',
          actionUrl: `/reconciliation?booking=${code}`,
        });
        targets.push({
          recipientRole: 'customer',
          recipientUserId: p.customerId,
          title: 'Bukti Pembayaran Diterima',
          message: `Bukti transfer Anda untuk pesanan #${code} sedang diverifikasi oleh staf CSS kami.`,
          priority: 'NORMAL',
          actionUrl: `/track/${code}`,
        });
      }
      break;

    case 'payment.verified':
      if (settings.paymentAlert) {
        targets.push({
          recipientRole: 'supervisor',
          title: 'Pembayaran Lunas — Siap Ditugaskan',
          message: `Order #${code} (${customerName}, ${serviceName}) lunas. Silakan tugaskan terapis.`,
          priority: 'HIGH',
          actionUrl: `/supervisor?booking=${code}`,
        });
        targets.push({
          recipientRole: 'manager',
          title: 'Pembayaran Terverifikasi Lunas',
          message: `Order #${code} (${customerName}, ${serviceName}) lunas terverifikasi.`,
          priority: 'NORMAL',
          actionUrl: `/reconciliation?booking=${code}`,
        });
        targets.push({
          recipientRole: 'customer',
          recipientUserId: p.customerId,
          title: 'Pembayaran Terverifikasi Lunas',
          message: `Pembayaran pesanan #${code} telah terverifikasi. Tim Senzu segera menugaskan terapis profesional.`,
          priority: 'HIGH',
          actionUrl: `/track/${code}`,
        });
      }
      break;

    case 'payment.rejected':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Bukti Pembayaran Ditolak',
        message: `Bukti pembayaran untuk #${code} belum sesuai: ${p.rejectionReason || 'Nominal tidak cocok'}. Silakan unggah ulang.`,
        priority: 'HIGH',
        actionUrl: `/track/${code}`,
      });
      targets.push({
        recipientRole: 'css',
        title: 'Pembayaran Ditolak',
        message: `Order #${code} (${customerName}) ditolak verifikasinya.`,
        priority: 'NORMAL',
        actionUrl: `/reconciliation?booking=${code}`,
      });
      break;

    case 'payment.expired':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Waktu Pembayaran Berakhir',
        message: `Batas waktu pembayaran pesanan #${code} telah berakhir. Silakan lakukan pemesanan kembali atau hubungi Customer Service jika memerlukan bantuan.`,
        priority: 'NORMAL',
        actionUrl: `/track/${code}`,
      });
      break;

    case 'booking.ready_for_assignment':
      if (settings.supervisorAlert) {
        targets.push({
          recipientRole: 'supervisor',
          title: 'Order Siap Ditugaskan',
          message: `Order #${code} untuk ${scheduleAt} di ${p.area || 'Palembang'} siap dialokasikan ke terapis.`,
          priority: 'HIGH',
          actionUrl: `/supervisor?booking=${code}`,
        });
      }
      break;

    case 'therapist.assigned':
      // Notify Assigned Therapist
      if (p.therapistId) {
        targets.push({
          recipientRole: 'therapist',
          recipientUserId: p.therapistId,
          therapistId: p.therapistId,
          title: 'Tugas Treatment Baru Ditugaskan',
          message: `Anda mendapat tugas baru #${code} (${customerName}, ${serviceName}) jadwal ${scheduleAt}. Segera konfirmasi.`,
          priority: 'CRITICAL',
          actionUrl: `/therapist?booking=${code}`,
        });
      }
      // Notify Customer
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Terapis Senzu Telah Ditugaskan',
        message: `Terapis ${therapistName} telah ditugaskan untuk reservasi #${code}. Bersiap menyambut relaksasi Anda.`,
        priority: 'NORMAL',
        actionUrl: `/track/${code}`,
      });
      break;

    case 'therapist.reassigned':
      if (p.therapistId) {
        targets.push({
          recipientRole: 'therapist',
          recipientUserId: p.therapistId,
          therapistId: p.therapistId,
          title: 'Tugas Treatment Dialihkan',
          message: `Anda ditugaskan menggantikan order #${code} (${customerName}, ${serviceName}).`,
          priority: 'HIGH',
          actionUrl: `/therapist?booking=${code}`,
        });
      }
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Pembaruan Terapis',
        message: `Terapis untuk reservasi #${code} telah diperbarui menjadi ${therapistName}.`,
        priority: 'NORMAL',
        actionUrl: `/track/${code}`,
      });
      break;

    case 'therapist.accepted':
      targets.push({
        recipientRole: 'supervisor',
        title: 'Terapis Menerima Tugas',
        message: `${therapistName} telah mengonfirmasi penerimaan tugas order #${code}.`,
        priority: 'NORMAL',
        actionUrl: `/supervisor?booking=${code}`,
      });
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Terapis Mengonfirmasi Pesanan',
        message: `Terapis ${therapistName} telah mengonfirmasi kesiapannya melayani Anda.`,
        priority: 'NORMAL',
        actionUrl: `/track/${code}`,
      });
      break;

    case 'therapist.on_the_way':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Terapis Dalam Perjalanan',
        message: `Terapis ${therapistName} sedang menuju ke lokasi Anda 🛵. Anda dapat melacak posisi terapis di peta.`,
        priority: 'HIGH',
        actionUrl: `/track/${code}`,
      });
      targets.push({
        recipientRole: 'supervisor',
        title: 'Terapis Menuju Lokasi (OTW)',
        message: `${therapistName} berangkat menuju lokasi order #${code}.`,
        priority: 'LOW',
        actionUrl: `/supervisor?booking=${code}`,
      });
      break;

    case 'therapist.nearby':
      if (settings.nearbyNotification) {
        targets.push({
          recipientRole: 'customer',
          recipientUserId: p.customerId,
          title: 'Terapis Hampir Sampai (±1 km)',
          message: `Terapis ${therapistName} sudah mendekati lokasi Anda. Mohon siapkan tempat treatment.`,
          priority: 'HIGH',
          actionUrl: `/track/${code}`,
        });
      }
      break;

    case 'therapist.arrived':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Terapis Telah Tiba di Lokasi 📍',
        message: `Terapis ${therapistName} telah sampai di alamat Anda. Mohon membukakan pintu atau menyambut terapis.`,
        priority: 'HIGH',
        actionUrl: `/track/${code}`,
      });
      targets.push({
        recipientRole: 'supervisor',
        title: 'Terapis Telah Sampai (Arrived)',
        message: `${therapistName} telah tiba di lokasi customer untuk order #${code}.`,
        priority: 'NORMAL',
        actionUrl: `/supervisor?booking=${code}`,
      });
      break;

    case 'treatment.started':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Sesi Treatment Dimulai ✨',
        message: `Sesi ${serviceName} bersama terapis ${therapistName} telah dimulai. Selamat menikmati relaksasi Senzu.`,
        priority: 'LOW',
        actionUrl: `/track/${code}`,
      });
      targets.push({
        recipientRole: 'supervisor',
        title: 'Treatment Dimulai (In-Treatment)',
        message: `${therapistName} memulai sesi treatment order #${code}.`,
        priority: 'LOW',
        actionUrl: `/supervisor?booking=${code}`,
      });
      break;

    case 'treatment.completed':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Sesi Treatment Selesai ✨',
        message: `Terima kasih telah mempercayakan kenyamanan spa & pijat Anda kepada Senzu Home Palembang.`,
        priority: 'NORMAL',
        actionUrl: `/track/${code}`,
      });
      targets.push({
        recipientRole: 'supervisor',
        title: 'Order Treatment Selesai',
        message: `Order #${code} telah diselesaikan oleh ${therapistName}.`,
        priority: 'NORMAL',
        actionUrl: `/supervisor?booking=${code}`,
      });
      break;

    case 'booking.cancelled':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: 'Pemesanan Dibatalkan',
        message: `Pesanan #${code} telah dibatalkan. Hubungi Customer Service jika ada pertanyaan.`,
        priority: 'HIGH',
        actionUrl: `/track/${code}`,
      });
      targets.push({
        recipientRole: 'css',
        title: 'Pesanan Dibatalkan',
        message: `Order #${code} (${customerName}) telah dibatalkan.`,
        priority: 'NORMAL',
        actionUrl: `/css?booking=${code}`,
      });
      targets.push({
        recipientRole: 'supervisor',
        title: 'Order Dibatalkan',
        message: `Order #${code} (${customerName}) telah berstatus batal.`,
        priority: 'NORMAL',
        actionUrl: `/supervisor?booking=${code}`,
      });
      break;

    case 'supervisor.unassigned_alert':
      targets.push({
        recipientRole: 'supervisor',
        title: '⚠️ Peringatan: Order Belum Ditugaskan',
        message: `Order #${code} (${customerName}) jadwal ${scheduleAt} belum dialokasikan terapis!`,
        priority: 'CRITICAL',
        actionUrl: `/supervisor?booking=${code}`,
      });
      break;

    case 'therapist.not_accepted_alert':
      targets.push({
        recipientRole: 'supervisor',
        title: '⚠️ Terapis Belum Merespon Tugas',
        message: `${therapistName} belum mengonfirmasi order #${code} melewati batas waktu toleransi.`,
        priority: 'HIGH',
        actionUrl: `/supervisor?booking=${code}`,
      });
      break;

    case 'tracking.location_stale':
      if (settings.staleGpsAlert) {
        targets.push({
          recipientRole: 'supervisor',
          title: '⚠️ Sinyal GPS Terapis Stale',
          message: `Lokasi GPS ${therapistName} untuk order #${code} tidak update lebih dari ${settings.gpsStaleMinutes} menit.`,
          priority: 'HIGH',
          actionUrl: `/supervisor?booking=${code}`,
        });
      }
      break;

    case 'loyalty.points_earned':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: `+${p.pointsEarned} Senzu Points Didapatkan! 🎉`,
        message: `Selamat! Anda mendapatkan ${p.pointsEarned} Senzu Points dari order #${code || p.bookingCode}. Saldo poin Anda sekarang: ${p.newBalance} Poin.`,
        priority: 'NORMAL',
        actionUrl: `/portal?tab=wallet`,
      });
      break;

    case 'loyalty.points_redeemed':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: `${p.pointsRedeemed} Poin Senzu Digunakan`,
        message: `Anda telah menukarkan ${p.pointsRedeemed} Poin senilai Rp ${(p.discountAmount || 0).toLocaleString('id-ID')} untuk order #${code || p.bookingCode}.`,
        priority: 'LOW',
        actionUrl: `/portal?tab=wallet`,
      });
      break;

    case 'membership.tier_upgraded':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: `Selamat! Naik Tier ke ${p.newTierName} 👑`,
        message: `Status keanggotaan Anda telah ditingkatkan menjadi ${p.newTierName}! Nikmati bonus perolehan poin ${p.earningMultiplier}x dan keuntungan eksklusif lainnya.`,
        priority: 'HIGH',
        actionUrl: `/portal?tab=wallet`,
      });
      targets.push({
        recipientRole: 'css',
        title: `Customer Naik Tier: ${p.newTierName}`,
        message: `Pelanggan ${p.customerName} berhasil naik ke tier ${p.newTierName}.`,
        priority: 'LOW',
        actionUrl: `/crm?customer=${p.customerId}`,
      });
      break;

    case 'voucher.issued':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: `Voucher Baru Diterima: ${p.voucherName} 🎁`,
        message: `Anda menerima voucher diskon ${p.voucherName}. Cek dompet reward Anda untuk menggunakannya.`,
        priority: 'NORMAL',
        actionUrl: `/portal?tab=wallet`,
      });
      break;

    case 'referral.qualified':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: `Bonus Referral +${p.pointsReward} Poin! 🤝`,
        message: `Teman Anda (${p.referredCustomerName}) telah menyelesaikan treatment perdananya! Anda mendapatkan bonus ${p.pointsReward} Senzu Points.`,
        priority: 'NORMAL',
        actionUrl: `/portal?tab=wallet`,
      });
      break;

    case 'birthday.reward_issued':
      targets.push({
        recipientRole: 'customer',
        recipientUserId: p.customerId,
        title: `Selamat Ulang Tahun dari Senzu Home! 🎂`,
        message: `Selamat ulang tahun! Kami memberikan hadiah spesial ${p.pointsReward} Senzu Points ke akun Anda.`,
        priority: 'NORMAL',
        actionUrl: `/portal?tab=wallet`,
      });
      break;

    default:
      break;
  }

  return targets;
}

