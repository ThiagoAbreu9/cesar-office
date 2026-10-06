# 08 · User stories do MVP

**Dono:** technical-writer · **Fontes:** `03-mecanicas`, `07-prd-mvp` · Prioridade: **P0** bloqueia o piloto, **P1** entra se couber · Estimativa: P ≤ 3 dias · M 1–2 sem · G 3+ sem

## Épico A · Acesso e entrada

**A1 · Entrar com Google** — P0 · M
Como colaborador, quero entrar com minha conta Google para não criar outra senha.
```gherkin
Dado que sou membro da org "acme"
Quando faço login com Google
Então vejo a tela de porta com "N pessoas no escritório"
E meu microfone está desligado

Dado que meu e-mail não pertence à org nem ao domínio permitido
Quando faço login com Google
Então vejo "Você ainda não foi convidado para este escritório"
```

**A2 · Escolher aparência** — P0 · P
Como novo colaborador, quero escolher meu avatar e nome para ser reconhecido.
```gherkin
Dado que é minha primeira entrada
Quando escolho corpo, cabelo e roupa e confirmo o nome
Então entro no escritório com essa aparência
E o nome tem entre 1 e 40 caracteres
```

**A3 · Spawn seguro** — P0 · P (RN-M1-2)
```gherkin
Dado que minha última posição hoje virou parede após atualização do mapa
Quando entro no escritório
Então apareço no tile livre mais próximo em até 5 tiles
E nunca dentro de colisão
```

**A4 · Duas abas** — P1 · P
```gherkin
Dado que estou no escritório na aba 1
Quando abro o escritório na aba 2
Então a aba 2 controla meu avatar
E a aba 1 mostra "Você abriu o escritório em outra aba" com botão "Usar aqui"
```

## Épico B · Movimento

**B1 · Andar com teclado** — P0 · M
```gherkin
Dado que estou no escritório
Quando seguro a seta para a direita
Então meu avatar anda imediatamente a 4 tiles/s
E meus colegas veem o movimento com atraso p95 < 150 ms
```

**B2 · Clique para andar** — P0 · P
```gherkin
Dado que cliquei num tile livre a até 200 tiles
Quando o caminho existe
Então meu avatar segue o caminho contornando paredes
E qualquer tecla de movimento cancela o caminho
```

**B3 · Correção do servidor** — P0 · M (04 §4)
```gherkin
Dado que tento entrar numa sala cheia
Quando passo pela porta
Então volto suavemente para fora
E vejo "Sala cheia (10/10)"
```

**B4 · Reconexão** — P0 · M (04 §5)
```gherkin
Dado que minha rede caiu por 10 segundos
Quando ela volta
Então continuo no mesmo lugar sem recarregar a página
E colegas me viram semitransparente durante a queda
```

## Épico C · Conversa por proximidade

**C1 · Começar a conversar chegando perto** — P0 · G (RN-M2-1..4)
```gherkin
Dado que Caio está parado na copa
Quando paro a 2 tiles dele por mais de 400 ms
Então ouvimos um ao outro
E um anel une nossos avatares
E nossos nomes aparecem na faixa de conversa no topo da tela

Quando eu me afasto além de 4 tiles
Então paramos de nos ouvir
```

**C2 · Passar sem interromper** — P0 · P
```gherkin
Dado que há uma conversa no corredor
Quando atravesso o grupo sem parar
Então não entro na conversa
```

**C3 · Parede isola** — P0 · P (RN-M2-7)
```gherkin
Dado que Ana está do outro lado de uma parede a 2 tiles
Então não nos ouvimos
```

**C4 · Muita gente** — P1 · P (RN-M2-3)
```gherkin
Dado que há 12 pessoas a até 3 tiles de mim
Então ouço no máximo as 8 mais próximas
E vejo a dica "Muita gente aqui — que tal uma sala?"
```


## Épico D · Salas privadas

**D1 · Reunião isolada** — P0 · G (RN-M3-1..5)
```gherkin
Dado que estou na Sala Jatobá com 4 colegas
Então todos nos ouvimos sem atenuação
E ninguém fora da sala nos ouve
E o chat "Aqui" é o da sala

Quando saio pela porta
Então deixo de ouvir a sala em até 1 s
```

**D2 · Status automático em reunião** — P1 · P (RN-M3-6)

## Épico E · Presença

**E1 · Definir status** — P0 · P (RN-M4-1..3)
```gherkin
Quando escolho "Não perturbe"
Então colegas veem meu status vermelho com ícone em até 3 s
E ninguém forma bolha de áudio comigo
E o botão "Chamar" fica desabilitado para mim
```

**E2 · Ausente automático** — P1 · P (P-09)

## Épico F · Chat

**F1 · Chat aqui e geral** — P0 · M (RN-M5-1..5)
```gherkin
Dado que estou numa bolha na copa
Quando envio uma mensagem em "Aqui"
Então só quem está na bolha recebe
E ela não fica no histórico

Quando envio uma mensagem em "Geral"
Então todos online da org recebem
E ela aparece no histórico conforme a retenção da org
```

**F2 · Sem duplicatas** — P0 · P
```gherkin
Dado que minha mensagem não teve confirmação em 5 s
Quando o cliente reenvia com o mesmo clientMsgId
Então a mensagem aparece uma única vez para todos
```

## Épico G · Encontrar pessoas

**G1 · Ir até** — P0 · P (RN-M6-1..2) · **G2 · Chamar** — P0 · P (RN-M6-3, P-12, P-13)

## Épico H · Mesa e ferramentas

**H1 · Sentar e reivindicar mesa** — P1 · P (M7) · **H2 · Abrir quadro** — P0 · P (M8)

## Épico I · Administração e LGPD

**I1 · Convidar e remover** — P0 · M · **I2 · Retenção de chat** — P0 · P · **I3 · Configurar portais** — P1 · P

**I4 · Exportar e excluir meus dados** — P0 · M (02 §8)
```gherkin
Quando peço a exportação dos meus dados
Então recebo um JSON com perfil, consentimentos e minhas mensagens persistidas

Quando excluo minha conta
Então meu perfil é apagado
E minhas mensagens passam a aparecer como "Usuário removido"
```
