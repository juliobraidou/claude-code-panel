import * as React from 'react';

// Renderizador de markdown mínimo, sem dependências, só com o que aparece nas mensagens
// do Claude: títulos, negrito, `código`, listas, blocos de código e parágrafos.
// Tudo vira elemento React (nada de innerHTML), então o texto nunca executa como HTML.

// Linha que começa com um rótulo curto ("Feito:", "Testes:", "Falta:") abre um parágrafo
// próprio, com o rótulo em negrito: é o formato do resumo que o hook pede.
const LABEL = /^([A-ZÀ-Ý][\p{L} ]{0,18}):\s+(.*)$/u;

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return <span key={key} className="md-link">{link[1]}</span>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string; label?: string };

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// "| a | b |" -> ["a", "b"]. Um "\|" escapado fica dentro da célula.
function splitRow(line: string): string[] {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
  return cells.map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // fecha o bloco
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }

    // Tabela: linha com barras seguida da linha de separação (| --- | --- |).
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        const cells = splitRow(lines[i]);
        rows.push(header.map((_, k) => cells[k] ?? ''));
        i++;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] });
      i++;
      continue;
    }

    // Uma linha só em negrito ("**Arquivos**", "**Resultado dos testes**") é um título.
    const boldTitle = line.match(/^\s*\*\*([^*]+?)\*\*[:：]?\s*$/);
    if (boldTitle) {
      blocks.push({ kind: 'heading', text: boldTitle[1] });
      i++;
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered
          ? lines[i].match(/^\s*\d+[.)]\s+(.+)$/)
          : lines[i].match(/^\s*[-*+]\s+(.+)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const labeled = line.trim().match(LABEL);
    const paragraph: string[] = [];
    if (labeled) {
      paragraph.push(labeled[2]);
      i++;
    }
    while (
      i < lines.length &&
      !LABEL.test(lines[i].trim()) &&
      !(TABLE_ROW.test(lines[i]) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' '), label: labeled?.[1] });
  }

  return blocks;
}

export function Markdown({ source }: { source: string }) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);

  return (
    <div className="md">
      {blocks.map((block, idx) => {
        const key = `b${idx}`;
        switch (block.kind) {
          case 'heading':
            return <div key={key} className="md-heading">{renderInline(block.text, key)}</div>;
          case 'code':
            return <pre key={key} className="md-code">{block.text}</pre>;
          case 'table':
            return (
              <div key={key} className="md-table">
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, c) => (
                        <th key={c}>{renderInline(cell, `${key}-h${c}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c}>{renderInline(cell, `${key}-${r}-${c}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'list': {
            const items = block.items.map((item, j) => (
              <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
            ));
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          default:
            return (
              <p key={key}>
                {block.label && <strong>{block.label}: </strong>}
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
