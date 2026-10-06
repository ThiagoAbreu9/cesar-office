/**
 * Ponto de entrada do jogo. A aplicação React chama `createGame` uma vez por espaço e guarda o handle.
 *
 *   const bus = new EventBus<GameEvents>();
 *   const session = createBrowserSession(bus);
 *   session.start(join.wsUrl, join.ticket);
 *   const game = createGame({ parent: divRef.current, session, bus, assetBaseUrl });
 *   // unmount: game.destroy()
 */
import Phaser from 'phaser';
import { EventBus } from './core/event-bus.ts';
import type { GameEvents } from './core/game-events.ts';
import { GameSession } from './session/game-session.ts';
import type { SocketLike, Timers } from './net/connection.ts';
import { BootScene } from './scenes/boot-scene.ts';
import { PreloadScene } from './scenes/preload-scene.ts';
import { WorldScene } from './scenes/world-scene.ts';
import { SceneKeys, type SceneServices } from './scenes/scene-keys.ts';

export interface GameHandle {
  readonly session: GameSession;
  destroy(): void;
}

export interface CreateGameOptions {
  readonly parent: HTMLElement;
  readonly session: GameSession;
  readonly bus: EventBus<GameEvents>;
  readonly assetBaseUrl: string;
  readonly art?: 'files' | 'placeholder';
  readonly inlineMap?: unknown;
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
};

/** Sessão com dependências reais do navegador. */
export function createBrowserSession(bus: EventBus<GameEvents>): GameSession {
  return new GameSession({
    bus,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    now: () => Date.now(),
    timers: browserTimers,
    random: Math.random,
  });
}

export function createGame(opts: CreateGameOptions): GameHandle {
  const services: SceneServices = {
    session: opts.session,
    bus: opts.bus,
    assetBaseUrl: opts.assetBaseUrl,
    ...(opts.art ? { art: opts.art } : {}),
    ...(opts.inlineMap !== undefined ? { inlineMap: opts.inlineMap } : {}),
  };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent,
    backgroundColor: '#1b1f2a',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    fps: { target: 60, smoothStep: true },
    // Sem física: colisão é a grade de tiles (04 §4). Arcade/Matter seriam peso morto.
    input: { keyboard: true, mouse: true, touch: true, gamepad: false },
    disableContextMenu: true,
    banner: false,
    scene: [],
  });

  game.scene.add(SceneKeys.Boot, BootScene, false);
  game.scene.add(SceneKeys.Preload, PreloadScene, false);
  game.scene.add(SceneKeys.World, WorldScene, false);
  game.scene.start(SceneKeys.Boot, services);

  // O áudio segue a aba: pausar render em segundo plano não pausa a rede.
  const onVisibility = (): void => {
    if (document.hidden) game.loop.sleep();
    else game.loop.wake();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    session: opts.session,
    destroy: () => {
      document.removeEventListener('visibilitychange', onVisibility);
      game.destroy(true);
    },
  };
}
