export const ACCURATE_SYNC_DATABASE_ID = 2974047;
export const ACCURATE_SYNC_ACK = 'NEW_LIVE_XENDIT_PAYMENTS_ONLY';
export type AccurateSyncJobState = 'queued' | 'processing' | 'waiting_service' | 'retry' | 'review' | 'complete';
export type AccurateSyncJobView = {
  id: string; bookingCode: string; amount: number; state: AccurateSyncJobState;
  createdAt: string; updatedAt: string; note: string;
  downPaymentNumber: string | null; receiptNumber: string | null; invoiceNumber: string | null;
  confirmed: Array<'down_payment' | 'receipt' | 'invoice'>;
};
export type AccurateSyncStatus = {
  mode: 'posting_v1'; databaseId: number; writesConfigured: boolean; schedulerConfigured: boolean;
  enabled: boolean; activatedAt: string | null; taxPolicy: 'no_extra_tax' | null;
  jobs: AccurateSyncJobView[];
};
export type AccurateSyncPreview = {
  bookingCode: string; amount: number; historical: boolean; eligible: boolean;
  itemCode: string | null; servicePrice: number; visitFee: number; discount: number;
  note: string; downPaymentNumber: string; receiptNumber: string; invoiceNumber: string;
};
export type AccurateXenditNetPreview = {
  mode: 'xendit_net_preview_v1'; environment: 'live'; readOnly: true;
  bookingCode: string; referenceId: string; paymentId: string; transactionId: string; productId: string;
  channelCode: string; channelCategory: string; currency: 'IDR';
  grossAmount: number; xenditFee: number; valueAddedTax: number;
  xenditWithholdingTax: 0; thirdPartyWithholdingTax: 0; netAmount: number;
  feeStatus: 'COMPLETED'; settlementStatus: 'SETTLED'; transactionUpdatedAt: string; checkedAt: string;
  processingFeeIncluded: false; bankPayoutVerified: false;
};
export const ACCURATE_NET_PREVIEW_ERRORS: Record<string, string> = {
  XENDIT_NET_NOT_CONFIGURED: 'Key Live atau ID bisnis Xendit di server belum dapat diverifikasi. Jangan kirim nilainya ke chat.',
  XENDIT_TRANSACTION_AUTH_INVALID: 'Xendit menolak autentikasi key Live. Periksa konfigurasi key di server.',
  XENDIT_TRANSACTION_PERMISSION_REQUIRED: 'Akses baca transaksi ditolak Xendit. Periksa izin Transaction Read dan akun Live pada key yang digunakan server.',
  XENDIT_TRANSACTION_UNAVAILABLE: 'Data transaksi Xendit belum dapat dibaca. Coba lagi nanti; tidak ada pencatatan biaya yang dilakukan.',
  XENDIT_TRANSACTION_NOT_FOUND: 'Transaksi untuk referensi booking ini belum ditemukan di Xendit. Tidak membuat pembayaran pengganti.',
  XENDIT_TRANSACTION_UNVERIFIED: 'Identitas, nominal, atau rincian transaksi Xendit belum cocok. Neto belum dapat diverifikasi.',
  XENDIT_LIST_FORMAT_UNVERIFIED: 'Format daftar transaksi Xendit belum dapat dibaca. Neto belum dapat diverifikasi.',
  XENDIT_LIST_MULTIPLE_RESULTS: 'Xendit melaporkan lebih dari satu hasil atau halaman lanjutan untuk referensi ini. Transaksi tidak dipilih otomatis.',
  XENDIT_LIST_PAGINATION_UNVERIFIED: 'Penanda akhir daftar transaksi Xendit belum dapat diverifikasi. Neto belum ditampilkan.',
  XENDIT_BUSINESS_MISMATCH: 'Business ID transaksi tidak cocok dengan konfigurasi akun Xendit Live di server.',
  XENDIT_REFERENCE_MISMATCH: 'Referensi transaksi Xendit tidak cocok dengan referensi booking yang tersimpan.',
  XENDIT_PRODUCT_MISMATCH: 'Product ID transaksi Xendit tidak cocok dengan Payment ID booking yang tersimpan.',
  XENDIT_AMOUNT_MISMATCH: 'Nominal bruto transaksi Xendit tidak cocok dengan pembayaran booking yang tersimpan.',
  XENDIT_CURRENCY_UNVERIFIED: 'Mata uang pembayaran atau neto pada respons Xendit belum terverifikasi sebagai IDR.',
  XENDIT_STATE_UNVERIFIED: 'Jenis, status sukses, atau arah dana transaksi Xendit belum cocok sebagai pembayaran masuk.',
  XENDIT_FEE_AMOUNT_UNVERIFIED: 'Nilai biaya transaksi pada respons Xendit tidak tersedia atau formatnya belum valid.',
  XENDIT_FEE_VAT_UNVERIFIED: 'Nilai PPN biaya pada respons Xendit tidak tersedia atau formatnya belum valid.',
  XENDIT_FEE_WITHHOLDING_UNVERIFIED: 'Rincian withholding pada respons Xendit tidak lengkap atau formatnya belum valid. Nilai kosong tidak dianggap nol.',
  XENDIT_NET_AMOUNT_UNVERIFIED: 'Nominal neto Xendit tidak valid atau belum sama dengan bruto dikurangi biaya transaksi dan PPN biaya.',
  XENDIT_TRANSACTION_META_UNVERIFIED: 'ID transaksi, kanal, atau waktu pembaruan pada respons Xendit belum dapat diverifikasi.',
  XENDIT_FEES_PENDING: 'Biaya transaksi Xendit belum berstatus COMPLETED. Neto belum dapat diverifikasi; periksa lagi nanti.',
  XENDIT_SETTLEMENT_PENDING: 'Settlement Xendit belum berstatus SETTLED. Periksa lagi nanti; ini belum membuktikan dana masuk bank.',
  XENDIT_WITHHOLDING_REVIEW: 'Xendit melaporkan pajak dipotong. Finance perlu memeriksa rinciannya sebelum neto dapat diverifikasi oleh panel ini.',
};
// IDR values can include two decimal places. Compare integer minor units rather
// than floating point subtraction; absent fields must never become zero fees.
export const xenditMinorUnits = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 &&
  v <= 10000000 && /^\d+(?:\.\d{1,2})?$/.test(String(v)) ? Math.round(v * 100) : null;
