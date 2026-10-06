import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HmacTicketCodec, type TicketClaims } from './index.ts';

const claims: TicketClaims = {
  userId: randomUUID(),
  orgId: randomUUID(),
  spaceId: randomUUID(),
  instanceId: 'i_abc_sede',
  mapId: 'sede',
  role: 'member',
  displayName: 'Ana',
  look: { body: 1, hair: 2, outfit: 3 },
  status: 'available',
  lastPosition: { x: 100, y: 200 },
};
const SECRET = 'k'.repeat(40);

test('assina e verifica; claims voltam iguais', async () => {
  const c = new HmacTicketCodec({ secret: SECRET });
  assert.deepEqual(await c.verify(c.sign(claims)), claims);
});

test('uso único: segundo verify do mesmo ticket falha', async () => {
  const c = new HmacTicketCodec({ secret: SECRET });
  const t = c.sign(claims);
  assert.ok(await c.verify(t));
  assert.equal(await c.verify(t), null);
});

test('assinatura de outro segredo, payload adulterado e expirado falham', async () => {
  const api = new HmacTicketCodec({ secret: 'x'.repeat(40) });
  const rt = new HmacTicketCodec({ secret: SECRET });
  assert.equal(await rt.verify(api.sign(claims)), null);

  const t = rt.sign(claims);
  const [h, b, s] = t.split('.') as [string, string, string];
  const forged = JSON.parse(Buffer.from(b, 'base64url').toString()) as Record<string, unknown>;
  forged['rol'] = 'owner';
  assert.equal(await rt.verify(`${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`), null);

  let now = 1_000_000;
  const clocked = new HmacTicketCodec({ secret: SECRET, now: () => now });
  const old = clocked.sign(claims);
  now += 31_000;
  assert.equal(await clocked.verify(old), null);
});

test('segredo curto é recusado na construção', () => {
  assert.throws(() => new HmacTicketCodec({ secret: 'curto' }));
});
