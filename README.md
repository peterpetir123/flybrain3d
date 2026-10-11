# flybrain3d

Viewer **3D interaktif** dari konektom otak lalat, langsung di browser.

- Titik = soma neuron · Garis = koneksi terkuat · Warna = kelas neuron
- Neuron yang aktif **menyala** (inti putih + halo), lalu activity mereda
- Panel **"apa yang dirasakan lalat"** di bawah otak
- Navigasi **kiri/kanan**, plus drag & zoom
- **Murni statis** — tanpa server, tanpa backend. Cukup hosting file statis

## 🔗 Buka sekarang

**https://peterpetir123.github.io/flybrain3d/**

## Menjalankan secara lokal

Browser modern memblokir pembacaan file biner saat halaman dibuka langsung dari
disk (`file://`) demi keamanan, jadi viewer perlu disajikan lewat HTTP:

```bash
python3 -m http.server 8000
# buka http://localhost:8000/
```

Alternatif lain (semua gratis): GitHub Pages, Cloudflare Pages, Netlify,
Codeberg Pages.-repo ini sudah siap di-hosting statis apa pun — semua path relatif.

## Dua dataset

| Folder | Isi | Source |
| --- | --- | --- |
| `data/` | 20.000 neuron, **SINTETIS** (untuk uji tampilan saja) | `tools/build_brain.py --synthetic` |
| `data-poker/` | 41.000 neuron, **MaleCNS asli** (CC-BY 4.0) |_subset MaleCNS v1.0 + posisi `somaLocation`_ |

Buka yang mana pun lewat parameter `?data=`:

```
?data=data/           # sintetis (default)
?data=data-poker/     # MaleCNS asli, otak poker
?state=bahaya-mendekat    # buka langsung di keadaan tertentu
```

> `data/` sengaja dibuat sintetis untuk menguji tampilan tanpa menarik unduhan
> besar. Untuk data otak **nyata**, pakai `data-poker/` (MaleCNS) atau bangun
> sendiri lewat `tools/build_brain.py --download` (FlyWire FAFB v783).

## Keadaan "lalat" (apa yang dirasakan)

Tiap keadaan menyalakan kelompok neuron dengan intensitas berbeda mengikuti alur
otak sungguhan (sensory → central → descending/motor), lalu mereda:

| Keadaan | Yang terjadi |
| --- | --- |
| `istirahat` | Gelombang lemah khas lalat diam |
| `mencari-makan` | Reseptor penciuman menyala, sinyal naik ke otak tengah |
| `bahaya-mendekat` | Lobe optik mendeteksi objek mendekat → bersiap melarikan diri |
| `cahaya-menyilaukan` | Optic lobe melonjak → perintah escape ke motor |
| `bertengkar` | Descending & motor mendominasi, siap duel |

Animasi ini berjalan **murni di browser** (lihat `activity.js`) — tanpa server.

## Membangun data sendiri

Butuh `numpy` + `pandas` (`pip install -r requirements.txt`):

```bash
# data sintetis untuk uji cepat
python tools/build_brain.py --synthetic --out data

# data FlyWire FAFB v783 asli (unduh ~60 MB), lalu bangun
python tools/build_brain.py --download --raw raw --out data-flywire
```

Skrip berhenti dan mencetak daftar kolom bila nama kolom sumber berbeda — sesuaikan
fungsi `col()` / `load_positions()` di `tools/build_brain.py`.

## API viewer (`window.FlyBrain`)

| Fungsi | Guna |
| --- | --- |
| `groups[kelas]` | `Uint32Array` indeks neuron tiap kelas |
| `pulse(idx, v)` / `setActivity(i, v)` | nyalakan neuron |
| `pulseClass(kelas, n, v)` | nyalakan sebagian acak satu kelas |
| `classLevel(kelas)` / `totalLevel()` | intensitas 0..1 untuk meter UI |
| `spinY(deg)` / `panX(d)` / `zoom(f)` / `resetView()` | navigasi kamera |
| `act` | aktivitas per neuron; `tau` | waktu peluruhan (detik) |

Sambungkan sistem neuron Anda sendiri: tulis `act` (atau `pulse`) di
`step(dt)`, dan baca `groups` untuk memilih neuron per kelas.

## Format data

| File | Isi |
| --- | --- |
| `meta.json` | `n`, `k`, daftar kelas, jumlah per kelas, sumber |
| `pos.f32` | N*3 float32, posisi ~[-1,1] |
| `cls.u8` | indeks kelas per neuron |
| `est.u8` | 1 = posisi estimasi (bukan terukur) |
| `deg.f32` | derajat (0..1) → ukuran titik |
| `edges.u32` | pasangan (pre,post) edge |
| `ew.f32` | bobot edge (0..1) |
| `ids.txt` | root_id per baris (string; bisa melebihi 2^53) |

## Mengakurasi

- Posisi = soma neuron, **bukan** morfologi lengkap (tanpa cabang/mesh).
- Neuron tanpa koordinat diberi posisi estimasi (rata-rata tetangga berbobot) dan
  ditandai `est.u8 = 1`. Jangan dianggap data terukur.
- Garis hanya K koneksi terkuat, bukan seluruh jaringan.
- three.js r128 di-*vendor* lokal (`vendor/`) → jalan offline.

## Lisensi & atribusi

- **Kode viewer: MIT** (lihat `LICENSE`).
- **`data-poker/` — MaleCNS v1.0, CC-BY 4.0.** Mohon atribusi:
  Berg et al., *Cell* (rilis MaleCNS v1.0) · https://male-cns.janelia.org/download/
- **`data/` — sintetis**, dibuat untuk uji tampilan.
- three.js r128 — MIT.

## Sitasi

Viewer ini dipakai untuk memvisualisasi konektom MaleCNS. Jika Anda memakai
`data-poker/`, mohon sitasi MaleCNS sesuai CC-BY 4.0 (berg et al.).