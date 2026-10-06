# CESAR Office — documentação

Escritório virtual 2D pixel art multiplayer, **somente áudio**. Gerado pela equipe virtual de `.claude/agents/` (cadeia `/rodar-equipe`, fase MVP) em 2026-10-06.

## Índice

| # | Documento | Dono | Conteúdo |
|---|---|---|---|
| 00 | [Briefing](00-briefing.md) | — | Visão, restrições não negociáveis, glossário |
| 01 | [Roadmap](01-roadmap.md) | product-manager | MVP/V1/V2/V3, custos, riscos, mapa de cobertura do doc original |
| 02 | [Arquitetura](02-arquitetura.md) | software-architect | Containers, fluxos, escala, ERD + DDL, segurança, LGPD, deploy |
| 03 | [Mecânicas](03-mecanicas.md) | game-designer | 9 mecânicas do MVP + tabela de parâmetros P-xx |
| 04 | [Multiplayer](04-multiplayer.md) | multiplayer-engineer | Protocolo, AOI, interpolação, predição, reconexão, presença, chat, áudio |
| 05 | [Cliente Phaser](05-cliente-phaser.md) | phaser-specialist | Estrutura, cenas, ECS, fronteira com React, performance |
| 06 | [Ambientes](06-ambientes.md) | environment-designer | Planta do mapa, camadas Tiled, paleta, assets |
| 07 | [PRD do MVP](07-prd-mvp.md) | technical-writer | Requisitos rastreados, critérios de lançamento |
| 08 | [User stories](08-user-stories.md) | technical-writer | Épicos e critérios Gherkin |
| 09 | [API](09-api.md) | technical-writer | REST + protocolo WebSocket |
| ADR | [0001](adr/0001-phaser-4-no-cliente.md) · [0002](adr/0002-websocket-binario-sem-socketio.md) · [0003](adr/0003-livekit-sfu-salas-por-zona.md) · [0004](adr/0004-realtime-separado-afinidade-pela-api.md) · [0005](adr/0005-predicao-cliente-validacao-servidor.md) · [0006](adr/0006-multitenant-org-id-rls.md) · [0007](adr/0007-chat-de-bolha-nao-persistido.md) · [0008](adr/0008-produto-somente-audio.md) · [0009](adr/0009-api-fastify-sem-nestjs.md) | — | Decisões arquiteturais |

## Leitura por perfil

- **Dev começando agora:** 00 → 02 §2–5 → 04 §1–2 → 05 §2 → código em `packages/protocol`.
- **Produto:** 00 → 01 → 07 → 08.
- **Design/arte:** 03 (fluxos) → 06.

## Código que acompanha

| Pacote | Estado | Verificação |
|---|---|---|
| `packages/protocol` | Contrato do MVP (Input 8 B, Snapshot 7 + 7n B, Control JSON validado) | `tsc` strict ✓ · 8 testes |
| `packages/world` | Colisão, acústica (só paredes), A*, leitura/validação de mapas Tiled; mapa **Sede** gerado da planta de 06 §3 | `tsc` ✓ · 9 testes |
| `apps/realtime` | **Servidor completo de nó único**: tickets, instâncias, movimento validado, zonas, AOI + LOD, ghost/resume, áudio por proximidade, chat, presença, chamados, mesas, LiveKit só-áudio | `tsc` ✓ · 25 testes de domínio + 11 ponta a ponta · carga com 150 bots (02 §5.4) |
| `apps/client` | Cliente Phaser 4 + bitECS + camada de áudio LiveKit | `tsc` ✓ · 12 testes |
| `packages/ticket` | Ticket de entrada (JWT HS256, uso único): a API assina, o realtime verifica | `tsc` ✓ · 4 testes |
| `apps/api` | Fastify + PostgreSQL com RLS: login de desenvolvimento, sessões com refresh rotativo e detecção de reuso, conta e LGPD (exportar/excluir), orgs, convites, papéis, espaços e `join` | `tsc` ✓ · 14 testes em Postgres real (PGlite) + 2 de cadeia completa API → realtime |

