import { pp } from '../lib/paypal.js';
import { readJson, send, fail } from '../lib/http.js';
import { CATALOG } from '../lib/catalog.js';

// POST {sku} -> creates a PayPal order. GET ?id= -> order summary.
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { sku } = await readJson(req);
      const item = CATALOG[sku];
      if (!item) return send(res, 400, { error: 'Unknown item' });
      const order = await pp('/v2/checkout/orders', {
        method: 'POST',
        body: {
          intent: 'CAPTURE',
          purchase_units: [
            {
              custom_id: sku,
              description: item.name,
              amount: {
                currency_code: 'USD',
                value: item.price,
                breakdown: { item_total: { currency_code: 'USD', value: item.price } },
              },
              items: [
                { name: item.name, sku, quantity: '1', category: 'DIGITAL_GOODS', unit_amount: { currency_code: 'USD', value: item.price } },
              ],
            },
          ],
        },
      });
      return send(res, 200, { id: order.id });
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    fail(res, e);
  }
}
