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
export const ACCURATE_SYNC_NOTES: Record<string, string> = {
  queued: 'Menunggu pencatatan uang muka.', processing: 'Sedang diproses.',
  waiting_service: 'Uang muka dan penerimaan tercatat. Menunggu treatment selesai.',
  retry: 'Belum berhasil menghubungi Accurate. Akan diperiksa kembali.',
  review: 'Perlu pemeriksaan Manager. Tidak mengirim ulang pembuatan dokumen yang belum pasti.',
  complete: 'Uang muka, penerimaan, dan faktur layanan sudah diverifikasi.',
};
