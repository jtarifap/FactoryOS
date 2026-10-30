export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "factoryos-theme";

export function readTheme(storage: Pick<Storage, "getItem">): Theme {
  try {
    return storage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
