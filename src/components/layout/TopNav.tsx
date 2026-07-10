"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { Moon, Sun, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_NAMES: Record<string, string> = {
  "": "Prospects",
  admin: "Admin",
  settings: "Settings",
  campaigns: "Campaigns",
  workflows: "Workflows",
  emails: "Emails",
};

// Persistent Tavily usage pill — always visible so search-quota usage doesn't creep up
// unnoticed. Pool-aware: shows this month's searches against the WHOLE pool's capacity
// (activeKeys × per-key limit) plus how many keys are still live, so it reflects everything
// rather than a single key. Polls every 30s.
function TavilyUsagePill() {
  const [usage, setUsage] = useState<{ enabled: boolean; used: number; limit: number; near: boolean; over: boolean; poolTotal: number; poolActive: number } | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/health/keys").then((r) => (r.ok ? r.json() : null)).then((d) => d && setUsage(d.tavily)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!usage?.enabled) return null;
  const poolTotal = usage.poolTotal ?? 0;
  // Effective monthly capacity = active pool keys × per-key limit (fallback to the single env
  // key's limit when the pool is empty).
  const capacity = poolTotal > 0 ? usage.poolActive * usage.limit : usage.limit;
  const tone = usage.over
    ? "text-red-400 border-red-500/30 bg-red-500/10"
    : (poolTotal > 0 ? usage.poolActive <= 1 : usage.near)
      ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
      : "text-muted-foreground";
  return (
    <Badge variant="outline" className={`flex items-center gap-1.5 text-xs font-normal ${tone}`} title={poolTotal > 0 ? `${usage.used.toLocaleString()} Tavily searches this month · ${usage.poolActive}/${poolTotal} keys active (capacity ~${capacity.toLocaleString()}/mo)` : "Tavily search API usage this month"}>
      <Search className="h-3 w-3" />
      {usage.used.toLocaleString()}/{capacity.toLocaleString()}
      {poolTotal > 0 && <span className="opacity-60">· {usage.poolActive}/{poolTotal} keys</span>}
    </Badge>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();

  const segments = pathname.split("/").filter(Boolean);
  const user = session?.user;

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center">
      <div className="flex h-full w-full items-center justify-between px-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors font-medium">
            GenAI Scout
          </Link>
          {segments.map((seg, i) => (
            <span key={seg} className="flex items-center gap-1.5">
              <span className="text-muted-foreground">/</span>
              <Link
                href={"/" + segments.slice(0, i + 1).join("/")}
                className="text-foreground font-medium capitalize"
              >
                {PAGE_NAMES[seg] ?? seg}
              </Link>
            </span>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <TavilyUsagePill />

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* User dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.image ?? undefined} alt={user.name ?? ""} />
                  <AvatarFallback className="bg-violet-600 text-white text-xs font-semibold">
                    {user.name?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs text-muted-foreground leading-none mt-1">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => (window.location.href = "/settings")}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => (window.location.href = "/admin")}>
                  Admin panel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
