#!/usr/bin/env python3
"""Bangun data 3D otak lalat untuk viewer web (data/*).

  python tools/build_brain.py --download --out data-flywire    # data FlyWire v783 asli
  python tools/build_brain.py --raw ./raw --out data-flywire   # file sudah diunduh
  python tools/build_brain.py --synthetic --out data   # data palsu, hanya untuk uji

Keluaran (semua little-endian, urutan neuron = urutan baris classification.csv.gz):
  meta.json   ringkasan + daftar kelas   pos.f32  N*3 float32, dinormalisasi ~[-1,1]
  cls.u8      indeks kelas per neuron    est.u8   1 = posisi ESTIMASI, 0 = terukur
  deg.f32     log-derajat 0..1           ids.txt  root_id per baris (string, >2^53)
  edges.u32   2*K indeks (pre,post)      ew.f32   K bobot 0..1 (sinaps, ternormalisasi)
"""
import argparse, json, re, sys, urllib.request
from pathlib import Path
import numpy as np
import pandas as pd

BASE = "https://storage.googleapis.com/flywire-data/codex/data/fafb/783"
FILES = ["classification.csv.gz", "coordinates.csv.gz", "connections.csv.gz"]


def download(dst: Path):
    dst.mkdir(parents=True, exist_ok=True)
    for f in FILES:
        p = dst / f
        if p.exists():
            continue
        print("unduh", f, flush=True)
        urllib.request.urlretrieve(f"{BASE}/{f}", p)


def col(df, *keys, required=True):
    """Kolom pertama yang namanya memuat semua kata kunci (tahan beda penamaan)."""
    for c in df.columns:
        if all(k in c.lower() for k in keys):
            return c
    if required:
        sys.exit(f"Kolom {keys} tidak ditemukan. Kolom ada: {list(df.columns)}")


def load_positions(path):
    df = pd.read_csv(path)
    idc = col(df, "root", "id")
    xyz = [c for c in df.columns if re.search(r"(^|[^a-z])[xyz]($|[^a-z])", c.lower())]
    if len(xyz) >= 3 and all(pd.api.types.is_numeric_dtype(df[c]) for c in xyz[:3]):
        P = df[xyz[:3]].to_numpy(float)
    else:  # satu kolom string "[x, y, z]" atau "x y z"
        pc = next((c for c in df.columns if re.search(r"pos|coord|soma|nucle", c.lower())
                   and not pd.api.types.is_numeric_dtype(df[c])), None)
        if pc is None:
            sys.exit(f"Kolom posisi tidak ditemukan. Kolom ada: {list(df.columns)}")
        nums = df[pc].astype(str).str.findall(r"-?\d+(?:\.\d+)?")
        P = np.full((len(df), 3), np.nan)
        for i, v in enumerate(nums):
            if len(v) >= 3:
                P[i] = [float(t) for t in v[:3]]
        print("posisi dari kolom:", pc)
    out = pd.DataFrame(P, columns=list("xyz"))
    out.insert(0, "id", df[idc].astype(str).values)
    return out.drop_duplicates("id").set_index("id")


def real(raw: Path, flip_y: bool):
    cl = pd.read_csv(raw / "classification.csv.gz")
    idc, scc = col(cl, "root", "id"), col(cl, "super", "class")
    ids = cl[idc].astype(str).values
    sc = cl[scc].fillna("unknown").astype(str).values
    classes = sorted(set(sc))
    cls = np.array([classes.index(s) for s in sc], np.uint8)
    n = len(ids)
    index = pd.Index(ids)
    print(f"{n} neuron, kelas: {classes}")

    pos = load_positions(raw / "coordinates.csv.gz").reindex(ids)
    P = pos[["x", "y", "z"]].to_numpy(float)

    # sinaps: agregasi (pre,post) per potongan agar hemat memori
    acc = []
    first = True
    for ch in pd.read_csv(raw / "connections.csv.gz", chunksize=1_000_000):
        if first:
            pre, post, w = col(ch, "pre", "root"), col(ch, "post", "root"), col(ch, "syn", "count")
            first = False
        acc.append(ch.groupby([ch[pre].astype(str), ch[post].astype(str)])[w].sum())
    e = pd.concat(acc).groupby(level=[0, 1]).sum().reset_index()
    a = index.get_indexer(e.iloc[:, 0])
    b = index.get_indexer(e.iloc[:, 1])
    w = e.iloc[:, 2].to_numpy(float)
    ok = (a >= 0) & (b >= 0)
    a, b, w = a[ok], b[ok], w[ok]
    print(f"{len(w)} koneksi (pre,post)")
    return ids, classes, cls, P, a.astype(np.uint32), b.astype(np.uint32), w


