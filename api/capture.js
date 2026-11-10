import { pp, summarizeOrder } from '../lib/paypal.js';
import { readJson, send, fail } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const { orderId } = await readJson(req);
    if (!/^[A-Z0-9]{10,20}$/.test(orderId || '')) return send(res, 400, { error: 'Bad order id' });
    await pp(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST', idempotencyKey: `cap-${orderId}` });
    const order = await pp(`/v2/checkout/orders/${orderId}`);
    send(res, 200, summarizeOrder(order));
  } catch (e) {
    fail(res, e);
  }
}
