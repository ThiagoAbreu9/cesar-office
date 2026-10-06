/**
 * Mobília, decoração, cadeiras e ícones de reação, desenhados em canvas.
 * Cada prop ocupa o retângulo do mapa (pegada no chão) e pode "subir" acima dele (`rise`),
 * como a tela do monitor ou o topo da geladeira — o sprite é ancorado pela base para o y-sort.
 */
import type { EmoteKind } from '@cesar-office/protocol';
import { canvas, disc, ellipse, outline, px, rect, seeded, shade, soft, type Ctx } from './pixel.ts';
import { P } from './palette.ts';

export interface PropArt {
  readonly canvas: HTMLCanvasElement;
  /** Quanto o desenho sobe acima da pegada (px). */
  readonly rise: number;
  /** Plano (tapete, quadro na parede): fica abaixo dos avatares, sem y-sort. */
  readonly flat: 'floor' | 'wall' | false;
}

type Draw = (g: Ctx, w: number, h: number, top: number, variant: number, color?: string) => void;

interface Spec {
  readonly rise: number;
  readonly flat: PropArt['flat'];
  readonly draw: Draw;
}

const shadowUnder = (g: Ctx, x: number, y: number, w: number, h: number): void => rect(g, 'rgba(27,31,42,0.18)', x + 2, y, w - 4, h);

function monitor(g: Ctx, x: number, y: number, facing: 'front' | 'back'): void {
  rect(g, P.deep, x + 7, y + 10, 2, 3);
  rect(g, P.steel, x + 4, y + 12, 8, 2);
  soft(g, P.ink, x, y, 16, 11);
  if (facing === 'front') {
    rect(g, P.screen, x + 1, y + 1, 14, 9);
    rect(g, P.screenGlow, x + 2, y + 2, 7, 1);
    rect(g, P.screenGlow, x + 2, y + 4, 10, 1);
    rect(g, '#7FE0A8', x + 4, y + 6, 6, 1);
    rect(g, P.screenGlow, x + 2, y + 8, 4, 1);
  } else {
    rect(g, P.steel, x + 1, y + 1, 14, 9);
    rect(g, P.slate, x + 6, y + 4, 4, 3);
  }
}

