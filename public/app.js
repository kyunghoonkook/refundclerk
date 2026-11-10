const $ = (s, el = document) => el.querySelector(s);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('rc:' + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('rc:' + k, JSON.stringify(v)); },
};

const DEFAULT_POLICY = `1. Unused gem packs: full refund within 14 days of purchase.
2. Partly used gem packs: refund the unused share of the price, rounded down to the cent, within 14 days.
3. Season Pass: full refund within 48 hours if fewer than 3 play sessions; after that, no refund.
4. Anything older than 14 days: no refund, but offer 20% bonus gems instead.
5. Duplicate or accidental purchases of the same item on the same day: full refund of the duplicate.
6. If the customer reports a bug that blocked the item, refund in full and ask for steps to reproduce.`;

let config = null;
let purchases = store.get('purchases', []);
let requests = store.get('requests', []);
let policy = store.get('policy', DEFAULT_POLICY);
let selectedReq = null;
const money = (n) => '$' + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const save = () => { store.set('purchases', purchases); store.set('requests', requests); };

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

/* ---------- views ---------- */
document.querySelectorAll('.switch button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.switch button').forEach((x) => x.classList.toggle('on', x === b));
    $('#view-shop').hidden = b.dataset.view !== 'shop';
    $('#view-desk').hidden = b.dataset.view !== 'desk';
    if (b.dataset.view === 'desk') renderInbox();
  })
);

/* ---------- shop ---------- */
function renderCatalog() {
  const icons = { 'gems-500': '◆', 'gems-1200': '◆◆', 'season-pass': '★' };
  $('#catalog').innerHTML = Object.entries(config.catalog)
    .map(([sku, it]) => `<div class="item"><div class="art">${icons[sku] || '◆'}</div>
      <div><strong>${esc(it.name)}</strong><div class="muted small">${it.gems ? it.gems.toLocaleString() + ' gems, digital item' : '30 days of bonus levels'}</div></div>
      <div class="row between"><span class="price">${money(it.price)}</span><button class="primary" data-buy="${sku}">Buy</button></div></div>`)
    .join('');
  $('#catalog').querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => openBuy(b.dataset.buy)));
}

