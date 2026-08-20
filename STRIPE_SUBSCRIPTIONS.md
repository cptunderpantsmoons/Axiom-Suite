# Stripe subscriptions

The landing page uses Stripe-hosted Checkout in subscription mode. The browser
never receives `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`; those values are
used only by `stripe_server.py`.

## Configuration

1. Create a recurring Product/Price in Stripe test mode, or use the uploaded
   `stripe-agent` package's `scripts/setup_products.py` after installing the
   Stripe Python SDK.
2. Copy `.env.example` to `.env` and export it in your shell, or export the
   variables individually: `set -a; . ./.env; set +a`.
3. Set `STRIPE_PRICE_ID_BUILDER` and `STRIPE_PRICE_ID_TEAM` to the recurring
   Price IDs for the two paid plans. The server allowlists these plan names and
   never accepts an arbitrary client-supplied Price ID. `STRIPE_PRICE_ID` remains
   supported as a Builder fallback for existing setups.
4. Configure a Stripe webhook endpoint at `<APP_ORIGIN>/webhook` for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`

For local development, use the Stripe CLI to forward events:

```bash
stripe listen --forward-to localhost:5000/webhook
```

Use the `whsec_...` value printed by Stripe CLI as `STRIPE_WEBHOOK_SECRET`.

## Run locally

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python3 stripe_server.py
```

Open <http://localhost:5000>. The **Builder** and **Team** pricing CTAs create
hosted Checkout Sessions using their configured recurring Prices.

Use Stripe's test card `4242 4242 4242 4242`, any future expiry, and any CVC.
Subscription state is updated from signed webhook events in the lightweight
`data/subscriptions.json` store. The store contains IDs and status metadata only;
it is intended as a starter persistence layer and should be replaced with the
application's database before production scale.

## Production notes

- Use a live key and live recurring Price only in the deployment environment.
- Set `APP_ORIGIN` to the exact HTTPS origin used by the landing page.
- Keep the webhook endpoint on the server and verify the signature on every
  request; do not disable verification.
- Replace the JSON store with the application's database and make webhook
  processing idempotent there as well.
- Configure Stripe Customer Portal separately if customers need self-service
  plan changes or cancellations.
