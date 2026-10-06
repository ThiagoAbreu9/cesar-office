/**
 * Superfície do servidor que roda também no NAVEGADOR (sandbox do demo):
 * casos de uso + domínio + adaptadores em memória. Nada aqui importa módulos de Node.
 */
export { RealtimeService, CloseCode, type ClientConnection, type ServiceDeps } from './application/realtime-service.ts';
export type { MapRepository, MediaGateway, TicketVerifier, TicketClaims, Logger, IdGenerator, Clock } from './application/ports.ts';
export { InMemoryChatStore, InMemoryDeskRepository, InMemoryOrgBus } from './infrastructure/memory-adapters.ts';
