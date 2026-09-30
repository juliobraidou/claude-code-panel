#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli/install-hooks.ts
var os = __toESM(require("os"));
var path2 = __toESM(require("path"));

// src/installHooks.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var HOOK_EVENTS = ["PreToolUse", "PostToolUse", "Notification", "UserPromptSubmit", "Stop", "SubagentStop"];
var PANEL_HOOK = /\.claude[\\/]+panel[\\/]+hook\.js/;
var isPanelHook = (h) => typeof h?.command === "string" && PANEL_HOOK.test(h.command);
function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, "utf8");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    throw new Error(`${settingsPath} n\xE3o \xE9 um JSON v\xE1lido; corrija o arquivo e tente de novo (${err.message})`);
  }
}
function withoutPanelHooks(list) {
  const ours = list.flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks.filter(isPanelHook) : []);
  const others = list.map(
    (entry) => Array.isArray(entry?.hooks) ? { ...entry, hooks: entry.hooks.filter((h) => !isPanelHook(h)) } : entry
  ).filter((entry) => !Array.isArray(entry?.hooks) || entry.hooks.length > 0);
  return { others, ours };
}
function installHooksFromSource(targetRoot, hookSource, mode) {
  const settingsPath = path.join(targetRoot, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  const panelDir = path.join(targetRoot, ".claude", "panel");
  fs.mkdirSync(panelDir, { recursive: true });
  const hookScriptPath = path.join(panelDir, "hook.js");
  fs.writeFileSync(hookScriptPath, hookSource, "utf8");
  const hookCommand = mode === "project" ? 'node "$CLAUDE_PROJECT_DIR/.claude/panel/hook.js"' : `node "${hookScriptPath}"`;
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  let alreadyConfigured = true;
  for (const event of HOOK_EVENTS) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const { others, ours } = withoutPanelHooks(list);
    if (ours.length !== 1 || ours[0].command !== hookCommand) alreadyConfigured = false;
    settings.hooks[event] = [...others, { matcher: "*", hooks: [{ type: "command", command: hookCommand }] }];
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return { settingsPath, hookScriptPath, alreadyConfigured };
}
function uninstallHooks(targetRoot) {
  const settingsPath = path.join(targetRoot, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  let removed = 0;
  if (settings.hooks && typeof settings.hooks === "object") {
    for (const event of Object.keys(settings.hooks)) {
      const list = settings.hooks[event];
      if (!Array.isArray(list)) continue;
      const { others, ours } = withoutPanelHooks(list);
      removed += ours.length;
      if (others.length) settings.hooks[event] = others;
      else delete settings.hooks[event];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    if (removed) fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }
  fs.rmSync(path.join(targetRoot, ".claude", "panel"), { recursive: true, force: true });
  return { settingsPath, removed };
}

// src/cli/install-hooks.ts
var HELP = `Claude Code Panel: instalador dos hooks

Uso:
  node install-hooks.js                    instala para todos os projetos (~/.claude)
  node install-hooks.js --project [pasta]  instala s\xF3 nesse projeto (padr\xE3o: pasta atual)
  node install-hooks.js --uninstall        remove os hooks do painel
  node install-hooks.js --uninstall --project [pasta]

Os outros hooks que voc\xEA j\xE1 tenha no settings.json ficam como est\xE3o.`;
function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const known = /* @__PURE__ */ new Set(["--project", "--uninstall"]);
  const unknown = argv.filter((a) => a.startsWith("-") && !known.has(a));
  if (unknown.length) {
    console.error(`Op\xE7\xE3o desconhecida: ${unknown.join(", ")}

${HELP}`);
    return 2;
  }
  const projectIdx = argv.indexOf("--project");
  const project = projectIdx !== -1;
  const projectDir = project && argv[projectIdx + 1] && !argv[projectIdx + 1].startsWith("-") ? argv[projectIdx + 1] : process.cwd();
  const root = project ? path2.resolve(projectDir) : os.homedir();
  try {
    if (argv.includes("--uninstall")) {
      const r2 = uninstallHooks(root);
      console.log(
        r2.removed ? `Hooks do painel removidos de ${r2.settingsPath} (${r2.removed} entradas).` : `Nenhum hook do painel encontrado em ${r2.settingsPath}.`
      );
      return 0;
    }
    const r = installHooksFromSource(root, `#!/usr/bin/env node
// Script de hook do Claude Code. N\xE3o tem depend\xEAncias (roda com o node do sistema).
// L\xEA o payload JSON do stdin e repassa para o servidor local da extens\xE3o "Claude Code Panel".
// Se o VS Code n\xE3o estiver aberto ou o servidor n\xE3o estiver de p\xE9, falha em sil\xEAncio
// e sempre sai com c\xF3digo 0, para nunca travar o Claude Code.

const fs = require('fs');
const path = require('path');
const http = require('http');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // N\xE3o espera para sempre: se n\xE3o vier nada em 2s, segue com vazio.
    setTimeout(() => resolve(data), 2000);
  });
}

function findPort(projectDir) {
  const candidates = [
    path.join(projectDir, '.vscode', 'claude-code-panel.port'),
    path.join(projectDir, '.claude', 'panel', 'port'),
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      const port = parseInt(raw, 10);
      if (port > 0) return port;
    } catch (err) {
      // tenta o pr\xF3ximo
    }
  }
  return null;
}

// Resolve true s\xF3 quando o painel recebeu o evento (servidor de p\xE9 e respondeu 200).
function postEvent(port, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        // O servidor local responde em ~10 ms; se o VS Code travar, n\xE3o segura o Claude.
        timeout: 500,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode === 200));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(data);
    req.end();
  });
}

const TAIL_BYTES = 512 * 1024;
const MAX_MESSAGE_CHARS = 20000;

// L\xEA s\xF3 o fim do arquivo de hist\xF3rico da sess\xE3o (pode ter v\xE1rios MB).
function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\\n') + 1); // descarta a linha cortada
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function textOf(message) {
  const content = message && message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\\n\\n');
}

// A mensagem final do Claude: o texto do assistente depois da \xFAltima mensagem de "usu\xE1rio"
// (que no hist\xF3rico tamb\xE9m inclui os resultados de ferramenta). Fica tudo na sua m\xE1quina:
// o texto s\xF3 vai para o servidor local da extens\xE3o, nunca para a rede.
function readFinalMessage(transcriptPath) {
  if (!transcriptPath) return '';
  let raw;
  try {
    raw = readTail(transcriptPath);
  } catch (err) {
    return '';
  }
  const lines = raw.split('\\n').filter(Boolean);
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (err) {
      continue;
    }
    if (entry.isSidechain) continue; // conversa de subagente
    const role = entry.type || (entry.message && entry.message.role);
    if (role === 'user') break;
    if (role === 'assistant') {
      const text = textOf(entry.message).trim();
      if (text) parts.unshift(text);
    }
  }
  const text = parts.join('\\n\\n');
  return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) + '\u2026' : text;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const raw = await readStdin();

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch (err) {
    payload = {};
  }

  // Quando o Claude termina, anexa a mensagem final dele para o painel mostrar como resumo.
  // Se o hist\xF3rico ainda n\xE3o foi gravado, tenta mais uma vez depois de um instante.
  if (payload.hook_event_name === 'Stop') {
    let message = readFinalMessage(payload.transcript_path);
    if (!message) {
      await sleep(400);
      message = readFinalMessage(payload.transcript_path);
    }
    if (message) payload.last_message = message;
  }

  const port = findPort(projectDir);
  const panelOpen = port ? await postEvent(port, payload) : false;

  // \xDAnica vez em que o hook fala com o Claude (n\xE3o s\xF3 observa): logo depois que voc\xEA
  // aprova o plano, pede que a mensagem final seja um resumo curto (feito / testes /
  // falta), que o painel mostra. Ele substitui o fechamento normal, ent\xE3o sai mais barato
  // que um fechamento comum. N\xE3o pede lista de tarefas: medido em 20 sess\xF5es, as
  // ferramentas de tarefa n\xE3o estavam dispon\xEDveis e o pedido s\xF3 gerava explica\xE7\xF5es.
  // S\xF3 pede quando o painel recebeu o evento: em projeto sem o painel aberto, o Claude
  // responde do jeito normal. Custa ~130 tokens por plano. Para desligar, defina
  // CLAUDE_PANEL_NO_NUDGE=1.
  let output = '';
  if (
    payload.hook_event_name === 'PostToolUse' &&
    payload.tool_name === 'ExitPlanMode' &&
    panelOpen &&
    !process.env.CLAUDE_PANEL_NO_NUDGE
  ) {
    output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          "Plan approved. When all is done, make your final message only a summary in the user's " +
          'language: Feito: <files/changes>. Testes: <what ran, result>. Falta: <unverified or ' +
          'none>. 3-8 short lines; use the extra lines only for pending items. No other recap. ' +
          'Only after this plan; later turns reply normally.',
      },
    });
  }

  // Nunca bloqueia nem falha o Claude Code por causa do painel.
  if (output) {
    process.stdout.write(output, () => process.exit(0));
  } else {
    process.exit(0);
  }
}

main();
`, project ? "project" : "global");
    console.log(r.alreadyConfigured ? `Hooks j\xE1 estavam configurados em ${r.settingsPath}; hook.js atualizado.` : `Hooks instalados em ${r.settingsPath}.`);
    console.log(`Hook: ${r.hookScriptPath}`);
    console.log(
      project ? "Vale s\xF3 para este projeto. Reinicie o Claude Code nele para ativar." : "Vale para todos os projetos. Reinicie o Claude Code para ativar."
    );
    return 0;
  } catch (err) {
    console.error(`N\xE3o foi poss\xEDvel ${argv.includes("--uninstall") ? "remover" : "instalar"}: ${err.message}`);
    return 1;
  }
}
process.exitCode = main(process.argv.slice(2));
