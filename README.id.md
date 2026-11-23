# BBB.id

Marketplace untuk mahasiswa di Magelang. Mahasiswa mendaftar, memasang barang untuk dijual, menelusuri iklan, dan membayar lewat YoBasePay. Halamannya HTML dan JavaScript biasa dengan Tailwind, sedangkan backend-nya berupa fungsi serverless Vercel di atas Supabase.

[English](README.md)

## Fungsi

- Pendaftaran, login, dan reset kata sandi lewat Supabase Auth, dengan profil mahasiswa (kampus, telepon, tahun masuk).
- Halaman marketplace, halaman detail produk, dan formulir tambah produk.
- Pesanan dan pembayaran online. Pembayaran dibuat dan dicek lewat API YoBasePay. Webhook memverifikasi tanda tangan HMAC-SHA256 sebelum mengubah status pembayaran.
- Dashboard pengguna.

## Teknologi

HTML, JavaScript vanilla, Tailwind CSS, fungsi serverless Vercel (`api/`), Supabase (Auth dan Postgres), YoBasePay.

## Menjalankan

Kebutuhan: Node.js rilis LTS terbaru, proyek Supabase, dan akun YoBasePay.

```bash
npm install
cp .env.example .env     # isi nilai di bawah
npm run build            # kompilasi Tailwind ke app.css
npm test                 # uji pesanan, pembayaran, dan profil
```

Terapkan `supabase/migrations/202604220001_marketplace_payments.sql` ke database. Jalankan fungsi secara lokal dengan `vercel dev`.

### Variabel lingkungan

| Variabel | Kegunaan |
| --- | --- |
| `APP_BASE_URL` | URL publik situs |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Klien Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Akses database di sisi server, hanya di `api/` |
| `YOBASEPAY_API_ORIGIN`, `YOBASEPAY_API_KEY` | Panggilan API YoBasePay |
| `YOBASEPAY_SECRET`, `YOBASEPAY_WEBHOOK_SECRET` | Menandatangani dan memverifikasi webhook pembayaran |

Service role key harus tetap di server dan tidak boleh sampai ke peramban.

## Struktur

```
beranda/ marketplace/ detail_produk/ tambah_produk/ dashboard/
login/ registrasi/ lupa_password/     folder halaman
api/                                  produk, pesanan, profil, pembayaran (create, status, webhook)
supabase/migrations/                  skema database
test/                                 suite node:test
tools/verify.mjs                      pemeriksaan proyek (npm run verify)
```

URL root diarahkan ke `/beranda/beranda.html` (`vercel.json`).
