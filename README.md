# Ghost Cave - Twitch Chat Widget (StreamElements)

Frame dan semua ornamen di-inject sebagai **inline SVG lewat JavaScript**. Tidak ada PNG sama sekali,
tidak ada file gambar yang perlu di-host, dan semua tetap tajam di resolusi berapa pun.

## Cara pasang di StreamElements

1. StreamElements -> **Overlays** -> edit overlay -> **Add Widget** -> **Static / Custom** -> **Custom Widget**.
2. Buka tab **Settings** widget, lalu isi tiap box:
   - **HTML** -> paste isi `streamelements/HTML.html` (hanya markup `<div>`)
   - **CSS** -> paste isi `streamelements/CSS.css`
   - **JS** -> paste isi `streamelements/JS.js` (engine + seluruh bundle SVG)
   - **FIELDS** -> paste isi `streamelements/FIELDS.json`
3. Klik **Done**, lalu di panel kanan widget atur Scale, Width, Max messages, dsb.
4. Di widget StreamElements, buka tab **Overlay Settings -> Twitch chat** dan pastikan chat listener aktif.

> HTML box sengaja dibuat bersih dan hanya berisi satu `<div>`. Bundle SVG chat dan lima desain alert
> sekarang berada di dalam `JS.js` agar tidak perlu menambah markup HTML.

## Cara kerja stretch (9-slice)

Artboard asli `948 x 225`. Frame dipotong jadi 9 bagian memakai nested `<svg>` + `<use>`:

```
        150px            658px           140px
      +--------+---------------------+--------+
 130  | corner |    stretch X        | corner |
      +--------+---------------------+--------+
  10  |stretch |    stretch X + Y    |stretch |
      |   Y    |                     |   Y    |
      +--------+---------------------+--------+
  85  | corner |    stretch X        | corner |
      +--------+---------------------+--------+
```

- Empat sudut pakai ukuran asli, jadi ukiran rune, retakan batu, dan lumut tidak pernah gepeng.
- Garis potong vertikal sengaja diletakkan di `y = 130..140`, yaitu pita batu polos di antara dua rune,
  supaya saat chat jadi 5 baris yang melar cuma bagian batu kosong.
- Ornamen (kristal, ghost, sparkle, rantai VIP) **tidak** ikut 9-slice. Semuanya SVG terpisah yang
  diposisikan absolut, ukurannya tetap, jadi bentuknya selalu utuh.

Posisi ornamen diambil otomatis dari file `Refrensi/*.svg` (template matching terhadap base bubble),
jadi peletakannya sama persis dengan desain Figma-mu.

## Perilaku ornamen saat bubble memanjang

| Ornamen | Anchor |
| --- | --- |
| Kristal kiri + sparkle-nya | tengah vertikal (ikut turun kalau bubble makin tinggi) |
| Ghost kanan + sparkle-nya | pojok kanan atas |
| Badge role (logorole) | inline di depan username |
| Rantai bawah (VIP) | menempel di sisi bawah bubble, lebar mengikuti bubble |

## Deteksi role

Diambil dari badge Twitch di event `message`:

| Badge | Style |
| --- | --- |
| broadcaster | Streamer |
| moderator | Moderator |
| vip | VIP |
| subscriber / founder | Subscriber |
| lainnya | Viewers |

**Follower**: Twitch tidak mengirim status follower di event chat. Widget ini menandai user sebagai
Follower kalau namanya muncul di event `follower-latest` selama sesi berjalan (`followerRole: true`).
Kalau tidak mau, set field **Follower style** ke `no`.

## Setting yang tersedia (FIELDS)

