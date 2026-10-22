export const ACCURATE_SYNC_DATABASE_ID = 2974047;
export const ACCURATE_FEE_ACK = 'NEW_LIVE_XENDIT_FEES_AS_EXPENSE_INCLUDING_VAT';
export const ACCURATE_SYNC_ACK = 'NEW_LIVE_XENDIT_PAYMENTS_ONLY';
export type AccurateSyncJobState = 'queued' | 'processing' | 'waiting_service' | 'waiting_fee' | 'retry' | 'review' | 'complete';
export type AccurateSyncJobView = {
  id: string; bookingCode: string; amount: number; state: AccurateSyncJobState;
  createdAt: string; updatedAt: string; note: string;
  downPaymentNumber: string | null; receiptNumber: string | null; invoiceNumber: string | null;
  confirmed: Array<'down_payment' | 'receipt' | 'invoice'>;
  feeNumber?: string; feeState?: 'excluded' | 'pending' | 'confirmed' | 'zero'; feeAmount?: number | null;
};
export type AccurateSyncStatus = {
  mode: 'posting_v1'; databaseId: number; writesConfigured: boolean; schedulerConfigured: boolean;
  enabled: boolean; activatedAt: string | null; taxPolicy: 'no_extra_tax' | null;
  jobs: AccurateSyncJobView[];
  feesEnabled?: boolean; feesActivatedAt?: string | null; feePolicy?: 'expense_including_vat' | null;
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
export const XENDIT_STATE_EXPECTED = { type: 'PAYMENT', status: 'SUCCESS / SUCCESSFUL', cashflow: 'MONEY_IN' } as const;
// SUCCESS is documented by the Transaction API; SUCCESSFUL was observed on
// the matched Live transaction and is documented in Xendit's current reports.
// Accept only these exact spellings, with PAYMENT and MONEY_IN still required.
export function isXenditSuccessfulIncomingPayment(type: unknown, status: unknown, cashflow: unknown) {
  return type === 'PAYMENT' && (status === 'SUCCESS' || status === 'SUCCESSFUL') && cashflow === 'MONEY_IN';
}
export const XENDIT_STATE_VALUES: Record<keyof typeof XENDIT_STATE_EXPECTED, readonly string[]> = {
  type: ['PAYMENT', 'IN_PERSON_PAYMENT', 'REFUND', 'WITHDRAWAL', 'DISBURSEMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'TOPUP',
    'CONVERSION', 'OTHER', 'ADJUSTMENT_ADD', 'ADJUSTMENT_DEDUCT', 'VA_PAYMENT', 'VIRTUAL_ACCOUNT', 'CAPTURE', 'PAYMENT_CAPTURE'],
  status: ['PENDING', 'SUCCESS', 'FAILED', 'VOIDED', 'REVERSED', 'SUCCESSFUL', 'SUCCEEDED', 'COMPLETED', 'SETTLED', 'PAID', 'CANCELED', 'CANCELLED'],
  cashflow: ['MONEY_IN', 'MONEY_OUT', 'IN', 'OUT', 'CREDIT', 'DEBIT'],
};
export type XenditObservedState = { kind: 'known' | 'case_variant' | 'missing' | 'null' | 'unrecognized' | 'invalid_type'; value: string | null };
export type AccurateXenditStateDiagnostic = {
  mode: 'xendit_state_diagnostic_v1'; environment: 'live'; readOnly: true; verified: false; bookingCode: string; checkedAt: string;
  checks: Record<keyof typeof XENDIT_STATE_EXPECTED, XenditObservedState>;
};
export type AccurateXenditNetResult = AccurateXenditNetPreview | AccurateXenditStateDiagnostic;
export function observeXenditState(field: keyof typeof XENDIT_STATE_EXPECTED, raw: unknown): XenditObservedState {
  if (raw === undefined) return { kind: 'missing', value: null };
  if (raw === null) return { kind: 'null', value: null };
  if (typeof raw !== 'string') return { kind: 'invalid_type', value: null };
  if (XENDIT_STATE_VALUES[field].includes(raw)) return { kind: 'known', value: raw };
  // A finite whitelist allows useful enum diagnostics, never arbitrary provider
  // strings, credentials, personal data, IDs or raw payloads. No trim/coercion is
  // performed and case variants remain unverified.
  if (XENDIT_STATE_VALUES[field].includes(raw.toUpperCase())) return { kind: 'case_variant', value: raw.toUpperCase() };
  return { kind: 'unrecognized', value: null };
}
export function isAccurateXenditStateDiagnostic(value: unknown): value is AccurateXenditStateDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, any>, fields = Object.keys(XENDIT_STATE_EXPECTED) as Array<keyof typeof XENDIT_STATE_EXPECTED>;
  if (Object.keys(v).some(k => !['success', 'mode', 'environment', 'readOnly', 'verified', 'bookingCode', 'checkedAt', 'checks'].includes(k)) ||
      Object.hasOwn(v, 'success') && v.success !== true || v.mode !== 'xendit_state_diagnostic_v1' || v.environment !== 'live' ||
      v.readOnly !== true || v.verified !== false || typeof v.bookingCode !== 'string' || !/^SH-\d{6}-[A-Z0-9]{5,20}$/.test(v.bookingCode) ||
      typeof v.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v.checkedAt) || !Number.isFinite(Date.parse(v.checkedAt)) ||
      !v.checks || typeof v.checks !== 'object' || Array.isArray(v.checks) || Object.keys(v.checks).length !== 3 ||
      Object.keys(v.checks).some(k => !fields.includes(k as keyof typeof XENDIT_STATE_EXPECTED))) return false;
  return fields.every(field => {
    const s = v.checks[field];
    return s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length === 2 && Object.hasOwn(s, 'kind') && Object.hasOwn(s, 'value') &&
      (['known', 'case_variant'].includes(s.kind) ? typeof s.value === 'string' && XENDIT_STATE_VALUES[field].includes(s.value) :
        ['missing', 'null', 'unrecognized', 'invalid_type'].includes(s.kind) && s.value === null);
  }) && (fields.some(field => v.checks[field].kind !== 'known') ||
    !isXenditSuccessfulIncomingPayment(v.checks.type.value, v.checks.status.value, v.checks.cashflow.value));
}
export function xenditObservedStateLabel(state: XenditObservedState) {
  if (state.kind === 'known') return state.value!;
  if (state.kind === 'case_variant') return `${state.value} (kapitalisasi berbeda)`;
  return { missing: 'Tidak disediakan', null: 'Null', unrecognized: 'Nilai lain; tidak ditampilkan', invalid_type: 'Tipe data tidak sesuai' }[state.kind];
}
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
  waiting_fee: 'Dokumen bruto diproses. Menunggu biaya final Xendit atau pengiriman jurnal biaya.',
  retry: 'Belum berhasil menghubungi Accurate. Akan diperiksa kembali.',
  review: 'Perlu pemeriksaan Manager. Tidak mengirim ulang pembuatan dokumen yang belum pasti.',
  complete: 'Uang muka, penerimaan, dan faktur layanan sudah diverifikasi.',
};
