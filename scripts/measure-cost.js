// Mede quanto a extensão acrescenta às sessões do Claude Code, a partir dos históricos
// (.jsonl) que o próprio Claude Code grava. Tudo é lido localmente; nada sai da máquina.
//
// Uso: node scripts/measure-cost.js [pasta]   (padrão: ~/.claude/projects)
const fs = require('fs');
const os = require('os');
const path = require('path');

// Preço de API do Claude Opus 5.5, em US$ por milhão de tokens.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 };
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite']);
// Início do pedido pós-plano, igual em todas as versões do hook.js.
const HOOK_MARK = 'Plan approved.';
const HOOK_SCRIPT = /panel[\\/]+hook\.js/;
const SUMMARY_MARK = /O que foi constru|what was built|^\s*Feito:/im;

function listTranscripts(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) files.push(full);
    }
  };
  walk(root);
  return files;
}

function readRows(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (!row.isSidechain) rows.push(row);
    } catch {
      // linha cortada ou corrompida: ignora
    }
  }
  return rows;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function analyzeSession(rows) {
  // Cada bloco da resposta vem numa linha, todas com o mesmo usage: agrupa por message.id.
  const calls = new Map();
  for (const row of rows) {
    if (row.type !== 'assistant' || !row.message?.id) continue;
    if (!calls.has(row.message.id)) calls.set(row.message.id, { usage: row.message.usage ?? {}, blocks: [], stop: undefined });
    const call = calls.get(row.message.id);
    call.blocks.push(...(row.message.content ?? []));
    call.stop = row.message.stop_reason ?? call.stop;
  }

  const session = { calls: calls.size, usd: 0, taskCalls: 0, hookInjections: 0, hookMs: [], summaryTokens: [], finalTokens: [] };
  for (const { usage: u, blocks, stop } of calls.values()) {
    const cacheWrite1h = u.cache_creation?.ephemeral_1h_input_tokens ?? u.cache_creation_input_tokens ?? 0;
    const cacheWrite5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    session.usd +=
      ((u.input_tokens ?? 0) * PRICE.input +
        (u.output_tokens ?? 0) * PRICE.output +
        (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
        cacheWrite5m * PRICE.cacheWrite5m +
        cacheWrite1h * PRICE.cacheWrite1h) /
      1e6;

    session.taskCalls += blocks.filter((b) => b.type === 'tool_use' && TASK_TOOLS.has(b.name)).length;

    // Mensagem final do turno: só o texto visível conta (o raciocínio é separado).
    const texts = blocks.filter((b) => b.type === 'text');
    if (stop === 'end_turn' && texts.length) {
      const visible = (u.output_tokens ?? 0) - (u.output_tokens_details?.thinking_tokens ?? 0);
      const text = texts.map((b) => b.text).join('');
      (SUMMARY_MARK.test(text) ? session.summaryTokens : session.finalTokens).push(visible);
    }
  }
  // Cada execução do hook vira um anexo "hook_success" (com a duração real); o pedido que ele
  // devolve ao Claude vira um anexo "hook_additional_context" à parte.
  for (const row of rows) {
    const a = row.type === 'attachment' ? row.attachment : undefined;
    if (!a) continue;
    if (a.type === 'hook_additional_context' && JSON.stringify(a.content ?? '').includes(HOOK_MARK)) session.hookInjections++;
    if (a.type === 'hook_success' && HOOK_SCRIPT.test(String(a.command ?? '')) && typeof a.durationMs === 'number') session.hookMs.push(a.durationMs);
  }
  return session;
}

function analyze(root) {
  const sessions = listTranscripts(root)
    .map((file) => analyzeSession(readRows(file)))
    .filter((s) => s.calls > 0);
  const all = (key) => sessions.flatMap((s) => s[key]);
  const sum = (key) => sessions.reduce((acc, s) => acc + s[key], 0);
  return {
    sessions: sessions.length,
    medianSessionUsd: median(sessions.map((s) => s.usd)),
    totalUsd: sum('usd'),
    hookInjections: sum('hookInjections'),
    hookRuns: all('hookMs').length,
    medianHookMs: median(all('hookMs')),
    taskCalls: sum('taskCalls'),
    summaries: all('summaryTokens').length,
    medianSummaryTokens: median(all('summaryTokens')),
    medianFinalTokens: median(all('finalTokens')),
  };
}

function format(r) {
  const usd = (v) => `US$ ${v.toFixed(2)}`;
  return [
    `Sessões analisadas:            ${r.sessions}`,
    `Custo da sessão mediana:       ${usd(r.medianSessionUsd)}  (total ${usd(r.totalUsd)}, preço Opus 5.5)`,
    `Pedidos do hook no contexto:   ${r.hookInjections}`,
    // O Claude Code só grava a duração quando o hook devolve algo (o pedido pós-plano).
    `Hook com retorno (duração):    ${r.hookRuns} execuções, mediana ${r.medianHookMs} ms`,
    `Chamadas de lista de tarefas:  ${r.taskCalls}`,
    `Resumos (Feito/três seções):   ${r.summaries}, mediana ${r.medianSummaryTokens} tokens`,
    `Fechamento normal:             mediana ${r.medianFinalTokens} tokens`,
  ].join('\n');
}

module.exports = { analyze, analyzeSession, format, PRICE };

if (require.main === module) {
  const root = process.argv[2] || path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) {
    console.error(`Pasta não encontrada: ${root}`);
    process.exit(1);
  }
  console.log(format(analyze(root)));
}
