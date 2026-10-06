/**
 * Chaves de render do cliente. O contrato de camadas/zonas/objetos do Tiled vive em
 * `@cesar-office/world` (compartilhado com o servidor) e é reexportado aqui por conveniência.
 */
export { MapLayers, TilesetNames, type ObjectType, type ZoneType } from '@cesar-office/world';

export const TextureKeys = {
  Tiles: 'tiles-office',
  /** Folha por corpo (assets de arquivo). A arte gerada usa uma folha por look (`lookKey`). */
  Avatar: (body: number): string => `avatar-${body}`,
  StatusDot: 'status-dot',
  UiFont: 'ui-font',
  Chair: (kind: 'office' | 'meeting', backTop: boolean): string => `chair-${kind}-${backTop ? 'n' : 's'}`,
  Board: 'portal-board',
  Target: 'walk-target',
  Emote: (kind: string): string => `emote-${kind}`,
  Prop: (kind: string, w: number, h: number, variant: number, color = ''): string => `prop-${kind}-${w}x${h}-${variant}-${color}`,
} as const;

/** Profundidades de render (y-sort entre FurnitureBelow e FurnitureAbove). */
export const Depth = {
  Floor: 0,
  /** Tapetes e luz das janelas. */
  FloorDecor: 2,
  Walls: 10,
  WallDecor: 11,
  FurnitureBelow: 20,
  /** Avatares e mobília alta usam Depth.Actors + y da base, garantindo ordenação por profundidade. */
  Actors: 1000,
  FurnitureAbove: 100_000,
  /** Balões de fala e reações. */
  Bubbles: 150_000,
  Labels: 200_000,
} as const;
