# Claude Code Panel

Um painel no VS Code que mostra, enquanto o Claude Code trabalha, **o plano como checklist**, **o resumo do que foi feito** e **um histórico dos trabalhos anteriores**.

Ele não substitui a extensão oficial do Claude Code: você continua conversando e aprovando planos por ela. O painel só escuta os hooks do Claude Code e desenha o que está acontecendo.

- **Plano:** quando o Claude propõe um plano, os passos viram uma checklist que avança enquanto ele trabalha.
- **Resumo:** ao fim de cada turno em que o Claude editou arquivos ou rodou comandos, a mensagem final dele aparece embaixo do plano.
- **Anteriores:** quando começa um trabalho novo, o anterior (checklist e resumo) vai para uma lista recolhida, com busca. Cada item tem uma lixeira para apagar.
- **Uma conversa por vez:** com dois chats do Claude abertos no mesmo projeto, cada um tem o próprio plano e resumo. O painel segue a conversa em que você escreveu por último, e um seletor permite fixar outra.
- **Salvo por projeto:** plano, resumo e histórico continuam lá depois de fechar e abrir o VS Code.

## O que você precisa

- VS Code 1.85 ou mais novo.
- Claude Code (a extensão oficial ou o `claude` no terminal).
- Node.js 18 ou mais novo no `PATH`. O hook é um script Node que o Claude Code executa a cada evento. Para conferir, rode `node --version` no terminal.

## Instalação

São duas partes: a extensão (o painel) e os hooks (o que faz o Claude Code avisar o painel). Sem os hooks, o painel fica parado em "Ocioso".

### 1. Instale a extensão

Baixe [`release/claude-code-panel-0.1.0.vsix`](release/claude-code-panel-0.1.0.vsix) e, no VS Code:

`Ctrl+Shift+P` → **Extensions: Install from VSIX...** → escolha o arquivo.

O ícone do Claude Code Panel aparece na barra lateral esquerda.

### 2. Instale os hooks

Escolha uma das duas formas. As duas fazem a mesma coisa.

**Pelo VS Code (mais simples):** `Ctrl+Shift+P` → **Claude Code Panel: Instalar hooks para todos os projetos**.

**Pelo arquivo de instalação:** baixe [`release/install-hooks.js`](release/install-hooks.js) e rode no terminal, na pasta onde salvou:

```bash
node install-hooks.js
```

Isso vale para todos os projetos. Outras opções:

| Comando | O que faz |
|---|---|
| `node install-hooks.js` | Instala para todos os projetos, em `~/.claude/settings.json` |
| `node install-hooks.js --project` | Instala só no projeto da pasta atual, em `<projeto>/.claude/settings.json` |
| `node install-hooks.js --project caminho/do/projeto` | Instala só nesse projeto |
| `node install-hooks.js --uninstall` | Remove os hooks do painel (junto com `--project`, remove de um projeto) |
| `node install-hooks.js --help` | Mostra a ajuda |

O instalador:

- **não apaga nada seu:** outras configurações e hooks de outras ferramentas no `settings.json` ficam como estavam;
- **não duplica:** rodar de novo só atualiza o hook;
- **não sobrescreve um arquivo com erro:** se o seu `settings.json` não for um JSON válido, ele para e avisa, sem tocar no arquivo.

### 3. Reinicie o Claude Code

O Claude Code só lê os hooks ao iniciar. Feche e abra a conversa (ou o `claude` no terminal). Depois, mande qualquer mensagem: o status do painel deve mudar de "Ocioso" para "Pensando…".

## Como usar

1. Abra o painel pelo ícone na barra lateral.
2. Trabalhe normalmente no Claude Code. No modo plan, o plano proposto já aparece como checklist.
3. Ao aprovar, a checklist avança sozinha e, no fim, aparece o resumo no formato **Feito / Testes / Falta**.
4. Planos e resumos antigos ficam em **Anteriores**. Clique para abrir, use a busca para achar um trabalho e a lixeira para apagar.

