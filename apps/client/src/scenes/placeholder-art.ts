/**
 * Arte provisória gerada por código (paleta de 06 §5), para o MVP rodar antes dos assets reais.
 * Mesmas chaves e dimensões dos arquivos definitivos: trocar por PNGs não muda nada no resto.
 */
import type Phaser from 'phaser';
import { TextureKeys } from '../world/map-contract.ts';

const P = {
  ink: '#1B1F2A',
  deep: '#2E3442',
  wallDark: '#4A5163',
  wallMid: '#6E7689',
  wallLight: '#A3AABA',
  offWhite: '#E6E2D6',
  floor: '#D9CBB0',
  floorShade: '#BFAE8E',
  woodDark: '#5C3A2E',
  wood: '#8A5A3C',
  woodLight: '#C08552',
  skin: '#E8B996',
  skinShade: '#C9956F',
} as const;

const SHIRTS = ['#2F6FEB', '#E5A84B', '#4FA36B'] as const;
const HAIR = ['#2E3442', '#5C3A2E', '#1B1F2A'] as const;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas 2D indisponível');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

const rect = (g: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void => {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
};

/** Tileset 512×512 (16×16 tiles). gids do mapa Sede: 1 piso, 2 colisão (invisível), 3 parede, 4 mobília. */
function tileset(): HTMLCanvasElement {
  const [c, g] = canvas(512, 512);
  // gid 1 — piso: porcelanato com junta e leve variação
  rect(g, P.floor, 0, 0, 32, 32);
  rect(g, P.floorShade, 0, 31, 32, 1);
  rect(g, P.floorShade, 31, 0, 1, 32);
  rect(g, '#E2D6BE', 3, 3, 6, 2);
  // gid 2 — colisão (camada oculta; só para o editor)
  rect(g, 'rgba(248,81,73,0.45)', 32, 0, 32, 32);
  // gid 3 — parede: topo claro, face média, rodapé escuro
  rect(g, P.wallMid, 64, 0, 32, 32);
  rect(g, P.wallLight, 64, 0, 32, 7);
  rect(g, P.wallDark, 64, 28, 32, 4);
  rect(g, P.ink, 64, 7, 32, 1);
  // gid 4 — mobília: tampo de madeira com contorno e brilho
  rect(g, P.woodDark, 96, 0, 32, 32);
  rect(g, P.wood, 97, 1, 30, 28);
  rect(g, P.woodLight, 99, 3, 26, 3);
  rect(g, P.ink, 96, 31, 32, 1);
  return c;
}

/**
 * Spritesheet 160×192: 5 colunas (4 de caminhada + sentado) × 4 linhas (baixo, esquerda, direita, cima).
 * Quadro de 32×48, pés no último terço (origem 0,5 / 0,85 no RenderSystem).
 */
export function avatarSheet(body: number): HTMLCanvasElement {
  const [c, g] = canvas(160, 192);
  const shirt = SHIRTS[body % SHIRTS.length] ?? SHIRTS[0];
  const hair = HAIR[body % HAIR.length] ?? HAIR[0];
  for (let dir = 0; dir < 4; dir++) {
    for (let col = 0; col < 5; col++) {
      const ox = col * 32;
      const oy = dir * 48;
      const sitting = col === 4;
      const step = sitting ? 0 : [0, 1, 0, -1][col] ?? 0;
      const bob = !sitting && (col === 1 || col === 3) ? 1 : 0;
      const sy = sitting ? 4 : 0;
      const x0 = ox + 8;
      const y0 = oy + 8 + bob + sy;

      // sombra no chão
      g.fillStyle = 'rgba(27,31,42,0.25)';
      g.beginPath();
      g.ellipse(ox + 16, oy + 41, 9, 3, 0, 0, Math.PI * 2);
      g.fill();

      // pernas
      if (sitting) {
        rect(g, P.deep, x0 + 3, y0 + 26, 10, 4);
      } else {
        rect(g, P.deep, x0 + 3, y0 + 24 + Math.max(0, step), 4, 8 - Math.max(0, step));
        rect(g, P.deep, x0 + 9, y0 + 24 + Math.max(0, -step), 4, 8 - Math.max(0, -step));
        rect(g, P.ink, x0 + 3, y0 + 31, 4, 1);
        rect(g, P.ink, x0 + 9, y0 + 31, 4, 1);
      }
      // tronco + braços
      rect(g, P.ink, x0 + 1, y0 + 13, 14, 12);
      rect(g, shirt, x0 + 2, y0 + 14, 12, 10);
      if (dir === 1 || dir === 2) rect(g, shirt, x0 + (dir === 1 ? 6 : 8) + step, y0 + 16, 2, 7);
      else {
        rect(g, P.skin, x0, y0 + 16 + step, 2, 6);
        rect(g, P.skin, x0 + 14, y0 + 16 - step, 2, 6);
      }
      // cabeça
      rect(g, P.ink, x0 + 2, y0, 12, 13);
      rect(g, P.skin, x0 + 3, y0 + 1, 10, 11);
      rect(g, P.skinShade, x0 + 3, y0 + 10, 10, 2);
      // cabelo e rosto conforme a direção
      if (dir === 3) {
        rect(g, hair, x0 + 3, y0 + 1, 10, 10);
      } else {
        rect(g, hair, x0 + 3, y0 + 1, 10, 4);
        if (dir === 0) {
          rect(g, P.ink, x0 + 5, y0 + 6, 2, 2);
          rect(g, P.ink, x0 + 9, y0 + 6, 2, 2);
        } else {
          rect(g, hair, dir === 1 ? x0 + 10 : x0 + 3, y0 + 1, 3, 8);
          rect(g, P.ink, dir === 1 ? x0 + 4 : x0 + 10, y0 + 6, 2, 2);
        }
      }
    }
  }
  return c;
}

function statusDot(): HTMLCanvasElement {
  const [c, g] = canvas(8, 8);
  g.fillStyle = P.ink;
  g.beginPath();
  g.arc(4, 4, 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(4, 4, 3, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** Registra as texturas provisórias no gerenciador do Phaser (idempotente). */
export function registerPlaceholderArt(textures: Phaser.Textures.TextureManager, bodies: readonly number[]): void {
  if (!textures.exists(TextureKeys.Tiles)) textures.addCanvas(TextureKeys.Tiles, tileset());
  if (!textures.exists(TextureKeys.StatusDot)) textures.addCanvas(TextureKeys.StatusDot, statusDot());
  for (const b of bodies) {
    const key = TextureKeys.Avatar(b);
    if (textures.exists(key)) continue;
    const tex = textures.addCanvas(key, avatarSheet(b));
    if (!tex) continue;
    let i = 0;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) tex.add(i++, 0, col * 32, row * 48, 32, 48);
  }
}
