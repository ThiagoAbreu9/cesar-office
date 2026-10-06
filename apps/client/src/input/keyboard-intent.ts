/**
 * Intenção de movimento a partir do teclado (setas + WASD).
 * Respeita foco: quando o chat (React) está focado, o jogo não lê teclas.
 */
import Phaser from 'phaser';
import { STILL, type Intent, type IntentSource } from '../ecs/systems/movement-intent.ts';

export class KeyboardIntent implements IntentSource {
  private readonly keys: Phaser.Input.Keyboard.Key[];
  private readonly up: Phaser.Input.Keyboard.Key[];
  private readonly down: Phaser.Input.Keyboard.Key[];
  private readonly left: Phaser.Input.Keyboard.Key[];
  private readonly right: Phaser.Input.Keyboard.Key[];
  private enabled = true;

  constructor(keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    // enableCapture = false: o jogo não engole teclas que o chat precisa.
    const add = (code: number): Phaser.Input.Keyboard.Key => keyboard.addKey(code, false);
    this.up = [add(K.UP), add(K.W)];
    this.down = [add(K.DOWN), add(K.S)];
    this.left = [add(K.LEFT), add(K.A)];
    this.right = [add(K.RIGHT), add(K.D)];
    this.keys = [...this.up, ...this.down, ...this.left, ...this.right];
  }

  /** false enquanto o foco está num campo da interface (chat): teclas não andam nem reagem. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) for (const k of this.keys) k.reset();
  }

  read(): Intent {
    if (!this.enabled) return STILL;
    const anyDown = (ks: readonly Phaser.Input.Keyboard.Key[]): boolean => ks.some((k) => k.isDown);
    const dx = (anyDown(this.right) ? 1 : 0) - (anyDown(this.left) ? 1 : 0);
    const dy = (anyDown(this.down) ? 1 : 0) - (anyDown(this.up) ? 1 : 0);
    return dx === 0 && dy === 0 ? STILL : { dx, dy };
  }

  destroy(keyboard: Phaser.Input.Keyboard.KeyboardPlugin): void {
    for (const k of this.keys) keyboard.removeKey(k, true);
  }
}
