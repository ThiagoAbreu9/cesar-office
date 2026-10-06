# CESAR Office

Escritório virtual 2D pixel art multiplayer, somente áudio (React + Phaser 4 · Node · PostgreSQL · Redis · LiveKit).

- Comece por [`docs/README.md`](docs/README.md).
- Equipe virtual do Claude Code em [`.claude/agents/`](.claude/agents) — rode `/rodar-equipe` (ou `/rodar-equipe V1`) a partir da raiz no Claude Code.
- Instruções da casa para o Claude Code em [`CLAUDE.md`](CLAUDE.md).

```bash
npm install
npm run typecheck
npm test
```

## Ver funcionando (sem login)

**Sandbox — só o navegador, sem servidor.** O servidor realtime roda dentro da página, com dez colegas simulados (rodinha na copa, reunião na Sala Jatobá, gente na mesa):

```bash
npm run dev -w @cesar-office/web -- --mode sandbox    # http://localhost:5173
npm run build:sandbox -w @cesar-office/web            # gera um único index.html em apps/web/dist-sandbox
```

**Multiplayer de verdade — várias abas ou várias máquinas.** Realtime em modo demo (entra só com o nome, ADR-0010) e o app web:

```bash
DEMO_MODE=true TICKET_SECRET=troque-por-um-segredo-de-32-caracteres ALLOWED_ORIGINS=http://localhost:5173 \
  npm run dev -w @cesar-office/realtime                # ws://localhost:4100/ws
npm run dev -w @cesar-office/web                      # abra em duas abas
```

Para outras máquinas da rede, defina `PUBLIC_WS_URL=ws://<ip>:4100/ws`, inclua a origem em `ALLOWED_ORIGINS` e abra `http://<ip>:5173/?server=http://<ip>:4100`. O áudio por proximidade só aparece com LiveKit configurado (`LIVEKIT_*`); sem ele, presença, conversa por proximidade e chat funcionam normalmente.
