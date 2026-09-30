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

// Instalador dos hooks em um arquivo só (release/install-hooks.js), com o hook.js embutido.
function cliConfig() {
  return {
    entryPoints: ['src/cli/install-hooks.ts'],
    bundle: true,
    outfile: 'release/install-hooks.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    define: { __HOOK_SOURCE__: JSON.stringify(fs.readFileSync(path.join('src', 'hook-template', 'hook.js'), 'utf8')) },
    logLevel: 'info',
  };
}

async function run() {
  copyHookScript();
  await esbuild.build(cliConfig());
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
