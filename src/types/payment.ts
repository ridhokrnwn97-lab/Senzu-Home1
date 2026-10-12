export type PaymentStatusCode =
  | 'unpaid'
  | 'pending_manual_verification'
  | 'paid'
  | 'payment_rejected'
  | 'pending'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

// Active payment methods permitted for all new customer bookings
export type ActivePaymentMethod = 'qris' | 'bni' | 'mandiri' | 'bri';

// Deprecated / historical payment methods (strictly for viewing legacy records and auditing; forbidden for new bookings)
export type HistoricalPaymentMethod = 'cash' | 'tunai' | 'pay_on_service' | 'cod' | 'bayar_di_tempat';

export type PaymentMethodType = ActivePaymentMethod | HistoricalPaymentMethod | 'gateway';

export interface BankAccountSetting {
  id?: string;
  bankCode: 'BNI' | 'MANDIRI' | 'BRI' | string;
  bankName: string;
  accountNumber: string; // Stored strictly as string to preserve leading zeroes (e.g. BRI 005901003894560)
  accountHolder: string;
  enabled: boolean;
  sortOrder: number;
  instruction?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export type BankAccountConfig = BankAccountSetting;

export interface QrisSetting {
  enabled: boolean;
  merchantName: string;
  nmid: string;
  accountHolder: string;
  acquirer: string;
  type: 'static' | 'dynamic';
  imageUrl: string;
  staticQrImageUrl?: string;
  sortOrder: number;
  printedBy?: string;
  instruction?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PaymentInstructionsConfig {
  qrisInstruction: string;
  bankTransferInstruction: string;
  paymentProofInstruction: string;
}

export interface PaymentSettings {
  manualPaymentEnabled: boolean;
  bankAccounts: BankAccountSetting[];
  qris: QrisSetting;
  instructions?: PaymentInstructionsConfig;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PaymentRecord {
  id: string; // e.g. PAY-SH-260908-00001-01
  bookingId: string;
  bookingCode: string;
  customerId: string;
  customerAuthUid?: string;
  authUserId?: string;
  customerName: string;
  customerWhatsApp: string;
  
  paymentMethod: string; // 'QRIS Senzu' | 'Transfer BNI' | 'Transfer Bank Mandiri' | 'Transfer BRI'
  methodType?: string;
  paymentType: 'manual' | 'gateway';
  bankCode?: string; // 'BNI' | 'MANDIRI' | 'BRI' | 'QRIS'
  bankName?: string;
  
  // Snapshots at time of payment creation
  accountNumberSnapshot?: string;
  accountHolderSnapshot?: string;
  bankNameSnapshot?: string;
  
  provider: 'manual_senzu' | 'bni_merchant' | 'midtrans' | 'xendit' | string;
  providerTransactionId?: string;
  providerReferenceId?: string;
  
  currency: 'IDR';
  amount: number; // authoritative database price
  status: PaymentStatusCode;
  
  // Proof of payment
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  paymentProofMimeType?: string;
  paymentProofUploadedAt?: string;
  proofUploadedAt?: string;
  paymentProofUploadedBy?: string;
  
  // Verification
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  
  // Rejection
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  rejectionNote?: string;
  
  // Correction
  correctedBy?: string;
  correctedAt?: string;
  correctionReason?: string;
  
  // Duplicate payment flag
  possibleDuplicatePayment?: boolean;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  paymentDeadline?: string; // Authoritative deadline (createdAt + 60 minutes)
  paidAt?: string;
  expiredAt?: string;
  cancelledAt?: string;
  refundedAt?: string;
  
  // Refund fields
  refundAmount?: number;
  refundReason?: string;
  refundRequestedBy?: string;
  refundRequestedAt?: string;
  refundApprovedBy?: string;
  refundApprovedAt?: string;
  refundProcessedBy?: string;
  refundProcessedAt?: string;
}

export interface PaymentEvent {
  id: string;
  paymentId: string;
  bookingId: string;
  bookingCode: string;
  oldStatus?: string;
  newStatus: string;
  source: 'customer' | 'css' | 'admin' | 'finance' | 'system' | 'payment_gateway';
  userId?: string;
  userName?: string;
  userRole?: string;
  eventType:
    | 'payment_created'
    | 'payment_method_selected'
    | 'payment_proof_uploaded'
    | 'payment_verified'
    | 'payment_rejected'
    | 'payment_corrected'
    | 'refund_requested'
    | 'refund_approved'
    | 'refund_processed'
    | 'payment_cancelled';
  note?: string;
  createdAt: string;
}

/**
 * Payment Gateway abstraction interface for future providers (Midtrans, Xendit, etc.)
 */
export interface PaymentProvider {
  createPayment(params: {
    bookingId: string;
    bookingCode: string;
    amount: number;
    customerName: string;
    customerEmail?: string;
    customerPhone: string;
  }): Promise<{
    providerPaymentId: string;
    paymentUrl?: string;
    qrString?: string;
    vaNumber?: string;
    expiredAt?: string;
  }>;
  
  getPaymentStatus(providerPaymentId: string): Promise<{
    status: PaymentStatusCode;
    paidAt?: string;
    rawResponse?: unknown;
  }>;
  
  cancelPayment(providerPaymentId: string): Promise<boolean>;
  
  refundPayment(
    providerPaymentId: string,
    amount: number,
    reason: string
  ): Promise<{ refundId: string; status: string }>;
  
  handleWebhook(
    payload: Record<string, unknown>,
    signatureHeader?: string
  ): Promise<{
    bookingCode: string;
    paymentStatus: PaymentStatusCode;
    providerTransactionId: string;
    amount: number;
    paidAt?: string;
  }>;
}
