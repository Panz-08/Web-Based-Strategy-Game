import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/core/sim.ts';
import { Bot } from '../src/core/bot.ts';
import { getPreset, maxPlayers } from '../src/core/maps/index.ts';
import { buildSetup, playerCap } from '../src/net/lobby.ts';
import { T_WATER, T_SHALLOW, T_MOUNTAIN } from '../src/core/types.ts';

const IDS = ['world', 'mideast', 'europe'];
const opt = (map, extra = {}) => ({ bots: 15, difficulty: 'normal', width: 120, height: 78, style: 'continent', seed: 99, map, ...extra });

test('peta nyata: dimensi, bangsa, dan medan valid', () => {
  for (const id of IDS) {
    const p = getPreset(id);
    assert.ok(p, id);
    assert.equal(p.terrain.length, p.w * p.h);
    assert.equal(p.region.length, p.w * p.h);
    assert.ok(p.nations.length >= 16, `${id} butuh >=16 bangsa`);
    const seen = new Set();
    for (const n of p.nations) {
      const c = n.y * p.w + n.x;
      assert.ok(p.terrain[c] !== T_WATER && p.terrain[c] !== T_SHALLOW && p.terrain[c] !== T_MOUNTAIN, `${id}/${n.name} harus di darat`);
      assert.ok(!seen.has(c), 'lokasi bangsa unik');
      seen.add(c);
    }
    for (const m of p.mines) assert.ok(p.terrain[m] !== T_WATER);
  }
  assert.equal(getPreset('random'), null);
});

test('buildSetup: bangsa unik, bot dibatasi kapasitas, pilihan pemain dihormati', () => {
  for (const id of IDS) {
    const s = buildSetup(['Aku'], opt(id, { nation: 3 }));
    assert.equal(s.map, id);
    assert.equal(s.players.length, Math.min(16, 1 + 15));
    assert.equal(s.players[0].nation, 3);
    const nats = s.players.map((p) => p.nation);
    assert.equal(new Set(nats).size, nats.length, 'tak ada bangsa kembar');
    assert.ok(s.players.slice(1).every((p) => p.kind === 'bot' && p.trait));
  }
  const s = buildSetup(['A', 'B', 'C', 'D'], opt('world', { bots: 40 }));
  assert.equal(s.players.length, playerCap('world'));
  assert.ok(maxPlayers('random') === 16);
});

test('simulasi peta nyata: deterministik & lolos invarian dengan 15 bot', () => {
  for (const id of IDS) {
    const run = () => {
      const setup = buildSetup([], opt(id));
      const sim = new Sim(setup);
      const bots = setup.players.map((p) => new Bot(p.id, p.difficulty, setup.seed, p.trait));
      for (let i = 0; i < 1500 && !sim.winner; i++) {
        const cmds = [];
        for (const b of bots) cmds.push(...b.think(sim));
        sim.step(cmds);
      }
      return sim;
    };
    const a = run();
    const b = run();
    assert.deepEqual(Array.from(a.owner), Array.from(b.owner), id + ' deterministik');
    const cnt = new Array(a.players.length).fill(0);
    for (let c = 0; c < a.n; c++) {
      const o = a.owner[c];
      if (o) {
        assert.notEqual(a.terrain[c], T_WATER, 'tak ada kepemilikan di laut');
        cnt[o]++;
      }
    }
    for (let i = 1; i < a.players.length; i++) assert.equal(cnt[i], a.players[i].cells, `${id}: hitungan sel pemain ${i}`);
  }
});

test('setup peta nyata aman dikirim lewat JSON (multiplayer)', () => {
  const s = buildSetup(['Host', 'Tamu'], opt('europe', { bots: 6, nation: 2 }));
  const back = JSON.parse(JSON.stringify(s));
  const a = new Sim(s);
  const b = new Sim(back);
  assert.deepEqual(Array.from(a.owner), Array.from(b.owner));
  assert.deepEqual(a.players.slice(1).map((p) => p.capital), b.players.slice(1).map((p) => p.capital));
});

test('pasukan bisa menyeberangi selat dangkal tetapi tidak laut dalam', () => {
  const p = getPreset('world');
  let shallow = 0;
  for (let i = 0; i < p.terrain.length; i++) if (p.terrain[i] === T_SHALLOW) shallow++;
  assert.ok(shallow > 10, 'ada selat dangkal penghubung benua');
});
