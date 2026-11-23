# BBB.id

A marketplace for university students in Magelang. Students register, list items for sale, browse listings and pay through YoBasePay. The pages are plain HTML and JavaScript styled with Tailwind; the backend is a set of Vercel serverless functions on top of Supabase.

[Bahasa Indonesia](README.id.md)

## What it does

- Registration, login and password reset through Supabase Auth, with a student profile (campus, phone, entry year).
- A marketplace page, a product detail page and a form to add a product.
- Orders and online payment. Payments are created and checked through the YoBasePay API. The webhook verifies an HMAC-SHA256 signature before it updates a payment.
- A user dashboard.

## Tech stack

HTML, vanilla JavaScript, Tailwind CSS, Vercel serverless functions (`api/`), Supabase (Auth and Postgres), YoBasePay.

## Getting started

Requirements: a current LTS release of Node.js, a Supabase project and a YoBasePay account.

```bash
npm install
cp .env.example .env     # fill in the values below
npm run build            # compile Tailwind into app.css
npm test                 # orders, payments and profile tests
```

Apply `supabase/migrations/202604220001_marketplace_payments.sql` to your database. Run the functions locally with `vercel dev`.

### Environment variables

| Variable | Used for |
| --- | --- |
| `APP_BASE_URL` | Public URL of the site |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database access in `api/` only |
| `YOBASEPAY_API_ORIGIN`, `YOBASEPAY_API_KEY` | YoBasePay API calls |
| `YOBASEPAY_SECRET`, `YOBASEPAY_WEBHOOK_SECRET` | Signing and verifying payment webhooks |

The service role key must stay on the server. Never expose it to the browser.

## Project structure

```
beranda/ marketplace/ detail_produk/ tambah_produk/ dashboard/
login/ registrasi/ lupa_password/     page folders
api/                                  products, orders, profile, payments (create, status, webhook)
supabase/migrations/                  database schema
test/                                 node:test suites
tools/verify.mjs                      project checks (npm run verify)
```

The root URL redirects to `/beranda/beranda.html` (`vercel.json`).
