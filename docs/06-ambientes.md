# 06 · Ambientes — mapa do MVP, tiles, paleta e atmosfera

**Dono:** environment-designer · **Entradas:** `01-roadmap §3 MVP`, `03-mecanicas` ("Para o environment-designer"), `apps/client/src/world/map-contract.ts` · **Status:** rascunho v1 (2026-10-06)

Referências de **estilo** (nunca de assets): a leitura aconchegante de interiores de Stardew Valley, a clareza de planta baixa dos interiores de Pokémon e a sociabilidade de lobby do Habbo. Nada de tiles, personagens ou paleta extraídos desses jogos (`00-briefing`).

## 1. Especificação técnica

| Item | Valor | Motivo |
|---|---|---|
| Tile | 32 × 32 px | P-01; espaço para mobiliário legível sem custo de 48 px |
| Escala de render | 2× inteiro (`pixelArt`, `roundPixels`) | Nitidez; 1920 × 1080 mostra ~30 × 17 tiles |
| Avatar | 32 × 48 px (1 tile de largura, pés no último terço) | Origem (0,5; 0,85) no `RenderSystem` |
| Mapa MVP "Sede" | **72 × 44 tiles** (2.304 × 1.408 px) | 100 pessoas confortáveis, 300 no limite (§8) |
| Perspectiva | Top-down 3/4 (paredes mostram face frontal de 1 tile) | Padrão do gênero; paredes ocupam 2 tiles de altura visual |
| Contorno | 1 px, cor `ink` (#1B1F2A) só no contorno externo dos objetos | Leitura sobre qualquer piso |
| Luz | Fonte principal do alto-esquerda; sombra projetada 1 tile para baixo-direita com 25% de `deep` | Consistência entre assets de autores diferentes |

## 2. Camadas do Tiled e propriedades (contrato com o código)

Os nomes abaixo são **exatamente** os de `map-contract.ts`. Mudou aqui, muda lá (e vice-versa).

| Ordem | Camada | Tipo | Conteúdo | Profundidade (`Depth`) |
|---|---|---|---|---|
| 1 | `floor` | tiles | Pisos | 0 |
| 2 | `floor_detail` | tiles (opcional) | Tapetes de zona, faixas, sombras no chão | 1 |
| 3 | `walls` | tiles | Paredes (topo e face frontal) | 10 |
| 4 | `furniture_below` | tiles | Tudo que fica **atrás** do avatar: mesas, base de sofás, balcão | 20 |
| 5 | `furniture_above` | tiles | Tudo que fica **na frente**: topo de estantes, folhas altas de plantas, batentes de porta | 100.000 |
| 6 | `collision` | tiles, **invisível** | Qualquer tile não vazio = bloqueado | — |
| 7 | `zones` | objetos | Retângulos de zona | — |
| 8 | `objects` | objetos | Pontos/retângulos interativos | — |

Tileset: nome `office` no Tiled, imagem `tilesets/office-32.png`, *margin* 0, *spacing* 0. Use a classe do objeto (campo **Class**, Tiled ≥ 1.9) para o tipo.

**Camada `zones`**

| Class | Propriedades | Regras |
|---|---|---|
| `private` | `key` (string, único no mapa), `name` (string exibida), `capacity` (int) | Precisa de ao menos uma porta; paredes reais na `collision` em todo o perímetro exceto a porta |
| `spawn` | `key` | Pelo menos um por mapa; só tiles livres dentro |

**Camada `objects`**

| Class | Propriedades | Colide? | Notas |
|---|---|---|---|
| `door` | `key`, `zoneKey` | não | Retângulo cobrindo o vão; 2 tiles de largura no MVP |
| `chair` | `key`, `deskKey` (opcional) | **não** (o avatar senta nele) | A mesa à frente colide; a cadeira não. `deskKey` só em mesas de trabalho |
| `portal` | `key`, `url` (string, pode ficar vazia — admin configura) | sim (o objeto físico) | Ponto de interação a ≤ 1,5 tile da face acessível (P-11) |

**Validações no upload do mapa (servidor rejeita se falhar):** `key` únicos; toda `private` tem `door` com `zoneKey` correspondente; todo `chair` está sobre tile livre na `collision`; todo `spawn` tem ≥ 20 tiles livres; nenhuma zona privada sobreposta a outra.

## 3. Planta do mapa "Sede"

Escala: **1 caractere = 2 × 2 tiles**. 36 × 22 caracteres = 72 × 44 tiles.

```
   0         1         2         3
   012345678901234567890123456789012345
 0 ####################################
 1 #q.......#.........................#
 2 #..T.....#..mm.....mm.....mm.......#
 3 #........#..mm.....mm.....mm....q..#
 4 #.RRRR...D.........................#
 5 #........D.........................#
 6 #.cc..cc.#..mm.....mm.....mm.......#
 7 #........#..mm.....mm.....mm.......#
 8 #...SS...#.........................#
 9 #...SS...#.........................#
10 ####DD######.......................#
11 #..................................#
12 #..................................#
13 ###DD####DD#########DD##############
14 #......#.........q..#..............#
15 #.PPPP.#..MMMMMMMM..#..k..cc..cc...#
16 #.PPPP.#..MMMMMMMM..#..f.......v...#
17 #..q...#..MMMMMMMM..#..m.....g.....#
18 ########............#..cc..cc..tt..#
19 ########............#..............#
20 ########............#..............#
21 ####################################
```

| Símbolo | Significado |
|---|---|
| `#` | Parede (colide e bloqueia áudio — RN-M2-7). Só a camada `walls` bloqueia som; mesas e sofás bloqueiam passagem, não conversa |
| `.` | Piso livre |
| `D` | Porta (2 tiles por caractere → vão de 4 tiles nas portas duplas; salas usam 2 tiles reais, centralizados) |
| `S` | Zona `spawn` |
| `R` | Balcão da recepção |
| `T` | TV institucional (decorativa) |
| `c` | Sofá |
| `mm` | Ilha de 4 mesas de trabalho (4 × 4 tiles: 2 mesas de cada lado, cadeiras para fora) |
| `P` | Área da mesa e cadeiras da Sala Ipê (zona `private`, `capacity` 4) |
| `M` | Área da mesa e cadeiras da Sala Jatobá (zona `private`, `capacity` 10) |
| `q` | Portal (quadro/mural) |
| `k`, `f`, `m` | Cafeteira, geladeira, micro-ondas |
| `v` | Canto do videogame (decorativo no MVP) |
| `g` | Planta grande |
| `tt` | Mesa bistrô |

**Rotas:** spawn → porta inferior da recepção (linha 10) → corredor principal (linhas 11–12, 4 tiles de largura) → salas e copa. Recepção ↔ área de trabalho também pela porta dupla lateral (coluna 9). Nenhum destino exige atravessar outra zona.

**Distâncias que importam (verificadas na planta):**

| Regra | Exigido | No mapa |
|---|---|---|
| Faixa livre entre ilhas de mesas | ≥ 4 tiles (= ≥ 5 tiles entre centros de cadeiras vizinhas, RN-M7-4) | 4 tiles na vertical, 10–12 na horizontal |
| Ilhas → corredor principal | ≥ 5 tiles | 6 tiles |
| Largura do corredor principal | ≥ 3 tiles | 4 tiles |
| Paredes reais em salas privadas | perímetro fechado exceto porta | sim |

## 4. Ambientes

### 4.1 Recepção
- **Tiles:** porcelanato claro (`floor-light`), faixa de tapete `accent` levando da porta ao balcão.
- **Objetos:** balcão em L (4 × 2 tiles, colide), TV institucional na parede (2 × 1, decorativa), 2 sofás de 2 lugares (2 × 1, colidem; sentáveis no V1), mural de avisos `portal` (1 × 1), vasos altos nas quinas (1 × 1, colidem, folhagem em `furniture_above`).
- **Decoração:** logo da empresa na parede atrás do balcão (sprite 4 × 2 trocável por org — único asset personalizável do MVP), relógio de parede.
- **Iluminação:** a mais clara do mapa; luz "de vitrine" (faixa de 15% mais clara perto da porta).
- **Fluxo:** spawn no centro-baixo, porta para o corredor logo abaixo, porta lateral para a área de trabalho — quem chega vê os dois caminhos sem andar.
- **Sensação:** chegada e boas-vindas; "o dia começou".

### 4.2 Área de trabalho (open space)
- **Tiles:** carpete modular cinza-azulado em placas 2 × 2 (`floor-carpet`), com variação sutil a cada 4 placas para quebrar a repetição.
- **Objetos:** 6 ilhas × 4 mesas = **24 mesas** com `chair` + `deskKey`. Mesa 2 × 1 (colide) com monitor duplo (decoração em `furniture_below`), cadeira ergonômica 1 × 1 (não colide). Quadro do Time (`portal`, 2 × 1) na parede direita. Impressora (1 × 1, colide) perto do corredor.
- **Decoração:** plantas pequenas sobre ~1/3 das mesas, luminárias pendentes (em `furniture_above`, projetam círculo de luz no piso a 10% mais claro).
- **Iluminação:** neutra, uniforme.
- **Fluxo:** corredores de 10–12 tiles entre colunas de ilhas; dá para atravessar sem entrar no raio de áudio (3 tiles) de quem está sentado se andar pelo meio.
- **Sensação:** foco com disponibilidade — "estou aqui, pode chegar".

### 4.3 Sala Ipê (pequena, 4 pessoas)
- **Tiles:** piso de madeira (`floor-wood`) + tapete `accent` cobrindo a área da zona — **a zona privada é visível pelo tapete** (§6).
- **Objetos:** mesa redonda 2 × 2 (colide), 4 cadeiras (`chair` sem `deskKey`), quadro branco `portal` 2 × 1 na parede, porta de vidro (batente em `furniture_above`).
- **Iluminação:** 10% mais quente que a área de trabalho.
- **Sensação:** conversa reservada, 1:1.

### 4.4 Sala Jatobá (média, 10 pessoas)
- **Tiles:** madeira + tapete `accent` maior.
- **Objetos:** mesa de reunião 12 × 3 tiles (colide), centralizada na área `M` da planta, 10 cadeiras, TV 3 × 1 na parede (`portal`, usada para "abrir apresentação"), aparador com garrafa d'água.
- **Sensação:** daily, alinhamento de time.

### 4.5 Copa / convivência
- **Tiles:** ladrilho hidráulico (padrão geométrico original em 2 cores, `mustard` + `off-white`) — o piso mais "colorido" do mapa sinaliza informalidade.
- **Objetos:** bancada com cafeteira, micro-ondas e geladeira (colidem); 2 conjuntos de sofás; mesa bistrô alta; canto do videogame com puff e TV (decorativo); planta grande.
- **Decoração:** quadros de fotos do time (sprite trocável no V1), luminária de piso.
- **Iluminação:** a mais quente (+15%).
- **Fluxo:** espaço aberto sem zona privada → bolhas por proximidade (M2). Faixa livre ≥ 4 tiles entre conjuntos de sofás (mesma regra das ilhas de mesa) para formar rodas separadas.
- **Sensação:** "cafezinho" — o lugar das conversas espontâneas, que é a métrica norte do produto.

## 5. Paleta

Paleta original de 18 cores para o mundo. A UI (React) usa os tokens de status do `RenderSystem`, que **não** fazem parte desta paleta (status precisa contrastar com qualquer piso).

| Token | Hex | Papel |
|---|---|---|
| `ink` | `#1B1F2A` | Contorno, texto escuro, fundo do canvas |
| `deep` | `#2E3442` | Sombras projetadas |
| `wall-dark` | `#4A5163` | Face sombreada de parede |
| `wall-mid` | `#6E7689` | Face frontal de parede |
| `wall-light` | `#A3AABA` | Topo de parede, rodapé iluminado |
| `off-white` | `#E6E2D6` | Papel, louça, piso claro |
| `floor-light` | `#D9CBB0` | Porcelanato da recepção |
| `floor-shade` | `#BFAE8E` | Sombra e juntas do piso claro |
| `carpet` | `#7D8AA3` | Carpete da área de trabalho |
| `carpet-shade` | `#64708A` | Variação/sombra do carpete |
| `wood-dark` | `#5C3A2E` | Pés de móveis, sombra de madeira |
| `wood-mid` | `#8A5A3C` | Tampos, piso de madeira |
| `wood-light` | `#C08552` | Brilho de madeira |
| `plant-dark` | `#2F6B4F` | Folhagem sombreada |
| `plant-light` | `#4FA36B` | Folhagem iluminada |
| `accent` | `#2F6FEB` | Tapete de zona privada, marca (trocável por org) |
| `accent-light` | `#8FB4FF` | Borda/realce do tapete de zona |
| `mustard` | `#E5A84B` | Copa, luminárias, calor |

**Contraste:** nomes sobre os avatares em branco `#FFFFFF` sobre placa `ink` a 80% de opacidade → razão ≈ 15:1 sobre qualquer piso (WCAG AA exige 4,5:1). A cor de status nunca é a única pista: ícone junto (RN-M4-1).

## 6. Legibilidade de regras no espaço

| Regra (origem) | Como o usuário percebe |
|---|---|
| Zona privada (M3) | Tapete `accent` com borda `accent-light` de 1 px cobrindo **exatamente** a área da zona; porta com batente destacado; ao entrar, o mundo fora escurece (cliente, `05 §9`) |
| Sala cheia (RN-M3-3) | Porta ganha faixa vermelha no piso e o prompt "Sala cheia (10/10)" |
| Bolha de áudio (M2) | Anel suave no chão unindo os avatares (desenhado pelo cliente, não é tile) |
| Mesa com dono (M7) | Plaquinha com nome sobre a mesa (texto do cliente) e cadeira com encosto da cor `accent` |
| Mesa livre | Cadeira neutra, sem plaquinha |
| Portal (M8) | Objeto com leve brilho pulsante quando a ≤ 1,5 tile + prompt "E · Abrir…" |
| Parede bloqueia áudio (RN-M2-7) | Paredes têm 2 tiles de altura visual — leitura natural de "do outro lado" |

## 7. Produção de assets (prioridade)

| # | Asset | Tamanho | MVP | Placeholder aceitável? |
|---|---|---|---|---|
| 1 | Tileset `office-32.png` com piso claro, carpete, madeira, ladrilho, paredes (topo, face, cantos, portas) | ~16 × 16 tiles | sim | Sim: pacote licenciado (CC0 ou comercial) recolorido para a paleta §5 |
| 2 | Tile de colisão (1 tile vermelho translúcido, só no editor) | 1 tile | sim | — |
| 3 | Avatares `body-0..2.png` 32 × 48, 5 colunas (4 walk + 1 sit) × 4 direções | 160 × 192 cada | sim | Não: identidade do produto, fazer próprio |
| 4 | Mobiliário de trabalho: mesa, monitor duplo, cadeira (4 direções), impressora | — | sim | Sim, recolorido |
| 5 | Mobiliário de sala: mesas redonda e longa, TV, quadro branco | — | sim | Sim |
| 6 | Copa: bancada, cafeteira, geladeira, micro-ondas, sofás, mesa bistrô | — | sim | Sim |
| 7 | Plantas (3 tamanhos), luminárias, relógio, quadros | — | sim | Sim |
| 8 | Fonte bitmap `ui-8` (latin-1 com acentos!) + `status-dot.png` 6 × 6 | — | sim | Fonte pixel com licença OFL |
| 9 | Logo da org 4 × 2 tiles | 128 × 64 | sim | Texto do nome da org |
| 10 | Auditório, biblioteca, diretoria, sala de dev | — | V1/V2 | — |

Antes de usar qualquer pacote de terceiros: guardar o arquivo de licença em `assets/licenses/` e registrar a origem.

## 8. Capacidade e densidade

- Área caminhável estimada: ~2.000 tiles (72 × 44 = 3.168 menos paredes e mobiliário).
- **100 pessoas** → ~20 tiles por pessoa: circulação livre, bolhas bem separadas.
- **300 pessoas** → ~6,7 tiles por pessoa: o corredor e a copa engarrafam; muitas bolhas encostam em P-05 (8 audíveis). É o limite; acima disso a API abre nova instância (`02 §5.1`).
- Para orgs maiores (V1): segundo mapa "Andar 2" ligado por elevador, em vez de esticar este.

## 9. Questões abertas

1. Os tipos `quiet` (em `ZoneType`) e `spawn` (em `ObjectType`) aparecem em `map-contract.ts`, mas este documento define `spawn` como **zona** e não usa `quiet`. Proposta: remover `quiet` até haver regra em `03-mecanicas`, e remover `spawn` de `ObjectType`. Dono da decisão: game-designer + phaser-specialist.
2. Sofás sentáveis (V1) exigem `chair` sem `deskKey` com direção — adicionar propriedade `facing` em `chair`?
