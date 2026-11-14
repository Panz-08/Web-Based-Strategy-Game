import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG, Sim } from '../src/core/sim.ts';
import { BUILD_DEFS, F_CITY, F_FACTORY, F_SAM, F_SILO, TPS, T_WATER } from '../src/core/types.ts';

function mkSetup(seed, n = 2, style = 'open', w = 80, h = 52) {
  return {
    seed,
    width: w,
    height: h,
    style,
    players: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'P' + (i + 1), kind: 'human', difficulty: 'normal' })),
  };
}

/** Sel milik `id` yang kosong (belum ada bangunan) dan tersambung ke ibu kota. */
function freeLinkedCell(sim, id) {
  for (let c = 0; c < sim.n; c++) {
    if (sim.owner[c] === id && sim.linked[c] && sim.feat[c] === 0) return c;
  }
  return -1;
}

/** Cari sel P2 yang punya tetangga darat netral. */
function borderTarget(sim) {
  for (let c = 0; c < sim.n; c++) {
    if (sim.owner[c] !== 2 || sim.terrain[c] === T_WATER) continue;
    const x = c % sim.w;
    const y = Math.floor(c / sim.w);
    const nbrs = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].map(([nx, ny]) => (nx >= 0 && nx < sim.w && ny >= 0 && ny < sim.h ? ny * sim.w + nx : -1));
    const free = nbrs.find((n) => n >= 0 && sim.terrain[n] !== T_WATER && sim.owner[n] === 0 && sim.feat[n] === 0);
    if (free >= 0) return { target: c, base: free };
  }
  return null;
}

/** Pijakan P1 tepat di samping target P2 (untuk menguji silo & nuklir). */
function forwardBase(sim) {
  const spot = borderTarget(sim);
  assert.ok(spot, 'ada perbatasan darat antara P1/P2 yang bisa dipakai');
  const p1 = sim.players[1];
  if (sim.owner[spot.base] !== 1) {
    sim.owner[spot.base] = 1;
    p1.cells++;
  }
  sim.step([]);
  return spot;
}

/** Letakkan silo siap pakai milik P1 dan nyatakan perang pada P2. */
function readySiloAt(sim, idx, target) {
  sim.buildings.push({ idx, owner: 1, kind: 'silo', readyAt: 0 });
  sim.feat[idx] = F_SILO;
  sim.players[1].gold = 2000;
  sim.step([{ t: 'war', p: 1, target: 2 }]);
  assert.equal(sim.nukeError(sim.players[1], target), '', 'target harus bisa dibom');
}

/** Tambah wilayah cadangan jauh dari titik ledakan agar korban tidak langsung punah. */
function boostRemote(sim, id, target, count) {
  const tx = target % sim.w;
  const ty = Math.floor(target / sim.w);
  let added = 0;
  for (let c = 0; c < sim.n && added < count; c++) {
    if (sim.owner[c] !== 0 || sim.terrain[c] === T_WATER) continue;
    if (Math.hypot((c % sim.w) - tx, Math.floor(c / sim.w) - ty) < 12) continue;
    sim.owner[c] = id;
    added++;
  }
  sim.players[id].cells += added;
  assert.ok(added > 20, 'ada cukup lahan cadangan');
}

function stepN(sim, ticks, cmds = []) {
  for (let i = 0; i < ticks; i++) sim.step(cmds);
}

test('bangunan: beli kota, selesai, menambah batas pasukan & emas', () => {
  const sim = new Sim(mkSetup(21));
  const p = sim.players[1];
  p.gold = 1000;
  const cell = freeLinkedCell(sim, 1);
  assert.ok(cell >= 0, 'ada sel kosong milik pemain');

  const before = p.gold;
  const capBefore = p.cap;
  const cost = sim.buildCost(p, 'city');
  sim.step([{ t: 'build', p: 1, idx: cell, kind: 'city' }]);

  assert.equal(sim.feat[cell], F_CITY, 'sel menjadi kota');
  assert.equal(sim.buildings.length, 1, 'bangunan tercatat');
  assert.equal(sim.buildings[0].kind, 'city');
  assert.ok(p.gold < before, 'emas berkurang');
  assert.ok(before - p.gold <= cost + 2, 'harga sesuai (plus pemasukan 1 tick)');
  assert.notEqual(sim.buildError(p, cell, 'city'), '', 'sel yang sama tidak bisa dipakai dua kali');

  stepN(sim, BUILD_DEFS.city.ticks + TPS);
  assert.equal(p.cities, 1, 'kota selesai dihitung');
  assert.ok(p.cap >= capBefore + CFG.cityCap * 0.9, 'kota menambah batas pasukan');
});

