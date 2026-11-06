// Public identifiers and the Senzu Home masters in the existing Accurate database.
// No credential belongs in this module or any VITE_ environment variable.
export const ACCURATE_APP_KEY = '212b755a-ada6-428c-8243-dd2e3874b66b';
export const ACCURATE_COMPANY = 'PT KSBONE UNTUK KITA';
export const ACCURATE_APP_NAME = 'Senzu Home';
export const ACCURATE_HOME_MENU = [
  { code: 'SH-DSR-090', name: 'Senzu Home - Deep Sleep Relaxations 90 Menit', bookingName: 'Deep Sleep Relaxations', duration: 90, price: 200000 },
  { code: 'SH-TJ-090', name: 'Senzu Home - Travel Journey 90 Menit', bookingName: 'Travel Journey', duration: 90, price: 140000 },
  { code: 'SH-FBH-090', name: 'Senzu Home - Full Body Healing 90 Menit', bookingName: 'Full Body Healing', duration: 90, price: 225000 },
  { code: 'SH-RBR-090', name: 'Senzu Home - Royal Body Recovery 90 Menit', bookingName: 'Royal Body Recovery', duration: 90, price: 220000 },
  { code: 'SH-DSR-120', name: 'Senzu Home - Deep Sleep Relaxations 120 Menit', bookingName: 'Deep Sleep Relaxations', duration: 120, price: 315000 },
  { code: 'SH-TJ-120', name: 'Senzu Home - Travel Journey 120 Menit', bookingName: 'Travel Journey', duration: 120, price: 190000 },
  { code: 'SH-FBH-120', name: 'Senzu Home - Full Body Healing 120 Menit', bookingName: 'Full Body Healing', duration: 120, price: 300000 },
  { code: 'SH-RBR-120', name: 'Senzu Home - Royal Body Recovery 120 Menit', bookingName: 'Royal Body Recovery', duration: 120, price: 320000 },
] as const;
export const ACCURATE_MASTERS = [
  { kind: 'account', code: '110103', name: 'Saldo Xendit – Senzu Home', type: 'CASH_BANK' },
  { kind: 'account', code: '400005', name: 'Pendapatan Jasa Senzu Home', type: 'REVENUE' },
  { kind: 'account', code: '600031', name: 'Beban Administrasi Xendit - Senzu Home', type: 'EXPENSE' },
  { kind: 'account', code: '210102', name: 'Uang Muka Penjualan IDR', type: 'ACCOUNT_PAYABLE' },
  { kind: 'item', code: 'SH-SIG-030', name: 'Senzu Home - Signature Treatment 30 Menit', type: 'SERVICE', price: 160000 },
  { kind: 'item', code: 'SH-SIG-060', name: 'Senzu Home Signature 60 Menit', type: 'SERVICE', price: 225000 },
  { kind: 'item', code: 'SH-SIG-090', name: 'Senzu Home Signature 90 Menit', type: 'SERVICE', price: 325000 },
  { kind: 'item', code: 'SH-SIG-120', name: 'Senzu Home Signature 120 Menit', type: 'SERVICE', price: 425000 },
  ...ACCURATE_HOME_MENU.map(row => ({ kind: 'item' as const, code: row.code, name: row.name, type: 'SERVICE' as const, price: row.price })),
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
