# ADR-0001 · Phaser 4 como engine do cliente

**Status:** Aceita (2026-10-06) · **Origem:** `02 §11, 05`

## Contexto

O cliente precisa de tilemap Tiled, câmera com follow e limites, input, spritesheets/animações e render WebGL de pixel art. O documento original listava Phaser e PixiJS. Phaser 4 está estável (4.0.0 em abr/2026; 4.2.1 em jul/2026).

## Decisão

Usar **Phaser 4.x** para render, tilemap, câmera, input e animação. Estado de jogo fica em ECS (bitECS) fora do Phaser; Phaser é só a view (`05 §1`).

## Alternativas consideradas

- **PixiJS**: renderer excelente, mas tilemap, câmera, input e cenas teriam de ser construídos ou montados de bibliotecas avulsas — custo alto para dev solo.
- **Phaser 3.90**: maduro, mas é a última linha da v3; começar projeto novo nela é dívida de migração.
- **Engine própria em Canvas**: controle total, custo proibitivo.

## Consequências

- (+) Tilemap Tiled, câmera e animação prontos; renderer v4 novo.
- (−) Ecossistema de exemplos ainda majoritariamente v3; validar APIs na v4.
- (−) Bundle maior que PixiJS — mitigado carregando Phaser como chunk só na rota do escritório.
- Mitigação estrutural: só `scenes/`, `input/` e `render-system.ts` conhecem Phaser.
