# Don't Let the Model Make the Decision

*Ollama's `tev1` decision model answers narrow questions about a customer message. TypeScript decides what happens. Every number below comes from code in this repo running on a laptop.*

```bash
ollama pull tev1               # Ollama 0.35+ serves decision models on /v1/systemone
pnpm install
pnpm test                      # business rules, no model
pnpm support                   # five conversations: judgments → rules → decision, full trace
pnpm eval-judgments            # 18 labelled messages, false positives/negatives per question
pnpm llm-decides               # same five conversations, a chat model reads the policy and picks
pnpm support nimble            # any of the scripts against another decision model
```

## The tempting pattern

A common way to build an AI support flow is to give a model the conversation, the account and the refund policy, then ask it what to do:

```typescript
const decision = await generateText({
  model,
  prompt: `Here is the customer conversation. Here is their account.
           Here are our refund policies. Decide what we should do.`,
});
```

That asks the model to do two different jobs:

1. Work out what the customer means.
2. Decide what the application is allowed to do.

Only the first one needs a model. The second is business logic, and code already handles business logic well.

When the rules live in the prompt, every policy change becomes a prompt edit and every edge case adds another paragraph. In the end you have a rules engine written in English that runs probabilistically.

## Take the decision apart

A customer writes:

> I'm not saying someone stole my card, but there's a £240 charge from a shop I've never visited. Can you get my money back?

Split the decision into the questions behind it:

| Question | Kind |
|---|---|
| Does the customer want money back? | Judgment |
| Are they reporting an unauthorised charge? | Judgment |
| Are they asking for a human? | Judgment |
| Are they asking for a fee to be waived? | Judgment |
| Is the refund claim eligible? | Fact |
| Is the amount £25 or less? | Fact |
| Does fraud take priority over refunds? | Rule |

Only the judgments need a model to read the language. Everything else can be answered deterministically.

```text
Customer message ──► tev1 judgments ──► + account facts ──► deterministic rules ──► decision
                     (4 probabilities)                       (src/support/decide.ts)
```

## The judgment layer

