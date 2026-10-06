/**
 * Composição (composition root): única parte que conhece todas as implementações concretas.
 *
 *   TICKET_SECRET=... node --experimental-transform-types src/main.ts
 */
import { resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { RealtimeService } from './application/realtime-service.ts';
import { Gateway } from './interface/ws-gateway.ts';
import { HmacTicketCodec } from '@cesar-office/ticket';
import { DemoHttp } from './interface/demo-http.ts';
import { DisabledMedia, LiveKitAudioGateway } from './infrastructure/livekit-media.ts';
import { InMemoryChatStore, InMemoryDeskRepository, InMemoryOrgBus } from './infrastructure/memory-adapters.ts';
import { cryptoIds, FileMapRepository, jsonLogger, systemClock } from './infrastructure/system.ts';

const cfg = loadConfig();
const log = jsonLogger({ svc: 'realtime' });

const media =
  cfg.LIVEKIT_URL && cfg.LIVEKIT_API_URL && cfg.LIVEKIT_API_KEY && cfg.LIVEKIT_API_SECRET
    ? new LiveKitAudioGateway({ url: cfg.LIVEKIT_URL, apiUrl: cfg.LIVEKIT_API_URL, apiKey: cfg.LIVEKIT_API_KEY, apiSecret: cfg.LIVEKIT_API_SECRET })
    : new DisabledMedia();
if (!media.enabled) log.warn('LiveKit não configurado: áudio desabilitado');

// Uma instância só: o nonce de uso único precisa ser o mesmo para hello e para o modo demo.
const tickets = new HmacTicketCodec({ secret: cfg.TICKET_SECRET });

const service = new RealtimeService({
  tickets,
  maps: new FileMapRepository(resolve(cfg.MAPS_DIR), cfg.MAPS_PUBLIC_URL),
  media,
  chat: new InMemoryChatStore(),
  bus: new InMemoryOrgBus(),
  desks: new InMemoryDeskRepository(),
  clock: systemClock,
  ids: cryptoIds,
  log,
  instanceConfig: { maxCcu: cfg.MAX_INSTANCE_CCU },
});

const demo = new DemoHttp({
  mapsDir: resolve(cfg.MAPS_DIR),
  allowedOrigins: cfg.ALLOWED_ORIGINS,
  tickets: cfg.DEMO_MODE ? tickets : null,
  publicWsUrl: cfg.PUBLIC_WS_URL,
});
if (cfg.DEMO_MODE) log.warn('DEMO_MODE ativo: qualquer pessoa entra só com um nome (somente desenvolvimento)');

const gateway = new Gateway(service, { port: cfg.PORT, allowedOrigins: cfg.ALLOWED_ORIGINS, http: (req, res) => demo.handle(req, res) }, log);
await gateway.listen();

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    log.info('desligando', { sig });
    void gateway.close().then(() => process.exit(0));
  });
}
