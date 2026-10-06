import type { GameSession } from '../session/game-session.ts';
import type { EventBus } from '../core/event-bus.ts';
import type { GameEvents } from '../core/game-events.ts';

export const SceneKeys = {
  Boot: 'boot',
  Preload: 'preload',
  World: 'world',
} as const;

/** Serviços repassados entre cenas via `scene.start(key, data)` — nunca globals. */
export interface SceneServices {
  readonly session: GameSession;
  readonly bus: EventBus<GameEvents>;
  readonly assetBaseUrl: string;
}
