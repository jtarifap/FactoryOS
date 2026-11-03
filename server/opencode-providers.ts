import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type SqliteDatabase = {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
};

const openDatabase = (dbPath: string): SqliteDatabase | null => {
  try {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
    };
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
};

/**
 * Lists the providers the user connected in OpenCode.
 *
 * Only the provider identifiers are read: the stored credentials stay inside
 * the OpenCode database and are never loaded into this process.
 */
export function readConnectedProviderIds(dbPath: string): string[] {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const db = openDatabase(dbPath);
  if (!db) return [];

  try {
    const rows = db.prepare("SELECT integration_id, active FROM credential").all() as { integration_id?: unknown; active?: unknown }[];
    const providers = new Map<string, boolean>();
    for (const row of rows) {
      const id = typeof row.integration_id === "string" ? row.integration_id.trim() : "";
      if (!id) continue;
      const active = row.active !== 0;
      providers.set(id, (providers.get(id) ?? false) || active);
    }
    return [...providers.entries()].filter(([, active]) => active).map(([id]) => id).sort();
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // The read-only handle may already be closed by the driver.
    }
  }
}

/** Locates the OpenCode database used by the desktop application. */
export function findOpenCodeDbPath(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir()
): string | null {
  const candidates = [
    env.OPENCODE_DB,
    env.XDG_DATA_HOME ? path.join(env.XDG_DATA_HOME, "opencode", "opencode.db") : "",
    home ? path.join(home, ".local", "share", "opencode", "opencode.db") : "",
    env.APPDATA ? path.join(env.APPDATA, "opencode", "opencode.db") : ""
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Providers connected in OpenCode that the CLI cannot use yet. */
export function missingProviders(visible: string[], connected: string[]): string[] {
  const known = new Set(visible);
  return connected.filter(provider => !known.has(provider)).sort();
}
