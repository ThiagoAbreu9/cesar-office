/**
 * Avatares 32×48 gerados a partir do `look` (pele, cabelo, roupa). Folha 160×192:
 * 5 colunas (4 de caminhada + sentado) × 4 linhas (baixo, esquerda, direita, cima).
 * Pés em y ≈ 41 (origem 0,5 / 0,85 no RenderSystem). Contorno automático de 1 px.
 */
import type { AvatarLook } from '@cesar-office/protocol';
import { canvas, ellipse, outline, rect, shade, type Ctx } from './pixel.ts';
import { decodeHair, OUTFITS, P, SKINS } from './palette.ts';

export const FRAME_W = 32;
export const FRAME_H = 48;
export const SHEET_COLS = 5;

const DOWN = 0;
const LEFT = 1;
const RIGHT = 2;
const UP = 3;

interface Colors {
  skin: string;
  skinShade: string;
  shirt: string;
  shirtShade: string;
  pants: string;
  hair: string;
  hairShade: string;
  hairStyle: number;
}

function colorsOf(look: AvatarLook): Colors {
  const skin = SKINS[look.body % SKINS.length] ?? SKINS[0];
  const outfit = OUTFITS[look.outfit % OUTFITS.length] ?? OUTFITS[0];
  const hair = decodeHair(look.hair);
  return {
    skin: skin.base,
    skinShade: skin.shade,
    shirt: outfit.shirt,
    shirtShade: shade(outfit.shirt, -0.22),
    pants: outfit.pants,
    hair: hair.color,
    hairShade: shade(hair.color, -0.3),
    hairStyle: hair.style,
  };
}

/** Desenha um quadro (sem contorno) com origem (ox, oy). */
function drawFrame(g: Ctx, ox: number, oy: number, dir: number, col: number, c: Colors): void {
  const sitting = col === 4;
  const step = sitting ? 0 : ([1, 0, -1, 0][col] ?? 0);
  const bob = !sitting && (col === 1 || col === 3) ? -1 : 0;
  const lift = sitting ? 4 : 0;
  const X = ox;
  const Y = oy + bob + lift;
  const side = dir === LEFT || dir === RIGHT;
  const flip = dir === LEFT ? -1 : 1;

  // ── pernas e sapatos ──
  if (sitting) {
    if (dir === DOWN) {
      rect(g, c.pants, X + 11, Y + 30, 10, 4);
      rect(g, P.ink, X + 11, Y + 34, 4, 2);
      rect(g, P.ink, X + 17, Y + 34, 4, 2);
    } else if (side) {
      rect(g, c.pants, X + (dir === RIGHT ? 13 : 9), Y + 30, 10, 3);
      rect(g, P.ink, X + (dir === RIGHT ? 21 : 9), Y + 30, 2, 5);
    } else {
      rect(g, c.pants, X + 11, Y + 30, 10, 3);
    }
  } else if (side) {
    // pernas sobrepostas: a da frente avança, a de trás recua
    const front = step * 2 * flip;
    rect(g, shade(c.pants, -0.2), X + 14 - front, Y + 31, 4, 7 - Math.abs(step));
    rect(g, P.ink, X + 14 - front + (flip > 0 ? 0 : -1), Y + 38 - Math.abs(step), 5, 2);
    rect(g, c.pants, X + 14 + front, Y + 31, 4, 7);
    rect(g, P.ink, X + 14 + front + (flip > 0 ? 0 : -1), Y + 38, 5, 2);
  } else {
    const l = step > 0 ? 2 : 0;
    const r = step < 0 ? 2 : 0;
    rect(g, c.pants, X + 11, Y + 31, 4, 7 - l);
    rect(g, c.pants, X + 17, Y + 31, 4, 7 - r);
    rect(g, P.ink, X + 11, Y + 38 - l, 4, 2);
    rect(g, P.ink, X + 17, Y + 38 - r, 4, 2);
    rect(g, shade(c.pants, -0.25), X + 15, Y + 31, 2, 3);
  }

  // ── tronco ──
  rect(g, c.shirt, X + 10, Y + 21, 12, 11);
  rect(g, c.shirtShade, X + 10, Y + 29, 12, 2); // cintura
  if (dir === DOWN) {
    rect(g, c.shirtShade, X + 19, Y + 22, 3, 7);
    rect(g, c.skin, X + 14, Y + 21, 4, 2); // pescoço/gola
    rect(g, shade(c.shirt, 0.25), X + 13, Y + 23, 1, 1);
    rect(g, shade(c.shirt, 0.25), X + 18, Y + 23, 1, 1);
  } else if (dir === UP) {
    rect(g, c.shirtShade, X + 10, Y + 22, 2, 7);
  } else {
    rect(g, c.shirtShade, X + (dir === RIGHT ? 10 : 19), Y + 22, 3, 7);
  }

  // ── braços ──
  if (side) {
    const swing = sitting ? 2 : step * 2;
    const ax = X + 15 + swing * flip;
    rect(g, c.shirtShade, ax, Y + 22, 3, 5);
    rect(g, c.skin, ax, Y + 27, 3, 2);
  } else {
    const s = sitting ? 0 : step;
    rect(g, c.shirt, X + 8, Y + 22 + s, 2, 5);
    rect(g, c.skin, X + 8, Y + 27 + s, 2, 2);
    rect(g, c.shirt, X + 22, Y + 22 - s, 2, 5);
    rect(g, c.skin, X + 22, Y + 27 - s, 2, 2);
  }

  // ── cabeça ──
  const hx = X + 10;
  const hy = Y + 9;
  rect(g, c.skin, hx + 1, hy, 10, 12);
  rect(g, c.skin, hx, hy + 1, 12, 10);
  rect(g, c.skinShade, hx + 1, hy + 10, 10, 2);
  if (dir === DOWN) {
    rect(g, P.ink, hx + 3, hy + 6, 1, 2);
    rect(g, P.ink, hx + 8, hy + 6, 1, 2);
    rect(g, '#E89A8A', hx + 2, hy + 8, 1, 1);
    rect(g, '#E89A8A', hx + 9, hy + 8, 1, 1);
    rect(g, c.skinShade, hx + 5, hy + 9, 2, 1);
  } else if (side) {
    rect(g, P.ink, hx + (dir === RIGHT ? 8 : 3), hy + 6, 1, 2);
    rect(g, '#E89A8A', hx + (dir === RIGHT ? 9 : 2), hy + 8, 1, 1);
    rect(g, c.skin, dir === RIGHT ? hx + 12 : hx - 1, hy + 6, 1, 2); // nariz
  }

  hair(g, hx, hy, dir, c, step);
}

