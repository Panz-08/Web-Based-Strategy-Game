// Titik masuk: menu, setup, lobi multiplayer. Dibuat oleh panz-08.
(window as unknown as { __panzLoaded?: boolean }).__panzLoaded = true;
import { MAP_SIZES } from './core/types.ts';
import type { Difficulty, MapId, MapStyle, MatchSetup } from './core/types.ts';
import type { SimState } from './core/sim.ts';
import { bindPicker, pickerHtml } from './ui/mappicker.ts';
import { Game, esc, toast } from './game.ts';
import { AuthoritativeDriver } from './net/drivers.ts';
import type { Driver } from './net/drivers.ts';
import { GuestLobby, HostLobby, MAX_HUMANS, buildSetup, cleanName, playerCap } from './net/lobby.ts';
import type { MatchOptions } from './net/lobby.ts';
import { createGuest, createHost, normalizeCode } from './net/transport.ts';
import type { NetMode } from './net/transport.ts';
import { PALETTE } from './core/types.ts';
import { sfx } from './ui/audio.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

type SizeKey = keyof typeof MAP_SIZES;
interface Opts {
  bots: number;
  difficulty: Difficulty;
  size: SizeKey;
  style: MapStyle;
  seed: string;
  map: MapId;
  nation: number; // -1 = acak
}

const defaults: Opts = { bots: 7, difficulty: 'normal', size: 'medium', style: 'continent', seed: '', map: 'world', nation: -1 };
const optsSingle: Opts = { ...defaults };
const optsMulti: Opts = { ...defaults, bots: 5 };
let playerName = '';
let netMode: NetMode = 'online';

try {
  playerName = localStorage.getItem('panz-name') ?? '';
  const saved = JSON.parse(localStorage.getItem('panz-opts') ?? 'null');
  if (saved) Object.assign(optsSingle, saved);
} catch {
  /* abaikan */
}

function save(): void {
  try {
    localStorage.setItem('panz-name', playerName);
    localStorage.setItem('panz-opts', JSON.stringify(optsSingle));
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------------- layar
const screens = ['menu', 'setup', 'multi', 'lobby', 'howto'];
function show(id: string | null): void {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  $('screens').classList.toggle('hidden', id === null);
}

// ---------------------------------------------------------------------------------- opsi
function segHtml<K extends keyof Opts>(label: string, key: K, items: [string, string][], cur: string): string {
  return `<div class="field"><span>${label}</span><div class="seg" data-key="${key}">${items
    .map(([v, t]) => `<button type="button" data-v="${v}" class="${v === cur ? 'on' : ''}">${t}</button>`)
    .join('')}</div></div>`;
}

function mountOpts(host: HTMLElement, o: Opts, minBots: number, onChange?: () => void): void {
  const cap = (): number => Math.max(minBots, playerCap(o.map) - 1);
  const render = (): void => {
    o.bots = Math.min(Math.max(o.bots, minBots), cap());
    const random = o.map === 'random';
    const pk = pickerHtml(o);
    host.innerHTML =
      `<div class="optcols"><div class="optcol">${pk.left}</div><div class="optcol">${pk.right}` +
      `<div class="field"><span>Jumlah bot: <b data-botval>${o.bots}</b></span><input type="range" class="botrange" data-bots min="${minBots}" max="${cap()}" step="1" value="${o.bots}" /></div>` +
      segHtml('Kesulitan bot', 'difficulty', [['easy', 'Mudah'], ['normal', 'Normal'], ['hard', 'Sulit']], o.difficulty) +
      (random
        ? segHtml('Ukuran peta', 'size', Object.entries(MAP_SIZES).map(([k, v]) => [k, v.label] as [string, string]), o.size) +
          segHtml('Gaya peta', 'style', [['continent', 'Benua'], ['highland', 'Pegunungan'], ['open', 'Terbuka']], o.style) +
          `<div class="field"><span>Seed peta</span><div class="seedrow"><input data-seed maxlength="9" inputmode="numeric" placeholder="acak tiap main" value="${esc(o.seed)}" autocomplete="off" /><button type="button" class="ghost" data-dice>Acak</button></div></div>`
        : '') +
      `</div></div>`;
    bindPicker(host, o, (mapChanged) => {
      save();
      sfx.click();
      if (mapChanged) render();
      onChange?.();
    });
    const range = host.querySelector<HTMLInputElement>('[data-bots]')!;
    range.addEventListener('input', () => {
      o.bots = Number(range.value);
      host.querySelector('[data-botval]')!.textContent = String(o.bots);
      save();
    });
    host.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        (o as unknown as Record<string, string>)[seg.dataset.key as string] = b.dataset.v!;
        sfx.click();
        save();
        onChange?.();
      });
    });
    const seedIn = host.querySelector<HTMLInputElement>('[data-seed]');
    if (seedIn) {
      seedIn.addEventListener('input', () => {
        o.seed = seedIn.value.replace(/\D/g, '');
        seedIn.value = o.seed;
        save();
      });
      host.querySelector('[data-dice]')!.addEventListener('click', () => {
        o.seed = String(Math.floor(Math.random() * 900000) + 100000);
        seedIn.value = o.seed;
        save();
      });
    }
  };
  render();
}

