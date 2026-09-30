import { countChanges, lineDiff } from './diff';
import { baseName, parsePlanToItems } from './plan';
import {
  ActionKind,
  HistoryEntry,
  HookPayload,
  PanelState,
  PersistedState,
  PlanItem,
  TimelineAction,
  createEmptyState,
} from './types';

const MAX_ACTIONS = 200;
const MAX_HISTORY = 30;
let counter = 0;
function nextId(): string {
  counter += 1;
  return `a${Date.now()}_${counter}`;
}

// Primeira linha com texto do resumo, sem marcação de markdown, para servir de título.
function titleFromSummary(text: string): string {
  const line = text.split('\n').find((l) => l.replace(/[#*_`>\-\s]/g, '').length > 0) ?? '';
  return truncate(line.replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, ''), 70);
}

// Guarda o trabalho que está na tela no histórico. Um plano proposto e nunca iniciado
// (rejeitado ou substituído) não vale guardar; um que rodou ou ganhou resumo, sim.
export function archiveCurrent(state: PanelState): HistoryEntry[] {
  const history = state.history ?? [];
  const started = state.planItems.some((i) => i.status !== 'pending');
  if (!state.summary && (state.planItems.length === 0 || !started)) return history;
  const entry: HistoryEntry = {
    id: nextId(),
    title: state.planItems.length > 0 ? truncate(state.planItems[0].text, 70) : titleFromSummary(state.summary!.text),
    items: state.planItems,
    source: state.planSource,
    summary: state.summary,
    archivedAt: Date.now(),
  };
  return [entry, ...history].slice(0, MAX_HISTORY);
}

export function deleteHistoryEntry(state: PanelState, id: string): PanelState {
  return { ...state, history: (state.history ?? []).filter((h) => h.id !== id), lastUpdated: Date.now() };
}

function shortPath(filePath: unknown): string {
  if (typeof filePath !== 'string') return '';
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
}

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

function kindForTool(toolName: string): ActionKind {
  switch (toolName) {
    case 'Read':
      return 'read';
    case 'Grep':
    case 'Glob':
      return 'search';
    case 'Edit':
    case 'MultiEdit':
      return 'edit';
    case 'Write':
      return 'write';
    case 'Bash':
      return 'command';
    default:
      return 'other';
  }
}

function labelForStart(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return `Lendo ${shortPath(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editando ${shortPath(input.file_path)}`;
    case 'Write':
      return `Escrevendo ${shortPath(input.file_path)}`;
    case 'Grep':
      return `Buscando "${truncate(String(input.pattern ?? ''), 40)}"`;
    case 'Glob':
      return `Procurando arquivos "${truncate(String(input.pattern ?? ''), 40)}"`;
    case 'Bash':
      return `Rodando ${truncate(String(input.command ?? ''), 60)}`;
    case 'Task':
      return `Subagente: ${truncate(String(input.description ?? ''), 60)}`;
    case 'WebFetch':
    case 'WebSearch':
      return `Pesquisando na web`;
    case 'ExitPlanMode':
      return 'Plano proposto';
    default:
      return `Executando ${toolName}`;
  }
}

function labelForFinish(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return `Leu ${shortPath(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editou ${shortPath(input.file_path)}`;
    case 'Write':
      return `Escreveu ${shortPath(input.file_path)}`;
    case 'Grep':
      return `Buscou "${truncate(String(input.pattern ?? ''), 40)}"`;
    case 'Glob':
      return `Procurou arquivos "${truncate(String(input.pattern ?? ''), 40)}"`;
    case 'Bash':
      return `Rodou ${truncate(String(input.command ?? ''), 60)}`;
    case 'Task':
      return `Subagente concluído: ${truncate(String(input.description ?? ''), 60)}`;
    case 'WebFetch':
    case 'WebSearch':
      return `Pesquisou na web`;
    case 'ExitPlanMode':
      return 'Plano aprovado';
    default:
      return `${toolName} concluído`;
  }
}

