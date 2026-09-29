import * as React from 'react';
import { PanelState } from '../types';
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

function PlanSection({ items, source }: { items: PanelState['planItems']; source: PanelState['planSource'] }) {
  if (!items.length) {
    return (
      <div className="empty">
        Nenhum plano ativo ainda. Assim que o Claude Code montar a lista de tarefas, as fases aparecem aqui.
      </div>
    );
  }
  const done = items.filter((i) => i.status === 'completed').length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <div className="plan">
      <div className="plan-header">
        <span>{source === 'plan' ? 'Plano (estimado)' : 'Plano'}</span>
        <span>{done} de {items.length}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <ul className="plan-list">
        {items.map((item) => (
          <li key={item.id} className={`plan-item plan-item--${item.status}`}>
            <span className="plan-item-icon">
              {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}
            </span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
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

      {state.notification && <div className="notification">{state.notification}</div>}

      <PlanSection items={state.planItems} source={state.planSource} />

      {state.summary && <SummarySection summary={state.summary} />}
    </div>
  );
}
