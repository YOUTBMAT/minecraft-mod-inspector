# 🔍 Minecraft Modpack Inspector

Uma aplicação web de elevado desempenho desenvolvida para analisar *modpacks* de Minecraft, detetar conflitos ou atualizações em cascata nas dependências e diagnosticar registos de erro (*crash logs*) de servidores e clientes.

---

## 🚀 Funcionalidades

- **📥 Ingestão Flexível de Ficheiros:** Suporte *drag-and-drop* para ficheiros de *modpack* (`.zip`, `.mrpack`, `.json`) e registos de erro (`.log`, `.txt`).
- **🧩 Resolução de Dependências em Largura (BFS):** Motor de análise recursiva que identifica dependências em falta, versões incompatíveis e atualizações necessárias via APIs do Modrinth e CurseForge.
- **⚡ Cache em Memória Otimizada:** Redução drástica de chamadas de rede e prevenção de *rate limiting* na API do Modrinth durante a verificação de múltiplos *mods*.
- **🛠️ Diagnóstico Automático de Crash Logs:** Analisador baseado em *Regex* que cobre falhas de *Mixin*, dependências ausentes, IDs de mod duplicados, memória insuficiente (*OutOfMemoryError*), mods incompatíveis entre si e ficheiros `.jar` corrompidos.
- **⚠️ Deteção de Conflitos Conhecidos:** Lista selecionada de combinações de mods conhecidas por causar problemas (ex.: OptiFine + Sodium/Iris, múltiplos visualizadores de receitas), sinalizadas no painel mesmo quando não há atualização envolvida.
- **📊 Painel Interativo (Dashboard):** Visualização clara com *badges* de estado, filtros dinâmicos e rastreamento de dependências.
- **📦 Exportação de Modpacks:** Descarrega um `.mrpack`/`manifest.json` atualizado com URLs de download e hashes reais para os mods do Modrinth.
- **🤖 CLI de Atualização Automática:** Script (`npm run update-mods`) que aponta diretamente para a pasta `mods/` de uma instância real e atualiza os `.jar` identificados no Modrinth, com backup automático dos ficheiros substituídos.
- **🔀 Portagem entre Plataformas:** Converte um pack analisado para o formato da outra plataforma (CurseForge ↔ Modrinth), com uma etapa de revisão obrigatória — ver secção dedicada abaixo.

---

## 🛠️ Tecnologias Utilizadas

