import { generateText, tool, stepCountIs, hasToolCall } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { getOrderSummary } from '../lib/paypal.js';
import { readJson, send, fail } from '../lib/http.js';
import { CATALOG } from '../lib/catalog.js';

const SYSTEM = `You are RefundClerk, a refund assistant working for a one-person game studio.
You never move money yourself. You prepare a decision that the seller approves or edits.

Rules you must follow:
- Read the order from PayPal with lookupOrder before deciding. Never invent amounts, dates or statuses.
- Read in-game usage with lookupUsage when the policy depends on usage.
- Apply ONLY the seller's written policy. Quote the exact policy lines you relied on.
- The refund amount must never exceed refundableRemaining from lookupOrder.
- If the order is not captured, is already fully refunded, or the message is unclear, choose ask_customer or decline and say why.
- If the customer is angry, stay plain and polite. No promises the policy does not allow.
- The reply to the customer is short (under 90 words), in the customer's language, signed "Moonpaw team".
Finish by calling submitDecision exactly once.`;

const decisionSchema = z.object({
  action: z.enum(['full_refund', 'partial_refund', 'decline', 'ask_customer']),
  amount: z.number().min(0).describe('Refund amount in order currency. 0 for decline/ask_customer.'),
  policyLines: z.array(z.string()).describe('Exact lines from the seller policy that the decision relies on'),
  facts: z.array(z.string()).describe('Short facts taken from PayPal and usage data, e.g. "Paid $4.99 3 days ago"'),
  reasoning: z.string().describe('Two or three sentences for the seller'),
  reply: z.string().describe('Message to send to the customer'),
  confidence: z.enum(['high', 'medium', 'low']),
});

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const { orderId, message, policy, usage } = await readJson(req);
    if (!message || !policy) return send(res, 400, { error: 'message and policy are required' });

    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    const models = (process.env.AI_MODELS || 'gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.8-flash').split(',').map((x) => x.trim()).filter(Boolean);
    let trace, orderFacts, decision, usedModel, result;
    const errors = [];
    for (const modelId of models) {
    trace = [];
    orderFacts = null;
    decision = null;

    const tools = {
      lookupOrder: tool({
        description: 'Fetch the live PayPal order, capture and refund history for an order ID.',
        inputSchema: z.object({ orderId: z.string() }),
        execute: async ({ orderId: id }) => {
          try {
            orderFacts = await getOrderSummary(id);
            trace.push({ tool: 'lookupOrder', input: id, output: orderFacts });
            return orderFacts;
          } catch (e) {
            trace.push({ tool: 'lookupOrder', input: id, error: e.message });
            return { error: e.message };
          }
        },
      }),
      lookupUsage: tool({
        description: "Read the game's own record of what the buyer did with the item (gems spent, play sessions).",
        inputSchema: z.object({ orderId: z.string() }),
        execute: async ({ orderId: id }) => {
          const u = usage?.[id] || null;
          const out = u
            ? { ...u, catalogItem: CATALOG[u.sku] || null }
            : { note: 'No usage record for this order in the game database.' };
          trace.push({ tool: 'lookupUsage', input: id, output: out });
          return out;
        },
      }),
      submitDecision: tool({
        description: 'Submit the final refund recommendation for the seller to approve.',
        inputSchema: decisionSchema,
        execute: async (d) => {
          decision = d;
          trace.push({ tool: 'submitDecision', output: d });
          return { ok: true };
        },
      }),
    };

    try {
    result = await generateText({
      model: google(modelId),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(22000),
      system: SYSTEM,
      prompt: `Seller policy:\n"""\n${policy}\n"""\n\nOrder ID given by the customer: ${orderId || '(none)'}\nToday: ${new Date().toISOString().slice(0, 10)}\n\nCustomer message:\n"""\n${message}\n"""`,
      tools,
      stopWhen: [hasToolCall('submitDecision'), stepCountIs(6)],
    });
    } catch (e) {
      errors.push(`${modelId}: ${e.message}`);
      continue;
    }
    usedModel = modelId;
    if (decision) break;
    errors.push(`${modelId}: no decision returned`);
    }
    if (!usedModel) return send(res, 503, { error: 'All AI models are busy right now. Please try again in a minute.', details: errors });

    if (!decision) return send(res, 502, { error: 'The agent did not return a decision', text: result?.text, trace, details: errors });

    // Guardrails: the model proposes, the server checks the numbers against PayPal.
    const warnings = [];
    if (decision.action === 'full_refund' || decision.action === 'partial_refund') {
      if (!orderFacts || orderFacts.captureStatus == null) {
        warnings.push('No captured payment was found, so nothing can be refunded.');
        decision.action = 'ask_customer';
        decision.amount = 0;
      } else if (decision.amount > orderFacts.refundableRemaining) {
        warnings.push(`Amount lowered from ${decision.amount} to the refundable remainder ${orderFacts.refundableRemaining}.`);
        decision.amount = orderFacts.refundableRemaining;
      }
      if (decision.amount <= 0) {
        decision.action = 'decline';
        warnings.push('Nothing left to refund on this payment.');
      }
    } else {
      decision.amount = 0;
    }

    send(res, 200, { decision, order: orderFacts, trace, warnings, model: usedModel });
  } catch (e) {
    fail(res, e);
  }
}
