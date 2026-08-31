"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

/** Same-tab notification; the `storage` event only fires in *other* tabs. */
const THEME_CHANGE_EVENT = "generator:themechange";

const DARK_QUERY = "(prefers-color-scheme: dark)";

type ThemeContextValue = {
  /** The user's choice, including "system". */
  preference: ThemePreference;
  /** The theme actually painted. */
  resolved: ResolvedTheme;
  /** False during SSR and hydration, before the stored value is readable. */
  ready: boolean;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The preference lives in localStorage and the system setting lives in a media
 * query — both are external stores, so they are read with
 * `useSyncExternalStore` rather than mirrored into state.
 */
function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);

  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  media.addEventListener("change", onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    media.removeEventListener("change", onChange);
  };
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
    return DEFAULT_THEME_PREFERENCE;
  }
}

function readSystemIsDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // On the server there is no stored preference and no media query, so both
  // snapshots fall back to their neutral values; React re-renders with the real
  // ones immediately after hydration.
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => DEFAULT_THEME_PREFERENCE,
  );

  const systemIsDark = useSyncExternalStore(
    subscribe,
    readSystemIsDark,
    () => false,
  );

  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const resolved: ResolvedTheme =
    preference === "system" ? (systemIsDark ? "dark" : "light") : preference;

  // Push the resolved theme to the DOM — an external system, so an effect is
  // the right place for it. The inline script has already done this for the
  // first paint; this keeps it in sync on every later change.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference simply won't persist across reloads.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, ready, setPreference }),
    [preference, resolved, ready, setPreference],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
