// Empacota os módulos que não dependem do "vscode" (servidor, estado, diff, instalação dos
// hooks), para poder testá-los isoladamente com node puro.
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: { server: 'src/server.ts', installHooks: 'src/installHooks.ts', diff: 'src/diff.ts' },
    bundle: true,
    outdir: 'dist-test',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    logLevel: 'info',
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
