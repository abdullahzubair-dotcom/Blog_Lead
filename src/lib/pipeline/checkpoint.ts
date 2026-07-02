import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";

const DIR = join(process.cwd(), ".pipeline-checkpoints");

export interface PipelineCheckpoint {
  runId: string;
  round: number;
  usedQueries: string[];
  rssComplete: boolean;
  campaignId?: string;
  customKeywords?: string[];
  savedAt: string;
}

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export function saveCheckpoint(c: PipelineCheckpoint): void {
  try {
    ensureDir();
    writeFileSync(join(DIR, `${c.runId}.json`), JSON.stringify(c), "utf-8");
  } catch {}
}

export function deleteCheckpoint(runId: string): void {
  try { unlinkSync(join(DIR, `${runId}.json`)); } catch {}
}

export function findLatestCheckpoint(): PipelineCheckpoint | null {
  try {
    ensureDir();
    const checkpoints = readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(DIR, f), "utf-8")) as PipelineCheckpoint; } catch { return null; } })
      .filter((c): c is PipelineCheckpoint => c !== null);
    if (!checkpoints.length) return null;
    return checkpoints.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0];
  } catch {
    return null;
  }
}
