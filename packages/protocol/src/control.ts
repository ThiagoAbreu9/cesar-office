/**
 * Mensagens de controle (baixa frequência), JSON dentro de frame com opcode Op.Control.
 *
 * - Cliente → servidor: validadas com zod no servidor (nunca confie no cliente).
 * - Servidor → cliente: tipos estáticos; o cliente faz validação leve no decode.
 */
import { z } from 'zod';
import { Op, PROTOCOL_VERSION, WORLD } from './constants.ts';

// ───────────────────────────── Tipos de domínio no fio ─────────────────────────────

export const PresenceStatus = z.enum(['available', 'in_meeting', 'away', 'dnd']);
export type PresenceStatus = z.infer<typeof PresenceStatus>;

export type ChatChannel = 'here' | 'global';

export interface AvatarLook {
  readonly body: number;
  readonly hair: number;
  readonly outfit: number;
}

/** Dados "lentos" de uma entidade: enviados ao entrar na AOI e quando mudam. */
export interface EntityInfo {
  readonly netId: number;
  readonly userId: string;
  readonly displayName: string;
  readonly look: AvatarLook;
  readonly status: PresenceStatus;
  readonly x: number;
  readonly y: number;
  /** Byte de estado empacotado (ver binary.ts packState). */
  readonly state: number;
}

export interface AudiblePeer {
  readonly userId: string;
  /** 0..1, fator de volume calculado pelo servidor (P-06). Zona privada = 1. */
  readonly volume: number;
}

// ───────────────────────────── Cliente → servidor ─────────────────────────────

const uuid = z.string().uuid();
const objectKey = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/);

export const ClientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), v: z.literal(PROTOCOL_VERSION), ticket: z.string().min(16).max(2048) }),
  z.object({
    t: z.literal('resume'),
    v: z.literal(PROTOCOL_VERSION),
    resumeToken: z.string().min(16).max(512),
    lastTick: z.number().int().min(0).max(0xffff),
  }),
  z.object({ t: z.literal('ping'), c: z.number().finite() }),
  z.object({ t: z.literal('set_status'), status: PresenceStatus }),
  z.object({
    t: z.literal('chat_send'),
    channel: z.enum(['here', 'global']),
    clientMsgId: uuid,
    body: z.string().trim().min(1).max(WORLD.CHAT_MAX_CHARS),
  }),
  z.object({ t: z.literal('interact'), objectKey }),
  z.object({ t: z.literal('claim_desk'), deskKey: objectKey }),
  z.object({ t: z.literal('go_to'), targetUserId: uuid }),
  z.object({ t: z.literal('call'), targetUserId: uuid }),
  z.object({ t: z.literal('call_response'), callId: uuid, accept: z.boolean() }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;
export type ClientMsgType = ClientMsg['t'];

// ───────────────────────────── Servidor → cliente ─────────────────────────────

export type CorrectionReason = 'speed' | 'collision' | 'zone_full' | 'zone_forbidden' | 'teleport';

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'version_mismatch'
  | 'rate_limited'
  | 'not_found'
  | 'forbidden'
  | 'internal';

export type ServerMsg =
  | {
      readonly t: 'welcome';
      readonly netId: number;
      readonly userId: string;
      readonly instanceId: string;
      readonly resumeToken: string;
      readonly serverTime: number;
      readonly tick: number;
      readonly map: { readonly mapId: string; readonly version: number; readonly url: string };
      readonly self: { readonly x: number; readonly y: number };
      readonly entities: readonly EntityInfo[];
    }
  /** O resumeToken é rotacionado a cada resume (uso único). */
  | { readonly t: 'resumed'; readonly tick: number; readonly entities: readonly EntityInfo[]; readonly resumeToken: string }
  | { readonly t: 'resume_rejected'; readonly reason: 'expired' | 'unknown' | 'instance_gone' }
  | { readonly t: 'pong'; readonly c: number; readonly s: number }
  | { readonly t: 'entity_enter'; readonly entity: EntityInfo }
  | { readonly t: 'entity_leave'; readonly netIds: readonly number[] }
  | { readonly t: 'entity_meta'; readonly netId: number; readonly displayName?: string; readonly status?: PresenceStatus }
  /** Roster da org: enviado para cada pessoa online ao entrar (estado inicial) e a cada mudança. */
  | { readonly t: 'presence'; readonly userId: string; readonly status: PresenceStatus | 'offline'; readonly displayName?: string }
  | { readonly t: 'correction'; readonly seq: number; readonly x: number; readonly y: number; readonly reason: CorrectionReason }
  | { readonly t: 'zone'; readonly zoneKey: string | null; readonly name?: string; readonly occupancy?: number; readonly capacity?: number }
  | { readonly t: 'audible'; readonly peers: readonly AudiblePeer[]; readonly bubbleId: string | null }
  | {
      readonly t: 'media_join';
      readonly url: string;
      readonly room: string;
      readonly token: string;
      readonly mode: 'open' | 'zone';
    }
  | { readonly t: 'media_leave'; readonly room: string }
  | { readonly t: 'chat_ack'; readonly clientMsgId: string; readonly id: string; readonly at: number }
  | {
      readonly t: 'chat';
      readonly id: string;
      readonly channel: ChatChannel;
      readonly fromUserId: string;
      readonly fromName: string;
      readonly body: string;
      readonly at: number;
    }
  | { readonly t: 'call_received'; readonly callId: string; readonly fromUserId: string; readonly fromName: string; readonly expiresAt: number }
  | { readonly t: 'call_result'; readonly callId: string; readonly accepted: boolean }
  | { readonly t: 'error'; readonly code: ErrorCode; readonly message: string; readonly ref?: ClientMsgType }
  | { readonly t: 'kicked'; readonly reason: 'removed_from_org' | 'replaced_by_new_tab' | 'abuse' | 'shutdown' };

export type ServerMsgType = ServerMsg['t'];
export type ServerMsgOf<T extends ServerMsgType> = Extract<ServerMsg, { t: T }>;

// ───────────────────────────── Framing ─────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeControl(msg: ClientMsg | ServerMsg): Uint8Array {
  const json = encoder.encode(JSON.stringify(msg));
  const out = new Uint8Array(json.byteLength + 1);
  out[0] = Op.Control;
  out.set(json, 1);
  return out;
}

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function readJson(buf: Uint8Array): ParseResult<unknown> {
  if (buf[0] !== Op.Control) return { ok: false, error: 'opcode não é Control' };
  try {
    return { ok: true, value: JSON.parse(decoder.decode(buf.subarray(1))) as unknown };
  } catch {
    return { ok: false, error: 'JSON inválido' };
  }
}

/** Uso no servidor: valida tamanho, JSON e esquema. */
export function parseClientControl(buf: Uint8Array, maxBytes: number): ParseResult<ClientMsg> {
  if (buf.byteLength > maxBytes) return { ok: false, error: 'frame grande demais' };
  const raw = readJson(buf);
  if (!raw.ok) return raw;
  const parsed = ClientMsg.safeParse(raw.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? 'inválido' };
}

/** Uso no cliente: confia no servidor quanto ao esquema, mas exige o discriminante. */
export function parseServerControl(buf: Uint8Array): ParseResult<ServerMsg> {
  const raw = readJson(buf);
  if (!raw.ok) return raw;
  const v = raw.value;
  if (typeof v === 'object' && v !== null && 't' in v && typeof v.t === 'string') {
    return { ok: true, value: v as ServerMsg };
  }
  return { ok: false, error: 'mensagem sem discriminante' };
}
