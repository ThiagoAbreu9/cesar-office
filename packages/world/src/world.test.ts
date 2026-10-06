import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionGrid } from './collision-grid.ts';
import { findPath } from './pathfinding.ts';

// 6×4, parede vertical em x=2 com passagem em y=3
const W = 6;
const map = [
  0, 0, 1, 0, 0, 0,
  0, 0, 1, 0, 0, 0,
  0, 0, 1, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
];
const grid = CollisionGrid.fromTileData(W, 4, 32, map);

test('fora do mapa é bloqueado', () => {
  assert.equal(grid.isBlockedTile(-1, 0), true);
  assert.equal(grid.isBlockedTile(6, 0), true);
});

test('segmento atravessando parede é inválido; contornando é válido', () => {
  assert.equal(grid.segmentWalkable(16, 16, 112, 16), false);
  assert.equal(grid.segmentWalkable(16, 112, 112, 112), true);
});

test('A* contorna a parede pela passagem', () => {
  const p = findPath(grid, { tx: 0, ty: 0 }, { tx: 4, ty: 0 }, 50);
  assert.ok(p);
  assert.deepEqual(p[0], { tx: 0, ty: 0 });
  assert.deepEqual(p[p.length - 1], { tx: 4, ty: 0 });
  assert.equal(p.length - 1, 10, 'caminho mínimo: 3 para baixo, 4 à direita, 3 para cima');
  for (const t of p) assert.equal(grid.isBlockedTile(t.tx, t.ty), false);
});

test('A* respeita limite de tamanho e destino bloqueado', () => {
  assert.equal(findPath(grid, { tx: 0, ty: 0 }, { tx: 4, ty: 0 }, 6), null);
  assert.equal(findPath(grid, { tx: 0, ty: 0 }, { tx: 2, ty: 0 }, 50), null);
});

// ───────────── mapa Sede (gerado de docs/06 §3) ─────────────
import { readFileSync } from 'node:fs';
import { loadWorldMap, MapError, nearestFreeTile, type TiledMap } from './tiled.ts';

const sedeRaw = JSON.parse(readFileSync(new URL('../maps/sede.json', import.meta.url), 'utf8')) as TiledMap;

test('Sede: carrega e passa em todas as validações de 06 §2', () => {
  const m = loadWorldMap(sedeRaw);
  assert.equal(m.widthTiles, 72);
  assert.equal(m.heightTiles, 44);
  assert.deepEqual(m.zones.map((z) => [z.key, z.capacity]), [['ipe', 4], ['jatoba', 10]]);
  assert.equal(m.interactables.filter((i) => i.type === 'chair' && i.deskKey).length, 24);
});

test('Sede: toda cadeira e toda sala alcançáveis a partir do spawn', () => {
  const m = loadWorldMap(sedeRaw);
  const s = m.spawns[0];
  assert.ok(s);
  const from = nearestFreeTile(m, Math.floor((s.x + s.w / 2) / 32), Math.floor((s.y + s.h / 2) / 32), 3);
  assert.ok(from);
  for (const it of m.interactables.filter((i) => i.type !== 'portal')) {
    const to = { tx: Math.floor(it.x / 32), ty: Math.floor(it.y / 32) };
    assert.ok(findPath(m.grid, from, to, 500), `${it.key} inalcançável`);
  }
});

test('Sede: zoneAt reconhece dentro/fora das salas; parede isola a sala', () => {
  const m = loadWorldMap(sedeRaw);
  const ipe = m.zones.find((z) => z.key === 'ipe');
  assert.ok(ipe);
  assert.equal(m.zoneAt(ipe.rect.x + 40, ipe.rect.y + 40)?.key, 'ipe');
  assert.equal(m.zoneAt(ipe.rect.x + 40, ipe.rect.y - 80), null);
  // Ponto dentro da Ipê e ponto na Jatobá, mesma linha: segmento cruza a parede
  const jat = m.zones.find((z) => z.key === 'jatoba');
  assert.ok(jat);
  const y = ipe.rect.y + 40;
  assert.equal(m.grid.segmentWalkable(ipe.rect.x + 40, y, jat.rect.x + 40, y), false);
});

test('mapa quebrado lista todos os problemas', () => {
  const broken: TiledMap = { ...sedeRaw, layers: sedeRaw.layers.filter((l) => l.name !== 'collision' && l.name !== 'objects') };
  try {
    loadWorldMap(broken);
    assert.fail('deveria lançar');
  } catch (e) {
    assert.ok(e instanceof MapError);
    assert.ok(e.problems.some((p) => p.includes('collision')));
    assert.ok(e.problems.some((p) => p.includes('sem porta')));
  }
});

test('Sede: mesa bloqueia passagem mas não som; parede bloqueia os dois', () => {
  const m = loadWorldMap(sedeRaw);
  const c1 = m.interactables.find((i) => i.key === 'chair-desk-1');
  const c3 = m.interactables.find((i) => i.key === 'chair-desk-3');
  assert.ok(c1 && c3, 'cadeiras frente a frente na primeira ilha');
  assert.equal(m.grid.segmentWalkable(c1.x, c1.y, c3.x, c3.y), false);
  assert.equal(m.acoustics.segmentWalkable(c1.x, c1.y, c3.x, c3.y), true);
});

test('mapa Sede: props só visuais, sobre tiles bloqueados (mobília) ou parede/piso (decoração)', async () => {
  const { readFileSync } = await import('node:fs');
  const { loadWorldMap } = await import('./tiled.ts');
  const sede = loadWorldMap(JSON.parse(readFileSync(new URL('../maps/sede.json', import.meta.url), 'utf8')));
  const kinds = new Set(sede.props.map((p) => p.kind));
  for (const k of ['desk-island', 'meeting-table', 'sofa', 'coffee', 'plant', 'rug']) assert.ok(kinds.has(k), `prop ${k}`);
  const solid = sede.props.filter((p) => !['rug', 'wall-art', 'wall-clock', 'wall-logo'].includes(p.kind));
  for (const p of solid) {
    const cx = Math.floor((p.rect.x + p.rect.w / 2) / sede.tilePx);
    const cy = Math.floor((p.rect.y + p.rect.h / 2) / sede.tilePx);
    assert.ok(sede.grid.isBlockedTile(cx, cy), `${p.kind} em (${cx},${cy}) deveria estar sobre colisão`);
  }
});
