import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, CFG } from '../src/core/sim.ts';
import { Bot } from '../src/core/bot.ts';
import { T_WATER, F_MINE } from '../src/core/types.ts';

function mk(kinds, { seed = 5, style = 'open', w = 80, h = 52 } = {}) {
  return new Sim({
    seed,
    width: w,
    height: h,
    style,
    players: kinds.map((kind, i) => ({ id: i + 1, name: 'P' + (i + 1), kind, difficulty: 'normal' })),
  });
}
const humans = (n) => mk(Array(n).fill('human'));
const steps = (sim, n, cmds = []) => {
  for (let i = 0; i < n; i++) sim.step(i === 0 ? cmds : []);
};
const nbrs = (sim, c) => {
  const x = c % sim.w;
  const out = [];
  if (x > 0) out.push(c - 1);
  if (x < sim.w - 1) out.push(c + 1);
  if (c >= sim.w) out.push(c - sim.w);
  if (c < sim.n - sim.w) out.push(c + sim.w);
  return out;
};
const land = (sim, c) => sim.terrain[c] !== T_WATER;

/** Beri `to` satu sel netral yang berbatasan dengan wilayah `from`. */
function giveBorderCell(sim, from, to) {
  for (let c = 0; c < sim.n; c++) {
    if (sim.owner[c] !== 0 || !land(sim, c)) continue;
    if (nbrs(sim, c).some((n) => sim.owner[n] === from)) {
      sim.owner[c] = to;
      sim.players[to].cells++;
      sim.recompute();
      return c;
    }
  }
  throw new Error('tidak ada sel perbatasan');
}

/** Perluas wilayah `id` secara utuh (tetap tersambung ibu kota) sampai `count` sel. */
function grow(sim, id, count) {
  const p = sim.players[id];
  const q = [p.capital];
  const seen = new Set(q);
  while (q.length && p.cells < count) {
    const c = q.shift();
    for (const n of nbrs(sim, c)) {
      if (seen.has(n) || !land(sim, n) || (sim.owner[n] !== 0 && sim.owner[n] !== id)) continue;
      seen.add(n);
      if (sim.owner[n] === 0) {
        sim.owner[n] = id;
        p.cells++;
        if (sim.feat[n] === F_MINE) p.mines++;
      }
      q.push(n);
    }
  }
  sim.recompute();
}

/** Blok sel netral berurutan sebanyak `count` yang jauh dari wilayah mana pun, diberikan ke `id` (terputus). */
function island(sim, id, count) {
  const p = sim.players[id];
  let start = -1;
  let best = -1;
  for (let c = 0; c < sim.n; c++) {
    if (sim.owner[c] !== 0 || !land(sim, c)) continue;
    let d = Infinity;
    for (let o = 0; o < sim.n; o += 7) if (sim.owner[o] !== 0) d = Math.min(d, Math.abs((o % sim.w) - (c % sim.w)) + Math.abs(Math.floor(o / sim.w) - Math.floor(c / sim.w)));
    if (d > best) (best = d), (start = c);
  }
  const cells = [start];
  const seen = new Set(cells);
  for (let i = 0; i < cells.length && cells.length < count; i++)
    for (const n of nbrs(sim, cells[i])) if (!seen.has(n) && land(sim, n) && sim.owner[n] === 0 && cells.length < count) (seen.add(n), cells.push(n));
  assert.equal(cells.length, count, 'pulau cukup besar');
  for (const c of cells) {
    sim.owner[c] = id;
    p.cells++;
  }
  sim.recompute();
  return cells;
}

function counts(sim) {
  const n = new Array(sim.players.length).fill(0);
  for (let c = 0; c < sim.n; c++) if (sim.owner[c]) n[sim.owner[c]]++;
  for (let id = 1; id < sim.players.length; id++) assert.equal(sim.players[id].cells, n[id], `sel pemain ${id}`);
}