test('pabrik menambah pemasukan emas per detik', () => {
  const sim = new Sim(mkSetup(22));
  const p = sim.players[1];
  p.gold = 1000;
  const incBefore = p.goldIncome;
  const cell = freeLinkedCell(sim, 1);
  assert.ok(cell >= 0);
  sim.step([{ t: 'build', p: 1, idx: cell, kind: 'factory' }]);
  stepN(sim, BUILD_DEFS.factory.ticks + TPS);
  assert.equal(p.factories, 1);
  assert.ok(p.goldIncome > incBefore + 0.9, 'pabrik menambah emas/dtk');
});

test('nuklir: silo, biaya, kehancuran wilayah, dan radiasi yang mereda', () => {
  const sim = new Sim(mkSetup(23));
  const spot = forwardBase(sim);
  boostRemote(sim, 2, spot.target, 80);
  readySiloAt(sim, spot.base, spot.target);
  const p = sim.players[1];
  const def = sim.players[2];
  const goldBefore = p.gold;
  const cellsBefore = def.cells;

  sim.step([{ t: 'nuke', p: 1, idx: spot.target }]);
  assert.equal(sim.nukes.length, 1, 'rudal meluncur');
  assert.ok(goldBefore - p.gold <= CFG.nukeCost + 2, 'biaya nuklir terbayar');
  assert.equal(sim.nukes[0].from, spot.base, 'rudal berasal dari silo');

  stepN(sim, CFG.nukeFlight + 2);
  assert.equal(sim.nukes.length, 0, 'rudal mendarat');
  assert.notEqual(sim.owner[spot.target], 2, 'target bukan lagi milik korban');
  assert.ok(def.cells < cellsBefore, 'wilayah korban berkurang');
  assert.ok(sim.fallout[spot.target] > 0, 'radiasi tertinggal');
  assert.equal(sim.nukeError(p, spot.target), 'Target sudah terkena radiasi');

  const rad = sim.fallout[spot.target];
  stepN(sim, TPS);
  assert.ok(sim.fallout[spot.target] < rad, 'radiasi mereda tiap detik');
});

test('radiasi hilang setelah durasi penuh', () => {
  const sim = new Sim(mkSetup(28));
  const cell = 0;
  sim.fallout[cell] = CFG.falloutDur;
  stepN(sim, (CFG.falloutDur - 1) * TPS);
  assert.ok(sim.fallout[cell] > 0, 'masih ada radiasi sebelum waktunya');
  stepN(sim, 2 * TPS);
  assert.equal(sim.fallout[cell], 0, 'radiasi hilang setelah durasi');
});

test('SAM menembak jatuh nuklir dalam radius', () => {
  const sim = new Sim(mkSetup(24));
  const spot = forwardBase(sim);
  // SAM milik P2 tepat di sel target.
  sim.buildings.push({ idx: spot.target, owner: 2, kind: 'sam', readyAt: 0 });
  sim.feat[spot.target] = F_SAM;
  readySiloAt(sim, spot.base, spot.target);
  const def = sim.players[2];
  const goldBefore = sim.players[1].gold;

  sim.step([{ t: 'nuke', p: 1, idx: spot.target }]);
  assert.ok(sim.players[1].gold < goldBefore, 'biaya nuklir terbayar saat peluncuran');
  stepN(sim, CFG.nukeFlight + 2);

  assert.equal(sim.nukes.length, 0);
  assert.equal(sim.owner[spot.target], 2, 'wilayah terlindungi');
  assert.equal(sim.fallout[spot.target], 0, 'tidak ada radiasi');
  assert.equal(def.nukesLost, 0, 'korban tidak kehilangan rudal');
  assert.equal(sim.players[1].nukesLost, 1, 'penyerang mencatat intersepsi');
});

