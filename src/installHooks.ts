import * as fs from 'fs';
import * as path from 'path';

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Notification', 'UserPromptSubmit', 'Stop', 'SubagentStop'];
// Reconhece o nosso hook com barra normal ou invertida (o comando global no Windows usa "\").
const PANEL_HOOK = /\.claude[\\/]+panel[\\/]+hook\.js/;
const isPanelHook = (h: any) => typeof h?.command === 'string' && PANEL_HOOK.test(h.command);

export interface InstallResult {
  settingsPath: string;
  hookScriptPath: string;
  alreadyConfigured: boolean;
}

export interface UninstallResult {
  settingsPath: string;
  removed: number;
}

// Lê o settings.json sem nunca perder o conteúdo do usuário: se o arquivo existe mas não é
// JSON válido, para com erro em vez de sobrescrever as configurações dele.
function readSettings(settingsPath: string): any {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, 'utf8');
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    throw new Error(`${settingsPath} não é um JSON válido; corrija o arquivo e tente de novo (${(err as Error).message})`);
  }
}

// Tira todas as cópias do nosso hook de uma lista de hooks de um evento, sem mexer nos
// hooks de outras ferramentas. Devolve a lista limpa e quantas cópias havia.
function withoutPanelHooks(list: any[]): { others: any[]; ours: any[] } {
  const ours = list.flatMap((entry: any) => (Array.isArray(entry?.hooks) ? entry.hooks.filter(isPanelHook) : []));
  const others = list
    .map((entry: any) =>
      Array.isArray(entry?.hooks) ? { ...entry, hooks: entry.hooks.filter((h: any) => !isPanelHook(h)) } : entry
    )
    .filter((entry: any) => !Array.isArray(entry?.hooks) || entry.hooks.length > 0);
  return { others, ours };
}

// Instala o hook.js e configura .claude/settings.json para chamá-lo.
// mode "project": grava em <pasta do projeto>/.claude — só vale para esse projeto,
//   e usa um comando relativo ($CLAUDE_PROJECT_DIR), então funciona mesmo se o
//   projeto for movido ou aberto em outra máquina com este repo.
// mode "global": grava em ~/.claude — vale para TODOS os projetos que você abrir,
//   sem precisar repetir a instalação a cada um. Usa caminho absoluto do hook.js,
//   já que não existe um "$CLAUDE_PROJECT_DIR/.claude" fixo nesse caso.
export function installHooks(targetRoot: string, hookTemplatePath: string, mode: 'project' | 'global'): InstallResult {
  return installHooksFromSource(targetRoot, fs.readFileSync(hookTemplatePath, 'utf8'), mode);
}

// Igual ao installHooks, mas recebe o conteúdo do hook.js pronto (o instalador de linha
// de comando leva o hook embutido, para funcionar como um arquivo só).
export function installHooksFromSource(targetRoot: string, hookSource: string, mode: 'project' | 'global'): InstallResult {
  const settingsPath = path.join(targetRoot, '.claude', 'settings.json');
  const settings = readSettings(settingsPath);

  const panelDir = path.join(targetRoot, '.claude', 'panel');
  fs.mkdirSync(panelDir, { recursive: true });
  const hookScriptPath = path.join(panelDir, 'hook.js');
  fs.writeFileSync(hookScriptPath, hookSource, 'utf8');

  const hookCommand =
    mode === 'project' ? 'node "$CLAUDE_PROJECT_DIR/.claude/panel/hook.js"' : `node "${hookScriptPath}"`;

  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  let alreadyConfigured = true;
  for (const event of HOOK_EVENTS) {
    const list: any[] = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const { others, ours } = withoutPanelHooks(list);
    if (ours.length !== 1 || ours[0].command !== hookCommand) alreadyConfigured = false;
    // Uma única entrada nossa no fim (instalações antigas deixavam duplicatas).
    settings.hooks[event] = [...others, { matcher: '*', hooks: [{ type: 'command', command: hookCommand }] }];
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { settingsPath, hookScriptPath, alreadyConfigured };
}

// Remove o hook do painel do settings.json (e o hook.js), deixando os outros hooks como estão.
export function uninstallHooks(targetRoot: string): UninstallResult {
  const settingsPath = path.join(targetRoot, '.claude', 'settings.json');
  const settings = readSettings(settingsPath);
  let removed = 0;

  if (settings.hooks && typeof settings.hooks === 'object') {
    for (const event of Object.keys(settings.hooks)) {
      const list = settings.hooks[event];
      if (!Array.isArray(list)) continue;
      const { others, ours } = withoutPanelHooks(list);
      removed += ours.length;
      if (others.length) settings.hooks[event] = others;
      else delete settings.hooks[event];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    if (removed) fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }

  fs.rmSync(path.join(targetRoot, '.claude', 'panel'), { recursive: true, force: true });
  return { settingsPath, removed };
}

export function writePortFile(workspaceRoot: string, port: number): string {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  const portFile = path.join(vscodeDir, 'claude-code-panel.port');
  fs.writeFileSync(portFile, String(port), 'utf8');
  return portFile;
}
