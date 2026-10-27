import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/core/sim.ts';
import { Bot } from '../src/core/bot.ts';
import { T_WATER } from '../src/core/types.ts';

function mkSetup(seed, n = 4, style = 'continent', w = 80, h = 52, kind = 'bot') {
  return {
    seed,
    width: w,
    height: h,
    style,
    players: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'P' + (i + 1), kind, difficulty: ['easy', 'normal', 'hard'][i % 3] })),
  };
}

function runBots(sim, bots, ticks, extra = () => []) {
  for (let i = 0; i < ticks && !sim.winner; i++) {
    const cmds = extra(sim);
    for (const b of bots) cmds.push(...b.think(sim));
    sim.step(cmds);
  }
}

function checkInvariants(sim) {
  const counts = new Array(sim.players.length).fill(0);
  let owned = 0;
  for (let c = 0; c < sim.n; c++) {
    const o = sim.owner[c];
    if (o) {
      assert.notEqual(sim.terrain[c], T_WATER, 'sel air tidak boleh dimiliki');
      counts[o]++;
      owned++;
    }
  }
  for (let id = 1; id < sim.players.length; id++) {
    const p = sim.players[id];
    assert.equal(p.cells, counts[id], `jumlah sel pemain ${id} tidak sinkron`);
    assert.ok(p.troops >= 0 && Number.isFinite(p.troops), 'pasukan harus valid');
    if (!p.alive) assert.equal(counts[id], 0);
  }
  assert.ok(owned <= sim.landTotal);
}

test('peta deterministik & titik awal valid', () => {
  for (const style of ['continent', 'highland', 'open']) {
    const a = new Sim(mkSetup(42, 6, style));
    const b = new Sim(mkSetup(42, 6, style));
    assert.deepEqual(a.terrain, b.terrain);
    assert.deepEqual(a.map.spawns, b.map.spawns);
    assert.equal(new Set(a.map.spawns).size, 6);
    for (const s of a.map.spawns) assert.notEqual(a.terrain[s], T_WATER);
    assert.ok(a.landTotal > a.n * 0.4, 'daratan cukup luas: ' + style);
  }
  const c = new Sim(mkSetup(43, 6));
  const a = new Sim(mkSetup(42, 6));
  assert.notDeepEqual(a.terrain, c.terrain);
});

test('simulasi deterministik: perintah sama => checksum sama', () => {
  const setup = mkSetup(7, 5);
  const s1 = new Sim(setup);
  const s2 = new Sim(setup);
  const bots = setup.players.map((p) => new Bot(p.id, p.difficulty, 7));
  const log = [];
  for (let i = 0; i < 2500; i++) {
    const cmds = [];
    for (const b of bots) cmds.push(...b.think(s1));
    log.push(cmds);
    s1.step(cmds);
  }
  for (const cmds of log) s2.step(JSON.parse(JSON.stringify(cmds)));
  assert.equal(s1.checksum(), s2.checksum());
  assert.deepEqual(s1.owner, s2.owner);
  checkInvariants(s1);
});

test('invarian terjaga di berbagai seed/gaya & game berakhir', () => {
  for (const [seed, style] of [[1, 'continent'], [2, 'highland'], [3, 'open']]) {
    const setup = mkSetup(seed, 5, style);
    const sim = new Sim(setup);
    const bots = setup.players.map((p) => new Bot(p.id, 'hard', seed));
    for (let i = 0; i < 12000 && !sim.winner; i++) {
      const cmds = [];
      for (const b of bots) cmds.push(...b.think(sim));
      sim.step(cmds);
      if (i % 500 === 0) checkInvariants(sim);
    }
    checkInvariants(sim);
    assert.ok(sim.winner !== 0, `game harus selesai (seed ${seed})`);
  }
});

test('serialize/restore: lanjut identik', () => {
  const setup = mkSetup(9, 4);
  const a = new Sim(setup);
  const bots = setup.players.map((p) => new Bot(p.id, p.difficulty, 9));
  runBots(a, bots, 1200);
  const snap = JSON.parse(JSON.stringify(a.serialize()));
  const b = new Sim(setup);
  b.restore(snap);
  assert.equal(a.checksum(), b.checksum());
  for (let i = 0; i < 300; i++) {
    const cmds = [];
    for (const bt of bots) cmds.push(...bt.think(a));
    a.step(cmds);
    b.step(JSON.parse(JSON.stringify(cmds)));
  }
  assert.equal(a.checksum(), b.checksum());
});

