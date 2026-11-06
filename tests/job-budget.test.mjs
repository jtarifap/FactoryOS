import assert from "node:assert/strict";
import test from "node:test";
import { UNLIMITED_BUDGET, isOverBudget, resolveBudget } from "../server/job-budget.ts";

function withEnv(value, run) {
  const previous = process.env.FACTORYOS_TOKEN_BUDGET;
  if (value === undefined) delete process.env.FACTORYOS_TOKEN_BUDGET;
  else process.env.FACTORYOS_TOKEN_BUDGET = value;
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env.FACTORYOS_TOKEN_BUDGET;
    else process.env.FACTORYOS_TOKEN_BUDGET = previous;
  }
}

test("there is no token limit by default", () => {
  withEnv(undefined, () => {
    assert.equal(UNLIMITED_BUDGET, 0);
    assert.equal(resolveBudget("quick", 50_000), 0);
    assert.equal(resolveBudget("full", 50_000), 0);
    assert.equal(resolveBudget("full", undefined), 0);
  });
});

test("the limit can be re-enabled with an environment variable", () => {
  withEnv("250000", () => {
    assert.equal(resolveBudget("quick", undefined), 250_000);
    assert.equal(resolveBudget("full", 50_000), 250_000);
  });
});

test("invalid limit values keep the budget unlimited", () => {
  for (const value of ["", "0", "-5", "abc", "Infinity"]) {
    withEnv(value, () => assert.equal(resolveBudget("quick", undefined), 0, value));
  }
});

test("an unlimited budget is never exceeded", () => {
  assert.equal(isOverBudget(10_000_000, UNLIMITED_BUDGET), false);
  assert.equal(isOverBudget(60_001, 60_000), true);
  assert.equal(isOverBudget(60_000, 60_000), false);
});
