import * as http from 'http';
import { applyHookEvent, deleteHistoryEntry, resetState, restoreState } from './state';
import { HookPayload, PanelState, PersistedState } from './types';

export interface PanelServer {
  server: http.Server;
  port: number;
  getState: () => PanelState;
  deleteHistory: (id: string) => void;
  close: () => Promise<void>;
}

export interface StartServerOptions {
  preferredPort?: number;
  onStateChange?: (state: PanelState) => void;
  initialState?: Partial<PersistedState>;
}

const DEFAULT_PORT = 47893;
const MAX_PORT_ATTEMPTS = 20;

export function startServer(options: StartServerOptions = {}): Promise<PanelServer> {
  let state: PanelState = restoreState(options.initialState);
  const onStateChange = options.onStateChange;

  const server = http.createServer((req, res) => {
    // Só o hook.js e a própria extensão falam com este servidor, e nenhum dos dois é um
    // navegador. Sem cabeçalhos CORS, uma página aberta no navegador não consegue ler o
    // estado (que tem os resumos do Claude). O Host precisa ser local, contra DNS rebinding,
    // e o POST precisa ser JSON, o que obriga o navegador a um preflight que aqui falha.
    const host = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
      return;
    }
    if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'expected application/json' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/clear') {
      state = resetState(state.history);
      onStateChange?.(state);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/hook') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 5_000_000) {
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}') as HookPayload;
          state = applyHookEvent(state, payload);
          onStateChange?.(state);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    const preferred = options.preferredPort ?? DEFAULT_PORT;
    let attempt = 0;

    const tryListen = (port: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
          attempt += 1;
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        resolve({
          server,
          port: actualPort,
          getState: () => state,
          deleteHistory: (id) => {
            state = deleteHistoryEntry(state, id);
            onStateChange?.(state);
          },
          close: () => new Promise((res) => server.close(() => res())),
        });
      });
    };

    tryListen(preferred);
  });
}
