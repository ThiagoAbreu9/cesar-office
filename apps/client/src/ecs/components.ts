/**
 * Componentes ECS (bitECS 0.4, SoA). Dados numéricos apenas — objetos Phaser ficam no RenderSystem.
 * Capacidade fixa: a AOI limita entidades visíveis a ~100; 1024 dá folga com reciclagem.
 */
export const MAX_ENTITIES = 1024;

const f32 = (): Float32Array => new Float32Array(MAX_ENTITIES);

/** Posição de simulação (local: predita; remota: última amostra do servidor). */
export const Position = { x: f32(), y: f32() };

/** Posição desenhada (local: = Position; remota: interpolada). */
export const RenderPosition = { x: f32(), y: f32() };

/** Estado empacotado do avatar (binary.ts packState). */
export const AvatarState = { packed: new Uint8Array(MAX_ENTITIES) };

/** Id de rede da instância (u16). */
export const NetIdentity = { netId: new Uint16Array(MAX_ENTITIES) };

/** Correção do servidor em andamento (04 §4): interpola de from → to em CORRECTION_MS. */
export const Correction = { fromX: f32(), fromY: f32(), toX: f32(), toY: f32(), startedAt: new Float64Array(MAX_ENTITIES) };

/** Tags. */
export const LocalPlayer = {};
export const RemotePlayer = {};
