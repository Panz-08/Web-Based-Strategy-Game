// Pengendali permainan: input, HUD, event, loop. Dibuat oleh panz-08.
import { CFG } from './core/sim.ts';
import { PALETTE, TPS, T_WATER } from './core/types.ts';
import type { GameEvent, OfferKind, Player } from './core/types.ts';
import type { Driver } from './net/drivers.ts';
import { Renderer } from './ui/renderer.ts';
import { sfx } from './ui/audio.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function toast(msg: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 4) box.firstElementChild?.remove();
  setTimeout(() => el.remove(), 2600);
}

function fmt(n: number): string {
  if (n < 1000) return String(Math.floor(n));
  if (n < 100000) return (n / 1000).toFixed(1) + 'k';
  return Math.floor(n / 1000) + 'k';
}

function clock(ticks: number): string {
  const s = Math.floor(ticks / TPS);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export interface GameCallbacks {
  onExit: () => void;
  onRematch: () => void;
}

export class Game {
  readonly r: Renderer;
  driver: Driver | null = null;
  demo = false;
  private cb: GameCallbacks = { onExit: () => {}, onRematch: () => {} };
  private raf = 0;
  private bgTimer = 0;
  private lastT = 0;
  private hudT = 0;
  private miniT = 0;
  private boardKey = '';
  private pct = 50;
  private wide = false;
  private fortMode = false;
  private shipMode = false;
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; button: number; moved: boolean }>();
  private pinch = 0;
  private pinchMidPrev: { x: number; y: number } | null = null;
  private lastMyCells = 0;
  private finished = false;
  private defeatShown = false;
  private watching = false;
  private mini: HTMLCanvasElement;
  private bound = false;
  private driftT = 0;
  private diploOpen = false;
  private diploKey = '';
  private diploFocus = 0;
  private armed = '';
  private armTimer = 0;
  private voteKey = '';
  private cutOld = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.r = new Renderer(canvas);
    this.mini = $('miniCanvas') as HTMLCanvasElement;
  }

  setCallbacks(cb: GameCallbacks): void {
    this.cb = cb;
  }

  // ------------------------------------------------------------------ siklus hidup
  start(driver: Driver, demo = false): void {
    this.stopLoop();
    this.driver = driver;
    this.demo = demo;
    this.finished = false;
    this.defeatShown = false;
    this.watching = false;
    this.fortMode = false;
    this.shipMode = false;
    this.r.shipPreview = null;
    this.r.fortGhost = false;
    this.boardKey = '';
    this.diploOpen = false;
    this.diploKey = '';
    this.armed = '';
    this.voteKey = '';
    this.closePopovers();
    $('statCard').classList.remove('open', 'alert');
    $('diplo').classList.add('hidden');
    $('votePanel').classList.add('hidden');
    this.r.setSim(driver.sim, driver.me);
    this.r.dim = demo ? 0.5 : 0;
    this.lastMyCells = 0;
    $('hud').classList.toggle('hidden', demo);
    document.body.classList.toggle('playing', !demo);
    if (demo) this.r.fit(undefined, true);
    $('result').classList.add('hidden');
    $('pause').classList.add('hidden');
    if (!demo) {
      const me = driver.sim.players[driver.me];
      $('meName').textContent = me.name;
      ($('meDot') as HTMLElement).style.background = this.css(driver.me);
      $('btnPause').classList.toggle('hidden', driver.kind !== 'single');
      $('btnSpeed').classList.toggle('hidden', driver.kind !== 'single');
      const cap = me.capital;
      this.r.fit();
      this.r.camera.z = Math.max(this.r.camera.z, Math.min(this.r.viewW / 40, 16));
      this.r.fit(cap);
      this.r.clampCamera();
      ($('pct') as HTMLInputElement).value = String(this.pct);
      this.updatePctLabel();
      this.updateToggles();
    }
    this.bind();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    document.addEventListener('visibilitychange', this.onVis);
    this.onVis();
  }

  stopLoop(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.bgTimer);
    this.bgTimer = 0;
    document.removeEventListener('visibilitychange', this.onVis);
  }

  stop(): void {
    this.stopLoop();
    this.driver?.dispose();
    this.driver = null;
    $('hud').classList.add('hidden');
  }

  private onVis = (): void => {
    clearInterval(this.bgTimer);
    this.bgTimer = 0;
    if (document.hidden) {
      // Host/guest tetap harus melangkah saat tab di latar belakang.
      this.bgTimer = window.setInterval(() => this.advance(performance.now()), 250);
    }
  };

  private css(id: number): string {
    const c = PALETTE[id]?.rgb ?? [200, 200, 200];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // ------------------------------------------------------------------ loop
  private advance(now: number): void {
    const dt = Math.min(now - this.lastT, 20000);
    this.lastT = now;
    this.driver?.update(dt);
  }

  private frame(now: number): void {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const d = this.driver;
    if (!d) return;
    const dtMs = now - (this.lastFrame || now);
    this.lastFrame = now;
    this.advance(now);
    this.handleEvents(d.sim.drainEvents());
    if (this.demo) {
      this.driftT += dtMs;
      this.r.camera.x = d.sim.w / 2 + Math.sin(this.driftT / 9000) * d.sim.w * 0.07;
      this.r.camera.y = d.sim.h / 2 + Math.cos(this.driftT / 11000) * d.sim.h * 0.06;
      if (d.sim.winner && !this.restartTimer) {
        this.restartTimer = window.setTimeout(() => {
          this.restartTimer = 0;
          this.cb.onRematch();
        }, 5000);
      }
    } else {
      this.panKeys(dtMs);
      this.sounds(d);
      if (now - this.hudT > 100) {
        this.hudT = now;
        this.updateHud(d);
      }
      if (now - this.miniT > 250) {
        this.miniT = now;
        this.r.drawMinimap(this.mini);
      }
    }
    this.r.render(now);
  }
  private lastFrame = 0;
  private restartTimer = 0;

  private panKeys(dtMs: number): void {
    if (!this.keys.size) return;
    const sp = (dtMs / 1000) * (560 / this.r.camera.z);
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy += 1;
    if (dx || dy) {
      this.r.camera.x += dx * sp;
      this.r.camera.y += dy * sp;
      this.r.clampCamera();
    }
  }

  private sounds(d: Driver): void {
    const me = d.sim.players[d.me];
    if (!me) return;
    if (me.cells > this.lastMyCells && this.lastMyCells > 0) sfx.conquer();
    this.lastMyCells = me.cells;
  }

  // ------------------------------------------------------------------ event
  private feed(text: string, color?: string): void {
    const box = $('feed');
    const el = document.createElement('div');
    el.className = 'feed-item';
    if (color) el.style.borderLeftColor = color;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 5) box.firstElementChild?.remove();
    setTimeout(() => el.remove(), 7000);
  }

  private handleEvents(events: GameEvent[]): void {
    const d = this.driver;
    if (!d || this.demo) return;
    const sim = d.sim;
    const nm = (id: number): string => sim.players[id]?.name ?? '?';
    for (const e of events) {
      switch (e.k) {
        case 'toast':
          if (e.p === d.me) {
            toast(e.msg, 'warn');
            sfx.error();
          }
          break;
        case 'capital':
          this.feed(`${nm(e.by)} merebut ibu kota ${nm(e.victim)}!`, this.css(e.by));
          if (e.victim === d.me) {
            sfx.alarm();
            toast('Ibu kotamu jatuh! Pasukan dijarah.', 'warn');
          } else if (e.by === d.me) {
            sfx.capital();
            toast('Ibu kota musuh direbut!', 'good');
          }
          break;
        case 'fort-lost':
          this.feed(`${nm(e.by)} meruntuhkan benteng ${nm(e.victim)}`, this.css(e.by));
          break;
        case 'fort-built':
          if (e.owner === d.me) sfx.build();
          break;
        case 'landing':
          if (e.ok) {
            this.feed(`${nm(e.owner)} mendarat${e.target ? ' di wilayah ' + nm(e.target) : ''}`, this.css(e.owner));
            if (e.owner === d.me) {
              sfx.conquer();
              this.buzz(30);
              toast('Pendaratan berhasil — kepala pantai direbut', 'good');
            } else if (e.target === d.me) {
              sfx.alarm();
              this.buzz([60, 40, 60] as unknown as number);
              toast(`${nm(e.owner)} mendarat di wilayahmu!`, 'warn');
            }
          } else if (e.owner === d.me) sfx.error();
          break;
        case 'dead':
          this.feed(`${nm(e.victim)} tersingkir oleh ${nm(e.by)}`, this.css(e.victim));
          if (e.victim === d.me) this.onDefeat();
          break;
        case 'win':
          this.onWin(e.winner, e.reason);
          break;
        case 'war': {
          const text =
            e.why === 'independence'
              ? `${nm(e.by)} memproklamasikan kemerdekaan dari ${nm(e.target)}!`
              : e.why === 'join'
                ? `${nm(e.by)} ikut berperang melawan ${nm(e.target)}`
                : `${nm(e.by)} menyatakan perang pada ${nm(e.target)}!`;
          this.feed(text, this.css(e.by));
          if (e.target === d.me) {
            sfx.alarm();
            toast(`${nm(e.by)} menyerangmu — perang!`, 'warn');
          } else if (e.by === d.me) toast(`Perang dengan ${nm(e.target)} dimulai`, 'info');
          break;
        }
        case 'peace':
          this.feed(`${nm(e.a)} dan ${nm(e.b)} berdamai`, this.css(e.a));
          if (e.a === d.me || e.b === d.me) {
            sfx.ability();
            toast('Perdamaian tercapai — gencatan senjata 60 dtk', 'good');
          }
          break;
        case 'pact':
          this.feed(`${nm(e.a)} dan ${nm(e.b)} membentuk ${e.kind === 'alliance' ? 'aliansi' : 'pakta non agresi'}`, this.css(e.a));
          if (e.a === d.me || e.b === d.me) {
            sfx.ability();
            toast(e.kind === 'alliance' ? 'Aliansi terbentuk' : 'Pakta non agresi berlaku', 'good');
          }
          break;
        case 'pact-end': {
          const what = e.kind === 'alliance' ? 'Aliansi' : e.kind === 'vassal' ? 'Status boneka' : 'Pakta';
          this.feed(`${what} ${nm(e.a)} & ${nm(e.b)} berakhir`, this.css(e.a));
          if (e.a === d.me || e.b === d.me) toast(`${what} dengan ${nm(e.a === d.me ? e.b : e.a)} berakhir`, 'info');
          break;
        }
        case 'vassal':
          this.feed(e.surrender ? `${nm(e.vassal)} menyerah dan tunduk pada ${nm(e.lord)}` : `${nm(e.vassal)} menjadi negara boneka ${nm(e.lord)}`, this.css(e.lord));
          if (e.vassal === d.me) toast(`Kamu kini negara boneka ${nm(e.lord)} (upeti 25%)`, 'warn');
          else if (e.lord === d.me) toast(`${nm(e.vassal)} menjadi negara bonekamu`, 'good');
          break;
        case 'offer':
          if (e.to === d.me) {
            toast(`${nm(e.from)} ${this.offerText(e.kind, true)} — buka Diplomasi (T)`, 'info');
            sfx.click();
          }
          break;
        case 'declined':
          if (e.from === d.me) toast(`${nm(e.to)} menolak tawaranmu`, 'warn');
          break;
        case 'revolt':
          this.feed(`Pemberontakan! ${nm(e.rebel)} memisahkan diri dari ${nm(e.parent)}`, this.css(e.rebel));
          if (e.parent === d.me) {
            sfx.alarm();
            toast(`${e.cells} sel membelot menjadi negara ${nm(e.rebel)}!`, 'warn');
          }
          break;
        case 'abandon':
          if (e.owner === d.me) toast(`${e.cells} sel terputus ditinggalkan (jadi netral)`, 'warn');
          break;
        case 'vote-start':
          this.feed(`Voting kemenangan dibuka — ${nm(e.leader)} menguasai 60% daratan`, this.css(e.leader));
          sfx.alarm();
          break;
        case 'vote-end':
          this.feed(e.result === 'end' ? 'Voting: permainan diakhiri' : e.result === 'continue' ? 'Voting: permainan dilanjutkan' : 'Voting dibatalkan', '#ffd35c');
          break;
      }
    }
  }

  private onDefeat(): void {
    if (this.defeatShown || this.finished) return;
    this.defeatShown = true;
    sfx.lose();
    this.showResult(false);
  }

  private onWin(winner: number, reason: string): void {
    this.finished = true;
    const d = this.driver!;
    const won = d.sim.sameSide(d.me, winner, reason === 'bloc');
    if (won) sfx.win();
    else if (!this.defeatShown) sfx.lose();
    this.showResult(true, winner, reason);
  }

  private showResult(ended: boolean, winner = 0, reason = ''): void {
    const d = this.driver!;
    const sim = d.sim;
    const me = sim.players[d.me];
    const won = ended && sim.sameSide(d.me, winner, reason === 'bloc');
    $('resTitle').textContent = won ? 'Kemenangan!' : ended ? `${sim.players[winner]?.name ?? 'Tidak ada'} menang` : 'Kamu tersingkir';
    const why: Record<string, string> = {
      dominance: 'menguasai lebih dari 60% daratan',
      last: 'menjadi penguasa terakhir',
      bloc: 'menyatukan dunia lewat aliansi & negara boneka',
      time: 'unggul wilayah saat waktu habis',
    };
    $('resSub').textContent = ended
      ? `${won ? (winner === d.me ? 'Kamu' : 'Blokmu') : sim.players[winner]?.name ?? ''} menang dengan ${why[reason] ?? ''} dalam ${clock(sim.tick)}.`
      : `Wilayahmu habis di menit ${clock(sim.tick)}. Permainan masih berlanjut — kamu bisa terus menonton.`;
    const rows = sim
      .ranking()
      .map((p, i) => {
        const me2 = p.id === d.me ? ' class="me"' : '';
        return `<tr${me2}><td>${i + 1}</td><td><span class="dot" style="background:${this.css(p.id)}"></span>${esc(p.name)}</td><td>${p.cells}</td><td>${(p.peakCells / sim.landTotal * 100).toFixed(1)}%</td><td>${p.alive ? 'Bertahan' : 'Tersingkir'}</td></tr>`;
      })
      .join('');
    $('resTable').innerHTML = `<thead><tr><th></th><th>Pemain</th><th>Sel</th><th>Puncak</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    $('resWatch').classList.toggle('hidden', ended || !me);
    $('resAgain').classList.toggle('hidden', d.kind !== 'single');
    $('result').classList.remove('hidden');
  }

  // ------------------------------------------------------------------ HUD
  private updatePctLabel(): void {
    $('pctVal').textContent = this.pct + '%';
  }

  private updateToggles(): void {
    $('btnWide').classList.toggle('on', this.wide);
    $('btnFort').classList.toggle('on', this.fortMode);
    $('btnShip').classList.toggle('on', this.shipMode);
    this.r.fortGhost = this.fortMode;
    if (!this.shipMode) this.r.shipPreview = null;
  }

  private updateHud(d: Driver): void {
    const sim = d.sim;
    const me: Player | undefined = sim.players[d.me];
    if (!me) return;
    $('troops').textContent = fmt(me.troops);
    $('troopCap').textContent = fmt(me.cap);
    ($('troopBar') as HTMLElement).style.width = Math.min(100, (me.troops / Math.max(1, me.cap)) * 100) + '%';
    const shaken = sim.tick < me.shakenUntil;
    $('income').textContent = `+${me.income.toFixed(1)}/dtk${shaken ? ' (guncang)' : ''}`;
    $('territory').textContent = `${me.cells} sel · ${(sim.share(me) * 100).toFixed(1)}%`;
    $('clock').textContent = clock(sim.tick);
    const mor = $('morale');
    mor.textContent = Math.round(me.morale * 100) + '%';
    mor.classList.toggle('low', me.morale < 0.5);
    const lordLine = $('lordLine');
    const vassals = sim.players.filter((q) => q && q.alive && q.lord === me.id).length;
    if (me.lord) lordLine.textContent = `Negara boneka ${sim.players[me.lord]?.name ?? ''} · upeti 25%`;
    else if (vassals) lordLine.textContent = `Tuan atas ${vassals} negara boneka`;
    lordLine.classList.toggle('hidden', !me.lord && !vassals);

    // wilayah terputus
    let cut = 0;
    if (me.alive && sim.tick % 5 === 0) {
      let old = 0;
      for (let c = 0; c < sim.n; c++)
        if (sim.owner[c] === me.id && !sim.linked[c]) {
          cut++;
          if (sim.cutAge[c] > old) old = sim.cutAge[c];
        }
      this.cutCount = cut;
      this.cutOld = old;
    }
    const warn = $('cutWarn');
    $('statCard').classList.toggle('alert', me.alive && (me.capital < 0 || this.cutCount > 0));
    if (me.alive && me.capital < 0) {
      warn.textContent = 'Ibu kota runtuh — memindahkan pusat…';
      warn.classList.remove('hidden');
    } else if (me.alive && this.cutCount > 0) {
      warn.textContent = `${this.cutCount} sel terputus dari ibu kota — tanpa pendapatan, rapuh, bisa memberontak${this.cutOld >= 10 ? ` (${this.cutOld} dtk)` : ''}`;
      warn.classList.remove('hidden');
    } else warn.classList.add('hidden');

    // banner dominasi
    const ban = $('banner');
    if (sim.winner) ban.classList.add('hidden');
    else if (sim.domPlayer) {
      const left = Math.max(0, Math.ceil((CFG.domHold - (sim.tick - sim.domSince)) / TPS));
      const p = sim.players[sim.domPlayer];
      ban.textContent = sim.domPlayer === d.me ? `Pertahankan! Dominasi dalam ${left} dtk` : `${p.name} hampir menang — ${left} dtk lagi`;
      ban.classList.toggle('danger', sim.domPlayer !== d.me);
      ban.classList.remove('hidden');
    } else ban.classList.add('hidden');

    // skill
    this.skill($('btnBlitz'), sim.tick, me.blitzUntil, me.blitzReady, CFG.blitzCd);
    this.skill($('btnShield'), sim.tick, me.shieldUntil, me.shieldReady, CFG.shieldCd);
    const fc = sim.fortCost(me);
    const nf = sim.forts.filter((f) => f.owner === me.id).length;
    $('fortCost').textContent = nf >= CFG.fortMax ? 'maks' : String(fc);
    ($('btnFort') as HTMLButtonElement).disabled = !me.alive || nf >= CFG.fortMax || me.troops < fc;
    const myOffs = sim.offensives.filter((o) => o.owner === me.id);
    ($('btnRetreat') as HTMLButtonElement).disabled = !myOffs.length;
    const nShips = sim.ships.filter((x) => x.owner === me.id).length;
    $('shipCount').textContent = nShips ? `${nShips}/${CFG.maxShips}` : '';
    ($('btnShip') as HTMLButtonElement).disabled = !me.alive || nShips >= CFG.maxShips;
    ($('btnBlitz') as HTMLButtonElement).disabled = !me.alive || sim.tick < me.blitzReady;
    ($('btnShield') as HTMLButtonElement).disabled = !me.alive || sim.tick < me.shieldReady;
    $('dock').classList.toggle('hidden', !me.alive);
    $('fronts').innerHTML = myOffs
      .map((o) => `<span class="chip"><i class="dot" style="background:${o.target ? this.css(o.target) : '#8a8f87'}"></i>${o.target ? esc(sim.players[o.target].name) : 'Netral'} ${fmt(o.pool)}</span>`)
      .join('');

    // papan peringkat
    const full = sim.ranking();
    const maxShare = Math.max(0.15, sim.share(full[0]));
    const rank = full.filter((p) => p.alive).slice(0, 8);
    if (!rank.some((p) => p.id === d.me)) rank.push(me);
    const relTag = (p: Player): string => {
      if (p.id === d.me) return '';
      const k = sim.relKind(d.me, p.id);
      if (k === 'war') return '<em class="rel war">perang</em>';
      if (k === 'alliance') return '<em class="rel alliance">sekutu</em>';
      if (k === 'nap') return '<em class="rel nap">pakta</em>';
      if (k === 'vassal') return p.lord === d.me ? '<em class="rel vassal">boneka</em>' : '<em class="rel lord">tuan</em>';
      return '';
    };
    const key = rank.map((p) => p.id + ':' + p.cells + p.alive + relTag(p)).join('|') + d.me;
    if (key !== this.boardKey) {
      this.boardKey = key;
      $('board').innerHTML = rank
        .map((p) => {
          const sh = sim.share(p);
          return `<div class="row${p.id === d.me ? ' me' : ''}${p.alive ? '' : ' dead'}"><i class="dot" style="background:${this.css(p.id)}"></i><span class="nm">${esc(p.name)}${relTag(p)}</span><span class="bar"><i style="width:${(sh / maxShare) * 100}%;background:${this.css(p.id)}"></i></span><span class="pc">${(sh * 100).toFixed(0)}%</span></div>`;
        })
        .join('');
    }
    // lag
    const lag = $('lagBadge');
    lag.classList.toggle('hidden', !(d.kind === 'guest' && d.stall > 1500 && !sim.winner));
    $('btnPause').textContent = d.paused ? 'Lanjut' : 'Jeda';
    $('btnSpeed').textContent = d.speed + '×';
    $('btnMute').textContent = sfx.muted ? 'Suara mati' : 'Suara';
    this.updateDiplo(d);
    this.updateVote(d);
  }
  private cutCount = 0;

  // ------------------------------------------------------------------ diplomasi
  private offerText(kind: OfferKind, incoming: boolean): string {
    switch (kind) {
      case 'peace':
        return incoming ? 'menawarkan perdamaian' : 'perdamaian';
      case 'nap':
        return incoming ? 'menawarkan pakta non agresi' : 'pakta non agresi';
      case 'alliance':
        return incoming ? 'mengajak bersekutu' : 'aliansi';
      case 'vassal':
        return incoming ? 'menuntutmu menjadi negara bonekanya (upeti 25%)' : 'negara boneka';
    }
  }

  openDiplo(focus = 0): void {
    if (!this.canAct()) return;
    this.diploOpen = true;
    this.diploFocus = focus;
    this.diploKey = '';
    $('diplo').classList.remove('hidden');
    this.updateDiplo(this.driver!);
    if (focus) document.querySelector(`#diploList [data-n="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  closeDiplo(): void {
    this.diploOpen = false;
    this.armed = '';
    $('diplo').classList.add('hidden');
  }

  toggleDiplo(): void {
    if (this.diploOpen) this.closeDiplo();
    else this.openDiplo();
  }

  private updateDiplo(d: Driver): void {
    const sim = d.sim;
    const me = sim.players[d.me];
    const incoming = sim.offers.filter((o) => o.to === d.me);
    const badge = $('diploBadge');
    badge.textContent = incoming.length ? `(${incoming.length})` : '';
    $('btnDiplo').classList.toggle('alert', incoming.length > 0 && !this.diploOpen);
    ($('btnDiplo') as HTMLButtonElement).disabled = !me.alive;
    if (!this.diploOpen) return;
    if (!me.alive) return this.closeDiplo();

    const nm = (id: number): string => esc(sim.players[id]?.name ?? '?');
    const dot = (id: number): string => `<i class="dot" style="background:${this.css(id)}"></i>`;
    const offersHtml = incoming
      .map(
        (o) =>
          `<div class="offer"><div>${dot(o.from)} <b>${nm(o.from)}</b> ${this.offerText(o.kind, true)}</div><div class="nact"><button class="primary" data-a="accept" data-oid="${o.id}">Terima</button><button data-a="decline" data-oid="${o.id}">Tolak</button><span class="nmeta" data-until="${o.expires}"></span></div></div>`,
      )
      .join('');

    const label: Record<string, string> = { war: 'Perang', truce: 'Gencatan', nap: 'Pakta', alliance: 'Sekutu', vassal: 'Boneka', peace: 'Netral' };
    const weight = (id: number): number => (sim.atWar(d.me, id) ? 0 : sim.offers.some((o) => o.to === d.me && o.from === id) ? 1 : 2);
    const others = sim.players.filter((q) => q && q.alive && q.id !== d.me).sort((a, b) => weight(a.id) - weight(b.id) || b.cells - a.cells);
    const nations = others
      .map((n) => {
        const rk = sim.relKind(d.me, n.id);
        const rel = sim.getRel(d.me, n.id);
        const iAmLord = n.lord === d.me;
        const myLord = me.lord === n.id;
        let badgeTxt = label[rk];
        let badgeCls: string = rk;
        if (rk === 'vassal') badgeTxt = iAmLord ? 'Bonekamu' : 'Tuanmu';
        else if (n.lord) {
          badgeTxt = `Boneka ${sim.players[n.lord]?.name ?? ''}`;
          badgeCls = 'vassal';
        }
        const acts: string[] = [];
        const offerBtn = (k: OfferKind, text: string): void => {
          const err = sim.offerError(d.me, n.id, k);
          if (!err) acts.push(`<button data-a="offer" data-k="${k}" data-id="${n.id}">${text}</button>`);
          else if (err.startsWith('Tawaran masih') || err.startsWith('Baru saja')) acts.push(`<button disabled title="${esc(err)}">${text}</button>`);
        };
        const risky = (a: string, text: string): void => {
          const armed = this.armed === `${a}:${n.id}`;
          acts.push(`<button class="danger${armed ? ' armed' : ''}" data-a="${a}" data-id="${n.id}">${armed ? 'Yakin?' : text}</button>`);
        };
        const plain = (a: string, text: string): void => {
          acts.push(`<button data-a="${a}" data-id="${n.id}">${text}</button>`);
        };
        if (!me.lord) {
          if (rk === 'war') {
            offerBtn('peace', 'Tawarkan damai');
            risky('surrender', 'Menyerah');
            offerBtn('vassal', 'Jadikan boneka');
          } else if (rk === 'peace' || rk === 'truce' || rk === 'nap') {
            if (rk === 'peace' && sim.canDeclareWar(d.me, n.id) === '') risky('war', 'Nyatakan perang');
            if (rk !== 'nap') offerBtn('nap', 'Pakta non agresi');
            offerBtn('alliance', 'Ajak bersekutu');
            offerBtn('vassal', 'Jadikan boneka');
            if (rk === 'nap') plain('break', 'Akhiri pakta');
          } else if (rk === 'alliance') plain('break', 'Putus aliansi');
          else if (rk === 'vassal' && iAmLord) plain('break', 'Lepaskan');
        } else if (myLord) risky('war', 'Merdeka (perang)');
        const pending = sim.offers.filter((o) => o.from === d.me && o.to === n.id).map((o) => this.offerText(o.kind, false));
        const until = rel && rel.until ? ` · <span data-until="${rel.until}"></span>` : '';
        const meta = `Pasukan <span data-troops="${n.id}"></span> · Moral ${Math.round(n.morale * 100)}%${until}${pending.length ? ` · <span class="wait">Menunggu: ${pending.join(', ')}</span>` : ''}`;
        return `<div class="nation${this.diploFocus === n.id ? ' focus' : ''}" data-n="${n.id}"><div class="nhead">${dot(n.id)}<b>${nm(n.id)}</b><span class="pc">${(sim.share(n) * 100).toFixed(0)}%</span><span class="badge ${badgeCls}">${badgeTxt}</span></div><div class="nmeta">${meta}</div>${acts.length ? `<div class="nact">${acts.join('')}</div>` : ''}</div>`;
      })
      .join('');
    const note = me.lord ? `<div class="empty">Kamu negara boneka — ikut berperang bersama tuanmu. Hanya "Merdeka" yang bisa kamu lakukan.</div>` : '';
    const html = offersHtml + '\u0001' + (nations || '<div class="empty">Tidak ada negara lain.</div>') + note;
    if (html !== this.diploKey) {
      this.diploKey = html;
      const [a, b] = html.split('\u0001');
      $('diploOffers').innerHTML = a;
      $('diploList').innerHTML = b;
    }
    document.querySelectorAll<HTMLElement>('#diplo [data-troops]').forEach((el) => (el.textContent = fmt(sim.players[Number(el.dataset.troops)]?.troops ?? 0)));
    document.querySelectorAll<HTMLElement>('#diplo [data-until]').forEach((el) => (el.textContent = Math.max(0, Math.ceil((Number(el.dataset.until) - sim.tick) / TPS)) + ' dtk'));
  }

  private onDiploClick(e: MouseEvent): void {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
    const d = this.driver;
    if (!b || b.disabled || !d || !this.canAct()) return;
    const a = b.dataset.a!;
    const id = Number(b.dataset.id);
    if (a === 'war' || a === 'surrender') {
      const key = `${a}:${id}`;
      if (this.armed !== key) {
        // Klik pertama hanya "mengunci"; klik kedua (dalam 3 dtk) mengeksekusi.
        this.armed = key;
        this.diploKey = '';
        window.clearTimeout(this.armTimer);
        this.armTimer = window.setTimeout(() => {
          this.armed = '';
          this.diploKey = '';
        }, 3000);
        sfx.click();
        return;
      }
      this.armed = '';
      this.diploKey = '';
    }
    sfx.click();
    switch (a) {
      case 'war':
        this.act({ t: 'war', p: d.me, target: id });
        break;
      case 'surrender':
        this.act({ t: 'surrender', p: d.me, target: id });
        break;
      case 'break':
        this.act({ t: 'break', p: d.me, target: id });
        break;
      case 'offer':
        this.act({ t: 'offer', p: d.me, target: id, kind: b.dataset.k as OfferKind });
        break;
      case 'accept':
      case 'decline':
        this.act({ t: 'reply', p: d.me, id: Number(b.dataset.oid), accept: a === 'accept' });
        break;
    }
  }

  // ------------------------------------------------------------------ voting kemenangan
  private doVote(end: boolean): void {
    const d = this.driver;
    if (!d || this.demo || !d.sim.vote) return;
    const me = d.sim.players[d.me];
    if (!me || !me.alive || me.kind !== 'human') return;
    sfx.click();
    this.act({ t: 'vote', p: d.me, end });
  }

  private updateVote(d: Driver): void {
    const sim = d.sim;
    const v = sim.vote;
    const el = $('votePanel');
    if (!v || sim.winner) {
      el.classList.add('hidden');
      this.voteKey = '';
      return;
    }
    const me = sim.players[d.me];
    const voters = sim.voters();
    const isVoter = !!me && me.alive && me.kind === 'human';
    const isLeader = v.leader === d.me;
    const mine = v.ballots[d.me];
    const leader = sim.players[v.leader];
    const others = voters.filter((x) => x.id !== v.leader).length;
    const key = `${v.leader}|${isVoter}|${mine}|${voters.length}`;
    if (key !== this.voteKey) {
      this.voteKey = key;
      const who = isLeader ? 'Kamu menguasai' : `<b>${esc(leader.name)}</b> menguasai`;
      let body: string;
      if (!isVoter) body = '<p>Menunggu pemain memutuskan…</p>';
      else if (isLeader)
        body = `<p>Akhiri permainan dengan kemenanganmu, atau terus berjuang?${others ? ' Kemenangan juga butuh persetujuan mayoritas pemain lain.' : ' Bot tidak ikut memilih — keputusan di tanganmu.'}</p><div class="vrow"><button data-v="1" class="${mine === true ? 'on' : ''}">Menang sekarang</button><button data-v="0" class="${mine === false ? 'on' : ''}">Lanjut bermain</button></div>`;
      else
        body = `<p>Menyerah dan biarkan ${esc(leader.name)} menang, atau lanjut melawan?${leader.kind === 'human' ? ' (Pemimpin juga harus memilih menang.)' : ' Bot tidak ikut memilih.'}</p><div class="vrow"><button data-v="1" class="${mine === true ? 'on' : ''}">Menyerah — biarkan menang</button><button data-v="0" class="${mine === false ? 'on' : ''}">Lanjut melawan</button></div>`;
      el.innerHTML = `<h4>Voting kemenangan</h4><p style="margin-bottom:6px">${who} <b id="voteShare"></b> daratan.</p>${body}<div class="vmeta">Suara masuk <span id="voteDone"></span> · sisa <span id="voteLeft"></span></div>`;
    }
    $('voteShare').textContent = Math.round((sim.blocCells(v.leader) / sim.landTotal) * 100) + '%';
    $('voteDone').textContent = `${voters.filter((x) => x.id in v.ballots).length}/${voters.length}`;
    $('voteLeft').textContent = Math.max(0, Math.ceil((v.endsAt - sim.tick) / TPS)) + ' dtk';
    el.classList.remove('hidden');
  }

  private skill(btn: HTMLElement, tick: number, until: number, ready: number, cd: number): void {
    const active = tick < until;
    btn.classList.toggle('active', active);
    const f = tick < ready ? Math.min(1, (ready - tick) / cd) : 0;
    btn.style.setProperty('--cd', String(active ? 0 : f));
  }

  // ------------------------------------------------------------------ perintah
  private canAct(): boolean {
    const d = this.driver;
    if (!d || this.demo || d.sim.winner) return false;
    const me = d.sim.players[d.me];
    return !!me && me.alive;
  }

  private act(c: Parameters<Driver['submit']>[0]): void {
    this.driver!.submit(c);
  }

  doBlitz(): void {
    if (!this.canAct()) return;
    const me = this.driver!.sim.players[this.driver!.me];
    if (this.driver!.sim.tick < me.blitzReady) return toast('Blitz masih pendinginan', 'warn');
    sfx.ability();
    this.act({ t: 'blitz', p: this.driver!.me });
  }

  doShield(): void {
    if (!this.canAct()) return;
    const me = this.driver!.sim.players[this.driver!.me];
    if (this.driver!.sim.tick < me.shieldReady) return toast('Perisai masih pendinginan', 'warn');
    sfx.shield();
    this.act({ t: 'shield', p: this.driver!.me });
  }

  doRetreat(): void {
    if (!this.canAct()) return;
    sfx.click();
    this.act({ t: 'retreat', p: this.driver!.me });
    toast('Pasukan ditarik mundur', 'info');
  }

  toggleShip(): void {
    if (!this.canAct()) return;
    this.shipMode = !this.shipMode;
    if (this.shipMode) this.fortMode = false;
    this.updateToggles();
    if (this.shipMode) toast(`Ketuk pantai tujuan di seberang laut (maks ${this.driver!.sim.map.shipRange} sel dari pesisirmu)`, 'info');
  }

  /** Pratinjau rute kapal saat mouse melayang di atas sel (mode Kapal). */
  private updateShipPreview(cell: number): void {
    const d = this.driver;
    if (!this.shipMode || !d || cell < 0) {
      this.r.shipPreview = null;
      return;
    }
    const me = d.sim.players[d.me];
    const plan = me && !d.sim.shipError(me, cell) ? d.sim.shipPlan(d.me, cell) : null;
    this.r.shipPreview = { src: plan ? plan.src : -1, dst: cell, ok: !!plan };
  }

  private launchShip(cell: number): void {
    const d = this.driver!;
    const sim = d.sim;
    const ow = sim.owner[cell];
    if (ow && !sim.atWar(d.me, ow)) {
      sfx.error();
      toast(`Belum berperang dengan ${sim.players[ow].name} — nyatakan perang dulu`, 'warn');
      this.openDiplo(ow);
      return;
    }
    const err = sim.shipError(sim.players[d.me], cell);
    if (err) {
      sfx.error();
      toast(err, 'warn');
      return;
    }
    this.shipMode = false;
    this.updateToggles();
    this.act({ t: 'ship', p: d.me, idx: cell, pct: this.pct });
    sfx.send();
    this.buzz(18);
    this.r.pulse(cell, this.css(d.me));
    toast('Armada berlayar…', 'info');
  }

  /** Getar singkat di perangkat sentuh (bila didukung). */
  private buzz(ms: number): void {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* abaikan */
    }
  }

  toggleFort(): void {
    if (!this.canAct()) return;
    this.shipMode = false;
    this.fortMode = !this.fortMode;
    this.updateToggles();
    if (this.fortMode) toast('Ketuk sel wilayahmu untuk benteng (tekan Benteng lagi untuk batal)', 'info');
  }

  private clickCell(cell: number, shift: boolean): void {
    const d = this.driver;
    if (!d || !this.canAct() || cell < 0) return;
    const sim = d.sim;
    if (this.fortMode) {
      this.fortMode = false;
      this.updateToggles();
      if (sim.owner[cell] !== d.me) return toast('Benteng hanya di wilayahmu', 'warn');
      if (sim.feat[cell] !== 0) return toast('Sel ini sudah terpakai', 'warn');
      this.act({ t: 'fort', p: d.me, idx: cell });
      this.r.pulse(cell, '#ffd35c');
      return;
    }
    if (sim.terrain[cell] === T_WATER) return toast('Itu laut — tidak bisa diserang', 'warn');
    if (sim.owner[cell] === d.me) return;
    // Daratan lain yang belum kita pijak (atau mode Kapal aktif): berlayar, bukan merambah lewat darat.
    if (this.shipMode || !sim.ownsLandmass(d.me, sim.landComp[cell])) return this.launchShip(cell);
    const ow = sim.owner[cell];
    if (ow && !sim.atWar(d.me, ow) && sim.frontier(d.me, ow, cell, false, 1) > 0) {
      sfx.error();
      toast(`Belum berperang dengan ${sim.players[ow].name} — nyatakan perang dulu`, 'warn');
      this.openDiplo(ow);
      return;
    }
    this.act({ t: 'atk', p: d.me, idx: cell, pct: this.pct, wide: this.wide || shift });
    sfx.send();
    this.buzz(8);
    this.r.pulse(cell, this.css(d.me));
  }

  // ------------------------------------------------------------------ input
  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    const cv = this.r.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      sfx.unlock();
      cv.setPointerCapture(e.pointerId);
      this.closePopovers();
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, button: e.button, moved: false });
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (!this.demo) {
          this.r.hover = this.r.screenToCell(e.offsetX, e.offsetY);
          this.updateShipPreview(this.r.hover);
        }
        return;
      }
      const dx = e.offsetX - p.x;
      const dy = e.offsetY - p.y;
      p.x = e.offsetX;
      p.y = e.offsetY;
      if (this.pointers.size === 2) {
        const dist = this.pinchDist();
        const mid = this.pinchMid();
        if (this.pinch > 0 && dist > 0) this.r.zoomAt(mid.x, mid.y, dist / this.pinch);
        // geser peta mengikuti titik tengah kedua jari
        if (this.pinchMidPrev) {
          this.r.camera.x -= (mid.x - this.pinchMidPrev.x) / this.r.camera.z;
          this.r.camera.y -= (mid.y - this.pinchMidPrev.y) / this.r.camera.z;
          this.r.clampCamera();
        }
        this.pinchMidPrev = mid;
        this.pinch = dist;
        p.moved = true;
        return;
      }
      // Jari butuh ambang geser lebih besar daripada mouse agar ketukan tidak dianggap seretan.
      if (!p.moved && Math.hypot(e.offsetX - p.sx, e.offsetY - p.sy) > (e.pointerType === 'mouse' ? 6 : 11)) p.moved = true;
      if (p.moved) {
        this.r.camera.x -= dx / this.r.camera.z;
        this.r.camera.y -= dy / this.r.camera.z;
        this.r.clampCamera();
      }
      if (e.pointerType === 'mouse') {
        this.r.hover = this.r.screenToCell(e.offsetX, e.offsetY);
        this.updateShipPreview(this.r.hover);
      }
    });
    const up = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) {
        this.pinch = 0;
        this.pinchMidPrev = null;
      }
      if (p && !p.moved && p.button === 0 && !this.demo) this.clickCell(this.r.screenToCell(e.offsetX, e.offsetY), e.shiftKey);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
      this.pinchMidPrev = null;
    });
    cv.addEventListener('pointerleave', () => {
      if (!this.pointers.size) this.r.hover = -1;
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        if (this.demo) return;
        e.preventDefault();
        this.r.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.18 : 1 / 1.18);
      },
      { passive: false },
    );
    window.addEventListener('resize', () => {
      this.r.resize();
      this.r.clampCamera();
    });
    window.addEventListener('orientationchange', () => setTimeout(() => this.r.resize(), 250));
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());

    $('pct').addEventListener('input', (e) => {
      this.pct = Number((e.target as HTMLInputElement).value);
      this.updatePctLabel();
    });
    $('btnWide').addEventListener('click', () => {
      this.wide = !this.wide;
      this.updateToggles();
    });
    $('btnFort').addEventListener('click', () => this.toggleFort());
    $('btnShip').addEventListener('click', () => this.toggleShip());
    const fs = $('btnFull');
    if (!document.documentElement.requestFullscreen) fs.remove();
    else
      fs.addEventListener('click', () => {
        this.closePopovers();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      });
    $('btnBlitz').addEventListener('click', () => this.doBlitz());
    $('btnShield').addEventListener('click', () => this.doShield());
    $('btnRetreat').addEventListener('click', () => this.doRetreat());
    $('btnDiplo').addEventListener('click', () => this.toggleDiplo());
    $('diploClose').addEventListener('click', () => this.closeDiplo());
    $('diplo').addEventListener('click', (e) => this.onDiploClick(e));
    $('votePanel').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-v]');
      if (b) this.doVote(b.dataset.v === '1');
    });
    $('btnHome').addEventListener('click', () => this.goHome());
    // HUD ringkas (HP): ⋯ = menu sistem, Skor = papan peringkat, Peta = minimap, kartu = detail, ▾ = ciutkan dock
    const side = $('side');
    $('btnMore').addEventListener('click', () => {
      side.classList.toggle('menu');
      side.classList.remove('board');
    });
    $('btnBoard').addEventListener('click', () => {
      side.classList.toggle('board');
      side.classList.remove('menu');
    });
    $('btnMini').addEventListener('click', () => $('mini').classList.toggle('show'));
    $('sysBtns').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) side.classList.remove('menu');
    });
    $('statCard').addEventListener('click', () => $('statCard').classList.toggle('open'));
    $('dockToggle').addEventListener('click', () => {
      const min = $('dock').classList.toggle('min');
      $('dockToggle').textContent = min ? '▴' : '▾';
    });
    $('btnMute').addEventListener('click', () => {
      sfx.setMuted(!sfx.muted);
      sfx.click();
    });
    $('btnPause').addEventListener('click', () => this.togglePause());
    $('btnSpeed').addEventListener('click', () => {
      const d = this.driver;
      if (d) d.speed = d.speed >= 3 ? 1 : d.speed + 1;
    });
    $('btnMenu').addEventListener('click', () => this.openPause());
    $('pauseResume').addEventListener('click', () => this.closePause());
    $('pauseExit').addEventListener('click', () => this.cb.onExit());
    $('resMenu').addEventListener('click', () => this.cb.onExit());
    $('resAgain').addEventListener('click', () => this.cb.onRematch());
    $('resWatch').addEventListener('click', () => {
      this.watching = true;
      $('result').classList.add('hidden');
    });
    this.mini.addEventListener('pointerdown', (e) => this.miniMove(e));
    this.mini.addEventListener('pointermove', (e) => {
      if (e.buttons) this.miniMove(e);
    });
  }

  private closePopovers(): void {
    $('side').classList.remove('menu', 'board');
  }

  private miniMove(e: PointerEvent): void {
    const d = this.driver;
    if (!d) return;
    const rect = this.mini.getBoundingClientRect();
    this.r.camera.x = ((e.clientX - rect.left) / rect.width) * d.sim.w;
    this.r.camera.y = ((e.clientY - rect.top) / rect.height) * d.sim.h;
    this.r.clampCamera();
  }

  private pinchDist(): number {
    const pts = [...this.pointers.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private pinchMid(): { x: number; y: number } {
    const pts = [...this.pointers.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  goHome(): void {
    const d = this.driver;
    if (!d) return;
    const me = d.sim.players[d.me];
    if (me && me.capital >= 0) this.r.fit(me.capital);
    else this.r.fit();
  }

  togglePause(): void {
    const d = this.driver;
    if (!d || d.kind !== 'single') return;
    d.paused = !d.paused;
  }

  openPause(): void {
    if (this.driver?.kind === 'single') this.driver.paused = true;
    $('pause').classList.remove('hidden');
  }

  closePause(): void {
    if (this.driver?.kind === 'single') this.driver.paused = false;
    $('pause').classList.add('hidden');
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.demo || !this.driver) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down || e.repeat || e.ctrlKey || e.metaKey) return;
    if (k >= '0' && k <= '9') {
      this.pct = k === '0' ? 100 : Number(k) * 10;
      ($('pct') as HTMLInputElement).value = String(this.pct);
      this.updatePctLabel();
    } else if (k === 'q') this.doBlitz();
    else if (k === 'e') this.doShield();
    else if (k === 'b') this.toggleFort();
    else if (k === 'v') this.toggleShip();
    else if (k === 'x') this.doRetreat();
    else if (k === 't') this.toggleDiplo();
    else if (k === 'f') this.goHome();
    else if (k === 'm') sfx.setMuted(!sfx.muted);
    else if (k === ' ') {
      e.preventDefault();
      this.togglePause();
    } else if (k === '+' || k === '=') this.r.zoomAt(this.r.viewW / 2, this.r.viewH / 2, 1.2);
    else if (k === '-') this.r.zoomAt(this.r.viewW / 2, this.r.viewH / 2, 1 / 1.2);
    else if (k === 'escape') {
      if (this.diploOpen) this.closeDiplo();
      else if (this.fortMode || this.shipMode) {
        this.fortMode = false;
        this.shipMode = false;
        this.updateToggles();
      } else if ($('pause').classList.contains('hidden')) this.openPause();
      else this.closePause();
    }
  }
}

