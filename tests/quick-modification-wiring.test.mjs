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

test("a quick modification runs the primary quick agent, not a subagent", () => {
  assert.match(server, /scope === "quick"/);
  const quick = server.slice(server.indexOf('scope === "quick"'), server.indexOf('scope === "quick"') + 1800);
  // opencode rejects `run --agent` with a subagent, so the quick path uses a
  // dedicated primary agent with the developer's configured model.
  assert.match(quick, /runAgentFor\(j, "quick-developer", effectiveModel\("developer"\)/);
  assert.doesNotMatch(quick, /runAgent\(j, "developer"/);
  assert.doesNotMatch(quick, /runAgent\(j, "factory-manager"/);
  assert.match(quick, /verifyProject\(j\)/);
  assert.match(quick, /"done"/);
  assert.match(quick, /Cambio aplicado/);
});

test("the quick agent is a primary agent that can edit files", () => {
  const quickAgent = fs.readFileSync(new URL("../.opencode/agents/quick-developer.md", import.meta.url), "utf8");
  assert.match(quickAgent, /^mode: primary$/m);
  assert.match(quickAgent, /^\s*edit:\s*true\s*$/m);
  assert.match(quickAgent, /^\s*write:\s*true\s*$/m);
});

test("every agent phase enforces the token budget with a live check", () => {
  const start = server.indexOf("function runAgentFor(");
  const end = server.indexOf("function runAgent(", start);
  const runAgent = server.slice(start, end);
  assert.ok(start >= 0 && end > start, "No se encontro runAgent");
  assert.match(server, /from "\.\/job-budget\.js"/);
  assert.match(runAgent, /readTokenUsageFromDb/);
  assert.match(runAgent, /setInterval/);
  assert.match(runAgent, /isOverBudget/);
  assert.match(runAgent, /killTree/);
  assert.match(runAgent, /5_000|5000/);
  assert.match(runAgent, /budgetExceeded/);
});

test("a budget abort ends in needs_intervention instead of a generic failure", () => {
  assert.match(server, /budgetExceeded/);
  assert.match(server, /Presupuesto/);
  assert.match(server, /needs_intervention/);
});

test("the budget reason is not overwritten when the killed process closes", () => {
  const runnerStart = server.indexOf("function runAgentFor(");
  const closeStart = server.indexOf('child.on("close"', runnerStart);
  const closeHandler = server.slice(closeStart, closeStart + 1600);
  const budgetGuard = closeHandler.indexOf("j.budgetExceeded");
  const genericReason = closeHandler.indexOf("detectModelError");
  assert.ok(budgetGuard >= 0, "The close handler must keep the budget reason");
  assert.ok(budgetGuard < genericReason, "The budget reason must be checked before the generic reason");
});

test("a subagent cannot be launched directly: the runner aborts instead of falling back", () => {
  assert.match(server, /is a subagent, not a primary agent/i);
  const runnerStart = server.indexOf("function runAgentFor(");
  const onData = server.slice(server.indexOf("const onData =", runnerStart), server.indexOf("child.stdout!.on(", runnerStart));
  assert.ok(runnerStart >= 0 && onData.length > 0, "Missing the agent runner data handler");
  assert.match(onData, /killTree\(child\)/);
});
