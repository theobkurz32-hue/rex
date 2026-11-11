# Hotel Rex — sobrevivência FPS

O modo **Jogar** usa o hotel IFC original em metros, Three.js, Rapier e o carregador web-ifc em worker. As ferramentas BIM, seleção, medições, níveis, voo, materiais, iluminação, portas e janelas continuam disponíveis. Não há armas nem inventário.

## Iniciar e controlar

1. Clique em **Jogar**; também é possível deixar o início agendado enquanto o hotel importa. Sem pavimento selecionado, o jogo procura o nível com mais portas de quartos; no Hotel Rex, inicia em Tipo 1.
2. Aguarde **Preparando partida**. O grafo é calculado a partir de superfícies e colisões reais.
3. Clique em **Entrar no jogo** para autorizar a captura do mouse. Depois basta mover o mouse; não é necessário arrastar. **Esc** libera o cursor e pausa toda a simulação. **Retomar partida** captura novamente.

| Computador | Ação |
|---|---|
| Mouse | Olhar, sem deslocamento automático |
| WASD | Mover em relação à câmera; diagonal normalizada |
| Shift | Correr enquanto houver condição física |
| Ctrl ou C | Agachar; solte para tentar levantar com altura livre |
| Espaço | Saltar quando apoiado |
| E | Alcançar e interagir com porta/janela próxima; F permanece como atalho compatível |
| Esc | Pausar e liberar o cursor |
| R | Retornar ao último apoio seguro |

No celular, entre com **Entrar no jogo**, mova pelo joystick esquerdo e arraste na área direita para olhar. Correr e Agachar funcionam enquanto pressionados. O botão contextual executa a interação no início do toque e pode ser usado simultaneamente ao joystick e ao olhar. Há botões de salto e pausa. O layout recomenda paisagem e considera áreas seguras; não depende de Pointer Lock. Em Ajustes, é possível escolher **Automático**, **Teclado e mouse** ou **Toque** em aparelhos híbridos.

Ajustes preserva sensibilidade e FOV e acrescenta inversão vertical, balanço Discreto/Reduzido/Desligado e perfis Baixo/Médio/Alto/Automático. A preferência de movimento reduzido do navegador desliga o balanço inicialmente.

## Corpo, interações e barras

O corpo estilizado é um rig 3D próprio, com roupa texturizada proceduralmente, costuras, bolso, punhos e botas com solas. As pernas usam articulações de quadril/joelho/tornozelo e animam pela distância efetivamente percorrida. A cabeça fica fora da camada da câmera e pode participar da sombra no perfil Alto. O tronco recuado deixa os pés visíveis ao olhar para baixo. Não há imagens de pernas sobrepostas à tela.

Uma mão com dedos e antebraço alcança a folha antes do comando de abrir/fechar. O gesto dura aproximadamente 0,65 s; a ação é disparada após 0,26 s. A interação exige alcance de aproximadamente 1 m, linha de visão e um trajeto livre para a mão. O jogador pode continuar olhando e se movendo. Portas e janelas mantêm sua animação e seus colisores; a folha para também se encontrar um inimigo.

- **Vida (0–100):** ataques diminuem a vida. Em zero, o cursor é liberado, a partida para e aparece Reiniciar.
- **Saúde / condição (0–100):** correr consome 20 pontos/s; caminhar recupera 12/s e repousar recupera 22/s. Ao esgotar, é necessário recuperar pelo menos 15 pontos antes de correr novamente.
- **Adrenalina (0–100):** cresce com ameaças próximas e cai em segurança. Concede até 12% de bônus na corrida.

Os parâmetros centrais ficam em `src/vitals.ts`. As barras exibem nomes e números, sem depender apenas de cores. O feedback de dano é discreto, sem pulsação contínua.

## Navegação e inimigos

`src/navigation.ts` amostra os pisos reais com raios, valida espaço corporal e cria ligações por varredura de cápsulas. Degraus recebem pontos extras das faces horizontais do próprio IFC; vãos de portas recebem pontos alinhados ao centro do batente. Não são adicionados pisos invisíveis. A amostra do hotel completo gerou aproximadamente 3,1 mil nós.

Portas fechadas são arestas com expressID, não paredes removidas. O custo de rota depende do estado da porta. O inimigo se aproxima, gesticula, abre, espera a passagem ficar livre e atravessa com um controlador Rapier próprio. Colisões com paredes, mobiliário, lajes, jogador e outros inimigos continuam ativas. Arestas onde houve bloqueio físico são evitadas temporariamente, permitindo tentar outro caminho. A busca usa A*, não apenas uma direção reta até o jogador.

Os estados são espera, aproximação da porta, abertura, espera por espaço, saída, perseguição, ataque, busca, retorno e reação. Visão usa linha de visão; proximidade e ruído de caminhada/corrida podem alertar um inimigo oculto. Ao perder contato, ele procura a última posição percebida e pode retornar. O ataque tem preparação, alcance, teste de visão e intervalo. Não causa dano através de portas ou pavimentos.