function toMatch(o: Opts): MatchOptions {
  const size = MAP_SIZES[o.size];
  const seed = o.seed ? Number(o.seed) : Math.floor(Math.random() * 0x7fffffff);
  return { bots: o.bots, difficulty: o.difficulty, width: size.w, height: size.h, style: o.style, seed, map: o.map, nation: o.nation };
}

// ---------------------------------------------------------------------------------- game
const game = new Game($('stage') as HTMLCanvasElement);
let current: 'menu' | 'single' | 'multi' = 'menu';
let lastSingle: Opts | null = null;
let hostLobby: HostLobby | null = null;
let guestLobby: GuestLobby | null = null;

// ---------------------------------------------------------------------------------- simpan / lanjutkan
const SAVE_KEY = 'panz-save-v1';
const SAVE_VERSION = 1;
interface SavedGame {
  v: number;
  savedAt: number;
  name: string;
  setup: MatchSetup;
  state: SimState;
}
let saveBadgeTimer = 0;

function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* abaikan */
  }
}

function readSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedGame;
    if (!s || s.v !== SAVE_VERSION || !s.setup || !s.state) return null;
    const st = s.setup;
    if (
      typeof st.seed !== 'number' ||
      typeof st.width !== 'number' ||
      typeof st.height !== 'number' ||
      !Array.isArray(st.players) ||
      st.players.length < 2
    ) {
      return null;
    }
    if (!s.state.owner || !s.state.feat || !Array.isArray(s.state.players)) return null;
    return s;
  } catch {
    return null;
  }
}

function updateResumeButton(): void {
  const el = $('goResume');
  if (el) el.classList.toggle('hidden', !readSave());
}

function showSaveBadge(): void {
  const el = $('saveBadge');
  if (!el) return;
  el.classList.remove('hidden');
  window.clearTimeout(saveBadgeTimer);
  saveBadgeTimer = window.setTimeout(() => el.classList.add('hidden'), 1800);
}

