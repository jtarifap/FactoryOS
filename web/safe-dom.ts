export type SafeJobSummary = { name: string; status: string; phase: string };
export type SafeModelInfo = { name?: string; id: string; providerID?: string; status?: string };

export function renderJobSummary(document: Document, job: SafeJobSummary): HTMLDivElement {
  const summary = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = job.name;
  const status = document.createElement("span");
  status.className = `status status-${job.status}`;
  status.textContent = job.status;
  const phase = document.createElement("span");
  phase.textContent = ` · ${job.phase}`;
  summary.append(name, status, phase);
  return summary;
}

export function renderModelTooltip(document: Document, tooltip: HTMLElement, model: SafeModelInfo): void {
  tooltip.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = model.name || model.id;
  tooltip.appendChild(title);

  const row = (label: string, value: string) => {
    const wrapper = document.createElement("div");
    wrapper.className = "tt-row";
    const key = document.createElement("b");
    key.textContent = label;
    const text = document.createElement("span");
    text.textContent = value;
    wrapper.append(key, text);
    tooltip.appendChild(wrapper);
  };
  row("ID", model.id);
  row("Proveedor", model.providerID || "-");
  row("Estado", model.status || "-");
}
