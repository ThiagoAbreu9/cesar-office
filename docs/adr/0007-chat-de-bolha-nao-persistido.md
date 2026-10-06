# ADR-0007 · Chat de bolha em área aberta não é persistido

**Status:** Aceita (2026-10-06) · **Origem:** `02 §6.1, 03 RN-M5-2`

## Contexto

Bolhas são conversas de corredor efêmeras. Persistir tudo aumenta dado pessoal tratado (LGPD) e custo, sem valor claro.

## Decisão

Mensagens "Aqui" em bolha aberta só são entregues aos membros no momento; não vão ao Postgres. Chat de zona privada e Geral são persistidos com retenção configurável pela org (padrão 90 dias).

## Alternativas consideradas

- **Persistir tudo**: mais dado, mais risco, mais custo.
- **Não persistir nada**: perde histórico útil de reuniões e avisos gerais.

## Consequências

- (+) Minimização de dados; alinhado ao "corredor".
- (−) Mensagens de bolha enviadas durante uma queda de conexão são perdidas (documentado em `04 §5`).
- (−) Usuários podem esperar histórico; a UI deve indicar "conversa de corredor — não fica salva".
