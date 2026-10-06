# 01 · Roadmap — MVP, V1, V2, V3

**Dono:** product-manager · **Entradas:** `00-briefing.md`, `test.txt` · **Status:** rascunho v1 (2026-10-06)

## 1. Hipótese do produto

> Um time remoto de 10–30 pessoas que passa a "trabalhar dentro" do escritório virtual por uma semana
> tem **mais conversas espontâneas curtas** (< 5 min, sem agendamento) do que com Meet/Teams + Slack,
> sem perder qualidade de chamada.

Métrica norte: **conversas espontâneas por pessoa por dia** (bolhas de áudio de ≥ 2 pessoas, ≥ 30 s, iniciadas sem link de reunião).

Tudo que não move essa métrica fica fora do MVP.

## 2. Premissas de esforço e custo

- Dev solo, **~20 h/semana** dedicadas (resto vai para consultoria). Com 40 h/semana, divida os prazos por ~1,7 (não por 2: integração e teste não escalam linearmente).
- Estimativas são faixas P50–P90. Complexidade: **P** ≤ 3 dias · **M** 1–2 semanas · **G** 3+ semanas.
- Preços de fornecedor **não foram verificados** neste documento: mostro a fórmula e o volume; o preço unitário entra marcado como `verificar`.

### Decisão: somente áudio (2026-10-06)

Conta de banda de mídia (SFU, egress) por usuário em chamada, bolha de 4 pessoas:

| Modo | Por stream recebido | Streams recebidos | Download por usuário |
|---|---|---|---|
| Só áudio (Opus) | ~32 kbps | 3 | ~0,1 Mbps |

Para 100 usuários online, 30% em bolha, 8 h/dia, 22 dias/mês (176 h):

- **Só áudio:** 30 × 0,1 Mbps = 3 Mbps → 3 Mbps × 3600 s × 176 h ÷ 8 bits/byte ≈ **~240 GB/mês**
Para comparação, a mesma conta com vídeo 360p (~500 kbps por stream) daria ~3,8 TB/mês — 16× mais. **Decisão de produto: o produto é somente áudio.** Sem câmera, sem vídeo e sem compartilhamento de tela. Isso corta o maior custo variável, simplifica a UI (não há grade de miniaturas) e reduz o dado pessoal tratado (LGPD). Reabrir só com evidência de uso e via ADR.

Banda do servidor de jogo é desprezível em comparação (ver `04-multiplayer §AOI`: ~3–4 KB/s por cliente).

## 3. Fases

### MVP — "Uma semana inteira dentro do escritório"

**Objetivo:** um time piloto (o seu, ou um cliente amigável) usa o produto como local de trabalho padrão por 1 semana.
**Critério de saída:** ≥ 60% do time piloto ativo ≥ 4 dias na semana 2; nota de qualidade de chamada ≥ 4/5; zero incidente de vazamento de áudio fora de zona privada.

| Funcionalidade | Área do doc original | Compl. | Dono técnico |
|---|---|---|---|
| Login Google (OAuth) + convite por domínio de e-mail | Autenticação | M | architect |
| 1 organização, 1 espaço, 1 mapa (recepção, área de trabalho, 2 salas de reunião, convivência) | Áreas do escritório | M | environment |
| Avatar com nome, 4 direções, animações idle/walk/sit | Sistema de avatares | M | phaser |
| Movimento com teclado e clique-para-andar | — | M | multiplayer + phaser |
| Presença: Disponível / Em reunião / Ausente / Não perturbe (automático + manual) | Sistema de presença | P | multiplayer |
| Áudio por proximidade em área aberta (bolhas) | Comunicação | G | multiplayer |
| Salas de reunião como zona privada (todos na zona se ouvem, ninguém de fora) | Salas de reunião | M | game + multiplayer |
| Chat local (bolha/zona) e chat global com histórico | Comunicação | M | multiplayer |
| "Ir até colega" e "Chamar colega" pela lista de pessoas | — | P | game |
| Mesa com dono (sentar marca "trabalhando") | Área de trabalho | P | game |
| Objetos interativos tipo "portal de link" (quadro → abre Miro/Figma/Docs em painel) | Objetos interativos | P | game + phaser |
| Painel admin mínimo: convidar, remover, papéis (admin/membro) | — | M | architect |
| LGPD base: consentimento A/V, política de retenção de chat, exclusão de conta | — | M | architect |

