# ADR-0008 · Produto somente áudio

**Status:** Aceita (2026-10-06) · **Origem:** decisão do produto · **Afeta:** `00`, `01 §2`, `02`, `03` (M9 removida), `04 §8`, `07`, `08`, `09`, ADR-0003

## Contexto

O plano inicial previa áudio por proximidade, câmera opcional e compartilhamento de tela. A conta de `01 §2` mostra que vídeo multiplica a banda de mídia por ~16 (≈ 3,8 TB/mês contra ≈ 240 GB/mês para 100 usuários), e é a maior linha de custo variável.

## Decisão

O escritório virtual é **somente áudio**. Sem câmera, sem vídeo e sem compartilhamento de tela, em todas as fases até nova decisão.

- Tokens LiveKit permitem publicar apenas a fonte `microphone`; o SFU recusa câmera e tela mesmo de cliente adulterado.
- Consentimentos (LGPD) restritos a `microphone`, `terms`, `privacy`.
- A presença visual da conversa é feita no próprio mapa (anel da bolha que pulsa com a fala) e numa faixa de nomes no topo da tela.
- A mecânica M9 (compartilhar tela) foi removida; quem precisa mostrar algo usa um portal (M8) para a ferramenta externa.

## Alternativas consideradas

- **Câmera opcional, desligada por padrão:** mantém o custo potencial e a complexidade de UI (grade de vídeos, layout, simulcast).
- **Áudio + tela, sem câmera:** tela é a track mais pesada (1–1,5 Mbps) e exige UI de palco.

## Consequências

- (+) Custo de mídia ~16× menor e previsível; UI mais simples; menos dado pessoal tratado.
- (+) O avatar e o mapa viram o centro da experiência, que é a proposta do produto.
- (−) Demonstrações visuais dependem de ferramenta externa (portal) ou de reunião fora do produto.
- Reabrir só com evidência de uso, via novo ADR.
