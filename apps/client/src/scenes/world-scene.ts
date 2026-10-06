/**
 * WorldScene: monta o mapa, liga os sistemas ECS e roda o loop:
 *   passo fixo (60 Hz) → predição local → envio de input
 *   todo frame          → interpolação remota → render → balões/reações
 * Nenhuma regra de jogo aqui; a cena só compõe sistemas, traduz input e libera recursos no shutdown.
 */
import Phaser from 'phaser';
import { EMOTE_KINDS, Facing, WORLD, type EmoteKind } from '@cesar-office/protocol';
import { SceneKeys, type SceneServices } from './scene-keys.ts';
import { mapCacheKey } from './preload-scene.ts';
import { findPath, loadWorldMap, nearestFreeTile, type CollisionGrid, type Interactable, type Prop, type TiledMap, type WorldMap } from '@cesar-office/world';
import { Depth, MapLayers, TextureKeys, TilesetNames } from '../world/map-contract.ts';
import { KeyboardIntent } from '../input/keyboard-intent.ts';
import { CompositeIntent, PathFollower } from '../ecs/systems/movement-intent.ts';
import { LocalMovementSystem } from '../ecs/systems/local-movement-system.ts';
import { NetSendSystem } from '../ecs/systems/net-send-system.ts';
import { InterpolationSystem } from '../ecs/systems/interpolation-system.ts';
import { RenderSystem } from '../ecs/systems/render-system.ts';
import { OverheadSystem } from '../ecs/systems/overhead-system.ts';
import { Position, RenderPosition } from '../ecs/components.ts';
import { AvatarLibrary } from '../art/avatar-library.ts';
import { propArt } from '../art/props.ts';
import type { Unsubscribe } from '../core/event-bus.ts';

