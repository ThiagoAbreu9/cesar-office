/** API pública do cliente de jogo para a aplicação web. */
export { createGame, createBrowserSession, type GameHandle, type CreateGameOptions } from './game.ts';
export { GameSession, type SessionDeps } from './session/game-session.ts';
export { EventBus, type Unsubscribe } from './core/event-bus.ts';
export type { GameEvents } from './core/game-events.ts';
export type { SocketLike, Timers, ConnectionState } from './net/connection.ts';
export { AudioMedia } from './media/audio-media.ts';
export { avatarSheet } from './art/avatars.ts';
export { emoteArt } from './art/props.ts';
export { minimapBase, type MinimapBase } from './art/minimap.ts';
export { decodeHair, encodeHair, HAIR_COLORS, HAIR_STYLES, OUTFITS, SKINS } from './art/palette.ts';
