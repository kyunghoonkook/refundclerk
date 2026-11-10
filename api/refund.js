import { pp, getOrderSummary } from '../lib/paypal.js';
import { readJson, send, fail } from '../lib/http.js';

// Executes a refund only after the seller presses the button. Re-checks PayPal first.
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const { orderId, amount, note, requestId } = await readJson(req);
    const facts = await getOrderSummary(orderId);
    const value = Math.round(Number(amount) * 100) / 100;
    if (!facts.captureId || facts.captureStatus === 'REFUNDED') return send(res, 409, { error: 'This payment has nothing left to refund.' });
    if (!(value > 0) || value > facts.refundableRemaining) {
      return send(res, 400, { error: `Refund must be between 0.01 and ${facts.refundableRemaining} ${facts.currency}.` });
    }
    const body = { amount: { value: value.toFixed(2), currency_code: facts.currency } };
    if (note) body.note_to_payer = String(note).slice(0, 255);
    const refund = await pp(`/v2/payments/captures/${facts.captureId}/refund`, {
      method: 'POST',
      body,
      idempotencyKey: `rf-${requestId || orderId}-${value.toFixed(2)}`,
    });
    const after = await getOrderSummary(orderId);
    send(res, 200, { refund: { id: refund.id, status: refund.status, amount: value.toFixed(2) }, order: after });
  } catch (e) {
    fail(res, e);
  }
}