const SPECS: Record<string, Spec> = {
  'desk-island': {
    rise: 10,
    flat: false,
    draw: (g, w, h, top) => {
      const y0 = top;
      shadowUnder(g, 0, y0 + h - 4, w, 6);
      // tampo e frente
      rect(g, P.oakShade, 0, y0 + 2, w, h - 4);
      rect(g, P.oak, 1, y0 + 2, w - 2, h - 8);
      rect(g, shade(P.oak, 0.2), 1, y0 + 2, w - 2, 1);
      rect(g, P.wood, 0, y0 + h - 6, w, 4);
      rect(g, P.woodDark, 0, y0 + h - 2, w, 1);
      // divisória central
      rect(g, P.slate, 2, y0 + h / 2 - 3, w - 4, 4);
      rect(g, P.mist, 2, y0 + h / 2 - 3, w - 4, 1);
      for (let i = 0; i < w / 64; i++) {
        const dx = i * 64;
        // mesa de cima: monitor de costas para nós; mesa de baixo: tela visível
        monitor(g, dx + 24, y0 + 4 - 10 + 2, 'back');
        monitor(g, dx + 24, y0 + h / 2 + 1 - 6, 'front');
        rect(g, P.deep, dx + 22, y0 + h - 12, 18, 3); // teclado
        rect(g, P.slate, dx + 23, y0 + h - 12, 16, 1);
        rect(g, P.white, dx + 46, y0 + h - 14, 4, 4); // caneca
        rect(g, P.room, dx + 46, y0 + h - 12, 4, 1);
        rect(g, '#F2E6B8', dx + 6, y0 + 10, 9, 7); // papéis
        rect(g, P.ipe, dx + 8, y0 + 12, 5, 1);
      }
    },
  },
  'meeting-table': {
    rise: 4,
    flat: false,
    draw: (g, w, h, top) => {
      shadowUnder(g, 0, top + h - 2, w, 5);
      soft(g, P.woodDark, 0, top, w, h);
      soft(g, '#6E4733', 1, top + 1, w - 2, h - 6);
      rect(g, shade('#6E4733', 0.18), 3, top + 2, w - 6, 1);
      rect(g, P.woodDark, 2, top + h - 5, w - 4, 3);
      // notebooks e viva-voz
      for (let x = 10; x < w - 16; x += 30) {
        rect(g, P.mist, x, top + 6, 12, 8);
        rect(g, P.screen, x + 1, top + 7, 10, 5);
        rect(g, P.mist, x, top + h - 18, 12, 8);
        rect(g, P.steel, x + 1, top + h - 17, 10, 5);
      }
      ellipse(g, P.ink, Math.floor(w / 2), top + Math.floor(h / 2) - 2, 5, 3);
      px(g, '#3FB950', Math.floor(w / 2), top + Math.floor(h / 2) - 3);
    },
  },
  'reception-desk': {
    rise: 14,
    flat: false,
    draw: (g, w, h, top) => {
      shadowUnder(g, 0, top + h - 2, w, 5);
      rect(g, P.paper, 0, top + 2, w, 14);
      rect(g, P.white, 0, top + 2, w, 2);
      rect(g, P.deep, 0, top + 16, w, h - 14);
      rect(g, P.ipe, 0, top + 24, w, 5);
      rect(g, P.ipeDark, 0, top + 29, w, 1);
      g.fillStyle = P.paper;
      g.font = 'bold 12px monospace';
      g.textBaseline = 'top';
      g.fillText('CESAR', Math.floor(w / 2) - 18, top + 36);
      monitor(g, 24, top - 6, 'back');
      rect(g, P.leafDark, w - 26, top - 4, 10, 6);
      disc(g, P.leaf, w - 21, top - 6, 5);
      rect(g, P.wood, w - 25, top + 1, 8, 5);
      rect(g, P.mist, Math.floor(w / 2) + 30, top + 6, 6, 3); // campainha
    },
  },
  sofa: {
    rise: 10,
    flat: false,
    draw: (g, w, h, top, variant, color) => {
      const base = color ?? ['#4F6A8F', '#8F4F5C', '#5C7F55'][variant % 3] ?? '#4F6A8F';
      shadowUnder(g, 0, top + h - 2, w, 4);
      soft(g, shade(base, -0.25), 0, top, w, h);
      soft(g, base, 2, top + 1, w - 4, 18); // encosto
      rect(g, shade(base, 0.15), 4, top + 2, w - 8, 2);
      for (let x = 6; x < w - 8; x += Math.floor((w - 12) / 2)) {
        soft(g, shade(base, 0.08), x, top + 20, Math.floor((w - 12) / 2) - 2, h - 26);
        rect(g, shade(base, 0.25), x + 2, top + 21, Math.floor((w - 12) / 2) - 6, 1);
      }
      soft(g, shade(base, -0.1), 0, top + 10, 6, h - 12); // braços
      soft(g, shade(base, -0.1), w - 6, top + 10, 6, h - 12);
      rect(g, P.ipe, w - 22, top + 8, 8, 8); // almofada
    },
  },
  coffee: {
    rise: 22,
    flat: false,
    draw: (g, w, h, top) => {
      counter(g, w, h, top);
      soft(g, P.mist, 10, top - 18, 30, 30);
      rect(g, P.slate, 12, top - 16, 26, 4);
      rect(g, P.ink, 18, top - 8, 14, 10);
      rect(g, P.red, 34, top - 14, 3, 3);
      rect(g, '#3FB950', 34, top - 9, 3, 2);
      rect(g, P.white, 21, top + 4, 6, 6);
      rect(g, P.woodDark, 22, top + 5, 4, 2);
      rect(g, P.white, 44, top + 4, 5, 5);
      rect(g, P.white, 51, top + 6, 5, 5);
    },
  },
  fridge: {
    rise: 34,
    flat: false,
    draw: (g, w, h, top) => {
      shadowUnder(g, 0, top + h - 2, w, 4);
      soft(g, '#DCE3EA', 6, top - 34, w - 12, h + 32);
      rect(g, '#F4F7FA', 8, top - 32, w - 16, 3);
      rect(g, '#B9C2CE', 6, top - 4, w - 12, 2);
      rect(g, P.slate, w - 14, top - 26, 2, 14);
      rect(g, P.slate, w - 14, top + 4, 2, 12);
      rect(g, P.ipe, 14, top - 24, 6, 6); // ímã
      rect(g, P.room, 22, top - 20, 5, 5);
    },
  },
  microwave: {
    rise: 12,
    flat: false,
    draw: (g, w, h, top) => {
      counter(g, w, h, top);
      soft(g, P.steel, 10, top - 10, 40, 22);
      rect(g, P.ink, 13, top - 7, 26, 16);
      rect(g, '#3A4A5E', 14, top - 6, 24, 3);
      rect(g, P.mist, 42, top - 7, 5, 16);
      rect(g, '#7FE0A8', 43, top - 5, 3, 1);
    },
  },
  arcade: {
    rise: 36,
    flat: false,
    draw: (g, w, h, top) => {
      shadowUnder(g, 0, top + h - 2, w, 4);
      soft(g, '#5B3FA0', 10, top - 36, w - 20, h + 34);
      rect(g, '#7C5CC4', 12, top - 34, w - 24, 6);
      rect(g, P.ink, 14, top - 26, w - 28, 22);
      rect(g, '#1F3B66', 15, top - 25, w - 30, 20);
      for (let i = 0; i < 4; i++) rect(g, ['#E0685A', P.ipe, '#7FE0A8', P.screenGlow][i] ?? P.ipe, 18 + i * 6, top - 20 + (i % 2) * 6, 4, 4);
      rect(g, P.deep, 12, top - 2, w - 24, 8);
      disc(g, P.red, 22, top + 1, 2);
      disc(g, P.ipe, 34, top + 2, 2);
      disc(g, '#3FB950', 40, top + 1, 2);
    },
  },
  plant: {
    rise: 30,
    flat: false,
    draw: (g, w, h, top) => {
      shadowUnder(g, 0, top + h - 4, w, 6);
      const cx = Math.floor(w / 2);
      const rnd = seeded(17);
      for (let i = 0; i < 16; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 6 + rnd() * 14;
        disc(g, i % 3 === 0 ? P.leafDark : P.leaf, cx + Math.round(Math.cos(a) * r), top + 6 + Math.round(Math.sin(a) * r * 0.8) - 6, 6);
      }
      for (let i = 0; i < 8; i++) disc(g, P.leafLight, cx - 10 + Math.floor(rnd() * 20), top - 12 + Math.floor(rnd() * 20), 2);
      soft(g, '#C2683F', cx - 12, top + h - 26, 24, 22);
      rect(g, '#D98157', cx - 11, top + h - 25, 22, 3);
      rect(g, '#9C4E2D', cx - 12, top + h - 8, 24, 2);
    },
  },
  bistro: {
    rise: 6,
    flat: false,
    draw: (g, w, h, top) => {
      for (const cx of [Math.floor(w * 0.3), Math.floor(w * 0.72)]) {
        ellipse(g, 'rgba(27,31,42,0.18)', cx, top + h - 6, 13, 3);
        rect(g, P.deep, cx - 1, top + 14, 3, h - 20);
        ellipse(g, P.paper, cx, top + 12, 13, 7);
        ellipse(g, P.white, cx, top + 10, 11, 5);
        rect(g, P.room, cx - 3, top + 7, 5, 5);
        rect(g, P.white, cx - 2, top + 8, 3, 3);
      }
    },
  },
  tv: {
    rise: 18,
    flat: false,
    draw: (g, w, h, top) => {
      rect(g, P.deep, 13, top + 10, 6, h - 12);
      rect(g, P.steel, 8, top + h - 4, 16, 3);
      soft(g, P.ink, 0, top - 16, w, 26);
      rect(g, '#1F3B66', 2, top - 14, w - 4, 20);
      rect(g, P.ipe, 6, top - 10, 10, 2);
      rect(g, P.paper, 6, top - 6, 16, 2);
      rect(g, P.screenGlow, 6, top - 2, 12, 2);
    },
  },
  rug: {
    rise: 0,
    flat: 'floor',
    draw: (g, w, h, top, _v, color) => {
      const base = color === 'copa' ? '#4E8C8A' : '#C9562F';
      const edge = color === 'copa' ? '#E7E0D2' : P.ipe;
      soft(g, base, 0, top, w, h);
      rect(g, edge, 3, top + 3, w - 6, 1);
      rect(g, edge, 3, top + h - 4, w - 6, 1);
      rect(g, edge, 3, top + 3, 1, h - 6);
      rect(g, edge, w - 4, top + 3, 1, h - 6);
      for (let x = 10; x < w - 10; x += 12) {
        const y = top + Math.floor(h / 2);
        rect(g, edge, x, y - 2, 4, 1);
        rect(g, edge, x + 1, y - 1, 2, 3);
        rect(g, edge, x, y + 2, 4, 1);
      }
    },
  },
  'wall-logo': {
    rise: 0,
    flat: 'wall',
    draw: (g, w, h, top) => {
      soft(g, P.deep, 4, top + 6, w - 8, 16);
      g.fillStyle = P.ipe;
      g.font = 'bold 11px monospace';
      g.textBaseline = 'top';
      g.fillText('CESAR', 14, top + 8);
      g.fillStyle = P.paper;
      g.fillText('office', 54, top + 8);
    },
  },
  'wall-clock': {
    rise: 0,
    flat: 'wall',
    draw: (g, w, _h, top) => {
      const cx = Math.floor(w / 2);
      disc(g, P.ink, cx, top + 13, 8);
      disc(g, P.paper, cx, top + 13, 6);
      rect(g, P.ink, cx, top + 8, 1, 6);
      rect(g, P.ink, cx, top + 13, 4, 1);
      px(g, P.red, cx - 2, top + 15);
    },
  },
  'wall-art': {
    rise: 0,
    flat: 'wall',
    draw: (g, w, _h, top, variant) => {
      if (variant === 2) {
        // quadro branco com post-its
        rect(g, P.slate, 2, top + 3, w - 4, 20);
        rect(g, P.white, 3, top + 4, w - 6, 17);
        const notes = [P.ipe, '#F28FB1', '#86C98A', P.screenGlow];
        for (let i = 0; i < 6; i++) rect(g, notes[i % 4] ?? P.ipe, 6 + (i % 3) * 18, top + 6 + Math.floor(i / 3) * 7, 7, 5);
        return;
      }
      rect(g, P.woodDark, 6, top + 3, w - 12, 20);
      rect(g, variant === 1 ? '#2F4A6E' : '#F4E3C1', 8, top + 5, w - 16, 16);
      if (variant === 1) {
        disc(g, P.ipe, 22, top + 11, 3);
        rect(g, '#4E8C8A', 8, top + 15, w - 16, 6);
      } else {
        rect(g, '#C9562F', 12, top + 8, 10, 10);
        disc(g, P.room, 34, top + 13, 5);
        rect(g, P.ipe, 44, top + 8, 4, 10);
      }
    },
  },
};

