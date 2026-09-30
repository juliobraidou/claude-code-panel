import * as React from 'react';
import { HistoryEntry, PanelState } from '../types';
import { getVsCodeApi } from './vscodeApi';
import { Markdown } from './Markdown';

// O painel foca no plano (fases/checklist). A lista de ações já existe na
// extensão oficial do Claude Code, então aqui mostramos só uma linha com o
// que está rolando agora — sem repetir o histórico inteiro nem diffs.
function currentActivityLabel(state: PanelState): string | undefined {
  for (let i = state.actions.length - 1; i >= 0; i--) {
    if (state.actions[i].status === 'running') {
      return state.actions[i].label;
    }
  }
  return state.running ? 'Pensando…' : undefined;
}

function PlanList({ items }: { items: PanelState['planItems'] }) {
  return (
    <ul className="plan-list">
      {items.map((item) => (
        <li
          key={item.id}
          className={`plan-item plan-item--${item.status}`}
          title={item.status === 'unconfirmed' ? 'O turno terminou sem sinal deste passo: nenhum arquivo ou comando citado nele foi usado.' : undefined}
        >
          <span className="plan-item-icon">
            {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : item.status === 'unconfirmed' ? '?' : '○'}
          </span>
          <span>
            {item.text}
            {item.status === 'unconfirmed' && <span className="plan-item-tag">não confirmado</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanSection({ items, source }: { items: PanelState['planItems']; source: PanelState['planSource'] }) {
  if (!items.length) {
    return (
      <div className="empty">
        Nenhum plano ativo ainda. Assim que o Claude Code montar a lista de tarefas, as fases aparecem aqui.
      </div>
    );
  }
  const done = items.filter((i) => i.status === 'completed').length;
  const unconfirmed = items.filter((i) => i.status === 'unconfirmed').length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <div className="plan">
      <div className="plan-header">
        <span>{source === 'plan' ? 'Plano (estimado)' : 'Plano'}</span>
        <span>
          {done} de {items.length}
          {unconfirmed > 0 && <span className="plan-header-warn"> · {unconfirmed} sem confirmação</span>}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <PlanList items={items} />
    </div>
  );
}

// Resumo do trabalho: a mensagem final do Claude, mostrada embaixo do plano.
// Começa recolhido para não empurrar o plano para fora da tela; um clique expande.
function SummarySection({ summary }: { summary: NonNullable<PanelState['summary']> }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = summary.text.length > 500 || summary.text.split('\n').length > 12;

  return (
    <div className="summary">
      <div className="summary-header">Resumo</div>
      <div className={`summary-body ${long && !expanded ? 'summary-body--collapsed' : ''}`}>
        <Markdown source={summary.text} />
      </div>
      {long && (
        <button className="summary-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Mostrar menos' : 'Mostrar tudo'}
        </button>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5 1h3a.5.5 0 0 1 .5.5V3h3.5a.5.5 0 0 1 0 1H13v9.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V4h-.5a.5.5 0 0 1 0-1H6V1.5a.5.5 0 0 1 .5-.5ZM7 3h2V2H7v1ZM4 4v9.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V4H4Zm2.5 2a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5Zm3 0a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

// Um trabalho anterior: recolhido mostra só título e data; aberto mostra a checklist e o resumo.
function HistoryItem({ entry, onDelete }: { entry: HistoryEntry; onDelete: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const done = entry.items.filter((i) => i.status === 'completed').length;
  const when = new Date(entry.archivedAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="history-item">
      <div className="history-row">
        <button className="history-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="history-chevron">{open ? '▾' : '▸'}</span>
          <span className="history-title">{entry.title}</span>
          <span className="history-meta">
            {entry.items.length > 0 ? `${done}/${entry.items.length} · ` : ''}
            {when}
          </span>
        </button>
        <button className="history-delete" title="Excluir do histórico" aria-label="Excluir do histórico" onClick={() => onDelete(entry.id)}>
          <TrashIcon />
        </button>
      </div>
      {open && (
        <div className="history-body">
          {entry.items.length > 0 && <PlanList items={entry.items} />}
          {entry.summary && <SummarySection summary={entry.summary} />}
        </div>
      )}
    </div>
  );
}

// Aparece só com mais de uma conversa do Claude no projeto. "Seguir a última conversa" mostra
// sempre a conversa em que você escreveu por último; escolher uma fixa o painel nela.
function SessionPicker({ state }: { state: PanelState }) {
  const sessions = state.sessions ?? [];
  if (sessions.length < 2) return null;
  const choose = (id: string) => getVsCodeApi().postMessage({ type: 'selectSession', id: id || undefined });
  return (
    <div className="session-picker">
      <label htmlFor="session-select">Conversa</label>
      <select id="session-select" value={state.sessionAuto ? '' : state.sessionId ?? ''} onChange={(e) => choose(e.target.value)}>
        <option value="">Seguir a última conversa</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.running ? '● ' : ''}
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Sem acento e em minúsculas, para "revisao" achar "Revisão".
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function HistorySection({ history }: { history: HistoryEntry[] }) {
  const [query, setQuery] = React.useState('');
  const q = normalize(query.trim());
  // Busca no título, nos passos e no resumo de cada trabalho.
  const shown = q
    ? history.filter((h) => normalize([h.title, ...h.items.map((i) => i.text), h.summary?.text ?? ''].join(' ')).includes(q))
    : history;

  return (
    <div className="history">
      <div className="history-header">Anteriores</div>
      {history.length >= 4 && (
        <input
          id="history-search"
          className="history-search"
          type="search"
          placeholder="Buscar nos trabalhos anteriores"
          aria-label="Buscar nos trabalhos anteriores"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {shown.map((entry) => (
        <HistoryItem key={entry.id} entry={entry} onDelete={(id) => getVsCodeApi().postMessage({ type: 'deleteHistory', id })} />
      ))}
      {q && shown.length === 0 && <div className="empty">Nada encontrado para "{query.trim()}".</div>}
    </div>
  );
}

export function App() {
  const [state, setState] = React.useState<PanelState | null>(null);

  React.useEffect(() => {
    const vscode = getVsCodeApi();
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'state') {
        setState(msg.state as PanelState);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  if (!state) {
    return <div className="empty">Conectando ao Claude Code…</div>;
  }

  const activity = currentActivityLabel(state);

  return (
    <div className="panel">
      <div className="status-bar">
        <span className={`status-dot ${state.running ? 'status-dot--running' : ''}`} />
        <span className="status-text">{state.running ? activity ?? 'Executando' : 'Ocioso'}</span>
      </div>

      <SessionPicker state={state} />

      {state.notification && <div className="notification">{state.notification}</div>}

      <PlanSection items={state.planItems} source={state.planSource} />

      {state.summary && <SummarySection summary={state.summary} />}

      {state.history?.length > 0 && <HistorySection history={state.history} />}
    </div>
  );
}