**Sobre o "(estimado)":** o título "Plano (estimado)" aparece quando o progresso é deduzido pelo painel. Ele só marca um passo como feito quando vê uma evidência: um arquivo citado no passo foi editado, ou um comando citado nele foi rodado (por exemplo, `npm test`). Quando o turno termina, os passos sem nenhuma evidência aparecem com **?** e "não confirmado", em vez de serem dados como feitos. Uma evidência num turno seguinte corrige o passo. Quando o Claude cria a própria lista de tarefas (TaskCreate ou TodoWrite), o painel segue essa lista, que é exata.

Para a estimativa acertar mais, cite nos passos do plano os arquivos e comandos envolvidos.

## Quanto isso gasta

A pergunta mais comum antes de instalar é se a extensão aumenta o consumo de tokens. Resposta curta: quase nada, e em alguns casos reduz. Os números abaixo foram medidos em 21 sessões reais de Claude Code (atualizado em 30/09/2026), com o preço de API do Claude Opus 5.5 (US$ 4 por milhão de tokens de entrada, US$ 20 de saída e US$ 0,20 de leitura de cache).

### Onde pode haver custo

| Momento | Custo | Por quê |
|---|---|---|
| Em cada ação do Claude (ler, editar, rodar comando) | **0 tokens** | O hook só observa. Ele não devolve nada ao Claude. |
| Ao aprovar um plano | **~131 tokens**, uma vez | O hook acrescenta um pedido curto: terminar com um resumo Feito/Testes/Falta. Só acontece se o painel estiver aberto nesse projeto. |
| Resumo no fim do plano | **~183 tokens** de saída | Substitui a mensagem final normal, que tem mediana de 584 tokens. |
| Mostrar o resumo no painel | **0 tokens** | O hook lê a mensagem final do histórico que o Claude Code já grava. Não há chamada extra ao modelo. |

### Em dinheiro, por plano aprovado

| | Antes do ajuste | Agora |
|---|---|---|
| Resumo final, com releituras no cache | US$ 0,0220 | US$ 0,0060 |
| Pedido do hook, com releituras no cache | US$ 0,0038 | US$ 0,0027 |
| **Total por plano** | **US$ 0,026** | **US$ 0,009** |
| Parte de uma sessão mediana (US$ 4,28) | 0,6% | **0,20%** |

"Releituras" são as vezes em que esse texto é lido de novo do cache nas chamadas seguintes da conversa (em média, 63,5 chamadas depois do plano). Quanto mais longa a conversa depois do plano, mais releituras.

### Plano de assinatura ou API

- **Pro ou Max:** não há cobrança por token. Os tokens contam para o seu limite de uso, e o impacto é do mesmo tamanho: cerca de 0,2% de uma sessão.
- **API:** a tabela acima é o valor que você pagaria.

### Tempo

O hook roda antes e depois de cada ferramenta, e o Claude Code espera ele terminar. Cada execução leva cerca de 56 ms no teste local, 42 deles só para iniciar o Node. Em uso real, o hook que devolve o pedido mediu 161 ms. Numa sessão mediana isso soma uns 7 segundos, pouco perto do tempo que o próprio modelo leva para responder.

### Desligar o pedido

O pedido só é feito quando o painel está aberto no projeto e recebeu o evento. Em projetos onde você não abre o painel, os hooks só observam e o Claude responde do jeito normal, mesmo com a instalação para todos os projetos.

Para o painel só observar, sem pedir o resumo ao Claude, defina a variável de ambiente `CLAUDE_PANEL_NO_NUDGE=1` antes de abrir o VS Code ou o `claude`:

- **Windows:** Configurações → Sistema → Sobre → Configurações avançadas do sistema → Variáveis de ambiente → Nova, nas variáveis do usuário.
- **macOS e Linux:** `export CLAUDE_PANEL_NO_NUDGE=1` no `~/.zshrc` ou `~/.bashrc`.

A chave `env` do `~/.claude/settings.json` também deve servir, mas ainda não foi testada com este hook. Para conferir, aprove um plano: sem o pedido, o resumo final não vem no formato Feito/Testes/Falta.

