import { useEffect, useRef, useState, type FormEvent } from 'react';
import { avatarSheet } from '@cesar-office/client';

const BODIES = [
  { id: 0, label: 'Camisa azul' },
  { id: 1, label: 'Camisa ipê' },
  { id: 2, label: 'Camisa verde' },
] as const;

function AvatarPreview({ body, scale }: { body: number; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(avatarSheet(body), 0, 0, 32, 48, 0, 0, 32 * scale, 48 * scale);
  }, [body, scale]);
  return <canvas ref={ref} width={32 * scale} height={48 * scale} aria-hidden="true" className="avatar-preview" />;
}

export function Badge({ onEnter, busy, error, sandbox }: { onEnter: (name: string, body: number) => void; busy: boolean; error?: string; sandbox: boolean }) {
  const [name, setName] = useState('');
  const [body, setBody] = useState(0);
  const trimmed = name.trim();

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (trimmed && !busy) onEnter(trimmed, body);
  };

  return (
    <main className="lobby">
      <form className="badge" onSubmit={submit} aria-labelledby="badge-title">
        <div className="badge-clip" aria-hidden="true" />
        <header className="badge-head">
          <span className="badge-org">CESAR Office</span>
          <span className="badge-kind">{sandbox ? 'Visitante · demonstração' : 'Visitante'}</span>
        </header>

        <div className="badge-body">
          <div className="badge-photo">
            <AvatarPreview body={body} scale={3} />
          </div>
          <div className="badge-fields">
            <label htmlFor="name" className="field-label">
              Nome no crachá
            </label>
            <input
              id="name"
              className="badge-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Seu nome"
              autoComplete="given-name"
              autoFocus
              required
            />
            <fieldset className="look">
              <legend className="field-label">Avatar</legend>
              <div className="look-options">
                {BODIES.map((b) => (
                  <label key={b.id} className={`look-option${body === b.id ? ' is-on' : ''}`}>
                    <input type="radio" name="body" value={b.id} checked={body === b.id} onChange={() => setBody(b.id)} />
                    <AvatarPreview body={b.id} scale={1} />
                    <span className="sr-only">{b.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>

        {error && (
          <p className="badge-error" role="alert">
            {error}
          </p>
        )}

        <button className="enter" type="submit" disabled={!trimmed || busy}>
          {busy ? 'Entrando…' : 'Entrar no escritório'}
        </button>
        <p className="badge-foot">
          {sandbox
            ? 'Demonstração: o escritório roda no seu navegador, com colegas simulados. Nada é enviado a servidores.'
            : 'Sem conta por enquanto: o login chega na próxima versão.'}
        </p>
      </form>
    </main>
  );
}
