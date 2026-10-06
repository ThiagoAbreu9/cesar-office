import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  ENTITY_UPDATE_BYTES,
  Facing,
  INPUT_FRAME_BYTES,
  nextSeq,
  seqNewer,
  SNAPSHOT_HEADER_BYTES,
} from './binary.ts';
import { encodeControl, parseClientControl } from './control.ts';
import { NET, PROTOCOL_VERSION } from './constants.ts';

const idle = { facing: Facing.Left, moving: false, sitting: true, ghost: false } as const;

test('input: ida e volta preserva campos e tem 8 bytes', () => {
  const frame = { seq: 65535, x: 1024, y: 2048, state: idle };
  const buf = encodeInput(frame);
  assert.equal(buf.byteLength, INPUT_FRAME_BYTES);
  assert.deepEqual(decodeInput(buf), frame);
});

test('snapshot: tamanho = 7 + 7n e ida e volta', () => {
  const entities = [
    { netId: 1, x: 10, y: 20, state: idle },
    { netId: 300, x: 65535, y: 0, state: { facing: Facing.Up, moving: true, sitting: false, ghost: true } },
  ];
  const buf = encodeSnapshot({ tick: 42, ackSeq: 7, entities });
  assert.equal(buf.byteLength, SNAPSHOT_HEADER_BYTES + 2 * ENTITY_UPDATE_BYTES);
  assert.deepEqual(decodeSnapshot(buf), { tick: 42, ackSeq: 7, entities });
});

test('snapshot truncado é rejeitado', () => {
  const buf = encodeSnapshot({ tick: 1, ackSeq: 1, entities: [{ netId: 1, x: 1, y: 1, state: idle }] });
  assert.throws(() => decodeSnapshot(buf.subarray(0, buf.byteLength - 1)));
});

test('coordenada fora de u16 é rejeitada no encode', () => {
  assert.throws(() => encodeInput({ seq: 0, x: 70000, y: 0, state: idle }));
});

test('seq com wraparound', () => {
  assert.equal(nextSeq(65535), 0);
  assert.equal(seqNewer(0, 65535), true);
  assert.equal(seqNewer(65535, 0), false);
  assert.equal(seqNewer(5, 5), false);
});

test('controle: chat válido passa, corpo vazio e tipo desconhecido falham', () => {
  const ok = parseClientControl(
    encodeControl({ t: 'chat_send', channel: 'here', clientMsgId: '6f1c2c4e-8a43-4b5e-9a6f-0c2b1e9f4a11', body: 'oi' }),
    NET.MAX_CLIENT_FRAME_BYTES,
  );
  assert.equal(ok.ok, true);

  const empty = parseClientControl(
    encodeControl({ t: 'chat_send', channel: 'here', clientMsgId: '6f1c2c4e-8a43-4b5e-9a6f-0c2b1e9f4a11', body: '   ' }),
    NET.MAX_CLIENT_FRAME_BYTES,
  );
  assert.equal(empty.ok, false);

  const bogus = new TextEncoder().encode(JSON.stringify({ t: 'teleport', x: 1 }));
  const frame = new Uint8Array(bogus.byteLength + 1);
  frame[0] = 0x10;
  frame.set(bogus, 1);
  assert.equal(parseClientControl(frame, NET.MAX_CLIENT_FRAME_BYTES).ok, false);
});

test('controle: versão errada no hello falha', () => {
  const buf = encodeControl({ t: 'hello', v: PROTOCOL_VERSION, ticket: 'x'.repeat(32) });
  assert.equal(parseClientControl(buf, NET.MAX_CLIENT_FRAME_BYTES).ok, true);
  const wrong = new TextEncoder().encode(JSON.stringify({ t: 'hello', v: 999, ticket: 'x'.repeat(32) }));
  const f = new Uint8Array(wrong.byteLength + 1);
  f[0] = 0x10;
  f.set(wrong, 1);
  assert.equal(parseClientControl(f, NET.MAX_CLIENT_FRAME_BYTES).ok, false);
});

test('controle: frame acima do limite falha antes do parse', () => {
  const big = encodeControl({ t: 'chat_send', channel: 'global', clientMsgId: '6f1c2c4e-8a43-4b5e-9a6f-0c2b1e9f4a11', body: 'a'.repeat(2000) });
  assert.equal(parseClientControl(big, 1024).ok, false);
});
