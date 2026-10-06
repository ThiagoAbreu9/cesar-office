import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioPairing, DEFAULT_AUDIO_PARAMS, type Participant } from './audio-pairing.ts';
import { SpatialGrid } from './spatial-grid.ts';

const T = DEFAULT_AUDIO_PARAMS.tilePx;
const open = (id: string, tx: number, ty = 0, dnd = false): Participant => ({ id, x: tx * T, y: ty * T, zoneKey: null, dnd });
const DWELL = DEFAULT_AUDIO_PARAMS.dwellMs;

/** Roda duas vezes para vencer o dwell. */
function settle(ap: AudioPairing, ps: Participant[], t0 = 0) {
  ap.compute(ps, t0);
  return ap.compute(ps, t0 + DWELL);
}

test('dois a 2 tiles formam par só após o dwell', () => {
  const ap = new AudioPairing();
  const ps = [open('a', 0), open('b', 2)];
  assert.equal(ap.compute(ps, 0).audible.size, 0);
  const r = ap.compute(ps, DWELL);
  assert.equal(r.audible.get('a')?.has('b'), true);
  assert.equal(r.audible.get('b')?.has('a'), true, 'simetria');
});

test('passagem rápida não forma par', () => {
  const ap = new AudioPairing();
  ap.compute([open('a', 0), open('b', 2)], 0);
  const r = ap.compute([open('a', 0), open('b', 10)], 250);
  assert.equal(r.audible.size, 0);
  const r2 = ap.compute([open('a', 0), open('b', 2)], 300);
  assert.equal(r2.audible.size, 0, 'dwell recomeça');
});

test('histerese: par se mantém a 3,5 tiles e cai acima de 4', () => {
  const ap = new AudioPairing();
  settle(ap, [open('a', 0), open('b', 2)]);
  assert.equal(ap.compute([open('a', 0), open('b', 3.5)], 1000).audible.get('a')?.has('b'), true);
  assert.equal(ap.compute([open('a', 0), open('b', 4.2)], 1250).audible.size, 0);
});

test('3,5 tiles sem par prévio não entra', () => {
  const ap = new AudioPairing();
  assert.equal(settle(ap, [open('a', 0), open('b', 3.5)]).audible.size, 0);
});

test('DND nunca forma par', () => {
  const ap = new AudioPairing();
  assert.equal(settle(ap, [open('a', 0), open('b', 1, 0, true)]).audible.size, 0);
});

test('linha de visão bloqueada (parede) impede par', () => {
  const ap = new AudioPairing(DEFAULT_AUDIO_PARAMS, () => false);
  assert.equal(settle(ap, [open('a', 0), open('b', 1)]).audible.size, 0);
});

test('grau máximo 8, simétrico, mais próximos primeiro', () => {
  const ap = new AudioPairing();
  // 'c' no centro, 10 pessoas em anel de raio ~1–2,9 tiles
  const ps: Participant[] = [open('c', 10, 10)];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    const r = 1 + i * 0.2;
    ps.push({ id: `p${i}`, x: (10 + Math.cos(ang) * r) * T, y: (10 + Math.sin(ang) * r) * T, zoneKey: null, dnd: false });
  }
  const res = settle(ap, ps);
  for (const [u, peers] of res.audible) {
    assert.ok(peers.size <= 8, `${u} ouve ${peers.size}`);
    for (const v of peers.keys()) assert.equal(res.audible.get(v)?.has(u), true, `simetria ${u}-${v}`);
  }
  const cPeers = res.audible.get('c');
  assert.equal(cPeers?.size, 8);
  assert.equal(cPeers?.has('p9'), false, 'o mais distante fica de fora');
});

test('zona privada: todos se ouvem a volume 1 e não ouvem a área aberta', () => {
  const ap = new AudioPairing();
  const ps: Participant[] = [
    { id: 'z1', x: 0, y: 0, zoneKey: 'ipe', dnd: false },
    { id: 'z2', x: 20 * T, y: 0, zoneKey: 'ipe', dnd: false },
    open('o1', 1),
  ];
  const r = settle(ap, ps);
  assert.equal(r.audible.get('z1')?.get('z2'), 1);
  assert.equal(r.audible.get('z1')?.has('o1') ?? false, false);
  assert.equal(r.audible.has('o1'), false);
  assert.equal(r.bubbleOf.get('z1'), 'z:ipe');
});

test('bolha = componente conexo com id estável', () => {
  const ap = new AudioPairing();
  // a—b—c em linha, a e c a 4 tiles (sem par direto), mesmo componente
  const r = settle(ap, [open('a', 0), open('b', 2), open('c', 4)]);
  assert.equal(r.audible.get('a')?.has('c') ?? false, false);
  assert.equal(r.bubbleOf.get('a'), 'b:a');
  assert.equal(r.bubbleOf.get('c'), 'b:a');
});

test('volume: 1 até 1,5 tile, mínimo em 4', () => {
  const ap = new AudioPairing();
  assert.equal(ap.volumeAt(1.5 * T), 1);
  assert.equal(ap.volumeAt(4 * T), DEFAULT_AUDIO_PARAMS.minVolume);
  const mid = ap.volumeAt(2.75 * T);
  assert.ok(mid < 1 && mid > DEFAULT_AUDIO_PARAMS.minVolume);
});

test('grid: upsert retorna mudança de célula e consulta acha vizinhos', () => {
  const g = new SpatialGrid<number>(512);
  assert.equal(g.upsert(1, 10, 10), true);
  assert.equal(g.upsert(1, 20, 20), false);
  g.upsert(2, 600, 10);
  g.upsert(3, 5000, 5000);
  const near: number[] = [];
  g.forEachInAoi(10, 10, (id) => near.push(id));
  assert.deepEqual(near.sort(), [1, 2]);
  g.remove(2);
  assert.equal(g.size, 2);
});