O IFC contém somente três `IfcSpace`, insuficientes para identificar todos os quartos semanticamente. O mapeamento de jogo usa portas semi-ocas, pisos válidos dos dois lados, rotas que cruzam essa porta e pontos ocultos da visão inicial. O resultado explícito porta/nó interno/nó externo é consultável em `rex.survival.snapshot.rooms`. A designação “quarto” é uma aproximação geométrica e pode incluir ambientes de serviço ou banheiros. Nenhum inimigo é colocado em posição visível nem teleportado durante a perseguição.

Há até 3/5/8 inimigos nos perfis Baixo/Médio/Alto. Os rigs, geometrias, tecidos e materiais são compartilhados e reutilizados no reinício. IA distante pensa com menor frequência, e animação distante usa atualização reduzida. Reinício remove corpos/controladores antigos, restaura portas, barras e posições seguras e reutiliza o grafo.

## Otimização e limites

Nos perfis Baixo e Médio, os móveis/equipamentos densos usam uma geometria visual reduzida por agrupamento de vértices, com erro limitado a cerca de 2,6 cm; o Alto restaura a geometria completa. Paredes, pisos, escadas, portas e janelas não entram nessa redução, e toda colisão/medição continua usando o IFC original. O modo de diagnóstico restaura a malha completa. No Hotel Rex, a contagem agregada caiu de 7.971.644 para 6.682.695 triângulos (cerca de 16%).

O principal custo continua sendo o próprio IFC: cerca de oito milhões de triângulos, 44 MB compactados e aproximadamente 220 MB descompactados. Foram preservados o batching de instâncias, os BVHs de consulta, o worker e a escala do modelo. Os personagens são leves, não requerem downloads de GLB/texturas externos e têm orçamento limitado. O perfil Automático ajusta resolução interna entre limites legíveis; sombras do sol só são habilitadas em Alto. As luzes locais continuam limitadas a quatro.

As metas de 60 FPS em computador mediano e 30 FPS em celular intermediário **não foram verificadas em hardware físico**. O ambiente disponível é Linux com Chromium headless/SwiftShader. O cenário pequeno de testes ficou em aproximadamente 55–60 FPS nessa condição; isso não representa o desempenho do hotel completo. Emulação touch não equivale a teste em aparelho real. No hotel completo, uma amostra curta de 12 segundos em Chromium headless/SwiftShader, viewport 640×480, perfil Baixo e escala 0,85 terminou com indicador de aproximadamente **0,68 FPS**, 70 chamadas e 348.814 triângulos na vista. Essa medição inclui aquecimento e não é um teste de computador/celular físico; o ambiente de software não atingiu as metas. O carregamento e a renderização do hotel completo continuam pesados sem GPU.

O grafo pode ter componentes desconectados onde a geometria importada não oferece passagem ou altura livre válida. Os inimigos não atravessam paredes para compensar uma rota ausente. Foi validado um trecho real de escadas entre níveis, mas **não foram percorridos manualmente todos os lances e quartos dos 25 registros de nível**. Certos vãos estreitos e encontros de mobiliário ainda podem provocar espera/replanejamento. A triangulação do IFC já apresentava avisos antes destas alterações. Não há simulação de ferragens nem colisão da folha móvel com todos os objetos estáticos.

## Verificação reproduzível

Requer Node.js 24 e as dependências exatas do lockfile:

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run build
pnpm run test:render-detail
pnpm run test:survival
pnpm run test:survival-hotel
pnpm run test:doors
pnpm run test:windows
pnpm run test:appearance
pnpm run test:selection
```

`test:survival` usa uma cena física controlada para verificar deslocamento em 30/60/120 Hz, consumo das barras, navegação por varredura, spawn oculto, abertura antes da passagem, ataques/morte, mão sincronizada, bloqueio da folha por inimigo, pernas articuladas e reinício sem acumular corpos, porta aberta antes da geração do grafo e cancelamento seguro durante a troca de arquivo.

`test:survival-hotel` usa o IFC completo original, gera o grafo, posiciona inimigos ocultos e verifica abertura/saída. No caso registrado, cinco inimigos foram preparados no Tipo 1 e houve ataques reais até a morte do jogador. Um percurso físico de escadas teve subida de aproximadamente 4,79 m e descida de 4,68 m; a continuação do percurso encontrou um batente de porta, portanto não equivale a certificar todos os corredores.

No navegador foram verificados: Pointer Lock após gesto, olhar sem andar, pernas animadas, mão na interação, E, pausa/retomada, condição física real, morte/reinício e três toques simultâneos para movimento/olhar/interação. Não houve erro crítico de página nesses testes do cenário controlado. Também foi iniciado o jogo no hotel completo no Chromium, com três inimigos ocultos, navegação pronta, estados de abertura e HUD real, sem erro crítico de console. O código usa os caminhos relativos existentes para WASM, worker e IFC em `/rex/`.

Arquivos principais: `src/main.ts` (integração/controles/HUD), `src/survival.ts` (partida e IA), `src/navigation.ts` (grafo/A*), `src/characters.ts` (rigs e mãos), `src/vitals.ts` (barras), `src/quality.ts` (perfis), `src/render-detail.ts` (redução visual reversível), `src/physics.ts` (colisões) e `src/doors.ts` (interações).

O workflow de CI executa os testes de sobrevivência. A publicação continua pelo workflow manual **Publicar no GitHub Pages**, após integrar a alteração em `main`.
