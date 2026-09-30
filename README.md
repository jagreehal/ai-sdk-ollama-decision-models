# ai-sdk-ollama-decision-models

Ollama 0.35 serves decision models (`nimble`, `tev1`, `tev1:0.8b`) on `/v1/systemone`. [`ai-sdk-ollama`](https://github.com/jagreehal/ai-sdk-ollama) 4.4.0 exposes them as `ollama.evaluationModel()` for the AI SDK's `experimental_evaluate`.

```bash
ollama pull nimble && ollama pull tev1 && ollama pull tev1:0.8b && ollama pull granite4.2:3b
pnpm install
pnpm triage          # four tickets, three questions each, on nimble
pnpm triage tev1     # same on another model
pnpm bench           # 12 labelled tickets x 3 passes on every model
pnpm bench nimble    # one model
```

`src/bench.ts` unloads each model with `ollama stop` before it runs, so pass 1 measures a ticket the model has not seen. Passes 2 and 3 repeat the same prompts and Ollama serves them from its prompt cache, so the table reports them apart. `granite4.2:3b` is a chat model; it answers through the AI SDK's `EvaluationLanguageModel` adapter, which asks it to self-report probabilities.

## Results

Apple M1 Pro, 32 GB, Ollama 0.35.0, ai 7.0.124, ai-sdk-ollama 4.4.0, 30 September 2026. Full log in `results/bench-latest.txt`, rows in `results/*.json`.

A decision below 0.7 goes to `triage`. "Policy match" means the routed decision equals the expected one: the labelled team for the nine clear tickets, `triage` for the three ambiguous ones. A policy miss on an ambiguous ticket can be a defensible team pick that came back too sure to reach triage.

`confidence` from Ollama measures how concentrated the probabilities are. It is not the chance the answer is right, and this benchmark does not use it.

| Model | Policy match | Stable | p50 ms, first sight | p50 ms, repeat | Policy misses |
|---|---|---|---|---|---|
| nimble | 27/36 | 100% | 928 | 107 | bug-refund → billing @ 0.95, seat-count → billing @ 0.80, vague → engineering @ 0.91 |
| tev1 | 30/36 | 100% | 415 | 67 | bug-refund → billing @ 0.74, vague → engineering @ 0.96 |
| tev1:0.8b | 27/36 | 100% | 97 | 39 | bug-refund → engineering @ 0.82, seat-count → billing @ 0.77, vague → engineering @ 0.85 |
| granite4.2:3b | 17/36 | 67% | 562 | 552 | double-charge → support @ 1.00, card-declined → support @ 1.00, webhook-silent → support @ 1.00, safari-blank → support @ 1.00, bug-refund → engineering @ 1.00, seat-count → engineering @ 1.00, vague → engineering @ 1.00, seat-count → support @ 1.00, vague → support @ 1.00 |
