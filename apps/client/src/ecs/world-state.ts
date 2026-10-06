/**
 * Estado do mundo no cliente: mundo ECS + registro netId ↔ entidade + metadados lentos.
 * Independente de Phaser: a sessão de rede escreve aqui mesmo antes da cena existir.
 */
import { addComponent, addEntity, createWorld, removeEntity, type World } from 'bitecs';
import type { AvatarLook, EntityInfo, PresenceStatus } from '@cesar-office/protocol';
import { AvatarState, LocalPlayer, NetIdentity, Position, RemotePlayer, RenderPosition } from './components.ts';
import { SnapshotBuffer } from '../net/interpolation.ts';

export interface EntityMeta {
  readonly userId: string;
  displayName: string;
  status: PresenceStatus;
  readonly look: AvatarLook;
}

export type EntityId = number;

export class WorldState {
  readonly ecs: World = createWorld();
  private readonly byNetId = new Map<number, EntityId>();
  private readonly meta = new Map<EntityId, EntityMeta>();
  private readonly buffers = new Map<EntityId, SnapshotBuffer>();
  private local: EntityId | null = null;
  /** Entidades criadas/removidas desde o último drain — o RenderSystem consome. */
  private readonly spawned = new Set<EntityId>();
  private readonly despawned = new Set<EntityId>();

  get localEntity(): EntityId | null {
    return this.local;
  }

  entityOf(netId: number): EntityId | undefined {
    return this.byNetId.get(netId);
  }

  metaOf(eid: EntityId): EntityMeta | undefined {
    return this.meta.get(eid);
  }

  bufferOf(eid: EntityId): SnapshotBuffer | undefined {
    return this.buffers.get(eid);
  }

  spawnLocal(info: EntityInfo): EntityId {
    const eid = this.spawn(info);
    addComponent(this.ecs, eid, LocalPlayer);
    this.local = eid;
    return eid;
  }

  /** Cria (ou reaproveita se já existe) uma entidade remota. Amostra inicial em `serverTime`. */
  spawnRemote(info: EntityInfo, serverTime: number): EntityId {
    const existing = this.byNetId.get(info.netId);
    if (existing !== undefined) {
      this.updateMeta(existing, info.displayName, info.status);
      this.buffers.get(existing)?.push({ t: serverTime, x: info.x, y: info.y, state: info.state });
      return existing;
    }
    const eid = this.spawn(info);
    addComponent(this.ecs, eid, RemotePlayer);
    const buf = new SnapshotBuffer();
    buf.push({ t: serverTime, x: info.x, y: info.y, state: info.state });
    this.buffers.set(eid, buf);
    return eid;
  }

  despawn(netId: number): void {
    const eid = this.byNetId.get(netId);
    if (eid === undefined) return;
    this.byNetId.delete(netId);
    this.meta.delete(eid);
    this.buffers.delete(eid);
    if (this.local === eid) this.local = null;
    this.spawned.delete(eid);
    this.despawned.add(eid);
    removeEntity(this.ecs, eid);
  }

  /** Remove todos os remotos (usado no resume, que traz a AOI completa). */
  despawnAllRemotes(): void {
    for (const [netId, eid] of [...this.byNetId]) if (eid !== this.local) this.despawn(netId);
  }

  updateMeta(eid: EntityId, displayName?: string, status?: PresenceStatus): void {
    const m = this.meta.get(eid);
    if (!m) return;
    if (displayName !== undefined) m.displayName = displayName;
    if (status !== undefined) m.status = status;
  }

  drainSpawned(): EntityId[] {
    const out = [...this.spawned];
    this.spawned.clear();
    return out;
  }

  drainDespawned(): EntityId[] {
    const out = [...this.despawned];
    this.despawned.clear();
    return out;
  }

  dispose(): void {
    for (const netId of [...this.byNetId.keys()]) this.despawn(netId);
  }

  private spawn(info: EntityInfo): EntityId {
    const eid = addEntity(this.ecs);
    addComponent(this.ecs, eid, Position);
    addComponent(this.ecs, eid, RenderPosition);
    addComponent(this.ecs, eid, AvatarState);
    addComponent(this.ecs, eid, NetIdentity);
    Position.x[eid] = info.x;
    Position.y[eid] = info.y;
    RenderPosition.x[eid] = info.x;
    RenderPosition.y[eid] = info.y;
    AvatarState.packed[eid] = info.state;
    NetIdentity.netId[eid] = info.netId;
    this.byNetId.set(info.netId, eid);
    this.meta.set(eid, { userId: info.userId, displayName: info.displayName, status: info.status, look: info.look });
    this.despawned.delete(eid);
    this.spawned.add(eid);
    return eid;
  }
}
