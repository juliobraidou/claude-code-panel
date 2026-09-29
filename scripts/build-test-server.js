// Empacota só o servidor (server.ts + state.ts + diff.ts + types.ts), que não depende
// do módulo "vscode", para poder testá-lo isoladamente com node puro.
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['src/server.ts'],
    bundle: true,
    outfile: 'dist-test/server.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    logLevel: 'info',
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
