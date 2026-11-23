# BBB.id

BBB.id is a marketplace built for university students in Magelang to buy and sell secondhand items with other students on their own campus, instead of a generic classifieds site where the other party could be anyone. A student registers with their campus and entry year, lists an item, and another student can browse, order and pay for it online through YoBasePay. The pages are plain HTML and JavaScript styled with Tailwind CSS; the logic that talks to the database and the payment provider runs as Vercel serverless functions, with Supabase as the database and authentication provider.

[Baca dalam Bahasa Indonesia di bawah](#bahasa-indonesia)

## What it does

- **Student accounts.** Registration, login and password reset through Supabase Auth, with a profile that records campus, phone number and entry year, so buyers and sellers can see they are dealing with another real student rather than an anonymous stranger.
- **Marketplace, product detail and listing.** A marketplace page to browse items, a detail page per product, and a form for a seller to list a new one.
- **Orders and payment.** A buyer places an order and pays through YoBasePay. The payment API routes (`api/payments/create.js`, `status.js`) create and check the payment, and `api/payments/webhook.js` receives YoBasePay's callback, verifies its HMAC-SHA256 signature against a shared secret before trusting it, and only then marks the order as paid.
- **User dashboard.** A page where a student can see their own listings and orders.

## Why it is built this way

There is no long-running backend server: the HTML pages call a handful of serverless functions under `api/`, each one a small, single-purpose Node.js module (list products, create an order, create a payment, etc.), and Vercel runs each on demand. That keeps hosting simple and cheap for a project with modest, bursty traffic, while Supabase's Postgres database and row-level security do the work of keeping one student's data separate from another's.

## Tech stack

HTML, vanilla JavaScript, Tailwind CSS (compiled with the Tailwind CLI, not a bundler), Vercel serverless functions under `api/`, Supabase (Auth and Postgres), YoBasePay for payments.

## Getting started

Requirements: a current LTS release of Node.js, a Supabase project, and a YoBasePay merchant account (sandbox credentials are enough for development).

```bash
npm install
cp .env.example .env     # fill in the values below
npm run build            # compiles Tailwind's src/app.css into app.css
npm test                 # runs the orders, payments and profile test suites
```

Apply the schema in `supabase/migrations/202604220001_marketplace_payments.sql` to your Supabase project (through the SQL editor, or the Supabase CLI). To run the serverless functions locally, use `vercel dev`, which serves both the static pages and the `api/` functions on one local URL the same way Vercel does in production.

### Environment variables

| Variable | Used for |
| --- | --- |
| `APP_BASE_URL` | The public URL of the site, used when building links back to it (for example in payment redirects) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | The Supabase client used by pages running in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Full database access, used only inside `api/` on the server; this key must never reach the browser |
| `YOBASEPAY_API_ORIGIN`, `YOBASEPAY_API_KEY` | Calling the YoBasePay API to create and check payments |
| `YOBASEPAY_SECRET`, `YOBASEPAY_WEBHOOK_SECRET` | Signing requests to YoBasePay and verifying that an incoming webhook really came from YoBasePay |

## Project structure

```
beranda/ marketplace/ detail_produk/ tambah_produk/ dashboard/   static pages, one folder per screen
login/ registrasi/ lupa_password/                                 auth pages
api/                                                               serverless functions: products, orders, profile, payments
api/payments/                                                      create.js, status.js, webhook.js
supabase/migrations/                                               the database schema
test/                                                               node:test suites for orders, payments and profile
tools/verify.mjs                                                   a project sanity check, run with npm run verify
```

The root URL redirects to `/beranda/beranda.html` (configured in `vercel.json`).

---

## Bahasa Indonesia

BBB.id adalah marketplace yang dibuat untuk mahasiswa di Magelang supaya bisa jual beli barang bekas dengan mahasiswa lain di kampusnya sendiri, bukan di situs jual beli umum yang lawan transaksinya bisa siapa saja. Mahasiswa mendaftar dengan kampus dan tahun masuknya, memasang barang untuk dijual, dan mahasiswa lain bisa menelusuri, memesan, dan membayar secara online lewat YoBasePay. Halamannya HTML dan JavaScript biasa dengan Tailwind CSS, sedangkan logika yang berbicara ke database dan penyedia pembayaran berjalan sebagai fungsi serverless Vercel, dengan Supabase sebagai database dan penyedia autentikasi.

### Fungsi

- **Akun mahasiswa.** Pendaftaran, login, dan reset kata sandi lewat Supabase Auth, dengan profil yang mencatat kampus, nomor telepon, dan tahun masuk, sehingga pembeli dan penjual tahu mereka berurusan dengan mahasiswa sungguhan, bukan orang asing anonim.
- **Marketplace, detail produk, dan listing.** Halaman marketplace untuk menelusuri barang, halaman detail per produk, dan formulir bagi penjual untuk memasang barang baru.
- **Pesanan dan pembayaran.** Pembeli memesan dan membayar lewat YoBasePay. Rute API pembayaran (`api/payments/create.js`, `status.js`) membuat dan memeriksa pembayaran, dan `api/payments/webhook.js` menerima callback dari YoBasePay, memverifikasi tanda tangan HMAC-SHA256-nya terhadap secret bersama sebelum dipercaya, dan baru setelah itu menandai pesanan sebagai lunas.
- **Dashboard pengguna.** Halaman tempat mahasiswa melihat listing dan pesanannya sendiri.

### Mengapa dibangun seperti ini

Tidak ada server backend yang berjalan terus-menerus: halaman HTML memanggil beberapa fungsi serverless di bawah `api/`, masing-masing modul Node.js kecil dengan satu tujuan (daftar produk, buat pesanan, buat pembayaran, dan seterusnya), lalu Vercel menjalankannya sesuai kebutuhan. Ini membuat hosting sederhana dan murah untuk proyek dengan trafik yang tidak terlalu besar dan naik-turun, sementara database Postgres Supabase dan row-level security-nya menjaga data satu mahasiswa terpisah dari mahasiswa lain.

### Teknologi

HTML, JavaScript vanilla, Tailwind CSS (dikompilasi dengan Tailwind CLI, bukan bundler), fungsi serverless Vercel di bawah `api/`, Supabase (Auth dan Postgres), YoBasePay untuk pembayaran.

### Menjalankan

Kebutuhan: Node.js rilis LTS terbaru, proyek Supabase, dan akun merchant YoBasePay (kredensial sandbox sudah cukup untuk pengembangan).

```bash
npm install
cp .env.example .env     # isi nilai di bawah
npm run build            # mengompilasi src/app.css Tailwind ke app.css
npm test                 # menjalankan suite uji pesanan, pembayaran, dan profil
```

Terapkan skema di `supabase/migrations/202604220001_marketplace_payments.sql` ke proyek Supabase (lewat SQL editor, atau Supabase CLI). Untuk menjalankan fungsi serverless secara lokal, pakai `vercel dev`, yang menyajikan halaman statis dan fungsi `api/` di satu URL lokal, sama seperti Vercel di produksi.

### Variabel lingkungan

| Variabel | Kegunaan |
| --- | --- |
| `APP_BASE_URL` | URL publik situs, dipakai saat membangun tautan balik ke situs (misalnya pada redirect pembayaran) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Klien Supabase yang dipakai halaman di peramban |
| `SUPABASE_SERVICE_ROLE_KEY` | Akses database penuh, hanya dipakai di dalam `api/` di server; kunci ini tidak boleh sampai ke peramban |
| `YOBASEPAY_API_ORIGIN`, `YOBASEPAY_API_KEY` | Memanggil API YoBasePay untuk membuat dan memeriksa pembayaran |
| `YOBASEPAY_SECRET`, `YOBASEPAY_WEBHOOK_SECRET` | Menandatangani permintaan ke YoBasePay dan memverifikasi bahwa webhook yang masuk benar-benar dari YoBasePay |

### Struktur

```
beranda/ marketplace/ detail_produk/ tambah_produk/ dashboard/   halaman statis, satu folder per layar
login/ registrasi/ lupa_password/                                 halaman autentikasi
api/                                                               fungsi serverless: produk, pesanan, profil, pembayaran
api/payments/                                                      create.js, status.js, webhook.js
supabase/migrations/                                               skema database
test/                                                               suite uji node:test untuk pesanan, pembayaran, profil
tools/verify.mjs                                                   pemeriksaan kesehatan proyek, jalankan dengan npm run verify
```

URL root diarahkan ke `/beranda/beranda.html` (diatur di `vercel.json`).
