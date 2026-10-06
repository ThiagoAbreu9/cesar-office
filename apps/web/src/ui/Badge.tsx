import { useEffect, useRef, useState, type FormEvent } from 'react';
import { avatarSheet, encodeHair, HAIR_COLORS, HAIR_STYLES, OUTFITS, SKINS } from '@cesar-office/client';
import type { AvatarLook } from '@cesar-office/protocol';

/** Quadro do avatar: `frame` 0 = parado de frente; `crop` mostra só a cabeça (amostras de cabelo). */
function AvatarPreview({ look, scale, crop = false }: { look: AvatarLook; scale: number; crop?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [h, y0] = crop ? [22, 4] : [48, 0];
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(avatarSheet(look), 0, y0, 32, h, 0, 0, 32 * scale, h * scale);
  }, [look, scale, h, y0]);
  return <canvas ref={ref} width={32 * scale} height={h * scale} aria-hidden="true" className="avatar-preview" />;
}

/** Prévia animada (anda de frente) para o crachá. */
function WalkingPreview({ look, scale }: { look: AvatarLook; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const sheet = avatarSheet(look);
    let frame = 0;
    const draw = (): void => {
      const g = ref.current?.getContext('2d');
      if (!g) return;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32 * scale, 48 * scale);
      g.drawImage(sheet, (frame % 4) * 32, 0, 32, 48, 0, 0, 32 * scale, 48 * scale);
      frame++;
    };
    draw();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const t = window.setInterval(draw, 180);
    return () => window.clearInterval(t);
  }, [look, scale]);
  return <canvas ref={ref} width={32 * scale} height={48 * scale} aria-hidden="true" className="avatar-preview" />;
}

interface Choice {
  readonly id: number;
  readonly label: string;
}

function Swatches({ legend, name, choices, value, onChange, render }: { legend: string; name: string; choices: readonly Choice[]; value: number; onChange: (v: number) => void; render: (c: Choice) => React.ReactNode }) {
  return (
    <fieldset className="look">
      <legend className="field-label">{legend}</legend>
      <div className="look-options">
        {choices.map((c) => (
          <label key={c.id} className={`look-option${value === c.id ? ' is-on' : ''}`} title={c.label}>
            <input type="radio" name={name} value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} />
            {render(c)}
            <span className="sr-only">{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const SKIN_CHOICES = SKINS.map((_, i) => ({ id: i, label: `Tom de pele ${i + 1}` }));
const STYLE_CHOICES = HAIR_STYLES.map((label, i) => ({ id: i, label }));
const HAIR_COLOR_CHOICES = HAIR_COLORS.map((_, i) => ({ id: i, label: ['Preto', 'Castanho', 'Loiro'][i] ?? `Cor ${i + 1}` }));
const OUTFIT_CHOICES = OUTFITS.map((o, i) => ({ id: i, label: o.name }));

export function Badge({ onEnter, busy, error, sandbox }: { onEnter: (name: string, look: AvatarLook) => void; busy: boolean; error?: string; sandbox: boolean }) {
  const [name, setName] = useState('');
  const [skin, setSkin] = useState(0);
  const [style, setStyle] = useState(0);
  const [hairColor, setHairColor] = useState(0);
  const [outfit, setOutfit] = useState(0);
  const look: AvatarLook = { body: skin, hair: encodeHair(style, hairColor), outfit };
  const trimmed = name.trim();

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (trimmed && !busy) onEnter(trimmed, look);
  };

  return (
    <main className="lobby">
      <form className="badge" onSubmit={submit} aria-labelledby="badge-title">
        <div className="badge-clip" aria-hidden="true" />
        <header className="badge-head">
          <span className="badge-org" id="badge-title">
            CESAR Office
          </span>
          <span className="badge-kind">{sandbox ? 'Visitante · demonstração' : 'Visitante'}</span>
        </header>

        <div className="badge-body">
          <div className="badge-photo">
            <WalkingPreview look={look} scale={3} />
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
            <Swatches legend="Pele" name="skin" choices={SKIN_CHOICES} value={skin} onChange={setSkin} render={(c) => <i className="swatch" style={{ background: SKINS[c.id]?.base }} />} />
            <Swatches legend="Cabelo" name="hair-style" choices={STYLE_CHOICES} value={style} onChange={setStyle} render={(c) => <AvatarPreview look={{ ...look, hair: encodeHair(c.id, hairColor) }} scale={1} crop />} />
            <Swatches legend="Cor do cabelo" name="hair-color" choices={HAIR_COLOR_CHOICES} value={hairColor} onChange={setHairColor} render={(c) => <i className="swatch" style={{ background: HAIR_COLORS[c.id] }} />} />
            <Swatches legend="Roupa" name="outfit" choices={OUTFIT_CHOICES} value={outfit} onChange={setOutfit} render={(c) => <i className="swatch" style={{ background: OUTFITS[c.id]?.shirt }} />} />
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
