export const THEME_STORAGE_KEY = "generator-theme";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

/** What the user chose. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What is actually painted — "system" is always resolved to one of these. */
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** Used when nothing has been stored yet — the app is dark by default. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

/**
 * Runs as a blocking inline script before first paint, so the correct theme is
 * on <html> before the browser renders anything. Kept dependency-free and
 * stringified — it cannot reference anything outside its own body.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    var preference = stored === "light" || stored === "dark" || stored === "system" ? stored : "${DEFAULT_THEME_PREFERENCE}";
    var resolved = preference === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : preference;
    document.documentElement.setAttribute("data-theme", resolved);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "${DEFAULT_THEME_PREFERENCE}");
  }
})();
`;
