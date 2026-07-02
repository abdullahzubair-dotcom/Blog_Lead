"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, X, RefreshCw } from "lucide-react";

interface KeyHealth {
  service: string;
  label: string;
  configured: boolean;
  ok: boolean;
  message: string;
}

// Polls key health and shows a banner when any configured API key is failing
// (invalid key, quota exhausted, unreachable). Dismissible per-session.
export function KeyHealthBanner() {
  const [broken, setBroken] = useState<KeyHealth[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      const data = await fetch(`/api/health/keys${force ? "?force=1" : ""}`).then((r) => r.json());
      setBroken(data.broken ?? []);
      if ((data.broken ?? []).length > 0) setDismissed(false); // re-show if a new failure appears
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000); // poll every minute
    return () => clearInterval(t);
  }, [load]);

  async function recheck() {
    setRechecking(true);
    await load(true);
    setRechecking(false);
  }

  if (broken.length === 0 || dismissed) return null;

  return (
    <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-2.5">
      <div className="container mx-auto max-w-7xl flex items-center gap-3 text-sm">
        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-red-300">
            {broken.length === 1 ? "An API key isn't working" : `${broken.length} API keys aren't working`}:
          </span>{" "}
          <span className="text-red-200/90">
            {broken.map((b) => `${b.label} — ${b.message}`).join(" · ")}
          </span>
        </div>
        <button onClick={recheck} disabled={rechecking} className="shrink-0 text-red-300 hover:text-red-100 flex items-center gap-1 text-xs">
          <RefreshCw className={`h-3.5 w-3.5 ${rechecking ? "animate-spin" : ""}`} />
          Recheck
        </button>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-red-300/70 hover:text-red-100" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
