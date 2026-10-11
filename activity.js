/* Aktivitas otak: "apa yang dirasakan lalat".
 *
 * Setiap keadaan (skenario) menyalakan kelompok neuron (kelas) dengan intensitas
 * tertentu sehingga sinyal cahaya bergerak sensory -> central -> motor/descending,
 * sesuai alur otak sungguhan. Setiap keadaan membawa teks perasaan yang
 * ditampilkan pada panel di bawah otak.
 *
 * Data di web/data bersifat sintetis dan kelasnya tersebar acak, jadi pemetaan
 * ke "wilayah" dilakukan lewat groups[kelas], bukan lewat posisi 3D. Karena itu
 * fraksi yang dinyalakan sengaja kecil: supaya yang terlihat adalah neuron
 * menyala yang jelas terpisah, bukan gumpalan putih. */
(() => {
  // fire: [nama kelas, intensitas 0..1, fraksi neuron kelas itu yang menyala]
  const SCENARIOS = [
    {
      id: 'istirahat',
      label: 'istirahat',
      feel: 'Lalat diam di tempatnya. Sayap berdepit pelan, antena menapso kecil mencari bau.',
      detail: 'Tidak ada rangsang kuat; hanya gelombang aktivitas lemah khas lalat yang sedang diam.',
      phases: [
        { ms: 1600, fire: [['sensory', 0.12, 0.012]] },
        { ms: 1400, fire: [['sensory', 0.08, 0.006], ['central', 0.06, 0.002]] },
      ],
    },
    {
      id: 'mencari-makan',
      label: 'mencari makan',
      feel: 'Aroma makanan terdeteksi. Lalat gelisah, sayap mulai bergetar siap terbang.',
      detail: 'Reseptor penciuman menyala terang, sinyal naik ke otak tengah, lalu motor disiapkan.',
      phases: [
        { ms: 1500, fire: [['sensory', 0.55, 0.030]] },
        { ms: 1500, fire: [['sensory', 0.70, 0.045], ['central', 0.40, 0.010]] },
        { ms: 1500, fire: [['sensory', 0.45, 0.022], ['central', 0.60, 0.014], ['motor', 0.45, 0.060]] },
      ],
    },
    {
      id: 'bahaya-mendekat',
      label: 'bahaya mendekat',
      feel: 'Bayangan mendadak melintas di atas. Lalat merasa terancam, lalu refleks lari.',
      detail: 'Lobe optik mendeteksi benda mendekat; jalur descending dan motor disiapkan untuk melarikan diri.',
      phases: [
        { ms: 900, fire: [['optic', 0.95, 0.016]] },
        { ms: 700, fire: [['optic', 1.00, 0.022], ['central', 0.50, 0.008]] },
        { ms: 700, fire: [['central', 0.80, 0.012], ['descending', 0.90, 0.070], ['motor', 0.85, 0.090]] },
      ],
    },
    {
      id: 'cahaya-menusuk',
      label: 'cahaya menyilaukan',
      feel: 'Cahaya menyilaukan. Lalat refleks berbalik dan lari.',
      detail: 'Lobe optik melonjak, jalur ascendant menyala, lalu perintah escape turun ke motor.',
      phases: [
        { ms: 800, fire: [['optic', 1.00, 0.026]] },
        { ms: 700, fire: [['optic', 0.90, 0.019], ['sensory', 0.60, 0.020], ['ascending', 0.50, 0.060]] },
        { ms: 700, fire: [['central', 0.90, 0.014], ['descending', 1.00, 0.100], ['motor', 0.95, 0.130]] },
      ],
    },
    {
      id: 'bertengkar',
      label: 'bertengkar',
      feel: 'Lalat menemukan lawan. Marah, sayap mengepal, siap duel.',
      detail: 'Aktivitas tinggi terpusat: descending dan motor mendominasi, lobe optik menyala sesaat.',
      phases: [
        { ms: 800, fire: [['optic', 0.50, 0.006]] },
        { ms: 800, fire: [['central', 0.95, 0.016], ['descending', 0.85, 0.060]] },
        { ms: 800, fire: [['descending', 1.00, 0.110], ['motor', 1.00, 0.150], ['optic', 0.35, 0.004]] },
      ],
    },
  ];

  class Activity {
    constructor(fb) {
      this.fb = fb;
      this.seed = 12345;
      this.onChange = null;   // dipanggil saat keadaan atau fase berubah
      this.cycle = 0;
      this.t = 0;
      this.phaseIdx = 0;
      this.current = SCENARIOS[0];
      this.auto = true;
      this._rng = this._mulberry(this.seed);
    }

    // Generator acak berbenih supaya pola nyala neuron bisa diulang.
    _mulberry(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /** Pilih keadaan; mulai lagi dari fase pertama. */
    play(id) {
      const s = SCENARIOS.find((x) => x.id === id);
      if (!s) return;
      this.current = s;
      this.phaseIdx = 0;
      this.t = 0;
      this._emit();
    }

    next() {
      if (!this.auto) return;
      const order = SCENARIOS.map((s) => s.id);
      const i = order.indexOf(this.current.id);
      this.cycle += 1;
      this.play(order[(i + 1) % order.length]);
    }

    _emit() {
      if (this.onChange) this.onChange(this.current, this.phaseIdx);
    }

    /** Dipanggil tiap frame dengan dt dalam detik. */
    update(dt) {
      const phase = this.current.phases[this.phaseIdx];
      this.t += dt * 1000;
      if (this.t >= phase.ms) {
        this.t = 0;
        this.phaseIdx += 1;
        if (this.phaseIdx >= this.current.phases.length) {
          this.phaseIdx = 0;
          if (this.auto) { this.next(); return; }
          this._emit();
        } else {
          this._emit();
        }
      }
      // Nyalakan kelas sesuai fase berjalan supaya cahaya terus bergerak.
      for (const [cls, v, frac] of this.current.phases[this.phaseIdx].fire) {
        const g = this.fb.groups[cls];
        if (!g || !g.length) continue;
        this.fb.pulseClass(cls, Math.max(1, Math.round(g.length * frac)), v, this._rng);
      }
    }
  }

  window.FlyBrainActivity = { Activity, SCENARIOS };
})();