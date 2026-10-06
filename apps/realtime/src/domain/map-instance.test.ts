import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Facing, type InputFrame, type ServerMsg, type SnapshotFrame } from '@cesar-office/protocol';
import { loadWorldMap, type PrivateZone, type TiledMap } from '@cesar-office/world';
import { MapInstance, type InstanceOutput } from './map-instance.ts';

const map = loadWorldMap(JSON.parse(readFileSync(new URL('../../../../packages/world/maps/sede.json', import.meta.url), 'utf8')) as TiledMap);
const look = { body: 0, hair: 0, outfit: 0 };
const T = 32;

class Out implements InstanceOutput {
  msgs = new Map<string, ServerMsg[]>();
  snaps = new Map<string, SnapshotFrame[]>();
  zones: [string, string | null, string | null][] = [];
  abused: string[] = [];
  backpressure = new Set<string>();
  control(u: string, m: ServerMsg) { (this.msgs.get(u) ?? this.msgs.set(u, []).get(u)!).push(m); }
  snapshot(u: string, f: SnapshotFrame) {
    if (this.backpressure.has(u)) return false;
    // O frame só é válido durante a chamada (buffer reutilizado): copiar, como faz o encoder real.
    (this.snaps.get(u) ?? this.snaps.set(u, []).get(u)!).push({ ...f, entities: [...f.entities] });
    return true;
  }
  zoneChanged(u: string, a: PrivateZone | null, b: PrivateZone | null) { this.zones.push([u, a?.key ?? null, b?.key ?? null]); }
  statusChanged() {}
  abuse(u: string) { this.abused.push(u); }
  left() {}
  of<T extends ServerMsg['t']>(u: string, t: T) { return (this.msgs.get(u) ?? []).filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t); }
  clear() { this.msgs.clear(); this.snaps.clear(); }
}

let tok = 0;
function setup() {
  const out = new Out();
  const inst = new MapInstance('inst-1', 'sede', map, out, () => `tok-${++tok}-${'x'.repeat(20)}`);
  return { out, inst };
}
const join = (inst: MapInstance, userId: string, at?: { x: number; y: number }) => {
  const r = inst.join({ userId, displayName: userId, look, status: 'available', ...(at ? { lastPosition: at } : {}) }, 0);
  assert.ok(r.ok, `join ${userId}`);
  return r;
};
const walk = { facing: Facing.Right, moving: true, sitting: false, ghost: false } as const;
const input = (seq: number, x: number, y: number): InputFrame => ({ seq, x, y, state: walk });

test('entrar: vizinho recebe entity_enter; quem entra recebe tudo pelo welcome', () => {
  const { out, inst } = setup();
  join(inst, 'ana');
  const b = join(inst, 'bia');
  assert.equal(out.of('ana', 'entity_enter').length, 1);
  assert.equal(out.of('bia', 'entity_enter').length, 0);
  assert.equal(b.entities.length, 2, 'welcome com a própria entidade + ana');
});

test('movimento válido gera snapshot para o vizinho, uma vez', () => {
  const { out, inst } = setup();
  const a = join(inst, 'ana');
  join(inst, 'bia');
  inst.applyInput('ana', input(1, a.x + 12, a.y), 100);
  inst.step(100);
  const s = out.snaps.get('bia') ?? [];
  assert.equal(s.length, 1);
  assert.equal(s[0]?.entities[0]?.x, a.x + 12);
  inst.step(200);
  assert.equal(out.snaps.get('bia')?.length, 1, 'sem mudança, sem snapshot');
});

test('speed hack → correction speed; segunda rejeição na janela é silenciosa', () => {
  const { out, inst } = setup();
  const a = join(inst, 'ana');
  inst.applyInput('ana', input(1, a.x + 200, a.y), 100);
  inst.applyInput('ana', input(2, a.x + 210, a.y), 150);
  const c = out.of('ana', 'correction');
  assert.equal(c.length, 1);
  assert.equal(c[0]?.reason, 'speed');
  assert.deepEqual([c[0]?.x, c[0]?.y], [a.x, a.y]);
});

test('atravessar parede → correction collision', () => {
  const { out, inst } = setup();
  const a = join(inst, 'ana', { x: 4 * T + 16, y: 2 * T + 16 }); // canto da recepção, parede ao norte em y=1
  inst.applyInput('ana', input(1, a.x, a.y - 40), 300);
  assert.equal(out.of('ana', 'correction')[0]?.reason, 'collision');
});

test('sala cheia → correction zone_full na porta', () => {
  const { out, inst } = setup();
  const ipe = map.zones.find((z) => z.key === 'ipe')!;
  for (const u of ['u1', 'u2', 'u3', 'u4']) join(inst, u, { x: ipe.rect.x + 48, y: ipe.rect.y + 48 });
  assert.equal(inst.occupancyOf(ipe), 4);
  const door = map.doorOf('ipe')!;
  const e = join(inst, 'eva', { x: door.x, y: door.y });
  assert.equal(inst.zoneOf('eva'), null);
  inst.applyInput('eva', input(1, e.x, e.y + T), 300);
  assert.equal(out.of('eva', 'correction')[0]?.reason, 'zone_full');
});

test('entrar em sala com vaga: zoneChanged + mensagem zone com ocupação', () => {
  const { out, inst } = setup();
  const door = map.doorOf('ipe')!;
  const e = join(inst, 'eva', { x: door.x, y: door.y });
  inst.applyInput('eva', input(1, e.x, e.y + T), 300);
  assert.deepEqual(out.zones.at(-1), ['eva', null, 'ipe']);
  const z = out.of('eva', 'zone').at(-1);
  assert.equal(z?.zoneKey, 'ipe');
  assert.equal(z?.occupancy, 1);
});

