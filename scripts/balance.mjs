// Simulasi headless bot-vs-bot untuk tuning keseimbangan: node scripts/balance.mjs [pemain] [seed] [ukuran]
import { Sim, CFG } from '../src/core/sim.ts';
import { Bot } from '../src/core/bot.ts';
import { BOT_NAMES, MAP_SIZES, TPS } from '../src/core/types.ts';

if (process.env.CFG) Object.assign(CFG, JSON.parse(process.env.CFG));
const count = Number(process.argv[2] ?? 6);
const seed = Number(process.argv[3] ?? 1234);
const size = MAP_SIZES[process.argv[4] ?? 'medium'];
const diffs = ['easy', 'normal', 'hard'];

const players = Array.from({ length: count }, (_, i) => ({
  id: i + 1,
  name: BOT_NAMES[i],
  kind: 'bot',
  difficulty: process.env.DIFF ?? diffs[i % 3],
}));
const sim = new Sim({ seed, width: size.w, height: size.h, style: process.env.STYLE ?? 'continent', players });
const bots = players.map((p) => new Bot(p.id, p.difficulty, seed));
const t0 = Date.now();
while (!sim.winner && sim.tick < 12000) {
  const cmds = [];
  for (const b of bots) cmds.push(...b.think(sim));
  sim.step(cmds);
  while (bots.length < sim.players.length - 1) bots.push(new Bot(bots.length + 1, 'normal', seed)); // negara hasil revolusi
  if (sim.tick % (TPS * 60) === 0) {
    const r = sim
      .ranking()
      .map((p) => `${p.name}(${p.difficulty[0]}):${p.cells}${p.alive ? '' : '†'}`)
      .join(' ');
    console.log(`t=${Math.round(sim.tick / TPS)}s ${r}`);
  }
}
const w = sim.players[sim.winner];
console.log(
  `SELESAI tick=${sim.tick} (${Math.round(sim.tick / TPS)}s) pemenang=${w ? w.name + '(' + w.difficulty + ')' : '-'} alasan=${sim.winReason} real=${Date.now() - t0}ms land=${sim.landTotal}`,
);
