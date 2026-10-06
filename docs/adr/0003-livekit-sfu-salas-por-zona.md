# ADR-0003 · LiveKit como SFU de áudio; sala por zona privada e assinatura seletiva na área aberta

**Status:** Aceita (2026-10-06) · **Origem:** `02 §4.3, 04 §8`

## Contexto

Áudio por proximidade para dezenas de pessoas simultâneas (o produto é somente áudio — ver `01 §2`). Mesh P2P não escala além de ~6 participantes. Sala privada exige isolamento que não dependa do cliente.

## Decisão

Usar **LiveKit** (cloud ou self-hosted). Área aberta: uma sala por instância, `autoSubscribe: false`, cliente assina só o `audible set` calculado pelo servidor. Zona privada: uma sala dedicada por zona, token emitido pelo servidor ao entrar e `RemoveParticipant` ao sair.

## Alternativas consideradas

- **Mesh P2P**: O(n²) conexões; inviável.
- **mediasoup**: muito flexível, porém exige construir sinalização, salas e operação — caro para dev solo.
- **Uma sala por bolha**: isolamento forte, mas trocar de sala custa renegociação a cada poucos segundos.
- **Jitsi**: orientado a conferência, não a assinatura seletiva por proximidade.

## Consequências

- (+) Isolamento de sala privada garantido pelo servidor.
- (+) Detecção de fala e Opus com FEC prontos; token restringe publicação ao microfone.
- (−) Custo de mídia é a maior linha da fatura (`01 §2`) → produto somente áudio (~240 GB/mês para 100 usuários).
- (−) Sala aberta com 300 participantes gera sinalização de publicação para todos — validar em teste de carga; plano B: regiões abertas no mapa.
