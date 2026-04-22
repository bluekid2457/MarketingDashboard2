const WORKFLOW_CONTEXT_KEY = 'workflow_context';

export type WorkflowContext = {
  ideaId: string;
  angleId?: string;
  ideaTopic?: string;
};

export function getWorkflowContext(): WorkflowContext | null {
  try {
    const raw = localStorage.getItem(WORKFLOW_CONTEXT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkflowContext;
  } catch {
    return null;
  }
}

export function setWorkflowContext(context: WorkflowContext): void {
  try {
    localStorage.setItem(WORKFLOW_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // Ignore storage errors.
  }
}

export function clearWorkflowContext(): void {
  try {
    localStorage.removeItem(WORKFLOW_CONTEXT_KEY);
  } catch {
    // Ignore storage errors.
  }
}