function buildDiffForEdit(input: Record<string, unknown>): TimelineAction['diff'] {
  const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
  const newStr = typeof input.new_string === 'string' ? input.new_string : '';
  if (!oldStr && !newStr) return undefined;
  return lineDiff(oldStr, newStr);
}

function buildDiffForWrite(input: Record<string, unknown>): TimelineAction['diff'] {
  const content = typeof input.content === 'string' ? input.content : '';
  if (!content) return undefined;
  // Não temos o conteúdo anterior no payload do hook; mostramos como um arquivo novo.
  return lineDiff('', content, 24);
}

function planItemsFromTodos(todos: unknown): PlanItem[] | undefined {
  // Lista vazia (o Claude "limpando" os todos) não deve apagar o plano que está na tela.
  if (!Array.isArray(todos) || todos.length === 0) return undefined;
  return todos.map((t: any, idx: number) => ({
    id: String(idx),
    text: String(t?.content ?? t?.activeForm ?? ''),
    status: (t?.status === 'completed' || t?.status === 'in_progress' ? t.status : 'pending') as
      | 'pending'
      | 'in_progress'
      | 'completed',
  }));
}

// A lista terminou: não há passo pendente nem em andamento (concluídos ou não confirmados).
export function isFinished(items: PlanItem[]): boolean {
  return items.length > 0 && items.every((i) => i.status === 'completed' || i.status === 'unconfirmed');
}

// Parte do comando que identifica o que foi rodado: antes de pipe, &&, ; e sem redirecionamentos
// ("npm test 2>&1 | grep ok" -> "npm test"). Tira um "cd pasta &&" do começo.
function commandCore(command: string): string {
  const segments = command.split(/\|\||&&|;|\|/).map((s) => s.trim()).filter(Boolean);
  const main = segments.find((s) => !/^cd\s/.test(s)) ?? '';
  return main.replace(/\s+\d?>>?\s*\S+/g, '').replace(/\s+\d?>&\d/g, '').trim().toLowerCase();
}

// Aplica um evento de hook ao estado e devolve um novo estado (imutável).
export function applyHookEvent(state: PanelState, payload: HookPayload): PanelState {
  let next = applyPlanLogic(applyBase(state, payload), payload);
  const event = payload.hook_event_name;

  // Resumo: a mensagem final do Claude vira o resumo quando ele trabalhou (editou, rodou
  // comando) neste turno, com ou sem plano na tela. Uma resposta de conversa não mexe no
  // resumo. O resumo anterior não se perde: vai para o histórico.
  if (event === 'UserPromptSubmit') {
    const planDone = isFinished(next.planItems);
    next = { ...next, turnActions: 0, planDoneBeforeTurn: planDone };
  }
  if (event === 'PostToolUse' && ACTION_TOOLS.has(payload.tool_name ?? '')) {
    next = { ...next, turnActions: (next.turnActions ?? 0) + 1 };
  }
  if (
    event === 'Stop' &&
    typeof payload.last_message === 'string' &&
    payload.last_message.trim() &&
    (next.turnActions ?? 0) > 0
  ) {
    // Plano concluído num turno anterior: vai para o histórico com o resumo dele e sai da
    // tela, porque o trabalho novo não é dele. Plano em andamento fica na tela e só o resumo
    // antigo é arquivado (com título tirado do próprio texto), para não repetir o plano.
    const closePlan = Boolean(next.planDoneBeforeTurn) && next.planItems.length > 0;
    let history = next.history;
    if (closePlan) history = archiveCurrent(next);
    else if (next.summary) history = archiveCurrent({ ...next, planItems: [] });
    next = {
      ...next,
      history,
      ...(closePlan ? { planItems: [], planSource: undefined, planActions: 0 } : {}),
      planDoneBeforeTurn: false,
      summary: { text: payload.last_message.trim(), at: Date.now() },
      // Um segundo Stop no mesmo turno não repete o resumo.
      turnActions: 0,
    };
  }

  // O aviso "precisa de permissão" só vale enquanto o Claude espera. Se voltou a rodar
  // ferramentas (ou terminou), já foi respondido e não deve ficar preso na tela.
  if (next.notification && (event === 'PreToolUse' || event === 'PostToolUse' || event === 'Stop')) {
    next = { ...next, notification: undefined };
  }
  return next;
}

