/**
 * Gera `sede.json` (Tiled) a partir da planta ASCII de docs/06-ambientes.md §3.
 * 1 caractere = 2 × 2 tiles. Colisão, zonas e objetos são reais; a arte do tileset é provisória
 * (gerada em canvas pelo cliente), mas os gids e a camada `props` já seguem o layout final.
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

/**
 * gids do tileset `office` (16 colunas). Pisos têm duas variações para quebrar a repetição.
 * Paredes em 3/4: "face" quando o tile de baixo é piso (o que se vê de frente), "topo" no resto.
 */
const GID = {
  floor: 1,
  collision: 2,
  wall: 3,
  furniture: 4,
  woodB: 5,
  stoneA: 6,
  stoneB: 7,
  carpetJatoba: 8,
  carpetIpe: 9,
  checkA: 10,
  checkB: 11,
  concreteA: 12,
  concreteB: 13,
  threshold: 14,
  wallTop: 15,
  wallWindow: 16,
  wallAccent: 17,
} as const;
const floor = new Array<number>(W * H).fill(GID.floor);
const walls = new Array<number>(W * H).fill(0);
const furniture = new Array<number>(W * H).fill(0);
const collision = new Array<number>(W * H).fill(0);
const zones: TiledObject[] = [];
const propObjs: TiledObject[] = [];
const objects: TiledObject[] = [];
let nextId = 1;

const at = (r: number, c: number): string => PLAN[r]?.[c] ?? '#';
const block = (tx: number, ty: number, layer: number[] | null = null, gid = 0): void => {
  if (layer) layer[ty * W + tx] = gid;
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
/** Mobília/decoração só visual (camada `props`): o servidor ignora; colisão continua na camada `collision`. */
const prop = (kind: string, tx: number, ty: number, tw: number, th: number, extra: Record<string, string | number> = {}): void => {
  propObjs.push(obj(kind, kind, tx, ty, tw, th, extra));
};
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
        prop('tv', tx, ty, 1, 1);
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
    prop('desk-island', tx, ty + 1, 4, 2);
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 3], [2, 3]] as const) {
      const key = `desk-${desk++}`;
      chair(`chair-${key}`, tx + dx, ty + dy, key);
    }
  }

// 3) Salas privadas
const roomFloor = new Map<string, number>();
const roomRects = new Map<string, { r0: number; r1: number; c0: number; c1: number }>();
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
  prop('meeting-table', bC0 + 2, bR0 + 1, bW - 4, bH - 2);
  roomFloor.set(room.key, room.key === 'ipe' ? GID.carpetIpe : GID.carpetJatoba);
  roomRects.set(room.key, { r0: minR, r1: maxR, c0: minC, c1: maxC });
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

// 5) Mobília agrupada por componente conexo do mesmo caractere (sofá "cc" = 4×2 tiles etc.)
const PROP_OF: Record<string, string> = { R: 'reception-desk', c: 'sofa', k: 'coffee', f: 'fridge', m: 'microwave', v: 'arcade', g: 'plant', t: 'bistro' };
{
  const seen = new Set<string>();
  for (let r = 0; r < PLAN.length; r++)
    for (let c = 0; c < (PLAN[r]?.length ?? 0); c++) {
      const ch = at(r, c);
      const kind = PROP_OF[ch];
      if (!kind || seen.has(`${r},${c}`)) continue;
      if (ch === 'm' && (at(r, c + 1) === 'm' || at(r, c - 1) === 'm')) continue;
      let r1 = r, c1 = c;
      const stack: [number, number][] = [[r, c]];
      while (stack.length) {
        const [rr, cc] = stack.pop() as [number, number];
        if (seen.has(`${rr},${cc}`) || at(rr, cc) !== ch) continue;
        seen.add(`${rr},${cc}`);
        r1 = Math.max(r1, rr); c1 = Math.max(c1, cc);
        stack.push([rr + 1, cc], [rr, cc + 1], [rr, cc - 1]);
      }
      prop(kind, c * S, r * S, (c1 - c + 1) * S, (r1 - r + 1) * S);
    }
}

