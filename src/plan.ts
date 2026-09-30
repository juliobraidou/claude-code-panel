import { PlanItem } from './types';

const MAX_ITEMS = 12;
const MAX_TEXT = 110;

function cleanText(raw: string): string {
  let text = raw
    .replace(/\*\*(.+?)\*\*/g, '$1') // negrito
    .replace(/__(.+?)__/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/`([^`]+)`/g, '$1') // código inline
    .replace(/^\[[ xX]\]\s*/, '') // checkbox markdown
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:：]$/, '');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 1).trimEnd() + '…';
  return text;
}

function toItems(texts: string[]): PlanItem[] {
  return texts
    .map(cleanText)
    .filter((t) => t.length > 0)
    .slice(0, MAX_ITEMS)
    .map((text, idx) => ({ id: `plan-${idx}`, text, status: 'pending' as const }));
}

// Extrai os passos de um plano em markdown (o texto que o Claude manda no ExitPlanMode).
// Ordem de preferência: lista numerada no nível raiz > bullets no nível raiz > títulos ##/###.
// Sub-itens (indentados) são ignorados de propósito: são detalhe de um passo, não uma fase.
export function parsePlanToItems(plan: unknown): PlanItem[] {
  if (typeof plan !== 'string' || !plan.trim()) return [];
  const lines = plan.split('\n');

  const numbered: string[] = [];
  const bullets: string[] = [];
  const headings: string[] = [];

  for (const line of lines) {
    const num = line.match(/^(\s{0,1})\d+[.)]\s+(.+)$/);
    if (num) {
      numbered.push(num[2]);
      continue;
    }
    const bullet = line.match(/^(\s{0,1})[-*+]\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[2]);
      continue;
    }
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) headings.push(heading[1]);
  }

  if (numbered.length >= 2) return toItems(numbered);
  if (bullets.length >= 2) return toItems(bullets);
  if (headings.length >= 2) return toItems(headings);
  return toItems(numbered.length ? numbered : bullets.length ? bullets : headings);
}

// Nome do arquivo (sem pasta), aceitando caminhos Windows e Unix.
export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}
