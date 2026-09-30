/**
 * Ticket triage with an Ollama decision model.
 * Setup: ollama pull nimble (Ollama 0.35+)
 * Run: pnpm triage [model]
 */
import { experimental_evaluate as evaluate } from 'ai';
import { ollama } from 'ai-sdk-ollama';

const modelId = process.argv[2] ?? 'nimble';

const tickets = [
  'I was charged twice this month. Please refund the extra payment.',
  'Checkout has returned 500 errors since 9am and we are losing sales!',
  'How do I export my data to CSV?',
  'Your app deleted my invoices after the update and I need them for my accountant tomorrow.',
];

for (const ticket of tickets) {
  const started = performance.now();
  const { answers, usage, providerMetadata } = await evaluate({
    model: ollama.evaluationModel(modelId),
    state: { ticket },
    questions: {
      team: {
        type: 'choice',
        instructions: 'Which team should handle `ticket`?',
        criteria: {
          billing: 'Charges, invoices, refunds.',
          engineering: 'Bugs, errors, outages, data loss.',
          support: 'How-to questions and account help.',
        },
      },
      refund: { type: 'boolean', instructions: 'Does `ticket` explicitly ask for a refund?' },
      urgency: { type: 'score', instructions: 'How urgent is `ticket`?', criteria: ['Routine', 'Soon', 'Urgent'] },
    },
  });
  const ms = Math.round(performance.now() - started);

  // The policy lives in code: a close race goes to a human.
  const p = answers.team.probabilities?.[answers.team.choice] ?? 0;
  const queue = p < 0.7 ? 'triage' : answers.team.choice;
  const priority = answers.urgency.score >= 1.5 ? 'p1' : 'p2';

  console.log(ticket);
  console.log(`  queue=${queue} priority=${priority} team=${answers.team.choice}@${p.toFixed(2)} refund=${answers.refund.probability.toFixed(2)} urgency=${answers.urgency.score.toFixed(2)}/2`);
  console.log(`  ${ms}ms, ${usage.inputTokens} in / ${usage.outputTokens} out, confidence ${JSON.stringify(providerMetadata?.ollama?.confidence)}\n`);
}