[`ai-sdk-ollama`](https://github.com/jagreehal/ai-sdk-ollama) exposes Ollama's decision models to the AI SDK's `experimental_decide`. A `boolean` question goes to `/v1/systemone` as Ollama's `noul` type, and the answer comes back as a probability between 0 and 1. From [`src/support/judge.ts`](src/support/judge.ts):

```typescript
export const QUESTIONS = {
  wantsRefund: { type: 'boolean', instructions: 'Does the customer want money back?' },
  reportsFraud: { type: 'boolean', instructions: 'Does the customer report a transaction they did not authorise?' },
  requestsHuman: { type: 'boolean', instructions: 'Does the customer explicitly request a human?' },
  requestsFeeWaiver: { type: 'boolean', instructions: 'Is the customer asking for a fee to be removed or waived?' },
} as const;

export async function judge(message: string, modelId = 'tev1'): Promise<Judgments> {
  const { answers } = await experimental_decide({ model: ollama.decisionModel(modelId), state: { message }, questions: QUESTIONS });
  return { wantsRefund: answers.wantsRefund.probability, /* ...the other three */ };
}
```

None of these questions asks whether the customer *should* get a refund or which team should take the case. The model never sees the £25 limit or the account.

## The decision layer

[`src/support/decide.ts`](src/support/decide.ts) is ordinary TypeScript:

```typescript
export const RULES = { fraudThreshold: 0.6, intentThreshold: 0.8, uncertainBelow: 0.4, autoRefundLimit: 25 };

export function decide(j: Judgments, a: Account, r = RULES) {
  if (j.reportsFraud >= r.fraudThreshold) return { decision: 'FRAUD_REVIEW', reason: ... };
  if (j.requestsHuman >= r.intentThreshold) return { decision: 'HUMAN_HANDOFF', reason: ... };
  if (j.wantsRefund >= r.intentThreshold) {
    if (!a.refundEligible) return { decision: 'REFUND_REVIEW', reason: ... };
    return a.amount <= r.autoRefundLimit ? { decision: 'REFUND', ... } : { decision: 'REFUND_REVIEW', ... };
  }
  if (j.requestsFeeWaiver >= r.intentThreshold) return a.feeWaiverEligible ? { decision: 'WAIVE_FEE', ... } : { decision: 'FEE_REVIEW', ... };
  // Nothing cleared its bar, but something is in the grey zone: a person looks.
  if (anyJudgment >= r.uncertainBelow) return { decision: 'HUMAN_HANDOFF', reason: 'uncertain: ...' };
  return { decision: 'ANSWER', ... };
}
```

The order of the checks is the priority. The fraud threshold sits lower than the others because missing fraud costs more than a false alarm. The grey zone between 0.4 and the threshold goes to a person instead of to code that moves money. These are example thresholds. The eval below shows they need calibrating per model.

Because the rules are code, they are tested like code. [`src/support/decide.test.ts`](src/support/decide.test.ts) has nine tests that run with no model in about half a second:

```typescript
test('fraud takes priority over refund', () => {
  assert.equal(decide({ ...none, wantsRefund: 0.99, reportsFraud: 0.94 }, eligible).decision, 'FRAUD_REVIEW');
});
test('the £25 limit is inclusive', () => { /* 25 → REFUND, 25.01 → REFUND_REVIEW */ });
```

## What actually happened

`pnpm support` on `tev1`, for the message above (full log in [`results/support-latest.txt`](results/support-latest.txt)):

```text
Judgments (tev1, 1263ms):
  wantsRefund       0.99
  reportsFraud      0.90
  requestsHuman     0.47
  requestsFeeWaiver 0.92
Facts:
  refundEligible    false
  amount            240
Rules:
  fraudThreshold    0.6
Decision: FRAUD_REVIEW
Reason:   reportsFraud 0.90 >= 0.6
```

The customer avoided the word fraud, and the model still read it as an unauthorised charge. The decision is right.

The trace also shows something a bare decision log would hide. `requestsFeeWaiver` came back at 0.92, even though the message mentions no fee. That judgment is wrong. It did no harm because the code checks fraud first. The order of the rules, not the model, decided which signal counted.

A log containing only `FRAUD_REVIEW` would look perfect. Here you can see the bad judgment before it ever matters, and you can tell two kinds of failure apart:

- **A judgment was wrong.** Fix the question, change the model or move the threshold. The rules stay the same.
- **The judgment was right but the routing was wrong.** Fix the code and add a unit test. The model stays the same.

The other four conversations:

| Message | Decision | Why |
|---|---|---|
| £35 late fee after a bank holiday, "can you remove it?" | `WAIVE_FEE` | `requestsFeeWaiver` 0.99, account eligible |
| Charged £12 after cancelling, "please refund it" | `REFUND` | `wantsRefund` 0.99, eligible, £12 ≤ £25 |
| "Going round in circles with the chatbot. Put me through to a person." | `HUMAN_HANDOFF` | `requestsHuman` 0.97 |
| "What's my current balance?" | `ANSWER` | every judgment below 0.4 |

Each message took about one second for four questions on an M1 Pro. The balance question returned in 9 ms because the eval had sent the same message moments earlier, so Ollama served it from its prompt cache.

## The same five conversations, with the model deciding

`src/support/llm-decides.ts` runs the tempting pattern for comparison: the same policy as numbered rules in a prompt, plus the account and the message, and a local chat model replies with one action. Three runs per conversation ([`results/llm-decides-latest.txt`](results/llm-decides-latest.txt)):

| Approach | Right | Same answer every run | Time per decision |
|---|---|---|---|
| `tev1` answers 4 questions, `decide()` picks | 15/15 | 5 of 5 conversations | about 1 s |
| `granite4.2:3b` reads the policy and picks | 13/15 | 3 of 5 conversations | 5 to 60 s |
| `qwen3.5:4b` reads the policy and picks | 15/15 | 5 of 5 conversations | 17 to 205 s |

granite sent "What's my current balance?" to a human on one run, and flagged the cancelled £12 subscription as fraud on another. qwen got every decision right, at up to three and a half minutes per message because it reasons before answering, and its log still says only which action it picked, not why.

## Evaluating the judgments

Five correct decisions are an anecdote. The judgment layer needs its own test against labelled messages. [`src/support/eval.ts`](src/support/eval.ts) runs 18 of them: four fraud reports, three refund requests, three human requests, two fee waivers and six that should trigger nothing, including near misses such as "When will my refund from last week arrive?".

`tev1`, Apple M1 Pro 32 GB, macOS 26.4, Ollama 0.40.17, 21 November 2026, median 1,047 ms per message ([`results/judgments-latest.txt`](results/judgments-latest.txt)):

| Question | Positives | Threshold | Missed @ threshold | False alarms @ threshold | Missed @ 0.5 | False alarms @ 0.5 |
|---|---|---|---|---|---|---|
| wantsRefund | 4 | 0.8 | 0 | 1 | 0 | 4 |
| reportsFraud | 4 | 0.6 | 1 | 0 | 1 | 0 |
| requestsHuman | 3 | 0.8 | 2 | 0 | 0 | 0 |
| requestsFeeWaiver | 2 | 0.8 | 0 | 2 | 0 | 3 |

Reading it row by row:

**`wantsRefund`** catches every refund request (0.96 or higher). It also scores "When will my refund from last week arrive?" at 0.95. That customer is asking about the status of a refund, not for a new one, and this decision flow would start a refund review. At 0.5 the false alarms rise to four, because the fee-waiver messages score 0.57–0.59. The 0.8 threshold matters here.

**`reportsFraud`** catches three of the four. It misses "I'm not saying it's fraud, but I've never used that shop." at 0.19, which is the most hedged wording in the set. That message ends up as `ANSWER`, the one result here that a person would call a real mistake.

**`requestsHuman`** scores "put me through to a real person" at 0.95 but "I'd like to speak to a manager" at only 0.71 and "can someone call me?" at 0.52. Both fall below 0.8, and both still reach a person, because the grey-zone rule sends anything above 0.4 to `HUMAN_HANDOFF`. The safety net was written in code before these messages were measured.

**`requestsFeeWaiver`** blurs "refund this charge" with "remove this fee". It scores 0.90 on the £240 message and 0.81 on the cancelled subscription. In both cases `wantsRefund` is 0.99, and `decide()` checks refunds before waivers, so the overlap never changes a decision. That is a property of the rule order, and it is now worth a unit test of its own.

The rules tests all pass, and on their own they would suggest everything is fine. The eval shows where the inputs to those rules are weak, and every fix it points to sits outside the rules code:

- make the questions tighter, for example by asking whether the customer wants money back that has not already been agreed, then rerun the eval,
- set each threshold from this table and from what that mistake costs, not from a round number,
- add deterministic signals next to the judgments, such as "this merchant has never been paid from this account" for fraud.

A probability is not a calibrated confidence. Eighteen messages are enough to show the shape of each question's errors, not to calibrate a production threshold.

## Adding behaviour

The fee waiver was added as one question in `QUESTIONS`, one `if` in `decide()` and one unit test with two cases. The existing judgments did not change and no prompt grew a new paragraph of exceptions.

## Where this fits

This is an LLM classifier, used deliberately: several small, independent questions instead of one model choosing between six outcomes. The answers feed state-machine guards in the same way any other event data would:

```text
message ──► semantic judgments ──► validated event + facts ──► guards ──► transition ──► side effect
```

The model can say a customer sounds urgent. It cannot approve a payment, skip a compliance check or override an insufficient-funds rule, because those decisions are not its job.

There are trade-offs. Every question is more inference work. Small models make mistakes, and the eval above shows four kinds. Questions that are split badly can overlap or conflict. Where the input is already structured, plain code is the better choice. Where the task is open-ended planning or writing, a general-purpose model fits better.

**Let the model interpret the world. Let code enforce the rules.**

---

## Also in this repo: ticket triage across decision models

`src/triage.ts` and `src/bench.ts` route support tickets to billing, engineering or support with a single `choice` question and a 0.7 confidence cut to `triage`. They compare `nimble`, `tev1` and the chat model `granite4.2:3b` (through the AI SDK's `DecisionLanguageModel` adapter, which asks it to self-report probabilities).

```bash
ollama pull nimble && ollama pull tev1 && ollama pull granite4.2:3b
pnpm triage [model]   # four tickets, three questions each
pnpm bench [model]    # 12 labelled tickets x 3 passes on every model
```

`src/bench.ts` unloads each model with `ollama stop` before it runs, so pass 1 measures a ticket the model has not seen. Passes 2 and 3 repeat the same prompts and Ollama serves them from its prompt cache, so the table reports them apart.

### Results

Apple M1 Pro, 32 GB, Ollama 0.35.0, ai 7.0.124, ai-sdk-ollama 4.4.0, 30 September 2026. Full log in `results/bench-latest.txt`, rows in `results/*.json`.

A decision below 0.7 goes to `triage`. "Policy match" means the routed decision equals the expected one: the labelled team for the nine clear tickets, `triage` for the three ambiguous ones. A policy miss on an ambiguous ticket can be a defensible team pick that came back too sure to reach triage.

`confidence` from Ollama measures how concentrated the probabilities are. It is not the chance the answer is right, and this benchmark does not use it.

| Model | Policy match | Stable | p50 ms, first sight | p50 ms, repeat | Policy misses |
|---|---|---|---|---|---|
| nimble | 27/36 | 100% | 928 | 107 | bug-refund → billing @ 0.95, seat-count → billing @ 0.80, vague → engineering @ 0.91 |
| tev1 | 30/36 | 100% | 415 | 67 | bug-refund → billing @ 0.74, vague → engineering @ 0.96 |
| granite4.2:3b | 17/36 | 67% | 562 | 552 | double-charge → support @ 1.00, card-declined → support @ 1.00, webhook-silent → support @ 1.00, safari-blank → support @ 1.00, bug-refund → engineering @ 1.00, seat-count → engineering @ 1.00, vague → engineering @ 1.00, seat-count → support @ 1.00, vague → support @ 1.00 |

### References

- [tev1 on Ollama](https://ollama.com/library/tev1)
- [ai-sdk-ollama](https://github.com/jagreehal/ai-sdk-ollama)
- [Daniel Kahneman, *Thinking, Fast and Slow*](https://en.wikipedia.org/wiki/Thinking,_Fast_and_Slow)

