/**
 * WorldScene: monta o mapa, liga os sistemas ECS e roda o loop:
 *   passo fixo (60 Hz) → predição local → envio de input
 *   todo frame          → interpolação remota → render
 * Nenhuma regra de jogo aqui; a cena só compõe sistemas e libera recursos no shutdown.
 */
import Phaser from 'phaser';
import { WORLD } from '@cesar-office/protocol';
import { SceneKeys, type SceneServices } from './scene-keys.ts';
import { mapCacheKey } from './preload-scene.ts';
import { findPath, loadWorldMap, type CollisionGrid, type Interactable, type TiledMap, type WorldMap } from '@cesar-office/world';
import { Depth, MapLayers, TextureKeys, TilesetNames } from '../world/map-contract.ts';
import { KeyboardIntent } from '../input/keyboard-intent.ts';
import { CompositeIntent, PathFollower } from '../ecs/systems/movement-intent.ts';
import { LocalMovementSystem } from '../ecs/systems/local-movement-system.ts';
import { NetSendSystem } from '../ecs/systems/net-send-system.ts';
import { InterpolationSystem } from '../ecs/systems/interpolation-system.ts';
import { RenderSystem } from '../ecs/systems/render-system.ts';
import { Position, RenderPosition } from '../ecs/components.ts';
import type { Unsubscribe } from '../core/event-bus.ts';

const FIXED_STEP_MS = 1000 / 60;
/** Evita "espiral da morte" após aba em segundo plano. */
const MAX_STEPS_PER_FRAME = 5;
const CAMERA_ZOOM = 2;
/** P-11 */
const INTERACT_RADIUS_PX = 1.5 * WORLD.TILE_PX;
/** P-14 */
const MAX_CLICK_PATH_TILES = 200;

export class WorldScene extends Phaser.Scene {
  private services!: SceneServices;
  private keyboard!: KeyboardIntent;
  private intent!: CompositeIntent;
  private movement!: LocalMovementSystem;
  private netSend!: NetSendSystem;
  private interpolation!: InterpolationSystem;
  private render!: RenderSystem;
  private grid!: CollisionGrid;
  private interactables: Interactable[] = [];
  private prompt: Interactable | undefined;
  private accumulator = 0;
  private cameraBound = false;
  private readonly unsubs: Unsubscribe[] = [];
  private ring!: Phaser.GameObjects.Graphics;
  private audible = new Set<string>();
  private speaking = new Set<string>();

  constructor() {
    super(SceneKeys.World);
  }

  init(data: SceneServices): void {
    this.services = data;
    this.accumulator = 0;
    this.cameraBound = false;
    this.prompt = undefined;
  }

