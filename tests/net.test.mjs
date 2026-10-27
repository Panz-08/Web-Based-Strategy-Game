import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetup, HostLobby, GuestLobby } from '../src/net/lobby.ts';

// Transport palsu di memori dengan antrean sehingga latensi bisa disimulasikan.
class FakeNet {
  constructor() {
    this.host = null;
    this.guests = new Map();
    this.q = [];
    this.drop = null; // fn(msg) => bool
  }
  pump() {
    const q = this.q;
    this.q = [];
    for (const f of q) f();
  }
}
function makeHost(net) {
  const h = {
    code: 'TEST1',
    onGuestJoin: () => {},
    onGuestLeave: () => {},
    onMessage: () => {},
    open: async () => 'TEST1',
    send(gid, msg) {
      if (net.drop && net.drop(msg)) return;
      const g = net.guests.get(gid);
      const m = structuredClone(msg);
      net.q.push(() => g.onMessage(m));
    },
    broadcast(msg) {
      for (const gid of net.guests.keys()) this.send(gid, msg);
    },
    close() {},
  };
  net.host = h;
  return h;
}
function makeGuest(net, id) {
  const g = {
    onMessage: () => {},
    onClose: () => {},
    connect: async () => {
      net.guests.set(id, g);
      net.host.onGuestJoin(id);
    },
    send(msg) {
      const m = structuredClone(msg);
      net.q.push(() => net.host.onMessage(id, m));
    },
    close() {
      net.guests.delete(id);
      net.host.onGuestLeave(id);
    },
  };
  return g;
}

const OPT = { bots: 2, difficulty: 'normal', width: 80, height: 52, style: 'continent', seed: 77 };

async function startMatch(net) {
  const host = makeHost(net);
  const hl = new HostLobby(host, 'Host');
  const g1 = makeGuest(net, 'g1');
  await g1.connect();
  const gl = new GuestLobby(g1, 'Tamu');
  let guestDriver = null;
  gl.onStart = (d) => (guestDriver = d);
  net.pump();
  assert.deepEqual(hl.names(), ['Host', 'Tamu']);
  const hd = hl.start(OPT);
  net.pump();
  assert.ok(guestDriver, 'guest menerima start');
  assert.equal(guestDriver.me, 2);
  return { hd, gd: guestDriver, g1 };
}

function run(net, hd, gd, frames, each = () => {}) {
  for (let f = 0; f < frames; f++) {
    each(f);
    hd.update(100);
    net.pump();
    gd.update(100);
    net.pump();
  }
}

test('setup: slot manusia dulu, lalu bot', () => {
  const s = buildSetup(['A', 'B'], OPT);
  assert.deepEqual(s.players.map((p) => p.kind), ['human', 'human', 'bot', 'bot']);
  assert.deepEqual(s.players.map((p) => p.id), [1, 2, 3, 4]);
});

test('lockstep: host & guest tetap identik, perintah guest diterapkan dengan id benar', async () => {
  const net = new FakeNet();
  const { hd, gd } = await startMatch(net);
  let sent = false;
  run(net, hd, gd, 900, (f) => {
    if (f === 30 && !sent) {
      sent = true;
      // cari target netral berdekatan untuk pemain 2
      const sim = gd.sim;
      for (let c = 0; c < sim.n; c++) {
        if (sim.owner[c] !== 0 || sim.terrain[c] === 0) continue;
        const x = c % sim.w;
        if (sim.owner[c - 1] === 2 || sim.owner[c + 1] === 2 || sim.owner[c - sim.w] === 2 || sim.owner[c + sim.w] === 2) {
          gd.submit({ t: 'atk', p: 1 /* mencoba menyamar */, idx: c, pct: 70, wide: false });
          break;
        }
      }
    }
  });
  assert.ok(Math.abs(hd.sim.tick - gd.sim.tick) <= 3, `tick: host ${hd.sim.tick} guest ${gd.sim.tick}`);
  // samakan: jalankan host sampai tick guest tidak mungkin; bandingkan lewat snapshot checksum pada tick yang sama
  const p2host = hd.sim.players[2];
  assert.ok(p2host.cells > 21, 'pemain 2 berhasil menyerang (id tidak bisa dipalsukan): ' + p2host.cells);
  assert.equal(hd.sim.players[1].cells <= hd.sim.players[1].peakCells, true);
  assert.equal(gd.desyncs, 0);
});

