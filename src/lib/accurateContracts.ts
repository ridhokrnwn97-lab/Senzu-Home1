// Public identifiers and the masters verified in Accurate on 22 October 2026.
// No credential belongs in this module or any VITE_ environment variable.
export const ACCURATE_APP_KEY = '212b755a-ada6-428c-8243-dd2e3874b66b';
export const ACCURATE_COMPANY = 'PT KSBONE UNTUK KITA';
export const ACCURATE_APP_NAME = 'Senzu Home';
export const ACCURATE_MASTERS = [
  { kind: 'account', code: '110103', name: 'Saldo Xendit – Senzu Home', type: 'CASH_BANK' },
  { kind: 'account', code: '400005', name: 'Pendapatan Jasa Senzu Home', type: 'REVENUE' },
  { kind: 'account', code: '600031', name: 'Beban Administrasi Xendit - Senzu Home', type: 'EXPENSE' },
  { kind: 'account', code: '210102', name: 'Uang Muka Penjualan IDR', type: 'ACCOUNT_PAYABLE' },
  { kind: 'item', code: 'SH-SIG-030', name: 'Senzu Home - Signature Treatment 30 Menit', type: 'SERVICE', price: 160000 },
  { kind: 'item', code: 'SH-SIG-060', name: 'Senzu Home Signature 60 Menit', type: 'SERVICE', price: 225000 },
  { kind: 'item', code: 'SH-SIG-090', name: 'Senzu Home Signature 90 Menit', type: 'SERVICE', price: 325000 },
  { kind: 'item', code: 'SH-SIG-120', name: 'Senzu Home Signature 120 Menit', type: 'SERVICE', price: 425000 },
] as const;

export type AccurateConfiguration = {
  mode: 'connection_only'; writesEnabled: false; configured: boolean;
  apiTokenPresent: boolean; signatureSecretPresent: boolean; databaseIdPinned: boolean;
};
export type AccurateMasterCheck = {
  kind: 'account' | 'item'; code: string; name: string;
  status: 'match' | 'mismatch' | 'unverified'; note: string;
};
export type AccurateConnectionCheck = {
  mode: 'connection_only'; writesEnabled: false; connected: true;
  companyName: string; applicationName: string; databaseId: number;
  databaseIdPinned: boolean; access: 'administrator' | 'operator';
  checkedAt: string; mastersMatch: boolean; checks: AccurateMasterCheck[];
};