  create(): void {
    const { session, bus } = this.services;
    const welcome = session.welcomeData;
    if (!welcome) throw new Error('WorldScene sem welcome');

    // ── Mapa ──
    const mapKey = mapCacheKey(welcome.map.mapId, welcome.map.version);
    const map = this.make.tilemap({ key: mapKey });
    const tileset = map.addTilesetImage(TilesetNames.Office, TextureKeys.Tiles);
    if (!tileset) throw new Error(`Tileset "${TilesetNames.Office}" ausente no mapa`);

    const visual: [string, number][] = [
      [MapLayers.Floor, Depth.Floor],
      [MapLayers.FloorDetail, Depth.Floor + 1],
      [MapLayers.Walls, Depth.Walls],
      [MapLayers.FurnitureBelow, Depth.FurnitureBelow],
      [MapLayers.FurnitureAbove, Depth.FurnitureAbove],
    ];
    for (const [name, depth] of visual) {
      if (map.getLayerIndex(name) === null) continue; // camada opcional
      map.createLayer(name, tileset, 0, 0)?.setDepth(depth);
    }

    // Colisão, zonas e interativos vêm do MESMO parser que o servidor usa (@cesar-office/world).
    const raw = this.cache.tilemap.get(mapKey) as { data: TiledMap } | undefined;
    if (!raw) throw new Error(`Tilemap "${mapKey}" fora do cache`);
    const world = loadWorldMap(raw.data);
    this.grid = world.grid;
    this.interactables = [...world.interactables];
    this.decorate(world);
    this.ring = this.add.graphics().setDepth(Depth.FurnitureBelow + 1);

    // ── Sistemas ──
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Teclado indisponível');
    this.keyboard = new KeyboardIntent(kb);
    this.intent = new CompositeIntent(this.keyboard, new PathFollower(WORLD.TILE_PX));
    const now = (): number => performance.now();
    this.movement = new LocalMovementSystem(session.world, this.grid, this.intent, now);
    this.netSend = new NetSendSystem(session.world, session.connection, now);
    this.interpolation = new InterpolationSystem(session.world, session.clock);
    this.render = new RenderSystem(this, session.world);

    session.attachView({
      onCorrection: (x, y) => this.movement.applyCorrection(x, y),
      onTeleport: (x, y) => {
        this.movement.teleport(x, y);
        this.netSend.reset();
      },
      onResynced: () => this.netSend.reset(),
    });

    // ── Câmera ──
    const cam = this.cameras.main;
    cam.setZoom(CAMERA_ZOOM);
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.setRoundPixels(true);

    // ── Input: clique para andar e interação ──
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    kb.on('keydown-E', () => this.interact());

    this.unsubs.push(
      bus.on('ui:focus-game', ({ focused }) => this.keyboard.setEnabled(focused)),
      bus.on('media:audible', ({ peers }) => {
        this.audible = new Set(peers.map((p) => p.userId));
      }),
      bus.on('media:speaking', ({ userIds }) => {
        this.speaking = new Set(userIds);
      }),
      bus.on('ui:interact', ({ objectKey }) => {
        const it = this.interactables.find((i) => i.key === objectKey);
        if (it) this.activate(it);
      }),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  override update(_time: number, delta: number): void {
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.movement.step(FIXED_STEP_MS);
      this.accumulator -= FIXED_STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.netSend.update();
    this.interpolation.update();
    this.render.update(this.interpolation.teleported);
    this.drawConversationRing();
    this.bindCameraOnce();
    this.updatePrompt();
  }

  // ───────────────────────────── leitura do espaço ─────────────────────────────

  /**
   * Regras visíveis no chão (06 §6): tapete de sala privada com nome e capacidade,
   * cadeiras e quadros marcados. Com arte final, o tapete vira tiles e isto some.
   */
  private decorate(world: WorldMap): void {
    const g = this.add.graphics().setDepth(Depth.Floor + 2);
    for (const z of world.zones) {
      g.fillStyle(0x2f6feb, 0.18).fillRect(z.rect.x, z.rect.y, z.rect.w, z.rect.h);
      g.lineStyle(2, 0x8fb4ff, 0.9).strokeRect(z.rect.x + 1, z.rect.y + 1, z.rect.w - 2, z.rect.h - 2);
      this.add
        .text(z.rect.x + 8, z.rect.y + 6, `${z.name} · até ${z.capacity}`, { fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: '#ffffff', backgroundColor: '#2F6FEBcc', padding: { x: 4, y: 2 } })
        .setResolution(4)
        .setDepth(Depth.Floor + 3);
    }
    const objects = this.add.graphics().setDepth(Depth.FurnitureBelow);
    for (const it of world.interactables) {
      if (it.type === 'chair') {
        objects.fillStyle(it.deskKey ? 0x4a5163 : 0x6e7689, 1).fillRoundedRect(it.x - 9, it.y - 9, 18, 18, 4);
        objects.fillStyle(0x2e3442, 1).fillRoundedRect(it.x - 7, it.y - 7, 14, 14, 3);
      } else if (it.type === 'portal') {
        objects.fillStyle(0xe6e2d6, 1).fillRect(it.x - 14, it.y - 12, 28, 18);
        objects.lineStyle(2, 0x5c3a2e, 1).strokeRect(it.x - 14, it.y - 12, 28, 18);
        objects.fillStyle(0x2f6feb, 1).fillRect(it.x - 10, it.y - 8, 12, 2).fillRect(it.x - 10, it.y - 4, 18, 2);
      }
    }
  }

  /** Anel da conversa (03 M2): quem eu ouço agora, e quem está falando. */
  private drawConversationRing(): void {
    const g = this.ring;
    g.clear();
    const world = this.services.session.world;
    const local = world.localEntity;
    if (local === null || this.audible.size === 0) return;
    const pulse = 0.55 + 0.25 * Math.sin(this.time.now / 300);
    const ringAt = (eid: number, talking: boolean): void => {
      const x = RenderPosition.x[eid] ?? 0;
      const y = RenderPosition.y[eid] ?? 0;
      g.lineStyle(talking ? 3 : 2, talking ? 0x3fb950 : 0x8fb4ff, talking ? 1 : pulse).strokeEllipse(x, y + 2, 34, 14);
    };
    const meta = world.metaOf(local);
    ringAt(local, meta ? this.speaking.has(meta.userId) : false);
    for (const userId of this.audible) {
      const eid = world.entityOfUser(userId);
      if (eid === undefined) continue;
      ringAt(eid, this.speaking.has(userId));
      g.lineStyle(1, 0x8fb4ff, 0.35).lineBetween(RenderPosition.x[local] ?? 0, (RenderPosition.y[local] ?? 0) + 2, RenderPosition.x[eid] ?? 0, (RenderPosition.y[eid] ?? 0) + 2);
    }
  }

  // ───────────────────────────── interação ─────────────────────────────

  private onPointerDown(p: Phaser.Input.Pointer): void {
    const eid = this.services.session.world.localEntity;
    if (eid === null) return;
    const world = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const from = { tx: Math.floor((Position.x[eid] ?? 0) / WORLD.TILE_PX), ty: Math.floor((Position.y[eid] ?? 0) / WORLD.TILE_PX) };
    const to = { tx: Math.floor(world.x / WORLD.TILE_PX), ty: Math.floor(world.y / WORLD.TILE_PX) };
    const path = findPath(this.grid, from, to, MAX_CLICK_PATH_TILES);
    if (path) this.intent.path.setPath(path);
  }

  private updatePrompt(): void {
    const eid = this.services.session.world.localEntity;
    if (eid === null) return;
    const px = Position.x[eid] ?? 0;
    const py = Position.y[eid] ?? 0;
    let near: Interactable | undefined;
    let best = INTERACT_RADIUS_PX;
    for (const it of this.interactables) {
      const d = Math.hypot(it.x - px, it.y - py);
      if (d <= best && it.type !== 'door') {
        near = it;
        best = d;
      }
    }
    if (near?.key === this.prompt?.key) return;
    this.prompt = near;
    this.services.bus.emit('world:interact-prompt', near ? { objectKey: near.key, label: this.labelFor(near) } : null);
  }

  private interact(): void {
    if (this.prompt) this.activate(this.prompt);
  }

  private activate(it: Interactable): void {
    if (it.type === 'portal') {
      if (it.url) this.services.bus.emit('world:open-portal', { objectKey: it.key, name: it.name, url: it.url });
      return;
    }
    this.services.session.send({ t: 'interact', objectKey: it.key }); // servidor valida distância e ocupação
  }

  private labelFor(it: Interactable): string {
    switch (it.type) {
      case 'chair':
        return 'Sentar';
      case 'portal':
        return `Abrir ${it.name}`;
      case 'door':
        return 'Entrar';
    }
  }

  private bindCameraOnce(): void {
    if (this.cameraBound) return;
    const eid = this.services.session.world.localEntity;
    if (eid === null) return;
    const sprite = this.render.spriteOf(eid);
    if (!sprite) return;
    this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
    this.cameraBound = true;
  }

  private cleanup(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.services.session.detachView();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    if (this.input.keyboard) this.keyboard.destroy(this.input.keyboard);
    this.render.destroy();
  }
}
