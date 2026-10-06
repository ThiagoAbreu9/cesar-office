/**
 * Colegas simulados do sandbox. Falam o protocolo de verdade (hello, Input binário, interact,
 * chat) com o servidor local — o servidor não sabe que são bots. Servem para mostrar o produto
 * vivo: rodinha na copa, reunião na Jatobá, gente na mesa, gente circulando.
 */
import {
  encodeControl,
  encodeInput,
  Op,
  parseServerControl,
  peekOp,
  PROTOCOL_VERSION,
  WORLD,
  type ServerMsg,
} from '@cesar-office/protocol';
import { findPath, nearestFreeTile, type Interactable, type TilePoint, type WorldMap } from '@cesar-office/world';
import type { LocalServer } from './local-server.ts';

type Role = 'recepcao' | 'copa' | 'reuniao' | 'mesa' | 'circula';

interface Persona {
  readonly name: string;
  readonly body: number;
  readonly role: Role;
  readonly dnd?: boolean;
}

const PERSONAS: readonly Persona[] = [
  { name: 'Rafael', body: 2, role: 'recepcao' },
  { name: 'Ana', body: 1, role: 'copa' },
  { name: 'Bruno', body: 0, role: 'copa' },
  { name: 'Carla', body: 2, role: 'copa' },
  { name: 'Diego', body: 0, role: 'reuniao' },
  { name: 'Elisa', body: 1, role: 'reuniao' },
  { name: 'Fernanda', body: 2, role: 'mesa', dnd: true },
  { name: 'Gustavo', body: 0, role: 'mesa' },
  { name: 'Helena', body: 1, role: 'circula' },
  { name: 'Igor', body: 2, role: 'circula' },
];

const GREETINGS = ['Oi! Chegou na hora do café.', 'E aí, tudo certo?', 'Bem-vindo! Puxa uma cadeira.', 'Olha quem apareceu!', 'Bom dia! Tá testando o escritório novo?'];
const REPLIES = ['Boa!', 'Concordo.', 'Haha, verdade.', 'Bora falar disso na Jatobá depois?', 'Anotado.', 'Faz sentido.'];
const ANNOUNCEMENTS = ['Alguém quer café? Tô na copa.', 'Daily em 10 min na Sala Jatobá.', 'Deploy feito, tudo verde no CI.'];

const T = WORLD.TILE_PX;
const STEP_PX = (WORLD.WALK_SPEED_PX_S * 100) / 1000 - 0.5;
const pick = <X>(xs: readonly X[]): X => xs[Math.floor(Math.random() * xs.length)] as X;

/** Coordena os bots: quem é bot, quem cumprimenta quem (evita todos falarem ao mesmo tempo). */
class Director {
  readonly botIds = new Set<string>();
  private readonly greeted = new Map<string, number>();
  private lastReplyAt = 0;
  private readonly takenChairs = new Set<string>();

  shouldGreet(humanId: string): boolean {
    const last = this.greeted.get(humanId) ?? 0;
    if (Date.now() - last < 45_000) return false;
    this.greeted.set(humanId, Date.now());
    return true;
  }

  shouldReply(): boolean {
    if (Date.now() - this.lastReplyAt < 4_000) return false;
    this.lastReplyAt = Date.now();
    return true;
  }

  claimChair(candidates: readonly Interactable[]): Interactable | undefined {
    const free = candidates.filter((c) => !this.takenChairs.has(c.key));
    const c = free[Math.floor(Math.random() * free.length)];
    if (c) this.takenChairs.add(c.key);
    return c;
  }
}

class Bot {
  private ws: ReturnType<LocalServer['connect']> | null = null;
  private readonly userId = crypto.randomUUID();
  private x = 0;
  private y = 0;
  private path: { x: number; y: number }[] = [];
  private seq = 0;
  private wasMoving = false;
  private timer: number | null = null;
  private idleUntil = 0;
  private chair: Interactable | undefined;
  private seated = false;
  private peers = new Set<string>();

  constructor(
    private readonly server: LocalServer,
    private readonly world: WorldMap,
    private readonly p: Persona,
    private readonly director: Director,
  ) {
    director.botIds.add(this.userId);
  }

