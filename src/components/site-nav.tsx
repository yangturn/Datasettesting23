"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    label: "Generator",
    href: "/",
    isActive: (pathname: string) =>
      pathname === "/" || pathname.startsWith("/stage-"),
  },
  {
    label: "Digital-Twins",
    href: "/digital-twins",
    isActive: (pathname: string) => pathname.startsWith("/digital-twins"),
  },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="flex items-center gap-1">
      {NAV_ITEMS.map(({ label, href, isActive }) => {
        const active = isActive(pathname);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold tracking-tight transition-colors",
              active
                ? "bg-accent-surface text-accent"
                : "text-ink-muted hover:bg-surface-hover hover:text-ink",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
