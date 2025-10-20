<div align="center">
  <img src="./public/brand-icon.svg" alt="Face Reading Vision" width="96" />
  <h1>Face Reading Vision</h1>
  <p>Web-based face reading assistant yang menganalisis ekspresi wajah dan menyarankan manifesting karier, masa depan, dan jalur pendidikan secara instan.</p>
</div>

## ✨ Fitur utama

- **Live webcam capture** – ambil snapshot langsung dari browser dengan panduan framing.
- **Analisis AI terintegrasi** – kombinasikan model ekspresi Hugging Face dengan narasi Together AI.
- **Hasil kaya konteks** – ekspresi, manifesting karier & masa depan, rekomendasi SMA/SMK lengkap dengan indikator kekuatan/peluang/catatan.
- **Story-ready sharing** – generator story Instagram/WhatsApp (gambar & video WebM) plus PDF export dan clipboard sharing.
- **Riwayat lokal** – simpan hingga 5 sesi terakhir sebagai thumbnail ringan untuk ditinjau ulang.
- **PWA support** – installable sebagai aplikasi mobile/desktop dengan offline cache dasar via service worker.

## 🧱 Teknologi

- [Next.js 15 (App Router)](https://nextjs.org)
- [React 19](https://react.dev)
- [Tailwind CSS 4](https://tailwindcss.com)
- [shadcn/ui](https://ui.shadcn.com) komponen kustom
- Hugging Face Inference API (`nateraw/vision-transformer-emotion-ferplus`)
- Together AI Chat Completions (`meta-llama/Llama-3.3-70B-Instruct-Turbo-Free`)

## 🚀 Menjalankan proyek

### Persiapan environment

Salin `.env.local` dan isi kredensial API:

```env
NEXT_PUBLIC_HF_TOKEN=hf_xxx              # token Hugging Face (read access)
TOGETHER_API_KEY=tgp_v1_xxx               # Together AI API key
```

> **Catatan:** token Hugging Face diekspos ke sisi klien karena kamera berjalan di browser. Bila ingin full server-side, gunakan proxy sendiri atau model alternatif.

### Instalasi & pengembangan

```bash
npm install
npm run dev
```

Kunjungi `http://localhost:3000`. Izinkan akses kamera ketika diminta.

### Produksi / build

```bash
npm run build
npm start
```

Build menggunakan `next build` (webpack) agar tidak terjadi error Turbopack pada lingkungan tanpa akses jaringan.

## 🧪 Penggunaan fitur penting

| Fitur | Lokasi UI | Catatan |
|-------|-----------|---------|
| Ambil snapshot | Panel Kamera Live | Ikuti panduan grid & tips pencahayaan |
| Analisis AI | Tombol **Analisis Wajah** | Hasil tampil lengkap dengan tingkat keyakinan |
| Story Instagram / WhatsApp | Panel hasil → tombol **Story Instagram / Story WhatsApp** | Menggunakan Web Share API; fallback download jika tidak tersedia |
| Story Video | Tombol **Story Video** | Membuat animasi WebM 3.6 detik (membutuhkan dukungan `MediaRecorder`) |
| Preview Story | Tombol **Preview Story / Preview Video** | Menampilkan modal preview dan opsi simpan |
| Unduh PDF | Tombol **Unduh PDF** | Termasuk sumber analisis (AI/Fallback/Cache) |

## 🗂 Struktur penting

- `src/app/page.tsx` – halaman utama, logika kamera, state hasil, sharing story.
- `src/app/api/face-reading/route.ts` – endpoint server yang memanggil Hugging Face + Together AI.
- `public/brand-icon.svg` – ikon utama aplikasi (digunakan untuk favicon & readme).
- `src/components/ui/*` – komponen UI bergaya shadcn.

## 📦 Skrip npm

| Skrip | Deskripsi |
|-------|-----------|
| `npm run dev` | Menjalankan development server dengan Turbopack |
| `npm run build` | Build produksi menggunakan webpack standard |
| `npm run start` | Menjalankan server produksi hasil build |
| `npm run lint` | Menjalankan eslint pada seluruh project |
| `npm run build && npm run start` | Menjalankan build + service worker PWA |

## 💡 Tips deploy

- Pastikan environment variable tersedia (Hugging Face & Together AI).
- Jika environment target tidak memiliki akses ke domain Google Fonts, proyek sudah menggunakan fallback font lokal.
- Untuk hosting yang memblokir Web Share API, story masih dapat diunduh manual.
- Untuk PWA, deploy di HTTPS dan pastikan file `manifest.webmanifest` serta `sw.js` tersaji dari root.

---

Selamat membangun pengalaman face reading yang magis! 💫
