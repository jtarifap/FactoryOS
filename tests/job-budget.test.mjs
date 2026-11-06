import assert from "node:assert/strict";
import test from "node:test";
import { isOverBudget, resolveBudget } from "../server/job-budget.ts";
import { QUICK_SCOPE_BUDGET } from "../server/modification-scope.ts";

test("the quick scope always uses its fixed budget", () => {
  assert.equal(resolveBudget("quick", 900_000), QUICK_SCOPE_BUDGET);
  assert.equal(resolveBudget("quick", undefined), QUICK_SCOPE_BUDGET);
});

test("the full scope honors the plan budget", () => {
  assert.equal(resolveBudget("full", 200_000), 200_000);
  assert.equal(resolveBudget("full", "150000"), 150_000);
});

test("missing or invalid full budgets fall back to the default", () => {
  for (const value of [undefined, null, 0, -1, "abc", {}, [], Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveBudget("full", value), 200_000, String(value));
  }
});

test("a budget is exceeded only when usage is strictly greater", () => {
  assert.equal(isOverBudget(60_000, 60_000), false);
  assert.equal(isOverBudget(60_001, 60_000), true);
  assert.equal(isOverBudget(0, 60_000), false);
});