const offerAccept = (sim, from, to, kind, accept = true) => {
  sim.step([{ t: 'offer', p: from, target: to, kind }]);
  const o = sim.offers.find((x) => x.from === from && x.to === to && x.kind === kind);
  assert.ok(o, 'tawaran terkirim');
  sim.step([{ t: 'reply', p: to, id: o.id, accept }]);
};

test('menyerang negara lain wajib menyatakan perang dulu', () => {
  const sim = humans(2);
  const c = giveBorderCell(sim, 1, 2);
  sim.step([{ t: 'atk', p: 1, idx: c, pct: 80, wide: false }]);
  assert.equal(sim.offensives.length, 0, 'tanpa perang tidak ada serangan');
  assert.ok(sim.drainEvents().some((e) => e.k === 'toast' && e.msg.includes('perang')));
  sim.step([{ t: 'war', p: 1, target: 2 }]);
  assert.ok(sim.drainEvents().some((e) => e.k === 'war' && e.by === 1 && e.target === 2));
  sim.step([{ t: 'atk', p: 1, idx: c, pct: 80, wide: false }]);
  assert.equal(sim.offensives.length, 1);
  counts(sim);
});

test('damai: serangan berhenti, gencatan senjata mencegah perang, lalu kedaluwarsa', () => {
  const sim = humans(2);
  const c = giveBorderCell(sim, 1, 2);
  sim.step([{ t: 'war', p: 1, target: 2 }]);
  sim.step([{ t: 'atk', p: 1, idx: c, pct: 50, wide: false }]);
  const before = sim.players[1].troops;
  offerAccept(sim, 2, 1, 'peace');
  assert.equal(sim.relKind(1, 2), 'truce');
  assert.equal(sim.offensives.length, 0);
  assert.ok(sim.players[1].troops > before * 0.9, 'pasukan kembali ke kas');
  assert.match(sim.canDeclareWar(1, 2), /Gencatan/);
  sim.step([{ t: 'war', p: 1, target: 2 }]);
  assert.equal(sim.relKind(1, 2), 'truce');
  steps(sim, CFG.truceDur + 20);
  assert.equal(sim.relKind(1, 2), 'peace');
  assert.equal(sim.canDeclareWar(1, 2), '');
});

test('tawaran ditolak diblokir sementara; tawaran kedaluwarsa', () => {
  const sim = humans(2);
  offerAccept(sim, 1, 2, 'nap', false);
  assert.ok(sim.offerError(1, 2, 'nap').includes('ditolak'));
  steps(sim, CFG.offerBlock + 20);
  assert.equal(sim.offerError(1, 2, 'nap'), '');
  sim.step([{ t: 'offer', p: 1, target: 2, kind: 'alliance' }]);
  assert.equal(sim.offers.length, 1);
  steps(sim, CFG.offerTtl + 20);
  assert.equal(sim.offers.length, 0);
});

test('pakta non agresi mengikat; bisa diakhiri dengan masa pemberitahuan', () => {
  const sim = humans(2);
  offerAccept(sim, 1, 2, 'nap');
  assert.equal(sim.relKind(1, 2), 'nap');
  sim.step([{ t: 'war', p: 1, target: 2 }]);
  assert.equal(sim.relKind(1, 2), 'nap', 'tidak bisa perang selama pakta');
  sim.step([{ t: 'break', p: 1, target: 2 }]);
  steps(sim, CFG.napNotice + 20);
  assert.equal(sim.relKind(1, 2), 'peace');
  steps(sim, 1, [{ t: 'war', p: 1, target: 2 }]);
  assert.equal(sim.relKind(1, 2), 'war');
});

