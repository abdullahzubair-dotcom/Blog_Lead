"use client";

import type { Contact } from "@/lib/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  mailto: { icon: "✉️", label: "Email", color: "text-sky-400 hover:text-sky-300" },
  author_page: { icon: "🔗", label: "Author page", color: "text-violet-400 hover:text-violet-300" },
  form: { icon: "📋", label: "Contact form", color: "text-amber-400 hover:text-amber-300" },
  twitter: { icon: "𝕏", label: "Twitter/X", color: "text-slate-300 hover:text-white" },
  linkedin: { icon: "in", label: "LinkedIn", color: "text-blue-400 hover:text-blue-300" },
  mastodon: { icon: "🐘", label: "Mastodon", color: "text-indigo-400 hover:text-indigo-300" },
  youtube: { icon: "▶", label: "YouTube", color: "text-red-400 hover:text-red-300" },
  instagram: { icon: "📸", label: "Instagram", color: "text-pink-400 hover:text-pink-300" },
};

interface ContactSurfaceProps {
  contacts: Contact[];
  compact?: boolean;
}

export function ContactSurface({ contacts, compact = false }: ContactSurfaceProps) {
  if (!contacts.length) {
    return <span className="text-xs text-slate-600">No contacts found</span>;
  }

  // Prioritize: email > author_page > form > social
  const sorted = [...contacts].sort((a, b) => b.confidence - a.confidence);
  const shown = compact ? sorted.slice(0, 3) : sorted;

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((c) => {
        const meta = TYPE_META[c.type] ?? { icon: "🌐", label: c.type, color: "text-slate-400" };
        return (
          <Tooltip key={c.id}>
            <TooltipTrigger className="inline-flex">
              <a
                href={c.value}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
                  bg-slate-800 border border-slate-700 transition-colors ${meta.color}`}
                onClick={(e) => e.stopPropagation()}
              >
                <span>{meta.icon}</span>
                {!compact && <span>{meta.label}</span>}
                <span className="opacity-40 text-[10px]">{Math.round(c.confidence * 100)}%</span>
              </a>
            </TooltipTrigger>
            <TooltipContent className="bg-slate-800 border-slate-700 text-slate-200 text-xs max-w-xs truncate">
              {c.value}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
