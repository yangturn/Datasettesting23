"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { ToggleGroup } from "radix-ui";

import { useTheme } from "@/components/theme-provider";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: Record<
  ThemePreference,
  { label: string; Icon: typeof Sun }
> = {
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
  system: { label: "System", Icon: Monitor },
};

export function ThemeToggle() {
  const { preference, ready, setPreference } = useTheme();

  return (
    <ToggleGroup.Root
      type="single"
      // Until localStorage is read, no option is marked active — otherwise the
      // server-rendered markup would claim a selection it can't know.
      value={ready ? preference : ""}
      onValueChange={(value) => {
        if (value) setPreference(value as ThemePreference);
      }}
      aria-label="Color theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {THEME_PREFERENCES.map((option) => {
        const { label, Icon } = OPTIONS[option];
        return (
          <ToggleGroup.Item
            key={option}
            value={option}
            aria-label={label}
            title={label}
            className={cn(
              "rounded-md p-1.5 text-ink-subtle transition-colors",
              "hover:bg-surface-hover hover:text-ink",
              "data-[state=on]:bg-surface-raised data-[state=on]:text-ink data-[state=on]:shadow-sm",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
