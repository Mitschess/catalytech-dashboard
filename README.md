# Catalytech SIGAP — Intelligent Manufacturing Dashboard

**SIGAP** (Sistem Intelijen Gangguan & Aksi Prediktif) memantau kondisi aset pabrik secara live, memberi peringatan dini sebelum trip,
mengubah alert menjadi tindakan (acknowledge, work order, intervensi), dan membantu analisis akar masalah (RCA) dengan AI.

Semua aset, kejadian, dan angka kerugian berasal dari **data panitia**: 5 aset dengan kejadian nyata (PU-2101B, KO-3201, PM-4405B, HE-3301,
BL-5702) dan 380 insiden historis.

### Kenapa ada "isian dummy"?

Data PI per jam panitia hanya **30 hari per aset**, dan bulannya berbeda-beda:

| Aset | Unit | PI per jam asli | Trip | Condition monitoring mingguan asli |
|---|---|---|---|---|
| PU-2101B | ARP | 1–30 Mar 2026 | 12 Mar | 23 Okt 2025 – 16 Apr 2026 |
| KO-3201 | ZCU | 1–30 Apr 2026 | 29 Apr | 10 Des 2025 – 3 Jun 2026 |
| HE-3301 | ZCU | 1–30 Mei 2026 | 21 Mei | 1 Jan – 25 Jun 2026 |
| BL-5702 | OPP | 1–30 Jun 2026 | 17 Jun | 28 Jan – 22 Jul 2026 |
| PM-4405B | NUP | 1–30 Jul 2026 | 8 Jul | 18 Feb – 12 Agu 2026 |

Supaya kelima aset berjalan bersamaan pada satu jam simulasi (23 Okt 2025 – 12 Agu 2026), jam di luar jendela data asli diisi
**isian dummy berlabel** (`backend/app/sources/competition.py`):

- **Per jam:** hari-hari utuh diambil acak dari hari normal aset itu sendiri di data PI asli (sedang berjalan, dan minimal 3 hari sebelum trip), ditambah noise kecil.
- **Mingguan:** pembacaan di sekitar baseline sehat (rata-rata 4 pembacaan asli pertama), dengan sebaran kecil.
- Isian hanya menggambarkan **operasi normal**. Semua tanda kerusakan tetap berasal dari data asli, dan angka kerugian tidak berubah.
- Di layar, isian selalu ditandai: garis/titik **ungu** di grafik, label "Isian dummy" di kartu aset, dan garis waktu cakupan di halaman Data & sumber.
- `tests/smoke_test.py` memastikan isian tidak pernah memicu alert.

---

## Menjalankan

### Cara cepat (Windows)

Klik dua kali **`start.bat`**. Saat pertama kali dijalankan, skrip ini menyiapkan lingkungan Python dan membangun tampilan dashboard,
lalu membuka **http://localhost:8000** di browser.

Kebutuhan: **Python 3.11+** dan **Node.js 18+** (Node hanya dibutuhkan sekali, untuk membangun tampilan).

### Cara manual

```bash
# 1. Backend
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt      # macOS/Linux: .venv/bin/python

# 2. Frontend (sekali saja)
cd ../frontend
npm install
npm run build

# 3. Jalankan
cd ../backend
.venv\Scripts\python.exe run.py
```

Buka http://localhost:8000. Dokumentasi API interaktif tersedia di http://localhost:8000/docs.

### Mode pengembangan (hot reload tampilan)

Jalankan backend seperti di atas, lalu di terminal lain:

```bash
cd frontend
npm run dev        # http://localhost:5173, API dan WebSocket diteruskan ke port 8000
```

### Mengaktifkan asisten Claude (opsional)

Salin `backend/.env.example` menjadi `backend/.env`, isi `ANTHROPIC_API_KEY`, lalu jalankan ulang server.
Tanpa kunci ini semua fitur lain tetap berjalan; hanya tombol analisis Claude di halaman AI RCA Assistant yang nonaktif.
Jangan bagikan file `.env`.

---