export function matchesXenditPaymentProduct(paymentId: string, productId: unknown) {
  return productId === paymentId || /^py-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(paymentId) && productId === paymentId.slice(3);
}
export function isAccurateXenditNetPreview(value: unknown): value is AccurateXenditNetPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, any>;
  const amounts = ['grossAmount', 'xenditFee', 'valueAddedTax', 'netAmount'].map(k => xenditMinorUnits(v[k]));
  return v.mode === 'xendit_net_preview_v1' && v.environment === 'live' && v.readOnly === true &&
    typeof v.bookingCode === 'string' && /^SH-\d{6}-[A-Z0-9]{5,20}$/.test(v.bookingCode) &&
    typeof v.referenceId === 'string' && /^shl_[a-f0-9]{48}$/.test(v.referenceId) &&
    typeof v.paymentId === 'string' && /^py-[A-Za-z0-9-]{16,100}$/.test(v.paymentId) && typeof v.productId === 'string' && matchesXenditPaymentProduct(v.paymentId, v.productId) &&
    typeof v.transactionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v.transactionId) &&
    typeof v.channelCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(v.channelCode) &&
    ['BANK', 'CARDS', 'CARDLESS_CREDIT', 'CASH', 'DIRECT_DEBIT', 'EWALLET', 'PAYLATER', 'QR_CODE', 'RETAIL_OUTLET', 'VIRTUAL_ACCOUNT', 'XENPLATFORM', 'OTHER'].includes(v.channelCategory) &&
    v.currency === 'IDR' && amounts.every(n => n !== null) && v.grossAmount >= 10000 && Number.isSafeInteger(v.grossAmount) &&
    amounts[0]! - amounts[1]! - amounts[2]! === amounts[3] && v.xenditWithholdingTax === 0 && v.thirdPartyWithholdingTax === 0 &&
    v.feeStatus === 'COMPLETED' && v.settlementStatus === 'SETTLED' &&
    ['transactionUpdatedAt', 'checkedAt'].every(k => typeof v[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v[k]) && Number.isFinite(Date.parse(v[k]))) &&
    v.processingFeeIncluded === false && v.bankPayoutVerified === false;
}
export const ACCURATE_SYNC_NOTES: Record<string, string> = {
  queued: 'Menunggu pencatatan uang muka.', processing: 'Sedang diproses.',
  waiting_service: 'Uang muka dan penerimaan tercatat. Menunggu treatment selesai.',
  retry: 'Belum berhasil menghubungi Accurate. Akan diperiksa kembali.',
  review: 'Perlu pemeriksaan Manager. Tidak mengirim ulang pembuatan dokumen yang belum pasti.',
  complete: 'Uang muka, penerimaan, dan faktur layanan sudah diverifikasi.',
};
