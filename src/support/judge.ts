/**
 * The judgments. Four narrow yes/no questions about the message, nothing about policy.
 * ai-sdk-ollama sends `boolean` to Ollama's /v1/systemone as `noul` and returns a probability.
 */
import { experimental_decide } from 'ai';
import { ollama } from 'ai-sdk-ollama';
import type { Judgments } from './decide.ts';

export const QUESTIONS = {
  wantsRefund: { type: 'boolean', instructions: 'Does the customer want money back?' },
  reportsFraud: { type: 'boolean', instructions: 'Does the customer report a transaction they did not authorise?' },
  requestsHuman: { type: 'boolean', instructions: 'Does the customer explicitly request a human?' },
  requestsFeeWaiver: { type: 'boolean', instructions: 'Is the customer asking for a fee to be removed or waived?' },
} as const;

export async function judge(message: string, modelId = 'tev1'): Promise<Judgments> {
  const { answers } = await experimental_decide({ model: ollama.decisionModel(modelId), state: { message }, questions: QUESTIONS });
  return {
    wantsRefund: answers.wantsRefund.probability,
    reportsFraud: answers.reportsFraud.probability,
    requestsHuman: answers.requestsHuman.probability,
    requestsFeeWaiver: answers.requestsFeeWaiver.probability,
  };
}