O resumo continua aparecendo no painel, no formato que o Claude escolher.

### Medir na sua máquina

O benchmark completo, com gráficos, está em [`docs/benchmark.html`](docs/benchmark.html). Abra no navegador. Para medir com as suas próprias sessões, clone o projeto e rode:

```bash
npm run cost
```

Ele lê os históricos em `~/.claude/projects` e mostra o custo da sua sessão mediana, quantos pedidos do hook entraram, a duração real do hook e o tamanho dos resumos. Tudo é lido na sua máquina e nada é enviado para fora.

## Privacidade e segurança

- **Nada sai da sua máquina.** O hook envia os eventos para um servidor que a extensão abre em `127.0.0.1`. Nenhum dado vai para a internet.
- **O navegador não acessa o painel.** O servidor não aceita páginas web: não tem CORS, recusa `Host` que não seja local (contra DNS rebinding) e só aceita POST em JSON. Um site aberto no navegador não consegue ler seus resumos nem injetar eventos falsos.
- **A extensão cria o arquivo `.vscode/claude-code-panel.port`** em cada projeto aberto, para o hook achar a porta do servidor. Você pode colocá-lo no `.gitignore`.

## Desinstalar

1. Remova os hooks com `node install-hooks.js --uninstall`, ou tire as entradas com `.claude/panel/hook.js` do `settings.json`.
2. Desinstale a extensão pela aba Extensions do VS Code.

## Problemas comuns

- **O painel fica em "Ocioso" enquanto o Claude trabalha.** Os hooks não estão instalados ou o Claude Code não foi reiniciado depois da instalação. Confira se `~/.claude/settings.json` tem `panel/hook.js` e reinicie o Claude Code.
- **Instalei uma versão nova e nada mudou.** Rode **Developer: Reload Window** no VS Code. Instalar o `.vsix` não recarrega a extensão que já está aberta.
- **No terminal, `code --install-extension` instalou no Cursor.** Se o Cursor estiver instalado, o comando `code` pode apontar para ele. Instale pela opção **Install from VSIX...** do VS Code, ou use o executável do VS Code (no Windows, `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd`).
- **"node" não é reconhecido.** Instale o Node.js 18 ou mais novo e reinicie o VS Code, para ele ler o `PATH` atualizado.

---

## Desenvolvimento

```bash
npm install
npm run build     # compila a extensão, o painel e o instalador (release/install-hooks.js)
npm test          # servidor e estado, markdown, medidor de custo e instalador
npm run package   # gera release/claude-code-panel-0.1.0.vsix
```

Para testar mudanças, abra esta pasta no VS Code e aperte **F5**. Isso abre uma janela de teste com a extensão carregada. Com `npm run watch`, o código recompila sozinho e basta recarregar essa janela.

### Como funciona por dentro

1. O Claude Code dispara hooks (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` e outros) a cada evento e roda o `hook.js`.
2. O `hook.js` lê o JSON do evento e envia para o servidor local da extensão. No `Stop`, ele também lê o fim do histórico da sessão para pegar a mensagem final do Claude.
3. A extensão aplica o evento ao estado (plano, resumo, histórico), salva o que precisa persistir e manda para o painel.

| Arquivo | Papel |
|---|---|
| `src/server.ts`, `src/state.ts`, `src/plan.ts`, `src/diff.ts` | Servidor local e lógica do estado, sem depender do `vscode` |
| `src/sessions.ts` | Separa o estado por conversa (`session_id`) e decide qual aparece no painel |
| `src/extension.ts` | Ativa a extensão, sobe o servidor, salva o estado por projeto e registra os comandos |
| `src/installHooks.ts` | Instala e remove os hooks no `settings.json` |
| `src/cli/install-hooks.ts` | O instalador de um arquivo só, com o `hook.js` embutido |
| `src/hook-template/hook.js` | O hook que o Claude Code executa |
| `src/panel/` | O painel em React, com as cores do tema do VS Code |
| `scripts/measure-cost.js` | O medidor de custo (`npm run cost`) |
