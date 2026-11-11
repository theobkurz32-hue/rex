# HOTEL REX — BIM EXPLORER

Aplicação local em TypeScript, Vite, Three.js, web-ifc e Rapier. O modelo inicial é uma cópia integral de **REX_EXE_MODELO_COMPLETO_0203.ifc**, fornecido pelo usuário. O processamento e a consulta das propriedades ocorrem no navegador, sem envio do IFC para serviços externos.

## Abrir agora

No Windows, execute **Iniciar.cmd**. O build já está incluído em `dist/`. O inicializador usa Node.js instalado ou o runtime Node do Codex disponível neste computador. O servidor usa somente módulos nativos do Node e fica em segundo plano.

Endereço: **http://127.0.0.1:4173/**. A primeira importação do arquivo de 220 MB levou aproximadamente 50 segundos no navegador integrado desta sessão. Aguarde as quatro etapas reais. O tempo varia conforme o computador.

Não abra `dist/index.html` diretamente pelo protocolo `file://`: workers e WASM precisam de HTTP. O botão **Abrir IFC** lê outro arquivo local. Para restaurar o modelo inicial, atualize a página ou abra novamente o arquivo do Hotel Rex.

## Instalar, desenvolver e gerar o build

Requisitos para desenvolvimento: Node.js 24 e pnpm 11.25 (ou gerenciador compatível com o lockfile).

```powershell
pnpm install --frozen-lockfile
node scripts/run.mjs dev
```

Desenvolvimento: http://127.0.0.1:5173/.

```powershell
node scripts/run.mjs build
node scripts/serve.mjs --background
```

O comando de build executa TypeScript e Vite. `pnpm run dev`, `pnpm run build` e `pnpm run preview` também estão definidos. O comando `node scripts/run.mjs preview` usa a prévia do Vite em 4173; use apenas um servidor nessa porta. O servidor próprio `scripts/serve.mjs` pode servir o build sem instalar dependências.

O `postinstall` copia `web-ifc.wasm` para `public/wasm`. O WASM do pacote Rapier compat está embutido no bundle local. Vite copia WASM e o IFC para `dist/`. Não há dependência de CDN. Para hospedar, sirva o conteúdo de `dist/` por HTTP(S), incluindo seus subdiretórios.

O modelo inicial agora é distribuído em gzip (44,2 MB) e descompactado no navegador, preservando integralmente o IFC original de 220,3 MB. Isso permite manter o modelo no repositório do GitHub. Consulte **GITHUB.md** para CI, Codespaces e publicação em GitHub Pages.

## Controles

| Modo / ferramenta | Controles |
|---|---|
| Orbitar | Arrastar com botão esquerdo para girar, roda para zoom, botão direito para deslocar. Enquadrar: edifício inteiro. Seleção: enquadrar elemento. Topo, Frente e Lado: vistas com transição. |
| Caminhar | Escolha Caminhar e depois Entrar no modelo. WASD, mouse, Shift para correr, Espaço para saltar com apoio, C para agachar, R para ponto seguro, Esc para pausar. |
| Captura bloqueada | Clique em **Usar arraste para olhar**. WASD continua disponível; arraste a viewport para mudar a direção. Também há link para abrir em aba própria. |
| Portas | Em Caminhar, aproxime-se a aproximadamente 1 m e mire na porta: **E** abre/fecha (F também funciona). No celular, toque no botão contextual. A folha mantém colisão ao abrir; se encontrar o personagem, para e permite tentar novamente. |
| Voar | WASD e Q/E para descer/subir. Atravessa elementos e não usa gravidade. Velocidade em Ajustes. |
| Celular | Controle à esquerda para deslocar, arraste à direita para olhar. Botões de salto/agachamento e subida/descida. Não depende de Pointer Lock. |
| Selecionar | Clique em uma superfície em Orbitar; em primeira pessoa, mire e clique. Busca por nome, tipo, expressID ou GlobalId. |
| Medir | Ative Medir e escolha dois pontos nas superfícies. A distância calculada aparece em metros. |
| Inspeção | Filtros, Ocultar, Isolar, Transparência, Arestas e Corte horizontal. Filtros/ocultação/corte suspendem a caminhada. Voltar a Caminhar restaura o modelo e valida uma entrada. |
| Níveis | Clique no nível, preservado por expressID. Na caminhada, só há teleporte quando apoio e altura livre são válidos. Caso contrário, é usado Voar. |
| Ajustes | FOV, sensibilidade, voo, cápsula, caminhada/corrida, qualidade, FPS, grade, diagnóstico e salvar imagem. Qualidade alta ativa sombras suaves e maior resolução. |

