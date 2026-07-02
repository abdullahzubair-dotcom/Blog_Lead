"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  user?: { name?: string | null; email?: string | null; image?: string | null };
}

const NAV = [
  { href: "/", label: "Prospects", icon: "🎯" },
  { href: "/admin", label: "Admin", icon: "⚙️" },
  { href: "/settings", label: "Settings", icon: "🔑" },
];

export function Header({ user }: HeaderProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur supports-[backdrop-filter]:bg-slate-950/80">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <span className="font-semibold text-white text-sm">GenAI Scout</span>
            <Badge variant="outline" className="text-[10px] border-violet-700 text-violet-400 px-1.5 py-0">BETA</Badge>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-1 ml-4">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  }`}
                >
                  <span className="mr-1.5">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          {/* User menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger className="h-8 w-8 rounded-full overflow-hidden ring-2 ring-slate-700 hover:ring-violet-700 transition-all focus:outline-none">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.image ?? undefined} alt={user.name ?? ""} />
                  <AvatarFallback className="bg-violet-700 text-white text-xs">
                    {user.name?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-700">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium text-white truncate">{user.name}</p>
                  <p className="text-xs text-slate-400 truncate">{user.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem className="text-slate-300 hover:text-white cursor-pointer" onClick={() => window.location.href = "/settings"}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem className="text-slate-300 hover:text-white cursor-pointer" onClick={() => window.location.href = "/admin"}>
                  Admin panel
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem
                  className="text-red-400 hover:text-red-300 cursor-pointer"
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
