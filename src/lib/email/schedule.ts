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

function clampHour(h: number | undefined, dflt: number): number {
  if (h == null || isNaN(h)) return dflt;
  return Math.min(23, Math.max(0, Math.floor(h)));
}

// Burst schedule: NO spacing and NO per-day cap. Every email is stamped with ONE optimal
// send instant so the whole batch goes out together (the process cron then drains it within
// the hour, even if it's 1500 emails on one account). The optimal instant is the next open
// of the sender's LOCAL [startH,endH) window: right now if we're already inside the window,
// else today's window start (if it hasn't begun) or tomorrow's (if the window already closed).
// gap_minutes / daily_cap on the config are intentionally ignored here.
export function computeSmartSchedule(
  recipients: ScheduleRecipient[],
  config: EmailSendConfig,
  now: Date,
): ScheduledSlot[] {
  const startH = clampHour(config.send_hour_start, 9);
  const endH = Math.max(startH + 1, clampHour(config.send_hour_end, 17));
  // One instant for the whole batch, computed in the SENDER's timezone (all of this queue
  // sends from one account, so they share it). Every email lands on exactly this time.
  const optimal = earliestFor(now.getTime(), config.timezone, startH, endH);
  const at = new Date(optimal).toISOString();
  return recipients.map((r) => ({ id: r.id, at }));
}
