let active: AbortController | null = null;

export function createPipelineController(): AbortController {
  if (active && !active.signal.aborted) active.abort("new run");
  active = new AbortController();
  return active;
}

export function stopPipeline() {
  if (active && !active.signal.aborted) {
    active.abort("user stopped");
    return true;
  }
  return false;
}

export function isPipelineRunning() {
  return !!active && !active.signal.aborted;
}
