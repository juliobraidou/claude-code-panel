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
  assert(s.planItems.length === 4 && s.planItems[0].status === 'completed', 'Stop conclui o passo com evidência (comando "npm start" citado nele)');
  assert(s.planItems.slice(1).every((i) => i.status === 'unconfirmed'), 'passos sem evidência ficam "não confirmados", não concluídos');


  // Evidência por comando e correção num turno seguinte.
  {
    const sv = await startServer({ preferredPort: 48230 });
    const P = sv.port;
    const pl = ['1. Editar `src/a.js`', '2. Rodar `npm test` e conferir', '3. Revisar com calma'].join('\n');
    await post(P, '/hook', { hook_event_name: 'UserPromptSubmit' });
    await post(P, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: pl } });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: pl }, tool_response: {} });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:\\p\\src\\a.js', content: 'x' }, tool_response: {} });
    await post(P, '/hook', { hook_event_name: 'Stop' });
    let st = (await get(P, '/state')).body;
    assert(st.planItems.map((i) => i.status).join() === 'completed,unconfirmed,unconfirmed', 'só o passo com arquivo editado fica concluído');
    await post(P, '/hook', { hook_event_name: 'UserPromptSubmit' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'cd proj && npm test 2>&1 | grep ok' }, tool_response: {} });
    st = (await get(P, '/state')).body;
    assert(st.planItems[1].status === 'in_progress', 'comando citado no passo ("npm test", com cd, pipe e 2>&1) conta como evidência');
    await post(P, '/hook', { hook_event_name: 'Stop' });
    st = (await get(P, '/state')).body;
    assert(st.planItems.map((i) => i.status).join() === 'completed,completed,unconfirmed', 'evidência num turno seguinte corrige o passo; o sem evidência segue não confirmado');
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} });
    st = (await get(P, '/state')).body;
    assert(st.planItems[2].status === 'unconfirmed', 'comando curto ou não citado não vira evidência');
    await sv.close();
  }

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
  assert(s.summary && s.summary.text === 'algo', 'sem plano na tela o trabalho também vira resumo');

  await post(port, '/hook', { hook_event_name: 'UserPromptSubmit' });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/x.js', old_string: 'a', new_string: 'b' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'Stop', last_message: '## Corrigi o **bug** do login\n- detalhe' });
  s = (await get(port, '/state')).body;
  assert(s.summary.text.startsWith('## Corrigi'), 'novo trabalho troca o resumo');
  assert(s.history[0].summary.text === 'algo' && s.history[0].items.length === 0, 'resumo anterior vai para o histórico');
  await post(port, '/hook', { hook_event_name: 'Stop', last_message: 'outro stop no mesmo turno' });
  s = (await get(port, '/state')).body;
  assert(s.summary.text.startsWith('## Corrigi'), 'segundo Stop no mesmo turno não repete o resumo');
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan } });
  s = (await get(port, '/state')).body;
  assert(s.history[0].title === 'Corrigi o bug do login', 'sem plano, o título vem do resumo sem markdown');

  // --- Histórico: o trabalho anterior vira um item guardado quando começa um novo ---
  await post(port, '/clear', {});
  const base = (await get(port, '/state')).body.history.length;
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan } });
  s = (await get(port, '/state')).body;
  assert(s.history.length === base, 'primeiro plano não gera histórico');
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 } });
  s = (await get(port, '/state')).body;
  assert(s.history.length === base, 'plano proposto e nunca iniciado não vai para o histórico');

  await post(port, '/hook', { hook_event_name: 'UserPromptSubmit' });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/p/a.js', content: 'x' }, tool_response: {} });
  await post(port, '/hook', { hook_event_name: 'Stop', last_message: finalText });
  await post(port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan } });
  s = (await get(port, '/state')).body;
  assert(s.history.length === base + 1, 'plano novo arquiva o anterior');
  assert(s.history[0].summary && s.history[0].summary.text === finalText, 'histórico guarda o resumo');
  assert(s.history[0].items.length === 4 && s.history[0].items.every((i) => i.status === 'unconfirmed'), 'histórico guarda a checklist final (sem evidência, nada marcado como feito)');
  assert(!s.summary && s.planItems.length === 3, 'plano atual começa limpo, sem o resumo antigo');

  await post(port, '/clear', {});
  s = (await get(port, '/state')).body;
  assert(s.history.length === base + 1 && s.planItems.length === 0, '/clear limpa a tela mas mantém o histórico');

  // TaskCreate depois de uma lista toda concluída também arquiva
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'A' }, tool_response: 'Task #1 created successfully: A' });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: '' });
  await post(port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'B' }, tool_response: 'Task #1 created successfully: B' });
  s = (await get(port, '/state')).body;
  assert(s.history.length === base + 2 && s.history[0].title === 'A', 'lista de tarefas concluída é arquivada ao começar outra');

  const removed = s.history[1].id;
  await new Promise((r) => { srv.deleteHistory(removed); r(); });
  s = (await get(port, '/state')).body;
  assert(s.history.length === base + 1 && !s.history.some((h) => h.id === removed), 'excluir remove só o item escolhido');

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

  // --- Reabrir o VS Code: o estado salvo volta (plano, resumo e histórico) ---
  {
    const a = await startServer({ preferredPort: 48050 });
    await post(a.port, '/hook', { hook_event_name: 'UserPromptSubmit' });
    await post(a.port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 } });
    await post(a.port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: plan2 }, tool_response: {} });
    await post(a.port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/p/a.js', content: 'x' }, tool_response: {} });
    await post(a.port, '/hook', { hook_event_name: 'Stop', last_message: finalText });
    await post(a.port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan } });
    await post(a.port, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan }, tool_response: {} });
    await post(a.port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const before = (await get(a.port, '/state')).body;
    // Simula o que o workspaceState guarda (JSON) e fecha o servidor, como ao fechar o VS Code.
    const saved = JSON.parse(JSON.stringify({ planItems: before.planItems, planSource: before.planSource, planActions: before.planActions, summary: before.summary, history: before.history }));
    await a.close();

    const b = await startServer({ preferredPort: 48060, initialState: saved });
    const after = (await get(b.port, '/state')).body;
    assert(JSON.stringify(after.planItems) === JSON.stringify(before.planItems), 'reabrir: plano atual volta igual');
    assert(after.history.length === 1 && after.history[0].summary.text === finalText, 'reabrir: histórico e resumo antigo voltam');
    assert(after.running === false && after.actions.length === 0, 'reabrir: não volta "rodando" nem ações presas');
    await b.close();

    const c = await startServer({ preferredPort: 48070 });
    assert((await get(c.port, '/state')).body.history.length === 0, 'sem nada salvo, começa vazio');
    await c.close();
  }

  // --- Cenário do print: plano concluído, trabalho avulso depois, plano novo ---
  {
    const sv = await startServer({ preferredPort: 48220 });
    const P = sv.port;
    const planA = '1. Criar `scripts/a.js`\n2. Testar';
    await post(P, '/hook', { hook_event_name: 'UserPromptSubmit' });
    await post(P, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: planA } });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: planA }, tool_response: {} });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/p/scripts/a.js', content: 'x' }, tool_response: {} });
    await post(P, '/hook', { hook_event_name: 'Stop', last_message: 'Feito: plano A.' });
    // Trabalho avulso (auditoria) depois do plano concluído.
    await post(P, '/hook', { hook_event_name: 'UserPromptSubmit' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/x.ts', old_string: 'a', new_string: 'b' }, tool_response: {} });
    await post(P, '/hook', { hook_event_name: 'Stop', last_message: 'Auditoria: 7 correções.' });
    let st = (await get(P, '/state')).body;
    assert(st.history.length === 1 && st.history[0].title === 'Criar scripts/a.js' && st.history[0].summary.text === 'Feito: plano A.', 'plano concluído vai para o histórico com o próprio resumo');
    assert(st.planItems.length === 0 && st.summary.text.startsWith('Auditoria'), 'trabalho avulso fica na tela sem o plano antigo');
    await post(P, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Passo novo\n2. Outro' } });
    st = (await get(P, '/state')).body;
    assert(st.history.length === 2 && st.history[0].title.startsWith('Auditoria'), 'resumo avulso arquivado com o título dele');
    assert(st.history.filter((h) => h.title === 'Criar scripts/a.js').length === 1, 'o plano antigo não se repete no histórico');

    // Plano em andamento em vários turnos: não sai da tela, só o resumo do meio é arquivado.
    await post(P, '/hook', { hook_event_name: 'UserPromptSubmit' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'T1' }, tool_response: 'Task #1 created successfully: T1' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'T2' }, tool_response: 'Task #2 created successfully: T2' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: '' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} });
    await post(P, '/hook', { hook_event_name: 'Stop', last_message: 'Metade feita.' });
    await post(P, '/hook', { hook_event_name: 'UserPromptSubmit' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'completed' }, tool_response: '' });
    await post(P, '/hook', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} });
    await post(P, '/hook', { hook_event_name: 'Stop', last_message: 'Tudo feito.' });
    st = (await get(P, '/state')).body;
    assert(st.planItems.length === 2 && st.summary.text === 'Tudo feito.', 'plano que termina neste turno fica na tela com o resumo final');
    assert(st.history[0].title === 'Metade feita.' && st.history[0].items.length === 0, 'resumo intermediário arquivado sozinho');
    await sv.close();
  }

  // --- Sessões: dois chats no mesmo projeto não se misturam ---
  {
    let saved;
    const sv = await startServer({ preferredPort: 48240, onPersist: (p) => (saved = p) });
    const P = sv.port;
    const ev = (session_id, body) => post(P, '/hook', { session_id, ...body });
    await ev('A', { hook_event_name: 'UserPromptSubmit', prompt: 'Crie a API de usuários' });
    await ev('A', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Plano A um\n2. Plano A dois' } });
    await ev('B', { hook_event_name: 'UserPromptSubmit', prompt: 'Corrija o CSS do header' });
    await ev('B', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/h.css', old_string: 'a', new_string: 'b' }, tool_response: {} });
    await ev('A', { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Plano A um\n2. Plano A dois' }, tool_response: {} });
    await ev('B', { hook_event_name: 'Stop', last_message: 'CSS corrigido.' });
    let st = (await get(P, '/state')).body;
    assert(st.sessionId === 'B' && st.sessionAuto === true, 'painel segue a última conversa em que você escreveu (B)');
    assert(st.planItems.length === 0 && st.summary.text === 'CSS corrigido.', 'a sessão B não mostra o plano da A');
    assert(st.sessions.length === 2 && st.sessions[0].label === 'Corrija o CSS do header', 'seletor lista as duas conversas pelo pedido inicial');
    assert(st.sessions.find((x) => x.id === 'A').running === true && st.sessions.find((x) => x.id === 'B').running === false, 'cada conversa tem o próprio "rodando"');

    sv.selectSession('A');
    st = (await get(P, '/state')).body;
    assert(st.sessionId === 'A' && st.sessionAuto === false && st.planItems.length === 2 && st.planItems[0].status === 'in_progress', 'escolher a conversa A mostra o plano dela');
    await ev('B', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} });
    st = (await get(P, '/state')).body;
    assert(st.sessionId === 'A', 'atividade da B em segundo plano não tira a A da tela');
    await ev('B', { hook_event_name: 'UserPromptSubmit', prompt: 'mais uma' });
    st = (await get(P, '/state')).body;
    assert(st.sessionId === 'B' && st.sessionAuto === true, 'escrever na B volta a seguir a última conversa');

    assert(saved && saved.version === 2 && saved.sessions.A.state.planItems.length === 2 && saved.sessions.B.state.summary.text === 'CSS corrigido.', 'estado salvo guarda as duas conversas');
    await sv.close();
    const sv2 = await startServer({ preferredPort: 48250, initialState: JSON.parse(JSON.stringify(saved)) });
    st = (await get(sv2.port, '/state')).body;
    assert(st.sessions.length === 2 && st.summary.text === 'CSS corrigido.' && st.running === false, 'reabrir restaura as conversas sem ficar "rodando"');
    sv2.selectSession('A');
    st = (await get(sv2.port, '/state')).body;
    assert(st.planItems[0].text === 'Plano A um', 'reabrir restaura o plano da outra conversa');

    // Limite de 8 conversas: a mais antiga sai e o trabalho dela vai para "Anteriores".
    for (let i = 0; i < 8; i++) {
      await post(sv2.port, '/hook', { session_id: 'S' + i, hook_event_name: 'UserPromptSubmit', prompt: 'p' + i });
      await new Promise((r) => setTimeout(r, 2));
    }
    st = (await get(sv2.port, '/state')).body;
    assert(st.sessions.length === 8 && !st.sessions.some((x) => x.id === 'A'), 'guarda no máximo 8 conversas');
    assert(st.history.some((h) => h.summary && h.summary.text === 'CSS corrigido.') || st.history.some((h) => h.title === 'Plano A um'), 'conversa que sai tem o trabalho arquivado');
    await sv2.close();
  }

  // --- Auditoria: segurança, instalação sem duplicatas, diff grande, caminhos Windows ---
  {
    const srv2 = await startServer({ preferredPort: 48200 });
    const raw = (opts, body) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: srv2.port, agent: false, ...opts }, (res) => {
        let out = ''; res.on('data', (c) => (out += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
      });
      req.on('error', reject); if (body) req.write(body); req.end();
    });
    const leak = await raw({ path: '/state', method: 'GET', headers: { Origin: 'https://site-malicioso.example' } });
    assert(!leak.headers['access-control-allow-origin'], 'sem CORS: página no navegador não consegue ler /state');
    const rebind = await raw({ path: '/state', method: 'GET', headers: { Host: 'ataque.example:48200' } });
    assert(rebind.status === 403, 'Host que não é local é recusado (DNS rebinding)');
    const textPost = await raw({ path: '/hook', method: 'POST', headers: { 'Content-Type': 'text/plain' } }, JSON.stringify({ hook_event_name: 'Notification', message: 'falso' }));
    const afterText = JSON.parse((await raw({ path: '/state', method: 'GET' })).body);
    assert(textPost.status === 415 && !afterText.notification, 'POST sem JSON (formulário de navegador) é recusado');
    await srv2.close();

    const { installHooks } = require(path.join(__dirname, '..', 'dist-test', 'installHooks.js'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-inst-'));
    fs.mkdirSync(path.join(root, '.claude'));
    const winCmd = 'node "C:\\Users\\x\\.claude\\panel\\hook.js"';
    const outro = { type: 'command', command: 'node outro-hook.js' };
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: {
      PreToolUse: [
        { matcher: '*', hooks: [{ type: 'command', command: winCmd }] },
        { matcher: '*', hooks: [{ type: 'command', command: winCmd }] },
        { matcher: 'Bash', hooks: [outro, { type: 'command', command: winCmd }] },
      ],
    } }));
    const tpl = path.join(__dirname, '..', 'src', 'hook-template', 'hook.js');
    const r1 = installHooks(root, tpl, 'global');
    const cfg = JSON.parse(fs.readFileSync(r1.settingsPath, 'utf8'));
    const cmds = (ev) => cfg.hooks[ev].flatMap((e) => e.hooks.map((h) => h.command));
    assert(cmds('PreToolUse').filter((c) => /panel/.test(c)).length === 1, 'duplicatas do hook (caminho Windows) viram uma só');
    assert(cmds('PreToolUse').includes('node outro-hook.js'), 'hooks de outras ferramentas ficam intactos');
    assert(cmds('Stop').filter((c) => /panel/.test(c)).length === 1, 'eventos que faltavam ganham o hook');
    const r2 = installHooks(root, tpl, 'global');
    assert(r2.alreadyConfigured === true, 'segunda instalação reconhece que já está configurado');
    fs.rmSync(root, { recursive: true, force: true });

    const { lineDiff } = require(path.join(__dirname, '..', 'dist-test', 'diff.js'));
    const big = Array.from({ length: 3000 }, (_, i) => 'linha ' + i).join('\n');
    const t0 = Date.now();
    const d = lineDiff(big, big + '\nnova');
    assert(Date.now() - t0 < 200 && d.length <= 40, 'edição de 3.000 linhas não trava (sem tabela n×m)');

    const srv3 = await startServer({ preferredPort: 48210 });
    await post(srv3.port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\proj\\src\\panel\\App.tsx' } });
    await post(srv3.port, '/hook', { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: '1. Criar `scripts/a.js` agora\n2. Testar `b`' } });
    const s3 = (await get(srv3.port, '/state')).body;
    assert(s3.actions[0].label === 'Editando panel/App.tsx', 'rótulo usa caminho curto também no Windows');
    assert(s3.planItems[0].text === 'Criar scripts/a.js agora', 'item do plano sem crases');
    await srv3.close();
  }

  // --- hook.js: só o ExitPlanMode aprovado, com o painel aberto, devolve contexto ao Claude ---
  {
    const hookPath = path.join(__dirname, '..', 'src', 'hook-template', 'hook.js');
    // Assíncrono: o servidor de teste roda neste mesmo processo e precisa responder.
    const runHook = (payload, projectDir, env = {}) =>
      new Promise((resolve) => {
        const child = spawn('node', [hookPath], { env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env } });
        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.on('close', (status) => resolve({ status, stdout }));
        child.stdin.end(JSON.stringify(payload));
      });
    const sv = await startServer({ preferredPort: 48260 });
    const open = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-open-'));
    fs.mkdirSync(path.join(open, '.vscode'));
    fs.writeFileSync(path.join(open, '.vscode', 'claude-code-panel.port'), String(sv.port));
    const closed = path.join(os.tmpdir(), 'ccp-sem-painel-' + Date.now());
    const plan = { hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode' };

    const nudged = await runHook(plan, open);
    assert(nudged.status === 0 && /Feito:/.test(nudged.stdout) && !/TodoWrite|TaskCreate/.test(nudged.stdout) && JSON.parse(nudged.stdout).hookSpecificOutput.hookEventName === 'PostToolUse', 'com o painel aberto, o plano aprovado devolve o pedido do resumo');
    const noPanel = await runHook(plan, closed);
    assert(noPanel.status === 0 && noPanel.stdout === '', 'sem o painel aberto, o hook não pede nada ao Claude (e sai com 0)');
    const silent = await runHook({ hook_event_name: 'PostToolUse', tool_name: 'Edit' }, open);
    assert(silent.status === 0 && silent.stdout === '', 'outros eventos não devolvem nada ao Claude');
    const optOut = await runHook(plan, open, { CLAUDE_PANEL_NO_NUDGE: '1' });
    assert(optOut.status === 0 && optOut.stdout === '', 'CLAUDE_PANEL_NO_NUDGE=1 desliga o pedido');
    await sv.close();
    fs.rmSync(open, { recursive: true, force: true });
  }

  console.log('\nTeste concluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
