// Teste do measure-cost.js com um histórico falso de números conhecidos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze } = require('./measure-cost');

function assert(cond, msg) {
  if (!cond) {
    console.error('FALHOU:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const usage = (o) => ({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, ...o });
const assistant = (id, content, u, stop = 'tool_use') => ({ type: 'assistant', message: { id, role: 'assistant', content, stop_reason: stop, usage: u } });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-cost-'));
const projeto = path.join(tmp, 'projeto');
fs.mkdirSync(projeto);

const sessao = [
  { type: 'user', message: { role: 'user', content: 'Faça o plano' } },
  // Uma chamada em dois blocos (duas linhas, mesmo id e mesmo usage): conta uma vez só.
  assistant('m1', [{ type: 'tool_use', id: 't1', name: 'TaskCreate', input: { subject: 'A' } }], usage({ input_tokens: 1000, output_tokens: 100 })),
  assistant('m1', [{ type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [] } }], usage({ input_tokens: 1000, output_tokens: 100 })),
  { type: 'attachment', attachment: { type: 'hook_success', command: 'node "C:\\Users\\x\\.claude\\panel\\hook.js"', durationMs: 70, content: '' } },
  { type: 'attachment', attachment: { type: 'hook_additional_context', content: ['Plan approved. ... a side panel tracks it.'] } },
  // Resumo no formato novo: 300 de saída, 100 de raciocínio -> 200 visíveis.
  assistant('m2', [{ type: 'text', text: 'Feito: x.\nTestes: ok.\nFalta: nada.' }], usage({ output_tokens: 300, output_tokens_details: { thinking_tokens: 100 } }), 'end_turn'),
  // Fechamento normal.
  assistant('m3', [{ type: 'text', text: 'Pronto, ajustei o botão.' }], usage({ output_tokens: 50, cache_read_input_tokens: 1_000_000 }), 'end_turn'),
  // Subagente não entra.
  { ...assistant('m4', [{ type: 'text', text: 'sub' }], usage({ output_tokens: 999999 }), 'end_turn'), isSidechain: true },
];
fs.writeFileSync(path.join(projeto, 'sessao.jsonl'), sessao.map((l) => JSON.stringify(l)).join('\n') + '\nlinha quebrada {\n');

const r = analyze(tmp);
// m1: 1000×4 + 100×20 = 6000 · m2: 300×20 = 6000 · m3: 50×20 + 1e6×0,2 = 201000 → US$ 0,213
assert(r.sessions === 1, 'uma sessão (linha quebrada e subagente ignorados)');
assert(Math.abs(r.totalUsd - 0.213) < 1e-9, `custo somado por chamada, sem duplicar blocos (${r.totalUsd})`);
assert(r.taskCalls === 2, 'conta TaskCreate e TodoWrite');
assert(r.hookInjections === 1, 'um pedido do hook (o anexo hook_success não conta em dobro)');
assert(r.hookRuns === 1 && r.medianHookMs === 70, 'duração do hook lida do caminho Windows');
assert(r.summaries === 1 && r.medianSummaryTokens === 200, 'resumo Feito/Testes/Falta com tokens visíveis (sem raciocínio)');
assert(r.medianFinalTokens === 50, 'fechamento normal separado do resumo');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nTeste do custo concluído.');
