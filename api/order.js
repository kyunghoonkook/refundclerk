import { getOrderSummary } from '../lib/paypal.js';
import { send, fail } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    send(res, 200, await getOrderSummary(id));
  } catch (e) {
    fail(res, e);
  }
}
