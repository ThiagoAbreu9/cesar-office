# CESAR Office — instruções para o Claude Code

Escritório virtual 2D pixel art multiplayer. Leia `docs/00-briefing.md` antes de qualquer tarefa.

## Equipe virtual (subagentes em `.claude/agents/`)

| Agente | Quando usar | Produz |
|---|---|---|
| `product-manager` | Escopo, fases, priorização, trade-off de prazo | `docs/01-roadmap.md` |
| `software-architect` | Componentes, dados, infra, segurança, custo, deploy | `docs/02-arquitetura.md` |
| `game-designer` | Mecânicas, regras de interação, UX de jogo | `docs/03-mecanicas.md` |
| `multiplayer-engineer` | Protocolo, sync, AOI, reconexão, presença, áudio espacial | `docs/04-multiplayer.md`, `packages/protocol/` |
| `phaser-specialist` | Código do cliente de jogo (Phaser 4 + TS + ECS) | `docs/05-cliente-phaser.md`, `apps/client/` |
| `environment-designer` | Mapas, tiles, paleta, layout, atmosfera | `docs/06-ambientes.md` |
| `technical-writer` | PRD, ADR, user stories, docs de API, consistência | `docs/07..09`, `docs/adr/` |

Rode a cadeia completa com `/rodar-equipe`. Para uma mudança pontual, chame só o agente dono
e depois o `technical-writer` para atualizar ADR/PRD.

## Regras da casa

- Português nos documentos; inglês em identificadores de código.
- Um documento tem um dono. Outro agente que discordar registra em **"Questões abertas"** do
  próprio documento — não reescreve o documento alheio.
- Toda decisão arquitetural irreversível ou cara vira ADR (`docs/adr/NNNN-titulo.md`).
- Números (taxas de tick, limites, custos) têm uma fonte: o documento do dono. Os outros referenciam.
- Código: TypeScript `strict`, sem `any`, domínio sem import de framework, testes para regras de negócio.
- Contrato de rede só muda em `packages/protocol` e com bump de `PROTOCOL_VERSION`.
- API (`apps/api`, ADR-0009): rotas só validam (zod) e chamam casos de uso; tabela com `org_id` só é tocada dentro de `uow.tenant(orgId, ...)`. Migração nova = arquivo novo em `apps/api/migrations` (nunca editar uma já aplicada).
- Login: `AuthService.signIn(identity)` recebe identidade já verificada. Google entra como novo provedor, sem mexer nos casos de uso.
