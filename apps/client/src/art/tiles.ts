/**
 * Tileset `office` 512×512 (16 × 16 tiles de 32 px). Os gids batem com `maps/build-sede.ts`.
 * Cada tile é desenhado numa função própria; o tile final do artista substitui sem mudar o mapa.
 */
import { canvas, px, rect, seeded, shade, type Ctx } from './pixel.ts';
import { P } from './palette.ts';

const T = 32;

type TileFn = (g: Ctx, rnd: () => number) => void;

function planks(offset: number): TileFn {
  return (g, rnd) => {
    rect(g, P.oak, 0, 0, T, T);
    for (let row = 0; row < 4; row++) {
      const y = row * 8;
      const tone = [0, -0.04, 0.03, -0.02][(row + offset) % 4] ?? 0;
      rect(g, shade(P.oak, tone), 0, y, T, 7);
      rect(g, P.oakShade, 0, y + 7, T, 1);
      const seam = ((row * 13 + offset * 7) % 24) + 4;
      rect(g, P.oakShade, seam, y, 1, 7);
      for (let i = 0; i < 3; i++) px(g, shade(P.oak, -0.08), Math.floor(rnd() * T), y + 1 + Math.floor(rnd() * 5));
      rect(g, shade(P.oak, 0.12), 0, y, T, 1);
    }
  };
}

const stone = (alt: boolean): TileFn => (g, rnd) => {
  const base = alt ? '#DED6C7' : '#E7E0D2';
  rect(g, base, 0, 0, T, T);
  rect(g, '#C9BFAE', 0, T - 1, T, 1);
  rect(g, '#C9BFAE', T - 1, 0, 1, T);
  rect(g, shade(base, 0.25), 0, 0, T - 1, 1);
  for (let i = 0; i < 10; i++) px(g, shade(base, rnd() > 0.5 ? -0.06 : 0.08), Math.floor(rnd() * 30), Math.floor(rnd() * 30));
};

const carpet = (base: string, dot: string): TileFn => (g, rnd) => {
  rect(g, base, 0, 0, T, T);
  for (let y = 1; y < T; y += 4) for (let x = (y >> 2) % 2 ? 3 : 1; x < T; x += 4) px(g, dot, x, y);
  for (let i = 0; i < 6; i++) px(g, shade(base, -0.12), Math.floor(rnd() * T), Math.floor(rnd() * T));
};

const checker = (light: boolean): TileFn => (g) => {
  const base = light ? '#EEEBE3' : '#BFD2D6';
  rect(g, base, 0, 0, T, T);
  rect(g, shade(base, -0.08), 0, T - 1, T, 1);
  rect(g, shade(base, -0.08), T - 1, 0, 1, T);
  rect(g, shade(base, 0.35), 3, 3, 6, 1);
  rect(g, shade(base, 0.35), 3, 4, 1, 3);
};

const concrete = (alt: boolean): TileFn => (g, rnd) => {
  const base = alt ? '#C4BFB4' : '#CBC6BB';
  rect(g, base, 0, 0, T, T);
  for (let i = 0; i < 18; i++) px(g, shade(base, rnd() > 0.5 ? -0.07 : 0.06), Math.floor(rnd() * T), Math.floor(rnd() * T));
  if (alt) rect(g, shade(base, -0.06), 0, 0, T, 1);
};

const threshold: TileFn = (g) => {
  rect(g, '#9AA0AA', 0, 0, T, T);
  for (let y = 2; y < T; y += 4) rect(g, '#80868F', 0, y, T, 1);
  rect(g, '#C3C7CE', 0, 0, T, 1);
};

/** Face da parede (vista de frente em 3/4): reboco, sombra sob o topo e rodapé de madeira. */
const wallFace = (band?: string): TileFn => (g, rnd) => {
  rect(g, P.plaster, 0, 0, T, T);
  rect(g, P.plasterShade, 0, 0, T, 3);
  rect(g, shade(P.plaster, 0.3), 0, 3, T, 1);
  for (let i = 0; i < 6; i++) px(g, P.plasterShade, Math.floor(rnd() * T), 5 + Math.floor(rnd() * 20));
  if (band) {
    rect(g, band, 0, 14, T, 4);
    rect(g, shade(band, -0.25), 0, 18, T, 1);
  }
  rect(g, P.wood, 0, T - 6, T, 5);
  rect(g, P.woodLight, 0, T - 6, T, 1);
  rect(g, P.woodDark, 0, T - 1, T, 1);
};

/** Topo da parede visto de cima: tampa escura com aresta clara. */
const wallTop: TileFn = (g) => {
  rect(g, P.steel, 0, 0, T, T);
  rect(g, P.deep, 0, 0, T, 2);
  rect(g, shade(P.steel, 0.12), 2, 2, T - 4, T - 4);
  rect(g, P.slate, 0, T - 2, T, 2);
};

const wallWindow: TileFn = (g, rnd) => {
  wallFace()(g, rnd);
  rect(g, P.paper, 2, 4, 28, 21);
  rect(g, P.glass, 4, 6, 24, 17);
  rect(g, P.glassLight, 4, 6, 24, 4);
  for (let i = 0; i < 8; i++) rect(g, P.glassLight, 8 + i, 18 - i, 2, 1); // reflexo diagonal
  rect(g, '#7FB3DD', 4, 20, 24, 3);
  rect(g, P.paper, 15, 6, 2, 17);
  rect(g, '#B9C2CE', 2, 25, 28, 2);
};

const collision: TileFn = (g) => rect(g, 'rgba(248,81,73,0.45)', 0, 0, T, T);

const furniture: TileFn = (g) => {
  rect(g, P.woodDark, 0, 0, T, T);
  rect(g, P.wood, 1, 1, 30, 28);
  rect(g, P.woodLight, 3, 3, 26, 3);
};

const TILES: Record<number, TileFn> = {
  1: planks(0),
  2: collision,
  3: wallFace(),
  4: furniture,
  5: planks(2),
  6: stone(false),
  7: stone(true),
  8: carpet('#3B5A9A', '#4C6CAE'),
  9: carpet('#C99A2E', '#D9AD45'),
  10: checker(true),
  11: checker(false),
  12: concrete(false),
  13: concrete(true),
  14: threshold,
  15: wallTop,
  16: wallWindow,
  17: wallFace(P.ipe),
};

export function tilesetCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(512, 512);
  for (const [gidStr, fn] of Object.entries(TILES)) {
    const gid = Number(gidStr);
    const x = ((gid - 1) % 16) * T;
    const y = Math.floor((gid - 1) / 16) * T;
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, T, T);
    g.clip();
    fn(g, seeded(gid * 7919));
    g.restore();
  }
  return c;
}
