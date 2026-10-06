/**
 * Preload: tilemap versionado (chave inclui versão → cache busting correto),
 * tileset, spritesheets de avatar, fonte bitmap e criação das animações.
 */
import Phaser from 'phaser';
import { SceneKeys, type SceneServices } from './scene-keys.ts';
import { TextureKeys } from '../world/map-contract.ts';
import { registerDecorArt, registerPlaceholderArt } from './placeholder-art.ts';

/** Corpos disponíveis no MVP (06 §6). */
const AVATAR_BODIES = [0, 1, 2] as const;
/** Spritesheet 32×48: linhas = direções (baixo, esquerda, direita, cima); colunas 0–3 walk; coluna 4 sit. */
const FRAME_W = 32;
const FRAME_H = 48;

export function mapCacheKey(mapId: string, version: number): string {
  return `map-${mapId}-v${version}`;
}

export class PreloadScene extends Phaser.Scene {
  private services!: SceneServices;

  constructor() {
    super(SceneKeys.Preload);
  }

  init(data: SceneServices): void {
    this.services = data;
  }

  preload(): void {
    const welcome = this.services.session.welcomeData;
    if (!welcome) throw new Error('PreloadScene sem welcome');
    const base = this.services.assetBaseUrl;

    const bar = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, 0, 6, 0xffffff).setOrigin(0, 0.5);
    const barMax = this.scale.width * 0.4;
    bar.x -= barMax / 2;
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => bar.setSize(barMax * p, 6));

    const mapKey = mapCacheKey(welcome.map.mapId, welcome.map.version);
    if (this.services.inlineMap !== undefined) {
      this.cache.tilemap.add(mapKey, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: this.services.inlineMap });
    } else {
      this.load.tilemapTiledJSON(mapKey, welcome.map.url);
    }
    if (this.services.art === 'placeholder') return;

    this.load.image(TextureKeys.Tiles, `${base}/tilesets/office-32.png`);
    this.load.image(TextureKeys.StatusDot, `${base}/ui/status-dot.png`);
    this.load.bitmapFont(TextureKeys.UiFont, `${base}/fonts/ui-8.png`, `${base}/fonts/ui-8.xml`);
    for (const b of AVATAR_BODIES) {
      this.load.spritesheet(TextureKeys.Avatar(b), `${base}/avatars/body-${b}.png`, { frameWidth: FRAME_W, frameHeight: FRAME_H });
    }
  }

  create(): void {
    if (this.services.art === 'placeholder') registerPlaceholderArt(this.textures);
    else registerDecorArt(this.textures);
    // Animações de avatar são criadas sob demanda pela AvatarLibrary (WorldScene).
    this.scene.start(SceneKeys.World, this.services);
  }
}
