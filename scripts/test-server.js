// Teste manual do servidor: sobe o servidor real (dist/extension.js exporta só a API do vscode,
// então testamos direto os módulos compilados de server/state, que não dependem do vscode).
const path = require('path');
const http = require('http');

const { startServer } = require(path.join(__dirname, '..', 'dist-test', 'server.js'));

function post(port, url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(port, url) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: url }, (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
      })
      .on('error', reject);
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FALHOU:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

async function main() {
  const srv = await startServer({ preferredPort: 47999 });
  const port = srv.port;
  console.log('Servidor de teste na porta', port);

  // UserPromptSubmit -> running = true
  await post(port, '/hook', { hook_event_name: 'UserPromptSubmit' });

  // TodoWrite via PreToolUse define o plano
  await post(port, '/hook', {
    hook_event_name: 'PreToolUse',
    tool_name: 'TodoWrite',
    tool_input: {
      todos: [
        { content: 'Criar componente Header', status: 'completed' },
        { content: 'Ajustar estilos', status: 'in_progress' },
        { content: 'Rodar testes', status: 'pending' },
      ],
    },
  });

  // Leitura de arquivo
  await post(port, '/hook', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/projeto/app/layout.tsx' },
  });
  await post(port, '/hook', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/projeto/app/layout.tsx' },
    tool_response: {},
  });

  // Edição de arquivo com diff
  await post(port, '/hook', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/projeto/components/Header.tsx',
      old_string: 'export function Header() {\n  return <nav className="menu">Menu</nav>;\n}',
      new_string: 'export function Header() {\n  return <nav className="flex gap-4">Menu</nav>;\n}',
    },
  });
  await post(port, '/hook', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/projeto/components/Header.tsx',
      old_string: 'export function Header() {\n  return <nav className="menu">Menu</nav>;\n}',
      new_string: 'export function Header() {\n  return <nav className="flex gap-4">Menu</nav>;\n}',
    },
    tool_response: {},
  });

  // Comando de terminal
  await post(port, '/hook', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });

  const midState = (await get(port, '/state')).body;
  assert(midState.running === true, 'estado fica "running" após UserPromptSubmit');
  assert(midState.planItems.length === 3, 'plano tem 3 itens');
  assert(midState.planItems[0].status === 'completed', 'primeiro item do plano concluído');
  assert(midState.actions.some((a) => a.status === 'running' && a.toolName === 'Bash'), 'Bash aparece como em execução');

  const editAction = midState.actions.find((a) => a.toolName === 'Edit');
  assert(!!editAction, 'ação de Edit foi registrada');
  assert(editAction.status === 'done', 'ação de Edit foi concluída');
  assert(Array.isArray(editAction.diff) && editAction.diff.some((l) => l.kind === 'add'), 'diff da edição tem linha adicionada');
  assert(editAction.addedLines >= 1, 'contagem de linhas adicionadas > 0');

  // Finaliza o comando e a sessão
  await post(port, '/hook', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    tool_response: { is_error: false },
  });
  await post(port, '/hook', { hook_event_name: 'Stop' });

  const finalState = (await get(port, '/state')).body;
  assert(finalState.running === false, 'estado fica "ocioso" após Stop');
  assert(finalState.actions.find((a) => a.toolName === 'Bash').status === 'done', 'Bash concluído após PostToolUse');

  // /clear reseta tudo
  await post(port, '/clear', {});
  const clearedState = (await get(port, '/state')).body;
  assert(clearedState.actions.length === 0, '/clear zera as ações');
  assert(clearedState.planItems.length === 0, '/clear zera o plano');

  // --- Plano vindo do ExitPlanMode (modo plan -> auto) ---
  const plan = [
    '## Contexto',
    'Adicionar página Sobre.',
    '',
    '## Passos',
    '1. Criar o componente **Header.tsx** com a navegação',
    '   - detalhe que não deve virar item',
    '2. Adicionar a rota em `app/sobre/page.tsx`',
    '3. Rodar os testes e revisar',
  ].join('\n');

  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan } });
  let s = (await get(port, '/state')).body;
  assert(s.planItems.length === 3, 'ExitPlanMode gera 3 itens (sub-bullets ignorados)');
  assert(s.planSource === 'plan', 'origem do plano é "plan"');
  assert(s.planItems[0].text === 'Criar o componente Header.tsx com a navegação', 'markdown do item é limpo');
  assert(s.planItems.every((i) => i.status === 'pending'), 'plano proposto começa todo pendente');

  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan }, tool_response: {} });
  s = (await get(port, '/state')).body;
  assert(s.planItems[0].status === 'in_progress', 'aprovado: primeiro passo entra em andamento');

  // Fallback: editar arquivo citado no passo 2 conclui o 1 e inicia o 2
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\app\\sobre\\page.tsx', content: 'x' } });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\app\\sobre\\page.tsx', content: 'x' }, tool_response: {} });
  s = (await get(port, '/state')).body;
  assert(s.planItems[0].status === 'completed', 'editar arquivo do passo 2 conclui o passo 1');
  assert(s.planItems[1].status === 'in_progress', 'passo 2 fica em andamento (caminho Windows funciona)');
  assert(s.planItems[2].status === 'pending', 'passo 3 segue pendente');

  // TodoWrite assume o controle
  const todos = [
    { content: 'Criar Header', status: 'completed' },
    { content: 'Criar rota Sobre', status: 'completed' },
    { content: 'Rodar testes', status: 'in_progress' },
  ];
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos } });
  s = (await get(port, '/state')).body;
  assert(s.planSource === 'todo', 'TodoWrite assume como fonte do plano');
  assert(s.planItems[2].status === 'in_progress' && s.planItems[0].status === 'completed', 'estado segue o TodoWrite');

  // Depois do TodoWrite, editar arquivo NÃO mexe mais no plano
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/Header.tsx', old_string: 'a', new_string: 'b' }, tool_response: {} });
  s = (await get(port, '/state')).body;
  assert(s.planItems[2].status === 'in_progress', 'heurística de arquivos desliga depois do TodoWrite');

  // TodoWrite vazio não apaga o plano da tela
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos: [] } });
  s = (await get(port, '/state')).body;
  assert(s.planItems.length === 3, 'TodoWrite vazio não apaga o plano');

  // --- Cenário real do print: plano sem nomes de arquivo, sem TodoWrite, Claude termina ---
  await post(port, '/clear', {});
  const plan2 = ['## Passos', '1. `npm install` e `npm start` -> log', '2. POST /users com dados válidos', '3. POST /users/login correto', '4. Colar o token no jwt.io'].join('\n');
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 } });
  await post(port, '/hook', { hook_event_name: 'Notification', message: 'Claude needs your permission to use ExitPlanMode' });
  s = (await get(port, '/state')).body;
  assert(s.notification && /permission/.test(s.notification), 'aviso de permissão aparece enquanto espera');
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 }, tool_response: {} });
  s = (await get(port, '/state')).body;
  assert(!s.notification, 'aviso some quando o plano é aprovado');
  await post(port, '/hook', { hook_event_name: 'Stop' });
  s = (await get(port, '/state')).body;
  assert(s.planItems.some((i) => i.status !== 'completed'), 'Stop sem ter executado nada não conclui o plano');
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/p/src/server.js', content: 'x' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm start' }, tool_response: {} });
  s = (await get(port, '/state')).body;
  assert(s.planItems.some((i) => i.status !== 'completed'), 'ainda não terminou: passos seguem abertos');
  await post(port, '/hook', { hook_event_name: 'Stop' });
  s = (await get(port, '/state')).body;
  assert(s.planItems.length === 4 && s.planItems.every((i) => i.status === 'completed'), 'Stop depois de executar conclui os 4 passos');

  // --- TaskCreate / TaskUpdate (ferramentas de tarefa do Claude Code atual) ---
  await post(port, '/clear', {});
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 } });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 }, tool_response: {} });
  const created = ['Instalar e subir', 'Testar cadastro', 'Testar login'];
  for (let i = 0; i < created.length; i++) {
    await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'TaskCreate', tool_input: { subject: created[i], description: 'd' } });
    await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: created[i], description: 'd' }, tool_response: `Task #${i + 1} created successfully: ${created[i]}` });
  }
  s = (await get(port, '/state')).body;
  assert(s.planSource === 'todo' && s.planItems.length === 3, 'TaskCreate substitui o plano semeado pela lista real');
  assert(s.planItems[0].text === 'Instalar e subir', 'texto do TaskCreate vira item');
  assert(!s.actions.some((a) => a.toolName.startsWith('Task')), 'ferramentas de tarefa não viram linha de ação');

  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'in_progress' }, tool_response: 'Updated task #1 status' });
  s = (await get(port, '/state')).body;
  assert(s.planItems[0].status === 'in_progress', 'TaskUpdate marca em andamento');
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: 'Updated task #1 status' });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: 2, status: 'completed' }, tool_response: '' });
  s = (await get(port, '/state')).body;
  assert(s.planItems[0].status === 'completed' && s.planItems[1].status === 'completed' && s.planItems[2].status === 'pending', 'TaskUpdate conclui (id como string ou número)');

  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '3', status: 'deleted' }, tool_response: '' });
  s = (await get(port, '/state')).body;
  assert(s.planItems.length === 2, 'status deleted remove o item');

  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/x.js', old_string: 'a', new_string: 'b' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'Stop' });
  s = (await get(port, '/state')).body;
  assert(s.planItems.length === 2 && s.planItems.every((i) => i.status === 'completed'), 'com lista real, Stop não inventa nada');

  // Lista antiga toda concluída + TaskCreate novo = lista nova
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'Outra coisa' }, tool_response: 'Task #1 created successfully: Outra coisa' });
  s = (await get(port, '/state')).body;
  assert(s.planItems.length === 1 && s.planItems[0].text === 'Outra coisa' && s.planItems[0].status === 'pending', 'lista concluída é substituída por trabalho novo');

  // Sem id na resposta: usa contagem sequencial
  await post(port, '/clear', {});
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'A' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'B' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'completed' }, tool_response: {} });
  s = (await get(port, '/state')).body;
  assert(s.planItems.length === 2 && s.planItems[1].status === 'completed' && s.planItems[0].status === 'pending', 'sem id na resposta, ids sequenciais funcionam');

  // --- Resumo: mensagem final do Claude embaixo do plano ---
  await post(port, '/clear', {});
  const finalText = '**O que foi feito**\n- API criada com `/users`\n\n**Falta verificar**\n- deploy';
  await post(port, '/hook', { hook_event_name: 'UserPromptSubmit' });
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 } });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'Stop', last_message: 'texto sem trabalho nenhum ainda' });
  s = (await get(port, '/state')).body;
  assert(!s.summary, 'Stop sem nenhuma ação no turno não vira resumo');

  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/p/a.js', content: 'x' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'Stop', last_message: finalText });
  s = (await get(port, '/state')).body;
  assert(s.summary && s.summary.text === finalText, 'Stop depois de trabalhar com plano vira o resumo');

  await post(port, '/hook', { hook_event_name: 'UserPromptSubmit' });
  await post(port, '/hook', { hook_event_name: 'Stop', last_message: 'Claro, explico: é assim que funciona.' });
  s = (await get(port, '/state')).body;
  assert(s.summary && s.summary.text === finalText, 'resposta de conversa (sem ações) não sobrescreve o resumo');

  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 } });
  s = (await get(port, '/state')).body;
  assert(!s.summary, 'plano novo limpa o resumo antigo');

  await post(port, '/clear', {});
  await post(port, '/hook', { hook_event_name: 'UserPromptSubmit' });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'Stop', last_message: 'algo' });
  s = (await get(port, '/state')).body;
  assert(!s.summary, 'sem plano na tela não há resumo');

  // --- hook.js lendo o histórico da sessão (transcript) de verdade ---
  const fs = require('fs');
  const os = require('os');
  const { spawn } = require('child_process');
  const hookFile = path.join(__dirname, '..', 'src', 'hook-template', 'hook.js');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-'));
  fs.mkdirSync(path.join(tmp, '.vscode'));
  fs.writeFileSync(path.join(tmp, '.vscode', 'claude-code-panel.port'), String(port));

  const hookFinal = '**O que foi feito**\n- API criada com `/users`\n\n**Testes**\n- 12 casos\n\n**Falta verificar**\n- deploy';
  const transcript = [
    ...Array.from({ length: 4000 }, (_, i) => ({ type: 'user', message: { role: 'user', content: 'preenchimento '.repeat(20) + i } })),
    { type: 'user', message: { role: 'user', content: 'Crie uma API' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Vou criar os arquivos.' }, { type: 'tool_use', id: 't1', name: 'Write', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: hookFinal }] } },
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'SUBAGENTE NAO ENTRA' }] } },
  ];
  const transcriptPath = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert(fs.statSync(transcriptPath).size > 512 * 1024, 'histórico de teste é maior que a janela lida (testa a leitura do fim)');

  await post(port, '/clear', {});
  await post(port, '/hook', { hook_event_name: 'UserPromptSubmit' });
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 } });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/p/a.js', content: 'x' }, tool_response: {} });

  const stopResult = await new Promise((resolve) => {
    const child = spawn('node', [hookFile], { env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ status: code, stdout: out }));
    child.stdin.write(JSON.stringify({ hook_event_name: 'Stop', transcript_path: transcriptPath }));
    child.stdin.end();
  });
  assert(stopResult.status === 0 && stopResult.stdout === '', 'hook.js no Stop sai com 0 e não fala com o Claude');
  s = (await get(port, '/state')).body;
  assert(s.summary && s.summary.text === hookFinal, 'hook.js extrai só a mensagem final (sem texto do meio nem subagente)');
  fs.rmSync(tmp, { recursive: true, force: true });

  await srv.close();

  // --- hook.js: só o ExitPlanMode aprovado devolve contexto para o Claude ---
  const { spawnSync } = require('child_process');
  const hookPath = path.join(__dirname, '..', 'src', 'hook-template', 'hook.js');
  const runHook = (payload, env = {}) =>
    spawnSync('node', [hookPath], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: '/tmp/sem-projeto-aqui', ...env },
      encoding: 'utf8',
    });

  const nudged = runHook({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode' });
  assert(nudged.status === 0, 'hook.js sai com código 0 mesmo sem servidor');
  assert(/TodoWrite/.test(nudged.stdout) && JSON.parse(nudged.stdout).hookSpecificOutput.hookEventName === 'PostToolUse', 'ExitPlanMode aprovado devolve additionalContext válido');

  const silent = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Edit' });
  assert(silent.status === 0 && silent.stdout === '', 'outros eventos não devolvem nada ao Claude');

  const optOut = runHook({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode' }, { CLAUDE_PANEL_NO_NUDGE: '1' });
  assert(optOut.status === 0 && optOut.stdout === '', 'CLAUDE_PANEL_NO_NUDGE=1 desliga o pedido');

  console.log('\nTeste concluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
