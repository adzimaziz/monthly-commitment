# Komitmen Bulanan

PWA ringkas untuk urus komitmen bulanan Adzim & Wahidah dalam satu page.

- **Bulan** — senarai item bulan semasa untuk Adzim & Wahidah, tekan ✓ bila dah bayar, tekan item untuk edit jumlah/nota. Butang **+ Bulan baru** salin bulan terakhir (jumlah + nota sel), status bayar direset.
- **Sejarah** — jadual macam Excel (item × bulan). Sel ada segi tiga merah = ada nota. Tekan sel untuk edit.
- **Info** — nombor akaun, pautan, senarai item (edit nama, JomPAY, no. akaun, tanda "dah tamat").
- Jumlah boleh guna formula macam Excel: `=750-300-365-200`.
- **Backup** — muat turun fail JSON (atau Kongsi ke WhatsApp/Drive). **Pulihkan** dari menu ⋮. Export CSV untuk buka di Excel.

## Privasi — penting

Repo ni **tak ada data peribadi**. Semua data disimpan dalam browser (localStorage) peranti masing-masing sahaja.
Fail Excel, folder `private/` dan fail backup dah ada dalam `.gitignore` — jangan buang.

Sebab data dalam browser:
- Telefon Adzim & telefon Wahidah ada data berasingan. Untuk kongsi, buat backup di satu telefon → hantar fail → Pulihkan di telefon lain.
- Kalau clear data browser / uninstall app, data hilang — buat backup selalu (app akan ingatkan selepas 14 hari).

## Sync cloud (Firebase) — data sama di semua phone & komputer

Data disimpan dalam Firestore; hanya email yang disenaraikan dalam `firestore.rules` boleh baca/tulis.
Setiap perubahan dihantar per sel, jadi Adzim & Wahidah boleh edit serentak. Offline pun boleh — dihantar bila ada internet.

Setup sekali sahaja (percuma, pelan Spark):

1. Buka https://console.firebase.google.com → **Create a project** (cth `komitmen-bulanan`). Google Analytics tak perlu.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Authentication → Users → Add user** — buat dua akaun: email Adzim & email Wahidah, masing-masing dengan password sendiri.
4. **Build → Firestore Database → Create database** → lokasi `asia-southeast1 (Singapore)` → **production mode**.
5. **Firestore → Rules** → tampal isi `firestore.rules` → **Publish**.
6. **Project settings (⚙) → Your apps → Web (`</>`)** → daftar app → salin objek `firebaseConfig`.
7. Tampal dalam `firebase-config.js` (`window.FIREBASE_CONFIG = { ... }`), naikkan `CACHE` dalam `sw.js`, commit & push.
8. Buka app → ☁ (atas kanan) → log masuk. Peranti pertama yang log masuk (yang dah ada data) akan upload datanya ke cloud;
   peranti lain akan tarik data dari cloud.

`firebase-config.js` selamat dipublish — keselamatan dikawal oleh rules + login.

## Import dari Excel (sekali sahaja)

```bash
pip install openpyxl
python tools/import_excel.py "Monthly Commitment Adzim_2026_08.xlsx" "Monthly Commitment Wahidah.xlsx" private/backup-awal.json
```

Secara lalai hanya Jan–Ogos 2026 diimport. Item lama yang tiada rekod 2026 masuk sebagai "dah tamat" (boleh guna semula).
Untuk julat lain, tambah `mula akhir` di hujung arahan, cth `2025-01 2026-08`.

Buka app → **Pulihkan dari backup** → pilih `private/backup-awal.json`.

## Phone & desktop

- Phone: tab Bulan / Sejarah / Info di bawah skrin, edit item muncul dari bawah (bottom sheet).
- Desktop: Adzim & Wahidah sebelah-menyebelah bila pilih "Semua".
- Data phone dan desktop **berasingan** — pindahkan guna Backup → Pulihkan.

## Publish ke GitHub Pages

```bash
git init
git add .
git commit -m "Komitmen Bulanan PWA"
git branch -M main
git remote add origin https://github.com/adzimaziz/monthly-commitment.git
git push -u origin main
```

Lepas tu di GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
App akan ada di `https://adzimaziz.github.io/monthly-commitment/`. Buka di telefon → **Add to Home screen / Install app**.

## Kemaskini app

Bila ubah fail app, naikkan `CACHE` dalam `sw.js` (cth `komitmen-v2`) supaya telefon dapat versi baru.

## Run local

```bash
python -m http.server 8765
```
