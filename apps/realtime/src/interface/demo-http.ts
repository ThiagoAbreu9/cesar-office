/**
 * Rotas HTTP auxiliares do realtime:
 * - `GET /maps/:id.json` — JSON Tiled público do mapa (o cliente carrega por aqui em dev/demo).
 * - `POST /demo/join` — MODO DEMO: entra só com nome e aparência, sem conta. Emite um ticket de convidado
 *   para uma org/espaço fixos. Proibido em produção (config) e com limite por IP.
 *
 * Não há regra de negócio aqui: só emissão de ticket com os mesmos campos que a API emitiria.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { HmacTicketCodec } from '@cesar-office/ticket';
import { TokenBucket } from './rate-limiter.ts';

export const DEMO = {
  ORG_ID: '00000000-0000-4000-8000-00000000d3e0',
  SPACE_ID: '00000000-0000-4000-8000-00000000d3e1',
  INSTANCE_ID: 'demo_sede',
  MAP_ID: 'sede',
} as const;

export interface DemoHttpOptions {
  readonly mapsDir: string;
  readonly allowedOrigins: readonly string[];
  /** null = modo demo desligado (só serve mapas). */
  readonly tickets: HmacTicketCodec | null;
  /** URL do WebSocket que o navegador deve usar. */
  readonly publicWsUrl: string;
}

const JoinBody = z.object({
  name: z.string().trim().min(1).max(40),
  body: z.number().int().min(0).max(15).default(0),
  hair: z.number().int().min(0).max(15).default(0),
  outfit: z.number().int().min(0).max(15).default(0),
});

export class DemoHttp {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly o: DemoHttpOptions) {}

  /** true se tratou a requisição. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    const isMap = req.method === 'GET' && /^\/maps\/[a-zA-Z0-9_-]{1,64}\.json$/.test(url.pathname);
    const isJoin = url.pathname === '/demo/join' && (req.method === 'POST' || req.method === 'OPTIONS');
    if (!isMap && !isJoin) return false;

    this.cors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return true;
    }
    if (isMap) void this.serveMap(url.pathname.slice('/maps/'.length), res);
    else void this.join(req, res);
    return true;
  }

  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (!origin) return;
    if (this.o.allowedOrigins.length === 0 || this.o.allowedOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-methods', 'GET, POST');
      res.setHeader('access-control-allow-headers', 'content-type');
    }
  }

  private async serveMap(file: string, res: ServerResponse): Promise<void> {
    try {
      const text = await readFile(join(this.o.mapsDir, file), 'utf8');
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }).end(text);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"code":"not_found"}');
    }
  }

  private async join(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    };
    if (!this.o.tickets) return send(404, { code: 'not_found', detail: 'Modo demo desligado' });

    const ip = req.socket.remoteAddress ?? 'unknown';
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      bucket = new TokenBucket(10 / 60, 10, Date.now());
      this.buckets.set(ip, bucket);
      if (this.buckets.size > 10_000) this.buckets.clear();
    }
    if (!bucket.take(Date.now())) return send(429, { code: 'rate_limited', detail: 'Muitas entradas; aguarde um minuto' });

    let raw = '';
    for await (const chunk of req) {
      raw += String(chunk);
      if (raw.length > 1024) return send(413, { code: 'bad_request', detail: 'Corpo grande demais' });
    }
    let parsed: z.infer<typeof JoinBody>;
    try {
      parsed = JoinBody.parse(JSON.parse(raw || '{}'));
    } catch {
      return send(400, { code: 'bad_request', detail: 'Informe um nome de 1 a 40 caracteres' });
    }

    const ticket = this.o.tickets.sign({
      userId: randomUUID(),
      orgId: DEMO.ORG_ID,
      spaceId: DEMO.SPACE_ID,
      instanceId: DEMO.INSTANCE_ID,
      mapId: DEMO.MAP_ID,
      role: 'member',
      displayName: parsed.name,
      look: { body: parsed.body, hair: parsed.hair, outfit: parsed.outfit },
      status: 'available',
    });
    send(200, { wsUrl: this.o.publicWsUrl, ticket });
  }
}