test('aliansi: sekutu ikut membela & tidak bisa saling perang; negara boneka ikut tuannya', () => {
  const sim = humans(4);
  offerAccept(sim, 1, 2, 'alliance');
  assert.equal(sim.relKind(1, 2), 'alliance');
  sim.step([{ t: 'war', p: 1, target: 2 }]);
  assert.equal(sim.relKind(1, 2), 'alliance');
  sim.step([{ t: 'war', p: 3, target: 2 }]); // sekutu 2 (yaitu 1) ikut berperang melawan 3
  assert.equal(sim.relKind(3, 2), 'war');
  assert.equal(sim.relKind(1, 3), 'war');
  // 4 menjadi boneka 3 -> otomatis ikut perang 3
  offerAccept(sim, 3, 4, 'vassal');
  assert.equal(sim.players[4].lord, 3);
  assert.equal(sim.relKind(4, 2), 'war');
  assert.equal(sim.relKind(4, 1), 'war');
  sim.step([{ t: 'break', p: 1, target: 2 }]);
  assert.equal(sim.relKind(1, 2), 'truce');
});

test('negara boneka: upeti, tak bisa berdiplomasi/perang sendiri, bisa dilepas atau merdeka', () => {
  const run = (vassal) => {
    const sim = humans(3);
    if (vassal) offerAccept(sim, 1, 2, 'vassal');
    else sim.step([]);
    steps(sim, 200);
    return sim;
  };
  const a = run(false);
  const b = run(true);
  assert.equal(b.players[2].lord, 1);
  assert.ok(b.players[2].troops < a.players[2].troops, 'boneka membayar upeti');
  assert.ok(b.players[1].troops > a.players[1].troops, 'tuan menerima upeti');
  b.step([{ t: 'war', p: 2, target: 3 }]);
  assert.equal(b.relKind(2, 3), 'peace', 'boneka tak boleh menyatakan perang sendiri');
  b.step([{ t: 'offer', p: 2, target: 3, kind: 'nap' }]);
  assert.equal(b.offers.length, 0);
  b.step([{ t: 'offer', p: 3, target: 2, kind: 'nap' }]);
  assert.equal(b.offers.length, 0, 'tak bisa menawari boneka orang lain');
  // Tuan perang -> boneka ikut
  b.step([{ t: 'war', p: 1, target: 3 }]);
  assert.equal(b.relKind(2, 3), 'war');
  // Tuan tidak boleh langsung perang pada bonekanya
  assert.match(b.canDeclareWar(1, 2), /Lepaskan/);
  // Merdeka: perang melawan tuan
  const c = run(true);
  c.step([{ t: 'war', p: 2, target: 1 }]);
  assert.equal(c.players[2].lord, 0);
  assert.equal(c.relKind(2, 1), 'war');
  // Dilepas
  const d = run(true);
  d.step([{ t: 'break', p: 1, target: 2 }]);
  assert.equal(d.players[2].lord, 0);
  assert.equal(d.relKind(1, 2), 'truce');
});

test('menyerah: penyerah menjadi boneka penakluk dan perang berakhir', () => {
  const sim = humans(3);
  const c = giveBorderCell(sim, 1, 2);
  sim.step([{ t: 'war', p: 1, target: 2 }]);
  sim.step([{ t: 'atk', p: 1, idx: c, pct: 60, wide: false }]);
  sim.step([{ t: 'surrender', p: 1, target: 3 }]); // tidak sedang berperang dengan 3
  assert.equal(sim.players[1].lord, 0);
  sim.step([{ t: 'surrender', p: 1, target: 2 }]);
  assert.equal(sim.players[1].lord, 2);
  assert.equal(sim.relKind(1, 2), 'vassal');
  assert.equal(sim.offensives.length, 0);
});

