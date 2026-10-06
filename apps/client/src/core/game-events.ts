/**
 * Contrato de eventos Phaser ↔ React. A UI só conhece estes tipos.
 * Mídia (LiveKit) é um terceiro consumidor do bus, fora do Phaser.
 */
import type { AudiblePeer, ChatChannel, EmoteKind, PresenceStatus, ServerMsgOf } from '@cesar-office/protocol';
import type { TiledMap } from '@cesar-office/world';
import type { ConnectionState } from '../net/connection.ts';

export interface GameEvents extends Record<string, unknown> {
  // mundo → UI
  'net:state': { readonly state: ConnectionState; readonly attempt?: number };
  'net:rejoin-required': { readonly reason: string };
  'world:ready': { readonly userId: string; readonly instanceId: string };
  'world:zone': ServerMsgOf<'zone'>;
  'world:correction': { readonly reason: ServerMsgOf<'correction'>['reason'] };
  'world:interact-prompt': { readonly objectKey: string; readonly label: string } | null;
  /** Mapa carregado (para o minimapa da interface). */
  'world:map': { readonly tiled: TiledMap };
  'world:emote': { readonly netId: number; readonly kind: EmoteKind };
  /** Zoom atual da câmera (para a UI mostrar/ajustar). */
  'world:zoom': { readonly zoom: number };
  /** Ação local em um objeto decorativo (ex.: tomar café na copa). */
  'world:prop-used': { readonly kind: string };
  'world:open-portal': { readonly objectKey: string; readonly name: string; readonly url: string };
  'presence:changed': { readonly userId: string; readonly status: PresenceStatus | 'offline'; readonly displayName?: string };
  'chat:message': ServerMsgOf<'chat'>;
  'chat:ack': ServerMsgOf<'chat_ack'>;
  'call:received': ServerMsgOf<'call_received'>;
  'call:result': ServerMsgOf<'call_result'>;
  'error': ServerMsgOf<'error'>;
  'kicked': ServerMsgOf<'kicked'>;

  // mundo → camada de mídia
  'media:audible': { readonly peers: readonly AudiblePeer[]; readonly bubbleId: string | null };
  'media:join': ServerMsgOf<'media_join'>;
  'media:leave': ServerMsgOf<'media_leave'>;

  // mídia → UI (somente áudio, ADR-0008)
  'media:state': { readonly state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'; readonly room: string | null; readonly error?: string };
  'media:mic': { readonly enabled: boolean; readonly error?: 'permission_denied' | 'unavailable' };
  'media:speaking': { readonly userIds: readonly string[] };
  'media:needs-gesture': { readonly needed: boolean };

  // UI → mundo
  'ui:set-status': { readonly status: PresenceStatus };
  'ui:chat-send': { readonly channel: ChatChannel; readonly body: string; readonly clientMsgId: string };
  'ui:go-to': { readonly userId: string };
  'ui:call': { readonly userId: string };
  'ui:call-response': { readonly callId: string; readonly accept: boolean };
  'ui:interact': { readonly objectKey: string };
  'ui:emote': { readonly kind: EmoteKind };
  /** Andar até um ponto do mapa (px), ex.: clique no minimapa. */
  'ui:walk-to': { readonly x: number; readonly y: number };
  'ui:zoom': { readonly delta: number };
  'ui:focus-game': { readonly focused: boolean };
  'ui:mic': { readonly enabled: boolean };
  'ui:start-audio': Record<string, never>;
}
