/**
 * MediaGateway com LiveKit — SOMENTE ÁUDIO (ADR-0008).
 * O token permite publicar apenas a fonte microfone: o SFU recusa câmera/tela mesmo de cliente adulterado.
 */
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { ServerMsgOf } from '@cesar-office/protocol';
import type { MediaGateway } from '../application/ports.ts';

export interface LiveKitConfig {
  /** URL wss que o NAVEGADOR usa (ex.: wss://lk.exemplo.com). */
  readonly url: string;
  /** URL https da API do servidor LiveKit (Server API). */
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

/** Só o necessário para o join; a sala exige o token, que expira rápido. */
const TOKEN_TTL = '10m';

export class LiveKitAudioGateway implements MediaGateway {
  readonly enabled = true;
  private readonly rooms: RoomServiceClient;

  constructor(private readonly cfg: LiveKitConfig) {
    this.rooms = new RoomServiceClient(cfg.apiUrl, cfg.apiKey, cfg.apiSecret);
  }

  async join(room: string, userId: string, displayName: string, mode: 'open' | 'zone'): Promise<ServerMsgOf<'media_join'>> {
    const at = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, { identity: userId, name: displayName, ttl: TOKEN_TTL });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return { t: 'media_join', url: this.cfg.url, room, token: await at.toJwt(), mode };
  }

  async remove(room: string, userId: string): Promise<void> {
    try {
      await this.rooms.removeParticipant(room, userId);
    } catch (e) {
      // Participante já saiu: não é erro.
      if (!String(e).toLowerCase().includes('not found')) throw e;
    }
  }
}

/** Sem LiveKit configurado (dev/testes): mundo e chat funcionam, sem áudio. */
export class DisabledMedia implements MediaGateway {
  readonly enabled = false;
  async join(): Promise<never> {
    throw new Error('mídia desabilitada');
  }
  async remove(): Promise<void> {}
}
