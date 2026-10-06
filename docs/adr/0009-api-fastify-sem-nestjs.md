# ADR-0009 · API em Fastify com composição explícita, sem NestJS

**Status:** Aceita (2026-10-06) · **Origem:** implementação de `apps/api` · **Afeta:** `00` (stack), `02 §2–3`

## Contexto

O briefing previa NestJS para a API. Ao implementar, três fatos pesaram:

1. A arquitetura já separa domínio, aplicação e infraestrutura com portas e um *composition root* (como no `apps/realtime`). O módulo/DI do Nest repetiria isso com outra mecânica.
2. A injeção de dependência do Nest depende de decorators com metadados de tipo (`emitDecoratorMetadata`). O monorepo roda TypeScript direto no Node (`--experimental-transform-types`), que não emite esses metadados; exigiria build com `tsc`/SWC só para a API.
3. Equipe de uma pessoa: menos camadas de framework = menos a aprender e a depurar.

## Decisão

`apps/api` usa **Fastify 5** como camada de interface, com validação por **zod** e um `main.ts` que monta tudo explicitamente. Casos de uso e repositórios não importam Fastify.

Segurança na borda: `@fastify/helmet`, CORS com lista de origens, `@fastify/rate-limit` (global e mais restrito em `/auth/*` e `join`), corpo máximo de 16 KB, erros em problem+json.

## Alternativas consideradas

- **NestJS:** produtividade com módulos, guards e Swagger prontos; custo de build com decorators, duplicação do DI e acoplamento dos casos de uso a decorators.
- **Express:** ecossistema enorme, porém sem tipagem de rotas nem plugins modernos de rate limit/cookies no mesmo nível; desempenho menor.

## Consequências

- (+) Mesmo estilo e mesma forma de rodar testes em toda a base; a API sobe com `node` sem build.
- (+) Casos de uso testáveis sem servidor; a borda HTTP é fina.
- (−) Sem geração automática de OpenAPI: `09-api.md` é mantido à mão (candidato: gerar a partir dos esquemas zod).
- (−) Convenções que o Nest imporia (módulos, guards) precisam ser seguidas por disciplina — o `CLAUDE.md` registra.
