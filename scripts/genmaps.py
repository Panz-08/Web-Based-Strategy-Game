#!/usr/bin/env python3
"""Generator peta dunia nyata -> src/core/maps/*.ts (hasilnya ikut di-commit, tidak perlu dijalankan lagi).

Sumber batas negara: scripts/data/countries.geo.json (johan/world.geo.json, domain publik / UNLICENSE).
Butuh: python3, numpy, matplotlib. Jalankan:  python3 scripts/genmaps.py [--preview dir]
"""
import json
import math
import os
import sys
from collections import deque

import numpy as np
from matplotlib.path import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import genmaps_data as D  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'core', 'maps')
SS = 3  # subsampel per sel (SS x SS)

T_WATER, T_PLAIN, T_FOREST, T_MOUNTAIN, T_SHALLOW = 0, 1, 2, 3, 4


# ------------------------------------------------------------------ proyeksi
def make_proj(m):
    if m['proj'] == 'ne1':
        def f(lon, lat):
            lam = np.radians(lon)
            p = np.radians(lat)
            p2 = p * p
            p4 = p2 * p2
            x = lam * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)))
            y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))
            return x, y
        return f
    p1, p2_, lon0 = m['lcc']
    r1, r2 = math.radians(p1), math.radians(p2_)
    n = math.log(math.cos(r1) / math.cos(r2)) / math.log(math.tan(math.pi / 4 + r2 / 2) / math.tan(math.pi / 4 + r1 / 2))
    F = math.cos(r1) * math.tan(math.pi / 4 + r1 / 2) ** n / n
    rho0 = F / math.tan(math.pi / 4 + math.radians((p1 + p2_) / 2) / 2) ** n

    def g(lon, lat):
        lon = np.asarray(lon, dtype=float)
        lat = np.asarray(lat, dtype=float)
        rho = F / np.tan(np.pi / 4 + np.radians(lat) / 2) ** n
        th = n * np.radians(lon - lon0)
        return rho * np.sin(th), rho0 - rho * np.cos(th)
    return g


def densify(ring, step=0.6):
    out = []
    for i in range(len(ring) - 1):
        (x0, y0), (x1, y1) = ring[i], ring[i + 1]
        k = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        for j in range(k):
            t = j / k
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    out.append(tuple(ring[-1]))
    return out


class Grid:
    def __init__(self, m):
        self.m = m
        self.proj = make_proj(m)
        lon0, lon1, lat0, lat1 = m['box']
        pts = []
        for t in np.linspace(0, 1, 120):
            for lat in (lat0, lat1):
                pts.append((lon0 + (lon1 - lon0) * t, lat))
            for lon in (lon0, lon1):
                pts.append((lon, lat0 + (lat1 - lat0) * t))
        px, py = self.proj(np.array([p[0] for p in pts]), np.array([p[1] for p in pts]))
        self.x0, self.x1, self.y0, self.y1 = px.min(), px.max(), py.min(), py.max()
        self.w = m['w']
        self.s = self.w / (self.x1 - self.x0)
        self.h = int(math.ceil((self.y1 - self.y0) * self.s))
        # cells per degree (di tengah kotak)
        cx, cy = self.to_cells(np.array([(lon0 + lon1) / 2, (lon0 + lon1) / 2 + 1]), np.array([(lat0 + lat1) / 2, (lat0 + lat1) / 2]))
        self.cpd = abs(cx[1] - cx[0])

    def to_cells(self, lon, lat):
        x, y = self.proj(lon, lat)
        return (x - self.x0) * self.s, (self.y1 - y) * self.s  # y ke bawah (utara di atas)

    def poly_cells(self, poly, step=0.6):
        ring = densify(list(poly) + [poly[0]], step)
        lon = np.array([p[0] for p in ring])
        lat = np.array([p[1] for p in ring])
        cx, cy = self.to_cells(lon, lat)
        return np.stack([cx, cy], 1)


