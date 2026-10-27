// Efek suara sintetis (WebAudio) — tanpa file aset.
let ctx: AudioContext | null = null;
let muted = false;
let lastConquer = 0;

try {
  muted = localStorage.getItem('panz-muted') === '1';
} catch {
  /* abaikan */
}

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  get muted(): boolean {
    return muted;
  },
  setMuted(m: boolean): void {
    muted = m;
    try {
      localStorage.setItem('panz-muted', m ? '1' : '0');
    } catch {
      /* abaikan */
    }
  },
  unlock(): void {
    ac();
  },
  click(): void {
    tone(520, 0.09, 'triangle', 0.08, 780);
  },
  send(): void {
    tone(220, 0.16, 'sawtooth', 0.05, 440);
    tone(330, 0.12, 'triangle', 0.06, 660, 0.04);
  },
  conquer(): void {
    const now = performance.now();
    if (now - lastConquer < 140) return;
    lastConquer = now;
    tone(300 + Math.random() * 120, 0.06, 'square', 0.02);
  },
  ability(): void {
    tone(180, 0.35, 'sawtooth', 0.07, 720);
  },
  shield(): void {
    tone(660, 0.3, 'sine', 0.08, 330);
    tone(990, 0.25, 'sine', 0.05, 495, 0.05);
  },
  build(): void {
    tone(140, 0.12, 'square', 0.07);
    tone(110, 0.16, 'square', 0.07, undefined, 0.1);
  },
  alarm(): void {
    tone(440, 0.15, 'square', 0.06);
    tone(330, 0.2, 'square', 0.06, undefined, 0.16);
  },
  capital(): void {
    tone(392, 0.2, 'triangle', 0.1);
    tone(523, 0.2, 'triangle', 0.1, undefined, 0.15);
    tone(659, 0.35, 'triangle', 0.1, undefined, 0.3);
  },
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, undefined, i * 0.14));
  },
  lose(): void {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.07, undefined, i * 0.18));
  },
  error(): void {
    tone(160, 0.12, 'square', 0.05);
  },
};
