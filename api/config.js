import { send } from '../lib/http.js';
import { CATALOG } from '../lib/catalog.js';

export default function handler(req, res) {
  send(res, 200, {
    clientId: process.env.PAYPAL_CLIENT_ID || null,
    catalog: CATALOG,
    aiModels: process.env.AI_MODELS || 'gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.8-flash',
  });
}
