/**
 * The same labelled tickets through each model, same evaluate() call, three passes.
 * Decision models answer natively. granite4.2:3b goes through the AI SDK adapter,
 * which asks a chat model for the same answers in one structured-output call.
 * Run: pnpm bench [model ...]
 */
import { experimental_evaluate as evaluate, type Experimental_EvaluationModel as EvaluationModel } from 'ai';
import { Experimental_EvaluationLanguageModel as EvaluationLanguageModel } from '@ai-sdk/provider-utils/experimental-evaluation';
import { ollama } from 'ai-sdk-ollama';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PASSES = 3;

// expect 'triage' = a careful human would not route it without a second look.
const cases = [
  { id: 'double-charge', expect: 'billing', ticket: 'I was charged twice this month. Please refund the extra payment.' },
  { id: 'invoice-vat', expect: 'billing', ticket: 'Can you reissue last month’s invoice with our VAT number on it?' },
  { id: 'card-declined', expect: 'billing', ticket: 'My card keeps getting declined when I try to upgrade to the Pro plan.' },
  { id: 'checkout-500', expect: 'engineering', ticket: 'Checkout has returned 500 errors since 9am and we are losing sales!' },
  { id: 'webhook-silent', expect: 'engineering', ticket: 'Your webhooks stopped firing for order.created about an hour ago. Nothing in our logs.' },
  { id: 'safari-blank', expect: 'engineering', ticket: 'The dashboard is a blank white page in Safari 19. Chrome works.' },
  { id: 'csv-export', expect: 'support', ticket: 'How do I export my data to CSV?' },
  { id: 'add-teammate', expect: 'support', ticket: 'Where do I invite a colleague to our workspace?' },
  { id: 'reset-2fa', expect: 'support', ticket: 'I got a new phone and lost my authenticator app. How do I get back in?' },
  { id: 'bug-refund', expect: 'triage', ticket: 'The sync bug lost a week of my data, so I want my money back for this month.' },
  { id: 'seat-count', expect: 'triage', ticket: 'We removed three seats but the plan page still shows twelve. Is that a display bug or will we be billed?' },
  { id: 'vague', expect: 'triage', ticket: 'It is not working again. Sort it out.' },
];

const models: Record<string, EvaluationModel> = {
  nimble: ollama.evaluationModel('nimble'),
  tev1: ollama.evaluationModel('tev1'),
  'tev1:0.8b': ollama.evaluationModel('tev1:0.8b'),
  'granite4.2:3b': new EvaluationLanguageModel({ model: ollama('granite4.2:3b'), provider: 'ollama.evaluation' }),
};
const only = process.argv.slice(2);

type Row = { model: string; case: string; pass: number; ms: number; choice: string; p: number; decision: string; expect: string; error?: string };
const rows: Row[] = [];

for (const [name, model] of Object.entries(models)) {
  if (only.length && !only.includes(name)) continue;
  // Unload first so no prompt cache survives from an earlier run; the warm-up then
  // pays the load, which is not a decision. Keys above are Ollama model names.
  execFileSync('ollama', ['stop', name]);
  await evaluate({ model, state: 'warm up', questions: { ok: { type: 'boolean', instructions: 'Is this a greeting?' } } }).catch(() => {});
  for (let pass = 1; pass <= PASSES; pass++) {
    for (const c of cases) {
      const started = performance.now();
      try {
        const { answers } = await evaluate({
          model,
          state: { ticket: c.ticket },
          questions: {
            team: {
              type: 'choice',
              instructions: 'Which team should handle `ticket`?',
              criteria: {
                billing: 'Charges, invoices, refunds, plans.',
                engineering: 'Bugs, errors, outages, data loss.',
                support: 'How-to questions and account access.',
              },
            },
          },
        });
        const ms = Math.round(performance.now() - started);
        const p = answers.team.probabilities?.[answers.team.choice] ?? 1;
        const decision = p < 0.7 ? 'triage' : answers.team.choice;
        rows.push({ model: name, case: c.id, pass, ms, choice: answers.team.choice, p, decision, expect: c.expect });
      } catch (error) {
        rows.push({ model: name, case: c.id, pass, ms: Math.round(performance.now() - started), choice: '', p: 0, decision: 'error', expect: c.expect, error: String(error).slice(0, 200) });
      }
      const r = rows.at(-1)!;
      console.log(`${name} #${pass} ${c.id}: ${r.decision} (${r.choice}@${r.p.toFixed(2)}) ${r.ms}ms${r.decision === r.expect ? '' : `  ✗ expected ${r.expect}`}`);
    }
  }
}

mkdirSync('results', { recursive: true });
writeFileSync(`results/bench-${Date.now()}.json`, JSON.stringify(rows, null, 2));

const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
// Pass 1 sees each ticket for the first time. Later passes repeat the same prompt,
// which Ollama can serve from its prompt cache, so they are reported apart.
// Policy match: the routed decision equals the expected one (the labelled team, or
// triage for the three ambiguous tickets). A miss can be a defensible team pick
// that came back too sure to reach the triage threshold.
console.log('\n| Model | Policy match | Stable | p50 ms, first sight | p50 ms, repeat | Policy misses |');
console.log('|---|---|---|---|---|---|');
for (const name of new Set(rows.map((r) => r.model))) {
  const mine = rows.filter((r) => r.model === name);
  const matched = mine.filter((r) => r.decision === r.expect).length;
  const stable = cases.filter((c) => new Set(mine.filter((r) => r.case === c.id).map((r) => r.decision)).size === 1).length / cases.length;
  const wrong = [...new Set(mine.filter((r) => r.decision !== r.expect && r.decision !== 'error' && r.decision !== 'triage').map((r) => `${r.case} → ${r.choice} @ ${r.p.toFixed(2)}`))];
  const errors = mine.filter((r) => r.decision === 'error').length;
  console.log(`| ${name} | ${matched}/${mine.length} | ${Math.round(stable * 100)}% | ${median(mine.filter((r) => r.pass === 1).map((r) => r.ms))} | ${median(mine.filter((r) => r.pass > 1).map((r) => r.ms))} | ${wrong.join(', ') || 'none'}${errors ? ` (${errors} errors)` : ''} |`);
}
