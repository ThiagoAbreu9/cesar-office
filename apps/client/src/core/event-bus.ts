/**
 * Event bus tipado. É a ÚNICA ponte entre o mundo Phaser e a UI React (05 §4).
 * Sem globals: uma instância é criada no bootstrap e injetada nos dois lados.
 */
export type Unsubscribe = () => void;

export class EventBus<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const h = handler as (payload: never) => void;
    set.add(h);
    return () => {
      set.delete(h);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) (h as (p: Events[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
