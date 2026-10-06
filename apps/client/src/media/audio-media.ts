/**
 * Camada de mídia — SOMENTE ÁUDIO (ADR-0008). Fora do Phaser; fala com o mundo só pelo event bus.
 *
 * Regras (04 §8.2):
 * - Um cliente está em UMA sala por vez: aberta (`{inst}.open`) ou da zona (`{inst}.zone.{key}`).
 * - Sala aberta: `autoSubscribe: false`; assina só os peers do último `audible`, com o volume enviado pelo servidor.
 * - Sala de zona: assina todos, volume 1. Isolamento é garantido pelo servidor (token + RemoveParticipant).
 * - Só o microfone é publicado. Nenhuma API de câmera ou tela é chamada.
 */
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { AudiblePeer, ServerMsgOf } from '@cesar-office/protocol';
import type { EventBus, Unsubscribe } from '../core/event-bus.ts';
import type { GameEvents } from '../core/game-events.ts';

type Mode = 'open' | 'zone';

export class AudioMedia {
  private room: Room | null = null;
  private roomName: string | null = null;
  private mode: Mode = 'open';
  private peers = new Map<string, number>();
  private micWanted = false;
  private readonly elements = new Map<string, HTMLMediaElement>();
  private readonly unsubs: Unsubscribe[] = [];
  /** Serializa troca de sala (entrar/sair em sequência rápida não pode cruzar). */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly bus: EventBus<GameEvents>,
    private readonly mountAudio: (el: HTMLMediaElement) => void = (el) => document.body.appendChild(el),
  ) {
    this.unsubs.push(
      bus.on('media:join', (m) => this.enqueue(() => this.join(m))),
      bus.on('media:leave', ({ room }) => this.enqueue(() => this.leave(room))),
      bus.on('media:audible', ({ peers }) => this.setAudible(peers)),
      bus.on('ui:mic', ({ enabled }) => void this.setMic(enabled)),
      bus.on('ui:start-audio', () => void this.room?.startAudio()),
    );
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    void this.enqueue(() => this.leave(this.roomName ?? ''));
  }

  // ───────────────────────────── salas ─────────────────────────────

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job).catch((e: unknown) => {
      this.bus.emit('media:state', { state: 'disconnected', room: this.roomName, error: String(e) });
    });
    return this.queue;
  }

  private async join(m: ServerMsgOf<'media_join'>): Promise<void> {
    if (this.roomName === m.room && this.room?.state === ConnectionState.Connected) return;
    if (this.room) await this.leave(this.roomName ?? '');

    const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
    this.room = room;
    this.roomName = m.room;
    this.mode = m.mode;
    this.bind(room);
    this.bus.emit('media:state', { state: 'connecting', room: m.room });
    await room.connect(m.url, m.token, { autoSubscribe: m.mode === 'zone' });
    if (this.room !== room) return; // trocou de sala durante o connect
    this.bus.emit('media:state', { state: 'connected', room: m.room });
    if (!room.canPlaybackAudio) this.bus.emit('media:needs-gesture', { needed: true });
    if (this.micWanted) await this.setMic(true);
    this.applySubscriptions();
  }

  private async leave(roomName: string): Promise<void> {
    if (!this.room || this.roomName !== roomName) return;
    const room = this.room;
    this.room = null;
    this.roomName = null;
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
    room.removeAllListeners();
    await room.disconnect();
    this.bus.emit('media:state', { state: 'disconnected', room: null });
  }

  private bind(room: Room): void {
    room
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => this.applyFor(p, pub))
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.applyFor(p))
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset['userId'] = p.identity;
        this.elements.get(p.identity)?.remove();
        this.elements.set(p.identity, el);
        this.mountAudio(el);
        this.applyVolume(p);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
        for (const el of track.detach()) el.remove();
        this.elements.delete(p.identity);
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.bus.emit('media:speaking', { userIds: speakers.map((s) => s.identity) });
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        this.bus.emit('media:needs-gesture', { needed: !room.canPlaybackAudio });
      })
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Reconnecting) this.bus.emit('media:state', { state: 'reconnecting', room: this.roomName });
        if (state === ConnectionState.Connected) this.bus.emit('media:state', { state: 'connected', room: this.roomName });
      });
  }

  // ───────────────────────────── quem ouço ─────────────────────────────

  private setAudible(peers: readonly AudiblePeer[]): void {
    this.peers = new Map(peers.map((p) => [p.userId, p.volume]));
    this.applySubscriptions();
  }

  private applySubscriptions(): void {
    if (!this.room) return;
    for (const p of this.room.remoteParticipants.values()) this.applyFor(p);
  }

  private applyFor(p: RemoteParticipant, only?: RemoteTrackPublication): void {
    const want = this.mode === 'zone' || this.peers.has(p.identity);
    const pubs = only ? [only] : [...p.audioTrackPublications.values()];
    for (const pub of pubs) {
      if (pub.source !== Track.Source.Microphone) continue; // ignora qualquer outra fonte
      if (pub.isSubscribed !== want) pub.setSubscribed(want);
    }
    this.applyVolume(p);
  }

  private applyVolume(p: RemoteParticipant): void {
    p.setVolume(this.mode === 'zone' ? 1 : (this.peers.get(p.identity) ?? 0), Track.Source.Microphone);
  }

  // ───────────────────────────── microfone ─────────────────────────────

  private async setMic(enabled: boolean): Promise<void> {
    this.micWanted = enabled;
    if (!this.room) {
      this.bus.emit('media:mic', { enabled });
      return;
    }
    try {
      await this.room.localParticipant.setMicrophoneEnabled(enabled, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      this.bus.emit('media:mic', { enabled });
    } catch (e) {
      this.micWanted = false;
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      this.bus.emit('media:mic', { enabled: false, error: denied ? 'permission_denied' : 'unavailable' });
    }
  }
}
