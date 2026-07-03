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

interface Warning { label: string; message: string }

// Polls key health and shows a banner when any configured API key is failing (red) or when
// something needs attention soon, e.g. Tavily search quota nearly/fully used (amber).
// Dismissible per-session.
export function KeyHealthBanner() {
  const [broken, setBroken] = useState<KeyHealth[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      const data = await fetch(`/api/health/keys${force ? "?force=1" : ""}`).then((r) => r.json());
      setBroken(data.broken ?? []);
      setWarnings(data.warnings ?? []);
      if ((data.broken ?? []).length > 0 || (data.warnings ?? []).length > 0) setDismissed(false);
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

  if (dismissed || (broken.length === 0 && warnings.length === 0)) return null;

  // Red for hard failures, otherwise amber for warnings (e.g. Tavily near quota).
  const isError = broken.length > 0;
  const tone = isError
    ? { bg: "bg-red-500/10 border-red-500/30", icon: "text-red-400", title: "text-red-300", body: "text-red-200/90", btn: "text-red-300 hover:text-red-100", btn2: "text-red-300/70 hover:text-red-100" }
    : { bg: "bg-amber-500/10 border-amber-500/30", icon: "text-amber-400", title: "text-amber-300", body: "text-amber-200/90", btn: "text-amber-300 hover:text-amber-100", btn2: "text-amber-300/70 hover:text-amber-100" };

  const title = isError
    ? (broken.length === 1 ? "An API key isn't working" : `${broken.length} API keys aren't working`)
    : "Heads up";
  const detail = isError
    ? broken.map((b) => `${b.label} — ${b.message}`).join(" · ")
    : warnings.map((w) => `${w.label} — ${w.message}`).join(" · ");

  return (
    <div className={`${tone.bg} border-b px-4 py-2.5`}>
      <div className="container mx-auto max-w-7xl flex items-center gap-3 text-sm">
        <AlertTriangle className={`h-4 w-4 ${tone.icon} shrink-0`} />
        <div className="flex-1 min-w-0">
          <span className={`font-medium ${tone.title}`}>{title}:</span>{" "}
          <span className={tone.body}>{detail}</span>
        </div>
        <button onClick={recheck} disabled={rechecking} className={`shrink-0 ${tone.btn} flex items-center gap-1 text-xs`}>
          <RefreshCw className={`h-3.5 w-3.5 ${rechecking ? "animate-spin" : ""}`} />
          Recheck
        </button>
        <button onClick={() => setDismissed(true)} className={`shrink-0 ${tone.btn2}`} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