| Field | Default | Fungsi |
| --- | --- | --- |
| Scale | 0.58 | ukuran frame relatif desain asli |
| Widget width | 560 | lebar area chat (px) |
| Gap | 14 | jarak antar bubble (px) |
| Max messages | 8 | jumlah bubble maksimum |
| Hide after | 0 | detik sebelum bubble hilang (0 = tetap) |
| Direction | bottom | bubble baru muncul di bawah atau atas |
| Hide commands | yes | sembunyikan pesan diawali `!` |
| Ignore users | nightbot, streamelements | bot yang diabaikan |
| Follower style | yes | pakai frame Follower untuk follower baru |
| Alerts | yes | tampilkan alert Follow/Sub/Cheer/Tip/Raid di stack chat |
| Alert duration | 0 | detik sebelum alert keluar otomatis; 0 = tidak auto-hide |
| Animate | yes | master switch semua animasi |
| Lift | yes | bubble lama naik pelan saat ada chat baru |
| Lift duration | 340 | ms, durasi naiknya - sengaja dibikin biasa/polos |
| Typing | yes | teks muncul kata per kata |
| Typing speed | 72 | ms antar kata (dulu 34) |
| Idle | yes | glow bernapas selama bubble diam |
| **Flames** | yes | **api-api di ornamen ghost ikut berkedip** |
| **Magic** | yes | **efek magis di crystal (aura + partikel), warna ikut role** |
| **Motes** | 5 | **jumlah partikel magis (0-14), set 0 kalau mau aura saja** |

> Field **Sheen** sudah dihapus. Kalau kamu sudah pernah paste FIELDS versi lama,
> paste ulang `streamelements/FIELDS.json` supaya dropdown-nya tidak menggantung.

## Revisi performa + fix blur (versi ini)

Tiga keluhan yang dibereskan: berat/ngeframe, bubble & alert burem saat animasi
masuk, dan sheen yang tidak diinginkan. Animasi magis di area crystal **tetap utuh**.

### 1. Bug burem saat animasi masuk (fixed)

Penyebabnya bukan blur filter, tapi **raster scale** di Chromium/OBS. Saat sebuah
layer dianimasikan, Chromium meraster bitmap-nya **sekali** pada skala di awal
animasi, lalu bitmap itu di-scale oleh GPU. Karena keyframe lama menumbuhkan
artwork dari kecil ke besar (`scale(.30)` -> `scale(1)`), yang terlihat adalah
bitmap resolusi 30% yang dipaksa melar - persis "burem". Begitu animasi selesai,
layer diraster ulang di 100% dan mendadak jernih.

**KOREKSI (revisi ini).** Percobaan pertama memakai aturan "mulai dari sedikit
di atas 1 lalu mengecil ke 1" dengan alasan Chromium meraster di skala
TERBESAR animasi. Alasan itu **salah** dan burem-nya memang masih terlihat di
StreamElements. Yang benar: layer diraster **sekali pada skala saat animasi
MULAI**, lalu compositor hanya me-*resample* bitmap itu. Jadi selama nilai
scale masih di atas 1 di tengah animasi, yang tampil adalah bitmap kecil yang
dipaksa melar - burem, dan baru jernih setelah animasi berhenti dan layer
diraster ulang.

Aturan yang dipakai sekarang: **scale tidak boleh PERNAH melewati 1** pada
layer yang punya detail tajam (artwork SVG + teks). Puncak animasi diletakkan
tepat di `1`, dan pop tumbuh dari bawah (`.86`/`.9`/`.94`/`.955`) menuju `1`,
sehingga setiap frame adalah *downsample* - dan downsample tidak pernah
memburamkan. Energi overshoot dipindahkan ke `translate`, yang tidak
me-resample apa pun. Scale di atas 1 hanya dibiarkan pada layer gradien murni
(aura, ring, glow, motes) karena di situ tidak ada detail yang bisa buram.

| Layer | Asli | Revisi lalu (masih burem) | Sekarang |
| --- | --- | --- | --- |
| Alert card pop | `-` | `1.05 -> 1.008 -> 1` | `.955 -> 1` |
| Alert name | `-` | `1.06 -> 1` | `.94 -> 1` |
| Crystal pop | `.30 -> 1.08 -> 1` | `1.16 -> 1.06 -> 1` | `.86 -> 1 -> .965` |
| Ghost pop | `.35 -> 1.06 -> 1` | `1.12 -> 1.04 -> 1` | `.9 -> 1` |
| Sparkle in | `.5 -> 1` | `1.1 -> 1` | `.9 -> 1` |
| Flame in | `.2,.4 -> 1.1,1.15 -> 1` | opacity + naik saja |
| Flame dance | naik ke `1.13` | maksimum `1` di dua axis |
| Crystal breathe | `1 -> 1.035` | `1 -> .965` |
| Alert card | `scale(.94 -> 1.025 -> 1)` | translateY saja, tanpa scale |