function counter(g: Ctx, w: number, h: number, top: number): void {
  shadowUnder(g, 0, top + h - 2, w, 4);
  rect(g, '#E7E2D8', 0, top, w, 14);
  rect(g, P.white, 0, top, w, 2);
  rect(g, '#7B8494', 0, top + 14, w, h - 15);
  rect(g, P.slate, 0, top + h - 3, w, 2);
  rect(g, P.mist, Math.floor(w / 2) - 1, top + 18, 2, h - 24);
}

export function propArt(kind: string, w: number, h: number, variant: number, color?: string): PropArt {
  const spec = SPECS[kind];
  const rise = spec?.rise ?? 0;
  const [c, g] = canvas(w, h + rise);
  if (spec) spec.draw(g, w, h, rise, variant, color);
  else {
    soft(g, P.woodDark, 0, 0, w, h);
    soft(g, P.wood, 1, 1, w - 2, h - 4);
  }
  return { canvas: c, rise, flat: spec?.flat ?? false };
}

/** Cadeira vista de cima. `backTop` = encosto em cima (a pessoa olha para baixo, para a mesa). */
export function chairArt(kind: 'office' | 'meeting', backTop: boolean): HTMLCanvasElement {
  const [c, g] = canvas(32, 32);
  const seat = kind === 'office' ? P.deep : '#7A4E3A';
  const back = kind === 'office' ? P.ink : P.woodDark;
  ellipse(g, 'rgba(27,31,42,0.2)', 16, 26, 10, 3);
  if (kind === 'office') {
    rect(g, P.slate, 15, 20, 2, 6);
    rect(g, P.slate, 9, 25, 14, 2);
  }
  soft(g, seat, 8, 10, 16, 14);
  rect(g, shade(seat, 0.25), 10, 11, 12, 2);
  if (backTop) {
    soft(g, back, 7, 4, 18, 8);
    rect(g, shade(back, 0.3), 9, 5, 14, 1);
  } else {
    soft(g, back, 7, 20, 18, 8);
    rect(g, shade(back, 0.3), 9, 21, 14, 1);
  }
  outline(g, 0, 0, 32, 32, 'rgba(27,31,42,0.55)');
  return c;
}