```bash
npm install
npm run typecheck          # todos os pacotes
npm test                   # 85 testes

# API (Postgres local; o mesmo TICKET_SECRET do realtime)
cd apps/api
MIGRATION_DATABASE_URL=postgres://postgres@localhost/cesar node --experimental-transform-types src/migrate.ts
DATABASE_URL=postgres://cesar_api@localhost/cesar ACCESS_TOKEN_SECRET=$(openssl rand -hex 32) TICKET_SECRET=<mesmo do realtime> \
  REALTIME_PUBLIC_URL=ws://localhost:4100/ws AUTH_DEV_LOGIN=true node --experimental-transform-types src/main.ts

# servidor realtime local (sem LiveKit = sem áudio, o resto funciona)
cd apps/realtime
TICKET_SECRET=$(openssl rand -hex 32) node --experimental-transform-types src/main.ts
node --experimental-transform-types scripts/load.ts 150 30   # teste de carga
```

Diagramas: 13 blocos Mermaid validados com o parser oficial (mermaid 11). DDL de `02 §6.3` executado em PostgreSQL (PGlite) com teste de isolamento RLS.

## Relatório de consistência

| # | Divergência | Onde | Dono | Situação |
|---|---|---|---|---|
| 1 | Diagrama de reconexão falava em `lastServerSeq`; o protocolo usa `lastTick` | 02 §4.4 | software-architect | ✅ Corrigido |
| 2 | Nomes de eventos em PascalCase conceitual (`ZoneChanged`, `AudibleSet`, `EntityState`, `ClaimDesk`) diferem do protocolo (`zone`, `audible`, estado no byte do snapshot, `claim_desk`) | 03 "Para o multiplayer-engineer" | game-designer | Aberto — o código é a fonte da verdade |
| 3 | `ZoneType` com `quiet` sem regra; `spawn` como objeto | `map-contract.ts` | game-designer + phaser-specialist | ✅ Resolvido em `packages/world` (`private`/`spawn` são zonas; `door`/`chair`/`portal` são objetos) |
| 4 | RN-M7-4 "≥ 5 tiles" × 06 "≥ 5 tiles entre centros de cadeiras" | 03 M7 × 06 §3 | game-designer | Aberto — reescrever com a medida centro a centro |
| 5 | Códigos de fechamento WebSocket só em 09 | 09 × 04 §5 | multiplayer-engineer | ✅ Adotados no servidor (`CloseCode`) |
| 6 | `CollisionGrid` só no cliente | 04 §4 × 05 | phaser-specialist + multiplayer-engineer | ✅ Movido para `packages/world`, usado pelos dois lados |
| 7 | "Andar 1 · sala 2" para instância confunde com mapa/andar | 00 × 03 M1 | game-designer | Aberto |
| 8 | Preços de infraestrutura e LiveKit não verificados | 01 §3, 02 §9 | product-manager | Aberto |
| 10 | RLS com `current_setting(...)::uuid` quebrava com pool de conexões (variável revertida vira `''`) | 02 §6.3 | software-architect | ✅ Corrigido com `NULLIF` (pego pelos testes da API) |
| 9 | Estimativa de banda (0,85 KB/s) muito abaixo do medido (5,3 KB/s) no mapa Sede | 02 §5.4 | software-architect | ✅ Números medidos registrados; RNF-05 revisto em 07 |

## Questões abertas consolidadas

1. Piloto = time próprio ou cliente? (01 §6)
2. LiveKit Cloud vs. self-hosted (01 §6, ADR-0003)
3. Sofás sentáveis exigem `facing` em `chair` (06 §9)
4. Sala aberta com 300 participantes no LiveKit: validar sinalização com LiveKit real (04 §8.2)
5. 300 por instância: repetir o teste de carga em máquina dedicada (02 §5.4)
