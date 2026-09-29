import * as http from 'http';
import { applyHookEvent, resetState } from './state';
import { HookPayload, PanelState } from './types';

export interface PanelServer {
  server: http.Server;
  port: number;
  getState: () => PanelState;
  close: () => Promise<void>;
}

export interface StartServerOptions {
  preferredPort?: number;
  onStateChange?: (state: PanelState) => void;
}

const DEFAULT_PORT = 47893;
const MAX_PORT_ATTEMPTS = 20;

export function startServer(options: StartServerOptions = {}): Promise<PanelServer> {
  let state: PanelState = resetState();
  const onStateChange = options.onStateChange;

  const server = http.createServer((req, res) => {
    // Só aceita conexões locais; nada disso deve sair da máquina do usuário.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
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
      state = resetState();
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
          close: () => new Promise((res) => server.close(() => res())),
        });
      });
    };

    tryListen(preferred);
  });
}
