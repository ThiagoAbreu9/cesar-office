/**
 * Constantes de rede compartilhadas por cliente e servidor.
 * Fontes: 02-arquitetura §12 (orçamentos) e 03-mecanicas (tabela de parâmetros P-xx).
 * Mudou algo aqui? Bump de PROTOCOL_VERSION se afetar o formato no fio.
 */
/** v2: emotes (`emote` / `emote_shown`). */
export const PROTOCOL_VERSION = 2;

/** Opcode no primeiro byte de todo frame binário. */
export const Op = {
  Input: 0x01,
  Snapshot: 0x02,
  Control: 0x10,
} as const;
export type Op = (typeof Op)[keyof typeof Op];

export const NET = {
  /** Intervalo do tick do servidor (ms). 02 §12. */
  TICK_MS: 100,
  /** Intervalo de envio de input enquanto em movimento (ms). 02 §12. */
  INPUT_SEND_MS: 100,
  /** Atraso do buffer de interpolação de entidades remotas (ms). 04 §3. */
  INTERPOLATION_DELAY_MS: 150,
  /** Tamanho máximo de frame cliente → servidor (bytes). 02 §7. */
  MAX_CLIENT_FRAME_BYTES: 4096,
  /** Janela de resume após queda (ms). P-10. */
  RESUME_WINDOW_MS: 30_000,
  /** Intervalo de ping de aplicação (ms). 04 §5. */
  PING_INTERVAL_MS: 5_000,
  /** Sem nenhum frame por este tempo → conexão considerada morta (ms). */
  DEAD_CONNECTION_MS: 15_000,
} as const;

export const RATE = {
  INPUT_PER_S: 20,
  CHAT_PER_S: 5,
  CHAT_BURST: 10,
  ACTIONS_PER_S: 10,
} as const;

export const WORLD = {
  /** P-01 */
  TILE_PX: 32,
  /** P-02, em px/s */
  WALK_SPEED_PX_S: 128,
  /** P-07 */
  SPEED_TOLERANCE: 1.25,
  /** P-03 / P-04, em tiles */
  AUDIO_ENTER_TILES: 3,
  AUDIO_EXIT_TILES: 4,
  /** Permanência mínima dentro de P-03 antes de formar par (ms). RN em M2 edge cases. */
  AUDIO_ENTER_DWELL_MS: 400,
  /** P-05 */
  MAX_AUDIBLE_OPEN: 8,
  /** P-15 */
  BUBBLE_RECALC_MS: 250,
  /** P-16 */
  CHAT_MAX_CHARS: 2000,
  /** Tamanho da célula do grid espacial de AOI, em tiles. 04 §2. */
  AOI_CELL_TILES: 16,
} as const;
