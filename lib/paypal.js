// Small PayPal REST client (sandbox by default). Credentials come from env only.
const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

let cached = { token: null, exp: 0 };

export async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set');
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PayPal auth failed: ${j.error_description || r.status}`);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

export async function pp(path, { method = 'GET', body, idempotencyKey } = {}) {
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const detail = j.details?.[0]?.description || j.message || r.status;
    const err = new Error(`PayPal ${method} ${path} failed: ${detail}`);
    err.status = r.status;
    err.paypal = j;
    throw err;
  }
  return j;
}

// Flatten an order into the facts a refund decision needs.
export function summarizeOrder(order) {
  const pu = order.purchase_units?.[0] || {};
  const cap = pu.payments?.captures?.[0];
  const refunds = pu.payments?.refunds || [];
  const refunded = refunds
    .filter((x) => x.status !== 'FAILED' && x.status !== 'CANCELLED')
    .reduce((s, x) => s + Number(x.amount?.value || 0), 0);
  const paid = Number(cap?.amount?.value || 0);
  const paidAt = cap?.create_time || order.create_time;
  const days = paidAt ? Math.floor((Date.now() - new Date(paidAt).getTime()) / 86_400_000) : null;
  return {
    orderId: order.id,
    orderStatus: order.status,
    item: pu.items?.[0]?.name || pu.description || null,
    sku: pu.items?.[0]?.sku || pu.custom_id || null,
    currency: cap?.amount?.currency_code || pu.amount?.currency_code,
    captureId: cap?.id || null,
    captureStatus: cap?.status || null,
    paidAmount: paid,
    paidAt,
    daysSincePayment: days,
    alreadyRefunded: Math.round(refunded * 100) / 100,
    refundableRemaining: Math.max(0, Math.round((paid - refunded) * 100) / 100),
    refunds: refunds.map((x) => ({ id: x.id, status: x.status, amount: x.amount?.value })),
  };
}

export async function getOrderSummary(orderId) {
  if (!/^[A-Z0-9]{10,20}$/.test(orderId || '')) throw new Error('That does not look like a PayPal order ID');
  const order = await pp(`/v2/checkout/orders/${orderId}`);
  return summarizeOrder(order);
}
