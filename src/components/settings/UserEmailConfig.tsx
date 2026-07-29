"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, KeyRound, ExternalLink, Send } from "lucide-react";
import type { UserEmailConfig } from "@/lib/types";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Karachi", "Asia/Dubai", "Asia/Kolkata",
  "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "UTC",
];

export function UserEmailConfigCard() {
  const [cfg, setCfg] = useState<UserEmailConfig | null>(null);
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    setTesting(true);
    const res = await fetch("/api/user/email-config/test", { method: "POST" }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (res.ok) toast.success(`Test email sent to ${cfg?.user_email} — check your inbox.`);
    else toast.error(res.error ?? "Test failed — double-check your app password.");
    setTesting(false);
  }

  useEffect(() => {
    fetch("/api/user/email-config").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setCfg(d); }).catch(() => {});
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      from_name: cfg.from_name, timezone: cfg.timezone,
      send_hour_start: cfg.send_hour_start, send_hour_end: cfg.send_hour_end,
      gap_minutes: cfg.gap_minutes, daily_cap: cfg.daily_cap,
    };
    if (pw.trim()) body.app_password = pw.trim();
    const res = await fetch("/api/user/email-config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { setCfg(await res.json()); setPw(""); toast.success("Sending settings saved."); }
    else toast.error("Couldn't save.");
    setSaving(false);
  }

  if (!cfg) return null;

  return (
    <Card className={cfg.hasPassword ? "" : "border-amber-500/30 bg-amber-500/5"}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-violet-400" />Your sending email</CardTitle>
          <Badge variant="outline" className={cfg.hasPassword ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400"}>
            {cfg.hasPassword ? "✓ app password set" : "⚠ app password required"}
          </Badge>
        </div>
        <CardDescription>You send outreach from your own Gmail (<span className="text-foreground">{cfg.user_email}</span>) using a Gmail <b>app password</b> — never your normal password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Setup steps */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground">How to get a Gmail app password</p>
          <p>1. Turn on 2-Step Verification: <a className="text-violet-400 hover:underline inline-flex items-center gap-0.5" href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noreferrer">Google 2-Step <ExternalLink className="h-3 w-3" /></a></p>
          <p>2. Create an app password (pick “Mail”): <a className="text-violet-400 hover:underline inline-flex items-center gap-0.5" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords <ExternalLink className="h-3 w-3" /></a></p>
          <p>3. Paste the 16-character code below (spaces are fine).</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>App password {cfg.hasPassword && <span className="text-emerald-400 text-xs">(set — type to replace)</span>}</Label>
            <Input type="password" placeholder={cfg.hasPassword ? "•••• •••• •••• ••••" : "abcd efgh ijkl mnop"} value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>From name</Label>
            <Input placeholder="Your Name" value={cfg.from_name ?? ""} onChange={(e) => setCfg({ ...cfg, from_name: e.target.value })} />
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Timezone</Label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Send from (hr)</Label>
            <Input type="number" min={0} max={23} value={cfg.send_hour_start} onChange={(e) => setCfg({ ...cfg, send_hour_start: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Send until (hr)</Label>
            <Input type="number" min={1} max={24} value={cfg.send_hour_end} onChange={(e) => setCfg({ ...cfg, send_hour_end: Number(e.target.value) })} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p><b className="text-foreground">Burst sending:</b> emails no longer trickle out spaced apart. When you hit Send, the whole batch is queued for <b>one</b> time, the next open of your <b>Send from</b> hour in your timezone (or right away if you&apos;re already inside the window), then delivered together within about an hour, however many are queued.</p>
          <p className="mt-1.5 text-amber-500/90">Heads up: blasting a very large batch from one Gmail can trip Google&apos;s sending limits (~2,000/day on Workspace) or spam filters. Any rejected sends show up as failed on the Sending page.</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={sendTest} disabled={testing || !cfg.hasPassword} title={cfg.hasPassword ? "Send a test email to yourself" : "Save an app password first"}>
            {testing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Send test email
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
            Save sending settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
