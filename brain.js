/* FlyBrain: viewer 3D konektom lalat (three.js r128). API publik: window.FlyBrain.
 * Titik = posisi soma neuron; garis = koneksi terkuat. Aktivitas (0..1) membuat titik menyala
 * lalu meluruh. Pasang sistem neuron lewat setActivity/pulse (keluar) dan groups (indeks kelas). */
(() => {
  const NAMED = { central: '#4cc9f0', optic: '#f9c74f', sensory: '#90be6d', motor: '#f94144',
    descending: '#f3722c', ascending: '#b5179e', endocrine: '#ffffff',
    visual_projection: '#ffd166', visual_centrifugal: '#ff9e00' };

  const bin = async (url, T) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return new T(await r.arrayBuffer());
  };

  const VERT = `
    attribute vec3 aColor; attribute float aSize, aAct, aVis;
    uniform float uScale, uPx; varying vec3 vC; varying float vA, vAct;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      // Active neurons swell a little so a lit cluster is readable at a glance.
      gl_PointSize = aVis * (aSize * uScale + aAct * uScale * 0.22) * uPx / -mv.z;
      vC = aColor; vAct = aAct; vA = aVis * (0.035 + 0.965 * min(aAct, 1.0));
    }`;
  // Two-part sprite: a tight white-hot core inside a soft coloured halo. Only
  // ACTIVE neurons get the bright core — resting neurons stay dim so 20k
  // additive points don't wash the whole brain into a white blob.
  const FRAG = `
    varying vec3 vC; varying float vA, vAct;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float core = smoothstep(0.22, 0.02, d) * smoothstep(0.06, 0.30, vAct); // bright only when lit
      float halo = smoothstep(0.50, 0.14, d);
      vec3 hot  = mix(vC, vec3(1.0), 0.55);                    // toward white
      vec3 rgb  = vC * (0.55 + vAct * 1.0) + hot * core * 0.7;
      float a   = (halo * (0.06 + 0.26 * vAct) + core * 0.40) * vA;
      gl_FragColor = vec4(rgb, a);
    }`;

  const FB = {
    demo: false, tau: 0.35, onPick: null,

    async init(container, base = 'data/') {
      const meta = this.meta = await (await fetch(base + 'meta.json')).json();
      const n = this.n = meta.n;
      const [pos, cls, est, deg, ei, ew] = await Promise.all([
        bin(base + 'pos.f32', Float32Array), bin(base + 'cls.u8', Uint8Array),
        bin(base + 'est.u8', Uint8Array), bin(base + 'deg.f32', Float32Array),
        bin(base + 'edges.u32', Uint32Array), bin(base + 'ew.f32', Float32Array)]);
      Object.assign(this, { pos, cls, est, deg, base });

      this.palette = meta.classes.map((c, i) =>
        new THREE.Color(NAMED[c] || new THREE.Color().setHSL((i * 0.137) % 1, 0.7, 0.6)));
      this.groups = {};
      meta.classes.forEach(c => (this.groups[c] = []));
      for (let i = 0; i < n; i++) this.groups[meta.classes[cls[i]]].push(i);
      for (const c in this.groups) this.groups[c] = Uint32Array.from(this.groups[c]);

      // --- scene ---
      const w = container.clientWidth, h = container.clientHeight;
      const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
      r.setPixelRatio(Math.min(devicePixelRatio, 2));
      r.setSize(w, h);
      r.setClearColor(0x050912);
      container.appendChild(r.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 50);
      this.camera.position.set(0, 0.4, 3.2);
      this.controls = new THREE.OrbitControls(this.camera, r.domElement);
      this.controls.enableDamping = true;
      this.controls.autoRotate = false;

      // --- titik neuron ---
      const g = new THREE.BufferGeometry();
      const col = new Float32Array(n * 3), size = new Float32Array(n);
      this.act = new Float32Array(n);
      this.vis = new Float32Array(n).fill(1);
      for (let i = 0; i < n; i++) {
        const c = this.palette[cls[i]];
        col.set([c.r, c.g, c.b], i * 3);
        size[i] = 0.010 + 0.022 * deg[i];
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aAct', new THREE.BufferAttribute(this.act, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aVis', new THREE.BufferAttribute(this.vis, 1).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 1 }, uPx: { value: r.domElement.height * 0.6 } }
      });
      this.points = new THREE.Points(g, m);
      this.points.frustumCulled = false;
      this.scene.add(this.points);

      // --- garis koneksi (K koneksi terkuat) ---
      const k = meta.k, lp = new Float32Array(k * 6), lc = new Float32Array(k * 6);
      for (let e = 0; e < k; e++) {
        const a = ei[2 * e], b = ei[2 * e + 1], c = this.palette[cls[a]], s = 0.25 + 0.75 * ew[e];
        lp.set(pos.subarray(a * 3, a * 3 + 3), e * 6);
        lp.set(pos.subarray(b * 3, b * 3 + 3), e * 6 + 3);
        for (let j = 0; j < 2; j++) lc.set([c.r * s, c.g * s, c.b * s], e * 6 + j * 3);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
      this.edgeLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.012, depthWrite: false,
        blending: THREE.AdditiveBlending }));
      this.edgeLines.frustumCulled = false;
      this.scene.add(this.edgeLines);

      addEventListener('resize', () => this.resize(container));
      let down = null;
      r.domElement.addEventListener('pointerdown', e => (down = [e.clientX, e.clientY]));
      r.domElement.addEventListener('pointerup', e => {
        if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) this.pickAt(e.clientX, e.clientY);
      });
      this.last = performance.now();
      this.loop();
    },

    resize(c) {
      const w = c.clientWidth, h = c.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.points.material.uniforms.uPx.value = h * 0.6;
    },

    loop() {
      requestAnimationFrame(() => this.loop());
      const now = performance.now(), dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.step(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    },

    /** Per frame: demo acak (opsional) + peluruhan aktivitas. Titik pasang simulasi neuron di sini. */
    step(dt) {
      if (this.demo) for (let j = 0; j < 150; j++) this.act[(Math.random() * this.n) | 0] = 1;
      const f = Math.exp(-dt / this.tau), a = this.act;
      for (let i = 0; i < a.length; i++) if (a[i] > 0.002) a[i] *= f; else a[i] = 0;
      this.points.geometry.attributes.aAct.needsUpdate = true;
    },

    // ---- navigasi kiri / kanan ----
    /** Putar otak ke kiri/kanan (derajat) di sekitar sumbu Y. */
    spinY(deg) {
      const o = this.controls.object.position;
      const r = Math.hypot(o.x, o.z) || 1, a = (deg * Math.PI) / 180;
      const x = o.x * Math.cos(a) - o.z * Math.sin(a);
      const z = o.x * Math.sin(a) + o.z * Math.cos(a);
      o.set(x, o.y, z);
      this.controls.update();
    },
    /** Geser pandangan ke kiri/kanan (pan) tanpa memutar otak. */
    panX(amount) {
      const o = this.controls.object.position;
      o.x += amount;
      this.controls.update();
    },
    /** Set zoom (jarak kamera). */
    zoom(factor) {
      const o = this.controls.object.position;
      const d = Math.hypot(o.x, o.y - this.controls.target.y, o.z) * factor;
      const dir = new THREE.Vector3().subVectors(o, this.controls.target).normalize();
      o.copy(this.controls.target).addScaledVector(dir, d);
      this.controls.update();
    },
    /** Kembalikan kamera ke posisi awal. */
    resetView() {
      this.camera.position.set(0, 0.4, 3.2);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    },

    // ---- API untuk agent / sistem neuron ----
    setActivity(i, v) { this.act[i] = v; },
    /** Nyalakan banyak neuron sekaligus. indices: array indeks neuron (lihat groups[kelas]). */
    pulse(indices, v = 1) { for (let j = 0; j < indices.length; j++) this.act[indices[j]] = v; },
    /** Nyalakan sebagian acak dari satu kelas (dengan rng, mis. seeded). */
    pulseClass(className, count, v = 1, rng = Math.random) {
      const idx = this.sample(className, count, rng);
      this.pulse(idx, v);
      return idx;
    },
    /** Intensitas rata-rata kelas saat ini (0..1) untuk meter di UI. */
    classLevel(className) {
      const g = this.groups[className];
      if (!g || !g.length) return 0;
      let s = 0;
      for (let i = 0; i < g.length; i += Math.max(1, Math.ceil(g.length / 500))) s += this.act[g[i]];
      return s / Math.max(1, Math.ceil(g.length / 500));
    },
    /** Aktivitas global 0..1 (rata-rata semua neuron). */
    totalLevel() {
      const a = this.act;
      let s = 0, c = 0;
      for (let i = 0; i < a.length; i += 20) { s += a[i]; c++; }
      return c ? s / c : 0;
    },
    /** Ambil n indeks acak (seed tetap bila diberi rng) dari satu kelas, mis. 'sensory'. */
    sample(className, n, rng = Math.random) {
      const g = this.groups[className] || [], out = [];
      for (let j = 0; j < n && g.length; j++) out.push(g[(rng() * g.length) | 0]);
      return out;
    },
    setClassVisible(ci, on) {
      const { cls, vis } = this;
      for (let i = 0; i < cls.length; i++) if (cls[i] === ci) vis[i] = on ? 1 : 0;
      this.points.geometry.attributes.aVis.needsUpdate = true;
    },
    colorOf(ci) { return '#' + this.palette[ci].getHexString(); },
    async rootId(i) {
      if (!this._ids) this._ids = (await (await fetch(this.base + 'ids.txt')).text()).split('\n');
      return this._ids[i];
    },

    /** Titik terdekat di layar (<=12 px) yang terlihat; memanggil onPick(indeks). */
    pickAt(cx, cy) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const mx = cx - rect.left, my = cy - rect.top, v = new THREE.Vector3();
      const M = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      let best = -1, bd = 144;
      for (let i = 0; i < this.n; i++) {
        if (!this.vis[i]) continue;
        v.set(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]).applyMatrix4(M);
        if (v.z > 1 || v.z < -1) continue;
        const dx = (v.x * 0.5 + 0.5) * rect.width - mx, dy = (-v.y * 0.5 + 0.5) * rect.height - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { this.act[best] = 1; this.onPick && this.onPick(best); }
    }
  };
  window.FlyBrain = FB;
})();
