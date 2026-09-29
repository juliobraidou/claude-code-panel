import * as fs from 'fs';
import * as path from 'path';

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Notification', 'UserPromptSubmit', 'Stop', 'SubagentStop'];

export interface InstallResult {
  settingsPath: string;
  hookScriptPath: string;
  alreadyConfigured: boolean;
}

// Instala o hook.js e configura .claude/settings.json para chamá-lo.
// mode "project": grava em <pasta do projeto>/.claude — só vale para esse projeto,
//   e usa um comando relativo ($CLAUDE_PROJECT_DIR), então funciona mesmo se o
//   projeto for movido ou aberto em outra máquina com este repo.
// mode "global": grava em ~/.claude — vale para TODOS os projetos que você abrir,
//   sem precisar repetir a instalação a cada um. Usa caminho absoluto do hook.js,
//   já que não existe um "$CLAUDE_PROJECT_DIR/.claude" fixo nesse caso.
export function installHooks(
  targetRoot: string,
  hookTemplatePath: string,
  mode: 'project' | 'global'
): InstallResult {
  const panelDir = path.join(targetRoot, '.claude', 'panel');
  fs.mkdirSync(panelDir, { recursive: true });

  const hookScriptPath = path.join(panelDir, 'hook.js');
  const hookSource = fs.readFileSync(hookTemplatePath, 'utf8');
  fs.writeFileSync(hookScriptPath, hookSource, 'utf8');

  const hookCommand =
    mode === 'project'
      ? 'node "$CLAUDE_PROJECT_DIR/.claude/panel/hook.js"'
      : `node "${hookScriptPath}"`;

  const settingsPath = path.join(targetRoot, '.claude', 'settings.json');
  let settings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      settings = {};
    }
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }

  let alreadyConfigured = true;

  for (const event of HOOK_EVENTS) {
    const list: any[] = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const hasOurHook = list.some((entry: any) =>
      Array.isArray(entry?.hooks) && entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes('.claude/panel/hook.js'))
    );
    if (!hasOurHook) {
      alreadyConfigured = false;
      list.push({
        matcher: '*',
        hooks: [{ type: 'command', command: hookCommand }],
      });
    }
    settings.hooks[event] = list;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  return { settingsPath, hookScriptPath, alreadyConfigured };
}

export function writePortFile(workspaceRoot: string, port: number): string {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  const portFile = path.join(vscodeDir, 'claude-code-panel.port');
  fs.writeFileSync(portFile, String(port), 'utf8');
  return portFile;
}
