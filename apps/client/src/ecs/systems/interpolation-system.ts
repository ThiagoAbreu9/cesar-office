/**
 * Posição desenhada das entidades remotas = amostra do buffer em (serverNow − atraso). 04 §3.
 */
import { query } from 'bitecs';
import { NET } from '@cesar-office/protocol';
import { AvatarState, RemotePlayer, RenderPosition } from '../components.ts';
import type { WorldState } from '../world-state.ts';
import type { ServerClock } from '../../net/server-clock.ts';

export class InterpolationSystem {
  /** Entidades que teleportaram neste frame — o render faz fade. */
  readonly teleported = new Set<number>();

  constructor(
    private readonly state: WorldState,
    private readonly clock: ServerClock,
  ) {}

  update(): void {
    this.teleported.clear();
    const renderTime = this.clock.serverNow() - NET.INTERPOLATION_DELAY_MS;
    for (const eid of query(this.state.ecs, [RemotePlayer, RenderPosition])) {
      const buf = this.state.bufferOf(eid);
      if (!buf) continue;
      if (buf.consumeTeleport()) this.teleported.add(eid);
      const s = buf.sample(renderTime);
      if (!s) continue;
      RenderPosition.x[eid] = s.x;
      RenderPosition.y[eid] = s.y;
      AvatarState.packed[eid] = s.state;
    }
  }
}
