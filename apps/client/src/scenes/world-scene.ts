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
import { findPath, loadWorldMap, type CollisionGrid, type Interactable, type TiledMap } from '@cesar-office/world';
import { Depth, MapLayers, TextureKeys, TilesetNames } from '../world/map-contract.ts';
import { KeyboardIntent } from '../input/keyboard-intent.ts';
import { CompositeIntent, PathFollower } from '../ecs/systems/movement-intent.ts';
import { LocalMovementSystem } from '../ecs/systems/local-movement-system.ts';
import { NetSendSystem } from '../ecs/systems/net-send-system.ts';
import { InterpolationSystem } from '../ecs/systems/interpolation-system.ts';
import { RenderSystem } from '../ecs/systems/render-system.ts';
import { Position } from '../ecs/components.ts';
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
    this.bindCameraOnce();
    this.updatePrompt();
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
