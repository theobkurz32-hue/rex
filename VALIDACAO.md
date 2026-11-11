# Verificação realizada em 11/11/2026

O fluxo verificado foi: arquivo IFC local → leitura no worker web-ifc/WASM → superfícies Three.js → colisores Rapier → navegação e consulta BIM. A aplicação foi executada no navegador integrado do Codex, incluindo o build estático de produção em http://127.0.0.1:4173/.

## Evidências principais

| Verificação | Resultado e evidência |
|---|---|
| Origem da geometria | IFC fornecido de 220.289.238 bytes. Cópia original e modelo inicial com SHA-256 idêntico: `evidence/original-preservado.json`. Imagens `evidence/modelo-real.png` e `evidence/primeira-pessoa.png`. |
| Modelo recebido | IFC2X3, Revit 2026, exportação em 06/11/2026, unidade METRE. Diverge da referência TQS em centímetros descrita no pedido. |
| Escala real | Porta #2803854: altura declarada 2,10 m; altura calculada 2,0999999046 m. `evidence/physics-tests.json`. |
| Centímetros sem conversão duplicada | Fixture independente de 200 × 100 × 300 cm resultou em dimensões de mundo 2 × 3 × 1 m, com Y vertical. Teste do parser em `evidence/selection-tests.json` e teste do carregador completo em `evidence/troca-de-modelo.json`. |
| Orientação e níveis | 25 registros de níveis distintos, com acentos decodificados, elevações IFC preservadas e associação por relações espaciais. Extensão vertical da geometria: 25,18 m. |
| Renderização | 3.382 elementos com malha; 31.081 partes não vazias; 7.971.644 triângulos na versão estável final; 139 lotes visuais. Instâncias conservam expressID e GlobalId. |
| Física alinhada | 3.382 colisores estáticos contendo os mesmos 7.971.644 triângulos transformados usados pela geometria visual na versão final. Não foram usados blocos envolventes do edifício. |
| Entrada e mudança de nível | A amostragem encontrou entrada com apoio e cápsula livre em 15 dos 25 níveis. Os outros dez não são declarados inacessíveis: a busca conservadora não encontrou entrada. A interface usa Voar nesses casos. O fallback foi acionado no navegador para Calçada #25. |
| Apoio, salto e agachamento | Testes da classe de física real: apoio por 180 passos, salto com subida de aproximadamente 0,434 m e retorno ao piso, agachar e levantar com teste volumétrico. |
| Bloqueio lateral | A cápsula foi bloqueada pela porta IFC #2218369 no Térreo. Não há IfcColumn/IfcBeam/IfcFooting classificados dessa forma no arquivo recebido; colisão com pilar identificado como IfcColumn não pôde ser testada. |
| Queda real | A trajetória testada no nível #52 perdeu apoio em uma borda/vão e caiu. Há também teste de queda fora dos limites e retorno ao ponto seguro sem interpenetração. |
| Alternância dos modos | Orbitar, Caminhar e Voar foram acionados na interface. O modo Caminhar usa a câmera na posição corrigida pela cápsula. Esc pausou a navegação. |
| Captura do mouse | O navegador integrado bloqueou Pointer Lock. O fallback com arraste e WASD foi testado: posição mudou de X 8,53 / Z 3,78 para X 8,41 / Z 3,65, com apoio. Há botão explícito para entrar sem captura e link para outra aba. Pointer Lock em Chrome/Edge fora do ambiente integrado não foi validado. |
| Seleção e identificação | Raycast sobre a superfície real após agrupamento visual recuperou expressID e GlobalId corretos em IfcDoor #9809, IfcSlab #801445 e IfcStairFlight #2818762. Foram recuperados, respectivamente, 2, 3 e 2 conjuntos de propriedades. `evidence/selection-tests.json`. |
| Filtros e corte | No navegador, filtrar IfcSlab ativou inspeção sem física. Voltar a Caminhar limpou o filtro. Ativar corte suspendeu a caminhada; retornar desativou o corte, confirmado pelo estado da caixa de seleção. |
| Troca de IFC no build | Hotel Rex → fixture local em centímetros: 1 elemento / 1 colisor. Fixture → IFC real: 3.382 elementos / 3.382 colisores novamente. O modelo anterior não permaneceu na cena nem no mundo físico. `evidence/troca-de-modelo.json` e `evidence/browser-audit-final.json`. |
| Celular emulado | Layout 390 × 844, joystick e botões visíveis. Pressão no joystick moveu a cápsula de X 8,53 / Z 3,78 para X 9,24 / Z 3,11, mantendo apoio. Testado com eventos de ponteiro no navegador desktop; não houve teste em aparelho físico. |
| Build | TypeScript sem erros e Vite 8.3.7 concluído, com CI bem-sucedido no GitHub Actions. Há aviso de tamanho dos bundles, sobretudo por WASM e parser locais. Não houve erro fatal da aplicação na execução final carregada. Durante uma atualização de build com uma página antiga aberta, houve falha ao buscar um worker de versão anterior; recarregar a página resolveu. |
| Desempenho | Uma importação completa levou aproximadamente 50 s; a última troca de arquivo registrada levou 80,8 s. Na vista externa a 1440 × 900, qualidade equilibrada, foi observada amostra de cerca de 16 FPS com 139 chamadas e 7,97 milhões de triângulos após otimização de transparência. Não é um benchmark controlado. A meta de 60 FPS não foi atingida nesse ambiente. |

