# RefundClerk

A refund desk for people who sell digital goods alone.

When you run a small web game by yourself, refund mail arrives at odd hours and each one means opening PayPal, finding the order, checking whether the gems were spent, rereading your own refund rules and then typing a reply. RefundClerk does the reading. It pulls the real order from PayPal, looks at how the item was used in the game, applies the refund policy you wrote in plain English and proposes a decision with the exact policy lines it used. Nothing is refunded until you press the button.

Built for the PayPal AI Hackathon (2026).

## What it does

- **Customer side**: a small demo shop (Moonpaw gem packs and a season pass) with PayPal Checkout in sandbox mode. After paying, the buyer can spend gems or play sessions, then send a refund request.
- **Seller desk**: an inbox of refund requests. "Review with agent" runs an AI agent that
  1. calls `lookupOrder`: live PayPal Orders v2 data (status, capture, amount, refunds already made, days since payment),
  2. calls `lookupUsage`: the game's own record of gems spent or sessions played,
  3. calls `submitDecision`: full refund, partial refund, decline or ask the customer, with amount, the policy lines used, facts, reasoning and a reply draft.
- The seller can edit the amount and reply, then press **Refund via PayPal**. The server re-reads the order and calls the PayPal Payments v2 refund API on the capture, with an idempotency key so a double click cannot refund twice.
- Guardrails sit outside the model: the server clamps any proposed amount to what PayPal says is still refundable, and refuses refunds on uncaptured or fully refunded payments.

## PayPal APIs used

| Step | API |
| --- | --- |
| Checkout button | PayPal JavaScript SDK (Buttons) |
| Create order | `POST /v2/checkout/orders` (intent CAPTURE, digital goods line item) |
| Capture | `POST /v2/checkout/orders/{id}/capture` |
| Agent tool `lookupOrder` | `GET /v2/checkout/orders/{id}` |
| Refund (seller approved) | `POST /v2/payments/captures/{id}/refund` with `PayPal-Request-Id` |
| Auth | `POST /v1/oauth2/token` (client credentials) |

## AI

- Agent loop with tool calling via the [Vercel AI SDK](https://ai-sdk.dev) (`generateText`, `tool`, `stopWhen`).
- Model: `openai/gpt-4o-mini` through the Vercel AI Gateway (change with `AI_MODEL`).
- The model only sees the order facts, the usage record, the policy and the message. It has no tool that moves money.
- I also used Claude as a coding assistant while building this.

## Try it

Hosted demo: see the Devpost page for the URL.

1. Open **Customer**, buy a gem pack with a PayPal sandbox personal account.
2. Press **Spend 100 gems** a few times so the pack is partly used.
3. **Ask for refund** and write a message, for example "bought by mistake, can I get my money back?"
4. Switch to **Seller desk**, open the request, press **Review with agent**.
5. Check the recommendation and the trace, then press **Refund via PayPal**. The refund ID and new refundable balance come back from PayPal.

You can also review any sandbox order by ID with **+ By order ID**.

Refund requests, purchases and usage records are kept in the browser's localStorage for the demo. In a real game they would come from the game's database; PayPal stays the source of truth for money.

## Run locally

Requires Node 20+ and the [Vercel CLI](https://vercel.com/docs/cli).

```bash
git clone https://github.com/kyunghoonkook/refundclerk
cd refundclerk
npm install
cp .env.example .env   # fill in sandbox client ID/secret and an AI Gateway key
vercel dev
```

Create sandbox credentials at developer.paypal.com > Apps & Credentials > Sandbox. Sandbox buyer accounts are under Testing Tools > Sandbox Accounts.

## Project layout

```
api/            serverless functions (orders, capture, order, agent, refund, config)
lib/paypal.js   PayPal REST client and order summary
public/         the web app (plain HTML, CSS, JS)
```

## License

MIT
