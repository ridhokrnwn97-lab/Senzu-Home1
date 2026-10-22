import { isAccurateXenditNetPreview, xenditMinorUnits, type AccurateXenditNetPreview } from '../lib/accurateSyncContracts.ts';
import { syncFailure } from './accurateSyncProvider.ts';

export const FEE_POLICY = 'expense_including_vat' as const;
export const feeNumber = (jobId: string) => `SHXF-${jobId.slice(0, 24)}`;
export function feePlan(id: string, net: AccurateXenditNetPreview, paidDate: string) {
  if (!isAccurateXenditNetPreview(net)) throw syncFailure('XENDIT_TRANSACTION_UNVERIFIED', true);
  const minor = xenditMinorUnits(net.xenditFee)! + xenditMinorUnits(net.valueAddedTax)!;
  const amount = minor / 100;
  // checkedAt/updatedAt are observations, not journal identity. Never use a
  // later observation date to move a historical transaction to today's ledger.
  const description = `SENZU_HOME_FEE_V1:${id} | ${net.bookingCode} | ${net.paymentId} | ${net.transactionId} | fee=${net.xenditFee};vat=${net.valueAddedTax};gross=${net.grossAmount};net=${net.netAmount} | EXPENSE_INCLUDING_VAT`;
  return { amount, payload: { number: feeNumber(id), transDate: paidDate, description,
    detailJournalVoucher: [
      { accountNo: '600031', amount, amountType: 'DEBIT' },
      { accountNo: '110103', amount, amountType: 'CREDIT' },
    ] } };
}
const alias = (expected: unknown, ...values: unknown[]) => {
  const present = values.filter(v => v !== undefined);
  return present.length > 0 && present.every(v => v === expected);
};
const date = (v: unknown) => typeof v === 'string' ? /^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v :
  /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(v) ? `${v.slice(8,10)}/${v.slice(5,7)}/${v.slice(0,4)}` : null : null;
export function matchesFeeJournal(document: any, payload: ReturnType<typeof feePlan>['payload']) {
  if (!document || document.number !== payload.number || date(document.transDate) !== payload.transDate ||
      document.description !== payload.description || document.deleted === true || document.suspended === true ||
      !Array.isArray(document.detailJournalVoucher) || document.detailJournalVoucher.length !== 2) return false;
  // Require exactly the intended two IDR lines, in either order. Conflicting
  // aliases or extra allocations/taxes cannot be silently accepted.
  return payload.detailJournalVoucher.every(wanted => document.detailJournalVoucher.filter((row: any) => {
    const account = row?.account ?? row?.glAccount;
    if (!row || !alias(wanted.accountNo, row.accountNo, row.account?.no, row.glAccount?.no) ||
        row.amountType !== wanted.amountType || xenditMinorUnits(row.amount) !== xenditMinorUnits(wanted.amount) ||
        row._status !== undefined || row.customerNo || row.vendorNo || row.employeeNo || row.subsidiaryType) return false;
    const currencies = [account?.currency?.code, account?.currencyCode, row.currency?.code, row.currencyCode].filter(v => v !== undefined);
    if (currencies.some(v => v !== 'IDR') || row.rate !== undefined && row.rate !== 1 ||
        row.primeAmount !== undefined && xenditMinorUnits(row.primeAmount) !== xenditMinorUnits(wanted.amount)) return false;
    return true;
  }).length === 1);
}