Os parâmetros iniciais são cápsula de 1,75 m, raio 0,25 m, olhos a 1,65 m, caminhada 1,4 m/s, corrida 3 m/s e gravidade 9,81 m/s². O controlador Rapier usa passo fixo de 1/60 s, até cinco subpassos, autodegrau de 26 cm e contato com superfícies reais. Não há pisos invisíveis.

## O arquivo recebido difere da referência do pedido

O arquivo fornecido é IFC2X3, exportado pelo **Revit 2026 em 06/11/2026**, com unidade **METRE**. Possui conteúdo arquitetônico, mobiliário e instalações. Por isso aparecem portas, paredes e janelas: vêm do IFC, não foram inventadas. Não é o arquivo estrutural TQS em centímetros descrito no texto de referência.

Foram encontrados **25 níveis**, **119 IfcSlab**, **17 IfcStairFlight**, **6 IfcStair**, **78 IfcDoor**, **98 IfcWindow**, **402 paredes** (IfcWall + IfcWallStandardCase) e outras categorias. Não há entidades IfcBeam, IfcColumn ou IfcFooting classificadas dessa forma neste arquivo. Elementos em IfcBuildingElementProxy conservam essa classificação.

O web-ifc converte as unidades para metros e produz Y vertical. A aplicação não aplica outra escala nem outra rotação. Um teste independente em centímetros confirma 200 × 100 × 300 cm → 2 × 1 × 3 m, com 3 m na vertical. No modelo real, a porta #2803854 declara 2,10 m de altura e sua malha mede 2,0999999 m.

O deslocamento de recentralização do parser é conservado no diagnóstico. A transformação inversa está implementada em `rex.toSource` para depuração. Renderização, colisores, seleção e medidas usam as mesmas matrizes. Os níveis usam relações IFC e posições hierárquicas; nomes parecidos não são agrupados.

## Validação e limites

Leia **VALIDACAO.md** para as evidências e o que ficou sem validação. Há avisos reais de triangulação; a interface e o diagnóstico deixam explícito que a fidelidade integral das faces não está garantida. O original foi preservado e teve SHA-256 comparado com a cópia.

Testes reproduzíveis:

```powershell
node scripts/test-doors.mjs
node scripts/test-physics.mjs
node scripts/test-selection.mjs
node scripts/audit-ifc.cjs
```

Os testes de física são pesados: usam a geometria real de aproximadamente oito milhões de triângulos. A fixture em `scripts/fixtures/centimetros.ifc` serve apenas ao teste do carregador e das unidades; nunca é usada como modelo inicial.

## Organização

- `src/ifc.worker.ts`: parser, unidades, relações espaciais, geometrias e propriedades.
- `src/model.ts`: lotes visuais, identificação por elemento, seleção, filtros e materiais.
- `src/physics.ts`: malhas estáticas exatas, cápsula, movimento, apoio e entradas.
- `src/main.ts`: aplicação, navegação, ferramentas e interface.
- `src/style.css`: layout desktop e celular.
- `public/`: IFC compactado sem perda, manifesto SHA-256 e WASM local.
- `reference/hotel-rex.ifc`: cópia original local, ignorada pelo Git e restaurável a partir do gzip.
- `dist/`: aplicação compilada pronta para servir.
- `evidence/`: diagnósticos, testes e imagens reais da execução.

