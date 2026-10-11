/* Jembatan viewer 3D <-> web poker.
 *
 * Mengambil /api/brain dari server poker lalu menyalakan neuron yang benar-benar
 * aktif saat lalat memutuskan (fold/check/call/raise), dan menuliskan "apa yang
 * dirasakan" di panel bawah. Kalau policy-nya bukan neural (bot skrip), viewer
 * kembali ke skenario simulasi.
 *
 * Pakai: buka viewer dengan ?live=http://127.0.0.1:8000  (opsional ?data=data-poker/) */
(() => {
  const qs = new URLSearchParams(location.search);
  const URL_BASE = qs.get('live') || 'http://127.0.0.1:8000';

  // Apa yang dirasakan lalat untuk tiap aksi.
  const FEEL = {
    fold:   ['menyerah', 'Kartu terasa jelek — lebih baik menyerah sekarang'],
    check:  ['sabar',    'Tidak mau ambil risiko dulu, cuma ingin melihat'],
    call:   ['gigih',    'Ikut-manyang sambil menjaga chip di tangan'],
    bet:    ['ngepush',  'Bangga sama kartunya, mau menaikkan chip'],
    raise:  ['yakin',    'Yakin kartunya kuat — menaikkan taruhan'],
  };

  function describe(action) {
    const f = FEEL[action] || FEEL.raise;
    document.getElementById('mood').textContent = f[0];
    document.getElementById('say').textContent = f[1];
  }

  function start(fb, simulatedActivity) {
    let wasLive = false;
    // Skenario simulasi disimpan supaya bisa hidup lagi kalau mode live mati.
    const simulated = simulatedActivity || null;
    if (simulated) simulated.auto = false;   // mode live mengambil alih

    async function tick() {
      try {
        const res = await fetch(URL_BASE + '/api/brain');
        const d = await res.json();
        if (d.trained && d.indices) {
          for (let i = 0; i < d.indices.length; i++) fb.setActivity(d.indices[i], d.values[i]);
          const ctx = (d.hole || []).join(' ');
          const board = d.board && d.board.length ? ` · board ${d.board.join(' ')}` : '';
          document.getElementById('why').textContent =
            `kartu ${ctx}${board} · pot $${d.pot} → aksi ${d.action} · neuron aktif disorot`;
          describe(d.action);
          wasLive = true;
        } else if (wasLive) {
          document.getElementById('why').textContent =
            'policy bukan neural — kembali ke skenario simulasi';
          if (simulated) { simulated.auto = true; wasLive = false; }
        }
      } catch { /* server poker mati / belum siap; coba lagi */ }
      setTimeout(tick, 250);
    }
    tick();
  }

  window.FlyBrainPokerLink = { start, URL_BASE };
})();