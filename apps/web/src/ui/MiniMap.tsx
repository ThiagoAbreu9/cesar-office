import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { minimapBase, type MinimapBase } from '@cesar-office/client';
import type { Joined } from '../backend.ts';

/** Planta do escritório com você e quem está por perto (AOI). Clique para ir até o ponto. */
export function MiniMap({ joined, audible }: { joined: Joined; audible: readonly string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState<MinimapBase | null>(null);
  const audibleRef = useRef(audible);
  audibleRef.current = audible;

  useEffect(() => joined.bus.on('world:map', ({ tiled }) => setBase(minimapBase(tiled))), [joined]);

  useEffect(() => {
    if (!base) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number): void => {
      raf = requestAnimationFrame(draw);
      if (t - last < 100) return; // 10 Hz é suficiente para pontinhos
      last = t;
      const g = ref.current?.getContext('2d');
      if (!g) return;
      g.imageSmoothingEnabled = false;
      g.drawImage(base.canvas, 0, 0);
      const world = joined.session.world;
      const local = world.localEntity;
      const near = new Set(audibleRef.current);
      for (const [eid, meta] of world.entries()) {
        if (eid === local) continue;
        const p = world.positionOf(eid);
        g.fillStyle = '#1B1F2A';
        g.fillRect(Math.round(p.x * base.scale) - 2, Math.round(p.y * base.scale) - 2, 5, 5);
        g.fillStyle = near.has(meta.userId) ? '#3FB950' : '#FFFFFF';
        g.fillRect(Math.round(p.x * base.scale) - 1, Math.round(p.y * base.scale) - 1, 3, 3);
      }
      if (local !== null) {
        const p = world.positionOf(local);
        const x = Math.round(p.x * base.scale);
        const y = Math.round(p.y * base.scale);
        g.fillStyle = '#1B1F2A';
        g.fillRect(x - 3, y - 3, 7, 7);
        g.fillStyle = '#E9B82C';
        g.fillRect(x - 2, y - 2, 5, 5);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [base, joined]);

  if (!base) return null;
  const walk = (e: MouseEvent<HTMLCanvasElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * base.worldW;
    const y = ((e.clientY - r.top) / r.height) * base.worldH;
    joined.bus.emit('ui:walk-to', { x, y });
  };
  return (
    <section className="minimap card" aria-label="Minimapa">
      <canvas ref={ref} width={base.canvas.width} height={base.canvas.height} onClick={walk} title="Clique para ir até lá" />
      <div className="minimap-bar">
        <span className="minimap-legend">
          <i className="mm-me" /> você <i className="mm-near" /> na conversa
        </span>
        <span className="zoom">
          <button type="button" onClick={() => joined.bus.emit('ui:zoom', { delta: -1 })} aria-label="Afastar a câmera">
            −
          </button>
          <button type="button" onClick={() => joined.bus.emit('ui:zoom', { delta: 1 })} aria-label="Aproximar a câmera">
            +
          </button>
        </span>
      </div>
    </section>
  );
}
