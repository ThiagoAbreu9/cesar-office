import { useState } from 'react';
import type { Backend, Joined } from './backend.ts';
import { Badge } from './ui/Badge.tsx';
import { Office } from './ui/Office.tsx';

type Stage = { kind: 'badge'; error?: string } | { kind: 'joining' } | { kind: 'in'; joined: Joined; name: string };

export function App({ backend }: { backend: Backend }) {
  const [stage, setStage] = useState<Stage>({ kind: 'badge' });

  const enter = async (name: string, body: number): Promise<void> => {
    setStage({ kind: 'joining' });
    try {
      const joined = await backend.join(name, body);
      setStage({ kind: 'in', joined, name });
    } catch (e) {
      setStage({ kind: 'badge', error: e instanceof Error ? e.message : 'Não foi possível entrar agora.' });
    }
  };

  if (stage.kind === 'in') {
    return (
      <Office
        joined={stage.joined}
        name={stage.name}
        sandbox={backend.kind === 'sandbox'}
        onLeave={() => {
          stage.joined.dispose();
          setStage({ kind: 'badge' });
        }}
      />
    );
  }
  return <Badge busy={stage.kind === 'joining'} {...(stage.kind === 'badge' && stage.error ? { error: stage.error } : {})} sandbox={backend.kind === 'sandbox'} onEnter={enter} />;
}
