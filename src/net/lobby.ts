// Lobby multiplayer: Host mengumpulkan pemain lalu memulai; Guest menunggu sinyal start.
import { BOT_NAMES } from '../core/types.ts';
import type { Difficulty, MapId, MapStyle, MatchSetup, PlayerSetup, Trait } from '../core/types.ts';
import { getPreset, maxPlayers } from '../core/maps/index.ts';
import { Rng } from '../core/rng.ts';
import { AuthoritativeDriver, GuestDriver } from './drivers.ts';
import type { GuestTransport, HostTransport, Msg } from './transport.ts';

export const MAX_HUMANS = 4;
export const MAX_PLAYERS = 16;

export interface MatchOptions {
  bots: number;
  difficulty: Difficulty;
  width: number;
  height: number;
  style: MapStyle;
  seed: number;
  map?: MapId; // default 'random'
  nation?: number; // bangsa pilihan host/pemain (indeks pada peta nyata); -1/undefined = acak
}

export function cleanName(s: unknown, fallback: string): string {
  const t = String(s ?? '')
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .trim()
    .slice(0, 14);
  return t || fallback;
}

/** Jumlah pemain maksimum untuk pilihan peta (peta nyata dibatasi jumlah bangsanya). */
export function playerCap(map: MapId | undefined): number {
  return Math.min(MAX_PLAYERS, maxPlayers(map ?? 'random'));
}

export function buildSetup(humans: string[], opt: MatchOptions): MatchSetup {
  const players: PlayerSetup[] = [];
  const map = opt.map ?? 'random';
  const preset = getPreset(map);
  const rng = new Rng(opt.seed ^ 0x2f6e2b1);
  const cap = playerCap(map);
  const bots = Math.max(0, Math.min(opt.bots, cap - humans.length));
  const traits: Trait[] = ['war', 'build', 'dip', 'bal'];

  // Bangsa: pilihan host dulu, lalu pemain lain & bot mengambil urutan (sudah tersebar) yang masih kosong.
  const used = new Set<number>();
  const take = (want?: number): number | undefined => {
    if (!preset) return undefined;
    if (want !== undefined && want >= 0 && want < preset.nations.length && !used.has(want)) {
      used.add(want);
      return want;
    }
    const free: number[] = [];
    for (let i = 0; i < preset.nations.length; i++) if (!used.has(i)) free.push(i);
    if (!free.length) return undefined;
    // Pemain tanpa pilihan: ambil acak dari bangsa yang tersisa; bot: urutan tersebar.
    const pick = want === -1 ? free[rng.int(free.length)] : free[0];
    used.add(pick);
    return pick;
  };

  const humanNations = humans.map((_, i) => take(i === 0 ? (opt.nation === undefined ? -1 : opt.nation) : -1));
  humans.forEach((name, i) => players.push({ id: i + 1, name, kind: 'human', nation: humanNations[i] }));
  for (let b = 0; b < bots; b++) {
    const nat = take();
    const n = preset && nat !== undefined ? preset.nations[nat] : undefined;
    players.push({
      id: players.length + 1,
      name: n ? n.name : BOT_NAMES[b % BOT_NAMES.length],
      kind: 'bot',
      difficulty: opt.difficulty,
      nation: nat,
      trait: n ? n.trait : traits[(b + (opt.seed & 3)) % traits.length],
    });
  }
  return { seed: opt.seed, width: preset ? preset.w : opt.width, height: preset ? preset.h : opt.height, style: opt.style, map, players };
}

export class HostLobby {
  private guests = new Map<string, string>(); // gid -> nama
  onChange: () => void = () => {};
  private started = false;
  private transport: HostTransport;
  hostName: string;

  constructor(transport: HostTransport, hostName: string) {
    this.transport = transport;
    this.hostName = hostName;
    transport.onGuestJoin = () => {};
    transport.onGuestLeave = (gid) => {
      if (this.started) return;
      this.guests.delete(gid);
      this.broadcast();
    };
    transport.onMessage = (gid, msg) => {
      if (msg.k !== 'join' || this.started) return;
      if (this.guests.size + 1 >= MAX_HUMANS) {
        transport.send(gid, { k: 'full' });
        return;
      }
      this.guests.set(gid, cleanName(msg.name, 'Tamu'));
      this.broadcast();
    };
  }

  get code(): string {
    return this.transport.code;
  }

  names(): string[] {
    return [this.hostName, ...this.guests.values()];
  }

  private broadcast(): void {
    this.transport.broadcast({ k: 'lobby', names: this.names() });
    this.onChange();
  }

  start(opt: MatchOptions): AuthoritativeDriver {
    this.started = true;
    const gids = [...this.guests.keys()];
    const setup = buildSetup(this.names(), opt);
    const map = new Map<string, number>();
    gids.forEach((g, i) => map.set(g, i + 2));
    // Pesan start dikirim sebelum tick pertama; transport bersifat berurutan.
    gids.forEach((g, i) => this.transport.send(g, { k: 'start', setup: setup as unknown as Msg, you: i + 2 }));
    return new AuthoritativeDriver(setup, 1, this.transport, map);
  }

  cancel(): void {
    this.transport.broadcast({ k: 'end' });
    this.transport.close();
  }
}

export class GuestLobby {
  names: string[] = [];
  onChange: () => void = () => {};
  onStart: (d: GuestDriver) => void = () => {};
  onClosed: (reason: string) => void = () => {};
  private started = false;
  private transport: GuestTransport;

  constructor(transport: GuestTransport, name: string) {
    this.transport = transport;
    transport.onMessage = (m) => {
      if (m.k === 'lobby') {
        this.names = m.names as string[];
        this.onChange();
      } else if (m.k === 'start') {
        this.started = true;
        const drv = new GuestDriver(m.setup as unknown as MatchSetup, m.you as number, transport);
        this.onStart(drv);
      } else if (m.k === 'full') {
        this.onClosed('Ruang penuh');
      } else if (m.k === 'end' && !this.started) {
        this.onClosed('Host menutup ruang');
      }
    };
    transport.onClose = () => {
      if (!this.started) this.onClosed('Koneksi ke host terputus');
    };
    transport.send({ k: 'join', name });
  }

  leave(): void {
    this.transport.close();
  }
}
