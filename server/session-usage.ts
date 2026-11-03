import fs from "node:fs";
import { createRequire } from "node:module";
import { addTokenUsage, emptyTokenUsage, type TokenUsage } from "../shared/token-usage.js";

const require = createRequire(import.meta.url);

type SessionRow = {
  id?: unknown;
  parent_id?: unknown;
  tokens_input?: unknown;
  tokens_output?: unknown;
  tokens_reasoning?: unknown;
  tokens_cache_read?: unknown;
  tokens_cache_write?: unknown;
  cost?: unknown;
};

type SqliteDatabase = {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
};

function openDatabase(dbPath: string): SqliteDatabase | null {
  try {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
    };
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

function rowUsage(row: SessionRow): TokenUsage {
  const input = numberValue(row.tokens_input);
  const output = numberValue(row.tokens_output);
  const reasoning = numberValue(row.tokens_reasoning);
  const cacheRead = numberValue(row.tokens_cache_read);
  const cacheWrite = numberValue(row.tokens_cache_write);
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    cost: numberValue(row.cost),
  };
}

/**
 * Reads the token totals stored by OpenCode for a job-specific database.
 * The database contains the Factory-manager session and every subagent
 * session it spawned, so summing all rows gives the real job total.
 */
export function readTokenUsageFromDb(dbPath: string): TokenUsage | null {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  const db = openDatabase(dbPath);
  if (!db) return null;

  try {
    const rows: SessionRow[] = [];
    for (const table of ["session", "session_v2"]) {
      try {
        const result = db.prepare(
          `SELECT id, parent_id, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost FROM ${table}`
        ).all();
        for (const row of result) rows.push(row as SessionRow);
      } catch {
        // Older or newer OpenCode versions may only have one of the tables.
      }
    }
    if (!rows.length) return null;

    // Both tables can contain the same session; keep the first (current) copy.
    const unique = new Map<string, SessionRow>();
    for (const row of rows) {
      if (typeof row.id !== "string" || !row.id) continue;
      if (!unique.has(row.id)) unique.set(row.id, row);
    }

    let usage = emptyTokenUsage();
    for (const row of unique.values()) usage = addTokenUsage(usage, rowUsage(row));
    return usage;
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      // The read-only handle may already be closed by the driver.
    }
  }
}
