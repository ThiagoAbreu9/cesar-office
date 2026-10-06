import { useEffect, useRef, useState } from 'react';
import { emoteArt } from '@cesar-office/client';
import { EMOTE_KINDS, type EmoteKind } from '@cesar-office/protocol';
import type { Joined } from '../backend.ts';

const LABEL: Record<EmoteKind, string> = {
  wave: 'Acenar',
  coffee: 'Café',
  thumbs: 'Joinha',
  laugh: 'Risada',
  heart: 'Coração',
  idea: 'Tive uma ideia',
};

/** Mesmo intervalo do servidor (InstanceConfig.emoteCooldownMs): o botão espera em vez de errar. */
const COOLDOWN_MS = 1_200;

function Icon({ kind }: { kind: EmoteKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(emoteArt(kind), 0, 0, 22, 24, 0, 0, 44, 48);
  }, [kind]);
  return <canvas ref={ref} width={44} height={48} aria-hidden="true" />;
}

/** Barra de reações: clique ou teclas 1–6 (as teclas são tratadas no jogo). */
export function Reactions({ joined }: { joined: Joined }) {
  const [cooling, setCooling] = useState(false);
  useEffect(() => {
    let t: number | undefined;
    const off = joined.bus.on('ui:emote', () => {
      setCooling(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setCooling(false), COOLDOWN_MS);
    });
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [joined]);

  return (
    <nav className={`reactions${cooling ? ' is-cooling' : ''}`} aria-label="Reações">
      {EMOTE_KINDS.map((k, i) => (
        <button key={k} type="button" disabled={cooling} title={`${LABEL[k]} (tecla ${i + 1})`} onClick={() => joined.bus.emit('ui:emote', { kind: k })}>
          <Icon kind={k} />
          <span className="reaction-key" aria-hidden="true">
            {i + 1}
          </span>
          <span className="sr-only">{LABEL[k]}</span>
        </button>
      ))}
    </nav>
  );
}
