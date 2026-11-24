# Iky Creator Hub

Dashboard pribadi: **Dashboard**, **Ide / Library**, **Kalender Konten**, **Produksi Content**, dan **Brand**.

## Integrasi TikTok — API resmi, tanpa statistik palsu

Implementasi sudah berada dalam `src/worker.js` (backend) dan `public/index.html` (antarmuka).

- OAuth Login Kit: meminta `user.info.basic,user.info.profile,user.info.stats,video.list`.
- Memeriksa bahwa username akun yang mengizinkan akses adalah `@ikyhdyat`; akun lain tidak diterima.
- TikTok API v2: follower count, total likes, jumlah video, dan performa maksimal **20 video publik terbaru**.
- Menyimpan access/refresh token di Durable Object Cloudflare, **bukan browser maupun GitHub**; token yang berotasi selalu diperbarui server.
- Sinkronisasi otomatis per 6 jam melalui Cron Trigger, serta tombol sinkron manual.
- Menyimpan snapshot riwayat maksimum 180 hari dan menampilkan grafik **hanya dari data nyata**.
- Dashboard API memerlukan password admin yang diset via secret dan login cookie HttpOnly (hingga 30 hari).

### Yang perlu tersedia sebelum sinkron live bisa berhasil

1. Deployment Worker Cloudflare harus berhasil. Repository sudah memiliki branch `main`, `package.json`, `wrangler.toml`, `public/index.html`, dan `src/worker.js`.
2. Di TikTok for Developers, miliki aplikasi Login Kit dengan scope yang sesuai dan telah diizinkan untuk akun yang bersangkutan.
3. Di Cloudflare Workers → Settings → Variables and Secrets, tambahkan **Secret** (jangan di GitHub atau di chat):
   - `DASHBOARD_PASSWORD`: password admin acak minimal 12 karakter.
   - `TIKTOK_CLIENT_KEY`: Client Key TikTok Developer.
   - `TIKTOK_CLIENT_SECRET`: Client Secret TikTok Developer.
4. Catat redirect URI tepat dari `https://DOMAIN-WORKER/api/tiktok/config` (field `redirect_uri`) dan daftarkan **persis sama** di Login Kit TikTok. Untuk custom domain, gunakan domain itu ketika mengakses endpoint; jangan pakai domain lain ketika menjalankan flow. Alternatif: set variabel nonrahasia `TIKTOK_REDIRECT_URI` ke callback HTTPS yang telah didaftarkan.
5. Buka dashboard dan klik **Hubungkan TikTok**. Masukkan password admin melalui website sendiri (bukan chat), lalu izinkan akses melalui halaman TikTok. Saat kembali, klik **Sinkronkan Sekarang** bila belum ada snapshot.

### Status verifikasi

- Script backend dan frontend telah dicek sintaksnya.
- Repository dan commit GitHub telah diverifikasi.
- **Koneksi OAuth dan penarikan data belum dapat diuji end-to-end tanpa Cloudflare yang sudah dideploy, TikTok Developer credentials, dan persetujuan akun TikTok.**

### Keamanan dan batasan

- Token tidak ditampilkan lewat API publik maupun HTML frontend.
- Statistik dari desain mockup **tidak** pernah digunakan sebagai data live.
- Riwayat pertumbuhan diisi sejak sinkronisasi berhasil; riwayat sebelum itu tidak direkayasa.
- Total views seluruh akun **bukan** metrik yang diberikan oleh user info endpoint; angka views yang ditampilkan hanya untuk video publik terbaru yang berhasil diambil dari Video List API.
- Perubahan status konten, ide, library, dan brand pada MVP ini masih disimpan melalui `localStorage` perangkat, bukan sinkronisasi lintas perangkat.

## Pengembangan

```bash
npm install
npm run dev
# Deploy via Git integration:
npx wrangler deploy
```

Cloudflare konfigurasi ada di `wrangler.toml`. Untuk deployment pertama ke Worker yang sudah ada, pastikan nama Worker cocok dengan proyek Cloudflare: `ikoyyypersonalbrand`.

## Dokumentasi API

- https://developers.tiktok.com/docs/en/login-kit-web
- https://developers.tiktok.com/docs/en/oauth-get-a-user-access-token
- https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token
- https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info
- https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list
- https://developers.cloudflare.com/workers/wrangler/configuration/
