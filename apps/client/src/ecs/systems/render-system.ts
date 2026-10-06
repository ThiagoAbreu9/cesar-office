/**
 * Ponte ECS → Phaser. Único sistema que conhece GameObjects.
 * Pooling: sprites/labels de entidades removidas voltam ao pool (entram e saem da AOI o tempo todo).
 */
import Phaser from 'phaser';
import { query } from 'bitecs';
import { unpackState, type PresenceStatus } from '@cesar-office/protocol';
import { AvatarState, RenderPosition } from '../components.ts';
import type { WorldState } from '../world-state.ts';
import { Depth, TextureKeys } from '../../world/map-contract.ts';
import { animKey, type AvatarLibrary } from '../../art/avatar-library.ts';

interface View {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.BitmapText | Phaser.GameObjects.Text;
  dot: Phaser.GameObjects.Image;
  animKey: string;
  texture: string;
  status: PresenceStatus | null;
}

const STATUS_TINT: Record<PresenceStatus, number> = {
  available: 0x3fb950,
  in_meeting: 0xd29922,
  dnd: 0xf85149,
  away: 0x8b949e,
};

const LABEL_OFFSET_Y = -32;
const FADE_MS = 200;
const GHOST_ALPHA = 0.4;

export class RenderSystem {
  private readonly views = new Map<number, View>();
  private readonly pool: View[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: WorldState,
    private readonly avatars: AvatarLibrary,
  ) {}

  update(teleported: ReadonlySet<number>): void {
    for (const eid of this.state.drainDespawned()) this.release(eid);
    for (const eid of this.state.drainSpawned()) this.acquire(eid);

    for (const eid of query(this.state.ecs, [RenderPosition, AvatarState])) {
      const v = this.views.get(eid);
      if (!v) continue;
      const x = Math.round(RenderPosition.x[eid] ?? 0);
      const y = Math.round(RenderPosition.y[eid] ?? 0);
      const s = unpackState(AvatarState.packed[eid] ?? 0);
      const meta = this.state.metaOf(eid);

      v.sprite.setPosition(x, y).setDepth(Depth.Actors + y);
      if (s.ghost) v.sprite.setAlpha(GHOST_ALPHA);
      else if (v.sprite.alpha === GHOST_ALPHA) v.sprite.setAlpha(1);
      v.label.setPosition(x, y + LABEL_OFFSET_Y);
      v.dot.setPosition(x - v.label.width / 2 - 6, y + LABEL_OFFSET_Y - v.label.height / 2);

      if (meta) {
        if (v.label.text !== meta.displayName) v.label.setText(meta.displayName);
        if (v.status !== meta.status) {
          v.dot.setTint(STATUS_TINT[meta.status]);
          v.status = meta.status;
        }
        const kind = s.sitting ? 'sit' : s.moving ? 'walk' : 'idle';
        const key = animKey(v.texture, kind, s.facing);
        if (v.animKey !== key) {
          v.sprite.anims.play(key, true);
          v.animKey = key;
        }
      }

      if (teleported.has(eid)) this.fadeIn(v);
    }
  }

  /** Sprite do avatar local (alvo da câmera). */
  spriteOf(eid: number): Phaser.GameObjects.Sprite | undefined {
    return this.views.get(eid)?.sprite;
  }

  fadeIn(v: View): void {
    for (const o of [v.sprite, v.label, v.dot]) {
      o.setAlpha(0);
      this.scene.tweens.add({ targets: o, alpha: 1, duration: FADE_MS });
    }
  }

  destroy(): void {
    for (const v of [...this.views.values(), ...this.pool]) {
      v.sprite.destroy();
      v.label.destroy();
      v.dot.destroy();
    }
    this.views.clear();
    this.pool.length = 0;
  }

  private acquire(eid: number): void {
    this.release(eid); // id reciclado pelo bitECS no mesmo frame
    const meta = this.state.metaOf(eid);
    const texture = this.avatars.ensure(meta?.look ?? { body: 0, hair: 0, outfit: 0 });
    let v = this.pool.pop();
    if (!v) {
      v = {
        sprite: this.scene.add.sprite(0, 0, texture).setOrigin(0.5, 0.85),
        label: this.makeLabel(),
        dot: this.scene.add.image(0, 0, TextureKeys.StatusDot).setDepth(Depth.Labels),
        animKey: '',
        texture,
        status: null,
      };
    } else {
      v.sprite.setTexture(texture);
      v.texture = texture;
      v.animKey = '';
      v.status = null;
    }
    for (const o of [v.sprite, v.label, v.dot]) o.setVisible(true).setActive(true).setAlpha(1);
    v.label.setText(meta?.displayName ?? '');
    this.views.set(eid, v);
  }

  /** BitmapText quando a fonte existe (produção); Text nítido como reserva (arte provisória). */
  private makeLabel(): Phaser.GameObjects.BitmapText | Phaser.GameObjects.Text {
    if (this.scene.cache.bitmapFont.exists(TextureKeys.UiFont)) {
      return this.scene.add.bitmapText(0, 0, TextureKeys.UiFont, '', 8).setOrigin(0.5, 1).setDepth(Depth.Labels);
    }
    return this.scene.add
      .text(0, 0, '', { fontFamily: '"Atkinson Hyperlegible", system-ui, sans-serif', fontSize: '9px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#1B1F2Ad9', padding: { x: 4, y: 1 } })
      .setResolution(4)
      .setOrigin(0.5, 1)
      .setDepth(Depth.Labels);
  }

  private release(eid: number): void {
    const v = this.views.get(eid);
    if (!v) return;
    this.views.delete(eid);
    v.sprite.anims.stop();
    for (const o of [v.sprite, v.label, v.dot]) {
      this.scene.tweens.killTweensOf(o);
      o.setVisible(false).setActive(false);
    }
    this.pool.push(v);
  }
}