Layer gradien (aura, shockwave ring, motes) tetap boleh membesar - gradien lembut
tidak punya detail yang bisa hilang.

Alert juga sengaja **tidak lagi memakai opacity** di entrance-nya. Kalau frame
pertamanya sempat di-throttle, kartu opacity-0 bisa hilang total; sekarang paling
buruk dia cuma muncul tanpa gerakan.

### 2. Berat / ngeframe (fixed)

**a. `mix-blend-mode: screen` dibuang** dari glow, aura, dan ring. Ini penyebab
terbesar. Blend mode memaksa `.gc-anim` - **termasuk seluruh frame 9-slice** -
dirender ke buffer terpisah lalu di-composite ulang **tiap frame animasi, untuk
tiap bubble di layar**. Karena glow dan aura memang ditaruh di belakang frame
(`z-index: 0`), hasil visualnya nyaris identik; `--gc-glow-rest/peak` dinaikkan
tipis (.18/.44 -> .22/.50) sebagai kompensasi.

**b. `box-shadow` pada motes dihapus.** Shadow yang ikut bergerak harus di-blur
ulang di CPU setiap frame, dikali jumlah mote dikali jumlah bubble. Sekarang
glow-nya dipanggang ke dalam `radial-gradient`, jadi mote murni animasi
`transform` + `opacity` di compositor.

**c. Profil idle-lite jauh lebih tegas.** Dulu bubble lama masih menjalankan api,
float, dan sparkle. Sekarang semua efek **sekunder** dimatikan dan diparkir di
nilai statis; yang dipertahankan hanya identitas brief client:
**crystal breathe + aura warna role**.

| | Bubble penuh | Bubble lite (sebelum) | Bubble lite (sekarang) |
| --- | --- | --- | --- |
| Animasi infinite | ~15 | ~10 | **3** |

**d. `fullIdleMessages` 3 -> 2** dan **motes 7 -> 5**. Dengan `maxMessages: 8`,
total animasi infinite turun dari ~120 menjadi ~48 - dan yang sisa itu pun
sekarang compositor-only, bukan repaint.

**e. `will-change` dipasang selektif** hanya di crystal, ghost, dan aura (layer
yang memang menganimasikan transform terus-menerus), supaya frame batu tidak ikut
dipromosikan jadi layer sendiri.

Kalau masih berat di PC kentang, urutan penurunan yang paling terasa:
`Motes` -> 0, lalu `Max messages` -> 5, lalu `Flames` -> no.

### 3. Sheen dihapus

Dihapus tuntas: block CSS `.gc-sheen`, keyframes `gc-sheen`/`gc-sheen-fade`,
pembuatan elemennya di `widget.js`, `CFG.sheen`, tunggu-sheen di timing handoff
(`Math.max(inMs, sheenMs)` -> `inMs`), field FIELDS, dan toggle di `tuner.html`
(diganti toggle Api ghost + Magic crystal).

## Audit + improvisasi animasi alert (versi ini)

Audit dijalankan dengan tiga alat: inventaris statis semua `@keyframes`
(`/data/audit-css.py` di sandbox), filmstrip yang membekukan animasi masuk di
titik waktu tertentu (`qa-alert-frames.html`), dan pengukuran piksel per frame.

### Temuan

| Temuan | Bukti |
| --- | --- |
| 4 dari 7 keyframe alert tidak berfungsi | `gc-alert-in`, `gc-alert-lift-in`, `gc-alert-magic-in` tidak pernah dipakai; `gc-alert-art-in` isinya `opacity:1` ke `opacity:1` |
| Gerakan di bawah ambang persepsi | travel `22*--u` = 12,8px, overshoot `-3*--u` = 1,7px pada kartu selebar 68% layar |
| Kartu sudah utuh sejak frame 0 | filmstrip: artwork 100% opak di 0ms, sepanjang 760ms hanya teks yang fade-in; luminансi rata-rata cuma berubah ~5% |
| Hierarki terbalik | chat bubble: entrance 1560ms / ~7 beat / 8 animasi idle. Alert: 760ms / 3 beat / 1 animasi idle |
| Glow nyaris tak terlihat | peak `.3` turun ke `.06`, idle `.035 <-> .095` |
| Exit tanpa karakter | `opacity: 1 -> 0` saja |
| Semua tier event identik | `followed`/`subscribed`/`tipped`/`raided` beda warna saja |

