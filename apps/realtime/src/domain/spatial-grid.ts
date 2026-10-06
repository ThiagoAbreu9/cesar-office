/**
 * Grid espacial uniforme para AOI e consultas de vizinhança.
 * Inserir/mover/remover: O(1). Consulta por raio: O(entidades nas células tocadas).
 * Ver 04-multiplayer §2.
 */
export class SpatialGrid<Id extends string | number> {
  private readonly cells = new Map<number, Set<Id>>();
  private readonly cellOf = new Map<Id, number>();

  constructor(private readonly cellSizePx: number) {
    if (cellSizePx <= 0) throw new RangeError('cellSizePx deve ser > 0');
  }

  private key(cx: number, cy: number): number {
    // cx, cy < 65536 (mapas até 65536 células) → chave numérica sem alocação de string.
    return cx * 65536 + cy;
  }

  private cellCoord(v: number): number {
    return Math.max(0, Math.floor(v / this.cellSizePx));
  }

  /** Insere ou move. Retorna true se a entidade mudou de célula (gatilho de recálculo de AOI). */
  upsert(id: Id, x: number, y: number): boolean {
    const k = this.key(this.cellCoord(x), this.cellCoord(y));
    const prev = this.cellOf.get(id);
    if (prev === k) return false;
    if (prev !== undefined) this.cells.get(prev)?.delete(id);
    let set = this.cells.get(k);
    if (!set) {
      set = new Set<Id>();
      this.cells.set(k, set);
    }
    set.add(id);
    this.cellOf.set(id, k);
    return true;
  }

  remove(id: Id): void {
    const k = this.cellOf.get(id);
    if (k === undefined) return;
    const set = this.cells.get(k);
    set?.delete(id);
    if (set && set.size === 0) this.cells.delete(k);
    this.cellOf.delete(id);
  }

  /** Itera ids nas células que intersectam o quadrado [x-r, x+r] × [y-r, y+r]. Filtro fino é do chamador. */
  forEachNear(x: number, y: number, r: number, cb: (id: Id) => void): void {
    const x0 = this.cellCoord(x - r);
    const x1 = this.cellCoord(x + r);
    const y0 = this.cellCoord(y - r);
    const y1 = this.cellCoord(y + r);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.cells.get(this.key(cx, cy));
        if (set) for (const id of set) cb(id);
      }
    }
  }

  /** Ids nas 3×3 células ao redor — a AOI de rede. */
  forEachInAoi(x: number, y: number, cb: (id: Id) => void): void {
    this.forEachNear(x, y, this.cellSizePx, cb);
  }

  get size(): number {
    return this.cellOf.size;
  }
}