const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);
// Ferramentas que contam como "trabalho de verdade" depois da aprovação do plano.
const ACTION_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash']);
// Ferramentas de lista de tarefas do Claude Code: alimentam a checklist e não viram
// linha de ação. TodoWrite é a versão antiga; TaskCreate/TaskUpdate as atuais.
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']);

// Lê o número da tarefa da resposta do TaskCreate ("Task #3 created successfully: ...").
function extractTaskId(response: unknown): string | undefined {
  let text = '';
  try {
    text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
  } catch {
    return undefined;
  }
  const match = text.match(/Task\s+#(\d+)/i) ?? text.match(/#(\d+)/);
  return match ? match[1] : undefined;
}

function applyTaskTool(
  state: PanelState,
  toolName: string,
  input: Record<string, unknown>,
  response: unknown
): PanelState {
  if (toolName === 'TaskCreate') {
    const subject = typeof input.subject === 'string' ? truncate(input.subject, 110) : '';
    if (!subject) return state;

    // A primeira tarefa criada assume o lugar do plano semeado pelo ExitPlanMode. Se a
    // lista anterior já estava toda concluída, é trabalho novo: começa uma lista limpa.
    const previousDone = isFinished(state.planItems);
    const items = state.planSource === 'todo' && !previousDone ? state.planItems : [];

    const numericIds = items.map((i) => Number(i.id)).filter((n) => Number.isFinite(n));
    const id = extractTaskId(response) ?? String((numericIds.length ? Math.max(...numericIds) : 0) + 1);
    if (items.some((i) => i.id === id)) return state;

    return {
      ...state,
      history: previousDone ? archiveCurrent(state) : state.history,
      planItems: [...items, { id, text: subject, status: 'pending' }],
      planSource: 'todo',
      // Lista limpa = trabalho novo, então o resumo antigo sai. Ao só acrescentar tarefas
      // na lista atual, o resumo (que ainda não existe ou é do plano em andamento) fica.
      summary: items.length === 0 ? undefined : state.summary,
      lastUpdated: Date.now(),
    };
  }

  if (toolName === 'TaskUpdate') {
    const id = input.taskId !== undefined && input.taskId !== null ? String(input.taskId) : '';
    const idx = state.planItems.findIndex((i) => i.id === id);
    if (idx === -1) return state;

    const items = state.planItems.slice();
    if (input.status === 'deleted') {
      items.splice(idx, 1);
    } else {
      const current = items[idx];
      const status =
        input.status === 'completed' || input.status === 'in_progress' || input.status === 'pending'
          ? input.status
          : current.status;
      const text = typeof input.subject === 'string' && input.subject.trim() ? truncate(input.subject, 110) : current.text;
      items[idx] = { ...current, text, status };
    }
    return { ...state, planItems: items, lastUpdated: Date.now() };
  }

  return state;
}

// Lógica do plano. O texto do ExitPlanMode vira checklist. Quando o Claude cria a própria
// lista (TodoWrite ou TaskCreate/TaskUpdate), ela assume e é a fonte precisa do progresso.
// Enquanto isso não acontece, o progresso é estimado (arquivos editados e fim do turno).
function applyPlanLogic(state: PanelState, payload: HookPayload): PanelState {
  const event = payload.hook_event_name;
  const toolName = payload.tool_name ?? '';
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;

  if (toolName === 'ExitPlanMode' && event === 'PreToolUse') {
    const items = parsePlanToItems(input.plan);
    if (items.length === 0) return state;
    // Plano novo: o resumo do trabalho anterior não vale mais.
    return {
      ...state,
      history: archiveCurrent(state),
      planItems: items,
      planSource: 'plan',
      summary: undefined,
      lastUpdated: Date.now(),
    };
  }

  if (event === 'PostToolUse' && (toolName === 'TaskCreate' || toolName === 'TaskUpdate')) {
    return applyTaskTool(state, toolName, input, payload.tool_response);
  }

  if (state.planSource !== 'plan') return state;

  // Plano aprovado: o primeiro passo começa.
  if (toolName === 'ExitPlanMode' && event === 'PostToolUse') {
    if (state.planItems.some((i) => i.status !== 'pending')) return state;
    const planItems = state.planItems.map((item, idx) =>
      idx === 0 ? { ...item, status: 'in_progress' as const } : item
    );
    return { ...state, planItems, planActions: 0, lastUpdated: Date.now() };
  }

  // A partir daqui só vale depois da aprovação (primeiro passo já saiu de "pendente").
  const approved = state.planItems.some((i) => i.status !== 'pending');
  if (!approved) return state;

  let next = state;

  if (event === 'PostToolUse' && ACTION_TOOLS.has(toolName)) {
    next = { ...next, planActions: (next.planActions ?? 0) + 1 };
  }

  // Evidência: editar um arquivo citado num passo, ou rodar um comando citado nele, marca
  // esse passo como em andamento (com evidência) e conclui os anteriores, porque o plano
  // costuma ser sequencial.
  let matcher: ((text: string) => boolean) | undefined;
  if (event === 'PostToolUse' && FILE_TOOLS.has(toolName) && typeof input.file_path === 'string') {
    const name = baseName(input.file_path).toLowerCase();
    matcher = (text) => text.includes(name);
  }
  if (event === 'PostToolUse' && toolName === 'Bash' && typeof input.command === 'string') {
    const core = commandCore(input.command);
    if (core.length >= 4) matcher = (text) => text.includes(core);
  }
  if (matcher) {
    const idx = next.planItems.findIndex((item) => item.status !== 'completed' && matcher!(item.text.toLowerCase()));
    if (idx !== -1) {
      const planItems = next.planItems.map((item, i) => {
        if (i < idx) return { ...item, status: 'completed' as const };
        if (i === idx) return { ...item, status: 'in_progress' as const, seen: true };
        return item;
      });
      next = { ...next, planItems, lastUpdated: Date.now() };
    }
  }

  // Fim do turno depois de executar coisas do plano: o passo com evidência conta como feito.
  // Os passos sem nenhuma evidência não são marcados como feitos: ficam "não confirmados",
  // para o painel não afirmar o que não viu. Uma evidência num turno seguinte corrige.
  if (event === 'Stop' && (next.planActions ?? 0) > 0 && next.planItems.some((i) => i.status === 'pending' || i.status === 'in_progress')) {
    const planItems = next.planItems.map((item) => {
      if (item.status === 'completed' || item.status === 'unconfirmed') return item;
      return { ...item, status: item.seen ? ('completed' as const) : ('unconfirmed' as const) };
    });
    next = { ...next, planItems, lastUpdated: Date.now() };
  }

  return next;
}

function applyBase(state: PanelState, payload: HookPayload): PanelState {
  const event = payload.hook_event_name;
  const toolName = payload.tool_name ?? '';
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;

  switch (event) {
    case 'UserPromptSubmit':
      return { ...state, running: true, lastUpdated: Date.now(), notification: undefined };

    case 'PreToolUse': {
      if (toolName === 'TodoWrite') {
        const items = planItemsFromTodos(input.todos);
        return {
          ...state,
          planItems: items ?? state.planItems,
          planSource: items ? 'todo' : state.planSource,
          running: true,
          lastUpdated: Date.now(),
        };
      }

      if (TASK_TOOLS.has(toolName)) {
        return { ...state, running: true, lastUpdated: Date.now() };
      }

      const action: TimelineAction = {
        id: nextId(),
        kind: kindForTool(toolName),
        toolName,
        label: labelForStart(toolName, input),
        filePath: typeof input.file_path === 'string' ? input.file_path : undefined,
        command: typeof input.command === 'string' ? input.command : undefined,
        startedAt: Date.now(),
        status: 'running',
      };

      const actions = [...state.actions, action].slice(-MAX_ACTIONS);
      return { ...state, actions, running: true, lastUpdated: Date.now() };
    }

    case 'PostToolUse': {
      if (toolName === 'TodoWrite') {
        const items = planItemsFromTodos(input.todos);
        return {
          ...state,
          planItems: items ?? state.planItems,
          planSource: items ? 'todo' : state.planSource,
          lastUpdated: Date.now(),
        };
      }

      if (TASK_TOOLS.has(toolName)) {
        return { ...state, lastUpdated: Date.now() };
      }

      const idx = findLastRunningIndex(state.actions, toolName);
      if (idx === -1) {
        // Não vimos o PreToolUse (ex.: extensão iniciada no meio de uma sessão).
        // Criamos a ação já concluída.
        const action: TimelineAction = {
          id: nextId(),
          kind: kindForTool(toolName),
          toolName,
          label: labelForFinish(toolName, input),
          filePath: typeof input.file_path === 'string' ? input.file_path : undefined,
          command: typeof input.command === 'string' ? input.command : undefined,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          status: 'done',
          diff: toolName === 'Edit' || toolName === 'MultiEdit' ? buildDiffForEdit(input) : toolName === 'Write' ? buildDiffForWrite(input) : undefined,
        };
        if (action.diff) {
          const { added, removed } = countChanges(action.diff);
          action.addedLines = added;
          action.removedLines = removed;
        }
        const actions = [...state.actions, action].slice(-MAX_ACTIONS);
        return { ...state, actions, lastUpdated: Date.now() };
      }

      const actions = state.actions.slice();
      const prev = actions[idx];
      const diff =
        toolName === 'Edit' || toolName === 'MultiEdit'
          ? buildDiffForEdit(input)
          : toolName === 'Write'
          ? buildDiffForWrite(input)
          : undefined;
      const isError = Boolean((payload.tool_response as any)?.is_error);
      const updated: TimelineAction = {
        ...prev,
        label: labelForFinish(toolName, input),
        finishedAt: Date.now(),
        status: isError ? 'error' : 'done',
        diff,
      };
      if (diff) {
        const { added, removed } = countChanges(diff);
        updated.addedLines = added;
        updated.removedLines = removed;
      }
      actions[idx] = updated;
      return { ...state, actions, lastUpdated: Date.now() };
    }

    case 'Notification':
      return {
        ...state,
        notification: typeof payload.message === 'string' ? payload.message : undefined,
        lastUpdated: Date.now(),
      };

    case 'Stop':
    case 'SubagentStop':
      return { ...state, running: false, lastUpdated: Date.now() };

    default:
      return { ...state, lastUpdated: Date.now() };
  }
}

function findLastRunningIndex(actions: TimelineAction[], toolName: string): number {
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].toolName === toolName && actions[i].status === 'running') {
      return i;
    }
  }
  return -1;
}

export function toPersisted(state: PanelState): PersistedState {
  return {
    planItems: state.planItems,
    planSource: state.planSource,
    planActions: state.planActions,
    summary: state.summary,
    history: state.history,
  };
}

export function restoreState(saved: Partial<PersistedState> | undefined): PanelState {
  const empty = resetState(Array.isArray(saved?.history) ? saved!.history : []);
  if (!saved) return empty;
  return {
    ...empty,
    planItems: Array.isArray(saved.planItems) ? saved.planItems : [],
    planSource: saved.planSource,
    planActions: saved.planActions,
    summary: saved.summary,
  };
}

export function resetState(history: HistoryEntry[] = []): PanelState {
  counter = 0;
  return createEmptyState(history);
}