**Fora do produto (decisão):** câmera, vídeo e compartilhamento de tela.

**Fora do MVP (explícito):** auditório, biblioteca/wiki, sala de diretoria com regras próprias, integrações (GitHub/Jira), dashboard/CRM, eventos agendados, múltiplos andares, elevadores, personalização de mesa, gamificação, loja, NPCs, IA, mobile jogável, editor de mapa.

**Riscos**

| Risco | P | I | Mitigação |
|---|---|---|---|
| Qualidade de áudio ruim mata a adoção | M | A | SFU gerenciado ou testado (LiveKit), áudio-first, teste com rede ruim desde a semana 3 |
| Escopo de arte consome o projeto | A | M | Pacote de tiles licenciado + recolor; arte própria só em avatar e logo |
| Bolhas de áudio confusas ("quem está me ouvindo?") | M | A | Indicador visual de bolha obrigatório no MVP (ver `03-mecanicas`) |
| Dev solo sem tempo | A | A | Fatias de 2 semanas com demo; cortar portais e mesas antes de cortar bolhas |
| Vazamento de áudio fora da sala privada | B | A | Assinatura de tracks decidida no servidor, não no cliente; teste automatizado |

**Custos (100 usuários, áudio-first)**

| Item | Volume | Custo |
|---|---|---|
| Front estático (Vercel ou similar) | baixo | plano gratuito/hobby provável — `verificar` |
| API + realtime (1 VM 2–4 vCPU) | 1 instância | `verificar` (ordem de grandeza: dezenas de US$/mês) |
| Postgres gerenciado pequeno | < 5 GB | `verificar` |
| Redis | < 100 MB | `verificar` (pode rodar na mesma VM no MVP) |
| SFU (LiveKit self-hosted em VM própria ou LiveKit Cloud) | ~240 GB/mês de mídia | `verificar` — comparar minutos de participante (cloud) vs. VM com franquia de tráfego |

**Tempo:** 12–18 semanas a 20 h/semana.

---

### V1 — "Vendável para várias empresas"

**Objetivo:** multi-tenant self-service para empresas de até 300 pessoas.
**Critério de saída:** 3 organizações pagantes ou em piloto ativo; 300 CCU numa instância em teste de carga com p95 de latência de movimento < 150 ms.

| Funcionalidade | Área original | Compl. |
|---|---|---|
| Multi-tenant self-service (criar org, convites, SSO Google Workspace) | — | M |
| Sharding de instâncias de mapa (mapa lotado abre nova instância) | Escalabilidade | G |
| Múltiplos mapas por espaço + portas/elevadores entre mapas | Andares, elevadores | M |
| Auditório (palco fala, plateia ouve; 200 lugares) | Auditório | G |
| Sala da diretoria / salas com controle de acesso (trancar, bater na porta) | Diretoria, controle de acesso | M |
| Status customizado + emoji reactions + wave/celebrate | Avatares | P |
| Escolha de mapa a partir de templates | — | M |
| Observabilidade e alertas de produção | — | M |
| Cobrança (por assento) | — | M |

**Riscos:** custo de SFU no auditório (1 → 200 é broadcast, não conversa: usar modo palco — só quem está no palco publica áudio); suporte a vários clientes sozinho.
**Custos:** escalam com CCU e minutos de mídia; refazer a conta da §2 com dados reais do MVP.
**Tempo:** 12–16 semanas.

---

### V2 — "Onde o trabalho acontece"

**Objetivo:** reduzir troca de aba — o trabalho acontece dentro do escritório.

| Funcionalidade | Área original | Compl. |
|---|---|---|
| Computador da mesa abre dashboard (calendário, metas, kanban) | Dashboard integrado | G |
| Integrações GitHub, Jira, Trello, Azure DevOps (OAuth por usuário) | Sala de dev | G |
| Telões com dashboards ao vivo na sala de dev | Sala de dev | M |
| Eventos agendados (reunião, happy hour, workshop) com convite e lembrete | Sistema de eventos | M |
| Biblioteca: wiki/documentação vinculada a estantes | Biblioteca | M |
| Editor de mapa no navegador (mover móveis, criar zonas) | Personalização | G |
| Personalização de mesa | Expansões | M |

