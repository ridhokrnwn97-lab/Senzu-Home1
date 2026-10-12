import type { PaymentSettings } from '../types';

export const OFFICIAL_SENZU_BANK_ACCOUNTS = [
  {
    bankCode: 'BNI',
    bankName: 'BNI',
    accountNumber: '7009999772',
    accountHolder: 'PT KSBONE UNTUK KITA',
    enabled: true,
    sortOrder: 1,
  },
  {
    bankCode: 'MANDIRI',
    bankName: 'Bank Mandiri',
    accountNumber: '1120025626768',
    accountHolder: 'PT KSBONE UNTUK KITA',
    enabled: true,
    sortOrder: 2,
  },
  {
    bankCode: 'BRI',
    bankName: 'BRI',
    accountNumber: '005901003894560',
    accountHolder: 'PT KSBONE UNTUK KITA',
    enabled: true,
    sortOrder: 3,
  },
];

export const OFFICIAL_SENZU_QRIS = {
  enabled: true,
  merchantName: 'SENZU REFLEXOLOGY AND FAMILY MASSAGE QR',
  nmid: 'ID1025449341847',
  accountHolder: 'PT KSBONE UNTUK KITA',
  acquirer: 'BNI Merchant',
  type: 'static' as const,
  imageUrl: '/assets/payment/qris-senzu.jpg',
  sortOrder: 0,
  printedBy: '93600009',
};

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  manualPaymentEnabled: true,
  bankAccounts: OFFICIAL_SENZU_BANK_ACCOUNTS,
  qris: OFFICIAL_SENZU_QRIS,
};

