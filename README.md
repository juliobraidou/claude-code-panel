# Claude Code Panel

Extensão de VS Code que adiciona um painel visual ao lado do Claude Code oficial:
mostra o plano (checklist), e uma timeline das ações do agente (leitura, edição,
comandos) com diff por arquivo — no estilo Cursor.

Não substitui a extensão oficial do Claude Code: você continua conversando e
aprovando planos por ela. Este painel só escuta os hooks do Claude Code e
desenha o que está acontecendo.

## Como funciona

1. O Claude Code dispara **hooks** (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`,
   `Stop`, etc.) a cada ação. Configuramos esses hooks para rodar `.claude/panel/hook.js`
   no seu projeto.
2. `hook.js` lê o JSON do evento (stdin) e envia por HTTP para um servidor local
   que esta extensão sobe dentro do VS Code (`127.0.0.1:<porta>`).
3. A extensão mantém o estado (plano + timeline) e manda para o painel React
   via `postMessage`.
4. Clicar numa linha da timeline abre o arquivo correspondente no editor.

## Instalar de vez, para usar em qualquer projeto

O **F5** (abaixo) só abre uma janela de teste temporária, presa a uma pasta.
Para ter o painel disponível em qualquer projeto que você abrir, sem precisar
rodar nada pelo VS Code toda vez, empacote a extensão como `.vsix` e instale
de verdade:

```bash
npm install
npm run package     # gera claude-code-panel-0.1.0.vsix
```

No VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...** → escolha o
arquivo `.vsix` gerado. A partir daí o ícone do Claude Code aparece na barra
de atividades em qualquer janela do VS Code, sempre.

Isso resolve a extensão em si. Falta ligar os **hooks** — é isso que faz o
Claude Code avisar o painel do que está fazendo, e é configurado por projeto
(porque o Claude Code lê `.claude/settings.json` de dentro de cada projeto).
Duas opções, rode uma vez via paleta de comandos:

- **Instalar hooks neste projeto**: grava em `<projeto>/.claude/settings.json`.
  Só vale para esse projeto, mas fica junto do código — bom se você quer
  versionar isso e compartilhar com outras máquinas ou pessoas no mesmo
  projeto.
- **Instalar hooks para todos os projetos**: grava em `~/.claude/settings.json`
  (configuração global do Claude Code). Depois disso, qualquer projeto que
  você abrir já manda eventos para o painel automaticamente, sem repetir o
  passo. É a opção mais prática para uso pessoal.

Se um projeto específico já tem outros hooks configurados, a instalação só
acrescenta os nossos — não apaga o que já existia.

## Rodando em modo de desenvolvimento (para mexer no código da extensão)

```bash
npm install
npm run build      # compila extensão + painel + copia hook.js
```

No VS Code, abra esta pasta e aperte **F5** (`Executar extensão`). Isso abre uma
segunda janela do VS Code com a extensão carregada, só para essa sessão de
teste. Nela:

1. Clique no ícone do Claude Code na barra de atividades (lateral esquerda) para
   abrir o painel "Timeline".
2. Abra a pasta de um projeto seu.
3. Rode o comando **Claude Code Panel: Instalar hooks neste projeto**
   (`Ctrl+Shift+P` / `Cmd+Shift+P`).
4. Abra um terminal integrado e rode `claude` normalmente. As ações vão
   aparecer no painel conforme o agente trabalha.

Durante o desenvolvimento, use `npm run watch` para recompilar automaticamente
(depois é preciso recarregar a janela de teste com `Cmd+R`/`Ctrl+R`).

## Testando só a lógica (sem abrir o VS Code)

```bash
npm run test:server
```

Isso sobe o servidor real e simula uma sequência de eventos de hook (plano,
leitura, edição com diff, comando), validando o estado resultante.

## Detalhes técnicos

- `src/server.ts` / `src/state.ts` / `src/diff.ts`: lógica pura (sem `vscode`),
  fácil de testar isoladamente.
- `src/extension.ts`: ativa a extensão, sobe o servidor, registra o painel e
  os comandos.
- `src/installHooks.ts`: escreve `.claude/panel/hook.js` e mescla
  `.claude/settings.json` do projeto aberto, sem sobrescrever hooks que você
  já tenha.
- `src/panel/`: o painel React (plano, timeline, diffs), estilizado com as
  variáveis de tema do VS Code (funciona em qualquer tema, claro ou escuro).

O arquivo `.vscode/claude-code-panel.port` é criado no seu projeto para o
`hook.js` descobrir em qual porta o servidor está — pode ser adicionado ao
`.gitignore` do seu projeto.

### Segurança do servidor local

O servidor escuta só em `127.0.0.1` e guarda os resumos do Claude, que podem ter
caminhos e trechos de código. Por isso ele não fala com páginas do navegador:

- **Sem CORS:** uma página aberta no navegador não consegue ler `/state`.
- **Só Host local:** pedidos com `Host` diferente de `127.0.0.1` ou `localhost`
  são recusados (proteção contra DNS rebinding).
- **POST só em JSON:** um formulário de navegador não consegue injetar eventos,
  porque o `Content-Type: application/json` exige uma verificação prévia que o
  servidor não autoriza.

A instalação dos hooks também não duplica entradas: reinstalar deixa uma única
cópia do hook do painel por evento, e os hooks de outras ferramentas ficam como
estavam.

## Do modo plan para o auto

Quando o plano é aprovado, o Claude Code chama `ExitPlanMode` com o texto do plano.
O painel:

1. Extrai os passos (lista numerada; senão bullets; senão títulos `##`/`###`) e
   mostra a checklist já na hora em que o plano é proposto.
2. Ao aprovar, o hook pede ao Claude uma lista de tarefas com um item por passo
   (uma frase, uma vez por plano). Quando ela chega (`TaskCreate`/`TaskUpdate`,
   ou `TodoWrite` nas versões antigas), o painel passa a seguir essa lista, que é
   a fonte precisa do progresso.
3. Até essa lista chegar, o painel estima (o título mostra "Plano (estimado)"):
   editar um arquivo citado num passo marca esse passo como em andamento e conclui
   os anteriores, e quando o Claude termina o turno depois de ter executado coisas,
   os passos restantes são concluídos.

Para o hook **não** falar com o Claude (só observar), defina
`CLAUDE_PANEL_NO_NUDGE=1` no ambiente; a checklist vira só estimativa por arquivos.

## Resumo embaixo do plano

Quando o Claude termina um turno em que trabalhou (editou arquivos, rodou comandos)
e há um plano na tela, o card **Resumo** mostra a mensagem final dele:

- No evento `Stop`, o `hook.js` lê o fim do arquivo de histórico da sessão
  (`transcript_path`) e extrai o texto do assistente depois da última ferramenta.
  Não há chamada extra ao modelo, então não gasta tokens. O texto só vai para o
  servidor local da extensão.
- Junto com o pedido da lista de tarefas, o hook pede que essa mensagem final venha
  em três blocos: o que foi feito, o que os testes cobriram e o que falta verificar.
  `CLAUDE_PANEL_NO_NUDGE=1` desliga esse pedido; o resumo continua aparecendo, só
  que no formato que o Claude escolher.
- Uma resposta de conversa (sem ações) não sobrescreve o resumo, e um plano novo
  limpa o anterior.

## Quanto a extensão gasta

`npm run cost` lê os históricos que o Claude Code grava em `~/.claude/projects` (ou
numa pasta passada como argumento: `npm run cost -- <pasta>`) e mostra:

- **Custo da sessão mediana**, a preço de API do Claude Opus 5.5. Serve de régua: o
  pedido da extensão custa perto de US$ 0,005 por plano.
- **Pedidos do hook no contexto**: quantas vezes o pedido pós-plano entrou.
- **Hook com retorno**: duração real do hook quando ele devolve o pedido. O Claude
  Code só grava a duração nesse caso.
- **Chamadas de lista de tarefas**: se o Claude atendeu o pedido da checklist.
- **Resumos e fechamentos**: tokens de saída visíveis (sem o raciocínio) das
  mensagens finais, com e sem o formato de resumo.

Tudo é lido localmente; nada sai da máquina.

## Testes

`npm test` roda o teste do servidor/estado/hook (inclui ler um histórico de sessão
grande), o do renderizador de markdown e o do medidor de custo (`scripts/test-cost.js`).

## Próximos passos possíveis

- Aprovar/rejeitar etapas do plano pelo próprio painel (hooks `PreToolUse`
  suportam bloquear a ação até uma resposta).
- Persistir a timeline entre sessões do VS Code.
- Agrupar ações por sessão/subagente.
