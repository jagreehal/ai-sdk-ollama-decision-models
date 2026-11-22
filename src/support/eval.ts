/**
 * The judgment layer, evaluated on labelled messages. No business rules here.
 * Per question: false positives / false negatives at 0.5 and at the policy threshold.
 * Run: pnpm eval-judgments [model]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { RULES, type Judgments } from './decide.ts';
import { judge } from './judge.ts';

const modelId = process.argv[2] ?? 'tev1';
type Label = Partial<Record<keyof Judgments, true>>;

// A label lists what is true; everything unlisted is expected false.
const cases: { message: string; label: Label }[] = [
  { message: 'I never made that purchase.', label: { reportsFraud: true } },
  { message: "There's a £240 charge from a shop I've never visited. Can you get my money back?", label: { reportsFraud: true, wantsRefund: true } },
  { message: "I'm not saying it's fraud, but I've never used that shop.", label: { reportsFraud: true } },
  { message: 'Someone used my card in Lisbon. I am in Leeds.', label: { reportsFraud: true } },
  { message: 'Can you return my £15?', label: { wantsRefund: true } },
  { message: 'The subscription charged me after I cancelled. Please refund it.', label: { wantsRefund: true } },
  { message: 'I was charged twice for the same order, I want one of them back.', label: { wantsRefund: true } },
  { message: "I'd like to speak to a manager.", label: { requestsHuman: true } },
  { message: 'Stop sending me bot replies and put me through to a real person.', label: { requestsHuman: true } },
  { message: 'Can someone call me? I would rather talk this through.', label: { requestsHuman: true } },
  { message: 'The £35 late fee will leave me overdrawn. Can you remove it?', label: { requestsFeeWaiver: true } },
  { message: 'Please waive the overdraft charge, it was a one-off.', label: { requestsFeeWaiver: true } },
  { message: "What's my current balance?", label: {} },
  { message: 'How do I change my address?', label: {} },
  { message: 'Thanks, that sorted it.', label: {} },
  { message: 'When will my refund from last week arrive?', label: {} },
  { message: 'I bought this at the shop on the corner yesterday and I want a receipt.', label: {} },
  { message: 'Is there a fee for paying abroad?', label: {} },
];

const keys = ['wantsRefund', 'reportsFraud', 'requestsHuman', 'requestsFeeWaiver'] as const;
const threshold = (k: keyof Judgments) => (k === 'reportsFraud' ? RULES.fraudThreshold : RULES.intentThreshold);

const rows: { message: string; label: Label; judgments: Judgments; ms: number }[] = [];
await judge('warm up', modelId); // pays the model load once
for (const c of cases) {
  const started = performance.now();
  const judgments = await judge(c.message, modelId);
  rows.push({ ...c, judgments, ms: Math.round(performance.now() - started) });
  const misses = keys.filter((k) => judgments[k] >= threshold(k) !== !!c.label[k]);
  console.log(`${misses.length ? '✗' : '✓'} ${c.message}  ${keys.map((k) => `${k}=${judgments[k].toFixed(2)}`).join(' ')}${misses.length ? `  miss: ${misses.join(', ')}` : ''}`);
}

console.log(`\n${modelId}, ${rows.length} messages, p50 ${rows.map((r) => r.ms).sort((a, b) => a - b)[rows.length >> 1]}ms per message (4 questions)\n`);
console.log('| Question | Positives | Threshold | FN @ threshold | FP @ threshold | FN @ 0.5 | FP @ 0.5 |');
console.log('|---|---|---|---|---|---|---|');
for (const k of keys) {
  const count = (t: number, want: boolean) => rows.filter((r) => !!r.label[k] === want && r.judgments[k] >= t !== want).length;
  const pos = rows.filter((r) => r.label[k]).length;
  console.log(`| ${k} | ${pos} | ${threshold(k)} | ${count(threshold(k), true)} | ${count(threshold(k), false)} | ${count(0.5, true)} | ${count(0.5, false)} |`);
}

mkdirSync('results', { recursive: true });
writeFileSync(`results/judgments-${modelId.replace(/:/g, '-')}.json`, JSON.stringify(rows, null, 2));
