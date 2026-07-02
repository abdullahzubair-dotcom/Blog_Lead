// Module-level tracker for an on-demand email-finding run (one at a time). Tracks state
// PER PERSON — a live status line + the full list of steps taken — so the Email Finder
// shows one updating row per author (expandable). Survives the browser tab closing.

export interface EnrichPerson {
  name: string;
  authorId?: string;
  publication?: string;
  steps: string[];                                  // everything we tried, in order
  // "error" = we finished without an email AND at least one provider failed (Blitz down,
  // Reoon out of credits, etc.) — i.e. the miss may be due to an API, not a true absence.
  status: "running" | "found" | "not_found" | "error";
  email?: string;
  source?: string;
  issues?: string[];                                // provider failures encountered
  lastAt: number;
}

interface EnrichRun {
  key: string;
  campaignName?: string;
  total: number;
  done: number;
  found: number;
  bySource: Record<string, number>;
  running: boolean;
  aborted: boolean;
  startedAt: number;
  finishedAt?: number;
  people: Map<string, EnrichPerson>;
}

const MAX_STEPS = 60;
let current: EnrichRun | null = null;

export function startEnrich(key: string, total: number, campaignName?: string): void {
  current = { key, campaignName, total, done: 0, found: 0, bySource: {}, running: true, aborted: false, startedAt: Date.now(), people: new Map() };
}

function person(name: string, publication?: string, authorId?: string): EnrichPerson {
  let p = current!.people.get(name);
  if (!p) { p = { name, authorId, publication, steps: [], status: "running", lastAt: Date.now() }; current!.people.set(name, p); }
  if (authorId && !p.authorId) p.authorId = authorId;
  return p;
}

// A live sub-step for the current author (updates their row, does not advance the counter).
export function enrichStep(name: string, detail: string, publication?: string, authorId?: string): void {
  if (!current) return;
  const p = person(name, publication, authorId);
  p.steps.push(detail);
  if (p.steps.length > MAX_STEPS) p.steps.shift();
  p.lastAt = Date.now();
}

// Final outcome for an author (advances done/found).
export function enrichResult(entry: { name: string; authorId?: string; publication?: string; found: boolean; email?: string; source?: string; issues?: string[] }): void {
  if (!current) return;
  const p = person(entry.name, entry.publication, entry.authorId);
  const issues = entry.issues?.length ? entry.issues : undefined;
  p.status = entry.found ? "found" : (issues ? "error" : "not_found");
  p.email = entry.email;
  p.source = entry.source;
  p.issues = issues;
  p.lastAt = Date.now();
  current.done += 1;
  if (entry.found) {
    current.found += 1;
    if (entry.source) current.bySource[entry.source] = (current.bySource[entry.source] ?? 0) + 1;
  }
}

export function finishEnrich(): void {
  if (current) { current.running = false; current.finishedAt = Date.now(); }
}

export function abortEnrich(): void {
  if (current) current.aborted = true;
}

export function isEnrichAborted(): boolean {
  return current?.aborted ?? false;
}

export function isEnrichRunning(): boolean {
  return current?.running ?? false;
}

export function getEnrich(): (Omit<EnrichRun, "people"> & { people: EnrichPerson[] }) | null {
  if (!current) return null;
  const { people, ...rest } = current;
  // Most-recently-active first; cap the payload.
  const arr = [...people.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 200);
  return { ...rest, people: arr };
}
