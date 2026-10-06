/**
 * Portas da camada de aplicação (02 §3). Implementações em `infrastructure/`.
 * Trocar LiveKit, Redis ou Postgres = nova implementação destas interfaces; nada acima muda.
 */
import type { AvatarLook, PresenceStatus, ServerMsgOf } from '@cesar-office/protocol';
import type { WorldMap } from '@cesar-office/world';

/** Conteúdo do ticket emitido pela API em POST /spaces/:id/join (02 §4.1). */
export interface TicketClaims {
  readonly userId: string;
  readonly orgId: string;
  readonly spaceId: string;
  readonly instanceId: string;
  readonly mapId: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly displayName: string;
  readonly look: AvatarLook;
  readonly status: PresenceStatus;
  readonly lastPosition?: { readonly x: number; readonly y: number };
}

export interface TicketVerifier {
  /** Valida assinatura e expiração e CONSOME o nonce (uso único). null = inválido. */
  verify(ticket: string): Promise<TicketClaims | null>;
}

export interface LoadedMap {
  readonly map: WorldMap;
  readonly version: number;
  /** URL pública do JSON Tiled para o cliente. */
  readonly url: string;
}

export interface MapRepository {
  load(mapId: string): Promise<LoadedMap>;
}

/** Mídia somente áudio (ADR-0008). */
export interface MediaGateway {
  readonly enabled: boolean;
  /** Token de entrada numa sala, com publicação restrita ao microfone. */
  join(room: string, userId: string, displayName: string, mode: 'open' | 'zone'): Promise<ServerMsgOf<'media_join'>>;
  /** Remoção ativa pelo servidor — garante isolamento de sala privada (RN-M3-5). */
  remove(room: string, userId: string): Promise<void>;
}

export interface ChatRecord {
  readonly id: string;
  readonly orgId: string;
  readonly channel: string;
  readonly senderId: string;
  readonly body: string;
  readonly clientMsgId: string;
  readonly at: number;
}

export interface ChatStore {
  /** Idempotência (04 §7). Retorna o registro já aceito para este (sender, clientMsgId), se houver. */
  claim(senderId: string, clientMsgId: string, candidate: ChatRecord): Promise<ChatRecord | null>;
  /** Persistência de global e zona (bolha aberta nunca chega aqui — ADR-0007). */
  persist(record: ChatRecord): Promise<void>;
}

/** Barramento por organização entre nós realtime (Redis pub/sub em produção). */
export interface OrgBus {
  publishPresence(orgId: string, userId: string, status: PresenceStatus | 'offline'): void;
  publishChat(orgId: string, msg: ServerMsgOf<'chat'>): void;
  subscribe(orgId: string, handlers: OrgBusHandlers): () => void;
}

export interface OrgBusHandlers {
  presence(userId: string, status: PresenceStatus | 'offline'): void;
  chat(msg: ServerMsgOf<'chat'>): void;
}

export interface DeskRepository {
  /** false = mesa já tem outro dono. */
  claim(orgId: string, mapId: string, deskKey: string, userId: string): Promise<boolean>;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  /** UUID v7 (ordenável por tempo). */
  uuid(): string;
  /** Token opaco aleatório (resume). */
  token(): string;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}