test('moral turun saat wilayah direbut; ibu kota jatuh melumpuhkan', () => {
  const sim = humans(2);
  const a = sim.players[1];
  const b = sim.players[2];
  b.troops = 1e6;
  b.cap = 1e7;
  sim.step([{ t: 'war', p: 2, target: 1 }]);
  let sawCapital = false;
  let minBefore = 1;
  for (let i = 0; i < 4000 && a.alive; i++) {
    b.troops = Math.max(b.troops, 5e5);
    sim.step([{ t: 'atk', p: 2, idx: a.capital >= 0 ? a.capital : sim.players[1].capital, pct: 100, wide: false }]);
    for (const e of sim.drainEvents()) {
      if (e.k === 'capital') {
        sawCapital = true;
        assert.ok(a.morale <= CFG.moraleCapital + 1e-9, 'moral anjlok');
        assert.ok(a.shakenUntil >= sim.tick + CFG.shakenDur - 1, 'pendapatan lumpuh');
      }
    }
    if (!sawCapital) minBefore = Math.min(minBefore, a.morale);
    if (sawCapital) break;
  }
  assert.ok(sawCapital);
  assert.ok(minBefore < 1, 'moral turun bertahap sebelum ibu kota jatuh');
  assert.ok(a.morale >= CFG.moraleMin);
  // Moral rendah -> wilayah lebih murah direbut
  const cell = [...Array(sim.n).keys()].find((c) => sim.owner[c] === 1);
  if (cell !== undefined) {
    const low = sim.cellCost(b, cell);
    a.morale = 1;
    assert.ok(low < sim.cellCost(b, cell), 'moral rendah = lebih murah');
  }
});

test('moral pulih bila tenang', () => {
  const sim = humans(2);
  const a = sim.players[1];
  a.morale = 0.4;
  a.lossAt = 0;
  steps(sim, 400);
  assert.ok(a.morale > 0.8, 'moral pulih: ' + a.morale);
});

test('wilayah terputus besar memberontak jadi negara baru (berperang dengan induk)', () => {
  const sim = humans(2);
  const cells = island(sim, 1, 16);
  const p1 = sim.players[1];
  assert.ok(cells.every((c) => !sim.linked[c]));
  let n = sim.players.length;
  for (let i = 0; i < 6000 && sim.players.length === n; i++) sim.step([]);
  assert.equal(sim.players.length, n + 1, 'negara baru lahir');
  const reb = sim.players[n];
  assert.equal(reb.kind, 'bot');
  assert.ok(reb.alive && reb.cells >= 16 && reb.capital >= 0);
  assert.equal(sim.relKind(1, reb.id), 'war');
  assert.ok(cells.every((c) => sim.owner[c] === reb.id));
  assert.ok(p1.morale < 1);
  assert.ok(sim.rebels === 1);
  counts(sim);
  assert.ok(sim.drainEvents().some((e) => e.k === 'revolt' && e.parent === 1 && e.rebel === reb.id));
});

test('wilayah terputus kecil akhirnya ditinggalkan jadi netral', () => {
  const sim = humans(2);
  const cells = island(sim, 1, 5);
  for (let i = 0; i < 800; i++) sim.step([]);
  assert.ok(cells.every((c) => sim.owner[c] === 0), 'dilepas');
  assert.equal(sim.players.length, 3, 'tidak ada negara baru');
  counts(sim);
});

test('wilayah terputus lebih murah dianeksasi', () => {
  const sim = humans(2);
  const cells = island(sim, 1, 4);
  const linkedCell = [...Array(sim.n).keys()].find((c) => sim.owner[c] === 1 && sim.linked[c]);
  assert.ok(sim.cellCost(sim.players[2], cells[0]) < sim.cellCost(sim.players[2], linkedCell) * 0.6);
});

// ---------------------------------------------------------------- voting kemenangan
function nearWin(kinds, leader = 1) {
  const sim = mk(kinds);
  grow(sim, leader, Math.ceil(sim.landTotal * 0.62));
  return sim;
}
const untilVote = (sim) => {
  for (let i = 0; i < 40 && !sim.vote && !sim.winner; i++) sim.step([]);
};

test('voting: pemimpin & mayoritas manusia lain setuju -> permainan berakhir', () => {
  const sim = nearWin(['human', 'human', 'bot']);
  untilVote(sim);
  assert.ok(sim.vote && sim.vote.leader === 1, 'voting terbuka, bukan menang otomatis');
  assert.equal(sim.winner, 0);
  sim.step([{ t: 'vote', p: 1, end: true }]);
  assert.ok(sim.vote, 'menunggu pemain lain');
  sim.step([{ t: 'vote', p: 2, end: true }]);
  assert.equal(sim.winner, 1);
  assert.equal(sim.winReason, 'dominance');
  assert.equal(sim.vote, null);
});

