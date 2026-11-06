import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

const createJobSection = () => {
  const start = server.indexOf('u.pathname === "/api/jobs" && req.method === "POST"');
  const end = server.indexOf("const match = u.pathname.match", start);
  assert.ok(start >= 0 && end > start, "No se encontro el alta de trabajos");
  return server.slice(start, end);
};

test("the job stores a validated scope and uses the deterministic classifier", () => {
  const createJob = createJobSection();
  assert.match(server, /from "\.\/modification-scope\.js"/);
  assert.match(server, /classifyModification/);
  assert.match(createJob, /input\.scope/);
  assert.match(createJob, /["']auto["']/);
  assert.match(createJob, /scope/);
  assert.match(server, /scope\?: ModificationScope/);
});

test("a quick modification runs the developer alone, without the manager pipeline", () => {
  assert.match(server, /scope === "quick"/);
  const quick = server.slice(server.indexOf('scope === "quick"'), server.indexOf('scope === "quick"') + 1600);
  assert.match(quick, /runAgent\(j, "developer"/);
  assert.doesNotMatch(quick, /runAgent\(j, "factory-manager"/);
  assert.match(quick, /verifyProject\(j\)/);
  assert.match(quick, /"done"/);
  assert.match(quick, /Cambio aplicado/);
});

test("every agent phase enforces the token budget with a live check", () => {
  const start = server.indexOf("function runAgent(");
  const end = server.indexOf("function runConsultation(", start);
  const runAgent = server.slice(start, end);
  assert.ok(start >= 0 && end > start, "No se encontro runAgent");
  assert.match(server, /from "\.\/job-budget\.js"/);
  assert.match(runAgent, /readTokenUsageFromDb/);
  assert.match(runAgent, /setInterval/);
  assert.match(runAgent, /isOverBudget/);
  assert.match(runAgent, /killTree/);
  assert.match(runAgent, /15_000|15000/);
  assert.match(runAgent, /budgetExceeded/);
});

test("a budget abort ends in needs_intervention instead of a generic failure", () => {
  assert.match(server, /budgetExceeded/);
  assert.match(server, /Presupuesto/);
  assert.match(server, /needs_intervention/);
});