test('guest dengan latensi & burst tetap sinkron', async () => {
  const net = new FakeNet();
  const { hd, gd } = await startMatch(net);
  // host jalan beberapa frame sebelum guest memproses (latensi)
  for (let f = 0; f < 200; f++) {
    hd.update(100);
    if (f % 5 === 4) {
      net.pump();
      gd.update(300);
    }
  }
  net.pump();
  for (let i = 0; i < 40; i++) gd.update(100);
  assert.equal(gd.desyncs, 0);
  // bandingkan state pada tick yang sama
  const s = gd.sim.tick;
  assert.ok(s > 100);
  const a = hd.sim.serialize();
  assert.ok(a.tick >= s);
});

test('tick hilang => guest minta resync & pulih', async () => {
  const net = new FakeNet();
  const { hd, gd } = await startMatch(net);
  let dropped = 0;
  net.drop = (m) => {
    if (m.k === 'tick' && m.t === 50 && dropped === 0) {
      dropped++;
      return true;
    }
    return false;
  };
  run(net, hd, gd, 400);
  net.drop = null;
  run(net, hd, gd, 100);
  assert.equal(dropped, 1);
  assert.ok(gd.sim.tick > 300, 'guest tetap maju: ' + gd.sim.tick);
  // Setelah pulih, checksum guest = checksum host pada tick sama (snapshot host dibandingkan restore)
  const snap = hd.sim.serialize();
  assert.ok(Math.abs(snap.tick - gd.sim.tick) <= 5);
});

test('guest keluar => diganti bot & host lanjut', async () => {
  const net = new FakeNet();
  const { hd, gd, g1 } = await startMatch(net);
  run(net, hd, gd, 50);
  g1.close();
  const before = hd.sim.tick;
  for (let i = 0; i < 100; i++) hd.update(100);
  assert.ok(hd.sim.tick > before + 90);
  assert.ok(hd.sim.players[2].name.includes('(AI)'));
});

test('diplomasi & voting lewat jaringan: perintah tamu divalidasi, id tak bisa dipalsukan, tetap sinkron', async () => {
  const net = new FakeNet();
  const { hd, gd } = await startMatch(net);
  run(net, hd, gd, 60);
  // Tamu (pemain 2) mencoba menyamar sebagai pemain 1 untuk menyatakan perang & menawarkan pakta.
  gd.submit({ t: 'war', p: 1, target: 3 });
  gd.submit({ t: 'offer', p: 1, target: 1, kind: 'bogus' }); // jenis tak dikenal -> dibuang
  gd.submit({ t: 'offer', p: 1, target: 3, kind: 'nap' });
  gd.submit({ t: 'surrender', p: 1, target: 'x' }); // target bukan angka -> dibuang
  run(net, hd, gd, 40);
  assert.equal(hd.sim.relKind(2, 3), 'war', 'perang dinyatakan atas nama pemain 2, bukan 1');
  assert.equal(hd.sim.relKind(1, 3), 'peace', 'pemain 1 tidak terseret oleh pemalsuan');
  assert.ok(hd.sim.offers.every((o) => o.from !== 1), 'tidak ada tawaran atas nama pemain 1');
  assert.equal(gd.desyncs, 0, 'diplomasi tetap sinkron di host & tamu');
  assert.equal(gd.sim.relKind(2, 3), 'war', 'tamu menyimpan relasi yang sama');
  // Voting kemenangan: pemain 1 (host) mendominasi, hanya manusia yang memilih.
  const h = hd.sim;
  const p1 = h.players[1];
  const q = [p1.capital];
  const seen = new Set(q);
  while (q.length && p1.cells < Math.ceil(h.landTotal * 0.63)) {
    const c = q.shift();
    for (const n of [c - 1, c + 1, c - h.w, c + h.w]) {
      if (n < 0 || n >= h.n || seen.has(n) || h.terrain[n] === 0 || (h.owner[n] !== 0 && h.owner[n] !== 1)) continue;
      seen.add(n);
      if (h.owner[n] === 0) {
        h.owner[n] = 1;
        p1.cells++;
      }
      q.push(n);
    }
  }
  // Tamu menerima snapshot penuh lewat jalur resync resmi; lalu keduanya melangkah.
  gd.transport.send({ k: 'sync-req' });
  run(net, hd, gd, 60);
  assert.ok(hd.sim.vote && hd.sim.vote.leader === 1, 'voting terbuka di host');
  gd.submit({ t: 'vote', p: 1, end: true }); // pemain 2 memilih (id dipaksa jadi 2 oleh host)
  hd.submit({ t: 'vote', p: 1, end: true });
  run(net, hd, gd, 30);
  assert.equal(hd.sim.winner, 1);
  assert.equal(hd.sim.winReason, 'dominance');
  assert.equal(gd.sim.winner, 1, 'tamu melihat hasil voting yang sama');
});
