import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from './interpolation.ts';
import { ServerClock, TickTimeline } from './server-clock.ts';

test('interpolação linear entre duas amostras', () => {
  const b = new SnapshotBuffer();
  b.push({ t: 1000, x: 0, y: 0, state: 0 });
  b.push({ t: 1100, x: 10, y: 20, state: 4 });
  assert.deepEqual(b.sample(1050), { x: 5, y: 10, state: 4 });
});

test('extrapola no máximo 100 ms e depois segura', () => {
  const b = new SnapshotBuffer();
  b.push({ t: 0, x: 0, y: 0, state: 0 });
  b.push({ t: 100, x: 10, y: 0, state: 0 });
  assert.equal(b.sample(150)?.x, 15);
  assert.equal(b.sample(500)?.x, 10);
});

test('salto grande é teleporte: limpa histórico e sinaliza uma vez', () => {
  const b = new SnapshotBuffer();
  b.push({ t: 0, x: 0, y: 0, state: 0 });
  b.push({ t: 100, x: 1000, y: 0, state: 0 });
  assert.equal(b.length, 1);
  assert.equal(b.consumeTeleport(), true);
  assert.equal(b.consumeTeleport(), false);
  assert.equal(b.sample(50)?.x, 1000, 'não interpola atravessando paredes');
});

test('amostra fora de ordem é inserida no lugar', () => {
  const b = new SnapshotBuffer();
  b.push({ t: 0, x: 0, y: 0, state: 0 });
  b.push({ t: 200, x: 20, y: 0, state: 0 });
  b.push({ t: 100, x: 12, y: 0, state: 0 });
  assert.equal(b.sample(100)?.x, 12);
});

test('relógio: offset estimado pelo ponto médio do RTT', () => {
  let local = 1000;
  const c = new ServerClock(() => local, 1);
  // servidor está 5000 ms à frente; RTT 100 ms
  const sent = local;
  local += 100;
  c.onPong(sent, sent + 50 + 5000);
  assert.equal(c.serverNow(), local + 5000);
});

test('relógio: amostra com RTT > 2× mediana é ignorada', () => {
  let local = 0;
  const c = new ServerClock(() => local, 1);
  for (let i = 0; i < 5; i++) {
    const sent = local;
    local += 100;
    c.onPong(sent, sent + 50 + 1000);
  }
  const sent = local;
  local += 1000; // fila no caminho
  c.onPong(sent, sent + 900 + 1000); // ponto médio enganoso
  assert.equal(c.serverNow(), local + 1000);
});

test('timeline: wraparound de u16 continua crescendo', () => {
  const tl = new TickTimeline();
  tl.reset(65530, 0);
  assert.equal(tl.timeOf(65535), 500);
  assert.equal(tl.timeOf(4), 1000); // 65536 + 4 → 10 ticks depois
  assert.equal(tl.timeOf(65534), 400, 'tick atrasado volta no tempo sem avançar a base');
});
