/**
 * Leitura e validação de mapas Tiled (JSON) → WorldMap.
 * Mesma função no cliente (montar colisão e interativos) e no servidor (validar movimento, zonas,
 * spawn) — e no upload do mapa (06 §2, "Validações no upload").
 */
import { CollisionGrid } from './collision-grid.ts';
import { MapLayers, type ObjectType } from './map-contract.ts';

// ───────────────────────────── Formato Tiled (subconjunto) ─────────────────────────────

export interface TiledProperty {
  readonly name: string;
  readonly type?: string;
  readonly value: unknown;
}

export interface TiledObject {
  readonly id: number;
  readonly name?: string;
  readonly type?: string;
  readonly class?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly properties?: readonly TiledProperty[];
}

export type TiledLayer =
  | { readonly type: 'tilelayer'; readonly name: string; readonly width: number; readonly height: number; readonly data: readonly number[] }
  | { readonly type: 'objectgroup'; readonly name: string; readonly objects: readonly TiledObject[] }
  | { readonly type: string; readonly name: string };

export interface TiledMap {
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly layers: readonly TiledLayer[];
}

// ───────────────────────────── Modelo de mundo ─────────────────────────────

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PrivateZone {
  readonly key: string;
  readonly name: string;
  readonly capacity: number;
  readonly rect: Rect;
}

export interface Interactable {
  readonly key: string;
  readonly type: ObjectType;
  readonly name: string;
  /** Centro em px. */
  readonly x: number;
  readonly y: number;
  readonly url?: string;
  readonly deskKey?: string;
  readonly zoneKey?: string;
}

/** Mobília/decoração visual (camada `props`). */
export interface Prop {
  readonly kind: string;
  readonly rect: Rect;
  readonly variant: number;
  readonly color?: string;
}

export interface WorldMap {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tilePx: number;
  readonly grid: CollisionGrid;
  /**
   * Grade acústica: só PAREDES bloqueiam som (camada `walls`). Mesas e sofás bloqueiam
   * movimento mas não a conversa (RN-M2-7). Sem camada `walls`, usa a colisão.
   */
  readonly acoustics: CollisionGrid;
  readonly zones: readonly PrivateZone[];
  readonly spawns: readonly Rect[];
  readonly interactables: readonly Interactable[];
  readonly props: readonly Prop[];
  /** Zona privada do ponto (px), ou null = área aberta. O(1). */
  zoneAt(x: number, y: number): PrivateZone | null;
  /** Porta da zona (centro em px). */
  doorOf(zoneKey: string): Interactable | undefined;
}

export class MapError extends Error {
  override readonly name = 'MapError';
  constructor(readonly problems: readonly string[]) {
    super(`Mapa inválido:\n- ${problems.join('\n- ')}`);
  }
}

function prop(o: TiledObject, name: string): unknown {
  return o.properties?.find((p) => p.name === name)?.value;
}

