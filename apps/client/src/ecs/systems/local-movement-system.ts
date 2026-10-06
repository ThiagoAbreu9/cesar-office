/**
 * Predição do avatar local em passo fixo (04 §4). Aplica correções do servidor com suavização.
 */
import { hasComponent } from 'bitecs';
import { Facing, packState, unpackState, WORLD } from '@cesar-office/protocol';
import { AvatarState, Correction, Position, RenderPosition } from '../components.ts';
import type { WorldState } from '../world-state.ts';
import type { CollisionGrid } from '@cesar-office/world';
import type { CompositeIntent } from './movement-intent.ts';

/** Caixa dos pés (px) — menor que o tile para passar em portas de 1 tile. */
const FEET_HALF_W = 10;
const FEET_HALF_H = 6;
const CORRECTION_MS = 100;
const SNAP_DISTANCE_PX = 2 * WORLD.TILE_PX;

export class LocalMovementSystem {
  constructor(
    private readonly state: WorldState,
    private readonly grid: CollisionGrid,
    private readonly intent: CompositeIntent,
    private readonly now: () => number,
  ) {}

  /** Recebe correção do servidor (handler de rede). */
  applyCorrection(x: number, y: number): void {
    const eid = this.state.localEntity;
    if (eid === null) return;
    const px = Position.x[eid] ?? x;
    const py = Position.y[eid] ?? y;
    this.intent.path.cancel();
    if (Math.hypot(px - x, py - y) >= SNAP_DISTANCE_PX) {
      Position.x[eid] = x;
      Position.y[eid] = y;
      Correction.startedAt[eid] = 0;
      return;
    }
    Correction.fromX[eid] = px;
    Correction.fromY[eid] = py;
    Correction.toX[eid] = x;
    Correction.toY[eid] = y;
    Correction.startedAt[eid] = this.now();
  }

  /** Teleporte autorizado (welcome, resume, "Ir até" com fade). */
  teleport(x: number, y: number): void {
    const eid = this.state.localEntity;
    if (eid === null) return;
    this.intent.path.cancel();
    Position.x[eid] = x;
    Position.y[eid] = y;
    RenderPosition.x[eid] = x;
    RenderPosition.y[eid] = y;
    Correction.startedAt[eid] = 0;
  }

  /** Um passo fixo de simulação. dtMs tipicamente 1000/60. */
  step(dtMs: number): void {
    const eid = this.state.localEntity;
    if (eid === null || !hasComponent(this.state.ecs, eid, Position)) return;

    let x = Position.x[eid] ?? 0;
    let y = Position.y[eid] ?? 0;
    const prev = unpackState(AvatarState.packed[eid] ?? 0);

    const startedAt = Correction.startedAt[eid] ?? 0;
    if (startedAt > 0) {
      const k = Math.min(1, (this.now() - startedAt) / CORRECTION_MS);
      x = (Correction.fromX[eid] ?? x) + ((Correction.toX[eid] ?? x) - (Correction.fromX[eid] ?? x)) * k;
      y = (Correction.fromY[eid] ?? y) + ((Correction.toY[eid] ?? y) - (Correction.fromY[eid] ?? y)) * k;
      if (k >= 1) Correction.startedAt[eid] = 0;
      this.write(eid, x, y, { ...prev, moving: false });
      return;
    }

    this.intent.path.track(x, y);
    const { dx, dy } = this.intent.read();
    const moving = dx !== 0 || dy !== 0;
    if (!moving) {
      this.write(eid, x, y, { ...prev, moving: false });
      return;
    }

    const len = Math.hypot(dx, dy);
    const step = (WORLD.WALK_SPEED_PX_S * dtMs) / 1000;
    const nx = x + (dx / len) * step;
    const ny = y + (dy / len) * step;
    // Eixos separados: desliza ao longo de paredes em vez de travar.
    if (this.grid.isBoxFree(nx, y, FEET_HALF_W, FEET_HALF_H)) x = nx;
    if (this.grid.isBoxFree(x, ny, FEET_HALF_W, FEET_HALF_H)) y = ny;

    const facing: Facing =
      Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Facing.Left : Facing.Right) : dy < 0 ? Facing.Up : Facing.Down;
    this.write(eid, x, y, { facing, moving: true, sitting: false, ghost: false });
  }

  private write(eid: number, x: number, y: number, s: ReturnType<typeof unpackState>): void {
    // Coordenadas do protocolo são inteiras e ≥ 0.
    const cx = Math.max(0, x);
    const cy = Math.max(0, y);
    Position.x[eid] = cx;
    Position.y[eid] = cy;
    RenderPosition.x[eid] = cx;
    RenderPosition.y[eid] = cy;
    AvatarState.packed[eid] = packState(s);
  }
}
