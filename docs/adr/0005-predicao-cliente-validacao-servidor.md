# ADR-0005 · Movimento com predição no cliente e validação no servidor

**Status:** Aceita (2026-10-06) · **Origem:** `04 §1, §4`

## Contexto

Escritório não tem combate; a prioridade é resposta imediata ao teclado e impedir trapaças que quebrem regras (atravessar parede, invadir sala).

## Decisão

O cliente simula o próprio avatar e envia posições absolutas a 10 Hz. O servidor valida velocidade (1,25× P-02), segmento sem parede e permissão de zona; rejeição gera `correction`. Inputs em trânsito após correção são descartados pela própria regra de velocidade.

## Alternativas consideradas

- **Servidor autoritativo com replay de inputs (estilo FPS)**: correto, mas complexo e desnecessário aqui.
- **Cliente autoritativo sem validação**: trivial de trapacear; quebra isolamento de sala.

## Consequências

- (+) Sem atraso percebido; reconciliação simples (aceitar ou corrigir).
- (−) Colisão precisa ter a mesma semântica nos dois lados → mover `CollisionGrid` para pacote compartilhado (pendência `05 §9`).