# ------------------------------------------------------------------ noise
def noise_field(w, h, seed, scale):
    rng = np.random.default_rng(seed)
    gw, gh = int(w / scale) + 3, int(h / scale) + 3
    g = rng.random((gh, gw))
    ys, xs = np.mgrid[0:h, 0:w]
    fx, fy = xs / scale, ys / scale
    x0, y0 = fx.astype(int), fy.astype(int)
    tx, ty = fx - x0, fy - y0
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = g[y0, x0]
    b = g[y0, x0 + 1]
    c = g[y0 + 1, x0]
    d = g[y0 + 1, x0 + 1]
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty


def fbm(w, h, seed, scale):
    return 0.6 * noise_field(w, h, seed, scale) + 0.3 * noise_field(w, h, seed + 1, scale / 2.1) + 0.1 * noise_field(w, h, seed + 2, scale / 4.3)


# ------------------------------------------------------------------ raster negara
def shoelace(r):
    a = np.array(r, dtype=float)
    x, y = a[:, 0], a[:, 1]
    return abs(np.dot(x[:-1], y[1:]) - np.dot(x[1:], y[:-1])) / 2


def load_countries():
    data = json.load(open(os.path.join(ROOT, 'scripts', 'data', 'countries.geo.json'), encoding='utf-8'))
    feats = []
    for f in data['features']:
        name = f['properties']['name']
        if name == 'Antarctica' or name.startswith('French Southern'):
            continue
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = [p[0] for p in polys]
        area = sum(shoelace(r) for r in rings if len(r) > 3)
        feats.append((name, rings, area))
    feats.sort(key=lambda t: -t[2])  # besar dulu, kecil menimpa
    return feats


