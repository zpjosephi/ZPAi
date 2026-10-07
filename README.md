# obrol

Chat ke model AI pakai API key sendiri. Satu halaman HTML, nggak ada server,
nggak ada build step. Key dan riwayat obrolan cuma nyimpen di browser lu.

Provider yang didukung:

- OpenAI
- Anthropic
- Google Gemini
- Groq
- OpenRouter
- Endpoint lain yang ngikutin format OpenAI (Ollama, LM Studio, DeepSeek, dll)

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

## Catatan

- Key dikirim langsung dari browser ke provider yang lu pilih. Nggak lewat
  server mana pun.
- Centang "Ingat key di browser ini" kalau mau key tetap ada setelah tab
  ditutup. Kalau nggak dicentang, key ilang pas tab ditutup.
- Buat Ollama lokal, pilih provider "Lainnya", base URL `http://localhost:11434/v1`,
  key boleh kosong. Pastikan Ollama diset `OLLAMA_ORIGINS=*` biar browser boleh akses.
- Jangan deploy halaman ini ke publik dengan key yang udah keisi. Key disimpan
  per browser, bukan di file.
