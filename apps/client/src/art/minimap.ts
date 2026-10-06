/**
 * Planta baixa do mapa para o minimapa da interface: cor por tipo de piso, paredes escuras,
 * mobília em bloco e salas privadas contornadas. Gerada uma vez por mapa (1 px por tile × escala).
 */
import { loadWorldMap, MapLayers, type TiledMap } from '@cesar-office/world';
import { canvas, rect } from './pixel.ts';

/** Cor por gid de piso (maps/build-sede.ts); desconhecido = cinza neutro. */
const FLOOR_COLORS: Record<number, string> = {
  1: '#D2AE82', 5: '#D2AE82', 6: '#E4DDD0', 7: '#E4DDD0', 8: '#3B5A9A', 9: '#C99A2E',
  10: '#D8E0E0', 11: '#D8E0E0', 12: '#C8C3B8', 13: '#C8C3B8', 14: '#9AA0AA',
};

export interface MinimapBase {
  readonly canvas: HTMLCanvasElement;
  /** px do mundo → px do minimapa. */
  readonly scale: number;
  readonly worldW: number;
  readonly worldH: number;
}

export function minimapBase(tiled: TiledMap, pxPerTile = 3): MinimapBase {
  const world = loadWorldMap(tiled);
  const W = tiled.width;
  const H = tiled.height;
  const [c, g] = canvas(W * pxPerTile, H * pxPerTile);
  const layer = (name: string): readonly number[] => {
    const l = tiled.layers.find((x) => x.name === name);
    return l && l.type === 'tilelayer' && 'data' in l ? l.data : [];
  };
  const floor = layer(MapLayers.Floor);
  const walls = layer(MapLayers.Walls);
  for (let i = 0; i < W * H; i++) {
    const x = (i % W) * pxPerTile;
    const y = Math.floor(i / W) * pxPerTile;
    if (walls[i]) rect(g, '#2E3442', x, y, pxPerTile, pxPerTile);
    else if (world.grid.isBlockedTile(i % W, Math.floor(i / W))) rect(g, '#8A6A50', x, y, pxPerTile, pxPerTile);
    else rect(g, FLOOR_COLORS[floor[i] ?? 0] ?? '#C8C3B8', x, y, pxPerTile, pxPerTile);
  }
  const k = pxPerTile / tiled.tilewidth;
  g.strokeStyle = '#2F6FEB';
  g.lineWidth = 1;
  for (const z of world.zones) g.strokeRect(z.rect.x * k + 0.5, z.rect.y * k + 0.5, z.rect.w * k - 1, z.rect.h * k - 1);
  return { canvas: c, scale: k, worldW: W * tiled.tilewidth, worldH: H * tiled.tilewidth };
}