/** Quadro de portal (cortiça com papéis), sobre cavalete. */
export function boardArt(): HTMLCanvasElement {
  const [c, g] = canvas(32, 48);
  rect(g, P.woodDark, 6, 30, 2, 16);
  rect(g, P.woodDark, 24, 30, 2, 16);
  soft(g, P.woodDark, 1, 10, 30, 24);
  rect(g, '#C99A6B', 3, 12, 26, 20);
  rect(g, P.white, 6, 14, 8, 7);
  rect(g, P.room, 7, 16, 6, 1);
  rect(g, P.ipe, 17, 15, 8, 6);
  rect(g, '#F28FB1', 8, 23, 7, 6);
  rect(g, P.white, 18, 23, 8, 7);
  rect(g, P.slate, 19, 25, 6, 1);
  px(g, P.red, 10, 14);
  px(g, P.red, 21, 15);
  ellipse(g, 'rgba(27,31,42,0.2)', 16, 46, 12, 2);
  return c;
}

/** Ícones de reação 22×24: balão branco com rabicho e o desenho dentro. */
export function emoteArt(kind: EmoteKind): HTMLCanvasElement {
  const [c, frame] = canvas(22, 24);
  soft(frame, P.ink, 0, 0, 22, 20);
  soft(frame, P.white, 1, 1, 20, 18);
  rect(frame, P.ink, 9, 20, 4, 1);
  rect(frame, P.ink, 10, 21, 2, 2);
  rect(frame, P.white, 10, 19, 2, 1);
  // o desenho vai numa camada própria para ganhar contorno e não sumir no branco do balão
  const [icon, g] = canvas(22, 24);
  const o = (x: number, y: number): [number, number] => [3 + x, 2 + y];
  const r = (col: string, x: number, y: number, w: number, h: number): void => {
    const [ax, ay] = o(x, y);
    rect(g, col, ax, ay, w, h);
  };
  switch (kind) {
    case 'wave': {
      const skin = '#F2C9A5';
      r(skin, 4, 6, 9, 8);
      for (let i = 0; i < 4; i++) r(skin, 4 + i * 2, 2 + (i === 0 ? 2 : 0), 2, 5);
      r(skin, 12, 7, 3, 2);
      r('#D9A982', 4, 12, 9, 2);
      r(P.ipe, 0, 3, 2, 1);
      r(P.ipe, 0, 7, 2, 1);
      r(P.ipe, 15, 2, 1, 2);
      break;
    }
    case 'coffee':
      r(P.white, 3, 7, 9, 8);
      r(P.ink, 3, 7, 9, 1);
      r(P.woodDark, 4, 8, 7, 2);
      r(P.room, 3, 11, 9, 2);
      r(P.ink, 12, 9, 2, 4);
      r(P.mist, 5, 2, 1, 3);
      r(P.mist, 8, 1, 1, 4);
      r(P.ink, 3, 15, 9, 1);
      break;
    case 'thumbs':
      r('#F2C9A5', 4, 7, 9, 8);
      r('#F2C9A5', 6, 2, 3, 6);
      r('#D9A982', 4, 10, 9, 1);
      r('#D9A982', 4, 13, 9, 1);
      r(P.room, 1, 8, 3, 8);
      break;
    case 'laugh':
      disc(g, P.ipe, 11, 10, 7);
      r(P.ink, 4, 4, 3, 1);
      r(P.ink, 9, 4, 3, 1);
      r(P.ink, 4, 9, 8, 3);
      r(P.white, 5, 9, 6, 1);
      r(P.screenGlow, 2, 6, 1, 2);
      r(P.screenGlow, 13, 6, 1, 2);
      break;
    case 'heart':
      r(P.red, 2, 3, 5, 5);
      r(P.red, 9, 3, 5, 5);
      r(P.red, 1, 5, 15, 4);
      r(P.red, 3, 9, 11, 2);
      r(P.red, 5, 11, 7, 2);
      r(P.red, 7, 13, 3, 2);
      r('#F28FB1', 3, 4, 2, 2);
      break;
    case 'idea':
      disc(g, P.ipe, 11, 8, 5);
      r('#FFF2B3', 6, 3, 2, 2);
      r(P.mist, 6, 11, 5, 2);
      r(P.slate, 6, 13, 5, 2);
      r(P.ipe, 0, 5, 2, 1);
      r(P.ipe, 15, 5, 2, 1);
      r(P.ipe, 8, -1, 1, 1);
      break;
  }
  outline(g, 2, 1, 18, 18, 'rgba(27,31,42,0.85)');
  frame.drawImage(icon, 0, 0);
  return c;
}

/** Marcador de destino do clique (losango). */
export function targetArt(): HTMLCanvasElement {
  const [c, g] = canvas(16, 10);
  for (let y = 0; y < 5; y++) {
    rect(g, P.ipe, 8 - (y + 1) * 1.5, y, (y + 1) * 3, 1);
    rect(g, P.ipe, 8 - (y + 1) * 1.5, 9 - y, (y + 1) * 3, 1);
  }
  outline(g, 0, 0, 16, 10, P.ink);
  return c;
}