  start(): void {
    const spawn = this.spawnTile();
    const ws = this.server.connect();
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        encodeControl({
          t: 'hello',
          v: PROTOCOL_VERSION,
          ticket: this.server.ticket(this.userId, this.p.name, { body: this.p.body, hair: 0, outfit: 0 }, 'available', { x: (spawn.tx + 0.5) * T, y: (spawn.ty + 0.5) * T }),
        }),
      );
    };
    ws.onmessage = (ev) => {
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      if (peekOp(buf) !== Op.Control) return;
      const r = parseServerControl(buf);
      if (r.ok) this.onMessage(r.value);
    };
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.ws?.close();
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.x = m.self.x;
        this.y = m.self.y;
        if (this.p.dnd) this.send({ t: 'set_status', status: 'dnd' });
        this.planInitial();
        this.timer = window.setInterval(() => this.tick(), 100);
        return;
      case 'correction':
        this.x = m.x;
        this.y = m.y;
        this.path = [];
        if (m.reason === 'teleport' && this.chair) this.seated = true;
        return;
      case 'audible': {
        const next = new Set(m.peers.map((p) => p.userId));
        for (const id of next) {
          if (this.peers.has(id) || this.director.botIds.has(id) || this.p.dnd) continue;
          if (this.director.shouldGreet(id)) window.setTimeout(() => this.say(pick(GREETINGS)), 1200 + Math.random() * 800);
        }
        this.peers = next;
        return;
      }
      case 'chat':
        if (m.channel === 'here' && !this.director.botIds.has(m.fromUserId) && !this.p.dnd && this.director.shouldReply()) {
          window.setTimeout(() => this.say(pick(REPLIES)), 1500 + Math.random() * 1500);
        }
        return;
      default:
        return;
    }
  }

  private planInitial(): void {
    if (this.p.role === 'reuniao') {
      this.chair = this.director.claimChair(this.world.interactables.filter((i) => i.type === 'chair' && i.key.startsWith('chair-jatoba')));
    } else if (this.p.role === 'mesa') {
      this.chair = this.director.claimChair(this.world.interactables.filter((i) => i.type === 'chair' && i.deskKey));
    }
    if (this.chair) this.walkTo(Math.floor(this.chair.x / T), Math.floor(this.chair.y / T) - 1);
  }

  private tick(): void {
    const now = Date.now();
    if (this.path.length > 0) {
      this.advance();
      return;
    }
    if (this.wasMoving) {
      this.sendInput(false);
      this.wasMoving = false;
      if (this.chair && !this.seated) this.send({ t: 'interact', objectKey: this.chair.key });
    }
    if (now < this.idleUntil || this.seated) return;

    if (this.p.role === 'circula') {
      if (Math.random() < 0.02) this.send({ t: 'chat_send', channel: 'global', clientMsgId: crypto.randomUUID(), body: pick(ANNOUNCEMENTS) });
      const t = this.randomOpenTile();
      this.walkTo(t.tx, t.ty);
      this.idleUntil = now + 4000 + Math.random() * 6000;
    } else if (this.p.role === 'copa') {
      // Pequenos ajustes de lugar, sem sair da rodinha.
      const hub = this.copaHub();
      const t = nearestFreeTile(this.world, hub.tx + Math.round((Math.random() - 0.5) * 4), hub.ty + Math.round((Math.random() - 0.5) * 2), 3);
      if (t) this.walkTo(t.tx, t.ty);
      this.idleUntil = now + 6000 + Math.random() * 8000;
    }
  }

  private advance(): void {
    let budget = STEP_PX;
    while (budget > 0 && this.path.length > 0) {
      const n = this.path[0] as { x: number; y: number };
      const d = Math.hypot(n.x - this.x, n.y - this.y);
      if (d <= budget) {
        this.x = n.x;
        this.y = n.y;
        budget -= d;
        this.path.shift();
      } else {
        this.x += ((n.x - this.x) / d) * budget;
        this.y += ((n.y - this.y) / d) * budget;
        budget = 0;
      }
    }
    this.wasMoving = true;
    this.sendInput(true);
  }

  private walkTo(tx: number, ty: number): void {
    const from: TilePoint = { tx: Math.floor(this.x / T), ty: Math.floor(this.y / T) };
    const target = nearestFreeTile(this.world, tx, ty, 2);
    if (!target) return;
    const p = findPath(this.world.grid, from, target, 200);
    if (p) this.path = p.slice(1).map((t) => ({ x: (t.tx + 0.5) * T, y: (t.ty + 0.5) * T }));
  }

  private sendInput(moving: boolean): void {
    this.seq = (this.seq + 1) & 0xffff;
    const facing = this.path[0] ? (Math.abs(this.path[0].x - this.x) > Math.abs(this.path[0].y - this.y) ? (this.path[0].x < this.x ? 1 : 2) : this.path[0].y < this.y ? 3 : 0) : 0;
    this.ws?.send(encodeInput({ seq: this.seq, x: Math.round(this.x), y: Math.round(this.y), state: { facing: facing as 0 | 1 | 2 | 3, moving, sitting: false, ghost: false } }));
  }

  private say(body: string): void {
    this.send({ t: 'chat_send', channel: 'here', clientMsgId: crypto.randomUUID(), body });
  }

  private send(msg: Parameters<typeof encodeControl>[0]): void {
    this.ws?.send(encodeControl(msg));
  }

  private copaHub(): TilePoint {
    return { tx: 55, ty: 33 };
  }

  private spawnTile(): TilePoint {
    if (this.p.role === 'recepcao') {
      // Ao lado da área de entrada: quem chega já entra na conversa com ele.
      const s = this.world.spawns[0];
      const cx = s ? Math.floor((s.x + s.w / 2) / T) : 9;
      const cy = s ? Math.floor((s.y + s.h / 2) / T) : 18;
      return nearestFreeTile(this.world, cx + 2, cy - 2, 3) ?? { tx: cx, ty: cy };
    }
    if (this.p.role === 'copa') {
      const hub = this.copaHub();
      return nearestFreeTile(this.world, hub.tx + Math.round((Math.random() - 0.5) * 3), hub.ty, 3) ?? hub;
    }
    return this.randomOpenTile();
  }

  private randomOpenTile(): TilePoint {
    for (let i = 0; i < 200; i++) {
      const tx = 2 + Math.floor(Math.random() * (this.world.widthTiles - 4));
      const ty = 2 + Math.floor(Math.random() * (this.world.heightTiles - 4));
      if (!this.world.grid.isBlockedTile(tx, ty) && !this.world.zoneAt((tx + 0.5) * T, (ty + 0.5) * T)) return { tx, ty };
    }
    return { tx: 30, ty: 22 };
  }
}

export function startBots(server: LocalServer, world: WorldMap): () => void {
  const director = new Director();
  const bots = PERSONAS.map((p) => new Bot(server, world, p, director));
  bots.forEach((b, i) => window.setTimeout(() => b.start(), 150 * i));
  return () => bots.forEach((b) => b.stop());
}