test('voting: satu pemain lain memilih lanjut -> permainan dilanjutkan, voting ulang ditunda', () => {
  const sim = nearWin(['human', 'human', 'bot']);
  untilVote(sim);
  sim.step([{ t: 'vote', p: 1, end: true }, { t: 'vote', p: 2, end: false }]);
  assert.equal(sim.winner, 0);
  assert.equal(sim.vote, null);
  assert.ok(sim.drainEvents().some((e) => e.k === 'vote-end' && e.result === 'continue'));
  steps(sim, 300);
  assert.equal(sim.vote, null, 'cooldown');
  steps(sim, CFG.voteCooldown - 300 + 30);
  assert.ok(sim.vote, 'voting dibuka lagi bila masih >60%');
});

test('voting: pemimpin memilih lanjut -> langsung dilanjutkan', () => {
  const sim = nearWin(['human', 'human', 'bot']);
  untilVote(sim);
  sim.step([{ t: 'vote', p: 2, end: true }, { t: 'vote', p: 1, end: false }]);
  assert.equal(sim.winner, 0);
  assert.equal(sim.vote, null);
});

test('voting: tidak memilih sampai habis waktu dianggap lanjut', () => {
  const sim = nearWin(['human', 'human', 'bot']);
  untilVote(sim);
  sim.step([{ t: 'vote', p: 1, end: true }]);
  steps(sim, CFG.voteTime + 30);
  assert.equal(sim.winner, 0);
  assert.equal(sim.vote, null);
});

test('voting: hanya satu manusia (lawan bot) -> dia sendiri yang memutuskan menang atau lanjut', () => {
  const win = nearWin(['human', 'bot', 'bot']);
  untilVote(win);
  assert.ok(win.vote && win.vote.leader === 1);
  win.step([{ t: 'vote', p: 1, end: true }]);
  assert.equal(win.winner, 1);

  const go = nearWin(['human', 'bot', 'bot']);
  untilVote(go);
  go.step([{ t: 'vote', p: 1, end: false }]);
  assert.equal(go.winner, 0);
  assert.equal(go.vote, null);
});

test('voting: bot yang mencapai 60% -> pemain manusia memilih menyerah atau lanjut', () => {
  const sim = nearWin(['human', 'bot', 'bot'], 3);
  untilVote(sim);
  assert.ok(sim.vote && sim.vote.leader === 3);
  sim.step([{ t: 'vote', p: 3, end: true }]); // bot tidak punya suara
  assert.ok(sim.vote, 'suara bot diabaikan');
  sim.step([{ t: 'vote', p: 1, end: true }]);
  assert.equal(sim.winner, 3);

  const cont = nearWin(['human', 'bot', 'bot'], 3);
  untilVote(cont);
  cont.step([{ t: 'vote', p: 1, end: false }]);
  assert.equal(cont.winner, 0);
});

test('voting: tanpa manusia (bot vs bot) tetap menang otomatis tanpa voting', () => {
  const sim = nearWin(['bot', 'bot', 'bot']);
  for (let i = 0; i < CFG.domHold + 40 && !sim.winner; i++) {
    sim.step([]);
    assert.equal(sim.vote, null);
  }
  assert.equal(sim.winner, 1);
  assert.equal(sim.winReason, 'dominance');
});

