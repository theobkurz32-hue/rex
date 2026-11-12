# Hotel Rex — visita interativa no celular

A experiência é de exploração do hotel. O sistema de combate, as ameaças, as barras de dano e a navegação de inimigos foram retirados. O corpo e a mão em primeira pessoa continuam animados. A arquitetura deriva do IFC original, em metros, com adaptações operacionais explícitas para as interações.

## Entrar e explorar

No celular, a preparação abre um ponto de visita no Tipo 1; toque em **Iniciar visita**. A interface funciona na vertical e na horizontal. O joystick esquerdo move; arraste na área direita para olhar. Use o botão contextual para interagir com o objeto próximo. Agachar, correr, pausar e os controles de voo têm botões de toque. Movimentação, olhar e interação aceitam contatos simultâneos.

**Pavimentos**, **Detalhes** e **Ajustes** abrem painéis com rolagem e botão de fechar. Só um painel fica aberto por vez no celular. Abrir esses painéis pausa a visita; **Retomar visita** volta aos controles. A área 3D considera a altura disponível do Safari e as áreas seguras da tela. Não é necessário girar o aparelho para jogar.

No computador: mouse para olhar após Iniciar visita, WASD para mover, Shift para correr, Ctrl/C para agachar, Espaço para saltar, E/F para interagir, Esc para pausar e R para retornar ao último apoio seguro. Quando a captura do mouse não estiver disponível, use o arraste. Voar usa WASD e Q/E. As ferramentas BIM, filtros, seleção, medições, cortes e leitura de propriedades continuam disponíveis.

## Interações

Portas e janelas mantêm a folha móvel e seu colisor; as ferragens externas ficam no lugar. A interação exige proximidade e caminho livre; a mão alcança o objeto antes de disparar a ação. A cápsula impede que uma folha feche sobre o visitante.

As 32 torneiras e os 41 chuveiros têm ligar/desligar pelo botão contextual. A água é um efeito visual leve, ancorado na bica ou no espalhador, limitado às proximidades do visitante. Não simula água acumulada ou hidráulica. Quando falta um registro explícito no IFC, um controle cromado acessível integra a visualização do chuveiro. O vidro móvel dos 24 boxes abre e fecha, preservando trilhos, painéis fixos e a largura real dos vãos. A cápsula do celular usa raio de 20 cm para circular pelos vãos menores.

As 50 cortinas com geometria (85 painéis de tecido; dois registros IFC não possuem malha) recolhem o próprio tecido para as laterais do trilho; argolas acompanham e trilhos permanecem fixos. Um shader aplica vento suave perto do visitante, mais intenso junto a janelas abertas. O pano é tratado como tecido flexível, sem um colisor rígido bloqueando a passagem; paredes e vidros continuam físicos. Não há atualização dos milhares de vértices do pano pela CPU a cada quadro.

O elevador usa as portas e o poço identificados no IFC, com uma cabine operacional leve. O modelo de origem continha conjuntos de porta/botões sem cabine e lajes cobrindo trechos do poço: a visualização recorta somente o retângulo interno desse vão, preservando as superfícies externas e o arquivo IFC original. O mapeamento dos recortes e paradas fica em `rex.elevator.snapshot.adaptation`. Chame pelo botão contextual, entre, abra o painel e escolha um dos pavimentos atendidos. As portas precisam fechar antes da viagem; o visitante é transportado incrementalmente com a cabine e mantém colisão com a estrutura externa.

## Qualidade e estabilidade no celular

Alta no celular aumenta a nitidez dentro de um limite seguro; não ativa sombras de 2048 px nem carrega novamente as malhas integrais. Todos os perfis do celular mantêm a geometria visual reduzida e as sombras desligadas. A resolução tem orçamento de 700 mil pixels, considerando a orientação. Automático adapta a escala interna à taxa real de quadros. Uma troca de perfil ou orientação redimensiona o framebuffer uma única vez, quando necessário.

Os buffers visuais móveis são dimensionados para as malhas reduzidas desde a preparação, em vez de reservar a geometria completa para depois sobrescrevê-la. Seleção e medição continuam consultando as geometrias de origem. As animações atualizam limites conservadores das partes que se moveram, sem varrer todas as instâncias do prédio a cada quadro. Sem movimento, a vista reduz a frequência de desenho; em outra aba, a visita pausa.

Partes densas de mobiliário usam caixas conservadoras por parte na física móvel, preservando os espaços entre componentes. Paredes, pisos, escadas, rampas, pilares, vigas e folhas móveis mantêm as superfícies originais, salvo a adaptação operacional explícita no vão do elevador. O contato de objetos decorativos curvos é aproximado. Arestas pesadas e wireframe completo ficam no computador; o diagnóstico no celular mostra a cápsula.

O carregamento preparado tem 32 blocos, aproximadamente 35,06 MB compactados, sem abrir o IFC de 220 MB e o parser no navegador. Os 3.916 elementos BIM têm propriedades em grupos sob demanda. A origem, coordenadas, índices e transformações exportados são verificados por hash. As representações geométricas no painel BIM são referências IFC, evitando expandir malhas enormes em JSON. Arquivos escolhidos em Abrir IFC continuam usando o worker.

## Executar e verificar

Requer Node.js 24 e dependências do lockfile:

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run build
pnpm run test:hotel-scene
pnpm run test:mobile-colliders
pnpm run test:quality
pnpm run test:visitor
pnpm run test:water
pnpm run test:curtains
pnpm run test:elevator
pnpm run test:doors
pnpm run test:windows
pnpm run test:appearance
pnpm run test:selection
```

O build prepara a cena estática a partir do IFC, reutiliza arquivos somente quando hashes e versões coincidem e publica todos os recursos relativos ao caminho `/rex/`. O CI executa os testes antes da integração; a publicação usa o workflow manual do Pages.

No WebKit foram verificadas as telas 390×844, 360×640 e 844×390, a rotação com vista pausada, 100 trocas de qualidade, torneira/chuveiro/cortina e chamada/painel/viagem do elevador usando os controles da página, sem erros de página ou console. No Chromium, três contatos reais via protocolo do navegador verificaram movimento, olhar e ação simultâneos na vertical.

Os testes de qualidade usam o hotel real e alternam perfis repetidamente, verificando que o celular não copia/realoque geometrias nem liga sombras. Os testes de visita verificam mão antes da ação, cancelamento por perda de alcance, pernas e ausência de corpos de inimigos. Os módulos de água, cortinas e elevador têm cenários físicos controlados e inspeção do cache real.

As verificações de navegador usam Chromium e WebKit em Linux com renderização por software e emulação de toque. Isso não equivale a medir Safari em iPhone/iPad/Mac físicos. O hotel continua grande; a troca de qualidade foi protegida, mas não é possível garantir ausência de limites de memória ou 30/60 FPS em todo aparelho. Também não foram percorridos manualmente todos os ambientes de todos os registros de pavimento. As interações representam uma adaptação de visita, sem simulação de ferragens, engenharia do elevador, tecido físico ou hidráulica real.

Arquivos principais: `main.ts` integra controles e módulos; `mobile-ui.ts` e `style.css` cuidam dos painéis e da vertical; `quality.ts` e `model.ts` controlam custos; `visitor.ts` e `characters.ts` animam corpo/mão; `water.ts`, `curtains.ts` e `elevator.ts` implementam as interações; `physics.ts` e `doors.ts` mantêm os contatos.