def rasterize(grid, feats):
    w, h = grid.w, grid.h
    ys, xs = np.mgrid[0:h * SS, 0:w * SS]
    sx = (xs + 0.5) / SS
    sy = (ys + 0.5) / SS
    pts = np.stack([sx.ravel(), sy.ravel()], 1)
    reg = np.full(pts.shape[0], -1, dtype=np.int16)
    names = []
    for name, rings, _ in feats:
        idx = len(names)
        hit_any = False
        for ring in rings:
            if len(ring) < 4:
                continue
            c = grid.poly_cells([tuple(p) for p in ring[:-1]], 0.5)
            if c[:, 0].max() < -2 or c[:, 0].min() > w + 2 or c[:, 1].max() < -2 or c[:, 1].min() > h + 2:
                continue
            x0, x1, y0, y1 = c[:, 0].min(), c[:, 0].max(), c[:, 1].min(), c[:, 1].max()
            m = (pts[:, 0] >= x0) & (pts[:, 0] <= x1) & (pts[:, 1] >= y0) & (pts[:, 1] <= y1)
            ii = np.nonzero(m)[0]
            if not len(ii):
                continue
            inside = Path(c).contains_points(pts[ii])
            if inside.any():
                reg[ii[inside]] = idx
                hit_any = True
        names.append(name if hit_any else None)
    reg = reg.reshape(h, SS, w, SS).transpose(0, 2, 1, 3).reshape(h, w, SS * SS)
    land_cnt = (reg >= 0).sum(2)
    region = np.full((h, w), -1, dtype=np.int16)
    for y in range(h):
        for x in range(w):
            if land_cnt[y, x] >= max(2, SS * SS // 2 - 1):
                vals = reg[y, x][reg[y, x] >= 0]
                region[y, x] = np.bincount(vals).argmax()
    return region, names


def mask_poly(grid, poly):
    c = grid.poly_cells(poly, 0.5)
    h, w = grid.h, grid.w
    ys, xs = np.mgrid[0:h, 0:w]
    pts = np.stack([(xs + 0.5).ravel(), (ys + 0.5).ravel()], 1)
    return Path(c).contains_points(pts).reshape(h, w)


def components(terrain):
    h, w = terrain.shape
    comp = np.full((h, w), -1, dtype=np.int32)
    sizes = []
    for sy in range(h):
        for sx in range(w):
            if terrain[sy, sx] == T_WATER or comp[sy, sx] >= 0:
                continue
            cid = len(sizes)
            q = deque([(sy, sx)])
            comp[sy, sx] = cid
            n = 0
            while q:
                y, x = q.popleft()
                n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and terrain[yy, xx] != T_WATER and comp[yy, xx] < 0:
                        comp[yy, xx] = cid
                        q.append((yy, xx))
            sizes.append(n)
    return comp, sizes


def connect_straits(terrain, maxd):
    """Hubungkan pulau/benua terdekat lewat jalur laut dangkal (maks maxd sel)."""
    h, w = terrain.shape
    added = 0
    while True:
        comp, sizes = components(terrain)
        if len(sizes) < 2:
            break
        main = int(np.argmax(sizes))
        # BFS dari seluruh komponen utama lewat air
        dist = np.full((h, w), -1, dtype=np.int32)
        par = {}
        q = deque()
        for y, x in zip(*np.nonzero(comp == main)):
            dist[y, x] = 0
            q.append((y, x))
        found = None
        while q and found is None:
            y, x = q.popleft()
            if dist[y, x] >= maxd + 1:
                break
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if not (0 <= yy < h and 0 <= xx < w) or dist[yy, xx] >= 0:
                    continue
                dist[yy, xx] = dist[y, x] + 1
                par[(yy, xx)] = (y, x)
                if terrain[yy, xx] != T_WATER:
                    if comp[yy, xx] != main and sizes[comp[yy, xx]] >= 3:
                        found = (yy, xx)
                        break
                    continue  # komponen kecil/serpih: jangan diteruskan
                q.append((yy, xx))
        if found is None:
            break
        cur = par[found]
        steps = 0
        while terrain[cur] == T_WATER:
            terrain[cur] = T_SHALLOW
            added += 1
            steps += 1
            cur = par[cur]
        if steps == 0:  # sudah bersentuhan diagonal? paksa satu sel
            break
    return added


def nearest_valid(terrain, cx, cy, r, bad=(T_WATER, T_MOUNTAIN, T_SHALLOW), need=0.6, taken=()):
    h, w = terrain.shape
    best = None
    bd = 1e9
    for rad in range(0, 8):
        for y in range(max(0, int(cy) - rad), min(h, int(cy) + rad + 1)):
            for x in range(max(0, int(cx) - rad), min(w, int(cx) + rad + 1)):
                if terrain[y, x] in bad:
                    continue
                tot = good = 0
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        if dx * dx + dy * dy > r * r + 1:
                            continue
                        yy, xx = y + dy, x + dx
                        tot += 1
                        if 0 <= yy < h and 0 <= xx < w and terrain[yy, xx] not in (T_WATER,):
                            good += 1
                if good / tot < need:
                    continue
                d = (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2
                if any(abs(x - tx) + abs(y - ty) < 2 * r + 1 for tx, ty in taken):
                    d += 400
                if d < bd:
                    bd, best = d, (x, y)
        if best is not None and rad >= 1:
            break
    return best


def rle(arr):
    flat = arr.ravel().tolist()
    out = []
    prev = flat[0]
    n = 1
    for v in flat[1:]:
        if v == prev:
            n += 1
        else:
            out += [prev, n]
            prev, n = v, 1
    out += [prev, n]
    return out


def build(m, feats):
    grid = Grid(m)
    w, h = grid.w, grid.h
    print(f"[{m['id']}] grid {w}x{h}, {grid.cpd:.2f} sel/derajat")
    region, rnames = rasterize(grid, feats)
    terrain = np.where(region >= 0, T_PLAIN, T_WATER).astype(np.uint8)

    # danau
    for lon, lat, rx, ry in D.LAKES:
        if rx <= 0 or ry <= 0:
            continue
        a = np.linspace(0, 2 * np.pi, 40)
        poly = [(lon + rx * np.cos(t), lat + ry * np.sin(t)) for t in a[:-1]]
        mk = mask_poly(grid, poly)
        terrain[mk] = T_WATER
        region[mk] = -1

    # pegunungan
    for name, rd, line in D.MOUNTAINS:
        lon = np.array([p[0] for p in line])
        lat = np.array([p[1] for p in line])
        cx, cy = grid.to_cells(lon, lat)
        pts = np.stack([cx, cy], 1)
        dense = []
        for i in range(len(pts) - 1):
            k = max(2, int(np.hypot(*(pts[i + 1] - pts[i])) * 3))
            for j in range(k):
                dense.append(pts[i] + (pts[i + 1] - pts[i]) * j / k)
        dense.append(pts[-1])
        rad = max(0.75, min(rd * grid.cpd * 0.5, 2.0))
        for px, py in dense:
            if not (-3 < px < w + 3 and -3 < py < h + 3):
                continue
            for y in range(int(py - rad - 1), int(py + rad + 2)):
                for x in range(int(px - rad - 1), int(px + rad + 2)):
                    if 0 <= x < w and 0 <= y < h and terrain[y, x] == T_PLAIN and (x + .5 - px) ** 2 + (y + .5 - py) ** 2 <= rad * rad:
                        terrain[y, x] = T_MOUNTAIN

    # hutan
    nz = fbm(w, h, 11 + len(m['id']), 3.2)
    for poly, dens in D.FORESTS:
        mk = mask_poly(grid, poly)
        terrain[mk & (terrain == T_PLAIN) & (nz < dens * 0.85)] = T_FOREST

    # bayangan kosmetik (gurun/tundra)
    shade = np.zeros((h, w), dtype=np.uint8)
    for poly in D.DESERTS:
        shade[mask_poly(grid, poly) & (terrain == T_PLAIN)] = 1
    for poly in D.TUNDRA:
        shade[mask_poly(grid, poly) & (terrain != T_WATER) & (terrain != T_MOUNTAIN) & (terrain != T_FOREST)] = 2

    # selat dangkal
    added = connect_straits(terrain, m['bridge'])
    print(f"  selat dangkal: {added} sel")

    # bangsa: urutan jarak terjauh
    r = m['spawn_r']
    cand = []
    for name, desc, lat, lon, trait in m['nations']:
        cx, cy = grid.to_cells(np.array([lon]), np.array([lat]))
        cx, cy = float(cx[0]), float(cy[0])
        if not (0 <= cx < w and 0 <= cy < h):
            continue
        cand.append((name, desc, trait, cx, cy))
    placed = []
    for name, desc, trait, cx, cy in cand:
        pos = nearest_valid(terrain, cx, cy, r, taken=[(p[3], p[4]) for p in placed])
        if pos is None:
            print('  ! gagal tempatkan', name)
            continue
        x, y = pos
        if (terrain[y, x] == T_FOREST):
            pass
        placed.append((name, desc, trait, x, y))
    # urutan farthest-point mulai dari bangsa pertama
    order = [0]
    while len(order) < len(placed):
        best, bd = None, -1
        for i in range(len(placed)):
            if i in order:
                continue
            d = min((placed[i][3] - placed[j][3]) ** 2 + (placed[i][4] - placed[j][4]) ** 2 for j in order)
            if d > bd:
                bd, best = d, i
        order.append(best)
    nations = [placed[i] for i in order]
    taken = [(p[3], p[4]) for p in nations]
    # ratakan medan di blob awal
    for _, _, _, x, y in nations:
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r + 1 and 0 <= y + dy < h and 0 <= x + dx < w and terrain[y + dy, x + dx] in (T_MOUNTAIN, T_FOREST):
                    terrain[y + dy, x + dx] = T_PLAIN

    # tambang
    land = int((terrain != T_WATER).sum())
    cap = max(6, land // m['mine_div'])
    cells = []
    for lat, lon in D.MINES:
        cx, cy = grid.to_cells(np.array([lon]), np.array([lat]))
        x, y = int(cx[0]), int(cy[0])
        if not (0 <= x < w and 0 <= y < h) or terrain[y, x] in (T_WATER, T_SHALLOW, T_MOUNTAIN):
            continue
        if any((x - tx) ** 2 + (y - ty) ** 2 < (r + 2) ** 2 for tx, ty in taken):
            continue
        cells.append((x, y))
    chosen = []
    if cells:
        chosen.append(cells[0])
        while len(chosen) < min(cap, len(cells)):
            best, bd = None, -1
            for c in cells:
                if c in chosen:
                    continue
                d = min((c[0] - o[0]) ** 2 + (c[1] - o[1]) ** 2 for o in chosen)
                if d > bd:
                    bd, best = d, c
            if bd < 9:
                break
            chosen.append(best)
    mines = [y * w + x for x, y in chosen]
    print(f"  darat={land} bangsa={len(nations)} tambang={len(mines)}")

    # wilayah & label
    shallow = terrain == T_SHALLOW
    region[shallow] = -1
    used = sorted({int(v) for v in np.unique(region) if v >= 0})
    remap = {old: i + 1 for i, old in enumerate(used)}
    reg_out = np.zeros((h, w), dtype=np.uint8)
    for old, new in remap.items():
        reg_out[region == old] = new
    regions = [D.ID_NAMES.get(rnames[o], rnames[o]) for o in used]
    labels = []
    for old in used:
        ys, xs = np.nonzero(region == old)
        if len(xs) < 6:
            continue
        # komponen terbesar
        sub = np.zeros((h, w), dtype=np.uint8)
        sub[ys, xs] = 1
        comp, sizes = components(sub)  # T_WATER=0 -> 0 adalah "air"
        k = int(np.argmax(sizes))
        yy, xx = np.nonzero(comp == k)
        mx, my = xx.mean(), yy.mean()
        j = int(np.argmin((xx - mx) ** 2 + (yy - my) ** 2))
        labels.append([remap[old] - 1, int(xx[j]), int(yy[j]), int(len(xs))])

    data = {
        'id': m['id'], 'label': m['label'], 'w': w, 'h': h, 'spawnR': r,
        'terrain': rle(terrain), 'region': rle(reg_out), 'shade': rle(shade),
        'regions': regions, 'labels': labels, 'mines': mines,
        'nations': [{'name': n, 'desc': d, 'trait': t, 'x': x, 'y': y} for n, d, t, x, y in nations],
    }
    return data, terrain, shade, region


def write_ts(data):
    path = os.path.join(OUT, f"{data['id']}.ts")
    var = data['id'].upper() + '_MAP'
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w', encoding='utf-8') as f:
        f.write("// DIHASILKAN oleh scripts/genmaps.py — jangan diedit manual.\n")
        f.write("// Sumber batas negara: johan/world.geo.json (domain publik).\n")
        f.write("import type { PresetData } from './index.ts';\n\n")
        f.write(f"export const {var}: PresetData = {body};\n")
    print('  ->', path, os.path.getsize(path) // 1024, 'KB')


def preview(data, terrain, shade, region, outdir):
    from PIL import Image, ImageDraw
    h, w = terrain.shape
    S = 5
    img = Image.new('RGB', (w * S, h * S))
    px = img.load()
    cols = {T_WATER: (14, 40, 58), T_PLAIN: (96, 110, 70), T_FOREST: (50, 84, 56), T_MOUNTAIN: (130, 130, 140), T_SHALLOW: (40, 90, 110)}
    for y in range(h):
        for x in range(w):
            t = terrain[y, x]
            c = cols[int(t)]
            if t == T_PLAIN and shade[y, x] == 1:
                c = (176, 150, 96)
            if t == T_PLAIN and shade[y, x] == 2:
                c = (170, 180, 180)
            for dy in range(S):
                for dx in range(S):
                    px[x * S + dx, y * S + dy] = c
    d = ImageDraw.Draw(img)
    for n in data['nations']:
        d.ellipse([n['x'] * S - 4, n['y'] * S - 4, n['x'] * S + 8, n['y'] * S + 8], fill=(255, 220, 60), outline=(0, 0, 0))
        d.text((n['x'] * S + 8, n['y'] * S - 4), n['name'], fill=(255, 255, 255))
    for c in data['mines']:
        x, y = c % w, c // w
        d.rectangle([x * S, y * S, x * S + S, y * S + S], fill=(255, 80, 200))
    os.makedirs(outdir, exist_ok=True)
    img.save(os.path.join(outdir, data['id'] + '.png'))


def main():
    prev = None
    if '--preview' in sys.argv:
        prev = sys.argv[sys.argv.index('--preview') + 1]
    only = [a for a in sys.argv[1:] if a in ('world', 'mideast', 'europe')]
    os.makedirs(OUT, exist_ok=True)
    feats = load_countries()
    for m in D.MAPS:
        if only and m['id'] not in only:
            continue
        data, terrain, shade, region = build(m, feats)
        write_ts(data)
        if prev:
            preview(data, terrain, shade, region, prev)


if __name__ == '__main__':
    main()
