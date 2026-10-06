/**
 * Codec binário das mensagens de alta frequência (Input e Snapshot).
 * Little-endian. Coordenadas em pixels inteiros (u16 → mapas de até 2048 tiles de 32 px).
 *
 * Input   (cliente → servidor), 8 bytes:
 *   u8 op | u16 seq | u16 x | u16 y | u8 state
 *
 * Snapshot (servidor → cliente), 7 + 7·n bytes:
 *   u8 op | u16 tick | u16 ackSeq | u16 count | count × ( u16 netId | u16 x | u16 y | u8 state )
 */
import { Op } from './constants.ts';

export const Facing = { Down: 0, Left: 1, Right: 2, Up: 3 } as const;
export type Facing = (typeof Facing)[keyof typeof Facing];

/** Estado compacto de um avatar: 1 byte. */
export interface AvatarState {
  readonly facing: Facing;
  readonly moving: boolean;
  readonly sitting: boolean;
  readonly ghost: boolean;
}

export interface InputFrame {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly state: AvatarState;
}

export interface EntityUpdate {
  readonly netId: number;
  readonly x: number;
  readonly y: number;
  readonly state: AvatarState;
}

export interface SnapshotFrame {
  readonly tick: number;
  /** Último seq de input do destinatário que o servidor aplicou (para reconciliação). */
  readonly ackSeq: number;
  readonly entities: readonly EntityUpdate[];
}

export const INPUT_FRAME_BYTES = 8;
export const SNAPSHOT_HEADER_BYTES = 7;
export const ENTITY_UPDATE_BYTES = 7;
const U16_MAX = 0xffff;

export class CodecError extends Error {
  override readonly name = 'CodecError';
}

export function packState(s: AvatarState): number {
  return (s.facing & 0b11) | (s.moving ? 1 << 2 : 0) | (s.sitting ? 1 << 3 : 0) | (s.ghost ? 1 << 4 : 0);
}

export function unpackState(b: number): AvatarState {
  return {
    facing: (b & 0b11) as Facing,
    moving: (b & (1 << 2)) !== 0,
    sitting: (b & (1 << 3)) !== 0,
    ghost: (b & (1 << 4)) !== 0,
  };
}

function assertU16(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > U16_MAX) {
    throw new CodecError(`${name} fora de u16: ${v}`);
  }
}

/** Comparação de sequência com wraparound de u16 (RFC 1982). true se `a` é mais novo que `b`. */
export function seqNewer(a: number, b: number): boolean {
  const diff = (a - b) & U16_MAX;
  return diff !== 0 && diff < 0x8000;
}

export function nextSeq(seq: number): number {
  return (seq + 1) & U16_MAX;
}

export function encodeInput(f: InputFrame): Uint8Array {
  assertU16('seq', f.seq);
  assertU16('x', f.x);
  assertU16('y', f.y);
  const buf = new Uint8Array(INPUT_FRAME_BYTES);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, Op.Input);
  dv.setUint16(1, f.seq, true);
  dv.setUint16(3, f.x, true);
  dv.setUint16(5, f.y, true);
  dv.setUint8(7, packState(f.state));
  return buf;
}

export function decodeInput(buf: Uint8Array): InputFrame {
  if (buf.byteLength !== INPUT_FRAME_BYTES) throw new CodecError('Input com tamanho inválido');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint8(0) !== Op.Input) throw new CodecError('Opcode não é Input');
  return {
    seq: dv.getUint16(1, true),
    x: dv.getUint16(3, true),
    y: dv.getUint16(5, true),
    state: unpackState(dv.getUint8(7)),
  };
}

/**
 * Escreve um snapshot num buffer reutilizável (evita alocação por cliente por tick no servidor).
 * Retorna uma view com o tamanho exato escrito.
 */
export function encodeSnapshotInto(target: Uint8Array, f: SnapshotFrame): Uint8Array {
  const needed = SNAPSHOT_HEADER_BYTES + f.entities.length * ENTITY_UPDATE_BYTES;
  if (target.byteLength < needed) throw new CodecError(`buffer pequeno: ${target.byteLength} < ${needed}`);
  assertU16('tick', f.tick);
  assertU16('ackSeq', f.ackSeq);
  assertU16('count', f.entities.length);
  const dv = new DataView(target.buffer, target.byteOffset, needed);
  dv.setUint8(0, Op.Snapshot);
  dv.setUint16(1, f.tick, true);
  dv.setUint16(3, f.ackSeq, true);
  dv.setUint16(5, f.entities.length, true);
  let o = SNAPSHOT_HEADER_BYTES;
  for (const e of f.entities) {
    assertU16('netId', e.netId);
    assertU16('x', e.x);
    assertU16('y', e.y);
    dv.setUint16(o, e.netId, true);
    dv.setUint16(o + 2, e.x, true);
    dv.setUint16(o + 4, e.y, true);
    dv.setUint8(o + 6, packState(e.state));
    o += ENTITY_UPDATE_BYTES;
  }
  return target.subarray(0, needed);
}

export function encodeSnapshot(f: SnapshotFrame): Uint8Array {
  return encodeSnapshotInto(new Uint8Array(SNAPSHOT_HEADER_BYTES + f.entities.length * ENTITY_UPDATE_BYTES), f);
}

export function decodeSnapshot(buf: Uint8Array): SnapshotFrame {
  if (buf.byteLength < SNAPSHOT_HEADER_BYTES) throw new CodecError('Snapshot truncado');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint8(0) !== Op.Snapshot) throw new CodecError('Opcode não é Snapshot');
  const count = dv.getUint16(5, true);
  if (buf.byteLength !== SNAPSHOT_HEADER_BYTES + count * ENTITY_UPDATE_BYTES) {
    throw new CodecError('Snapshot com tamanho inconsistente');
  }
  const entities: EntityUpdate[] = new Array<EntityUpdate>(count);
  let o = SNAPSHOT_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    entities[i] = {
      netId: dv.getUint16(o, true),
      x: dv.getUint16(o + 2, true),
      y: dv.getUint16(o + 4, true),
      state: unpackState(dv.getUint8(o + 6)),
    };
    o += ENTITY_UPDATE_BYTES;
  }
  return { tick: dv.getUint16(1, true), ackSeq: dv.getUint16(3, true), entities };
}

/** Lê o opcode sem decodificar o frame. */
export function peekOp(buf: Uint8Array): number | undefined {
  return buf.byteLength > 0 ? buf[0] : undefined;
}