test('áudio: vizinhos próximos recebem audible um do outro após o dwell', () => {
  const { out, inst } = setup();
  const a = join(inst, 'ana');
  join(inst, 'bia', { x: a.x + 2 * T, y: a.y });
  inst.step(0);
  inst.step(500);
  const pa = out.of('ana', 'audible').at(-1);
  const pb = out.of('bia', 'audible').at(-1);
  assert.deepEqual(pa?.peers.map((p) => p.userId), ['bia']);
  assert.deepEqual(pb?.peers.map((p) => p.userId), ['ana']);
  assert.equal(pa?.bubbleId, pb?.bubbleId);
});

test('ghost: vizinho vê bit ghost; resume dentro da janela; expirado sai da AOI', () => {
  const { out, inst } = setup();
  join(inst, 'ana');
  join(inst, 'bia');
  const token = inst.resumeTokenOf('ana')!;
  inst.disconnect('ana', 1000);
  inst.step(1100);
  const s = out.snaps.get('bia')?.at(-1);
  assert.equal(s?.entities[0]?.state.ghost, true);
  const r = inst.resume(token, 5000);
  assert.ok(r);
  assert.equal(inst.resume(token, 5000), null, 'token rotaciona');
  inst.disconnect('ana', 6000);
  inst.step(6000 + 30_001);
  assert.deepEqual(out.of('bia', 'entity_leave').at(-1)?.netIds.length, 1);
  assert.equal(inst.has('ana'), false);
});

test('AOI: quem está longe não aparece', () => {
  const { out, inst } = setup();
  join(inst, 'ana');
  join(inst, 'zeca', { x: 60 * T, y: 38 * T }); // copa
  assert.equal(out.of('ana', 'entity_enter').length, 0);
});

test('backpressure: snapshot pulado é reenviado no tick seguinte', () => {
  const { out, inst } = setup();
  const a = join(inst, 'ana');
  join(inst, 'bia');
  out.backpressure.add('bia');
  inst.applyInput('ana', input(1, a.x + 12, a.y), 100);
  inst.step(100);
  assert.equal(out.snaps.get('bia'), undefined);
  out.backpressure.delete('bia');
  inst.step(200);
  assert.equal(out.snaps.get('bia')?.[0]?.entities[0]?.x, a.x + 12);
});

test('sentar: teleporta para a cadeira; cadeira ocupada recusa o segundo', () => {
  const { out, inst } = setup();
  const chair = map.interactables.find((i) => i.key === 'chair-desk-1')!;
  join(inst, 'ana', { x: chair.x, y: chair.y - T });
  join(inst, 'bia', { x: chair.x + T, y: chair.y - T });
  assert.equal(inst.interact('ana', chair.key, 100), 'ok');
  const c = out.of('ana', 'correction').at(-1);
  assert.equal(c?.reason, 'teleport');
  assert.deepEqual([c?.x, c?.y], [chair.x, chair.y]);
  assert.equal(inst.interact('bia', chair.key, 100), 'occupied');
  assert.deepEqual(inst.chairOf('ana'), { key: 'chair-desk-1', deskKey: 'desk-1' });
});

test('ir até alguém dentro de sala leva à porta, do lado de fora', () => {
  const { inst } = setup();
  const jat = map.zones.find((z) => z.key === 'jatoba')!;
  join(inst, 'ana', { x: jat.rect.x + 64, y: jat.rect.y + 64 });
  join(inst, 'bia');
  assert.equal(inst.goTo('bia', 'ana', 100), 'ok');
  const p = inst.positionOf('bia')!;
  assert.equal(map.zoneAt(p.x, p.y), null);
  const door = map.doorOf('jatoba')!;
  assert.ok(Math.hypot(p.x - door.x, p.y - door.y) <= 3 * T);
});

test('Em reunião automático com 2 na sala; volta a disponível ao sair', () => {
  const { out, inst } = setup();
  const door = map.doorOf('ipe')!;
  const ipe = map.zones.find((z) => z.key === 'ipe')!;
  join(inst, 'ana', { x: ipe.rect.x + 48, y: ipe.rect.y + 48 });
  const e = join(inst, 'eva', { x: door.x, y: door.y });
  inst.applyInput('eva', input(1, e.x, e.y + T), 300);
  assert.equal(inst.statusOf('eva'), 'in_meeting');
  assert.equal(inst.statusOf('ana'), 'in_meeting');
  inst.applyInput('eva', input(2, e.x, e.y), 600);
  assert.equal(inst.statusOf('eva'), 'available');
  assert.ok(out.of('eva', 'entity_meta').length >= 2);
});

test('LOD: vizinho distante vai a 5 Hz; próximo a 10 Hz', () => {
  const { out, inst } = setup();
  const a = join(inst, 'ana', { x: 30 * T, y: 20 * T });
  const near = join(inst, 'perto', { x: a.x + 2 * T, y: a.y });
  const far = join(inst, 'longe', { x: a.x + 17 * T, y: a.y }); // mesma AOI (3×3 células), mas além de 16 tiles
  let t = 0;
  for (let i = 1; i <= 10; i++) {
    t += 100;
    inst.applyInput('perto', input(i, near.x, near.y + i * 10), t);
    inst.applyInput('longe', input(i, far.x, far.y + i * 10), t);
    inst.step(t);
  }
  const counts = new Map<number, number>();
  for (const s of out.snaps.get('ana') ?? []) for (const e of s.entities) counts.set(e.netId, (counts.get(e.netId) ?? 0) + 1);
  assert.equal(counts.get(near.netId), 10);
  // 1º tick: mudança de estado (parado → andando) sai na hora; depois só ticks pares.
  assert.equal(counts.get(far.netId), 6);
});
