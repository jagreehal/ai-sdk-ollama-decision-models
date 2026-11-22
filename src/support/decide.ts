/**
 * The policy. Plain code: no model, no prompt. The model never sees these numbers.
 */
export type Judgments = { wantsRefund: number; reportsFraud: number; requestsHuman: number; requestsFeeWaiver: number };
export type Account = { refundEligible: boolean; feeWaiverEligible: boolean; amount: number };
export type Decision = 'FRAUD_REVIEW' | 'HUMAN_HANDOFF' | 'REFUND' | 'REFUND_REVIEW' | 'WAIVE_FEE' | 'FEE_REVIEW' | 'ANSWER';

export const RULES = { fraudThreshold: 0.6, intentThreshold: 0.8, uncertainBelow: 0.4, autoRefundLimit: 25 };

export function decide(j: Judgments, a: Account, r = RULES): { decision: Decision; reason: string } {
  // Order is the priority: fraud beats everything, a human request beats money.
  if (j.reportsFraud >= r.fraudThreshold) return { decision: 'FRAUD_REVIEW', reason: `reportsFraud ${j.reportsFraud.toFixed(2)} >= ${r.fraudThreshold}` };
  if (j.requestsHuman >= r.intentThreshold) return { decision: 'HUMAN_HANDOFF', reason: `requestsHuman ${j.requestsHuman.toFixed(2)} >= ${r.intentThreshold}` };
  if (j.wantsRefund >= r.intentThreshold) {
    if (!a.refundEligible) return { decision: 'REFUND_REVIEW', reason: 'refund wanted, account not eligible' };
    return a.amount <= r.autoRefundLimit
      ? { decision: 'REFUND', reason: `refund wanted, eligible, £${a.amount} <= £${r.autoRefundLimit}` }
      : { decision: 'REFUND_REVIEW', reason: `refund wanted, £${a.amount} > £${r.autoRefundLimit}` };
  }
  if (j.requestsFeeWaiver >= r.intentThreshold) {
    return a.feeWaiverEligible
      ? { decision: 'WAIVE_FEE', reason: 'waiver wanted, account eligible' }
      : { decision: 'FEE_REVIEW', reason: 'waiver wanted, account not eligible' };
  }
  // Nothing cleared its bar, but something money-moving is in the grey zone: a person looks.
  const unsure = (Object.keys(j) as (keyof Judgments)[]).filter((k) => j[k] >= r.uncertainBelow);
  if (unsure.length) return { decision: 'HUMAN_HANDOFF', reason: `uncertain: ${unsure.map((k) => `${k} ${j[k].toFixed(2)}`).join(', ')}` };
  return { decision: 'ANSWER', reason: 'no judgment above ' + r.uncertainBelow };
}
