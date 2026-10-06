---
description: Roda a equipe virtual em cadeia (PM → Arquiteto → Game Designer → Multiplayer → Phaser → Pixel Art → Writer)
argument-hint: [fase opcional, ex. MVP | V1] [instrução extra]
---

Rode a equipe virtual em sequência para a fase: ${ARGUMENTS:-MVP}.

Cada etapa usa o subagente indicado e só começa quando a anterior terminou e seu arquivo existe.
Passe para cada subagente: a fase, o caminho do documento que ele deve produzir e o pedido de
seguir o handoff do agente anterior.

1. `product-manager` → `docs/01-roadmap.md`
2. `software-architect` → `docs/02-arquitetura.md`
3. `game-designer` → `docs/03-mecanicas.md`
4. `multiplayer-engineer` → `docs/04-multiplayer.md` + `packages/protocol/src`
5. Em paralelo:
   - `phaser-specialist` → `docs/05-cliente-phaser.md` + `apps/client/src` (rodar `tsc --noEmit`)
   - `environment-designer` → `docs/06-ambientes.md`
6. `technical-writer` → `docs/07..09`, `docs/adr/`, `docs/README.md` com relatório de consistência

Ao final, resuma em até 10 linhas: decisões principais, questões abertas e itens do relatório de consistência.
