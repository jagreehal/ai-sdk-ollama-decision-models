/**
 * The tempting pattern, for comparison: one chat model gets the message, the account
 * and the whole policy in its prompt, and picks the action itself. Same five conversations.
 * Run: pnpm llm-decides [model ...]
 */
import { generateText } from 'ai';
import { ollama } from 'ai-sdk-ollama';
import { mkdirSync, writeFileSync } from 'node:fs';
import { conversations } from './run.ts';

const PASSES = 3;
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['granite4.2:3b', 'qwen3.5:4b'];
const ACTIONS = ['FRAUD_REVIEW', 'HUMAN_HANDOFF', 'REFUND', 'REFUND_REVIEW', 'WAIVE_FEE', 'FEE_REVIEW', 'ANSWER'];

// The same policy decide() implements, written as prose the way it would sit in a prompt.
const POLICY = `Refund and support policy:
1. If the customer reports a transaction they did not authorise, choose FRAUD_REVIEW. Fraud takes priority over everything.
2. If the customer explicitly asks for a human, choose HUMAN_HANDOFF.
3. If the customer wants money back: if the account is not refund-eligible choose REFUND_REVIEW; if it is eligible and the amount is £25 or less choose REFUND; otherwise REFUND_REVIEW.
4. If the customer asks for a fee to be removed or waived: choose WAIVE_FEE if the account is fee-waiver-eligible, otherwise FEE_REVIEW.
5. If you are unsure, choose HUMAN_HANDOFF.
6. Otherwise choose ANSWER.`;

const rows: { model: string; pass: number; expect: string; got: string; raw: string; ms: number }[] = [];
for (const model of models) {
  for (let pass = 1; pass <= PASSES; pass++) {
    for (const c of conversations) {
      const started = performance.now();
      const { text } = await generateText({
        model: ollama(model),
        prompt: `${POLICY}\n\nAccount: ${JSON.stringify(c.account)}\nCustomer message: ${c.message}\n\nDecide what we should do. Reply with exactly one of: ${ACTIONS.join(', ')}.`,
      });
      // Longest name first, so REFUND_REVIEW is not read as REFUND.
      const got = [...ACTIONS].sort((a, b) => b.length - a.length).find((a) => text.toUpperCase().includes(a)) ?? 'UNPARSEABLE';
      rows.push({ model, pass, expect: c.expect, got, raw: text.slice(0, 200), ms: Math.round(performance.now() - started) });
      console.log(`${model} #${pass} ${got === c.expect ? '✓' : '✗'} ${got.padEnd(13)} expected ${c.expect.padEnd(13)} ${rows.at(-1)!.ms}ms`);
    }
  }
}

console.log('\n| Model | Right | Same answer all passes | Wrong answers |\n|---|---|---|---|');
for (const model of models) {
  const mine = rows.filter((r) => r.model === model);
  const stable = conversations.filter((c) => new Set(mine.filter((r) => r.expect === c.expect).map((r) => r.got)).size === 1).length;
  const wrong = [...new Set(mine.filter((r) => r.got !== r.expect).map((r) => `${r.expect} → ${r.got}`))];
  console.log(`| ${model} | ${mine.filter((r) => r.got === r.expect).length}/${mine.length} | ${stable}/${conversations.length} | ${wrong.join(', ') || 'none'} |`);
}
mkdirSync('results', { recursive: true });
writeFileSync('results/llm-decides.json', JSON.stringify(rows, null, 2));
