// Simulasi headless bot-vs-bot untuk tuning keseimbangan & performa.
// Pakai: node scripts/balance.mjs [jumlahBot] [seed] [peta: random|world|mideast|europe]
import { Sim, CFG } from '../src/core/sim.ts';
import { Bot } from '../src/core/bot.ts';
import { TPS } from '../src/core/types.ts';
import { buildSetup } from '../src/net/lobby.ts';

if (process.env.CFG) Object.assign(CFG, JSON.parse(process.env.CFG));
const count = Number(process.argv[2] ?? 8);
const seed = Number(process.argv[3] ?? 1234);
const map = process.argv[4] ?? 'world';
const setup = buildSetup([], { bots: count, difficulty: process.env.DIFF ?? 'normal', width: 120, height: 78, style: 'continent', seed, map });
const sim = new Sim(setup);
const bots = setup.players.map((p) => new Bot(p.id, p.difficulty, seed, p.trait));
const knownBots = new Set(setup.players.map((p) => p.id));
const t0 = Date.now();
let maxStep = 0;
while (!sim.winner && sim.tick < 12000) {
  const s0 = performance.now();
  const cmds = [];
  for (const b of bots) cmds.push(...b.think(sim));
  sim.step(cmds);
  maxStep = Math.max(maxStep, performance.now() - s0);
  for (let id = 1; id < sim.players.length; id++) if (!knownBots.has(id)) { knownBots.add(id); bots.push(new Bot(id, 'normal', seed)); }
  if (sim.tick % (TPS * 120) === 0) {
    const r = sim.ranking().slice(0, 8).map((p) => `${p.name}:${p.cells}${p.alive ? '' : '†'}`).join(' ');
    console.log(`t=${Math.round(sim.tick / TPS)}s ${r}`);
  }
}
const w = sim.players[sim.winner];
const ms = Date.now() - t0;
console.log(`SELESAI map=${map} pemain=${sim.players.length - 1} tick=${sim.tick} pemenang=${w ? w.name : '-'} alasan=${sim.winReason} real=${ms}ms (${(ms / sim.tick).toFixed(2)} ms/tick, maks ${maxStep.toFixed(1)}ms) darat=${sim.landTotal}`);