test('bangunan bisa direbut saat sel jatuh ke tangan musuh', () => {
  const sim = new Sim(mkSetup(25));
  const spot = borderTarget(sim);
  assert.ok(spot);
  const city = spot.target;
  sim.buildings.push({ idx: city, owner: 2, kind: 'city', readyAt: 0 });
  sim.feat[city] = F_CITY;

  // Beri P1 pijakan di sebelah kota, lalu paksa perang.
  sim.owner[spot.base] = 1;
  sim.players[1].cells++;
  sim.players[1].linkedCells++;
  sim.players[1].troops = 9000;
  sim.step([{ t: 'war', p: 1, target: 2 }]);

  for (let i = 0; i < 40 && sim.owner[city] !== 1; i++) {
    sim.step([{ t: 'atk', p: 1, idx: city, pct: 60, wide: true }]);
  }
  assert.equal(sim.owner[city], 1, 'kota direbut');
  const b = sim.buildings.find((x) => x.idx === city);
  assert.ok(b, 'kota tetap ada setelah direbut');
  assert.equal(b.owner, 1, 'kepemilikan bangunan berpindah');
});

test('serialisasi di tengah pembangunan tetap deterministik', () => {
  const sim = new Sim(mkSetup(26));
  const cell = freeLinkedCell(sim, 1);
  assert.ok(cell >= 0);
  sim.players[1].gold = 2000;
  sim.step([{ t: 'build', p: 1, idx: cell, kind: 'sam' }]);
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = new Sim(mkSetup(26));
  b.restore(snap);
  assert.equal(sim.checksum(), b.checksum(), 'snapshot sama setelah restore');
  assert.equal(b.buildings.length, 1);

  stepN(sim, BUILD_DEFS.sam.ticks + TPS);
  stepN(b, BUILD_DEFS.sam.ticks + TPS);
  assert.equal(sim.checksum(), b.checksum(), 'lanjutan identik');
  assert.equal(sim.players[1].sams, 1);
});

test('hadiah emas antar negara (gift) dan larangannya saat perang', () => {
  const sim = new Sim(mkSetup(29));
  const a = sim.players[1];
  const b = sim.players[2];
  a.gold = 300;
  b.gold = 100;
  sim.drainEvents();
  sim.step([{ t: 'gift', p: 1, target: 2, amount: 50 }]);
  const ev = sim.drainEvents().filter((e) => e.k === 'gift');
  assert.equal(ev.length, 1, 'event hadiah tercatat');
  assert.equal(ev[0].amount, 50);
  assert.ok(Math.abs(b.gold - 100 - 50) < 2, 'emas diterima');
  assert.ok(a.gold < 300, 'emas pengirim berkurang');

  sim.step([{ t: 'war', p: 1, target: 2 }]);
  sim.drainEvents();
  const bg = b.gold;
  sim.step([{ t: 'gift', p: 1, target: 2, amount: 50 }]);
  assert.equal(sim.drainEvents().filter((e) => e.k === 'gift').length, 0, 'tidak bisa berhadiah saat perang');
  assert.ok(Math.abs(b.gold - bg) < 2, 'emas korban tidak bertambah');
});

test('serialisasi di tengah penerbangan nuklir tetap identik', () => {
  const sim = new Sim(mkSetup(27));
  const spot = forwardBase(sim);
  readySiloAt(sim, spot.base, spot.target);
  sim.step([{ t: 'nuke', p: 1, idx: spot.target }]);
  stepN(sim, 10);
  assert.equal(sim.nukes.length, 1);

  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const b = new Sim(mkSetup(27));
  b.restore(snap);
  assert.equal(sim.checksum(), b.checksum());
  assert.equal(b.nukes.length, 1);
  assert.deepEqual([...b.fallout], [...sim.fallout]);

  stepN(sim, CFG.nukeFlight + 4);
  stepN(b, CFG.nukeFlight + 4);
  assert.equal(sim.checksum(), b.checksum(), 'ledakan & radiasi deterministik');
});
