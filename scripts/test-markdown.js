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

{
  // A tabela do print: antes virava texto corrido com as barras.
  const out = html(['Antes da tabela.', '', '| Medida | Antes | Agora |', '|---|---|---|', '| Sessões | 20 | 21 |', '| **Custo** | US$ 0,007 | `US$ 0,009` |', '| a \\| b | só uma |', '', 'Depois.'].join('\n'));
  assert(out.includes('<table>') && (out.match(/<tr>/g) || []).length === 4, 'tabela markdown vira <table> com cabeçalho e 3 linhas');
  assert(out.includes('<th>Medida</th>') && out.includes('<strong>Custo</strong>') && out.includes('<code>US$ 0,009</code>'), 'células com negrito e código inline');
  assert(out.includes('<td>a | b</td>') && out.includes('<td></td>'), 'barra escapada fica na célula e linha curta é completada');
  assert(!out.includes('|---|') && out.includes('<p>Depois.</p>'), 'texto depois da tabela continua normal');
  assert(!html('| só uma linha com barras |').includes('<table>'), 'sem linha de separação não é tabela');
  assert(html('Texto colado:\n| a | b |\n|---|---|\n| 1 | 2 |').includes('<table>'), 'tabela colada num parágrafo (sem linha em branco) também vira tabela');
}

console.log('\nTeste do markdown concluído.');
