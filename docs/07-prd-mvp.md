# 07 · PRD — MVP "Uma semana inteira dentro do escritório"

**Dono:** technical-writer · **Consolida:** `01`–`06` · **Status:** rascunho v1 (2026-10-06)

## 1. Problema

Times remotos e híbridos perderam a conversa de corredor. Toda interação vira reunião agendada ou mensagem assíncrona; perguntas rápidas esperam horas e ninguém sabe quem está disponível agora (`01 §1`).

## 2. Público

| Persona | Contexto | O que precisa |
|---|---|---|
| Colaborador remoto | Trabalha o dia inteiro conectado | Saber quem está por perto e falar em segundos, sem link |
| Líder de time | Conduz dailies e 1:1 | Salas previsíveis e privadas |
| Admin da org | Configura o espaço | Convidar pessoas, definir retenção, configurar quadros |

Piloto: um time de 10–30 pessoas (`01 §3`).

## 3. Objetivos e não-objetivos

**Objetivos**
1. Conversas espontâneas: ≥ 3 por pessoa por dia (`01 §5`).
2. Adoção: ≥ 60% do piloto ativo ≥ 4 dias na semana 2.
3. Qualidade: nota de chamada ≥ 4/5; zero vazamento de áudio de sala privada.

**Fora do produto:** câmera, vídeo, compartilhamento de tela (`01 §2`).

**Não-objetivos do MVP** (`01 §3`): auditório, biblioteca, diretoria, integrações, dashboard, eventos, múltiplos andares, personalização, gamificação, IA, mobile jogável, editor de mapa.

## 4. Requisitos funcionais

| ID | Requisito | Rastreio |
|---|---|---|
| RF-01 | Login Google; entrada restrita a membros; autoaceite por domínio | 03 M1 RN-M1-1 · 02 §4.1 |
| RF-02 | Escolha de aparência e nome na primeira entrada | 03 M1 fluxo 2 |
| RF-03 | Spawn na última posição do dia ou na recepção, sempre em tile livre | RN-M1-2 |
| RF-04 | Movimento por teclado e clique-para-andar com predição local | 03 M1/M6 · 04 §4 |
| RF-05 | Áudio por proximidade em área aberta com histerese, dwell, atenuação e limite de 8 | RN-M2-1..7 · 04 §8 |
| RF-06 | Salas privadas com capacidade e isolamento de áudio garantido pelo servidor | RN-M3-1..6 · 02 §4.3 |
| RF-07 | Status de presença manual e automático, visível em ≤ 3 s | RN-M4-1..4 · 04 §6 |
| RF-08 | Chat "Aqui" (bolha efêmera / sala persistente) e "Geral", idempotente | RN-M5-1..6 · 04 §7 |
| RF-09 | "Ir até" e "Chamar" colega pela lista | RN-M6-1..3 |
| RF-10 | Sentar e reivindicar mesa | RN-M7-1..4 |
| RF-11 | Portais (quadros) abrindo ferramentas externas em painel | RN-M8-1..3 |
| RF-13 | Admin: convidar, remover, papéis, retenção de chat, URLs de portais | 01 §3 · 09 |
| RF-14 | LGPD: consentimento de microfone, exportação e exclusão de conta | 02 §8 |
| RF-15 | Reconexão transparente em até 30 s sem recarregar a página | 04 §5 |

## 5. Requisitos não funcionais

| ID | Requisito | Rastreio |
|---|---|---|
| RNF-01 | 150 CCU por instância no teste de carga (meta V1: 300) | 02 §1, §5.1 |
| RNF-02 | Movimento visível a vizinhos p95 < 150 ms (Brasil) | 02 §1 |
| RNF-03 | Áudio audível após cruzar o raio p95 < 1,2 s | 03 M2 critérios |
| RNF-04 | Do clique em Entrar ao avatar controlável p75 < 3 s em 4G | 03 M1 critérios |
| RNF-05 | Banda de jogo ≤ 8 KB/s por cliente com 150 numa instância (medido: 5,3 mediana, 6,4 p95) | 02 §5.4 · 04 §2 |
| RNF-06 | Disponibilidade 99% em horário comercial | 01 §7 |
| RNF-07 | Multi-tenant com RLS por `org_id` | 02 §6.3 |
| RNF-08 | Somente áudio (sem câmera, vídeo ou tela); áudio não gravado; chat de bolha não persistido | 02 §8 |
| RNF-09 | 60 fps com ~100 avatares visíveis em notebook comum | 05 §7 |

## 6. Métricas

Ver `01 §5`. Instrumentação mínima: eventos `bubble_formed` (com duração e tamanho, sem identificar quem), `session_start`, `resume_ok/failed`, nota de chamada ao fim do dia (amostragem).

## 7. Riscos

Ver `01 §3` (tabela). Os três que bloqueiam lançamento: qualidade de áudio, bolhas confusas, vazamento em sala privada.

## 8. Critérios de lançamento do piloto

- [ ] Todas as histórias "P0" de `08-user-stories.md` aceitas
- [ ] Teste de carga: 150 bots numa instância por 30 min com tick p99 < 50 ms
- [ ] Teste de isolamento automatizado: bot fora da sala não consegue mídia da sala (RN-M3-5)
- [ ] Teste de rede ruim (300 ms RTT, 5% perda): reconexão ≥ 95% sem recarregar
- [ ] Política de privacidade e termo de uso publicados; DPA com a empresa piloto
- [ ] Mapa "Sede" validado pelas regras de `06 §2`
