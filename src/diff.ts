import { DiffLine } from './types';

// Diff de linhas simples (LCS), sem dependências externas.
// Suficiente para mostrar +/- no painel; não precisa ser um diff "de produção".
export function lineDiff(oldText: string, newText: string, maxLines = 40): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ kind: 'remove', text: a[i] });
      i++;
    } else {
      result.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: 'remove', text: a[i] });
    i++;
  }
  while (j < m) {
    result.push({ kind: 'add', text: b[j] });
    j++;
  }

  // Mantém só o entorno das mudanças, para não inundar o painel com contexto.
  const trimmed = trimContext(result, 2);
  return trimmed.slice(0, maxLines);
}

function trimContext(lines: DiffLine[], context: number): DiffLine[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((line, idx) => {
    if (line.kind !== 'context') {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        keep[k] = true;
      }
    }
  });
  const out: DiffLine[] = [];
  let lastKept = -2;
  lines.forEach((line, idx) => {
    if (keep[idx]) {
      out.push(line);
      lastKept = idx;
    }
  });
  return out.length ? out : lines.slice(0, 6);
}

export function countChanges(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === 'add') added++;
    if (line.kind === 'remove') removed++;
  }
  return { added, removed };
}
