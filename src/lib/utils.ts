import * as XLSX from 'xlsx';
import { Booking } from '../types';

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount).replace(/\s/g, ' ');
}

export function formatDateIndo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

export function formatDateTimeWIB(dateOrIso: string | Date): string {
  try {
    const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
    if (isNaN(d.getTime())) return String(dateOrIso);
    const dateFormatted = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    return `${dateFormatted} WIB`;
  } catch {
    return String(dateOrIso);
  }
}

export function getTodayDateWIB(): string {
  // Returns YYYY-MM-DD in Asia/Jakarta timezone (WIB)
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

export function generateBookingCode(): string {
  // Format SH-YYMMDD-XXXXX in Asia/Jakarta timezone
  const now = new Date();
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const yy = parts.find((p) => p.type === 'year')?.value || '26';
  const mm = parts.find((p) => p.type === 'month')?.value || '01';
  const dd = parts.find((p) => p.type === 'day')?.value || '01';
  const random = Math.floor(10000 + Math.random() * 90000);
  return `SH-${yy}${mm}${dd}-${random}`;
}

export function exportBookingsToExcel(bookings: Booking[], fileNameSuffix?: string) {
  const rows = (bookings || []).map((b, index) => {
    const payment = b.paymentStatus === 'PAID' ? 'PAID' : 'UNPAID';

    const rawMethod = (b.paymentMethod || '').toLowerCase();
    const formattedMethod =
      rawMethod.includes('cash') || rawMethod.includes('tunai')
        ? 'Cash (Historical)'
        : b.paymentMethod || '-';

    return {
      'No': index + 1,
      'Kode Booking': b.bookingCode,
      'Status Booking': b.status,
      'Nama Terapis': b.therapistName || 'Belum Ditugaskan',
      'Jenis Treatment': b.serviceName,
      'Durasi': `${b.serviceDuration} Menit`,
      'Tarif Layanan (Rp)': b.servicePrice || 0,
      'Home Fee (Rp)': b.homeServiceFee || 0,
      'Total Biaya (Rp)': b.totalAmount || 0,
      'Status Pembayaran': payment,
      'Metode Bayar': formattedMethod,
      'Nama Pelanggan': b.customerName,
      'WhatsApp Pelanggan': b.customerWhatsApp,
      'Wilayah': b.area,
      'Alamat Lengkap': b.address,
      'Tanggal Refleksi': b.scheduleDate,
      'Jam Refleksi': b.scheduleTime ? `${b.scheduleTime} WIB` : '-',
      'Catatan Pelanggan': b.customerNotes || '-',
      'Catatan Internal Staff': b.internalNotes || '-',
      'Waktu Booking (WIB)': formatDateTimeWIB(b.createdAt),
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Column widths
  worksheet['!cols'] = [
    { wch: 6 },  // No
    { wch: 18 }, // Kode Booking
    { wch: 22 }, // Status Booking
    { wch: 20 }, // Nama Terapis
    { wch: 30 }, // Jenis Treatment
    { wch: 14 }, // Durasi
    { wch: 18 }, // Tarif Layanan
    { wch: 16 }, // Home Fee
    { wch: 18 }, // Total Biaya
    { wch: 18 }, // Status Pembayaran
    { wch: 14 }, // Metode Bayar
    { wch: 22 }, // Nama Pelanggan
    { wch: 18 }, // WhatsApp Pelanggan
    { wch: 30 }, // Wilayah
    { wch: 40 }, // Alamat Lengkap
    { wch: 16 }, // Tanggal Refleksi
    { wch: 18 }, // Jam Refleksi
    { wch: 30 }, // Catatan Pelanggan
    { wch: 30 }, // Catatan Internal
    { wch: 24 }, // Waktu Booking
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Laporan Senzu Home');

  const now = new Date();
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const currentMonthName = monthNames[now.getMonth()];
  const currentYear = now.getFullYear();

  const fileName = fileNameSuffix 
    ? `Senzu_Home_Report_${fileNameSuffix}.xlsx`
    : `Senzu_Home_Report_${currentMonthName}_${currentYear}.xlsx`;

  XLSX.writeFile(workbook, fileName);
}

/**
 * Recursively strips undefined fields from an object so Firestore setDoc / updateDoc does not throw:
 * "Unsupported field value: undefined"
 */
export function cleanFirestoreData<T extends Record<string, any>>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => (typeof item === 'object' && item !== null ? cleanFirestoreData(item) : item)) as any;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      result[key] = cleanFirestoreData(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export const sanitizeForFirestore = cleanFirestoreData;

/**
 * Masks customer name for operational privacy in history views (e.g. "Ridho Kurniawan" -> "Ridho K.")
 */
export function maskCustomerName(name?: string): string {
  if (!name) return 'Pelanggan';
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}

