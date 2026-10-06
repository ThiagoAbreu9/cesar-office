/**
 * Grade de colisão por tile, construída a partir da camada `collision` do Tiled (06 §2).
 * Mesma semântica usada pelo servidor para validar movimento (04 §4) — por isso é pura.
 */
export class CollisionGrid {
  constructor(
    readonly widthTiles: number,
    readonly heightTiles: number,
    readonly tilePx: number,
    /** 1 = bloqueado. Comprimento = width × height, linha a linha. */
    private readonly blocked: Uint8Array,
  ) {
    if (blocked.length !== widthTiles * heightTiles) throw new RangeError('tamanho da grade inconsistente');
  }

  /** Constrói a partir dos índices de tile de uma camada Tiled (0 = vazio = livre). */
  static fromTileData(width: number, height: number, tilePx: number, data: ArrayLike<number>): CollisionGrid {
    const blocked = new Uint8Array(width * height);
    for (let i = 0; i < blocked.length; i++) blocked[i] = (data[i] ?? 0) > 0 ? 1 : 0;
    return new CollisionGrid(width, height, tilePx, blocked);
  }

  isBlockedTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.widthTiles || ty >= this.heightTiles) return true;
    return this.blocked[ty * this.widthTiles + tx] === 1;
  }

  isBlockedPx(x: number, y: number): boolean {
    return this.isBlockedTile(Math.floor(x / this.tilePx), Math.floor(y / this.tilePx));
  }

  /** Caixa dos pés do avatar livre? (centro em x,y; meia-largura hw; meia-altura hh) */
  isBoxFree(x: number, y: number, hw: number, hh: number): boolean {
    return (
      !this.isBlockedPx(x - hw, y - hh) &&
      !this.isBlockedPx(x + hw, y - hh) &&
      !this.isBlockedPx(x - hw, y + hh) &&
      !this.isBlockedPx(x + hw, y + hh)
    );
  }

  /** Segmento sem tiles bloqueados (Bresenham em tiles). Usado no servidor e no raycast de áudio. */
  segmentWalkable(ax: number, ay: number, bx: number, by: number): boolean {
    let x0 = Math.floor(ax / this.tilePx);
    let y0 = Math.floor(ay / this.tilePx);
    const x1 = Math.floor(bx / this.tilePx);
    const y1 = Math.floor(by / this.tilePx);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (this.isBlockedTile(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
}
