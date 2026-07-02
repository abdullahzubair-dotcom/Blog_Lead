import type { EmailSendConfig } from "@/lib/types";

export interface ScheduleRecipient {
  id: string;   // email id
  tz: string;   // recipient's inferred IANA timezone
}

export interface ScheduledSlot {
  id: string;
  at: string;   // UTC ISO
}

// ── Wall-clock helpers (interpret/produce times in a given IANA timezone) ──────
interface WC { y: number; m: number; d: number; h: number; min: number }

function partsInTz(ms: number, tz: string): WC {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, x.value])) as any;
  let h = parseInt(p.hour, 10);
  if (h === 24) h = 0;
  return { y: +p.year, m: +p.month, d: +p.day, h, min: +p.minute };
}

// Convert a wall-clock time in `tz` to a UTC epoch-ms instant.
function utcFromLocal(wc: WC, tz: string): number {
  const guess = Date.UTC(wc.y, wc.m - 1, wc.d, wc.h, wc.min, 0);
  const seen = partsInTz(guess, tz);
  const seenMs = Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.min, 0);
  const offset = seenMs - guess; // how far tz is from UTC at this instant
  return guess - offset;
}

function localHour(ms: number, tz: string): number {
  return partsInTz(ms, tz).h;
}

function withinWindow(ms: number, tz: string, startH: number, endH: number): boolean {
  const h = localHour(ms, tz);
  return h >= startH && h < endH;
}

// Local window start (startH:00) on the same local day as `ms`.
function windowStartSameDay(ms: number, tz: string, startH: number): number {
  const p = partsInTz(ms, tz);
  return utcFromLocal({ ...p, h: startH, min: 0 }, tz);
}

// Local window start on the day AFTER the local day of `ms`.
function windowStartNextDay(ms: number, tz: string, startH: number): number {
  const p = partsInTz(ms, tz);
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d));
  next.setUTCDate(next.getUTCDate() + 1);
  return utcFromLocal({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate(), h: startH, min: 0 }, tz);
}

// Earliest acceptable send instant for a recipient: now if inside their window,
// else today's window start (if before) or tomorrow's (if after).
function earliestFor(nowMs: number, tz: string, startH: number, endH: number): number {
  const h = localHour(nowMs, tz);
  if (h < startH) return windowStartSameDay(nowMs, tz, startH);
  if (h >= endH) return windowStartNextDay(nowMs, tz, startH);
  return nowMs;
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function clampHour(h: number | undefined, dflt: number): number {
  if (h == null || isNaN(h)) return dflt;
  return Math.min(23, Math.max(0, Math.floor(h)));
}

// Smart schedule: every email lands inside its recipient's LOCAL [startH,endH) window,
// while all sends share one account so they're spaced >= gap_minutes apart globally and
// capped at daily_cap per calendar day. Greedy by each recipient's earliest local slot.
export function computeSmartSchedule(
  recipients: ScheduleRecipient[],
  config: EmailSendConfig,
  now: Date,
): ScheduledSlot[] {
  const startH = clampHour(config.send_hour_start, 9);
  const endH = Math.max(startH + 1, clampHour(config.send_hour_end, 17));
  const gapMs = Math.max(1, config.gap_minutes || 15) * 60_000;
  const cap = Math.max(1, config.daily_cap || 50);
  const nowMs = now.getTime();

  const withEarliest = recipients.map((r) => ({
    ...r,
    earliest: earliestFor(nowMs, r.tz, startH, endH),
  }));
  withEarliest.sort((a, b) => a.earliest - b.earliest);

  const dayCount: Record<string, number> = {};
  let lastSlot = -Infinity;
  const out: ScheduledSlot[] = [];

  for (const r of withEarliest) {
    let cand = Math.max(r.earliest, lastSlot === -Infinity ? r.earliest : lastSlot + gapMs);

    // Normalize into a valid slot (bounded to avoid any pathological loop).
    for (let iter = 0; iter < 800; iter++) {
      if (!withinWindow(cand, r.tz, startH, endH)) {
        // If we're before today's window, jump to today's start; else next day's start.
        cand = localHour(cand, r.tz) < startH
          ? windowStartSameDay(cand, r.tz, startH)
          : windowStartNextDay(cand, r.tz, startH);
        continue;
      }
      if (lastSlot !== -Infinity && cand < lastSlot + gapMs) {
        cand = lastSlot + gapMs;
        continue;
      }
      if ((dayCount[utcDayKey(cand)] ?? 0) >= cap) {
        cand = windowStartNextDay(cand, r.tz, startH);
        continue;
      }
      break;
    }

    out.push({ id: r.id, at: new Date(cand).toISOString() });
    lastSlot = cand;
    dayCount[utcDayKey(cand)] = (dayCount[utcDayKey(cand)] ?? 0) + 1;
  }

  // Return in send order
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
