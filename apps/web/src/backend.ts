/**
 * Como o app entra no escritório. Dois modos, mesma sessão de jogo:
 * - servidor: modo demo do realtime (`POST /demo/join`) e WebSocket de verdade;
 * - sandbox: servidor rodando no próprio navegador, com colegas simulados.
 */
import { AudioMedia, createBrowserSession, EventBus, GameSession, type GameEvents, type Timers } from '@cesar-office/client';
import { loadWorldMap, type TiledMap } from '@cesar-office/world';
import type { AvatarLook } from '@cesar-office/protocol';

export interface Joined {
  readonly session: GameSession;
  readonly bus: EventBus<GameEvents>;
  readonly inlineMap?: unknown;
  /** true quando o servidor ofereceu uma sala de áudio (LiveKit configurado). */
  audioAvailable(): boolean;
  dispose(): void;
}

export interface Backend {
  readonly kind: 'server' | 'sandbox';
  join(name: string, look: AvatarLook): Promise<Joined>;
}

const timers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
};

function waitReady(bus: EventBus<GameEvents>, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      off();
      reject(new Error('O escritório não respondeu. Confira se o servidor está no ar e tente de novo.'));
    }, ms);
    const offs = [
      bus.on('world:ready', () => {
        off();
        resolve();
      }),
      bus.on('error', (e) => {
        off();
        reject(new Error(e.message));
      }),
      bus.on('net:rejoin-required', () => {
        off();
        reject(new Error('A conexão caiu durante a entrada. Tente de novo.'));
      }),
    ];
    const off = (): void => {
      window.clearTimeout(timer);
      offs.forEach((u) => u());
    };
  });
}

export class ServerBackend implements Backend {
  readonly kind = 'server';
  constructor(private readonly httpBase: string) {}

  async join(name: string, look: AvatarLook): Promise<Joined> {
    const res = await fetch(`${this.httpBase}/demo/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, ...look }),
    }).catch(() => {
      throw new Error(`Não encontrei o servidor em ${this.httpBase}. Ele está rodando com DEMO_MODE=true?`);
    });
    const data = (await res.json()) as { wsUrl?: string; ticket?: string; detail?: string };
    if (!res.ok || !data.wsUrl || !data.ticket) throw new Error(data.detail ?? 'Não foi possível entrar agora.');

    const bus = new EventBus<GameEvents>();
    const session = createBrowserSession(bus);
    const media = new AudioMedia(bus);
    let audio = false;
    // media_join chega logo após o welcome — antes da UI montar —, então o fato fica guardado aqui.
    const offMedia = bus.on('media:join', () => {
      audio = true;
    });
    const ready = waitReady(bus);
    session.start(data.wsUrl, data.ticket);
    await ready;
    return {
      session,
      bus,
      audioAvailable: () => audio,
      dispose: () => {
        offMedia();
        media.dispose();
        session.dispose();
        bus.clear();
      },
    };
  }
}

export class SandboxBackend implements Backend {
  readonly kind = 'sandbox';
  constructor(private readonly map: TiledMap) {}

  async join(name: string, look: AvatarLook): Promise<Joined> {
    const [{ LocalServer }, { startBots }] = await Promise.all([import('./sandbox/local-server.ts'), import('./sandbox/bots.ts')]);
    const server = new LocalServer(this.map);
    server.start();
    const stopBots = startBots(server, loadWorldMap(this.map));

    const bus = new EventBus<GameEvents>();
    const session = new GameSession({ bus, createSocket: () => server.connect(), now: () => Date.now(), timers, random: Math.random });
    const ready = waitReady(bus);
    session.start('loopback://sandbox', server.ticket(crypto.randomUUID(), name, look));
    await ready;
    return {
      session,
      bus,
      inlineMap: this.map,
      audioAvailable: () => false,
      dispose: () => {
        stopBots();
        session.dispose();
        server.stop();
        bus.clear();
      },
    };
  }
}
