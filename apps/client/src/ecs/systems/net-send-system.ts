/**
 * Envio de input do avatar local: a cada INPUT_SEND_MS em movimento, mais um envio final ao parar
 * ou ao mudar estado (sentar). Parado e sem mudança: nada (02 §12).
 */
import { NET, nextSeq, unpackState } from '@cesar-office/protocol';
import { AvatarState, Position } from '../components.ts';
import type { WorldState } from '../world-state.ts';
import type { Connection } from '../../net/connection.ts';

export class NetSendSystem {
  private seq = 0;
  private lastSentAt = -Infinity;
  private lastX = -1;
  private lastY = -1;
  private lastPacked = -1;

  constructor(
    private readonly state: WorldState,
    private readonly connection: Connection,
    private readonly now: () => number,
  ) {}

  update(): void {
    const eid = this.state.localEntity;
    if (eid === null) return;
    const x = Math.round(Position.x[eid] ?? 0);
    const y = Math.round(Position.y[eid] ?? 0);
    const packed = AvatarState.packed[eid] ?? 0;

    const changed = x !== this.lastX || y !== this.lastY || packed !== this.lastPacked;
    if (!changed) return;

    const s = unpackState(packed);
    const due = this.now() - this.lastSentAt >= NET.INPUT_SEND_MS;
    const prev = this.lastPacked >= 0 ? unpackState(this.lastPacked) : undefined;
    // Transições (parou, sentou, levantou) saem na hora; o resto respeita o intervalo.
    const transition = prev !== undefined && (prev.moving !== s.moving || prev.sitting !== s.sitting);
    if (!due && !transition) return;

    this.seq = nextSeq(this.seq);
    const sent = this.connection.sendInput({ seq: this.seq, x, y, state: s });
    if (!sent) return; // offline ou backpressure: tenta no próximo frame com a posição mais nova
    this.lastSentAt = this.now();
    this.lastX = x;
    this.lastY = y;
    this.lastPacked = packed;
  }

  /** Após resume/welcome o servidor tem outra base: força reenvio. */
  reset(): void {
    this.lastX = -1;
    this.lastY = -1;
    this.lastPacked = -1;
    this.lastSentAt = -Infinity;
  }
}
