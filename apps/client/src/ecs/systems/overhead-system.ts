/**
 * O que aparece sobre a cabeça: balões de fala do chat "Aqui" (RN-M5-6) e reações (emotes).
 * Só desenha; quem decide quem vê o quê é o servidor (o balão só chega a quem estava na conversa).
 */
import Phaser from 'phaser';
import type { EmoteKind } from '@cesar-office/protocol';
import { RenderPosition } from '../components.ts';
import type { WorldState } from '../world-state.ts';
import { Depth, TextureKeys } from '../../world/map-contract.ts';

const BUBBLE_MS = 6_000;
const BUBBLE_MAX_CHARS = 90;
const BUBBLE_WRAP_PX = 120;
const HEAD_Y = -44;
const EMOTE_MS = 1_800;

interface Bubble {
  readonly box: Phaser.GameObjects.Container;
  readonly height: number;
  until: number;
}

interface Emote {
  readonly eid: number;
  readonly img: Phaser.GameObjects.Image;
  readonly born: number;
}

export class OverheadSystem {
  private readonly bubbles = new Map<number, Bubble>();
  private emotes: Emote[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: WorldState,
  ) {}

  showChat(eid: number, body: string, now: number): void {
    this.bubbles.get(eid)?.box.destroy();
    const text = body.length > BUBBLE_MAX_CHARS ? `${body.slice(0, BUBBLE_MAX_CHARS - 1)}…` : body;
    const label = this.scene.add
      .text(0, 0, text, {
        fontFamily: '"Atkinson Hyperlegible", system-ui, sans-serif',
        fontSize: '8px',
        color: '#1B1F2A',
        wordWrap: { width: BUBBLE_WRAP_PX, useAdvancedWrap: true },
        lineSpacing: 1,
      })
      .setResolution(4)
      .setOrigin(0.5, 1);
    const w = Math.ceil(label.width) + 10;
    const h = Math.ceil(label.height) + 6;
    const g = this.scene.add.graphics();
    g.fillStyle(0x1b1f2a, 1).fillRoundedRect(-w / 2 - 1, -h - 1, w + 2, h + 2, 4);
    g.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -h, w, h, 3);
    g.fillStyle(0x1b1f2a, 1).fillTriangle(-4, 0, 4, 0, 0, 5);
    g.fillStyle(0xffffff, 1).fillTriangle(-3, -1, 3, -1, 0, 3);
    label.setPosition(0, -3);
    const box = this.scene.add.container(0, 0, [g, label]).setDepth(Depth.Bubbles);
    box.setScale(0.6).setAlpha(0);
    this.scene.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 140, ease: 'Back.Out' });
    this.bubbles.set(eid, { box, height: h, until: now + BUBBLE_MS + text.length * 30 });
  }

  showEmote(eid: number, kind: EmoteKind, now: number): void {
    const img = this.scene.add.image(0, 0, TextureKeys.Emote(kind)).setOrigin(0.5, 1).setDepth(Depth.Bubbles + 1);
    this.emotes.push({ eid, img, born: now });
  }

  update(now: number): void {
    for (const [eid, b] of this.bubbles) {
      if (now > b.until || this.state.metaOf(eid) === undefined) {
        this.bubbles.delete(eid);
        this.fadeOut(b.box);
        continue;
      }
      b.box.setPosition(Math.round(RenderPosition.x[eid] ?? 0), Math.round((RenderPosition.y[eid] ?? 0) + HEAD_Y));
    }
    const alive: Emote[] = [];
    for (const e of this.emotes) {
      const t = (now - e.born) / EMOTE_MS;
      if (t >= 1 || this.state.metaOf(e.eid) === undefined) {
        e.img.destroy();
        continue;
      }
      // sobe um pouco, "pula" no início e some no fim; fica acima do balão se houver
      const lift = this.bubbles.get(e.eid)?.height ?? 0;
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : t < 0.25 ? 1.1 - ((t - 0.15) / 0.1) * 0.1 : 1;
      e.img.setScale(pop).setAlpha(t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1);
      e.img.setPosition(Math.round(RenderPosition.x[e.eid] ?? 0), Math.round((RenderPosition.y[e.eid] ?? 0) + HEAD_Y - lift - 4 - t * 10));
      alive.push(e);
    }
    this.emotes = alive;
  }

  destroy(): void {
    for (const b of this.bubbles.values()) b.box.destroy();
    for (const e of this.emotes) e.img.destroy();
    this.bubbles.clear();
    this.emotes = [];
  }

  private fadeOut(box: Phaser.GameObjects.Container): void {
    this.scene.tweens.add({ targets: box, alpha: 0, y: box.y - 4, duration: 220, onComplete: () => box.destroy() });
  }
}