// 6) Pisos por ambiente: inundação a partir de uma semente em cada área (paredes e portas separam).
const REGION_SEEDS: [string, number, number][] = [
  ['reception', 8, 4],
  ['work', 2, 20],
  ['ipe', 16, 3],
  ['jatoba', 15, 12],
  ['copa', 19, 25],
];
const regionOf = new Map<string, string>();
for (const [name, r0, c0] of REGION_SEEDS) {
  const stack: [number, number][] = [[r0, c0]];
  while (stack.length) {
    const [r, c] = stack.pop() as [number, number];
    const k = `${r},${c}`;
    if (regionOf.has(k) || at(r, c) === '#' || at(r, c) === 'D') continue;
    regionOf.set(k, name);
    stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }
}
for (let ty = 0; ty < H; ty++)
  for (let tx = 0; tx < W; tx++) {
    const r = Math.floor(ty / S), c = Math.floor(tx / S);
    const region = at(r, c) === 'D' ? 'door' : regionOf.get(`${r},${c}`);
    let gid: number;
    switch (region) {
      case 'reception': gid = ((tx >> 1) + (ty >> 1)) % 2 ? GID.stoneB : GID.stoneA; break;
      case 'work': gid = r >= 11 ? ((tx + ty) % 3 === 0 ? GID.concreteB : GID.concreteA) : ty % 2 ? GID.woodB : GID.floor; break;
      case 'ipe': gid = GID.carpetIpe; break;
      case 'jatoba': gid = GID.carpetJatoba; break;
      case 'copa': gid = (tx + ty) % 2 ? GID.checkB : GID.checkA; break;
      case 'door': gid = GID.threshold; break;
      default: gid = GID.concreteA;
    }
    floor[ty * W + tx] = gid;
  }

// 7) Paredes em 3/4: face (vista de frente) quando há piso logo abaixo; janelas na fachada norte.
for (let ty = 0; ty < H; ty++)
  for (let tx = 0; tx < W; tx++) {
    if (!walls[ty * W + tx]) continue;
    const below = ty + 1 < H ? walls[(ty + 1) * W + tx] : 1;
    if (below) walls[ty * W + tx] = GID.wallTop;
    else if (ty === 1 && tx % 6 >= 3 && tx % 6 <= 4 && tx > 2 && tx < W - 3) walls[ty * W + tx] = GID.wallWindow;
    else if (ty === 1 && tx < 18) walls[ty * W + tx] = GID.wallAccent;
    else walls[ty * W + tx] = GID.wall;
  }

// 8) Decoração sem colisão: tapetes, quadros na parede, relógio, plantinhas sobre a parede (prateleira).
prop('rug', 2 * S, 5 * S, 6 * S, 2 * S, { color: 'ipe' });
prop('rug', 24 * S, 16 * S, 7 * S, 2 * S, { color: 'copa' });
prop('wall-logo', 3, 1, 4, 1);
prop('wall-clock', 12, 1, 1, 1);
prop('wall-art', 27, 1, 2, 1);
prop('wall-art', 51, 1, 2, 1, { variant: 1 });
prop('wall-art', 54, 27, 2, 1, { variant: 2 });
prop('wall-clock', 66, 27, 1, 1);

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
    { type: 'objectgroup', name: 'props', objects: propObjs, id: 7, opacity: 1, visible: true, x: 0, y: 0 } as TiledMap['layers'][number],
  ],
};

const out = join(dirname(fileURLToPath(import.meta.url)), 'sede.json');
writeFileSync(out, JSON.stringify(map));
console.log(`sede.json: ${W}×${H} tiles, ${zones.length} zonas, ${objects.length} objetos (${objects.filter((o) => o.class === 'chair').length} cadeiras, ${propObjs.length} props)`);