## Alur demo (±5 menit)

Waktu simulasi dimulai **5 Jan 2026 08:00**. Bilah atas mengendalikan waktu: putar/jeda, maju 1 hari, geser ke tanggal mana pun,
kecepatan (1 jam s/d 1 minggu per detik), dan skenario.

1. **Plant overview.** Tunjukkan skematik proses site: pompa, kompresor, dan blower berputar saat beroperasi, dan berwarna saat kondisi tidak normal.
   Lalu tunjukkan KPI risiko dan konteks historis: 90 dari 91 RCA terlambat, dan skor risiko lama tidak berkorelasi dengan kerugian (ρ ≈ 0).
2. **Putar** di kecepatan *1 hari/detik* dengan *Jeda saat alert* aktif. Simulasi berhenti otomatis setiap kali ada alert baru.
   PU-2101B sudah naik ke P2 pada 8 Jan 2026, jauh sebelum trip 12 Mar 2026.
3. **Monitor aset → PU-2101B atau KO-3201.** Tunjukkan tren condition monitoring dan garis proyeksi menuju batas trip, sinyal PI per jam,
   serta skor dan kontributor model AI.
4. **Action Hub.** Isi nama, klik *Ack* dan *Buat WO*. Tunjukkan tenggat SLA dan kolom "skor lama" dibanding risiko baru dalam US$.
5. **Skenario.** Pindah dari *Kenyataan* ke *SIGAP otomatis*. Untuk 5 kasus nyata, kerugian turun dari **US$2,58 jt** menjadi
   **US$0,85 jt** (terhindar ±US$1,73 jt), karena intervensi terencana dijalankan sesuai SLA. Di mode *Manual*, Anda sendiri yang memutuskan
   kapan intervensi.
6. **AI RCA Assistant.** Verifikasi parameter (G/CEK/NG), hipotesis akar masalah dengan bukti, insiden serupa, dan draf abnormality report
   yang bisa diunduh. Dengan kunci Claude aktif, klik *Buat analisis dengan Claude*.
7. **Model AI.** Model dilatih hanya dari data normal. Tabel validasi menghitung seberapa awal peringatan muncul sebelum setiap trip
   pada replay yang sedang berjalan (84–105 hari untuk kelima kasus di mode Kenyataan).
8. **Data & sumber.** Garis waktu cakupan menunjukkan bulan data asli tiap aset dan bagian yang diisi dummy.

Tombol **Ulang** mengembalikan simulasi ke 5 Jan 2026 dan menghapus semua tindakan.

---

## Halaman

| Halaman | Isi |
|---|---|
| Plant overview | KPI live, skematik proses site beranimasi, kartu status 5 aset, log kejadian, kerugian bulanan dan Pareto mekanisme |
| Monitor aset | Condition monitoring mingguan + proyeksi, sinyal per jam, skor anomali AI, kontributor, log kejadian aset, tombol intervensi |
| Action Hub | Antrian alert dengan SLA, P(gagal) × kerugian, acknowledge, work order, intervensi, pelacakan CAPA dari laporan RCA |
| AI RCA Assistant | Verifikasi parameter 4P, hipotesis 4M+1E, insiden serupa, pelajaran dari RCA terbit, chat Claude, draf laporan |
| Model AI | Status model MSPC per aset, latih ulang, validasi lead time, penjelasan 5 lapis analitik, langkah penerapan |
| Data & sumber | Garis waktu cakupan data asli vs isian dummy, sumber per aset, backlog RCA, arsitektur demo vs pabrik, daftar API |

Navigasi ada di **sidebar kiri**: menu halaman dan daftar aset per unit dengan status dan health live. Sidebar bisa diciutkan menjadi ikon
(tombol di sebelah logo); di layar kecil sidebar menjadi laci yang dibuka dengan tombol ☰.

## Cara kerja analitik

