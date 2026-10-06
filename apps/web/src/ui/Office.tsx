import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createGame, type GameEvents } from '@cesar-office/client';
import type { PresenceStatus, ServerMsgOf } from '@cesar-office/protocol';
import type { Joined } from '../backend.ts';

type Channel = 'here' | 'global';
type ChatMsg = ServerMsgOf<'chat'>;

const STATUS: Record<PresenceStatus, { label: string; icon: string }> = {
  available: { label: 'Disponível', icon: '●' },
  in_meeting: { label: 'Em reunião', icon: '◆' },
  away: { label: 'Ausente', icon: '◌' },
  dnd: { label: 'Não perturbe', icon: '⊘' },
};

function useBus<K extends keyof GameEvents>(joined: Joined, event: K, handler: (p: GameEvents[K]) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => joined.bus.on(event, (p) => ref.current(p)), [joined, event]);
}

interface Person {
  readonly userId: string;
  readonly name: string;
  readonly status: PresenceStatus;
  readonly me: boolean;
}

export function Office({ joined, name, sandbox, onLeave }: { joined: Joined; name: string; sandbox: boolean; onLeave: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<ServerMsgOf<'zone'> | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [net, setNet] = useState<string>('online');
  const [audible, setAudible] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<Person[]>([]);
  const [status, setStatus] = useState<PresenceStatus>('available');
  const [mic, setMic] = useState<{ on: boolean; error?: string }>({ on: false });
  const [needsGesture, setNeedsGesture] = useState(false);
  const [audio, setAudio] = useState(() => joined.audioAvailable());
  const [portal, setPortal] = useState<GameEvents['world:open-portal'] | null>(null);
  const [tab, setTab] = useState<Channel>('here');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [unread, setUnread] = useState<Record<Channel, number>>({ here: 0, global: 0 });

  // Jogo: monta uma vez por sessão.
  useEffect(() => {
    if (!stage.current) return;
    const game = createGame({
      parent: stage.current,
      session: joined.session,
      bus: joined.bus,
      assetBaseUrl: '',
      art: 'placeholder',
      ...(joined.inlineMap !== undefined ? { inlineMap: joined.inlineMap } : {}),
    });
    return () => game.destroy();
  }, [joined]);

  // Quem está no escritório: roster da org (todo o mapa) + você.
  useEffect(() => {
    const read = (): void => {
      const list: Person[] = [];
      const world = joined.session.world;
      const local = world.localEntity;
      const me = local !== null ? world.metaOf(local) : undefined;
      if (me) list.push({ userId: me.userId, name: me.displayName, status: me.status, me: true });
      for (const [userId, r] of joined.session.roster) {
        if (userId === me?.userId) continue;
        const eid = world.entityOfUser(userId);
        const live = eid !== undefined ? world.metaOf(eid) : undefined;
        list.push({ userId, name: r.displayName || live?.displayName || 'Colega', status: live?.status ?? r.status, me: false });
      }
      setAudio(joined.audioAvailable());
      list.sort((a, b) => (a.me ? -1 : b.me ? 1 : a.name.localeCompare(b.name, 'pt-BR')));
      setPeople(list);
    };
    read();
    const t = window.setInterval(read, 500);
    return () => window.clearInterval(t);
  }, [joined]);

  useBus(joined, 'world:zone', setZone);
  useBus(joined, 'world:interact-prompt', (p) => setPrompt(p ? p.label : null));
  useBus(joined, 'world:open-portal', setPortal);
  useBus(joined, 'world:correction', ({ reason }) => {
    if (reason === 'zone_full') flash('Sala cheia. Espere alguém sair ou chame a pessoa pela lista.');
  });
  useBus(joined, 'net:state', ({ state }) => setNet(state));
  useBus(joined, 'media:audible', ({ peers }) => setAudible(peers.map((p) => p.userId)));
  useBus(joined, 'media:speaking', ({ userIds }) => setSpeaking(new Set(userIds)));
  useBus(joined, 'media:mic', ({ enabled, error }) => setMic({ on: enabled, ...(error ? { error } : {}) }));
  useBus(joined, 'media:needs-gesture', ({ needed }) => setNeedsGesture(needed));
  useBus(joined, 'chat:message', (m) => {
    setMessages((xs) => [...xs.slice(-199), m]);
    setUnread((u) => (m.channel === tab ? u : { ...u, [m.channel]: u[m.channel] + 1 }));
  });
  useBus(joined, 'kicked', ({ reason }) => flash(reason === 'replaced_by_new_tab' ? 'Você abriu o escritório em outra aba.' : 'Você saiu do escritório.'));

  const toastTimer = useRef<number | null>(null);
  function flash(text: string): void {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  // O status exibido é o do servidor (inclui automáticos: Em reunião, Ausente).
  const myStatus = people.find((p) => p.me)?.status ?? status;
  const nameOf = useMemo(() => new Map(people.map((p) => [p.userId, p.name])), [people]);
  const inConversation = audible.map((id) => ({ id, name: nameOf.get(id) ?? 'Alguém' }));
  const visible = messages.filter((m) => m.channel === tab);

  const changeStatus = (s: PresenceStatus): void => {
    setStatus(s);
    joined.bus.emit('ui:set-status', { status: s });
  };

  return (
    <div className="office">
      <div ref={stage} className="stage" aria-label="Mapa do escritório. Use as setas ou WASD para andar." />

      <header className="hud-top">
        <div className={`place${zone?.zoneKey ? ' is-room' : ''}`} aria-live="polite">
          {zone?.zoneKey ? (
            <>
              <span className="place-name">{zone.name}</span>
              <span className="place-meta">
                {zone.occupancy} de {zone.capacity} · só quem está aqui escuta
              </span>
            </>
          ) : (
            <>
              <span className="place-name">Área aberta</span>
              <span className="place-meta">Chegue perto de alguém para conversar</span>
            </>
          )}
        </div>

        <div className="controls">
          {sandbox && <span className="demo-tag">Demonstração</span>}
          <label className="status">
            <span className={`dot dot-${myStatus}`} aria-hidden="true">
              {STATUS[myStatus].icon}
            </span>
            <select value={myStatus} onChange={(e) => changeStatus(e.target.value as PresenceStatus)} aria-label="Seu status">
              {(Object.keys(STATUS) as PresenceStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
          </label>
          {audio ? (
            <button className={`mic${mic.on ? ' is-on' : ''}`} onClick={() => joined.bus.emit('ui:mic', { enabled: !mic.on })} aria-pressed={mic.on}>
              {mic.on ? 'Microfone ligado' : 'Ligar microfone'}
            </button>
          ) : (
            <span className="mic is-off" title="O áudio por proximidade usa um servidor LiveKit, que não está configurado aqui.">
              {sandbox ? 'Áudio indisponível na demo' : 'Áudio não configurado'}
            </span>
          )}
          <button className="leave" onClick={onLeave}>
            Sair
          </button>
        </div>
      </header>

      {mic.error && (
        <p className="banner" role="alert">
          {mic.error === 'permission_denied' ? 'O navegador bloqueou o microfone. Libere o acesso no ícone de cadeado da barra de endereço.' : 'Nenhum microfone encontrado.'}
        </p>
      )}
      {needsGesture && (
        <button className="banner banner-action" onClick={() => joined.bus.emit('ui:start-audio', {})}>
          Clique para ouvir as pessoas ao seu redor
        </button>
      )}
      {net !== 'online' && (
        <p className="banner" role="status">
          {net === 'resuming' ? 'Conexão instável — reconectando sem perder seu lugar…' : 'Sem conexão com o escritório.'}
        </p>
      )}

      <aside className="side" aria-label="Pessoas e conversa">
        <section className="card conversation">
          <h2>Na conversa</h2>
          {inConversation.length === 0 ? (
            <p className="empty">Ninguém por perto. Ande até uma pessoa ou entre numa sala.</p>
          ) : (
            <ul className="people">
              {inConversation.map((p) => (
                <li key={p.id} className={speaking.has(p.id) ? 'is-speaking' : ''}>
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card nearby">
          <h2>No escritório agora · {people.length}</h2>
          <ul className="people">
            {people.map((p) => (
              <li key={p.userId}>
                <span className={`dot dot-${p.status}`} aria-label={STATUS[p.status].label}>
                  {STATUS[p.status].icon}
                </span>
                <span className="person-name">{p.me ? `${name} (você)` : p.name}</span>
                {!p.me && (
                  <button className="link" onClick={() => joined.bus.emit('ui:go-to', { userId: p.userId })}>
                    Ir até
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card chat">
          <div className="tabs" role="tablist">
            {(['here', 'global'] as const).map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={tab === c}
                className={tab === c ? 'is-on' : ''}
                onClick={() => {
                  setTab(c);
                  setUnread((u) => ({ ...u, [c]: 0 }));
                }}
              >
                {c === 'here' ? 'Aqui' : 'Todo o escritório'}
                {unread[c] > 0 && <span className="badge-count">{unread[c]}</span>}
              </button>
            ))}
          </div>
          <ChatLog messages={visible} channel={tab} />
          <ChatInput joined={joined} channel={tab} />
        </section>
      </aside>

      {prompt && (
        <p className="prompt">
          <kbd>E</kbd> {prompt}
        </p>
      )}
      <p className="help">Setas ou WASD para andar · clique no chão para ir até lá</p>
      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}

      {portal && (
        <div className="modal" role="dialog" aria-labelledby="portal-title" onClick={() => setPortal(null)}>
          <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 id="portal-title">{portal.name}</h2>
            {portal.url ? (
              <a className="enter" href={portal.url} target="_blank" rel="noopener noreferrer">
                Abrir quadro
              </a>
            ) : (
              <p>Este quadro ainda não tem um link. Um administrador pode ligá-lo ao Miro, Figma ou Docs do time.</p>
            )}
            <button className="link" onClick={() => setPortal(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatLog({ messages, channel }: { messages: ChatMsg[]; channel: Channel }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Corpo em bloco de propósito: scrollIntoView devolve Promise em navegadores novos, e o React
    // trataria o retorno como função de limpeza.
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  if (messages.length === 0) {
    return <p className="empty">{channel === 'here' ? 'Mensagens daqui só chegam a quem está na conversa e não ficam salvas.' : 'Avisos para todo o escritório aparecem aqui.'}</p>;
  }
  return (
    <ol className="log">
      {messages.map((m) => (
        <li key={m.id}>
          <span className="who">{m.fromName}</span> {m.body}
        </li>
      ))}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

function ChatInput({ joined, channel }: { joined: Joined; channel: Channel }) {
  const [text, setText] = useState('');
  const send = (e: FormEvent): void => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    joined.bus.emit('ui:chat-send', { channel, body, clientMsgId: crypto.randomUUID() });
    setText('');
  };
  return (
    <form className="compose" onSubmit={send}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => joined.bus.emit('ui:focus-game', { focused: false })}
        onBlur={() => joined.bus.emit('ui:focus-game', { focused: true })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        maxLength={2000}
        placeholder={channel === 'here' ? 'Escreva para quem está aqui' : 'Escreva para todo o escritório'}
        aria-label="Mensagem"
      />
      <button type="submit" disabled={!text.trim()}>
        Enviar
      </button>
    </form>
  );
}
