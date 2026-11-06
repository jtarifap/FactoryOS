import { QUICK_SCOPE_BUDGET, type ModificationScope } from "./modification-scope.js";

/** Used when a full job has no usable budget in `factory/plan.json`. */
export const DEFAULT_FULL_BUDGET = 200_000;

/** Budget the worker must respect for a job. */
export function resolveBudget(scope: ModificationScope, planBudget: unknown): number {
  if (scope === "quick") return QUICK_SCOPE_BUDGET;
  if (typeof planBudget === "number" && Number.isFinite(planBudget) && planBudget > 0) return planBudget;
  if (typeof planBudget === "string" && planBudget.trim()) {
    const parsed = Number(planBudget);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_FULL_BUDGET;
}

/** Usage above the limit means the worker must stop the current phase. */
export function isOverBudget(used: number, budget: number): boolean {
  return used > budget;
}
