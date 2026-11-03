export type ModelItem = { id: string; name?: string; providerID?: string; status?: string };
export type ModelOption = { value: string; label: string; selected: boolean };
export type ModelGroup = { provider: string; options: ModelOption[] };

const statusSuffix = (status: string | undefined): string =>
  status === "no-results" ? " ⚠" : status === "ok" ? " ✔" : "";

/**
 * Builds the groups shown in the model selectors: one group per provider and,
 * when the configured model is not part of the catalog, an extra group that keeps
 * the current selection visible instead of silently dropping it.
 */
export function buildModelGroups(
  models: ModelItem[],
  selected: string,
  modelStatus?: Record<string, string>
): ModelGroup[] {
  const groups = new Map<string, ModelOption[]>();
  const known = new Set<string>();

  for (const model of models) {
    const provider = model.providerID || "unknown";
    if (!groups.has(provider)) groups.set(provider, []);
    known.add(model.id);
    groups.get(provider)!.push({
      value: model.id,
      label: `${model.name || model.id}${statusSuffix(modelStatus?.[model.id])}`,
      selected: model.id === selected
    });
  }

  const selectedId = selected.trim();
  if (selectedId && !known.has(selectedId)) {
    groups.set("no disponible", [{
      value: selectedId,
      label: `${selectedId} (no disponible)`,
      selected: true
    }]);
  }

  return [...groups.entries()].map(([provider, options]) => ({ provider, options }));
}
