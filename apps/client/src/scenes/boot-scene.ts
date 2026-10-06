/**
 * Boot: carrega o mínimo para a tela de carregamento e espera a sessão ter o welcome
 * (precisamos da URL/versão do mapa antes de carregar o tilemap).
 */
import Phaser from 'phaser';
import { SceneKeys, type SceneServices } from './scene-keys.ts';

export class BootScene extends Phaser.Scene {
  private services!: SceneServices;
  private unsub: (() => void) | null = null;

  constructor() {
    super(SceneKeys.Boot);
  }

  init(data: SceneServices): void {
    this.services = data;
  }

  create(): void {
    const go = (): void => {
      this.unsub?.();
      this.unsub = null;
      this.scene.start(SceneKeys.Preload, this.services);
    };
    if (this.services.session.welcomeData) go();
    else this.unsub = this.services.bus.on('world:ready', go);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsub?.();
      this.unsub = null;
    });
  }
}