Akar masalahnya: aturan anti-blur yang benar adalah **"jangan scale DI ATAS 1"**,
bukan "jangan pakai scale". Revisi sebelumnya mencabut scale sepenuhnya dari
alert, jadi tidak ada lagi yang bisa dilihat.

### Yang diperbaiki

**1. Animasi masuk alert - tiga beat (620ms + ekor mote)**

| Beat | Waktu | Isi |
| --- | --- | --- |
| Impact | 0-160ms | aura warna event menyembur di belakang kartu; kartu jatuh dari `38*--u` (22px) |
| Settle | 160-620ms | mendarat dengan overshoot `-9*--u` (5,2px) + `scale(.955) -> 1` |
| Reveal | 300ms+ | nama masuk (`scale(.94) -> 1`), label menyusul 130ms kemudian, motes menyembur dari crystal |

Seluruh overshoot dikerjakan oleh `translate`, bukan `scale`: puncak scale
ditahan tepat di `1` supaya tidak ada frame yang meng-*upsample* artwork atau
teks. Lihat "CRISP RULE" di `widget.css` untuk alasan lengkapnya.

`letter-spacing` sengaja TIDAK dianimasikan pada nama: itu memicu relayout tiap
frame dan bisa mengedipkan ellipsis pada username panjang.

**Fix tombol test role (revisi ini)**

Semua tombol "Test role - ..." selalu memunculkan bubble Viewers biasa.
Penyebabnya: handler hanya mencocokkan **value** tombol (`test-subscriber`),
sedangkan editor StreamElements mengirim **nama field** (`testSubscriberButton`).
Semua tombol role gagal cocok lalu jatuh ke fallback "anggap saja tes chat".
Sekarang semua bentuk payload (`field`, `value`, `data.field`, `data.value`)
digabung jadi satu haystack dan dicocokkan per kata kunci, urutan paling
spesifik dulu (alert sebelum role; `subscriber` sebelum `sub`). Harness
`qa-buttons.html` memverifikasi 13 kasus, termasuk payload yang hanya berisi
nama field. Field `testChatUsername`, `testChatMessage`, `testAlertName`, dan
`testAlertType` dulu tidak pernah dibaca sama sekali - sekarang dipakai.

**2. Layer FX baru (`.gc-alert-fx`)**

Aura, shockwave ring, dan motes dibuat sebagai *sibling* dari `.gc-alert-card`,
bukan anaknya - karena kartu memakai `contain:paint` yang akan memotong aura
yang harus meluber keluar tepi artwork. Kartu diberi `z-index:1` supaya FX
selalu di belakang frame batu.

**3. Eskalasi per tier** (`ALERT_TIER` di `widget.js`)

| Event | Motes | Ring | Warna | Glow | Hold ekstra |
| --- | --- | --- | --- | --- | --- |
| `followed` | 4 | - | `#B8FFFF` | 0.72x | - |
| `subscribed` | 7 | 1 | `#B148FE` | 1.0x | - |
| `tipped` | 10 | 2 | `#F6A124` | 1.35x | +2s |
| `raided` | 10 | 2 | `#00DFFF` | 1.35x | +2s |

Warna dan kekuatan glow dikendalikan CSS lewat `--gc-alert-color` dan
`--gc-alert-glow`, jumlah mote/ring dari JS.

**4. Perbaikan lain**

- Glow idle dinaikkan dari `.035 <-> .095` menjadi `.10 <-> .20` (dikali tier).
- Exit sekarang bergerak: turun `14*--u` + fade + `scale(.985)`.
- `alertDuration` default `0` -> `8` detik, supaya alert punya beat *hold* dan
  tidak nyangkut di stack seperti chat biasa.
