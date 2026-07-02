// Module-level tracker for in-flight email generation, keyed by workflow id.
// Lets generation keep running after the browser tab closes, and lets a returning
// tab poll progress. Mirrors the pipeline eventBuffer pattern.

interface GenState {
  workflowId: string;
  total: number;
  done: number;
  running: boolean;
  errors: string[];
  startedAt: number;
  finishedAt?: number;
}

const runs = new Map<string, GenState>();

export function startGen(workflowId: string, total: number): void {
  runs.set(workflowId, { workflowId, total, done: 0, running: true, errors: [], startedAt: Date.now() });
}

export function bumpGen(workflowId: string, error?: string): void {
  const s = runs.get(workflowId);
  if (!s) return;
  s.done += 1;
  if (error) s.errors.push(error);
}

export function finishGen(workflowId: string): void {
  const s = runs.get(workflowId);
  if (s) { s.running = false; s.finishedAt = Date.now(); }
}

export function getGen(workflowId: string): GenState | null {
  return runs.get(workflowId) ?? null;
}

export function isGenRunning(workflowId: string): boolean {
  return runs.get(workflowId)?.running ?? false;
}
