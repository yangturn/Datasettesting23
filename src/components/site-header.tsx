import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-ink hover:text-accent"
        >
          Generator
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
