import type { CSSProperties } from 'react';

// Single source of truth for the nine Finance columns. Widths drive <colgroup>,
// the table min-width, and the second sticky column's offset via CSS variables.
export const FINANCE_COLUMNS = [
  { key: 'bookingCode', label: 'Kode Booking', width: 150 },
  { key: 'customerName', label: 'Nama Pemesan', width: 165 },
  { key: 'transaction', label: 'Transaksi', width: 180 },
  { key: 'amount', label: 'Nominal', width: 120 },
  { key: 'status', label: 'Status', width: 125 },
  { key: 'method', label: 'Metode', width: 120 },
  { key: 'createdAt', label: 'Dibuat', width: 140 },
  { key: 'paidAt', label: 'Dibayar/Diverifikasi', width: 140 },
  { key: 'proof', label: 'Bukti', width: 90 },
] as const;

export const FINANCE_TABLE_MIN_WIDTH = FINANCE_COLUMNS.reduce((total, col) => total + col.width, 0);

export const financeColumnVars = (): CSSProperties => Object.fromEntries(
  FINANCE_COLUMNS.map((col, i) => [`--finance-col-${i}`, `${col.width}px`])
) as CSSProperties;
