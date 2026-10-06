# 00 · Briefing do Projeto — CESAR Office (Escritório Virtual 2D)

> Fonte única de contexto para todos os agentes. Nenhum agente redefine o que está aqui;
> mudanças de escopo passam pelo `product-manager` e viram ADR.

## Visão

Escritório virtual corporativo em pixel art 2D top-down, acessível pelo navegador, onde
colaboradores representados por avatares circulam, se encontram, conversam por proximidade,
fazem reuniões e acessam ferramentas de trabalho. O valor central é **presença e colaboração
espontânea**, não "jogo".

Referências de produto: Gather, WorkAdventure, Kumospace.
Referências visuais (estilo apenas, nunca assets): Stardew Valley, Pokémon (interiores), Habbo.

## Restrições não negociáveis

| Tema | Restrição |
|---|---|
| Escala | Projetar para **milhares de usuários simultâneos no total**, com até **~300 por instância de espaço** no V1. MVP valida 100 por espaço. |
| Plataforma | Navegador desktop (Chrome/Edge/Firefox/Safari recentes). Mobile = somente leitura de chat no MVP. |
| Stack base | TypeScript ponta a ponta. React + Phaser 4 no cliente; Node.js no servidor (API em Fastify — ADR-0009); PostgreSQL; Redis; WebSocket; WebRTC via SFU **somente para áudio**. |
| Arquitetura | Clean Architecture / camadas explícitas; domínio sem dependência de framework; contrato de rede em pacote compartilhado (`packages/protocol`). |
| Segurança | Multi-tenant por organização desde o dia 1 (`org_id` em toda tabela de negócio + RLS como defesa em profundidade). |
| Mídia | **Somente áudio.** Sem câmera, sem vídeo e sem compartilhamento de tela (decisão de 2026-10-06). |
| LGPD | Áudio nunca gravado; consentimento explícito de microfone; retenção configurável de chat; exportação e exclusão de dados do titular. |
| Assets | Somente arte própria, CC0 ou com licença comercial. Proibido copiar tiles de jogos de referência. |
| Equipe | Desenvolvedor solo (+ Claude). Escopo deve caber nisso. |

## Glossário

- **Organização (org)**: tenant; uma empresa.
- **Espaço (space)**: um escritório de uma org (ex.: "Sede"). Tem 1+ mapas.
- **Mapa (map)**: um andar/planta em Tiled (JSON).
- **Instância (instance)**: execução em memória de um mapa num servidor realtime. Um mapa lotado pode ter várias instâncias (shards).
- **Zona**: retângulo/polígono do mapa com regra própria (privada, silenciosa, palco, mesa).
- **Bolha**: grupo de usuários que se ouvem por proximidade em área aberta.
- **AOI (Area of Interest)**: região ao redor do jogador cujas entidades ele recebe por rede.

## Fonte original

O documento original de visão está em `test.txt` (projeto claude.ai "CESAR Office").
Ele lista áreas (recepção, trabalho, reuniões, diretoria, convivência, auditório, biblioteca,
sala de dev), avatares, presença, comunicação, objetos interativos, dashboard, eventos e
expansões. **O roadmap (`01-roadmap.md`) decide o que entra em cada fase.**

## Ordem dos documentos

| # | Documento | Dono |
|---|---|---|
| 01 | `docs/01-roadmap.md` | product-manager |
| 02 | `docs/02-arquitetura.md` | software-architect |
| 03 | `docs/03-mecanicas.md` | game-designer |
| 04 | `docs/04-multiplayer.md` + `packages/protocol` | multiplayer-engineer |
| 05 | `docs/05-cliente-phaser.md` + `apps/client` | phaser-specialist |
| 06 | `docs/06-ambientes.md` | environment-designer |
| 07 | `docs/07-prd-mvp.md`, `docs/08-user-stories.md`, `docs/09-api.md`, `docs/adr/*` | technical-writer |
