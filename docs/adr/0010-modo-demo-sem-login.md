# ADR-0010 · Modo demonstração sem login

**Status:** Aceita (2026-10-06) · **Origem:** pedido de MVP demonstrável antes do login Google · **Afeta:** `02 §4.1`, `05`, `09 §1`

## Contexto

O login Google ficou para depois, mas o produto precisa ser mostrado agora: andar pelo escritório, ver colegas, conversar por proximidade. A entrada normal (`POST /orgs/:orgId/spaces/:spaceId/join` na API) exige sessão autenticada, organização e banco.

## Decisão

Dois caminhos de demonstração, ambos falando o protocolo de produção sem atalhos no domínio:

1. **Modo demo do realtime** (`DEMO_MODE=true`). O realtime expõe `POST /demo/join { name, body }`, que emite um ticket de convidado (mesmas claims da API, `userId` aleatório) para uma org e um espaço fixos, e `GET /maps/:id.json`. Limite de 10 entradas por minuto por IP. A configuração **recusa** `DEMO_MODE` com `NODE_ENV=production`.
2. **Sandbox no navegador** (`apps/web --mode sandbox`). O `RealtimeService` roda dentro da página com adaptadores em memória e um socket de loopback (`@cesar-office/realtime/sandbox`). Dez bots falam o protocolo real (hello, Input binário, interact, chat). A arte é gerada em canvas (`placeholder-art.ts`) e o mapa vai embutido, então o build é um único `index.html`.

O app web (`apps/web`, React + Vite) é o mesmo nos dois casos; só muda o `Backend` que faz a entrada.

## Alternativas consideradas

- **Dev-login da API** (`AUTH_DEV_LOGIN`): já existe, mas exige Postgres, migrações e criação de org para cada demo.
- **Vídeo gravado:** não mostra a interação, que é o ponto do produto.
- **Bypass de ticket no realtime:** mais simples, mas criaria um segundo caminho de autenticação dentro do serviço. O modo demo emite um ticket normal e o restante do fluxo é idêntico.

## Consequências

- (+) Demonstração com zero infraestrutura (sandbox) ou com um processo Node (modo demo).
- (+) O sandbox exercita o `RealtimeService` real: um bug de regra aparece na demo como apareceria em produção.
- (+) Convidados ganham nome na lista de presença (`presence.displayName`, roster enviado após `welcome`/`resumed`).
- (−) Convidados não têm conta: nada persiste e qualquer pessoa com acesso à porta entra. Uso restrito a redes confiáveis.
- (−) Áudio continua dependendo de LiveKit; o sandbox não tem áudio.
- Ao entrar o login Google, o modo demo continua útil para desenvolvimento e testes de carga; a decisão de mantê-lo fica em aberto.
