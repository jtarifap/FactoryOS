import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addTokenUsage,
  emptyTokenUsage,
  formatCost,
  formatTokenCount,
  formatTokenUsage,
  parseTokenUsage,
  tokenUsageMarkdown,
  tokenUsageFromPayload,
} from "../shared/token-usage.ts";
import { readTokenUsageFromDb } from "../server/session-usage.ts";

test("step_finish events are summed with cache and cost", () => {
  const output = [
    JSON.stringify({ type: "text", part: { text: "hola" } }),
    JSON.stringify({
      type: "step_finish",
      part: { cost: 0.25, tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 1000, write: 20 } } },
    }),
    "not json",
    JSON.stringify({
      type: "step_finish",
      part: { tokens: { input: 50, output: 2, reasoning: 1, cache: { read: 200, write: 3 } } },
    }),
  ].join("\n");

  const usage = parseTokenUsage(output);
  assert.equal(usage.input, 150);
  assert.equal(usage.output, 12);
  assert.equal(usage.reasoning, 6);
  assert.equal(usage.cacheRead, 1200);
  assert.equal(usage.cacheWrite, 23);
  assert.equal(usage.total, 1391);
  assert.equal(usage.cost, 0.25);
});

test("token payloads without cache fields are normalized safely", () => {
  const usage = tokenUsageFromPayload({ input: 7, output: 3, reasoning: 2 });
  assert.deepEqual(usage, { input: 7, output: 3, reasoning: 2, cacheRead: 0, cacheWrite: 0, total: 12, cost: 0 });
  assert.deepEqual(tokenUsageFromPayload(null), emptyTokenUsage());
});

test("adding usage keeps the total consistent", () => {
  const left = tokenUsageFromPayload({ input: 10, output: 2, cache: { read: 30 } });
  const right = tokenUsageFromPayload({ input: 5, output: 1, cache: { write: 4 } }, 0.5);
  const total = addTokenUsage(left, right);
  assert.equal(total.input, 15);
  assert.equal(total.output, 3);
  assert.equal(total.cacheRead, 30);
  assert.equal(total.cacheWrite, 4);
  assert.equal(total.total, 52);
  assert.equal(total.cost, 0.5);
});

test("token counts and costs are formatted for Spanish readers", () => {
  assert.equal(formatTokenCount(1234567), "1.234.567");
  assert.equal(formatTokenCount(-4), "0");
  assert.equal(formatCost(0), "$0,00");
  assert.equal(formatCost(0.0036216), "$0,0036");
  assert.equal(formatCost(1.5), "$1,50");
});

test("usage summary and markdown expose the totals", () => {
  const usage = tokenUsageFromPayload(
    { input: 8392, output: 2, reasoning: 44, cache: { read: 8320, write: 1 } },
    0.25
  );
  const summary = formatTokenUsage(usage);
  assert.match(summary, /16\.759 tokens/);
  assert.match(summary, /entrada 8\.392/);
  assert.match(summary, /salida 2/);
  assert.match(summary, /razonamiento 44/);
  assert.match(summary, /caché L 8\.320/);
  assert.match(summary, /caché E 1/);
  assert.match(summary, /\$0,25/);

  const markdown = tokenUsageMarkdown(usage);
  assert.match(markdown, /# Consumo de tokens/);
  assert.match(markdown, /\| \*\*Total\*\* \| \*\*16\.759\*\* \|/);
  assert.match(markdown, /Coste estimado: \*\*\$0,25\*\*/);
});

test("job database usage includes parent and subagent sessions", async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    t.skip("node:sqlite no está disponible en esta versión de Node");
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-tokens-"));
  const dbPath = path.join(directory, "job.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, parent_id TEXT, tokens_input INTEGER, tokens_output INTEGER,
      tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, cost REAL
    );
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY, parent_id TEXT, tokens_input INTEGER, tokens_output INTEGER,
      tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, cost REAL
    );
  `);
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "ses_parent", null, 100, 20, 5, 1000, 10, 0.5
  );
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "ses_child", "ses_parent", 200, 30, 7, 2000, 20, 0.25
  );
  // The same session may also exist in the compatibility table; it must not be counted twice.
  db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "ses_child", "ses_parent", 999, 999, 999, 999, 999, 9
  );
  db.close();

  try {
    const usage = readTokenUsageFromDb(dbPath);
    assert.ok(usage);
    assert.equal(usage.input, 300);
    assert.equal(usage.output, 50);
    assert.equal(usage.reasoning, 12);
    assert.equal(usage.cacheRead, 3000);
    assert.equal(usage.cacheWrite, 30);
    assert.equal(usage.total, 3392);
    assert.equal(usage.cost, 0.75);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("missing or unreadable job databases return null instead of throwing", () => {
  assert.equal(readTokenUsageFromDb(""), null);
  assert.equal(readTokenUsageFromDb(path.join(os.tmpdir(), "factoryos-missing-job.db")), null);
});
