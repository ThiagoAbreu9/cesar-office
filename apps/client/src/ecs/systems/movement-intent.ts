/**
 * De onde vem a intenção de movimento do avatar local: teclado (prioridade) ou caminho (clique / "Ir até").
 * Interface pura; a implementação de teclado está em input/keyboard-intent.ts (Phaser).
 */
import type { TilePoint } from '@cesar-office/world';

export interface Intent {
  /** Direção normalizada (−1..1). (0,0) = parado. */
  readonly dx: number;
  readonly dy: number;
}

export interface IntentSource {
  read(): Intent;
}

export const STILL: Intent = { dx: 0, dy: 0 };

/** Segue uma lista de tiles; produz intenção em direção ao centro do próximo tile. */
export class PathFollower implements IntentSource {
  private waypoints: { x: number; y: number }[] = [];
  private posX = 0;
  private posY = 0;

  constructor(private readonly tilePx: number) {}

  setPath(path: readonly TilePoint[]): void {
    this.waypoints = path.slice(1).map((p) => ({ x: (p.tx + 0.5) * this.tilePx, y: (p.ty + 0.5) * this.tilePx }));
  }

  cancel(): void {
    this.waypoints = [];
  }

  get active(): boolean {
    return this.waypoints.length > 0;
  }

  /** Chamado pelo sistema de movimento com a posição atual antes de `read()`. */
  track(x: number, y: number): void {
    this.posX = x;
    this.posY = y;
    const next = this.waypoints[0];
    if (next && Math.hypot(next.x - x, next.y - y) < 2) this.waypoints.shift();
  }

  read(): Intent {
    const next = this.waypoints[0];
    if (!next) return STILL;
    const vx = next.x - this.posX;
    const vy = next.y - this.posY;
    const len = Math.hypot(vx, vy);
    return len < 1e-6 ? STILL : { dx: vx / len, dy: vy / len };
  }
}

/** Teclado vence caminho; qualquer tecla cancela o caminho em curso. */
export class CompositeIntent implements IntentSource {
  constructor(
    private readonly keyboard: IntentSource,
    readonly path: PathFollower,
  ) {}

  read(): Intent {
    const k = this.keyboard.read();
    if (k.dx !== 0 || k.dy !== 0) {
      this.path.cancel();
      return k;
    }
    return this.path.read();
  }
}
