/**
 * Chaves de render do cliente. O contrato de camadas/zonas/objetos do Tiled vive em
 * `@cesar-office/world` (compartilhado com o servidor) e é reexportado aqui por conveniência.
 */
export { MapLayers, TilesetNames, type ObjectType, type ZoneType } from '@cesar-office/world';

export const TextureKeys = {
  Tiles: 'tiles-office',
  Avatar: (body: number): string => `avatar-${body}`,
  StatusDot: 'status-dot',
  UiFont: 'ui-font',
} as const;

/** Profundidades de render (y-sort entre FurnitureBelow e FurnitureAbove). */
export const Depth = {
  Floor: 0,
  Walls: 10,
  FurnitureBelow: 20,
  /** Avatares usam Depth.Actors + y, garantindo ordenação por profundidade. */
  Actors: 1000,
  FurnitureAbove: 100_000,
  Labels: 200_000,
} as const;
