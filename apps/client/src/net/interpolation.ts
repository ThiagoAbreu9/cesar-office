/**
 * Buffer de interpolação de uma entidade remota (04 §3).
 * Amostras em tempo do servidor; o render consulta em (serverNow − INTERPOLATION_DELAY_MS).
 */
export interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly state: number;
}

export interface Sampled {
  readonly x: number;
  readonly y: number;
  readonly state: number;
}

export interface InterpolationOptions {
  /** Extrapolação máxima além da última amostra (ms). */
  readonly maxExtrapolateMs: number;
  /** Amostras mais velhas que renderTime − retainMs são descartadas. */
  readonly retainMs: number;
  /** Salto acima disto (px) é teleporte: limpa histórico. */
  readonly teleportPx: number;
  readonly capacity: number;
}

export const DEFAULT_INTERPOLATION: InterpolationOptions = {
  maxExtrapolateMs: 100,
  retainMs: 1000,
  teleportPx: 4 * 32,
  capacity: 32,
};

export class SnapshotBuffer {
  private samples: Sample[] = [];
  private teleported = false;

  constructor(private readonly opts: InterpolationOptions = DEFAULT_INTERPOLATION) {}

  push(s: Sample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) {
      // Fora de ordem: insere ordenado (raro com TCP, possível após resume).
      const idx = this.samples.findIndex((x) => x.t >= s.t);
      if (idx >= 0 && this.samples[idx]?.t === s.t) return;
      this.samples.splice(idx < 0 ? this.samples.length : idx, 0, s);
      return;
    }
    if (last && Math.hypot(s.x - last.x, s.y - last.y) > this.opts.teleportPx) {
      this.samples = [];
      this.teleported = true;
    }
    this.samples.push(s);
    if (this.samples.length > this.opts.capacity) this.samples.shift();
  }

  /** true uma única vez após um teleporte — o render usa para fazer fade. */
  consumeTeleport(): boolean {
    const t = this.teleported;
    this.teleported = false;
    return t;
  }

  sample(renderTime: number): Sampled | undefined {
    const s = this.samples;
    const n = s.length;
    if (n === 0) return undefined;

    // Descarta histórico antigo, mantendo ao menos 2 amostras.
    while (s.length > 2 && (s[1]?.t ?? Infinity) < renderTime - this.opts.retainMs) s.shift();

    const first = s[0];
    const last = s[s.length - 1];
    if (!first || !last) return undefined;
    if (renderTime <= first.t) return first;

    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (!a || !b) continue;
      if (a.t <= renderTime && renderTime <= b.t) {
        const span = b.t - a.t;
        const k = span > 0 ? (renderTime - a.t) / span : 1;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, state: k < 0.5 ? a.state : b.state };
      }
    }

    const ahead = renderTime - last.t;
    const prev = s[s.length - 2];
    if (prev && ahead <= this.opts.maxExtrapolateMs && last.t > prev.t) {
      const dt = last.t - prev.t;
      return {
        x: last.x + ((last.x - prev.x) / dt) * ahead,
        y: last.y + ((last.y - prev.y) / dt) * ahead,
        state: last.state,
      };
    }
    return last;
  }

  clear(): void {
    this.samples = [];
  }

  get length(): number {
    return this.samples.length;
  }
}