- **Crystal breathe diperbaiki**: rentangnya digeser dari `1 -> .965` menjadi
  `.965 -> 1`. Sebelumnya crystal hanya pernah mengempis (terbaca "kempis",
  bukan "bernapas"); sekarang mengembang keluar tapi tetap tidak pernah
  melewati scale 1. `gc-pop-crystal` disesuaikan agar berakhir di `.965`.
- **Lift stagger diperluas ke 6-8.** `maxMessages` default 8 tapi stagger cuma
  sampai 5, jadi tiga bubble terbawah terangkat serempak.
- 4 keyframe mati dibuang. Hasil audit ulang: 30 keyframe, **0 dead, 0 no-op**.
- **Jaring pengaman `decode()`**: `_play` dulu bergantung sepenuhnya pada
  `artwork.decode()`. Karena kartu mulai dari `visibility:hidden`, decode yang
  mandek berarti alert tidak pernah tampil sama sekali. Sekarang ada
  `setTimeout(start, 300)` sebagai cadangan - risikonya cuma satu frame agak
  lunak, jauh lebih baik daripada event yang hilang diam-diam.

### Biaya render

Semua beat animasi masuk hanya `transform` dan `opacity`. Animasi idle infinite
per alert naik dari 1 menjadi 2 (glow + aura); motes dan ring bersifat sekali
jalan lalu berhenti. Chat bubble tidak berubah bebannya - tetap 3 animasi idle
pada mode `gc-idle-lite`.

### Catatan alat QA

`qa-alert-frames.html` membekukan entrance pakai `animation-play-state:paused`
+ `animation-delay` negatif. Dua hal wajib: style pembeku harus dipasang
**sebelum** animasi dibuat, dan entrance harus di-*restart* betulan (reset
`className`, paksa reflow, pasang ulang). Menimpa `animation-delay` pada
animasi yang sudah selesai tidak berguna - waktunya tetap lewat dari akhir.

Jangan pakai `--dump-dom` untuk memeriksa state yang bergantung
`requestAnimationFrame`: rAF tidak dilayani di mode itu, jadi kartu akan
terlihat selalu `gc-alert-pending` padahal sebenarnya normal. Verifikasi lewat
`--screenshot`.

## Catatan animasi (revisi sebelumnya)

### Penyesuaian versi improved

- Crystal dan efek magis tetap menjadi dua animasi utama sesuai brief client.
- Tiga bubble terbaru mempertahankan aura, motes, sparkle, dan flame lengkap.
- Bubble lama tetap memiliki crystal breathe dan aura warna role, tetapi efek
  sekundernya dibuat lebih ringan untuk menjaga performa saat chat ramai.
- Lebar widget minimum dinaikkan menjadi 420px agar username dan pesan tidak
  runtuh akibat padding ornamen.
- Pesan lama dipangkas otomatis ketika tinggi seluruh chat melebihi canvas OBS.
- Default typing StreamElements disamakan menjadi 72ms per kata.
- Sheen dipersingkat agar tidak bersaing dengan crystal dan magic burst.
- Filter brightness/saturate pada artwork crystal dihapus dari entrance agar
  handoff ke idle tidak menghasilkan efek buram lalu mendadak jernih.

Enam hal yang diperbaiki di revisi ini, plus dua animasi utama sesuai brief client.

**1. Garis hitam 9-slice hilang.** Dua penyebabnya dibereskan sekaligus:
- Semua `filter: blur()` dibuang dari frame. Filter memaksa seluruh grup 9-slice
  dirender ke buffer terpisah, tiap tepi cell jadi ter-antialias ke transparan,
  dan batas slice muncul sebagai garis gelap.
- Sembilan cell tadinya cuma **bersentuhan**. Sekarang tiap tepi dalam di-overlap
  1 device pixel (`BLEED` di `layoutFrame`), destination dan source dibesarkan
  bersamaan supaya artwork tidak melar. Tidak ada celah transparan tersisa, jadi
  seam tidak bisa muncul lagi walau bubble di-composite saat animasi.

