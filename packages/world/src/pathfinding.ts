/**
 * A* em grade de 4 direções para clique-para-andar e "Ir até" (03 M6, P-14).
 * Roda no cliente; o servidor só valida os passos resultantes.
 */
import type { CollisionGrid } from './collision-grid.ts';

export interface TilePoint {
  readonly tx: number;
  readonly ty: number;
}

/** Heap binário mínimo sobre índices de tile, com prioridade em Float64Array. */
class MinHeap {
  private readonly items: number[] = [];
  constructor(private readonly priority: Float64Array) {}

  push(i: number): void {
    const a = this.items;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      const pi = a[p] as number;
      if ((this.priority[pi] as number) <= (this.priority[i] as number)) break;
      a[c] = pi;
      a[p] = i;
      c = p;
    }
  }

  pop(): number | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let m = p;
        if (l < a.length && (this.priority[a[l] as number] as number) < (this.priority[a[m] as number] as number)) m = l;
        if (r < a.length && (this.priority[a[r] as number] as number) < (this.priority[a[m] as number] as number)) m = r;
        if (m === p) break;
        const tmp = a[p] as number;
        a[p] = a[m] as number;
        a[m] = tmp;
        p = m;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Caminho de `from` até `to` (inclusive), ou null se inalcançável ou mais longo que `maxLength` tiles.
 * Complexidade O(N log N) no pior caso, N = tiles visitados (limitado por maxLength²).
 */
export function findPath(grid: CollisionGrid, from: TilePoint, to: TilePoint, maxLength: number): TilePoint[] | null {
  const w = grid.widthTiles;
  const h = grid.heightTiles;
  if (grid.isBlockedTile(to.tx, to.ty) || grid.isBlockedTile(from.tx, from.ty)) return null;
  const manhattan = Math.abs(from.tx - to.tx) + Math.abs(from.ty - to.ty);
  if (manhattan > maxLength) return null;

  const size = w * h;
  const g = new Float64Array(size).fill(Infinity);
  const f = new Float64Array(size).fill(Infinity);
  const came = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const start = from.ty * w + from.tx;
  const goal = to.ty * w + to.tx;
  const heur = (i: number): number => Math.abs((i % w) - to.tx) + Math.abs(Math.floor(i / w) - to.ty);

  g[start] = 0;
  f[start] = heur(start);
  const open = new MinHeap(f);
  open.push(start);

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === undefined) break;
    if (cur === goal) return rebuild(came, cur, w);
    if (closed[cur] === 1) continue;
    closed[cur] = 1;
    const cg = g[cur] as number;
    if (cg >= maxLength) continue;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (grid.isBlockedTile(nx, ny)) continue;
      const n = ny * w + nx;
      if (closed[n] === 1) continue;
      const ng = cg + 1;
      if (ng < (g[n] as number)) {
        g[n] = ng;
        f[n] = ng + heur(n);
        came[n] = cur;
        open.push(n); // duplicatas toleradas: descartadas por `closed`
      }
    }
  }
  return null;
}

function rebuild(came: Int32Array, end: number, w: number): TilePoint[] {
  const out: TilePoint[] = [];
  for (let c = end; c !== -1; c = came[c] as number) out.push({ tx: c % w, ty: Math.floor(c / w) });
  return out.reverse();
}