## Limitações da importação

O web-ifc 0.0.78 registrou **8.880 ocorrências de triangulação** (`No basis found for brep`). São ocorrências do parser, não uma contagem validada de elementos inteiramente ausentes. Algumas faces não foram trianguladas; a fidelidade integral das faces não está garantida. Foram preservadas amostras dos IDs no diagnóstico. Três faces foram inspecionadas pelo parser em `evidence/face-diagnostics.json`; não se atribui uma causa única a todos os casos sem investigação adicional.

A versão final fixa web-ifc 0.0.78 e Vite 8.3.7, publicados antes da janela de segurança de 24 horas do instalador. Os diagnósticos iniciais de navegador usavam web-ifc 0.0.79 e registravam sete triângulos a menos, com os mesmos limites e elementos. Os 12 testes de física e os testes de seleção/unidades foram executados novamente com 0.0.78; todos passaram. O WASM é servido em um caminho específico para a versão instalada.

Há **534 entidades sem malha própria** na saída: 244 IfcDistributionPort, 236 IfcOpeningElement, 25 IfcBuildingStorey, 16 IfcElementAssembly, 6 IfcStair, 3 IfcSpace, 2 IfcCurtainWall, 1 IfcBuilding e 1 IfcSite. Parte dessas entidades é espacial, representa vazios ou agrega componentes que possuem geometria própria. Os lances de escada IfcStairFlight foram renderizados. Essa lista não significa 534 objetos físicos perdidos.

O conteúdo arquitetônico e de mobiliário foi mantido porque existe no arquivo fornecido. Nenhuma arquitetura foi criada para completar o projeto. Não foi substituído por uma cena genérica. Os registros `500-Tipo 3-001` e `500-Tipo 3-002` citados no texto não aparecem como tais neste IFC; os níveis existentes conservam seus IDs individuais.

## Interações sem validação completa

- Subida completa de uma escada real: a busca automática não encontrou um percurso ascendente validado com a cápsula e o espaço livre. Autodegrau e controle de inclinações estão implementados; não se declara que todos os lances são percorríveis.
- Contato específico com teto baixo e bloqueio de levantar agachado: implementados com consulta volumétrica; não houve um ensaio independente completo dessas situações no arquivo real.
- Celular físico, Safari e diferentes GPUs/navegadores externos ao integrado.
- Arestas do modelo inteiro e sombras de alta qualidade não foram submetidas a teste de desempenho prolongado.
- Falha deliberada de WASM e arquivos corrompidos não foram ensaiados sistematicamente. Há mensagens de erro e possibilidade de carregar outro arquivo.

Os 12 testes automatizados da física passaram. Os testes de seleção em três categorias e o teste independente de centímetros passaram. A execução e os JSONs de evidência permitem distinguir teste automatizado, interação no navegador, implementação sem ensaio completo e limitações do próprio parsing.
