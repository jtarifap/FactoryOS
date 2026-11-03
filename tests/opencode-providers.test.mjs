import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { findOpenCodeDbPath, missingProviders, readConnectedProviderIds } from "../server/opencode-providers.ts";

function credentialDb(rows) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-credentials-"));
  const dbPath = path.join(directory, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT, value TEXT, active INTEGER)');
  for (const row of rows) {
    db.prepare("INSERT INTO credential (id, integration_id, label, value, active) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.integration_id, row.label ?? "API key", row.value ?? JSON.stringify({ type: "key", key: "secret" }), row.active ?? null);
  }
  db.close();
  return { directory, dbPath };
}

test("connected providers are read from the OpenCode credential table", () => {
  const { directory, dbPath } = credentialDb([
    { id: "cred_1", integration_id: "openrouter" },
    { id: "cred_2", integration_id: "groq", active: 1 },
    { id: "cred_3", integration_id: "openai" },
  ]);
  try {
    assert.deepEqual(readConnectedProviderIds(dbPath).sort(), ["groq", "openai", "openrouter"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a provider deactivated on every account is not reported as connected", () => {
  const { directory, dbPath } = credentialDb([
    { id: "cred_1", integration_id: "google", active: 0 },
    { id: "cred_2", integration_id: "google", active: 1 },
    { id: "cred_3", integration_id: "old-provider", active: 0 },
  ]);
  try {
    assert.deepEqual(readConnectedProviderIds(dbPath).sort(), ["google"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing database or table reports no providers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-credentials-"));
  try {
    assert.deepEqual(readConnectedProviderIds(path.join(directory, "missing.db")), []);
    const emptyPath = path.join(directory, "empty.db");
    new DatabaseSync(emptyPath).close();
    assert.deepEqual(readConnectedProviderIds(emptyPath), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the OpenCode database is looked up in the known locations", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-home-"));
  try {
    const explicit = path.join(directory, "explicit.db");
    fs.writeFileSync(explicit, "");
    assert.equal(findOpenCodeDbPath({ OPENCODE_DB: explicit }, directory), explicit);

    const xdg = path.join(directory, "xdg", "opencode", "opencode.db");
    fs.mkdirSync(path.dirname(xdg), { recursive: true });
    fs.writeFileSync(xdg, "");
    assert.equal(findOpenCodeDbPath({ XDG_DATA_HOME: path.join(directory, "xdg") }, directory), xdg);

    const homeDb = path.join(directory, ".local", "share", "opencode", "opencode.db");
    fs.mkdirSync(path.dirname(homeDb), { recursive: true });
    fs.writeFileSync(homeDb, "");
    assert.equal(findOpenCodeDbPath({}, directory), homeDb);
    assert.equal(findOpenCodeDbPath({}, path.join(directory, "nowhere")), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("providers connected in OpenCode but invisible to the CLI are reported", () => {
  assert.deepEqual(missingProviders(["openai", "google"], ["openai", "google", "openrouter", "groq"]), ["groq", "openrouter"]);
  assert.deepEqual(missingProviders(["openai"], ["openai"]), []);
});
