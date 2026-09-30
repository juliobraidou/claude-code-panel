// Teste do instalador de um arquivo só (release/install-hooks.js), rodando o processo de
// verdade com uma pasta pessoal temporária no lugar de ~.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = path.join(__dirname, '..', 'release', 'install-hooks.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FALHOU:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-home-'));
const run = (args, cwd = home) =>
  spawnSync('node', [cli, ...args], { cwd, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
const settingsOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
const panelCmds = (s, ev) => (s.hooks?.[ev] ?? []).flatMap((e) => e.hooks.map((h) => h.command)).filter((c) => /panel/.test(c));

// Settings já existente, com outra configuração e um hook de outra ferramenta.
fs.mkdirSync(path.join(home, '.claude'));
fs.writeFileSync(
  path.join(home, '.claude', 'settings.json'),
  JSON.stringify({ model: 'opus', hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node outro.js' }] }] } })
);

let r = run([]);
let s = settingsOf(home);
assert(r.status === 0 && /Hooks instalados/.test(r.stdout), 'instala para todos os projetos');
assert(fs.existsSync(path.join(home, '.claude', 'panel', 'hook.js')), 'hook.js embutido é gravado em ~/.claude/panel');
assert(fs.readFileSync(path.join(home, '.claude', 'panel', 'hook.js'), 'utf8').includes('Plan approved'), 'hook.js gravado é o hook completo');
assert(['PreToolUse', 'PostToolUse', 'Notification', 'UserPromptSubmit', 'Stop', 'SubagentStop'].every((ev) => panelCmds(s, ev).length === 1), 'um hook do painel em cada um dos 6 eventos');
assert(s.model === 'opus' && s.hooks.Stop.some((e) => e.hooks.some((h) => h.command === 'node outro.js')), 'configurações e hooks do usuário ficam intactos');

r = run([]);
assert(r.status === 0 && /já estavam configurados/.test(r.stdout) && panelCmds(settingsOf(home), 'Stop').length === 1, 'rodar de novo não duplica');

const proj = path.join(home, 'meu-projeto');
fs.mkdirSync(proj);
r = run(['--project'], proj);
assert(r.status === 0 && panelCmds(settingsOf(proj), 'PreToolUse')[0] === 'node "$CLAUDE_PROJECT_DIR/.claude/panel/hook.js"', '--project usa a pasta atual e o caminho relativo ao projeto');

r = run(['--uninstall']);
s = settingsOf(home);
assert(r.status === 0 && /removidos/.test(r.stdout), 'desinstala');
assert(!panelCmds(s, 'Stop').length && s.hooks.Stop.length === 1 && s.model === 'opus', 'desinstalar remove só o painel');
assert(!s.hooks.PreToolUse && !fs.existsSync(path.join(home, '.claude', 'panel')), 'eventos vazios e a pasta do hook somem');

fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ "model": "opus", // comentário\n}');
r = run([]);
assert(r.status === 1 && /não é um JSON válido/.test(r.stderr), 'settings.json inválido: para com erro');
assert(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8').includes('// comentário'), 'settings.json inválido não é sobrescrito');

r = run(['--forca']);
assert(r.status === 2 && /Opção desconhecida/.test(r.stderr), 'opção desconhecida é recusada');

fs.rmSync(home, { recursive: true, force: true });
console.log('\nTeste do instalador concluído.');