**Riscos:** cada integração é um produto pequeno (OAuth, webhooks, limites de API); priorizar pela demanda dos clientes de V1.
**Tempo:** 16–24 semanas.

---

### V3 — "Cultura e inteligência"

| Funcionalidade | Área original | Compl. |
|---|---|---|
| Conquistas e gamificação leve (sem ranking de produtividade) | Gamificação | M |
| Cosméticos (loja de itens) | Loja | M |
| Pets virtuais | Expansões | P |
| Assistente/NPC de IA (recepcionista, resumo de reunião com consentimento) | IA, NPCs | G |
| Minigames na convivência | Convivência | M |
| Gêmeo digital (ocupação, analytics de uso de espaço agregados e anônimos) | Gêmeo digital | G |

**Risco principal:** gamificação que vira vigilância. Regra: nenhuma métrica individual de "tempo ativo" exposta a gestores.
**Tempo:** a definir com dados de V2.

## 4. Mapa de cobertura do documento original

| Item do doc original | Fase |
|---|---|
| Recepção (balcão, mural, TV institucional) | MVP (visual + mural estático); mural editável V1 |
| Check-in do usuário | MVP (spawn na recepção = entrada do dia) |
| Área de trabalho, sentar, ver status | MVP |
| Abrir ferramentas no computador | V2 |
| Compartilhar tela | **Descartado** — produto somente áudio |
| Salas de reunião P/M | MVP · Grande (20+) V1 |
| Controle de acesso de sala | V1 |
| Sala da diretoria | V1 |
| Espaço de convivência | MVP (visual + bolhas) · minigames V3 |
| Auditório 50–200 | V1 |
| Biblioteca / wiki | V2 |
| Sala de desenvolvimento + integrações | V2 |
| Avatares: nome, status, animações base | MVP · foto/emoji/wave/celebrate V1 |
| Run (correr) | **Descartado** — em escritório só gera colisões e confusão de bolha |
| Presença (5 status) | MVP (Almoço entra como status customizado em V1) |
| Chat local, global | MVP · privado (DM) V1 |
| Áudio por proximidade | MVP |
| Objetos: portas, TVs, quadros | MVP (como portal de link) · elevadores V1 · máquinas de venda V3 |
| Dashboard (kanban, calendário, CRM, vendas) | V2 |
| Eventos | V2 |
| Múltiplos andares | V1 |
| Pets, conquistas, loja, IA, NPCs, gêmeo digital | V3 |
| Hospedagem Vercel/Render/Railway/AWS | Ver `02-arquitetura §9` (Vercel só para o front estático) |

## 5. Métricas por fase

| Métrica | MVP | V1 | V2 |
|---|---|---|---|
| Ativação (entrou e falou com alguém no 1º dia) | ≥ 70% | ≥ 60% | ≥ 60% |
| Conversas espontâneas/pessoa/dia | ≥ 3 | ≥ 3 | ≥ 4 |
| Retenção semanal (W2/W1) | ≥ 60% | ≥ 50% | ≥ 55% |
| Tempo médio em bolha/dia | baseline | +20% | +20% |
| Qualidade de chamada (pesquisa 1–5) | ≥ 4 | ≥ 4 | ≥ 4,2 |
| % sessões com reconexão bem-sucedida sem recarregar | ≥ 95% | ≥ 98% | ≥ 98% |

## 6. Questões abertas

1. Piloto do MVP é o próprio time ou um cliente? (muda o critério de saída e a urgência de multi-tenant)
2. LiveKit Cloud vs. self-hosted: decidir com a conta de minutos real da semana 1 do piloto.
3. ~~Câmera no MVP~~ — decidido em 2026-10-06: somente áudio.

## 7. Para o software-architect

- **Metas de escala:** MVP 100 CCU/instância (teste de carga a 150); V1 300 CCU/instância e 2.000 CCU totais; V2 5.000 CCU totais.
- **Latência:** movimento visível para vizinhos em p95 < 150 ms na mesma região (Brasil).
- **Disponibilidade:** MVP 99% em horário comercial; V1 99,5%.
- **Decisões que preciso:** SFU (qual e onde), fronteira API × realtime, onde roda o realtime (não pode ser serverless), estratégia de multi-tenant que não precise migração em V1, custo mensal por 100 usuários.
