/**
 * Gera `sede.json` (Tiled) a partir da planta ASCII de docs/06-ambientes.md §3.
 * 1 caractere = 2 × 2 tiles. Arte é placeholder (gids 1–4); colisão, zonas e objetos são reais.
 *
 *   node --experimental-transform-types packages/world/maps/build-sede.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TiledMap, TiledObject } from '../src/tiled.ts';

const PLAN = [
  '####################################',
  '#q.......#.........................#',
  '#..T.....#..mm.....mm.....mm.......#',
  '#........#..mm.....mm.....mm....q..#',
  '#.RRRR...D.........................#',
  '#........D.........................#',
  '#.cc..cc.#..mm.....mm.....mm.......#',
  '#........#..mm.....mm.....mm.......#',
  '#...SS...#.........................#',
  '#...SS...#.........................#',
  '####DD######.......................#',
  '#..................................#',
  '#..................................#',
  '###DD####DD#########DD##############',
  '#......#.........q..#..............#',
  '#.PPPP.#..MMMMMMMM..#..k..cc..cc...#',
  '#.PPPP.#..MMMMMMMM..#..f.......v...#',
  '#..q...#..MMMMMMMM..#..m.....g.....#',
  '########............#..cc..cc..tt..#',
  '########............#..............#',
  '########............#..............#',
  '####################################',
];

const S = 2; // tiles por caractere
const T = 32; // px por tile
const H = PLAN.length * S;
const W = (PLAN[0]?.length ?? 0) * S;

const GID = { floor: 1, collision: 2, wall: 3, furniture: 4 } as const;
const floor = new Array<number>(W * H).fill(GID.floor);
const walls = new Array<number>(W * H).fill(0);
const furniture = new Array<number>(W * H).fill(0);
const collision = new Array<number>(W * H).fill(0);
const zones: TiledObject[] = [];
const objects: TiledObject[] = [];
let nextId = 1;

const at = (r: number, c: number): string => PLAN[r]?.[c] ?? '#';
const block = (tx: number, ty: number, layer: number[] = furniture, gid: number = GID.furniture): void => {
  layer[ty * W + tx] = gid;
  collision[ty * W + tx] = GID.collision;
};
const props = (p: Record<string, string | number>): TiledObject['properties'] =>
  Object.entries(p).map(([name, value]) => ({ name, type: typeof value === 'number' ? 'int' : 'string', value }));
const obj = (cls: string, name: string, tx: number, ty: number, tw: number, th: number, p: Record<string, string | number>): TiledObject => ({
  id: nextId++,
  name,
  class: cls,
  x: tx * T,
  y: ty * T,
  width: tw * T,
  height: th * T,
  properties: props(p),
});
const chair = (key: string, tx: number, ty: number, deskKey?: string): void => {
  objects.push(obj('chair', key, tx, ty, 1, 1, deskKey ? { key, deskKey } : { key }));
};

// 1) Caracteres simples
for (let r = 0; r < PLAN.length; r++)
  for (let c = 0; c < (PLAN[r]?.length ?? 0); c++) {
    const ch = at(r, c);
    const tx = c * S;
    const ty = r * S;
    const all = (fn: (x: number, y: number) => void): void => {
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) fn(tx + dx, ty + dy);
    };
    switch (ch) {
      case '#':
        all((x, y) => block(x, y, walls, GID.wall));
        break;
      case 'R': case 'c': case 'k': case 'f': case 'm': case 'v': case 'g': case 't':
        if (ch === 'm' && (at(r, c + 1) === 'm' || at(r, c - 1) === 'm')) break; // ilha de mesas: tratada abaixo
        all((x, y) => block(x, y));
        break;
      case 'T':
        block(tx, ty);
        break;
      case 'q':
        block(tx, ty);
        objects.push(obj('portal', `Quadro ${objects.filter((o) => o.class === 'portal').length + 1}`, tx, ty, 1, 1, { key: `portal-${r}-${c}`, url: '' }));
        break;
    }
  }

// 2) Ilhas de mesas "mm" 2×2 caracteres = 4×4 tiles: cadeiras nas linhas 0 e 3, mesas nas linhas 1–2
let desk = 1;
for (let r = 0; r < PLAN.length - 1; r++)
  for (let c = 0; c < (PLAN[r]?.length ?? 0) - 1; c++) {
    const isTopLeft = at(r, c) === 'm' && at(r, c + 1) === 'm' && at(r + 1, c) === 'm' && at(r - 1, c) !== 'm' && at(r, c - 1) !== 'm';
    if (!isTopLeft) continue;
    const tx = c * S;
    const ty = r * S;
    for (let dx = 0; dx < 4; dx++) for (const dy of [1, 2]) block(tx + dx, ty + dy);
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 3], [2, 3]] as const) {
      const key = `desk-${desk++}`;
      chair(`chair-${key}`, tx + dx, ty + dy, key);
    }
  }

// 3) Salas privadas
interface Room { readonly key: string; readonly name: string; readonly capacity: number; readonly char: string; readonly doorCol: number }
const rooms: Room[] = [
  { key: 'ipe', name: 'Sala Ipê', capacity: 4, char: 'P', doorCol: 3 },
  { key: 'jatoba', name: 'Sala Jatobá', capacity: 10, char: 'M', doorCol: 9 },
];
const DOOR_ROW = 13;
for (const room of rooms) {
  // Interior = região delimitada por paredes ao redor do bloco de mesa (busca por inundação a partir do bloco).
  const cells: [number, number][] = [];
  for (let r = 0; r < PLAN.length; r++) for (let c = 0; c < (PLAN[r]?.length ?? 0); c++) if (at(r, c) === room.char) cells.push([r, c]);
  const seen = new Set<string>();
  const stack = [...cells];
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  while (stack.length) {
    const [r, c] = stack.pop() as [number, number];
    const k = `${r},${c}`;
    if (seen.has(k) || at(r, c) === '#' || at(r, c) === 'D') continue;
    seen.add(k);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }
  zones.push(obj('private', room.name, minC * S, minR * S, (maxC - minC + 1) * S, (maxR - minR + 1) * S, { key: room.key, name: room.name, capacity: room.capacity }));

  // Mesa no centro do bloco, cadeiras acima e abaixo (capacity cadeiras)
  const bR0 = Math.min(...cells.map(([r]) => r)) * S;
  const bC0 = Math.min(...cells.map(([, c]) => c)) * S;
  const bW = (Math.max(...cells.map(([, c]) => c)) + 1) * S - bC0;
  const bH = (Math.max(...cells.map(([r]) => r)) + 1) * S - bR0;
  const perSide = Math.ceil(room.capacity / 2);
  for (let y = bR0 + 1; y < bR0 + bH - 1; y++) for (let x = bC0 + 2; x < bC0 + bW - 2; x++) block(x, y);
  const step = Math.max(1, Math.floor((bW - 4) / perSide));
  for (let i = 0; i < perSide; i++) {
    const x = bC0 + 2 + i * step;
    chair(`chair-${room.key}-t${i + 1}`, x, bR0);
    if (i + perSide < room.capacity + 1 && i < room.capacity - perSide) chair(`chair-${room.key}-b${i + 1}`, x, bR0 + bH - 1);
  }

  // Porta: vão de 2 tiles centralizado no "DD" (4 tiles); os 2 tiles externos viram batente.
  const dTx = room.doorCol * S;
  const dTy = DOOR_ROW * S;
  for (let dy = 0; dy < S; dy++) {
    block(dTx, dTy + dy, walls, GID.wall);
    block(dTx + 3, dTy + dy, walls, GID.wall);
  }
  objects.push(obj('door', `Porta ${room.name}`, dTx + 1, dTy, 2, 2, { key: `door-${room.key}`, zoneKey: room.key }));
}

// 4) Spawn: bounding box dos "S" expandido 1 caractere para os lados
const sCells: [number, number][] = [];
for (let r = 0; r < PLAN.length; r++) for (let c = 0; c < (PLAN[r]?.length ?? 0); c++) if (at(r, c) === 'S') sCells.push([r, c]);
const sR = Math.min(...sCells.map(([r]) => r));
const sC = Math.min(...sCells.map(([, c]) => c)) - 1;
const sRows = Math.max(...sCells.map(([r]) => r)) - sR + 1;
const sCols = Math.max(...sCells.map(([, c]) => c)) + 1 - sC + 1;
zones.push(obj('spawn', 'Recepção', sC * S, sR * S, sCols * S, sRows * S, { key: 'spawn-recepcao' }));

const map: TiledMap & Record<string, unknown> = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.11.0',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  width: W,
  height: H,
  tilewidth: T,
  tileheight: T,
  nextobjectid: nextId,
  tilesets: [
    { firstgid: 1, name: 'office', image: 'tilesets/office-32.png', imagewidth: 512, imageheight: 512, tilewidth: T, tileheight: T, tilecount: 256, columns: 16, margin: 0, spacing: 0 },
  ],
  layers: [
    { type: 'tilelayer', name: 'floor', width: W, height: H, data: floor, id: 1, opacity: 1, visible: true, x: 0, y: 0 } as TiledMap['layers'][number],
    { type: 'tilelayer', name: 'walls', width: W, height: H, data: walls, id: 2, opacity: 1, visible: true, x: 0, y: 0 } as TiledMap['layers'][number],
    { type: 'tilelayer', name: 'furniture_below', width: W, height: H, data: furniture, id: 3, opacity: 1, visible: true, x: 0, y: 0 } as TiledMap['layers'][number],
    { type: 'tilelayer', name: 'collision', width: W, height: H, data: collision, id: 4, opacity: 0.4, visible: false, x: 0, y: 0 } as TiledMap['layers'][number],
    { type: 'objectgroup', name: 'zones', objects: zones, id: 5, opacity: 1, visible: true, x: 0, y: 0 } as TiledMap['layers'][number],
    { type: 'objectgroup', name: 'objects', objects, id: 6, opacity: 1, visible: true, x: 0, y: 0 } as TiledMap['layers'][number],
  ],
};

const out = join(dirname(fileURLToPath(import.meta.url)), 'sede.json');
writeFileSync(out, JSON.stringify(map));
console.log(`sede.json: ${W}×${H} tiles, ${zones.length} zonas, ${objects.length} objetos (${objects.filter((o) => o.class === 'chair').length} cadeiras)`);
