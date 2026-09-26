// Pendule d'échecs avec incrément de Fischer (cadence « minutes + secondes »).
import { opposite } from './engine.js';

export const TIME_CONTROLS = {
  none: null,
  '1+0': { base: 60e3, inc: 0 },
  '3+2': { base: 180e3, inc: 2e3 },
  '5+0': { base: 300e3, inc: 0 },
  '10+0': { base: 600e3, inc: 0 },
  '15+10': { base: 900e3, inc: 10e3 },
};

export class Clock {
  // `onFlag(color)` : temps écoulé ; `onTick()` : à chaque rafraîchissement.
  constructor(control, { onFlag = () => {}, onTick = () => {}, now = () => performance.now() } = {}) {
    this.base = control.base;
    this.inc = control.inc;
    this.onFlag = onFlag;
    this.onTick = onTick;
    this.now = now;
    this.remaining = { w: control.base, b: control.base };
    this.running = null;
    this.startedAt = 0;
    this.timer = null;
  }

  time(color) {
    const t = this.remaining[color] - (this.running === color ? this.now() - this.startedAt : 0);
    return Math.max(0, t);
  }

  start(color) {
    this.stop();
    if (this.remaining[color] <= 0) return;
    this.running = color;
    this.startedAt = this.now();
    this.timer = setInterval(() => this.check(), 100);
  }

  stop() {
    if (this.running) {
      this.remaining[this.running] = this.time(this.running);
      this.running = null;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  // Coup joué par `color` : sa pendule s'arrête, gagne l'incrément, l'adverse démarre.
  press(color) {
    if (this.running === color) this.stop();
    this.remaining[color] += this.inc;
    this.start(opposite(color));
  }

  // Resynchronisation (partie en ligne, reprise d'une sauvegarde).
  set({ w, b }) {
    const running = this.running;
    this.stop();
    if (Number.isFinite(w)) this.remaining.w = Math.max(0, w);
    if (Number.isFinite(b)) this.remaining.b = Math.max(0, b);
    if (running) this.start(running);
  }

  snapshot() {
    return { w: this.time('w'), b: this.time('b') };
  }

  check() {
    this.onTick();
    const color = this.running;
    if (color && this.time(color) <= 0) {
      this.stop();
      this.remaining[color] = 0;
      this.onFlag(color);
    }
  }
}

// « 4:59 », puis « 9.8 » sous les 10 secondes.
export function formatTime(ms) {
  if (ms < 10e3) return (Math.floor(ms / 100) / 10).toFixed(1);
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
