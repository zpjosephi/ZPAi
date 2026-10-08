# ZPAi

Chat ke model AI pakai API key sendiri. Satu halaman HTML, nggak ada server,
nggak ada build step. Key dan riwayat obrolan cuma nyimpen di browser lu.

Provider yang didukung:

- OpenAI
- Anthropic
- Google Gemini
- Groq
- OpenRouter
- Endpoint lain yang ngikutin format OpenAI (Ollama, LM Studio, DeepSeek, dll)

## Fitur

- Streaming jawaban, bisa distop kapan aja (Esc).
- Riwayat obrolan di panel kiri: dikelompokkan per tanggal, bisa dicari,
  diganti nama, dihapus (ada urungkan).
- Ulangi jawaban terakhir, edit pesan terakhir, lanjutkan jawaban yang kepotong
  di batas token, coba lagi kalau gagal.
- Pemakaian token per jawaban (bisa dimatikan di pengaturan).
- Export semua obrolan ke JSON dan import lagi di browser lain. Key nggak ikut.
- Tema terang, gelap, atau ikut sistem.
- Markdown: code block, tabel, list bersarang, kutipan.

## Jalanin

Buka `index.html` langsung di browser juga bisa, tapi lebih aman lewat server
lokal biar clipboard dan storage jalan normal:

```
npx serve .
```

atau

```
python -m http.server 8080
```

Terus buka http://localhost:8080.

## File

- `index.html` markup dan ikon SVG
- `style.css` token warna (OKLCH, `light-dark()`), layout, komponen
- `markdown.js` renderer markdown kecil buat jawaban model
- `providers.js` katalog provider, pembentuk request, parser event SSE
- `store.js` penyimpanan: pengaturan, key, index obrolan, export/import
- `app.js` UI dan alur kirim/stream

## Catatan

- Key dikirim langsung dari browser ke provider yang lu pilih. Nggak lewat
  server mana pun.
- Centang "Ingat key di browser ini" kalau mau key tetap ada setelah tab
  ditutup. Kalau nggak dicentang, key ilang pas tab ditutup.
- Buat Ollama lokal, pilih provider "Lainnya", base URL `http://localhost:11434/v1`,
  key boleh kosong. Pastikan Ollama diset `OLLAMA_ORIGINS=*` biar browser boleh akses.
- Riwayat disimpan di `localStorage`, jadi kuotanya terbatas (biasanya sekitar
  5 MB per origin). Kalau penuh, export dulu lalu hapus yang lama.
- Jangan deploy halaman ini ke publik dengan key yang udah keisi. Key disimpan
  per browser, bukan di file.