APIs consultadas: [web-ifc](https://thatopen.github.io/engine_web-ifc/docs/), [controle de personagem Rapier](https://rapier.rs/docs/user_guides/javascript/character_controller/), [consultas Rapier](https://rapier.rs/javascript3d/classes/World.html), [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html). Versões exatas constam em `package.json` e `pnpm-lock.yaml`.

## Portas interativas

As 78 portas do Hotel Rex são preparadas a partir das peças originais do IFC: 75 portas simples, duas duplas e uma de correr com três painéis. Batentes permanecem fixos; folhas, vidros e maçanetas acompanham o movimento e seus colisores Rapier. A abertura de giro ocorre para o lado oposto ao usuário. O estado de cada porta dura até trocar ou recarregar o modelo.

A classificação combina dimensões, geometrias, OperationType e nome IFC. Modelos externos com outras famílias ou geometria não separável podem exigir adaptação; IDs não reconhecidos aparecem em `audit.doors.unsupported` no diagnóstico. Não se altera o arquivo IFC. A abertura controla a interseção com a cápsula do personagem; não simula fechaduras nem resistência de paredes/móveis no arco da folha.

`npm run test:doors` usa as 78 portas reais e verifica abrir/fechar, batentes fixos, transformações espelhadas, colisão na folha aberta e fechada, passagem no vão, seleção, alcance, oclusão, filtros e bloqueio pelo personagem.

## Acabamentos, luz e janelas

Os acabamentos seguem a classificação e os nomes IFC: laminado em carvalho claro, porcelanato/áreas molhadas em cerâmica neutra, carpete em cinza quente, paredes em gesso marfim e forros claros. As lajes têm a face inferior clara e bordas neutras, mesmo quando a face superior é madeira ou piso cerâmico. A paginação usa coordenadas do mundo em metros, sem alterar as malhas ou baixar texturas. Vidros continuam translúcidos e cortinas mantêm seu material de tecido.

Fitas LED e bulbos existentes ganham emissão quente e halos pequenos com teste de profundidade. Os halos visíveis são limitados aos 24 mais próximos (12 no modo Desempenho). Até quatro luzes locais próximas do personagem ficam ativas, sem sombras adicionais; o modo Desempenho desativa essas luzes locais. Filtros, isolamento e corte também afetam os detalhes luminosos. As luzes locais são decorativas, sem simulação fotométrica nem sombras para cada luminária.

As 98 janelas respondem a **E** (ou F) ou ao botão de toque, no modo Caminhar e a aproximadamente 1 m: 81 têm painéis deslizantes, duas têm quatro lâminas basculantes e 15 vitrines originalmente fixas recebem uma abertura virtual de ventilação do vidro/caixilho interno. Os perfis externos, vedações e venezianas exportadas já abertas permanecem em suas posições originais. A adaptação é somente na visualização interativa; o arquivo IFC não é alterado. Vidros e caixilhos móveis acompanham a colisão, seleção e medição. O sistema não representa ferragens ou folgas de fabricação e não verifica interferências da folha com outros elementos estáticos durante o movimento.

Testes adicionais: `npm run test:windows` valida as 98 janelas reais, abertura/fechamento, caixilhos estáticos, transformações espelhadas, colisão nas folhas móveis e vãos, seleção e transparência. `npm run test:appearance` verifica a paleta semântica, vidro, emissão nos bulbos, orçamento de luzes, oclusão, filtros, modo de desempenho e descarte dos recursos.

## Sobrevivência FPS

Clique em **Jogar**, aguarde a preparação das rotas e use **Entrar no jogo** para capturar o mouse. WASD move, Shift corre, Ctrl/C agacha, E interage, Esc pausa. O celular usa joystick, olhar na área direita e botões simultâneos. Há corpo e mãos 3D animados, zumbis com navegação e abertura de portas, barras reais de vida/condição/adrenalina e reinício. As ferramentas BIM continuam disponíveis.

Consulte [GAMEPLAY.md](GAMEPLAY.md) para controles completos, arquitetura, testes, otimização, condições de medição e limitações reais.