| Lapis | Metode | Perlu training? |
|---|---|---|
| Kualitas data | Sensor tidak berubah 6 jam → alert DATA; model AI berhenti menilai aset itu | Tidak |
| Batas & tren per jam | Batas alarm/trip (rata-rata 6 jam), drift > 10% selama 24 jam, tren harian kuadratik | Tidak (baseline 7 hari pertama) |
| Condition monitoring | Tren kuadratik 8 pembacaan mingguan; P2 bila prediksi trip ≤ 45 hari, P1 bila ≤ 14 hari | Tidak (baseline 4 pembacaan) |
| AI anomali (MSPC) | PCA + Hotelling T² + SPE, batas 99,9 persentil; P2 bila > 1× selama 3 jam, P1 bila > 5× dan dikonfirmasi lapis lain | Ya, data normal saja (336 jam) |
| Asisten RCA | Claude membaca konteks dashboard, tanpa fine-tuning | Tidak |

Semua pemrosesan bersifat kausal: pada jam simulasi *h*, sistem hanya memakai data sampai *h*.

## Struktur folder

```
catalytech-dashboard/
├── start.bat                  jalankan semuanya (Windows)
├── backend/
│   ├── run.py                 server FastAPI (port 8000)
│   ├── .env.example           contoh konfigurasi
│   ├── app/
│   │   ├── main.py            REST API, WebSocket, loop simulator
│   │   ├── engine.py          fusi lapis analitik → status, alert, kerugian, intervensi
│   │   ├── analytics/         mspc.py (model AI), rules.py (batas, tren, kualitas data)
│   │   ├── sources/           competition.py (data panitia + isian dummy), historian.py (simulated historian)
│   │   ├── rca.py             hipotesis, insiden serupa, draf laporan
│   │   ├── llm.py             integrasi Claude (streaming)
│   │   └── store.py           SQLite: acknowledge, work order, intervensi manual
│   ├── data/source/           salinan file panitia
│   └── tests/                 smoke_test.py (mesin), api_test.py (API + WebSocket, butuh server berjalan)
└── frontend/                  React + TypeScript + Vite + ECharts
    └── src/
        ├── pages/             Overview, Monitor, ActionHub, Rca, Models, DataPage
        └── components/        ProcessSchematic (skematik beranimasi), Coverage (garis waktu data), EChart, ui
```

## Menuju penerapan di pabrik

Strukturnya sudah dipisah supaya hanya beberapa komponen yang perlu diganti:

- `SimulatedHistorian` → konektor **PI Web API / OPC UA** (baca satu arah, per menit).
- SQLite → **PostgreSQL + TimescaleDB**; tambahkan Redis untuk live feed ke banyak pengguna.
- Work order lokal → integrasi **SAP PM / Maximo**; notifikasi P1 ke **Teams/email**.
- Tambahkan **SSO** dan peran pengguna; tempatkan server di zona sesuai **IEC 62443**.
- Jalankan model dalam **shadow mode ±3 bulan** sebelum alert dipakai untuk keputusan.

## Tes

```bash
cd backend
.venv\Scripts\python.exe -m tests.smoke_test     # mesin analitik, tanpa server
.venv\Scripts\python.exe run.py                  # di terminal lain, lalu:
.venv\Scripts\python.exe -m tests.api_test       # REST + WebSocket terhadap server yang berjalan
```

## Batasan yang perlu disampaikan

- Data PI panitia bersifat sintetis dan antar-tag hampir tidak berkorelasi, sehingga di sini MSPC berperilaku mirip aturan 3σ per tag.
  Peringatan paling awal untuk kasus nyata (84–105 hari) datang dari tren condition monitoring mingguan; pada data PI asli, model AI menandai
  anomali 1–2 hari sebelum trip.
- Model AI dilatih dari 2 minggu pertama timeline, yang berupa isian dummy yang disusun dari hari normal asli aset itu sendiri.
- Skematik proses bersifat ilustratif (urutan umum kompleks petrokimia), bukan P&ID; data panitia tidak memuat sambungan pipa.
- Nilai kerugian skenario memakai kerugian intervensi terencana yang diasumsikan per aset (lihat halaman Monitor aset).
