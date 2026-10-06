/**
 * Estimativa do relógio do servidor (04 §3) e conversão de tick u16 → tempo.
 * Puro e determinístico: o relógio local é injetado.
 */
import { NET } from '@cesar-office/protocol';

export type Now = () => number;

export class ServerClock {
  private offset = 0;
  private hasSample = false;
  private readonly rtts: number[] = [];

  constructor(
    private readonly now: Now,
    private readonly alpha = 0.1,
    private readonly window = 10,
  ) {}

  /** Inicializa com o serverTime do welcome (offset grosseiro antes do 1º pong). */
  seed(serverTime: number): void {
    this.offset = serverTime - this.now();
    this.hasSample = false;
  }

  /** c = horário local de envio do ping; s = horário do servidor no pong. */
  onPong(c: number, s: number): void {
    const recv = this.now();
    const rtt = recv - c;
    if (rtt < 0) return;
    const median = this.medianRtt();
    this.rtts.push(rtt);
    if (this.rtts.length > this.window) this.rtts.shift();
    if (median !== undefined && rtt > median * 2) return; // amostra com fila: ignora
    const sample = s - (c + recv) / 2;
    this.offset = this.hasSample ? this.offset + this.alpha * (sample - this.offset) : sample;
    this.hasSample = true;
  }

  serverNow(): number {
    return this.now() + this.offset;
  }

  rtt(): number | undefined {
    return this.medianRtt();
  }

  private medianRtt(): number | undefined {
    if (this.rtts.length === 0) return undefined;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/** Desdobra ticks u16 (wrap a cada 6.553,6 s) em tempo do servidor. */
export class TickTimeline {
  private baseTick = 0;
  private baseTime = 0;
  private lastAbs = 0;
  private started = false;

  reset(tick: number, serverTime: number): void {
    this.baseTick = tick;
    this.baseTime = serverTime;
    this.lastAbs = tick;
    this.started = true;
  }

  /** Converte um tick u16 recebido em tempo do servidor (ms). */
  timeOf(tick16: number): number {
    if (!this.started) throw new Error('TickTimeline não inicializada');
    const lastLow = this.lastAbs & 0xffff;
    let delta = (tick16 - lastLow) & 0xffff;
    if (delta >= 0x8000) delta -= 0x10000; // tick atrasado (fora de ordem)
    const abs = this.lastAbs + delta;
    if (abs > this.lastAbs) this.lastAbs = abs;
    return this.baseTime + (abs - this.baseTick) * NET.TICK_MS;
  }
}