const FIXED_STEP_MS = 1000 / 60;
/** Evita "espiral da morte" após aba em segundo plano. */
const MAX_STEPS_PER_FRAME = 5;
const ZOOM_LEVELS = [1.25, 1.5, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_INDEX = 2;
/** P-11 */
const INTERACT_RADIUS_PX = 1.5 * WORLD.TILE_PX;
/** P-14 */
const MAX_CLICK_PATH_TILES = 200;
/** Raio (px) para um clique "pegar" um objeto em vez do chão. */
const CLICK_PICK_PX = 18;
/** Gid da janela no tileset (maps/build-sede.ts). */
const WINDOW_GID = 16;
/** Props que respondem ao E (ação local, sem servidor). */
const USABLE_PROPS: Record<string, { label: string; emote: EmoteKind }> = {
  coffee: { label: 'Tomar um café', emote: 'coffee' },
  arcade: { label: 'Jogar uma partida', emote: 'laugh' },
};

type Target = { readonly kind: 'object'; readonly it: Interactable } | { readonly kind: 'prop'; readonly prop: Prop };

export class WorldScene extends Phaser.Scene {
  private services!: SceneServices;
  private keyboard!: KeyboardIntent;
  private intent!: CompositeIntent;
  private movement!: LocalMovementSystem;
  private netSend!: NetSendSystem;
  private interpolation!: InterpolationSystem;
  private render!: RenderSystem;
  private overhead!: OverheadSystem;
  private grid!: CollisionGrid;
  private worldMap!: WorldMap;
  private interactables: Interactable[] = [];
  private usableProps: Prop[] = [];
  private prompt: Target | undefined;
  /** Objeto escolhido com clique: anda até ele e usa ao chegar. */
  private pending: Target | undefined;
  /** Cadeira pedida ao servidor; quando o teleporte chegar nela, mostra sentado. */
  private sittingOn: Interactable | undefined;
  private accumulator = 0;
  private cameraBound = false;
  private zoomIndex = DEFAULT_ZOOM_INDEX;
  private readonly unsubs: Unsubscribe[] = [];
  private ring!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Image;
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
    this.pending = undefined;
    this.sittingOn = undefined;
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
    this.worldMap = world;
    this.grid = world.grid;
    this.interactables = [...world.interactables];
    this.usableProps = world.props.filter((p) => p.kind in USABLE_PROPS);
    this.furnish(world);
    this.daylight(raw.data);
    this.signZones(world);
    this.ring = this.add.graphics().setDepth(Depth.FurnitureBelow + 1);
    this.marker = this.add.image(0, 0, TextureKeys.Target).setDepth(Depth.FurnitureBelow + 2).setVisible(false);

    // ── Sistemas ──
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Teclado indisponível');
    this.keyboard = new KeyboardIntent(kb);
    this.intent = new CompositeIntent(this.keyboard, new PathFollower(WORLD.TILE_PX));
    const now = (): number => performance.now();
    this.movement = new LocalMovementSystem(session.world, this.grid, this.intent, now);
    this.netSend = new NetSendSystem(session.world, session.connection, now);
    this.interpolation = new InterpolationSystem(session.world, session.clock);
    const avatars = new AvatarLibrary(this.textures, this.anims, this.services.art === 'placeholder' ? 'generated' : 'files');
    this.render = new RenderSystem(this, session.world, avatars);
    this.overhead = new OverheadSystem(this, session.world);

    session.attachView({
      onCorrection: (x, y) => this.movement.applyCorrection(x, y),
      onTeleport: (x, y) => {
        this.movement.teleport(x, y);
        this.netSend.reset();
        this.clearTarget();
        const chair = this.sittingOn;
        this.sittingOn = undefined;
        if (chair && Math.hypot(chair.x - x, chair.y - y) < 2) this.movement.sit(this.facingAt(chair.x, chair.y));
      },
      onResynced: () => this.netSend.reset(),
    });

    // ── Câmera ──
    const cam = this.cameras.main;
    cam.setZoom(ZOOM_LEVELS[this.zoomIndex] ?? 2);
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#2E3442');

    // ── Input ──
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? -1 : 1));
    kb.on('keydown-E', () => this.interact());
    kb.on('keydown', (e: KeyboardEvent) => {
      if (!this.keyboard.isEnabled) return;
      const n = Number(e.key);
      const kind = Number.isInteger(n) && n >= 1 ? EMOTE_KINDS[n - 1] : undefined;
      if (kind) bus.emit('ui:emote', { kind });
      else if (e.key === '+' || e.key === '=') this.zoomBy(1);
      else if (e.key === '-') this.zoomBy(-1);
    });

    this.unsubs.push(
      bus.on('ui:focus-game', ({ focused }) => this.keyboard.setEnabled(focused)),
      bus.on('ui:zoom', ({ delta }) => this.zoomBy(delta)),
      bus.on('ui:walk-to', ({ x, y }) => this.walkTo(x, y)),
      bus.on('media:audible', ({ peers }) => {
        this.audible = new Set(peers.map((p) => p.userId));
      }),
      bus.on('media:speaking', ({ userIds }) => {
        this.speaking = new Set(userIds);
      }),
      bus.on('ui:interact', ({ objectKey }) => {
        if (this.prompt?.kind === 'prop' && objectKey === this.propKey(this.prompt.prop)) return this.use(this.prompt);
        const it = this.interactables.find((i) => i.key === objectKey);
        if (it) this.use({ kind: 'object', it });
      }),
      bus.on('chat:message', (m) => {
        if (m.channel !== 'here') return;
        const eid = session.world.entityOfUser(m.fromUserId);
        if (eid !== undefined) this.overhead.showChat(eid, m.body, this.time.now);
      }),
      bus.on('world:emote', ({ netId, kind }) => {
        const eid = session.world.entityOf(netId);
        if (eid !== undefined) this.overhead.showEmote(eid, kind, this.time.now);
      }),
    );
    bus.emit('world:zoom', { zoom: cam.zoom });
    bus.emit('world:map', { tiled: raw.data });

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
    this.overhead.update(this.time.now);
    this.drawConversationRing();
    this.bindCameraOnce();
    this.updatePrompt();
    this.arriveAtTarget();
  }

  // ───────────────────────────── cenário ─────────────────────────────

  /** Mobília (camada `props`), cadeiras e quadros como sprites com y-sort. */
  private furnish(world: WorldMap): void {
    for (const p of world.props) {
      const key = TextureKeys.Prop(p.kind, p.rect.w, p.rect.h, p.variant, p.color);
      if (!this.textures.exists(key)) {
        const art = propArt(p.kind, p.rect.w, p.rect.h, p.variant, p.color);
        this.textures.addCanvas(key, art.canvas);
        this.textures.get(key).customData = { flat: art.flat };
      }
      const { flat } = this.textures.get(key).customData as { flat?: false | 'floor' | 'wall' };
      // ancorado pela base: a parte que "sobe" (monitor, geladeira) passa por cima de quem está atrás
      const bottom = p.rect.y + p.rect.h;
      const depth = flat === 'floor' ? Depth.FloorDecor : flat === 'wall' ? Depth.WallDecor : Depth.Actors + bottom - 1;
      this.add.image(p.rect.x, bottom, key).setOrigin(0, 1).setDepth(depth);
    }
    for (const it of world.interactables) {
      if (it.type === 'chair') {
        const backTop = this.facingAt(it.x, it.y) === Facing.Down;
        this.add
          .image(it.x, it.y + 6, TextureKeys.Chair(it.deskKey ? 'office' : 'meeting', backTop))
          .setOrigin(0.5, 0.7)
          .setDepth(Depth.Actors + it.y - 18);
      } else if (it.type === 'portal') {
        const bottom = Math.floor(it.y / WORLD.TILE_PX + 1) * WORLD.TILE_PX;
        this.add.image(it.x, bottom, TextureKeys.Board).setOrigin(0.5, 1).setDepth(Depth.Actors + bottom - 1);
      }
    }
  }

  /** Luz do dia entrando pelas janelas da fachada (camada `walls`, gid da janela). */
  private daylight(tiled: TiledMap): void {
    const walls = tiled.layers.find((l) => l.name === MapLayers.Walls);
    if (!walls || walls.type !== 'tilelayer' || !('data' in walls)) return;
    const t = tiled.tilewidth;
    const g = this.add.graphics().setDepth(Depth.FloorDecor + 1).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < walls.data.length; i++) {
      if (walls.data[i] !== WINDOW_GID) continue;
      const x = (i % walls.width) * t;
      const y = Math.floor(i / walls.width) * t + t;
      for (let k = 0; k < 5; k++) {
        g.fillStyle(0xffe9a8, 0.07 - k * 0.012);
        g.fillRect(x - 4 - k * 3, y + k * 14, t + 8 + k * 6, 14);
      }
    }
  }

  /** Placa com nome e capacidade na entrada de cada sala privada (06 §6). */
  private signZones(world: WorldMap): void {
    const g = this.add.graphics().setDepth(Depth.FloorDecor + 2);
    for (const z of world.zones) {
      g.lineStyle(2, 0x8fb4ff, 0.55).strokeRect(z.rect.x + 2, z.rect.y + 2, z.rect.w - 4, z.rect.h - 4);
      this.add
        .text(z.rect.x + 8, z.rect.y + 6, `${z.name} · até ${z.capacity}`, {
          fontFamily: '"Atkinson Hyperlegible", system-ui, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#2F6FEB',
          padding: { x: 5, y: 2 },
        })
        .setResolution(4)
        .setDepth(Depth.FloorDecor + 3);
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

  // ───────────────────────────── movimento por clique ─────────────────────────────

  private onPointerDown(p: Phaser.Input.Pointer): void {
    const w = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const picked = this.pick(w.x, w.y);
    if (picked) {
      this.pending = picked;
      const [x, y] = picked.kind === 'object' ? [picked.it.x, picked.it.y] : [picked.prop.rect.x + picked.prop.rect.w / 2, picked.prop.rect.y + picked.prop.rect.h + 8];
      this.walkTo(x, y, true);
      return;
    }
    this.pending = undefined;
    this.walkTo(w.x, w.y);
  }

  /** Objeto sob o clique: cadeira, quadro ou prop utilizável. */
  private pick(x: number, y: number): Target | undefined {
    let best: Target | undefined;
    let bestD = CLICK_PICK_PX;
    for (const it of this.interactables) {
      if (it.type === 'door') continue;
      const d = Math.hypot(it.x - x, it.y - y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'object', it };
      }
    }
    if (best) return best;
    for (const prop of this.usableProps) {
      const r = prop.rect;
      if (x >= r.x && x < r.x + r.w && y >= r.y - 24 && y < r.y + r.h) return { kind: 'prop', prop };
    }
    return undefined;
  }

  private walkTo(x: number, y: number, keepPending = false): void {
    const eid = this.services.session.world.localEntity;
    if (eid === null) return;
    if (!keepPending) this.pending = undefined;
    const t = WORLD.TILE_PX;
    const from = { tx: Math.floor((Position.x[eid] ?? 0) / t), ty: Math.floor((Position.y[eid] ?? 0) / t) };
    const goal = nearestFreeTile(this.worldMap, Math.floor(x / t), Math.floor(y / t), 3);
    if (!goal) return;
    const path = findPath(this.grid, from, goal, MAX_CLICK_PATH_TILES);
    if (!path) return;
    this.intent.path.setPath(path);
    this.marker.setPosition((goal.tx + 0.5) * t, (goal.ty + 0.5) * t + 4).setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.marker);
    this.marker.setScale(1.4);
    this.tweens.add({ targets: this.marker, scale: 1, duration: 180, ease: 'Back.Out' });
  }

  /** Chegou ao fim do caminho: some o marcador e, se o clique foi num objeto, usa. */
  private arriveAtTarget(): void {
    if (!this.marker.visible || this.intent.path.active) return;
    this.clearTarget();
    const target = this.pending;
    this.pending = undefined;
    if (target && this.near(target)) this.use(target);
  }

  private clearTarget(): void {
    this.tweens.killTweensOf(this.marker);
    this.marker.setVisible(false);
  }

  // ───────────────────────────── interação ─────────────────────────────

  private updatePrompt(): void {
    const eid = this.services.session.world.localEntity;
    if (eid === null) return;
    const px = Position.x[eid] ?? 0;
    const py = Position.y[eid] ?? 0;
    let near: Target | undefined;
    let best = INTERACT_RADIUS_PX;
    for (const it of this.interactables) {
      const d = Math.hypot(it.x - px, it.y - py);
      if (d <= best && it.type !== 'door') {
        near = { kind: 'object', it };
        best = d;
      }
    }
    if (!near) for (const prop of this.usableProps) if (this.near({ kind: 'prop', prop })) near = { kind: 'prop', prop };

    const key = near ? this.targetKey(near) : undefined;
    if (key === (this.prompt ? this.targetKey(this.prompt) : undefined)) return;
    this.prompt = near;
    this.services.bus.emit('world:interact-prompt', near ? { objectKey: this.targetKey(near), label: this.labelFor(near) } : null);
  }

  private near(t: Target): boolean {
    const eid = this.services.session.world.localEntity;
    if (eid === null) return false;
    const px = Position.x[eid] ?? 0;
    const py = Position.y[eid] ?? 0;
    if (t.kind === 'object') return Math.hypot(t.it.x - px, t.it.y - py) <= INTERACT_RADIUS_PX;
    const r = t.prop.rect;
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.hypot(dx, dy) <= WORLD.TILE_PX;
  }

  private interact(): void {
    if (this.prompt) this.use(this.prompt);
  }

  private use(t: Target): void {
    const { bus, session } = this.services;
    if (t.kind === 'prop') {
      const usable = USABLE_PROPS[t.prop.kind];
      if (!usable) return;
      bus.emit('ui:emote', { kind: usable.emote });
      bus.emit('world:prop-used', { kind: t.prop.kind });
      return;
    }
    const it = t.it;
    if (it.type === 'portal') {
      if (it.url) bus.emit('world:open-portal', { objectKey: it.key, name: it.name, url: it.url });
      return;
    }
    if (it.type === 'chair') this.sittingOn = it;
    session.send({ t: 'interact', objectKey: it.key }); // servidor valida distância e ocupação
  }

  private labelFor(t: Target): string {
    if (t.kind === 'prop') return USABLE_PROPS[t.prop.kind]?.label ?? 'Usar';
    switch (t.it.type) {
      case 'chair':
        return 'Sentar';
      case 'portal':
        return `Abrir ${t.it.name}`;
      case 'door':
        return 'Entrar';
    }
  }

  private targetKey(t: Target): string {
    return t.kind === 'object' ? t.it.key : this.propKey(t.prop);
  }

  private propKey(p: Prop): string {
    return `prop:${p.kind}:${p.rect.x}:${p.rect.y}`;
  }

  /** Para onde olha quem senta na cadeira (o lado da mesa) — igual ao servidor. */
  private facingAt(x: number, y: number): Facing {
    const t = WORLD.TILE_PX;
    const tx = Math.floor(x / t);
    const ty = Math.floor(y / t);
    if (this.grid.isBlockedTile(tx, ty + 1)) return Facing.Down;
    if (this.grid.isBlockedTile(tx, ty - 1)) return Facing.Up;
    if (this.grid.isBlockedTile(tx - 1, ty)) return Facing.Left;
    if (this.grid.isBlockedTile(tx + 1, ty)) return Facing.Right;
    return Facing.Down;
  }

  // ───────────────────────────── câmera ─────────────────────────────

  private zoomBy(delta: number): void {
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this.zoomIndex + Math.sign(delta)));
    if (next === this.zoomIndex) return;
    this.zoomIndex = next;
    const zoom = ZOOM_LEVELS[next] ?? 2;
    this.tweens.add({ targets: this.cameras.main, zoom, duration: 160, ease: 'Sine.Out' });
    this.services.bus.emit('world:zoom', { zoom });
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
    this.overhead.destroy();
    this.render.destroy();
  }
}
