import { applyHookEvent, archiveCurrent, deleteHistoryEntry, restoreState, toPersisted } from './state';
import { createEmptyState, HistoryEntry, HookPayload, PanelState, PersistedState, SessionInfo } from './types';

// Cada conversa do Claude Code (session_id) tem o próprio plano e resumo; o histórico
// "Anteriores" é um só. Sem isso, dois chats abertos no mesmo projeto misturavam planos.

const DEFAULT_SESSION = 'default';
const MAX_SESSIONS = 8;

interface Session {
  id: string;
  // Estado da sessão sem o histórico (o histórico fica no store).
  state: PanelState;
  label?: string;
  startedAt: number;
  lastPromptAt: number;
  lastEventAt: number;
}

export interface Store {
  sessions: Record<string, Session>;
  history: HistoryEntry[];
  // Sessão escolhida no painel. Vazio = segue a conversa em que você escreveu por último.
  selected?: string;
}

type PersistedSession = Omit<Session, 'state' | 'id'> & { state: Omit<PersistedState, 'history'> };
export interface PersistedStore {
  version: 2;
  history: HistoryEntry[];
  sessions: Record<string, PersistedSession>;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

// Aceita o formato atual (version 2) e o antigo (um estado só, de antes das sessões), que
// vira a sessão "default" para nada se perder na atualização.
export function createStore(saved?: unknown): Store {
  const s = saved as any;
  if (s && s.version === 2 && s.sessions && typeof s.sessions === 'object') {
    const history: HistoryEntry[] = Array.isArray(s.history) ? s.history : [];
    const sessions: Record<string, Session> = {};
    for (const [id, p] of Object.entries<any>(s.sessions)) {
      sessions[id] = {
        id,
        state: { ...restoreState(p?.state), history: [] },
        label: typeof p?.label === 'string' ? p.label : undefined,
        startedAt: Number(p?.startedAt) || Date.now(),
        lastPromptAt: Number(p?.lastPromptAt) || 0,
        lastEventAt: Number(p?.lastEventAt) || 0,
      };
    }
    return { sessions, history };
  }
  const legacy = restoreState(s);
  const hasContent = legacy.planItems.length > 0 || Boolean(legacy.summary);
  return {
    history: legacy.history,
    sessions: hasContent
      ? { [DEFAULT_SESSION]: { id: DEFAULT_SESSION, state: { ...legacy, history: [] }, startedAt: 0, lastPromptAt: 0, lastEventAt: 0 } }
      : {},
  };
}

// Limita o número de sessões guardadas. A que sai tem plano ou resumo arquivados em
// "Anteriores", como se um trabalho novo tivesse começado.
function prune(sessions: Record<string, Session>, history: HistoryEntry[]): { sessions: Record<string, Session>; history: HistoryEntry[] } {
  const list = Object.values(sessions).sort((a, b) => b.lastEventAt - a.lastEventAt);
  if (list.length <= MAX_SESSIONS) return { sessions, history };
  let nextHistory = history;
  for (const old of list.slice(MAX_SESSIONS)) nextHistory = archiveCurrent({ ...old.state, history: nextHistory });
  return { sessions: Object.fromEntries(list.slice(0, MAX_SESSIONS).map((s) => [s.id, s])), history: nextHistory };
}

export function applyEvent(store: Store, payload: HookPayload): Store {
  const id = typeof payload.session_id === 'string' && payload.session_id ? payload.session_id : DEFAULT_SESSION;
  const existing = store.sessions[id];
  const now = Date.now();
  const event = payload.hook_event_name;

  const next = applyHookEvent({ ...(existing?.state ?? createEmptyState()), history: store.history }, payload);
  const prompt = event === 'UserPromptSubmit' && typeof payload.prompt === 'string' ? payload.prompt : '';
  const session: Session = {
    id,
    state: { ...next, history: [] },
    label: existing?.label ?? (prompt.trim() ? truncate(prompt, 60) : undefined),
    startedAt: existing?.startedAt ?? now,
    lastPromptAt: event === 'UserPromptSubmit' ? now : existing?.lastPromptAt ?? now,
    lastEventAt: now,
  };
  const pruned = prune({ ...store.sessions, [id]: session }, next.history);
  // Você escreveu numa conversa: o painel volta a seguir a última conversa usada.
  return { sessions: pruned.sessions, history: pruned.history, selected: event === 'UserPromptSubmit' ? undefined : store.selected };
}

export function selectSession(store: Store, id: string | undefined): Store {
  return { ...store, selected: id && store.sessions[id] ? id : undefined };
}

export function deleteHistory(store: Store, id: string): Store {
  return { ...store, history: deleteHistoryEntry({ ...createEmptyState(), history: store.history }, id).history };
}

// "Limpar timeline": limpa as conversas da tela e mantém o histórico.
export function clearSessions(store: Store): Store {
  return { sessions: {}, history: store.history };
}

function labelOf(s: Session): string {
  if (s.label) return s.label;
  if (s.state.planItems[0]) return truncate(s.state.planItems[0].text, 60);
  const time = new Date(s.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Conversa das ${time}`;
}

// O que o painel mostra: o estado da sessão escolhida (ou da última em que você escreveu),
// o histórico e a lista de sessões para o seletor.
export function viewOf(store: Store): PanelState {
  const list = Object.values(store.sessions).sort((a, b) => b.lastPromptAt - a.lastPromptAt || b.lastEventAt - a.lastEventAt);
  const chosen = (store.selected && store.sessions[store.selected]) || list[0];
  const sessions: SessionInfo[] = list.map((s) => ({
    id: s.id,
    label: labelOf(s),
    running: s.state.running,
    lastActivity: s.lastEventAt,
  }));
  if (!chosen) return { ...createEmptyState(store.history), sessions, sessionAuto: true };
  return { ...chosen.state, history: store.history, sessions, sessionId: chosen.id, sessionAuto: !store.selected };
}

export function toPersistedStore(store: Store): PersistedStore {
  const sessions: Record<string, PersistedSession> = {};
  for (const s of Object.values(store.sessions)) {
    const { history: _history, ...state } = toPersisted(s.state);
    sessions[s.id] = { label: s.label, startedAt: s.startedAt, lastPromptAt: s.lastPromptAt, lastEventAt: s.lastEventAt, state };
  }
  return { version: 2, history: store.history, sessions };
}

// Mudou algo que é salvo? Compara por referência (o estado é imutável), sem serializar.
export function persistedChanged(a: Store | undefined, b: Store): boolean {
  if (!a || a.history !== b.history) return true;
  const ids = Object.keys(b.sessions);
  if (ids.length !== Object.keys(a.sessions).length) return true;
  return ids.some((id) => {
    const x = a.sessions[id]?.state;
    const y = b.sessions[id].state;
    return !x || x.planItems !== y.planItems || x.summary !== y.summary || x.planSource !== y.planSource || x.planActions !== y.planActions;
  });
}
