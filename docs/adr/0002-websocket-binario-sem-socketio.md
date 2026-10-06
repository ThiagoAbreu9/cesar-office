# ADR-0002 · WebSocket puro com protocolo binário próprio no realtime

**Status:** Aceita (2026-10-06) · **Origem:** `02 §2, 04 §2`

## Contexto

O tráfego dominante é posição a 10 Hz para até 300 clientes por instância. O documento original citava Socket.IO.

## Decisão

Usar WebSocket puro (`ws` ou uWebSockets.js) com frames binários: Input de 8 B, Snapshot de 7 + 7n B, e Control em JSON validado por zod. Contrato em `packages/protocol`.

## Alternativas consideradas

- **Socket.IO**: framing extra por mensagem, fallback de long-polling desnecessário em 2026, e o adapter Redis faz broadcast entre nós — exatamente o que não queremos para posição.
- **Colyseus**: framework de salas com sincronização de estado; reduziria código, mas acopla o domínio ao modelo de schema dele e esconde backpressure.
- **JSON para tudo**: ~5–10× mais bytes por atualização de posição.

## Consequências

- (+) Banda previsível e documentada; controle de backpressure (`bufferedAmount`).
- (−) Escrevemos o próprio codec e o próprio roteamento de mensagens (já implementado e testado).
- (−) Sem reconexão automática de biblioteca — implementada em `Connection` (`04 §5`).
