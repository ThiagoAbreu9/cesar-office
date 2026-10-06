# ADR-0004 · Realtime separado da API; afinidade decidida pela API, sem sticky load balancer

**Status:** Aceita (2026-10-06) · **Origem:** `02 §2, §5.2`

## Contexto

Conexões longas e estado em memória por instância de mapa exigem que todos os usuários de uma instância estejam no mesmo processo.

## Decisão

Serviços separados. A API escolhe a instância/nó (diretório no Redis) e devolve `wsUrl` do nó + ticket de uso único (30 s). O cliente conecta direto no nó.

## Alternativas consideradas

- **Monólito NestJS com gateway WS**: deploy da API derrubaria conexões; escala acoplada.
- **Load balancer com sticky session por cookie/hash**: mais uma peça, e a afinidade precisa ser por instância de mapa, não por usuário.
- **Serverless (Vercel/Lambda) para WS**: incompatível com estado em memória e conexões longas.

## Consequências

- (+) API faz deploy livremente; realtime escala por nós.
- (+) Mesmo modelo do MVP (1 nó) ao V1 (N nós).
- (−) Cada nó precisa de endereço público e TLS próprio.
- (−) Desligamento de nó exige drenagem (`kicked{shutdown}` + rejoin).
