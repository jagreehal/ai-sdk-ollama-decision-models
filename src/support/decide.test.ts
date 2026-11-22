// Business rules, tested without a model. Run: pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, type Account, type Judgments } from './decide.ts';

const none: Judgments = { wantsRefund: 0, reportsFraud: 0, requestsHuman: 0, requestsFeeWaiver: 0 };
const eligible: Account = { refundEligible: true, feeWaiverEligible: true, amount: 10 };

test('fraud takes priority over refund', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.99, reportsFraud: 0.94 }, eligible).decision, 'FRAUD_REVIEW');
});
test('a human request beats a refund', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.99, requestsHuman: 0.9 }, eligible).decision, 'HUMAN_HANDOFF');
});
test('small eligible refund is automatic', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.95 }, eligible).decision, 'REFUND');
});
test('the £25 limit is inclusive', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.95 }, { ...eligible, amount: 25 }).decision, 'REFUND');
  assert.equal(decide({ ...none, wantsRefund: 0.95 }, { ...eligible, amount: 25.01 }).decision, 'REFUND_REVIEW');
});
test('ineligible refund goes to review whatever the amount', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.95 }, { ...eligible, refundEligible: false, amount: 1 }).decision, 'REFUND_REVIEW');
});
test('fee waiver depends on eligibility', () => {
  assert.equal(decide({ ...none, requestsFeeWaiver: 0.9 }, eligible).decision, 'WAIVE_FEE');
  assert.equal(decide({ ...none, requestsFeeWaiver: 0.9 }, { ...eligible, feeWaiverEligible: false }).decision, 'FEE_REVIEW');
});
test('a grey-zone judgment goes to a person, not to code that moves money', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.6 }, eligible).decision, 'HUMAN_HANDOFF');
});
test('nothing detected: answer the question', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.1 }, eligible).decision, 'ANSWER');
});
test('a refund outranks a waiver when the model reports both (tev1 blurs them)', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.99, requestsFeeWaiver: 0.81 }, eligible).decision, 'REFUND');
});