/** Simpan snapshot single-player. Dipanggil periodik dan saat tab disembunyikan. */
function saveSingle(): void {
  if (current !== 'single' || game.demo) return;
  const d = game.driver;
  if (!(d instanceof AuthoritativeDriver) || d.kind !== 'single') return;
  if (d.sim.winner) {
    clearSave();
    updateResumeButton();
    return;
  }
  if (d.sim.tick < 1) return;
  try {
    const data: SavedGame = {
      v: SAVE_VERSION,
      savedAt: Date.now(),
      name: playerName,
      setup: d.sim.setup,
      state: d.sim.serialize(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    showSaveBadge();
    updateResumeButton();
  } catch {
    /* localStorage penuh / mode privat - permainan tetap jalan */
  }
}

function optsFromSave(s: SavedGame): Opts {
  const st = s.setup;
  const size =
    (Object.keys(MAP_SIZES) as SizeKey[]).find(
      (k) => MAP_SIZES[k].w === st.width && MAP_SIZES[k].h === st.height,
    ) ?? 'medium';
  const human = st.players.find((p) => p.kind === 'human') ?? st.players[0];
  return {
    ...defaults,
    bots: st.players.filter((p) => p.kind === 'bot').length,
    difficulty: human?.difficulty ?? 'normal',
    size,
    style: st.style,
    seed: String(st.seed),
    map: st.map ?? 'random',
    nation: human?.nation ?? -1,
  };
}


function startDemo(): void {
  const setup = buildSetup(
    [],
    {
      bots: 9,
      difficulty: 'hard',
      width: MAP_SIZES.medium.w,
      height: MAP_SIZES.medium.h,
      style: (['continent', 'highland', 'open'] as MapStyle[])[Math.floor(Math.random() * 3)],
      seed: Math.floor(Math.random() * 0x7fffffff),
      map: (['world', 'mideast', 'europe'] as MapId[])[Math.floor(Math.random() * 3)],
    },
  );
  const d = new AuthoritativeDriver(setup, 0);
  d.speed = 3;
  game.start(d, true);
}

function goMenu(): void {
  saveSingle();
  hostLobby?.cancel();
  guestLobby?.leave();
  hostLobby = guestLobby = null;
  game.stop();
  current = 'menu';
  show('menu');
  updateResumeButton();
  startDemo();
}

game.setCallbacks({
  onExit: goMenu,
  onRematch: () => {
    if (game.demo) return startDemo();
    if (current === 'single' && lastSingle) startSingle({ ...lastSingle, seed: '' });
    else goMenu();
  },
});

function begin(driver: Driver, mode: 'single' | 'multi'): void {
  current = mode;
  show(null);
  driver.onDisconnect = () => {
    if (current === 'multi' && driver.kind === 'guest') {
      toast('Koneksi ke host terputus', 'warn');
      goMenu();
    }
  };
  if (driver instanceof AuthoritativeDriver && driver.kind === 'host') {
    driver.onPlayerLeft = (pid) => toast(`${driver.sim.players[pid].name} keluar - digantikan AI`, 'info');
  }
  game.start(driver);
}

function startSingle(o: Opts, saved?: SavedGame): void {
  lastSingle = { ...o };
  if (!saved) clearSave();
  const name = cleanName(playerName, 'Kamu');
  const setup = saved ? saved.setup : buildSetup([name], toMatch(o));
  game.stop();
  const driver = new AuthoritativeDriver(setup, 1);
  // Snapshot dipulihkan setelah Sim dibuat dari setup yang sama. Peta, seed,
  // bangsa, dan bot tetap konsisten; state permainan kembali identik.
  if (saved) driver.sim.restore(saved.state);
  begin(driver, 'single');
  updateResumeButton();
}

// ---------------------------------------------------------------------------------- multiplayer
function multiMsg(text: string, bad = true): void {
  const el = $('multiMsg');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  el.classList.toggle('bad', bad);
}

function renderPlayers(names: string[], mine = -1): void {
  $('lobbyPlayers').innerHTML =
    names
      .map((n, i) => {
        const c = PALETTE[i + 1].rgb;
        return `<li><i class="dot" style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>${esc(n)}${i === 0 ? ' <em>host</em>' : ''}${i === mine ? ' <em>kamu</em>' : ''}</li>`;
      })
      .join('') + `<li class="free">${names.length < MAX_HUMANS ? 'Menunggu pemain lain…' : 'Ruang penuh'}</li>`;
}

async function hostRoom(): Promise<void> {
  playerName = cleanName($<HTMLInputElement>('nameMulti').value, 'Host');
  save();
  multiMsg('Membuat ruang…', false);
  $<HTMLButtonElement>('hostBtn').disabled = true;
  try {
    const t = createHost(netMode);
    await t.open();
    const lobby = new HostLobby(t, playerName);
    hostLobby = lobby;
    $('lobbyTitle').textContent = netMode === 'local' ? 'Ruang lokal' : 'Ruang online';
    $('lobbyCode').textContent = t.code;
    $('lobbyOpts').classList.remove('hidden');
    $('lobbyWait').classList.add('hidden');
    $('lobbyStart').classList.remove('hidden');
    mountOpts($('lobbyOpts'), optsMulti, 0);
    renderPlayers(lobby.names());
    lobby.onChange = () => renderPlayers(lobby.names());
    multiMsg('');
    show('lobby');
  } catch (e) {
    multiMsg((e as Error).message);
  } finally {
    $<HTMLButtonElement>('hostBtn').disabled = false;
  }
}

async function joinRoom(): Promise<void> {
  const code = normalizeCode($<HTMLInputElement>('joinCode').value);
  if (code.length < 4) return multiMsg('Masukkan kode ruang dari host');
  playerName = cleanName($<HTMLInputElement>('nameMulti').value, 'Tamu');
  save();
  multiMsg('Menghubungkan…', false);
  $<HTMLButtonElement>('joinBtn').disabled = true;
  try {
    const t = createGuest(netMode);
    await t.connect(code);
    const gl = new GuestLobby(t, playerName);
    guestLobby = gl;
    $('lobbyTitle').textContent = 'Ruang ' + (netMode === 'local' ? 'lokal' : 'online');
    $('lobbyCode').textContent = code;
    $('lobbyOpts').classList.add('hidden');
    $('lobbyWait').classList.remove('hidden');
    $('lobbyStart').classList.add('hidden');
    renderPlayers([]);
    gl.onChange = () => renderPlayers(gl.names, gl.names.indexOf(playerName));
    gl.onStart = (d) => {
      guestLobby = null;
      game.stop();
      begin(d, 'multi');
    };
    gl.onClosed = (why) => {
      guestLobby = null;
      toast(why, 'warn');
      goMenu();
    };
    multiMsg('');
    show('lobby');
  } catch (e) {
    multiMsg((e as Error).message);
  } finally {
    $<HTMLButtonElement>('joinBtn').disabled = false;
  }
}

function updateNetHint(): void {
  $('netHint').textContent =
    netMode === 'online'
      ? 'Main dengan teman lewat internet (peer-to-peer, tanpa server game). Bagikan kode ruang ke temanmu.'
      : 'Untuk tes tanpa internet: buka dua tab di browser yang sama - satu membuat ruang, satu bergabung dengan kode.';
}

// ---------------------------------------------------------------------------------- pengikat UI
function wire(): void {
  $<HTMLInputElement>('nameSingle').value = playerName;
  $<HTMLInputElement>('nameMulti').value = playerName;

  $('goSingle').addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    mountOpts($('setupOpts'), optsSingle, 1);
    show('setup');
  });
  $('goResume').addEventListener('click', () => {
    const saved = readSave();
    if (!saved) {
      updateResumeButton();
      toast('Snapshot tersimpan tidak ditemukan', 'warn');
      return;
    }
    playerName = cleanName(saved.name, playerName || 'Kamu');
    save();
    sfx.unlock();
    sfx.click();
    startSingle(optsFromSave(saved), saved);
    toast('Melanjutkan permainan tersimpan', 'good');
  });
  $('goMulti').addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    updateNetHint();
    multiMsg('');
    show('multi');
  });
  $('goHow').addEventListener('click', () => {
    sfx.click();
    show('howto');
  });
  document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => {
    sfx.click();
    show('menu');
  }));
  $('startSingle').addEventListener('click', () => {
    playerName = cleanName($<HTMLInputElement>('nameSingle').value, 'Kamu');
    save();
    sfx.click();
    startSingle(optsSingle);
  });
  $('netMode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    netMode = b.dataset.v as NetMode;
    $('netMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    updateNetHint();
  });
  $('hostBtn').addEventListener('click', () => void hostRoom());
  $('joinBtn').addEventListener('click', () => void joinRoom());
  $('joinCode').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void joinRoom();
  });
  $('copyCode').addEventListener('click', async () => {
    const code = $('lobbyCode').textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      toast('Kode disalin: ' + code, 'good');
    } catch {
      toast('Kode ruang: ' + code, 'info');
    }
  });
  $('lobbyStart').addEventListener('click', () => {
    if (!hostLobby) return;
    const o = toMatch(optsMulti);
    if (hostLobby.names().length + o.bots < 2) return toast('Tambahkan bot atau tunggu pemain lain', 'warn');
    const lobby = hostLobby;
    hostLobby = null;
    game.stop();
    begin(lobby.start(o), 'multi');
  });
  $('lobbyLeave').addEventListener('click', () => {
    sfx.click();
    hostLobby?.cancel();
    guestLobby?.leave();
    hostLobby = guestLobby = null;
    show('multi');
  });

  // Tautan undangan: ?join=KODE&mode=local|online
  const q = new URLSearchParams(location.search);
  const jc = q.get('join');
  if (jc) {
    netMode = q.get('mode') === 'local' ? 'local' : 'online';
    $('netMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === netMode));
    $<HTMLInputElement>('joinCode').value = normalizeCode(jc);
    updateNetHint();
    show('multi');
  }
}

wire();
updateResumeButton();
window.setInterval(saveSingle, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveSingle();
});
window.addEventListener('pagehide', saveSingle);
if (!new URLSearchParams(location.search).get('join')) show('menu');
startDemo();

// Untuk debugging & tes otomatis.
(window as unknown as { __panz: unknown }).__panz = { game, get driver() { return game.driver; } };
