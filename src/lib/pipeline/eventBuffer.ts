// In-process ring buffer — survives browser disconnects as long as the Node process lives.
// New SSE connections can replay buffered events and then subscribe to live ones.

const MAX = 600;

interface BufferedRun {
  runId: string;
  startedAt: number;
  events: any[];
  done: boolean;
  listeners: Set<(e: any) => void>;
}

let current: BufferedRun | null = null;

export function startBuffer(runId: string) {
  current = { runId, startedAt: Date.now(), events: [], done: false, listeners: new Set() };
}

export function pushEvent(event: any) {
  if (!current) return;
  current.events.push(event);
  if (current.events.length > MAX) current.events.shift();
  for (const fn of current.listeners) fn(event);
}

export function finishBuffer() {
  if (current) current.done = true;
}

export function getBuffer() {
  return current ? { runId: current.runId, startedAt: current.startedAt, events: [...current.events], done: current.done } : null;
}

export function subscribe(fn: (e: any) => void): () => void {
  if (!current) return () => {};
  current.listeners.add(fn);
  return () => current?.listeners.delete(fn);
}

export function isRunning() {
  return !!current && !current.done;
}
