// Instalador dos hooks do Claude Code Panel em um arquivo só, para quem baixou a extensão
// e não quer (ou não pode) usar o comando da paleta do VS Code. O hook.js vai embutido.
//
//   node install-hooks.js                    instala para todos os projetos (~/.claude)
//   node install-hooks.js --project [pasta]  instala só nesse projeto (padrão: pasta atual)
//   node install-hooks.js --uninstall        remove (use junto com --project para um projeto)
import * as os from 'os';
import * as path from 'path';
import { installHooksFromSource, uninstallHooks } from '../installHooks';

declare const __HOOK_SOURCE__: string;

const HELP = `Claude Code Panel: instalador dos hooks

Uso:
  node install-hooks.js                    instala para todos os projetos (~/.claude)
  node install-hooks.js --project [pasta]  instala só nesse projeto (padrão: pasta atual)
  node install-hooks.js --uninstall        remove os hooks do painel
  node install-hooks.js --uninstall --project [pasta]

Os outros hooks que você já tenha no settings.json ficam como estão.`;

function main(argv: string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return 0;
  }
  const known = new Set(['--project', '--uninstall']);
  const unknown = argv.filter((a) => a.startsWith('-') && !known.has(a));
  if (unknown.length) {
    console.error(`Opção desconhecida: ${unknown.join(', ')}\n\n${HELP}`);
    return 2;
  }

  const projectIdx = argv.indexOf('--project');
  const project = projectIdx !== -1;
  const projectDir = project && argv[projectIdx + 1] && !argv[projectIdx + 1].startsWith('-') ? argv[projectIdx + 1] : process.cwd();
  const root = project ? path.resolve(projectDir) : os.homedir();

  try {
    if (argv.includes('--uninstall')) {
      const r = uninstallHooks(root);
      console.log(
        r.removed
          ? `Hooks do painel removidos de ${r.settingsPath} (${r.removed} entradas).`
          : `Nenhum hook do painel encontrado em ${r.settingsPath}.`
      );
      return 0;
    }

    const r = installHooksFromSource(root, __HOOK_SOURCE__, project ? 'project' : 'global');
    console.log(r.alreadyConfigured ? `Hooks já estavam configurados em ${r.settingsPath}; hook.js atualizado.` : `Hooks instalados em ${r.settingsPath}.`);
    console.log(`Hook: ${r.hookScriptPath}`);
    console.log(
      project
        ? 'Vale só para este projeto. Reinicie o Claude Code nele para ativar.'
        : 'Vale para todos os projetos. Reinicie o Claude Code para ativar.'
    );
    return 0;
  } catch (err) {
    console.error(`Não foi possível ${argv.includes('--uninstall') ? 'remover' : 'instalar'}: ${(err as Error).message}`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
