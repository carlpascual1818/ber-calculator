# Asteral BER Calculator

A Vercel + Supabase React app for dynamic BER, target ROAS, and target CPP planning.

## What it does

- Supplier profiles with switchable cost and cost currency
- Payment processor profiles with processing %, fixed fee, fixed fee currency, FX conversion fee %, and active toggle
- Market profiles with selling currency and payout currency
- Saved scenarios
- 1x to 5x bundle COGS and AOV inputs
- Display currency dropdown, useful when Meta ad costs are in USD
- Live FX through Frankfurter API
- BEROAS, target ROAS, and target CPP at 10%, 15%, 20%, 30%, and 40% margin

## Fee logic

For each active processor:

- Processing fee = processing % × AOV + fixed fee
- Conversion fee = conversion % × AOV only when selling currency and payout currency are different
- If multiple processors are active, the app averages the total processor fee across active processors

For the current Astertoria setup:

- Selling currency: GBP
- Payout currency: HKD
- COGS default currency: USD
- Shopify Payments example: 3.9% + HKD 2.33 fixed + 2% conversion fee

## Supabase setup

1. Create a Supabase project.
2. Go to SQL Editor.
3. Paste and run `supabase/schema.sql`.
4. Go to Project Settings > API.
5. Copy Project URL and anon public key.

## Vercel setup

1. Push this folder to GitHub.
2. Import the repo in Vercel.
3. Add these Environment Variables:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

4. Deploy.

## Local testing

```bash
npm install
cp .env.example .env
npm run dev
```

If Supabase env vars are not set, the app runs in localStorage mode for quick testing.

## Changelog

### v1.0.0

- Built full React/Vite BER calculator app.
- Added dynamic suppliers, processors, markets, and saved scenarios.
- Added Supabase schema with RLS per authenticated user.
- Added live FX conversion via Frankfurter.
- Added localStorage fallback when Supabase is not configured.
- Added target ROAS and CPP rows for 10%, 15%, 20%, 30%, and 40% margin.
