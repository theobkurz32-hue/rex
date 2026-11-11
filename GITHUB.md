# Executar pelo GitHub

Repositório de destino: **theobkurz32-hue/rex**.

## O que já acompanha o código

- CI em `.github/workflows/ci.yml`: instala as versões do lockfile, verifica TypeScript, gera o build, confere a integridade do modelo e testa a seleção de três categorias.
- Publicação manual em `.github/workflows/pages.yml`: gera o site completo e publica o artifact no GitHub Pages.
- GitHub Codespaces em `.devcontainer/devcontainer.json`: Node 24, pnpm e porta 5173 encaminhada para a aplicação.
- Caminhos relativos de assets, compatíveis com `https://theobkurz32-hue.github.io/rex/`.
- IFC inicial compactado sem perda, WASM local, código e lockfile.

## Como o IFC grande foi resolvido

O original tem **220.289.238 bytes**, acima do limite normal de arquivo do GitHub. O repositório inclui **hotel-rex.ifc.gz**, com **44.155.611 bytes**. O navegador descompacta localmente os mesmos bytes IFC antes de chamar o parser; não há conversão de geometria nem perda de propriedades. O SHA-256 do arquivo restaurado é conferido pelo script de verificação.

O original está preservado localmente em `reference/hotel-rex.ifc`, ignorado pelo Git. Para recuperá-lo após clonar:

```sh
node scripts/restore-model.mjs
```

Para substituir o modelo inicial por outro IFC:

```sh
node scripts/pack-model.mjs caminho/do/arquivo.ifc
node scripts/run.mjs build
node scripts/check-repository.mjs
```

`manifest.json` registra nome, tamanhos e SHA-256. O arquivo compactado atual cabe no limite do GitHub. Se outro IFC compactado passar de 100 MiB, o verificador interrompe a preparação em vez de gerar um push inválido.

## Rodar em Codespaces

No repositório: **Code → Codespaces → Create codespace on main**. A configuração instala dependências e inicia o Vite na porta 5173. Abra a porta encaminhada no navegador. Para iniciar manualmente:

```sh
pnpm exec vite --host 0.0.0.0 --port 5173 --strictPort
```

O processamento do modelo continua local no navegador que abre a aplicação. A sessão de desenvolvimento é executada no Codespace.

## Publicar pelo GitHub Pages

1. No repositório, abra **Settings → Pages** e escolha **GitHub Actions** como fonte.
2. Abra **Actions → Publicar no GitHub Pages → Run workflow**.
3. Aguarde os jobs `build` e `deploy`. O environment `github-pages` informa o endereço final.

O fluxo é manual para manter a decisão de publicar o IFC junto do site explícita. Push e pull request executam a verificação do projeto. A disponibilidade do Pages para repositórios privados depende do plano e das configurações da conta. O código e o modelo devem ser colocados em um repositório com a visibilidade desejada pelo proprietário.

## Primeiro envio pelo Git

Depois que o repositório for criado na sua conta:

```sh
git remote add origin https://github.com/theobkurz32-hue/rex.git
git push -u origin main
```

Use a autenticação normal do GitHub/Git Credential Manager. Não coloque tokens no código ou no endereço do remote.

Fontes consultadas: [limites de arquivos GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [limites GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [deploy-pages](https://github.com/actions/deploy-pages), [upload-pages-artifact](https://github.com/actions/upload-pages-artifact) e [imagem oficial de Codespaces](https://github.com/devcontainers/images/tree/main/src/javascript-node).
