"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
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
