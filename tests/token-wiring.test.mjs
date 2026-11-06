import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("project agents stream JSON and persist token usage per job", () => {
  const server = read("server/index.ts");
  const runAgent = server.slice(server.indexOf("function runAgentFor("), server.indexOf("function runConsultation("));
  assert.match(runAgent, /"--format", "json"/);
  assert.match(runAgent, /opencodeEnv\(j\.id\)/);
  assert.match(runAgent, /recordTokenUsage\(j, rawOutput\)/);
  assert.match(server, /OPENCODE_DB: jobId \? jobDatabasePath\(jobId\) : ":memory:"/);
  assert.match(server, /readTokenUsageFromDb\(jobDatabasePath\(j\.id\)\)/);
  assert.match(server, /tokens: emptyTokenUsage\(\)/);
  assert.match(server, /writeTokenUsageFile\(j\)/);
});

test("consultations also record their token usage", () => {
  const server = read("server/index.ts");
  const consultation = server.slice(server.indexOf("function runConsultation("), server.indexOf("function execInProject("));
  assert.match(consultation, /opencodeEnv\(j\.id\)/);
  assert.match(consultation, /recordTokenUsage\(j, output\)/);
  assert.match(consultation, /Consumo de la consulta/);
});

test("the app shows per-job and global token usage", () => {
  const web = read("web/main.ts");
  assert.match(web, /Consumo total registrado/);
  assert.match(web, /Tokens: en curso/);
  assert.match(web, /token-usage/);
  assert.match(web, /formatTokenUsage\(job\.tokens\)/);
  assert.match(web, /j\.tokens/);
});

test("deleting a job also removes its OpenCode database", () => {
  const server = read("server/index.ts");
  const deleteBranch = server.slice(server.indexOf("const deleteMatch"), server.indexOf("if (await handlePreview"));
  assert.match(deleteBranch, /jobDatabasePath\(jobId\)/);
  assert.match(deleteBranch, /-wal/);
});
