/**
 * Token budget policy.
 *
 * There is no limit by default: the total token counter includes cache reads,
 * and re-reading the base context in every turn inflates it far beyond the real
 * work (a two-turn CSS tweak shows ~155k tokens and costs ~$0.01). Set
 * `FACTORYOS_TOKEN_BUDGET` to a positive number to re-enable the guard.
 */
export const UNLIMITED_BUDGET = 0;

export function configuredBudget(): number {
  const raw = Number(process.env.FACTORYOS_TOKEN_BUDGET ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : UNLIMITED_BUDGET;
}

/** Budget the worker must respect for a job. Zero means unlimited. */
export function resolveBudget(_scope: "quick" | "full", _planBudget: unknown): number {
  return configuredBudget();
}

/** Usage above the limit means the worker must stop the current phase. */
export function isOverBudget(used: number, budget: number): boolean {
  return budget > 0 && used > budget;
}
