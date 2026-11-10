import { send } from '../lib/http.js';
import { CATALOG } from '../lib/catalog.js';

export default function handler(req, res) {
  send(res, 200, {
    clientId: process.env.PAYPAL_CLIENT_ID || null,
    catalog: CATALOG,
    aiModel: process.env.AI_MODEL || 'openai/gpt-4o-mini',
  });
}
