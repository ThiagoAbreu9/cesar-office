/**
 * Resolve o `look` de uma pessoa para uma textura de avatar com animações prontas.
 * - `files`: assets do artista, uma folha por corpo (carregadas no Preload).
 * - `generated`: uma folha por look, desenhada na primeira vez que alguém com aquele look aparece.
 * Milhares de pessoas reaproveitam poucas folhas: o número de combinações é limitado (4 × 15 × 6).
 */
import type Phaser from 'phaser';
import type { AvatarLook } from '@cesar-office/protocol';
import { TextureKeys } from '../world/map-contract.ts';
import { avatarSheet, FRAME_H, FRAME_W, lookKey, SHEET_COLS } from './avatars.ts';

const DIR_NAMES = ['down', 'left', 'right', 'up'] as const;

export type AnimKind = 'idle' | 'walk' | 'sit';

export function animKey(texture: string, kind: AnimKind, facing: number): string {
  return `${texture}-${kind}-${DIR_NAMES[facing & 3] ?? 'down'}`;
}

export class AvatarLibrary {
  constructor(
    private readonly textures: Phaser.Textures.TextureManager,
    private readonly anims: Phaser.Animations.AnimationManager,
    private readonly mode: 'files' | 'generated',
  ) {}

  /** Chave da textura (com animações registradas) para o look. */
  ensure(look: AvatarLook): string {
    if (this.mode === 'files') {
      const key = TextureKeys.Avatar(look.body);
      this.createAnims(key);
      return key;
    }
    const key = lookKey(look);
    if (!this.textures.exists(key)) {
      const tex = this.textures.addCanvas(key, avatarSheet(look));
      if (tex) {
        let i = 0;
        for (let row = 0; row < 4; row++) for (let col = 0; col < SHEET_COLS; col++) tex.add(i++, 0, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
      }
    }
    this.createAnims(key);
    return key;
  }

  private createAnims(tex: string): void {
    if (this.anims.exists(animKey(tex, 'idle', 0))) return;
    for (let dir = 0; dir < 4; dir++) {
      const row = dir * SHEET_COLS;
      const defs: [string, number[], number, number][] = [
        [animKey(tex, 'walk', dir), [row, row + 1, row + 2, row + 3], 8, -1],
        [animKey(tex, 'idle', dir), [row], 1, 0],
        [animKey(tex, 'sit', dir), [row + 4], 1, 0],
      ];
      for (const [key, frames, frameRate, repeat] of defs) {
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(tex, { frames }), frameRate, repeat });
      }
    }
  }
}
