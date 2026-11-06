import { QUICK_SCOPE_BUDGET, type ModificationScope } from "./modification-scope.js";

/**
 * Minimum budget for a full job. A single agent turn already costs ~75k tokens
 * of base context (system prompt, tools and project bootstrap), so a smaller
 * declared budget would abort the pipeline before it does any work.
 */
export const DEFAULT_FULL_BUDGET = 400_000;

/** Budget the worker must respect for a job. */
export function resolveBudget(scope: ModificationScope, planBudget: unknown): number {
  if (scope === "quick") return QUICK_SCOPE_BUDGET;
  let declared = 0;
  if (typeof planBudget === "number" && Number.isFinite(planBudget) && planBudget > 0) {
    declared = planBudget;
  } else if (typeof planBudget === "string" && planBudget.trim()) {
    const parsed = Number(planBudget);
    if (Number.isFinite(parsed) && parsed > 0) declared = parsed;
  }
  // The floor keeps a plan written for the old, unenforced budgets usable.
  return Math.max(declared, DEFAULT_FULL_BUDGET);
}

/** Usage above the limit means the worker must stop the current phase. */
export function isOverBudget(used: number, budget: number): boolean {
  return used > budget;
}
