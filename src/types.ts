// Formato dos eventos que o Claude Code envia via hooks (JSON no stdin do hook.js,
// repassado ao servidor local por HTTP). Campos conforme a documentação de hooks
// do Claude Code: https://docs.claude.com/en/docs/claude-code/hooks
export interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name: string; // PreToolUse | PostToolUse | Notification | Stop | SubagentStop | UserPromptSubmit | PreCompact
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  message?: string;
  // Só no evento Stop: última mensagem do Claude, extraída do histórico pelo hook.js.
  last_message?: string;
  [key: string]: unknown;
}

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  id: string;
  text: string;
  status: PlanItemStatus;
}

export type ActionKind =
  | 'read'
  | 'edit'
  | 'write'
  | 'create'
  | 'command'
  | 'search'
  | 'other';

export type ActionStatus = 'running' | 'done' | 'error';

export interface DiffLine {
  kind: 'add' | 'remove' | 'context';
  text: string;
}

export interface TimelineAction {
  id: string;
  kind: ActionKind;
  toolName: string;
  label: string; // ex: "Editou Header.tsx"
  filePath?: string;
  command?: string;
  diff?: DiffLine[];
  addedLines?: number;
  removedLines?: number;
  startedAt: number;
  finishedAt?: number;
  status: ActionStatus;
}

// Um plano/trabalho anterior guardado para revisão: a checklist final e o resumo.
export interface HistoryEntry {
  id: string;
  title: string;
  items: PlanItem[];
  source?: 'plan' | 'todo';
  summary?: { text: string; at: number };
  archivedAt: number;
}

export interface PanelState {
  planItems: PlanItem[];
  // De onde veio a checklist: 'plan' = extraída do texto do plano (ExitPlanMode),
  // 'todo' = lista real do Claude (TodoWrite), que sempre tem prioridade.
  planSource?: 'plan' | 'todo';
  // Quantas ações (edições, comandos) rodaram depois do plano aprovado; base da
  // estimativa quando o Claude não cria uma lista própria.
  planActions?: number;
  // Ações (edições, comandos) do turno atual; zera a cada mensagem sua. Serve para saber
  // se o Claude realmente trabalhou neste turno antes de tratar a resposta como resumo.
  turnActions?: number;
  // Mensagem final do Claude quando terminou um turno de trabalho com um plano na tela.
  summary?: { text: string; at: number };
  // Trabalhos anteriores, do mais recente para o mais antigo. Sobrevive ao /clear.
  history: HistoryEntry[];
  actions: TimelineAction[];
  running: boolean;
  lastUpdated: number;
  notification?: string;
}

// O que sobrevive a fechar o VS Code: o plano na tela, o resumo e o histórico. Ações,
// "rodando" e avisos são do momento e não fazem sentido depois de reabrir.
export type PersistedState = Pick<PanelState, 'planItems' | 'planSource' | 'planActions' | 'summary' | 'history'>;

export function createEmptyState(history: HistoryEntry[] = []): PanelState {
  return {
    planItems: [],
    history,
    actions: [],
    running: false,
    lastUpdated: Date.now(),
  };
}
