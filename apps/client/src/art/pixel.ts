/**
 * Utilitários de pixel art em canvas 2D. Sem dependência de Phaser: o mesmo código desenha
 * texturas do jogo e as prévias da interface (crachá).
 */

export type Ctx = CanvasRenderingContext2D;

export function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('canvas 2D indisponível');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

export function rect(g: Ctx, color: string, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

export function px(g: Ctx, color: string, x: number, y: number): void {
  g.fillStyle = color;
  g.fillRect(x, y, 1, 1);
}

/** Retângulo com cantos "mordidos" (1 px) — o arredondado da pixel art. */
export function soft(g: Ctx, color: string, x: number, y: number, w: number, h: number): void {
  rect(g, color, x + 1, y, w - 2, h);
  rect(g, color, x, y + 1, 1, h - 2);
  rect(g, color, x + w - 1, y + 1, 1, h - 2);
}

export function disc(g: Ctx, color: string, cx: number, cy: number, r: number): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.6));
    rect(g, color, cx - half, cy + y, half * 2 + 1, 1);
  }
}

export function ellipse(g: Ctx, color: string, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5))));
    rect(g, color, cx - half, cy + y, half * 2, 1);
  }
}

/** Contorno de 1 px em volta de tudo que já foi pintado na região (estilo sprite clássico). */
export function outline(g: Ctx, x0: number, y0: number, w: number, h: number, color: string): void {
  const img = g.getImageData(x0, y0, w, h);
  const a = img.data;
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (a[(y * w + x) * 4 + 3] ?? 0) > 40;
  const marks: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push(x, y);
    }
  g.fillStyle = color;
  for (let i = 0; i < marks.length; i += 2) g.fillRect(x0 + (marks[i] ?? 0), y0 + (marks[i + 1] ?? 0), 1, 1);
}

/** Gerador determinístico (mesma arte em todo navegador e em toda recarga). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

/** Clareia/escurece uma cor #RRGGBB. f > 0 clareia, f < 0 escurece. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  const r = ch((n >> 16) & 255);
  const gg = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}
