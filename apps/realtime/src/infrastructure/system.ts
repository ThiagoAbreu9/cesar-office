/**
 * Relógio, ids, logger JSON e carregamento de mapas do disco.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadWorldMap, type TiledMap } from '@cesar-office/world';
import type { Clock, IdGenerator, LoadedMap, Logger, MapRepository } from '../application/ports.ts';

export const systemClock: Clock = { now: () => Date.now() };

/** UUID v7 (RFC 9562): 48 bits de tempo em ms + aleatório. Ordenável por criação. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const cryptoIds: IdGenerator = {
  uuid: () => uuidv7(),
  token: () => randomBytes(32).toString('base64url'),
};

export function jsonLogger(base: Record<string, unknown> = {}, sink: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  const write = (level: string, msg: string, data?: Record<string, unknown>): void => sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...base, ...data }));
  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Mapas em `<dir>/<mapId>.json`. Versão = hash do conteúdo (cache busting correto no cliente).
 * Em produção os metadados vêm da tabela `maps` e o JSON do storage/CDN.
 */
export class FileMapRepository implements MapRepository {
  private readonly cache = new Map<string, Promise<LoadedMap>>();

  constructor(private readonly dir: string, private readonly publicBaseUrl: string) {}

  load(mapId: string): Promise<LoadedMap> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(mapId)) return Promise.reject(new Error(`mapId inválido: ${mapId}`));
    let p = this.cache.get(mapId);
    if (!p) {
      p = readFile(join(this.dir, `${mapId}.json`), 'utf8').then((text) => {
        const hash = createHash('sha256').update(text).digest('hex').slice(0, 12);
        const map = loadWorldMap(JSON.parse(text) as TiledMap);
        return { map, version: parseInt(hash.slice(0, 8), 16), url: `${this.publicBaseUrl}/${mapId}.json?v=${hash}` };
      });
      p.catch(() => this.cache.delete(mapId));
      this.cache.set(mapId, p);
    }
    return p;
  }
}
