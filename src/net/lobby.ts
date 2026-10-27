// Lobby multiplayer: Host mengumpulkan pemain lalu memulai; Guest menunggu sinyal start.
import { BOT_NAMES } from '../core/types.ts';
import type { Difficulty, MapStyle, MatchSetup, PlayerSetup } from '../core/types.ts';
import { AuthoritativeDriver, GuestDriver } from './drivers.ts';
import type { GuestTransport, HostTransport, Msg } from './transport.ts';

export const MAX_HUMANS = 4;
export const MAX_PLAYERS = 8;

export interface MatchOptions {
  bots: number;
  difficulty: Difficulty;
  width: number;
  height: number;
  style: MapStyle;
  seed: number;
}

export function cleanName(s: unknown, fallback: string): string {
  const t = String(s ?? '')
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .trim()
    .slice(0, 14);
  return t || fallback;
}

export function buildSetup(humans: string[], opt: MatchOptions): MatchSetup {
  const players: PlayerSetup[] = [];
  humans.forEach((name, i) => players.push({ id: i + 1, name, kind: 'human' }));
  const bots = Math.min(opt.bots, MAX_PLAYERS - humans.length);
  for (let b = 0; b < bots; b++) {
    players.push({ id: players.length + 1, name: BOT_NAMES[b % BOT_NAMES.length], kind: 'bot', difficulty: opt.difficulty });
  }
  return { seed: opt.seed, width: opt.width, height: opt.height, style: opt.style, players };
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