**2. Transisi ke idle tidak patah lagi.** Dulu `.gc-enter` dilepas dan `.gc-idle`
dipasang di frame yang sama saat glow masih di tengah jalan, jadi nilainya loncat.
Sekarang `gc-glow-in` **berakhir** di `--gc-glow-rest` dan `gc-breathe` **mulai**
dari nilai yang sama, jadi pergantiannya identik dan tidak kelihatan.

**3. Animasi lebih santai.** Durasi masuk 640ms -> staged (lihat poin 8),
typing 34ms -> 72ms per kata. Easing diganti ke `cubic-bezier(.25,.6,.3,1)` yang
sengaja **tanpa overshoot**, karena overshoot bikin bubble mendarat di pecahan
device pixel dan seam bisa balik lagi. Overshoot cuma dipakai di ornamen
(`--gc-ease-pop`), karena ornamen bukan 9-slice jadi tidak bisa memunculkan seam.

Lift-up sendiri sekarang **sengaja dibikin biasa**: 520ms dengan ease-out polos
(`cubic-bezier(.33,1,.68,1)`), tanpa pantulan. Lift itu cuma pergeseran layout,
bukan animasi utama, jadi dia tidak boleh ikut ramai bersaing dengan animasi
masuk ornamen.

**4. Typing murni naik dari bawah, tanpa cursor.** `gc-word` cuma `translateY` +
`opacity` - tidak ada blur, tidak ada geser samping. Caret/cursor-nya **dihapus
total**: class `.gc-last`, rule `.gc-last::after`, dan keyframes `gc-caret` sudah
tidak ada lagi di JS maupun CSS.

**5. Api-api ghost dianimasikan.** Ornamen digambar lewat `<use>`, dan CSS tidak
bisa menyentuh isi shadow tree `<use>`. Jadi tiap api **dipisah dari body ghost
saat build** jadi layer `<svg>` sendiri yang berbagi viewBox ghost. Tiap api punya
`--fdur` dan `--fdelay` berbeda supaya tidak berkedip barengan.
Jumlah api: follower 1, subscriber 3, moderator 3, streamer 3, VIP 3.

**6. Blink bergantian, bukan barengan.** Ada dua masalah berbeda di sini:

- **Di dalam satu bubble**: `blinkCrystal` dan `blinkGhost` pakai satu siklus
  `4.6s` yang sama, tapi `blinkGhost` diberi offset `-2.3s`, tepat setengah
  siklus. Jadi saat satu paling redup, satunya paling terang.
- **Antar bubble**: dulu semua bubble berkedip di beat yang sama, karena tiap
  loop idle mulai dari keyframe 0-nya sendiri dan offsetnya identik untuk semua
  pesan. Sekarang tiap bubble dapat `--gc-phase` (0..1, ditulis JS dengan langkah
  golden ratio), dan nilai itu menggeser **seluruh** timeline idle bubble
  tersebut - kedip, api, maupun partikel. Hasil pengukuran di satu instan sama:

  | Bubble | blinkCrystal | blinkGhost | api |
  | --- | --- | --- | --- |
  | 1 | 0.92 | 0.36 | 0.78 |
  | 2 | 0.61 | 0.67 | 0.83 |
  | 3 | 0.41 | 0.87 | 0.98 |
  | 4 | 1.00 | 0.28 | 0.97 |
  | 5 | 0.33 | 0.95 | 0.94 |

  Semua beda, dan crystal vs ghost selalu berlawanan di tiap baris.

**6b. Api tidak ikut irama kedip.** Durasi api (`2.3s + i*0.47`) sengaja dibuat
tidak berkelipatan dengan siklus kedip `4.6s`, dan delay-nya juga digeser
`--gc-phase`. Jadi api dan sparkle tidak pernah mengunci ke beat yang sama.

**7. Efek magis (brief client).** Dua animasi utama yang diminta:
- `.gc-aura` - pulsa radial warna role yang bernapas di balik crystal
- `.gc-mote` - partikel kecil yang naik, melayang, lalu memudar
- `.gc-orn-crystal` - crystal-nya sendiri ikut berdenyut pelan

Warnanya otomatis dari `--gc-role-color`, jadi tiap tingkatan dapat warna sihir
sesuai crystal-nya: Viewers biru abu, Follower cyan, Subscriber ungu, Moderator
hijau, Streamer merah, VIP emas.