function str(o: TiledObject, name: string): string | undefined {
  const v = prop(o, name);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function rectOf(o: TiledObject): Rect {
  return { x: o.x, y: o.y, w: o.width ?? 0, h: o.height ?? 0 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Converte e valida. Lança MapError com TODOS os problemas encontrados (não só o primeiro),
 * para o admin corrigir de uma vez no upload.
 */
export function loadWorldMap(tiled: TiledMap): WorldMap {
  const problems: string[] = [];
  const { width, height, tilewidth } = tiled;
  if (tilewidth !== tiled.tileheight) problems.push('tiles devem ser quadrados');

  const collisionLayer = tiled.layers.find((l) => l.name === MapLayers.Collision);
  let grid: CollisionGrid;
  if (!collisionLayer || collisionLayer.type !== 'tilelayer' || !('data' in collisionLayer)) {
    problems.push(`camada de tiles "${MapLayers.Collision}" ausente`);
    grid = new CollisionGrid(width, height, tilewidth, new Uint8Array(width * height));
  } else {
    grid = CollisionGrid.fromTileData(width, height, tilewidth, collisionLayer.data);
  }

  const wallsLayer = tiled.layers.find((l) => l.name === MapLayers.Walls);
  const acoustics =
    wallsLayer && wallsLayer.type === 'tilelayer' && 'data' in wallsLayer
      ? CollisionGrid.fromTileData(width, height, tilewidth, wallsLayer.data)
      : grid;

  const objectsOf = (name: string): readonly TiledObject[] => {
    const l = tiled.layers.find((x) => x.name === name);
    return l && l.type === 'objectgroup' && 'objects' in l ? l.objects : [];
  };

  const zones: PrivateZone[] = [];
  const spawns: Rect[] = [];
  const keys = new Set<string>();
  const claimKey = (k: string, where: string): void => {
    if (keys.has(k)) problems.push(`key duplicada "${k}" (${where})`);
    keys.add(k);
  };

  for (const o of objectsOf(MapLayers.Zones)) {
    const cls = o.class ?? o.type;
    const key = str(o, 'key');
    if (cls === 'private') {
      const capacity = prop(o, 'capacity');
      if (!key) problems.push(`zona privada #${o.id} sem key`);
      if (typeof capacity !== 'number' || capacity < 1) problems.push(`zona "${key ?? o.id}" sem capacity válida`);
      if (key && typeof capacity === 'number') {
        claimKey(key, 'zona');
        zones.push({ key, name: str(o, 'name') ?? o.name ?? key, capacity, rect: rectOf(o) });
      }
    } else if (cls === 'spawn') {
      spawns.push(rectOf(o));
    } else {
      problems.push(`zona #${o.id} com classe desconhecida "${String(cls)}"`);
    }
  }

  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      if (a && b && overlaps(a.rect, b.rect)) problems.push(`zonas "${a.key}" e "${b.key}" se sobrepõem`);
    }

  const interactables: Interactable[] = [];
  for (const o of objectsOf(MapLayers.Objects)) {
    const cls = o.class ?? o.type;
    if (cls !== 'door' && cls !== 'chair' && cls !== 'portal') {
      problems.push(`objeto #${o.id} com classe desconhecida "${String(cls)}"`);
      continue;
    }
    const key = str(o, 'key') ?? `${cls}-${o.id}`;
    claimKey(key, cls);
    const x = o.x + (o.width ?? 0) / 2;
    const y = o.y + (o.height ?? 0) / 2;
    const url = str(o, 'url');
    const deskKey = str(o, 'deskKey');
    const zoneKey = str(o, 'zoneKey');
    if (cls === 'chair' && grid.isBlockedPx(x, y)) problems.push(`cadeira "${key}" sobre tile bloqueado`);
    if (cls === 'door' && !zoneKey) problems.push(`porta "${key}" sem zoneKey`);
    interactables.push({
      key,
      type: cls,
      name: o.name || key,
      x,
      y,
      ...(url !== undefined ? { url } : {}),
      ...(deskKey !== undefined ? { deskKey } : {}),
      ...(zoneKey !== undefined ? { zoneKey } : {}),
    });
  }

  for (const z of zones) {
    if (!interactables.some((i) => i.type === 'door' && i.zoneKey === z.key)) problems.push(`zona "${z.key}" sem porta`);
  }
  if (spawns.length === 0) problems.push('nenhuma zona spawn');
  for (const s of spawns) {
    let free = 0;
    for (let ty = Math.floor(s.y / tilewidth); ty < Math.ceil((s.y + s.h) / tilewidth); ty++)
      for (let tx = Math.floor(s.x / tilewidth); tx < Math.ceil((s.x + s.w) / tilewidth); tx++) if (!grid.isBlockedTile(tx, ty)) free++;
    if (free < 20) problems.push(`spawn em (${s.x},${s.y}) com só ${free} tiles livres (mínimo 20)`);
  }

  if (problems.length > 0) throw new MapError(problems);

  // Índice tile → zona (O(1) por consulta). −1 = área aberta.
  const zoneIndex = new Int16Array(width * height).fill(-1);
  zones.forEach((z, idx) => {
    for (let ty = 0; ty < height; ty++)
      for (let tx = 0; tx < width; tx++) {
        const cx = (tx + 0.5) * tilewidth;
        const cy = (ty + 0.5) * tilewidth;
        if (cx >= z.rect.x && cx < z.rect.x + z.rect.w && cy >= z.rect.y && cy < z.rect.y + z.rect.h) zoneIndex[ty * width + tx] = idx;
      }
  });

  const props: Prop[] = objectsOf(MapLayers.Props).map((o) => {
    const variant = prop(o, 'variant');
    const color = str(o, 'color');
    return {
      kind: String(o.class ?? o.type ?? o.name),
      rect: rectOf(o),
      variant: typeof variant === 'number' ? variant : 0,
      ...(color !== undefined ? { color } : {}),
    };
  });

  return {
    widthTiles: width,
    heightTiles: height,
    tilePx: tilewidth,
    grid,
    acoustics,
    zones,
    spawns,
    interactables,
    props,
    zoneAt(x: number, y: number): PrivateZone | null {
      const tx = Math.floor(x / tilewidth);
      const ty = Math.floor(y / tilewidth);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return null;
      const idx = zoneIndex[ty * width + tx] ?? -1;
      return idx >= 0 ? (zones[idx] ?? null) : null;
    },
    doorOf(zoneKey: string): Interactable | undefined {
      return interactables.find((i) => i.type === 'door' && i.zoneKey === zoneKey);
    },
  };
}

/** Tile livre mais próximo de (tx, ty) em espiral, até `radius` tiles, satisfazendo `accept`. */
export function nearestFreeTile(
  map: WorldMap,
  tx: number,
  ty: number,
  radius: number,
  accept: (tx: number, ty: number) => boolean = () => true,
): { tx: number; ty: number } | null {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // só o anel
        const x = tx + dx;
        const y = ty + dy;
        if (!map.grid.isBlockedTile(x, y) && accept(x, y)) return { tx: x, ty: y };
      }
  }
  return null;
}
