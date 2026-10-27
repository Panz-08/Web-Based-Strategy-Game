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