Layer magis sengaja ditaruh **di belakang frame** (`z-index: 0`). Kalau di depan,
aura-nya menimpa panel dan bikin kolom teks ikut terwarnai; di belakang, dia cuma
kelihatan di area transparan sekitar crystal, jadi terbaca sebagai cahaya yang
memancar keluar.

**8. Animasi masuk dibikin bertahap (staged).** Dulu `.gc-anim` dianimasikan
sebagai satu wrapper, jadi base + semua ornamen masuk barengan sebagai satu blok.
Sekarang **cuma base plate** yang memainkan gerakan "chat masuk", dan tiap ornamen
punya animasi masuk sendiri:

| Layer | Mulai | Durasi | Animasi |
| --- | --- | --- | --- |
| Base plate (frame + glow) | 0ms | 900ms | naik + fade (`gc-in`) |
| Rantai VIP | 220ms | 700ms | `gc-chain-in` |
| Teks | 240ms | 700ms | `gc-rise` |
| **Crystal** | **340ms** | **800ms** | **spawn/pop `gc-pop-crystal`** |
| Highlight magis crystal | 400ms | 820ms | `gc-magic-flash` (brightness 3.2x -> normal) |
| Aura magis | 420ms | 1200ms | `gc-aura-burst` |
| Shockwave ring | 460ms | 950ms | `gc-ring-out` |
| **Ghost** | **540ms** | **780ms** | **pop `gc-pop-ghost`** |
| Api ghost | 900ms | 620ms | `gc-flame-in` (menyala setelah ghost mendarat) |
| Sparkle kedip | 900ms | 560ms | `gc-spark-in` |

Urutan yang terlihat: batu muncul dulu -> crystal spawn dengan kilatan magis +
gelombang cincin -> ghost pop -> api menyala -> sparkle terakhir. Total 1520ms.

Tiap animasi masuk **berakhir di nilai yang sama persis dengan awal loop idle-nya**
(`gc-pop-crystal` 100% = `gc-crystal-breathe` 0%, `gc-pop-ghost` 100% = `gc-float`
0%, `gc-spark-in` 100% = `gc-blink` 0%, `gc-flame-in` 100% = `gc-flame-dance` 0%,
`gc-aura-burst` 100% = `gc-aura-pulse` 0%), jadi perpindahan masuk -> idle tetap
mulus walau sekarang layer-nya jauh lebih banyak.

Semua animasi baru otomatis mati kalau OS user mengaktifkan **reduce motion**.

## Test tanpa Twitch

Buka `tuner.html` untuk test chat dan kelima alert, atau `preview.html` untuk semua role.
Di OBS/browser bisa juga panggil manual lewat console:

```js
GhostChat.add('vip', 'Nama User', 'Halo halo pesan panjang...')
GhostChat.alert('cheered', 'Nama User', { amount: 100 })
```

## Isi paket

```
assets.js         bundle SVG inline (base 6 role + ornamen), sudah dioptimasi svgo, ID di-prefix per role
alert-assets.js   lima SVG alert Figma tanpa teks placeholder
widget.js         engine: injeksi SVG, 9-slice, ornamen, event StreamElements
widget.css        layout + tipografi + animasi
preview.html      preview 6 role
qa-stretch.html   uji stretch 1 / 2 / 5 baris
qa-stage.html     uji animasi masuk bertahap: 5 bubble dibekukan di 300/650/900/1250/1700ms
qa-phase.html     ukur opacity kedip + api tiap bubble, buat cek desync antar bubble
qa-alert.html     render chat + alert bersamaan pakai asset lokal, buat cek entrance alert
qa-alert-frames.html  filmstrip: entrance alert dibekukan di 0/120/240/360/480/620/900ms
qa-alert-debug.html   dump class + computed style tiap kartu alert (pakai --screenshot, bukan --dump-dom)
streamelements/   HTML.html (1 div), CSS.css, JS.js (engine + SVG), FIELDS.json siap paste
```

Catatan: emote Twitch tetap dimuat sebagai gambar dari CDN Twitch/7TV (itu memang bawaan Twitch,
bukan asset desainmu). Semua asset desain 100% SVG.
