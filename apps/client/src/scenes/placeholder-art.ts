/**
 * Arte provisória gerada por código (paleta de 06 §5), para o jogo rodar antes dos assets reais.
 * Mesmas chaves e dimensões dos arquivos definitivos: trocar por PNGs não muda as cenas.
 */
import type Phaser from 'phaser';
import { EMOTE_KINDS } from '@cesar-office/protocol';
import { TextureKeys } from '../world/map-contract.ts';
import { tilesetCanvas } from '../art/tiles.ts';
import { boardArt, chairArt, emoteArt, targetArt } from '../art/props.ts';
import { canvas, disc } from '../art/pixel.ts';
import { P } from '../art/palette.ts';

export { avatarSheet } from '../art/avatars.ts';

function statusDot(): HTMLCanvasElement {
  const [c, g] = canvas(8, 8);
  disc(g, P.ink, 4, 4, 3);
  disc(g, P.white, 4, 4, 2);
  return c;
}

/** Texturas compartilhadas (idempotente). Avatares são gerados sob demanda pela AvatarLibrary. */
export function registerPlaceholderArt(textures: Phaser.Textures.TextureManager): void {
  const add = (key: string, make: () => HTMLCanvasElement): void => {
    if (!textures.exists(key)) textures.addCanvas(key, make());
  };
  add(TextureKeys.Tiles, tilesetCanvas);
  add(TextureKeys.StatusDot, statusDot);
  registerDecorArt(textures);
}

/** Arte de interface do mundo (cadeiras, quadros, reações, marcador). Também usada com assets reais. */
export function registerDecorArt(textures: Phaser.Textures.TextureManager): void {
  const add = (key: string, make: () => HTMLCanvasElement): void => {
    if (!textures.exists(key)) textures.addCanvas(key, make());
  };
  add(TextureKeys.Chair('office', true), () => chairArt('office', true));
  add(TextureKeys.Chair('office', false), () => chairArt('office', false));
  add(TextureKeys.Chair('meeting', true), () => chairArt('meeting', true));
  add(TextureKeys.Chair('meeting', false), () => chairArt('meeting', false));
  add(TextureKeys.Board, boardArt);
  add(TextureKeys.Target, targetArt);
  for (const k of EMOTE_KINDS) add(TextureKeys.Emote(k), () => emoteArt(k));
}
