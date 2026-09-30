#!/usr/bin/env node
// Script de hook do Claude Code. Não tem dependências (roda com o node do sistema).
// Lê o payload JSON do stdin e repassa para o servidor local da extensão "Claude Code Panel".
// Se o VS Code não estiver aberto ou o servidor não estiver de pé, falha em silêncio
// e sempre sai com código 0, para nunca travar o Claude Code.

const fs = require('fs');
const path = require('path');
const http = require('http');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // Não espera para sempre: se não vier nada em 2s, segue com vazio.
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
      // tenta o próximo
    }
  }
  return null;
}

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
        // O servidor local responde em ~10 ms; se o VS Code travar, não segura o Claude.
        timeout: 500,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      }
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.write(data);
    req.end();
  });
}

const TAIL_BYTES = 512 * 1024;
const MAX_MESSAGE_CHARS = 20000;

// Lê só o fim do arquivo de histórico da sessão (pode ter vários MB).
function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // descarta a linha cortada
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
    .join('\n\n');
}

// A mensagem final do Claude: o texto do assistente depois da última mensagem de "usuário"
// (que no histórico também inclui os resultados de ferramenta). Fica tudo na sua máquina:
// o texto só vai para o servidor local da extensão, nunca para a rede.
function readFinalMessage(transcriptPath) {
  if (!transcriptPath) return '';
  let raw;
  try {
    raw = readTail(transcriptPath);
  } catch (err) {
    return '';
  }
  const lines = raw.split('\n').filter(Boolean);
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
  const text = parts.join('\n\n');
  return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) + '…' : text;
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
  // Se o histórico ainda não foi gravado, tenta mais uma vez depois de um instante.
  if (payload.hook_event_name === 'Stop') {
    let message = readFinalMessage(payload.transcript_path);
    if (!message) {
      await sleep(400);
      message = readFinalMessage(payload.transcript_path);
    }
    if (message) payload.last_message = message;
  }

  const port = findPort(projectDir);
  if (port) {
    await postEvent(port, payload);
  }

  // Única vez em que o hook fala com o Claude (não só observa): logo depois que você
  // aprova o plano, pede que a mensagem final seja um resumo curto (feito / testes /
  // falta), que o painel mostra. Ele substitui o fechamento normal, então sai mais barato
  // que um fechamento comum. Não pede lista de tarefas: medido em 20 sessões, as
  // ferramentas de tarefa não estavam disponíveis e o pedido só gerava explicações.
  // Custa ~70 tokens por plano. Para desligar, defina CLAUDE_PANEL_NO_NUDGE=1.
  let output = '';
  if (
    payload.hook_event_name === 'PostToolUse' &&
    payload.tool_name === 'ExitPlanMode' &&
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
