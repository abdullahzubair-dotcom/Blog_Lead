"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  Settings,
  LayoutDashboard,
  Rocket,
  ChevronLeft,
  Menu,
  Megaphone,
  GitBranch,
  Mail,
  Send,
  AtSign,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { name: "Prospects", href: "/", icon: LayoutDashboard },
  { name: "Campaigns", href: "/campaigns", icon: Megaphone },
  { name: "Workflows", href: "/workflows", icon: GitBranch },
  { name: "Email Finder", href: "/email-finder", icon: AtSign },
  { name: "Emails", href: "/emails", icon: Mail },
  { name: "Sending", href: "/sending", icon: Send },
  { name: "Admin", href: "/admin", icon: Rocket },
  { name: "Settings", href: "/settings", icon: Settings },
];

// Swaps the nav icon for a spinner while THIS link's navigation is in flight — instant
// feedback on click. Must be rendered inside its <Link> (useLinkStatus reads that context).
function NavIcon({ Icon, collapsed }: { Icon: LucideIcon; collapsed: boolean }) {
  const { pending } = useLinkStatus();
  const cls = cn("h-4 w-4 shrink-0", !collapsed && "mr-3");
  return pending ? <Loader2 className={cn(cls, "animate-spin")} /> : <Icon className={cls} />;
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-background rounded-md shadow-md border border-border"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out lg:static lg:z-auto",
          collapsed ? "w-[72px]" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Logo */}
        <div className={cn("flex h-16 items-center border-b border-sidebar-border px-4 shrink-0", collapsed && "justify-center px-2")}>
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center shrink-0">
                <Search className="w-4 h-4 text-white" />
              </div>
              <span className="text-base">GenAI Scout</span>
            </Link>
          )}
          {collapsed && (
            <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
              <Search className="w-4 h-4 text-white" />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn("ml-auto h-8 w-8 p-0 shrink-0", collapsed && "ml-0 mt-0")}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          <div className="space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.name : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    collapsed && "justify-center px-2",
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  <NavIcon Icon={item.icon} collapsed={collapsed} />
                  {!collapsed && <span>{item.name}</span>}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </>
  );
}