test('voting dibatalkan bila pemimpin turun di bawah 60%; negara boneka dihitung ke tuannya', () => {
  const sim = nearWin(['human', 'bot', 'bot']);
  untilVote(sim);
  assert.ok(sim.vote);
  for (let c = 0; c < sim.n; c++) if (sim.owner[c] === 1 && c !== sim.players[1].capital && c % 3 === 0) { sim.owner[c] = 0; sim.players[1].cells--; }
  for (let c = 0; c < sim.n && sim.share(sim.players[1]) > 0.55; c++) if (sim.owner[c] === 1 && c !== sim.players[1].capital) { sim.owner[c] = 0; sim.players[1].cells--; }
  sim.recompute();
  steps(sim, 12);
  assert.equal(sim.vote, null);
  assert.equal(sim.winner, 0);
  // boneka menambah total blok tuan
  const sim2 = humans(3);
  grow(sim2, 1, Math.ceil(sim2.landTotal * 0.4));
  grow(sim2, 2, sim2.players[2].cells + Math.ceil(sim2.landTotal * 0.25));
  offerAccept(sim2, 1, 2, 'vassal');
  assert.ok(sim2.blocCells(1) >= sim2.landTotal * 0.6);
  untilVote(sim2);
  assert.ok(sim2.vote && sim2.vote.leader === 1);
});

test('semua pihak tersisa bersekutu -> kemenangan bersama', () => {
  const sim = humans(2);
  steps(sim, 620);
  offerAccept(sim, 1, 2, 'alliance');
  steps(sim, 20);
  assert.ok(sim.winner > 0);
  assert.equal(sim.winReason, 'bloc');
});

// ---------------------------------------------------------------- bot & jaringan
test('bot menyatakan perang sebelum menyerang & game dengan diplomasi tetap deterministik + invarian', () => {
  const setup = { seed: 21, width: 80, height: 52, style: 'continent', players: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: 'B' + i, kind: 'bot', difficulty: ['easy', 'normal', 'hard'][i % 3] })) };
  const s1 = new Sim(setup);
  const s2 = new Sim(setup);
  const bots = setup.players.map((p) => new Bot(p.id, p.difficulty, 21));
  const log = [];
  const kinds = new Set();
  for (let i = 0; i < 5000 && !s1.winner; i++) {
    const cmds = [];
    for (const b of bots) cmds.push(...b.think(s1));
    log.push(cmds);
    s1.step(cmds);
    for (const e of s1.drainEvents()) kinds.add(e.k);
    if (i % 400 === 0) counts(s1);
  }
  for (const cmds of log) s2.step(JSON.parse(JSON.stringify(cmds)));
  assert.equal(s1.checksum(), s2.checksum());
  assert.ok(kinds.has('war'), 'bot menyatakan perang');
  // tak ada serangan terhadap negara yang tidak sedang berperang
  for (const o of s1.offensives) if (o.target) assert.ok(s1.atWar(o.owner, o.target));
  counts(s1);
});

test('snapshot di tengah detik: restore identik walau ada diplomasi, tawaran, voting & revolusi', () => {
  const setup = { seed: 33, width: 80, height: 52, style: 'continent', players: [1, 2, 3, 4].map((i) => ({ id: i, name: 'P' + i, kind: i < 3 ? 'human' : 'bot', difficulty: 'normal' })) };
  const a = new Sim(setup);
  const bots = [new Bot(4, 'hard', 33)];
  island(a, 1, 14);
  grow(a, 2, Math.ceil(a.landTotal * 0.62));
  for (let i = 0; i < 700; i++) {
    const cmds = [];
    for (const b of bots) cmds.push(...b.think(a));
    if (i === 5) cmds.push({ t: 'war', p: 3, target: 1 }, { t: 'offer', p: 1, target: 3, kind: 'peace' });
    a.step(cmds);
  }
  for (const stopAt of [0, 3, 7]) {
    for (let i = 0; i < stopAt; i++) a.step([]);
    const snap = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Sim(setup);
    b.restore(snap);
    assert.equal(a.checksum(), b.checksum(), 'identik setelah restore');
    for (let i = 0; i < 120; i++) {
      const cmds = i === 10 ? [{ t: 'vote', p: 2, end: false }] : [];
      a.step(cmds);
      b.step(JSON.parse(JSON.stringify(cmds)));
    }
    assert.equal(a.checksum(), b.checksum(), 'tetap identik setelah lanjut');
    assert.deepEqual(a.owner, b.owner);
    assert.equal(a.players.length, b.players.length);
  }
});
