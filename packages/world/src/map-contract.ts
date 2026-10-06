/**
 * Contrato entre o mapa Tiled e o código (06 §2). Nomes aqui = nomes no editor, exatamente.
 * Compartilhado por cliente (render) e servidor (validação) — uma única fonte.
 */
export const MapLayers = {
  Floor: 'floor',
  FloorDetail: 'floor_detail',
  Walls: 'walls',
  FurnitureBelow: 'furniture_below',
  FurnitureAbove: 'furniture_above',
  /** Camada de tiles invisível; qualquer tile não vazio = bloqueado. */
  Collision: 'collision',
  /** Camada de objetos: retângulos de zona (`private`, `spawn`). */
  Zones: 'zones',
  /** Camada de objetos: interativos (`door`, `chair`, `portal`). */
  Objects: 'objects',
  /**
   * Camada de objetos opcional: mobília e decoração desenhadas como sprites (classe = tipo, ex.
   * `sofa`, `desk-island`). Só visual — o servidor não usa; quem bloqueia é a camada `collision`.
   */
  Props: 'props',
} as const;

export const TilesetNames = {
  Office: 'office',
} as const;

/** Resolve a divergência #3 do relatório: sem `quiet` (não há regra) e `spawn` é zona, não objeto. */
export type ZoneType = 'private' | 'spawn';
export type ObjectType = 'door' | 'chair' | 'portal';
