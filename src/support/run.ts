/**
 * Judge each message with the model, then let code decide. Prints the full trace.
 * Run: pnpm support [model]
 */
import { decide, RULES, type Account } from './decide.ts';
import { judge } from './judge.ts';

const modelId = process.argv[2] ?? 'tev1';

export const conversations: { message: string; account: Account; expect: string }[] = [
  {
    message: "I'm not saying someone stole my card, but there's a £240 charge from a shop I've never visited. Can you get my money back?",
    account: { refundEligible: false, feeWaiverEligible: false, amount: 240 },
    expect: 'FRAUD_REVIEW',
  },
  {
    message: 'I was only one day late because my salary arrived after the bank holiday. The £35 fee is going to leave me overdrawn. Can you remove it?',
    account: { refundEligible: false, feeWaiverEligible: true, amount: 35 },
    expect: 'WAIVE_FEE',
  },
  {
    message: 'The coffee machine subscription charged me £12 after I cancelled. Please refund it.',
    account: { refundEligible: true, feeWaiverEligible: false, amount: 12 },
    expect: 'REFUND',
  },
  {
    message: "I've been going round in circles with the chatbot. Put me through to a person.",
    account: { refundEligible: true, feeWaiverEligible: false, amount: 0 },
    expect: 'HUMAN_HANDOFF',
  },
  { message: "What's my current balance?", account: { refundEligible: true, feeWaiverEligible: false, amount: 0 }, expect: 'ANSWER' },
];

const f = (n: number) => n.toFixed(2);
if (import.meta.main) for (const { message, account } of conversations) {
  const started = performance.now();
  const j = await judge(message, modelId);
  const ms = Math.round(performance.now() - started);
  const { decision, reason } = decide(j, account);
  console.log(`> ${message}`);
  console.log(`  Judgments (${modelId}, ${ms}ms):`);
  for (const [k, v] of Object.entries(j)) console.log(`    ${k.padEnd(18)}${f(v)}`);
  console.log(`  Facts:\n    refundEligible    ${account.refundEligible}\n    feeWaiverEligible ${account.feeWaiverEligible}\n    amount            ${account.amount}`);
  console.log(`  Rules:\n    fraudThreshold    ${RULES.fraudThreshold}\n    intentThreshold   ${RULES.intentThreshold}\n    autoRefundLimit   ${RULES.autoRefundLimit}`);
  console.log(`  Decision: ${decision}\n  Reason:   ${reason}\n`);
}