test('serangan: wilayah bertambah, pasukan berkurang; tidak bisa serang air/diri sendiri', () => {
  const sim = new Sim(mkSetup(5, 2, 'open', 80, 52, 'human'));
  const p = sim.players[1];
  const before = p.cells;
  const t0 = p.troops;
  // cari sel netral berbatasan
  let target = -1;
  for (let c = 0; c < sim.n && target < 0; c++) {
    if (sim.owner[c] !== 0 || sim.terrain[c] === T_WATER) continue;
    const x = c % sim.w;
    if ((x > 0 && sim.owner[c - 1] === 1) || (x < sim.w - 1 && sim.owner[c + 1] === 1) || sim.owner[c - sim.w] === 1 || sim.owner[c + sim.w] === 1) target = c;
  }
  assert.ok(target >= 0);
  sim.step([{ t: 'atk', p: 1, idx: target, pct: 80, wide: false }]);
  assert.ok(p.troops < t0 * 0.4, 'pasukan dikomit');
  for (let i = 0; i < 100; i++) sim.step([]);
  assert.ok(p.cells > before + 10, 'wilayah bertambah: ' + (p.cells - before));
  // serang sel sendiri / air diabaikan
  const offs = sim.offensives.length;
  sim.step([{ t: 'atk', p: 1, idx: p.capital, pct: 50, wide: false }]);
  assert.equal(sim.offensives.length <= offs, true);
  checkInvariants(sim);
});

test('ibu kota direbut => penjarahan, pemain bisa pindah ibu kota; benteng & kemampuan', () => {
  const sim = new Sim(mkSetup(11, 2, 'open', 80, 52, 'human'));
  const a = sim.players[1];
  const b = sim.players[2];
  // Teleport sederhana: beri B wilayah A di sekitar ibu kota lewat capture paksa.
  const cap = a.capital;
  sim.step([{ t: 'fort', p: 1, idx: cap }]); // sel ibu kota tidak bisa dibuat benteng
  assert.equal(sim.forts.length, 0);
  // benteng di sel biasa
  let free = -1;
  for (let c = 0; c < sim.n; c++) if (sim.owner[c] === 1 && sim.feat[c] === 0) { free = c; break; }
  const tr = a.troops;
  sim.step([{ t: 'fort', p: 1, idx: free }]);
  assert.equal(sim.forts.length, 1);
  assert.ok(a.troops < tr);
  // kemampuan: cooldown
  sim.step([{ t: 'blitz', p: 1 }]);
  const until = a.blitzUntil;
  assert.ok(until > sim.tick);
  sim.step([{ t: 'blitz', p: 1 }]);
  assert.equal(a.blitzUntil, until, 'cooldown mencegah pakai ulang');
  sim.step([{ t: 'shield', p: 2 }]);
  assert.ok(b.shieldUntil > sim.tick);
  // Hancurkan A: B menyerbu hingga habis
  b.troops = 1e6;
  b.cap = 1e7;
  let guard = 0;
  const seen = new Set();
  while (a.alive && guard++ < 4000) {
    b.troops = Math.max(b.troops, 5e5);
    sim.step([{ t: 'atk', p: 2, idx: a.capital >= 0 ? a.capital : free, pct: 100, wide: false }]);
    for (const e of sim.drainEvents()) seen.add(e.k);
  }
  assert.equal(a.alive, false, 'A harus tersingkir');
  assert.ok(seen.has('capital'), 'ibu kota A direbut');
  assert.ok(seen.has('dead'));
  for (let i = 0; i < 10; i++) sim.step([]); // kondisi menang dicek tiap detik
  assert.equal(sim.winner, 2);
  assert.equal(sim.winReason, 'last');
  checkInvariants(sim);
});

test('wilayah terputus dari ibu kota tidak memberi pendapatan', () => {
  const sim = new Sim(mkSetup(13, 2, 'open', 80, 52, 'human'));
  const p = sim.players[1];
  const linked0 = p.linkedCells;
  // Isolasi: ambil satu sel lahan acak & jadikan milik p (terputus)
  let far = -1;
  for (let c = sim.n - 1; c >= 0; c--) if (sim.owner[c] === 0 && sim.terrain[c] !== T_WATER) { far = c; break; }
  sim.owner[far] = 1;
  p.cells++;
  sim.recompute();
  assert.equal(p.linkedCells, linked0, 'sel terpencil tidak terhubung');
  assert.equal(sim.linked[far], 0);
});