def synthetic(n=20000, seed=7):
    rng = np.random.default_rng(seed)
    classes = ["central", "optic", "sensory", "motor", "descending", "ascending"]
    p = np.array([.45, .30, .10, .04, .06, .05])
    cls = rng.choice(len(classes), n, p=p).astype(np.uint8)
    P = rng.normal(size=(n, 3)) * [1.0, 0.7, 0.6]
    side = rng.choice([-1, 1], n)
    opt = cls == 1
    P[opt, 0] = side[opt] * (1.3 + 0.3 * rng.random(opt.sum()))
    ids = np.array([str(720575940600000000 + i) for i in range(n)])
    k = n * 12
    a = rng.integers(0, n, k)
    b = np.where(rng.random(k) < .7, np.clip(a + rng.integers(-300, 300, k), 0, n - 1),
                 rng.integers(0, n, k))
    w = rng.gamma(1.5, 4.0, k) + 1
    return ids, classes, cls, P, a.astype(np.uint32), b.astype(np.uint32), w


def finish(ids, classes, cls, P, a, b, w, out: Path, flip_y, k_edges, source):
    n = len(ids)
    P = np.array(P, dtype=float)  # salinan yang bisa ditulis
    w = np.asarray(w, dtype=float)
    known = ~np.isnan(P).any(1)
    est = (~known).astype(np.uint8)
    # estimasi posisi neuron tanpa koordinat: rata-rata tetangga berbobot (3 putaran)
    for _ in range(3):
        if known.all():
            break
        num, den = np.zeros((n, 3)), np.zeros(n)
        for s, t in ((a, b), (b, a)):
            m = (~known[s]) & known[t]
            np.add.at(num, s[m], w[m, None] * P[t[m]])
            np.add.at(den, s[m], w[m])
        got = (~known) & (den > 0)
        P[got] = num[got] / den[got, None]
        known = known | got
    c = np.nanmedian(P, 0)
    P[~known] = c + np.random.default_rng(1).normal(scale=1e-3, size=((~known).sum(), 3))
    P = P - c
    P /= np.percentile(np.abs(P), 99) or 1.0
    if flip_y:
        P[:, 1] *= -1

    deg = np.zeros(n)
    np.add.at(deg, a, w)
    np.add.at(deg, b, w)
    deg = np.log1p(deg)
    deg /= deg.max() or 1.0

    top = np.argsort(-w)[:k_edges]
    out.mkdir(parents=True, exist_ok=True)
    P.astype("<f4").tofile(out / "pos.f32")
    cls.astype("u1").tofile(out / "cls.u8")
    est.tofile(out / "est.u8")
    deg.astype("<f4").tofile(out / "deg.f32")
    np.stack([a[top], b[top]], 1).astype("<u4").tofile(out / "edges.u32")
    (w[top] / w[top].max()).astype("<f4").tofile(out / "ew.f32")
    (out / "ids.txt").write_text("\n".join(ids))
    meta = dict(n=int(n), k=int(len(top)), classes=classes, source=source,
                counts={c: int((cls == i).sum()) for i, c in enumerate(classes)},
                estimated=int(est.sum()), flip_y=flip_y)
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data", type=Path)
    ap.add_argument("--raw", default="raw", type=Path)
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--edges", type=int, default=80000, help="jumlah koneksi terkuat yang digambar")
    ap.add_argument("--no-flip-y", action="store_true")
    o = ap.parse_args()
    if o.synthetic:
        r, src = synthetic(), "SINTETIS (bukan data lalat)"
    else:
        if o.download:
            download(o.raw)
        r, src = real(o.raw, not o.no_flip_y), "FlyWire FAFB v783 (Codex)"
    finish(*r, o.out, not o.no_flip_y, o.edges, src)