function hair(g: Ctx, hx: number, hy: number, dir: number, c: Colors, step: number): void {
  const H = c.hair;
  const S = c.hairShade;
  const style = c.hairStyle;
  const side = dir === LEFT || dir === RIGHT;
  const back = dir === RIGHT ? hx : hx + 7; // lado da nuca no perfil

  if (style === 2) {
    // cacheado: volume que passa da cabeça, borda irregular
    ellipse(g, H, hx + 6, hy + 3, 8, 5);
    for (let i = 0; i < 6; i++) rect(g, H, hx - 1 + i * 3, hy - 3 + (i % 2), 2, 2);
    if (dir === UP) ellipse(g, H, hx + 6, hy + 6, 8, 6);
    else if (side) ellipse(g, H, back + 2, hy + 6, 4, 5);
    else {
      rect(g, H, hx - 2, hy + 2, 3, 7);
      rect(g, H, hx + 11, hy + 2, 3, 7);
    }
    for (let i = 0; i < 5; i++) rect(g, S, hx + 1 + i * 2, hy + (i % 2) * 2, 1, 1);
    return;
  }

  // base curta, comum aos outros estilos
  rect(g, H, hx + 1, hy - 1, 10, 4);
  rect(g, H, hx, hy, 12, 3);
  if (dir === DOWN) {
    rect(g, H, hx, hy + 3, 2, 3);
    rect(g, H, hx + 10, hy + 3, 2, 3);
    rect(g, S, hx + 4, hy + 2, 3, 1); // franja
  } else if (dir === UP) {
    rect(g, H, hx, hy, 12, 9);
    rect(g, S, hx + 2, hy + 7, 8, 1);
  } else {
    rect(g, H, back, hy, 5, 7);
    rect(g, S, back + (dir === RIGHT ? 0 : 4), hy + 2, 1, 4);
  }

  if (style === 1) {
    // longo: desce pelos lados e pelas costas
    if (dir === DOWN) {
      rect(g, H, hx - 1, hy + 2, 3, 13);
      rect(g, H, hx + 10, hy + 2, 3, 13);
    } else if (dir === UP) rect(g, H, hx, hy + 8, 12, 8);
    else rect(g, H, back - (dir === RIGHT ? 1 : -1), hy + 4, 5, 11);
  } else if (style === 3) {
    // coque no alto
    ellipse(g, H, hx + 6, hy - 3, 3, 2);
    rect(g, S, hx + 5, hy - 1, 3, 1);
  } else if (style === 4) {
    // rabo de cavalo que balança com o passo
    if (dir === UP) {
      rect(g, H, hx + 5, hy + 8, 3, 7);
      rect(g, S, hx + 5, hy + 14, 3, 1);
    } else if (side) {
      const tx = dir === RIGHT ? hx - 3 : hx + 12;
      rect(g, H, tx, hy + 3 + step, 3, 8);
    }
  }
}

/** Folha completa para um look (usada no jogo e nas prévias do crachá). */
export function avatarSheet(look: AvatarLook): HTMLCanvasElement {
  const c = colorsOf(look);
  const [sheet, sg] = canvas(FRAME_W * SHEET_COLS, FRAME_H * 4);
  const [frame, fg] = canvas(FRAME_W, FRAME_H);
  for (let dir = 0; dir < 4; dir++) {
    for (let col = 0; col < SHEET_COLS; col++) {
      fg.clearRect(0, 0, FRAME_W, FRAME_H);
      drawFrame(fg, 0, 0, dir, col, c);
      outline(fg, 0, 0, FRAME_W, FRAME_H, P.ink);
      const ox = col * FRAME_W;
      const oy = dir * FRAME_H;
      // sombra no chão por baixo de tudo
      sg.fillStyle = 'rgba(27,31,42,0.28)';
      ellipse(sg, 'rgba(27,31,42,0.28)', ox + 16, oy + 41, 8, 2);
      sg.drawImage(frame, ox, oy);
    }
  }
  return sheet;
}

/** Chave de textura por look; looks iguais compartilham folha e animações. */
export const lookKey = (look: AvatarLook): string => `avatar-${look.body}-${look.hair}-${look.outfit}`;