let sdkReady = null;
function loadSdk() {
  if (sdkReady) return sdkReady;
  sdkReady = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=USD&intent=capture&locale=en_US`;
    s.onload = res; s.onerror = () => rej(new Error('PayPal SDK failed to load'));
    document.head.appendChild(s);
  });
  return sdkReady;
}

async function openBuy(sku) {
  const it = config.catalog[sku];
  $('#buyBox').hidden = false;
  $('#buyTitle').textContent = `${it.name} · ${money(it.price)}`;
  $('#paypal-buttons').innerHTML = '';
  await loadSdk();
  paypal.Buttons({
    style: { layout: 'vertical', shape: 'rect', label: 'pay' },
    createOrder: async () => (await api('/api/orders', { sku })).id,
    onApprove: async ({ orderID }) => {
      const o = await api('/api/capture', { orderId: orderID });
      purchases.unshift({ orderId: o.orderId, sku, name: it.name, price: it.price, gems: it.gems, spent: 0, sessions: 0, paidAt: o.paidAt, captureId: o.captureId });
      save();
      $('#buyBox').hidden = true;
      renderPurchases();
    },
    onError: (e) => alert('PayPal error: ' + e.message),
  }).render('#paypal-buttons');
}
$('#buyCancel').addEventListener('click', () => ($('#buyBox').hidden = true));

function renderPurchases() {
  if (!purchases.length) { $('#purchases').innerHTML = '<p class="empty">Nothing bought yet.</p>'; return; }
  $('#purchases').innerHTML = purchases.map((p, i) => {
    const req = requests.find((r) => r.orderId === p.orderId);
    const st = req ? (req.status === 'refunded' ? `<span class="tag ok">Refunded ${money(req.refundAmount)}</span>` : req.status === 'replied' ? '<span class="tag">Seller replied</span>' : '<span class="tag warn">Refund requested</span>') : '<span class="tag">Paid</span>';
    const usage = p.gems ? `${(p.gems - p.spent).toLocaleString()} of ${p.gems.toLocaleString()} gems left` : `${p.sessions} play sessions`;
    return `<div class="purchase"><div><strong>${esc(p.name)}</strong> · ${money(p.price)}
      <div class="meta">Order <code>${p.orderId}</code> · ${new Date(p.paidAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · ${usage}</div>
      ${req?.reply ? `<div class="meta">Seller: ${esc(req.reply)}</div>` : ''}</div>
      <div class="row end">${st}
      <button class="small" data-play="${i}">${p.gems ? 'Spend 100 gems' : 'Play a session'}</button>
      ${req ? '' : `<button class="small" data-refund="${i}">Ask for refund</button>`}</div></div>`;
  }).join('');
  $('#purchases').querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
    const p = purchases[b.dataset.play];
    if (p.gems) p.spent = Math.min(p.gems, p.spent + 100); else p.sessions += 1;
    p.lastPlayed = new Date().toISOString(); save(); renderPurchases();
  }));
  $('#purchases').querySelectorAll('[data-refund]').forEach((b) => b.addEventListener('click', () => openRefund(purchases[b.dataset.refund])));
}

let refundTarget = null;
function openRefund(p) {
  refundTarget = p;
  $('#refundFor').textContent = `${p.name} · order ${p.orderId}`;
  $('#refundMsg').value = '';
  $('#refundDlg').showModal();
}
$('#refundDlg').addEventListener('close', () => {
  if ($('#refundDlg').returnValue !== 'send' || !refundTarget) return;
  const msg = $('#refundMsg').value.trim();
  if (!msg) return;
  requests.unshift({ id: crypto.randomUUID(), orderId: refundTarget.orderId, item: refundTarget.name, message: msg, createdAt: new Date().toISOString(), status: 'open' });
  save(); renderPurchases(); renderInbox();
});

/* ---------- seller desk ---------- */
$('#policy').value = policy;
$('#policy').addEventListener('input', () => { policy = $('#policy').value; store.set('policy', policy); $('#policySaved').textContent = 'Saved'; });
$('#policyReset').addEventListener('click', () => { policy = DEFAULT_POLICY; $('#policy').value = policy; store.set('policy', policy); });
$('#manualBtn').addEventListener('click', () => {
  const orderId = (prompt('PayPal sandbox order ID') || '').trim().toUpperCase();
  if (!orderId) return;
  const message = (prompt('What did the customer write?') || '').trim();
  if (!message) return;
  requests.unshift({ id: crypto.randomUUID(), orderId, item: 'Order ' + orderId, message, createdAt: new Date().toISOString(), status: 'open' });
  save(); renderInbox();
});

function renderInbox() {
  const open = requests.filter((r) => r.status === 'open').length;
  $('#inboxCount').hidden = !open; $('#inboxCount').textContent = open;
  if (!requests.length) { $('#inbox').innerHTML = '<p class="empty">No refund requests yet.</p>'; return; }
  $('#inbox').innerHTML = requests.map((r) => `<button class="req ${selectedReq === r.id ? 'sel' : ''}" data-id="${r.id}">
    <span class="t"><span>${esc(r.item)}</span>${statusTag(r)}</span><span class="p">${esc(r.message)}</span></button>`).join('');
  $('#inbox').querySelectorAll('.req').forEach((b) => b.addEventListener('click', () => openCase(b.dataset.id)));
}
const statusTag = (r) => r.status === 'refunded' ? `<span class="tag ok">Refunded</span>` : r.status === 'replied' ? '<span class="tag">Replied</span>' : '<span class="tag warn">Open</span>';

function usageMap() {
  const m = {};
  for (const p of purchases) m[p.orderId] = { sku: p.sku, gemsGranted: p.gems, gemsSpent: p.spent, playSessions: p.sessions, lastPlayed: p.lastPlayed || null };
  return m;
}

function openCase(id) {
  selectedReq = id; renderInbox();
  const r = requests.find((x) => x.id === id);
  const node = $('#tplCase').content.cloneNode(true);
  const root = $('#case'); root.innerHTML = ''; root.appendChild(node);
  $('.oid', root).textContent = r.orderId;
  $('.cust-title', root).textContent = r.item;
  $('.status', root).outerHTML = statusTag(r);
  $('.msg', root).textContent = r.message;
  if (r.result) showResult(r, r.result);
  $('.run', root).addEventListener('click', async () => {
    $('.run', root).disabled = true; $('.running', root).hidden = false;
    try {
      const out = await api('/api/agent', { orderId: r.orderId, message: r.message, policy, usage: usageMap() });
      r.result = out; save(); showResult(r, out);
    } catch (e) { alert(e.message); }
    finally { $('.run', root).disabled = false; $('.running', root).hidden = true; }
  });
}

const LABEL = { full_refund: 'Full refund', partial_refund: 'Partial refund', decline: 'Decline', ask_customer: 'Ask the customer first' };
function describeStep(s) {
  if (s.tool === 'lookupOrder') return s.error ? `<code>lookupOrder</code> failed: ${esc(s.error)}` :
    `<code>lookupOrder</code> PayPal says ${esc(s.output.orderStatus)}, capture ${esc(s.output.captureStatus || 'none')}, paid ${money(s.output.paidAmount)} ${s.output.daysSincePayment} day(s) ago, refundable ${money(s.output.refundableRemaining)}`;
  if (s.tool === 'lookupUsage') return s.output.note ? `<code>lookupUsage</code> ${esc(s.output.note)}` :
    `<code>lookupUsage</code> ${s.output.gemsGranted ? `${s.output.gemsSpent} of ${s.output.gemsGranted} gems spent` : `${s.output.playSessions} play sessions`}`;
  if (s.tool === 'submitDecision') return `<code>submitDecision</code> ${esc(LABEL[s.output.action])}${s.output.amount ? ' ' + money(s.output.amount) : ''} (${esc(s.output.confidence)} confidence)`;
  return `<code>${esc(s.tool)}</code>`;
}

function showResult(r, out) {
  const root = $('#case'); const d = out.decision;
  $('.result', root).hidden = false;
  const v = $('.verdict', root); v.className = 'verdict ' + d.action;
  v.textContent = LABEL[d.action] + (d.amount ? ` · ${money(d.amount)}` : '');
  $('.facts', root).innerHTML = d.facts.map((f) => `<li>${esc(f)}</li>`).join('');
  $('.lines', root).innerHTML = d.policyLines.map((f) => `<li>${esc(f)}</li>`).join('');
  $('.why', root).textContent = d.reasoning;
  const w = $('.warn', root); w.hidden = !out.warnings?.length; w.textContent = (out.warnings || []).join(' ');
  $('.steps', root).innerHTML = out.trace.map((s) => `<li>${describeStep(s)}</li>`).join('') + `<li class="muted">model ${esc(out.model)}</li>`;
  $('.reply', root).value = r.reply || d.reply;
  $('.amount', root).value = (d.amount || 0).toFixed(2);
  const refundable = out.order?.refundableRemaining ?? 0;
  $('.amount', root).max = refundable;
  const go = $('.go', root);
  go.disabled = r.status !== 'open' || refundable <= 0;
  const done = $('.done', root);
  if (r.status === 'refunded') { done.hidden = false; done.textContent = `Refunded ${money(r.refundAmount)} · PayPal refund ${r.refundId} (${r.refundStatus})`; }
  go.onclick = async () => {
    const amount = Number($('.amount', root).value);
    if (!confirm(`Refund ${money(amount)} to the buyer through PayPal?`)) return;
    go.disabled = true;
    try {
      const x = await api('/api/refund', { orderId: r.orderId, amount, note: $('.reply', root).value.slice(0, 255), requestId: r.id });
      Object.assign(r, { status: 'refunded', refundAmount: x.refund.amount, refundId: x.refund.id, refundStatus: x.refund.status, reply: $('.reply', root).value });
      save(); done.className = 'done'; done.hidden = false;
      done.textContent = `Refunded ${money(x.refund.amount)} · PayPal refund ${x.refund.id} (${x.refund.status}). Order now has ${money(x.order.refundableRemaining)} refundable.`;
      renderInbox(); renderPurchases();
    } catch (e) { done.className = 'done err'; done.hidden = false; done.textContent = e.message; go.disabled = false; }
  };
  $('.close', root).onclick = () => {
    Object.assign(r, { status: r.status === 'refunded' ? 'refunded' : 'replied', reply: $('.reply', root).value });
    save(); done.className = 'done'; done.hidden = false; done.textContent = 'Reply saved and shown to the customer.'; renderInbox(); renderPurchases();
  };
}

/* ---------- boot ---------- */
(async () => {
  config = await api('/api/config');
  renderCatalog(); renderPurchases(); renderInbox();
  if (!config.clientId) $('#catalog').insertAdjacentHTML('beforebegin', '<p class="done err">PAYPAL_CLIENT_ID is not configured on the server.</p>');
})();
