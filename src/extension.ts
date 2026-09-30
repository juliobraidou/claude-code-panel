import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { installHooks, writePortFile } from './installHooks';
import { startServer, PanelServer } from './server';
import { PanelState } from './types';

let panelServer: PanelServer | undefined;
const STATE_KEY = 'claudeCodePanel.state';
let currentProvider: ClaudeCodePanelProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const provider = new ClaudeCodePanelProvider(context);
  currentProvider = provider;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeCodePanel.view', provider)
  );

  await bootServer(context, provider);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodePanel.installHooks', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage('Abra uma pasta de projeto antes de instalar os hooks.');
        return;
      }
      const hookTemplatePath = context.asAbsolutePath(path.join('dist', 'hook.js'));
      try {
        const result = installHooks(folder.uri.fsPath, hookTemplatePath, 'project');
        if (panelServer) {
          writePortFile(folder.uri.fsPath, panelServer.port);
        }
        vscode.window.showInformationMessage(
          result.alreadyConfigured
            ? 'Hooks já estavam configurados neste projeto.'
            : `Hooks instalados em ${vscode.workspace.asRelativePath(result.settingsPath)}. Reinicie o Claude Code neste projeto para ativar.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Falha ao instalar hooks: ${String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodePanel.installHooksGlobally', async () => {
      const hookTemplatePath = context.asAbsolutePath(path.join('dist', 'hook.js'));
      try {
        const result = installHooks(os.homedir(), hookTemplatePath, 'global');
        vscode.window.showInformationMessage(
          result.alreadyConfigured
            ? 'Hooks globais já estavam configurados.'
            : `Hooks instalados em ${result.settingsPath}. Valem para qualquer projeto que você abrir a partir de agora — não precisa repetir por projeto.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Falha ao instalar hooks globais: ${String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      if (!panelServer) return;
      for (const folder of event.added) {
        try {
          writePortFile(folder.uri.fsPath, panelServer.port);
        } catch {
          // pasta pode ser somente leitura; não é crítico.
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodePanel.clearTimeline', async () => {
      if (!panelServer) return;
      await fetch(`http://127.0.0.1:${panelServer.port}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {});
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodePanel.restartServer', async () => {
      await panelServer?.close();
      await bootServer(context, provider);
      vscode.window.showInformationMessage('Servidor do Claude Code Panel reiniciado.');
    })
  );
}

async function bootServer(context: vscode.ExtensionContext, provider: ClaudeCodePanelProvider) {
  // Salvo por projeto (workspaceState): cada pasta tem as próprias conversas e histórico.
  // O servidor só chama onPersist quando algo salvo mudou; "rodando" e ações não contam.
  panelServer = await startServer({
    initialState: context.workspaceState.get(STATE_KEY),
    onStateChange: (state) => provider.pushState(state),
    onPersist: (saved) => void context.workspaceState.update(STATE_KEY, saved),
  });

  // Publica a porta em cada pasta aberta, para o hook.js localizar o servidor.
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    try {
      writePortFile(folder.uri.fsPath, panelServer.port);
    } catch {
      // pasta pode ser somente leitura; não é crítico.
    }
  }

  provider.pushState(panelServer.getState());
}

export async function deactivate() {
  await panelServer?.close();
}

class ClaudeCodePanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(this.context.asAbsolutePath('dist'))],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'ready' && panelServer) {
        this.pushState(panelServer.getState());
      }
      if (message?.type === 'deleteHistory' && typeof message.id === 'string') {
        panelServer?.deleteHistory(message.id);
      }
      if (message?.type === 'selectSession') {
        panelServer?.selectSession(typeof message.id === 'string' ? message.id : undefined);
      }
      if (message?.type === 'openFile' && typeof message.filePath === 'string') {
        const uri = vscode.Uri.file(message.filePath);
        vscode.window.showTextDocument(uri).then(undefined, () => {
          vscode.window.showWarningMessage(`Não consegui abrir ${message.filePath}`);
        });
      }
    });
  }

  pushState(state: PanelState) {
    this.view?.webview.postMessage({ type: 'state', state });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(this.context.asAbsolutePath(path.join('dist', 'panel.js')))
    );
    const nonce = String(Date.now());
    return /* html */ `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
