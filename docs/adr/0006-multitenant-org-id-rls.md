# ADR-0006 · Multi-tenant por org_id com RLS desde o MVP

**Status:** Aceita (2026-10-06) · **Origem:** `02 §6`

## Contexto

O MVP terá uma org, mas o V1 é multi-tenant self-service. Migrar dados para multi-tenant depois é caro e arriscado.

## Decisão

Toda tabela de negócio tem `org_id`. A API filtra por org e, além disso, o Postgres aplica RLS com `SET LOCAL app.org_id` por transação. O papel da aplicação não é owner das tabelas nem tem `BYPASSRLS`.

## Alternativas consideradas

- **Banco por tenant**: isolamento máximo, operação cara.
- **Schema por tenant**: migrações multiplicadas.
- **Só filtro na aplicação**: um bug vaza dados entre empresas.

## Consequências

- (+) Defesa em profundidade; mesmo esquema do MVP ao V2.
- (−) Toda conexão precisa definir `app.org_id` (middleware obrigatório; teste que falha sem ele).
- (−) Consultas administrativas cross-tenant exigem papel separado e auditado.
