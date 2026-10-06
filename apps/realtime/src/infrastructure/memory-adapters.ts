/**
 * Adaptadores em memória para um nó único (MVP/dev/testes).
 * Em produção com vários nós: OrgBus → Redis pub/sub; ChatStore → Redis SET NX + Postgres;
 * DeskRepository → Postgres (`desk_assignments`). As portas não mudam.
 */
import type { ServerMsgOf } from '@cesar-office/protocol';
import type { ChatRecord, ChatStore, DeskRepository, OrgBus, OrgBusHandlers } from '../application/ports.ts';

export class InMemoryOrgBus implements OrgBus {
  private readonly subs = new Map<string, Set<OrgBusHandlers>>();

  publishPresence(orgId: string, userId: string, status: Parameters<OrgBusHandlers['presence']>[1]): void {
    for (const h of this.subs.get(orgId) ?? []) h.presence(userId, status);
  }

  publishChat(orgId: string, msg: ServerMsgOf<'chat'>): void {
    for (const h of this.subs.get(orgId) ?? []) h.chat(msg);
  }

  subscribe(orgId: string, handlers: OrgBusHandlers): () => void {
    let set = this.subs.get(orgId);
    if (!set) {
      set = new Set();
      this.subs.set(orgId, set);
    }
    set.add(handlers);
    return () => {
      set.delete(handlers);
      if (set.size === 0) this.subs.delete(orgId);
    };
  }
}

export class InMemoryChatStore implements ChatStore {
  private readonly dedupe = new Map<string, { record: ChatRecord; expiresAt: number }>();
  readonly persisted: ChatRecord[] = [];

  constructor(private readonly ttlMs = 24 * 3_600_000, private readonly maxPersisted = 10_000) {}

  async claim(senderId: string, clientMsgId: string, candidate: ChatRecord): Promise<ChatRecord | null> {
    const key = `${senderId}:${clientMsgId}`;
    const hit = this.dedupe.get(key);
    if (hit && hit.expiresAt > candidate.at) return hit.record;
    if (this.dedupe.size > 50_000) for (const [k, v] of this.dedupe) if (v.expiresAt <= candidate.at) this.dedupe.delete(k);
    this.dedupe.set(key, { record: candidate, expiresAt: candidate.at + this.ttlMs });
    return null;
  }

  async persist(record: ChatRecord): Promise<void> {
    this.persisted.push(record);
    if (this.persisted.length > this.maxPersisted) this.persisted.shift();
  }
}

export class InMemoryDeskRepository implements DeskRepository {
  private readonly owners = new Map<string, string>();

  async claim(orgId: string, mapId: string, deskKey: string, userId: string): Promise<boolean> {
    const key = `${orgId}:${mapId}:${deskKey}`;
    const owner = this.owners.get(key);
    if (owner && owner !== userId) return false;
    // RN-M7-2: uma mesa por pessoa por mapa.
    for (const [k, u] of this.owners) if (u === userId && k.startsWith(`${orgId}:${mapId}:`)) this.owners.delete(k);
    this.owners.set(key, userId);
    return true;
  }
}
