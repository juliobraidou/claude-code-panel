const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

function copyHookScript() {
  fs.mkdirSync('dist', { recursive: true });
  fs.copyFileSync(
    path.join('src', 'hook-template', 'hook.js'),
    path.join('dist', 'hook.js')
  );
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const panelConfig = {
  entryPoints: ['src/panel/index.tsx'],
  bundle: true,
  outfile: 'dist/panel.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

async function run() {
  copyHookScript();
  if (watch) {
    const ctxExt = await esbuild.context(extensionConfig);
    const ctxPanel = await esbuild.context(panelConfig);
    await ctxExt.watch();
    await ctxPanel.watch();
    console.log('Watching for changes... (hook.js copiado para dist/)');
  } else {
    await esbuild.build(extensionConfig);
    await esbuild.build(panelConfig);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
