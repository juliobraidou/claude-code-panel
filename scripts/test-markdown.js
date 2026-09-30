// Renderiza o Markdown do painel para HTML estático e confere a estrutura, usando o texto
// de uma mensagem final real do Claude (a do print da API de usuários).
const esbuild = require('esbuild');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'panel', 'Markdown.tsx')],
  bundle: true,
  outfile: path.join(__dirname, '..', 'dist-test', 'markdown.js'),
  platform: 'node',
  format: 'cjs',
  external: ['react'],
  logLevel: 'error',
});

const { Markdown } = require(path.join(__dirname, '..', 'dist-test', 'markdown.js'));
const html = (source) => renderToStaticMarkup(React.createElement(Markdown, { source }));

function assert(cond, msg) {
  if (!cond) {
    console.error('FALHOU:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const message = [
  'Criei a API em `E:\\estudos\\extensao` e testei todos os endpoints.',
  '',
  '**Arquivos**',
  '',
  '- [src/server.js](src/server.js): ponto de entrada. Carrega o `.env`',
  '- `src/app.js`: configura o Express',
  '',
  '**Resultado dos testes**',
  '',
  '- `GET /` → 200',
  '- Cadastro válido → 201',
  '',
  '**Para rodar:** `npm install`, depois copie `.env.example`.',
  '',
  '```bash',
  'npm start',
  '```',
  '',
  '1. primeiro',
  '2. segundo',
].join('\n');

const out = html(message);
assert(/<code>E:\\estudos\\extensao<\/code>/.test(out), 'código inline com barra invertida é preservado');
assert((out.match(/md-heading/g) || []).length === 2, 'linhas só em negrito viram títulos (Arquivos, Resultado dos testes)');
assert(/<ul>.*<li>.*server\.js.*<\/li>/.test(out) && (out.match(/<li>/g) || []).length === 6, 'listas com marcador e numerada viram itens (2 + 2 + 2)');
assert(/<ol>/.test(out), 'lista numerada vira <ol>');
assert(/<pre class="md-code">npm start<\/pre>/.test(out), 'bloco de código vira <pre>');
assert(/md-link">src\/server\.js<\/span>/.test(out) && !/<a /.test(out), 'link vira só o texto, sem <a>');
assert(/<strong>Para rodar:<\/strong>/.test(out), 'negrito no meio de parágrafo é mantido');
assert(!/\*\*/.test(out.replace(/<[^>]+>/g, '')), 'nenhum ** sobra no texto');

const xss = html('<script>alert(1)</script> **ok**');
assert(!/<script>/.test(xss) && /&lt;script&gt;/.test(xss), 'HTML no texto é escapado, não executa');

{
  const out = html('Feito: seção no `README.md`.\nTestes: `npm test` passou.\nFalta: conferir o painel\ne o histórico.');
  assert((out.match(/<p>/g) || []).length === 3, 'Feito/Testes/Falta viram três parágrafos');
  assert(out.includes('<strong>Testes: </strong>') && out.includes('<code>npm test</code>'), 'rótulo em negrito e código inline mantido');
  assert(out.includes('conferir o painel e o histórico'), 'linha sem rótulo continua o parágrafo anterior');
  assert(!html('Uma frase normal e comprida: com dois-pontos no meio.').includes('<strong>'), 'dois-pontos depois de frase longa não vira rótulo');
}

console.log('\nTeste do markdown concluído.');