| Categoria | Tecnologia |
| :--- | :--- |
| **Framework Frontend** | [Next.js](https://nextjs.org/) (App Router, React 19) |
| **Linguagem** | [TypeScript](https://www.typescriptlang.org/) |
| **Estilização** | [Tailwind CSS v4](https://tailwindcss.com/) |
| **Processamento de Ficheiros** | [JSZip](https://stuk.github.io/jszip/) |
| **Integração de APIs** | [Modrinth API v2](https://docs.modrinth.com/) e [CurseForge API](https://docs.curseforge.com/) |
| **Qualidade de Código** | ESLint & TypeScript `tsc` |

---

## 📋 Pré-requisitos

Esta aplicação requer o **Node.js 20.0.0 ou superior** devido aos vínculos nativos exigidos pelo Tailwind CSS v4 (`@tailwindcss/oxide`).

Se utiliza o **NVM** (*Node Version Manager*), ative a versão correta com:

```bash
nvm install 20
nvm use 20
```

---

## 🔧 Instalação e Execução Local

1. **Clonar o repositório:**
   ```bash
   git clone [https://github.com/YOUTBMAT/minecraft-mod-inspector.git](https://github.com/YOUTBMAT/minecraft-mod-inspector.git)
   cd minecraft-mod-inspector
   ```

2. **Instalar as dependências:**
   ```bash
   npm install
   ```

3. **Configurar a CurseForge (opcional):**
   Defina `CURSEFORGE_API_KEY` no ambiente do servidor para resolver nomes e versões através da API oficial. Sem a chave, a aplicação continua a funcionar com identificadores formatados como fallback.

4. **Iniciar o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```

5. **Aceder no navegador:**
   Abra [http://localhost:3000](http://localhost:3000) para utilizar a aplicação.

---

## 🤖 Atualização Automática via CLI

Para instâncias reais (por exemplo, a pasta `mods/` de um launcher como Prism/MultiMC/CurseForge App), existe um script CLI independente que identifica os mods instalados pelo hash do ficheiro, verifica a versão mais recente compatível no Modrinth e substitui os ficheiros diretamente no disco:

```bash
npm run update-mods -- --dir /caminho/para/a/instancia/mods --game-version 1.20.1 --loader fabric
```

- Use `--dry-run` para ver o que seria alterado sem descarregar ou substituir nada.
- Apenas mods publicados no Modrinth podem ser identificados e atualizados automaticamente; mods exclusivos do CurseForge são listados como "não identificados" para atualização manual.
- Cada ficheiro descarregado é verificado pelo hash SHA-1 antes de substituir o original.
- Os ficheiros substituídos são movidos para `mods/.mod-inspector-backups/<timestamp>/` em vez de apagados, para permitir reverter facilmente.

Este script não depende do Next.js nem requer `npm install` para além do Node 20+ (usa apenas módulos nativos do Node).

---

## 🔀 Portagem entre CurseForge e Modrinth

Depois de analisar um pack, o painel mostra um botão "Portar para CurseForge" ou "Portar para Modrinth" (o oposto do formato carregado). Isto tenta converter o pack para a outra plataforma.

**Limitação importante:** não existe uma API oficial que mapeie o ID de um mod no Modrinth para o seu equivalente no CurseForge (ou vice-versa). A correspondência é feita por pesquisa de nome na plataforma de destino, o que é uma heurística — não uma garantia. Por isso:

- Cada mod mostra a(s) correspondência(s) encontrada(s) com um nível de confiança (alta/média/baixa).
- **Nada é exportado automaticamente.** Tem de rever e confirmar (ou excluir) cada mod antes de gerar o ficheiro final.
- Mods sem correspondência de alta confiança começam por defeito como "Não incluir", para nunca acabar com o mod errado no pack.
- Portar para CurseForge requer `CURSEFORGE_API_KEY` configurada no servidor (ver secção de instalação); sem ela, a opção fica indisponível com um aviso claro.

---

## 📂 Estrutura do Projeto

```text
minecraft-mod-inspector/
├── src/
│   ├── app/                # Rotas do Next.js App Router e API handlers
│   │   ├── api/            # Endpoints (/api/analyze-pack, /api/analyze-log, /api/port-modpack)
│   │   ├── globals.css     # Estilos globais do Tailwind CSS
│   │   └── page.tsx        # Página principal com os componentes
│   ├── components/         # Componentes React da interface
│   │   ├── Dashboard.tsx   # Painel de estatísticas e listagem de mods
│   │   └── FileUploader.tsx# Zona de arrastar e largar ficheiros
│   ├── lib/                # Módulos de lógica de negócio
│   │   ├── crashLogParser.ts  # Parser Regex para logs de erro
│   │   ├── dependencyResolver.ts # Algoritmo BFS para dependências
│   │   ├── modConflicts.ts       # Lista selecionada de conflitos conhecidos entre mods
│   │   ├── portMatcher.ts        # Correspondência heurística CurseForge <-> Modrinth
│   │   ├── modpackExporter.ts    # Gerador do manifesto atualizado
│   │   ├── modpackParser.ts      # Leitor de ficheiros ZIP/MRPACK
│   │   ├── curseforgeService.ts  # Cliente em lote da API CurseForge
│   │   └── modrinthService.ts    # Cliente HTTP com cache da API Modrinth
│   └── types/              # Definições de tipos TypeScript
├── scripts/
│   └── cli/
│       └── mod-updater.mjs # CLI de atualização automática (ver secção acima)
├── package.json
├── next.config.ts
└── tsconfig.json
```

---

## 📜 Licença

Este projeto está sob a licença [MIT](LICENSE).