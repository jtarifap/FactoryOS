import "./style.css";
import { renderJobSummary, renderModelTooltip } from "./safe-dom";

type AgentId = "factory-manager" | "developer" | "qa-reviewer" | "delivery-manager";
type Job = {
  id: string;
  name: string;
  request: string;
  status: string;
  phase: string;
  createdAt: string;
  updatedAt: string;
  directory: string;
  logs: string[];
  lastError?: string;
};
type ModelItem = { id: string; name?: string; providerID?: string; status?: string };
type ProjectItem = { name: string; path: string; hasPackage: boolean; hasIndex: boolean };
type Settings = {
  mode: "common" | "independent";
  commonModel: string;
  agentModels: Record<AgentId, string>;
  autoApprove: boolean;
  modelStatus?: Record<string, string>;
};

const app = document.querySelector<HTMLDivElement>("#app")!;
const tooltip = document.createElement("div");
tooltip.id = "model-tooltip";
document.body.appendChild(tooltip);

const state = {
  settings: null as Settings | null,
  models: [] as ModelItem[],
  jobs: [] as Job[],
  projects: [] as ProjectItem[],
  previewDirectory: "",
  openLogs: new Set<string>(),
  lastJobsSignature: "",
};

const els = {
  settingsBody: document.createElement("div"),
  settingsToggle: document.createElement("button"),
  settingsFeedback: document.createElement("p"),
  jobList: document.createElement("div"),
  projectSelect: document.createElement("select"),
  previewStatus: document.createElement("p"),
  previewLogs: document.createElement("pre"),
  previewFrame: document.createElement("iframe"),
};

function qs<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`No se encontró ${sel}`);
  return el;
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  return el;
}

function panel(title: string): HTMLElement {
  const section = create("section");
  section.className = "panel";
  section.appendChild(create("h2", title));
  return section;
}

function setTooltipForModel(select: HTMLSelectElement) {
  const show = () => {
    const model = state.models.find(m => m.id === select.value);
    if (!model) return;
    renderModelTooltip(document, tooltip, model);
    const r = select.getBoundingClientRect();
    tooltip.style.display = "block";
    tooltip.style.left = `${Math.min(r.left, window.innerWidth - 360)}px`;
    tooltip.style.top = `${r.bottom + 8 + window.scrollY}px`;
  };
  const hide = () => { tooltip.style.display = "none"; };
  select.addEventListener("mouseenter", show);
  select.addEventListener("focus", show);
  select.addEventListener("mouseleave", hide);
  select.addEventListener("blur", hide);
  select.addEventListener("change", hide);
}

function fillModelSelect(select: HTMLSelectElement, selected: string) {
  select.innerHTML = "";
  const grouped = new Map<string, ModelItem[]>();
  for (const model of state.models) {
    const key = model.providerID || "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(model);
  }
  for (const [provider, items] of grouped) {
    const group = document.createElement("optgroup");
    group.label = provider;
    for (const model of items) {
      const opt = document.createElement("option");
      opt.value = model.id;
      const suffix = state.settings?.modelStatus?.[model.id] === "no-results" ? " ⚠" :
                    state.settings?.modelStatus?.[model.id] === "ok" ? " ✔" : "";
      opt.textContent = `${model.name || model.id}${suffix}`;
      if (model.id === selected) opt.selected = true;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

function buildSettingsUI(): HTMLElement {
  const section = panel("Modelos de IA y configuración");

  const toggleRow = create("div");
  toggleRow.className = "actions-inline";
  els.settingsToggle.className = "secondary";
  els.settingsToggle.textContent = "Ocultar";
  els.settingsToggle.onclick = () => {
    const visible = els.settingsBody.hidden;
    els.settingsBody.hidden = !visible;
    els.settingsToggle.textContent = visible ? "Ocultar" : "Mostrar";
  };
  toggleRow.appendChild(els.settingsToggle);
  const validateBtn = create("button", "Validar configuración");
  validateBtn.className = "secondary";
  validateBtn.onclick = async () => {
    els.settingsFeedback.textContent = "Validando...";
    const r = await fetch("/api/settings/validate", { method: "POST" });
    const data = await r.json();
    els.settingsFeedback.textContent = data.ok ? "Configuración válida." : `Errores: ${data.errors?.join(" · ") || data.error || "desconocido"}`;
  };
  toggleRow.appendChild(validateBtn);
  section.appendChild(toggleRow);

  els.settingsBody.id = "settings-body";
  section.appendChild(els.settingsBody);

  const modeLabel = create("label", "Modo de selección");
  const modeSelect = document.createElement("select");
  modeSelect.id = "mode";
  modeSelect.appendChild(new Option("Independientes por agente", "independent"));
  modeSelect.appendChild(new Option("Modelo común", "common"));
  modeLabel.appendChild(modeSelect);
  els.settingsBody.appendChild(modeLabel);

  const commonLabel = create("label", "Modelo común / fallback");
  const commonSelect = document.createElement("select");
  commonSelect.id = "common-model";
  setTooltipForModel(commonSelect);
  const commonRow = create("div");
  commonRow.className = "row";
  const commonTest = create("button", "Probar");
  commonTest.type = "button";
  commonTest.className = "secondary test-model";
  commonTest.onclick = async () => {
    commonTest.disabled = true;
    commonTest.textContent = "Probando...";
    try {
      const model = commonSelect.value;
      const r = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, agent: "factory-manager" }),
      });
      const data = await r.json();
      els.settingsFeedback.textContent = r.ok && data.ok
        ? `OK: modelo común -> ${model}`
        : `Fallo: ${data.error || model}`;
      await loadSettings();
    } catch (error) {
      els.settingsFeedback.textContent = `Error al probar el modelo común: ${String(error)}`;
    } finally {
      commonTest.disabled = false;
      commonTest.textContent = "Probar";
    }
  };
  commonRow.appendChild(commonSelect);
  commonRow.appendChild(commonTest);
  commonLabel.appendChild(commonRow);
  els.settingsBody.appendChild(commonLabel);

  const grid = document.createElement("div");
  grid.className = "agent-grid";
  const agents: Array<{ id: AgentId; label: string }> = [
    { id: "factory-manager", label: "factory-manager" },
    { id: "developer", label: "developer" },
    { id: "qa-reviewer", label: "qa-reviewer" },
    { id: "delivery-manager", label: "delivery-manager" },
  ];
  for (const agent of agents) {
    const wrap = create("label", agent.label);
    const row = create("div");
    row.className = "row";
    const select = document.createElement("select");
    select.id = `model-${agent.id}`;
    setTooltipForModel(select);
    const test = create("button", "Probar");
    test.className = "secondary test-model";
    test.onclick = async () => {
      test.disabled = true;
      const prev = test.textContent || "Probar";
      test.textContent = "Probando...";
      try {
        const model = select.value;
        const r = await fetch("/api/models/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, agent: agent.id }),
        });
        const data = await r.json();
        els.settingsFeedback.textContent = data.ok ? `OK: ${agent.id} -> ${model}` : `Fallo: ${data.error || model}`;
        await loadSettings();
      } finally {
        test.disabled = false;
        test.textContent = prev;
      }
    };
    row.appendChild(select);
    row.appendChild(test);
    wrap.appendChild(row);
    grid.appendChild(wrap);
  }
  els.settingsBody.appendChild(grid);

  const autoWrap = create("label");
  autoWrap.className = "checkbox";
  const autoCheck = document.createElement("input");
  autoCheck.type = "checkbox";
  autoCheck.id = "auto-approve";
  const warning = create("p", "Si está desactivado, OpenCode rechazará permisos y los agentes no podrán crear archivos.");
  warning.className = "hint warning";
  warning.id = "auto-approve-warning";
  autoWrap.appendChild(autoCheck);
  autoWrap.appendChild(warning);
  els.settingsBody.appendChild(autoWrap);

  const save = create("button", "Guardar configuración");
  save.onclick = async (ev) => {
    ev.preventDefault();
    els.settingsFeedback.textContent = "Guardando...";
    const mode = modeSelect.value as Settings["mode"];
    const commonModel = commonSelect.value;
    const payload: Settings = {
      mode,
      commonModel,
      autoApprove: autoCheck.checked,
      agentModels: mode === "common"
        ? {
            "factory-manager": commonModel,
            developer: commonModel,
            "qa-reviewer": commonModel,
            "delivery-manager": commonModel,
          }
        : {
            "factory-manager": (document.getElementById("model-factory-manager") as HTMLSelectElement).value,
            developer: (document.getElementById("model-developer") as HTMLSelectElement).value,
            "qa-reviewer": (document.getElementById("model-qa-reviewer") as HTMLSelectElement).value,
            "delivery-manager": (document.getElementById("model-delivery-manager") as HTMLSelectElement).value,
          },
    };
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    els.settingsFeedback.textContent = r.ok ? "Configuración guardada." : data.error || "Error al guardar";
    await loadSettings();
  };
  els.settingsBody.appendChild(save);
  els.settingsBody.appendChild(els.settingsFeedback);

  modeSelect.onchange = () => {
    grid.hidden = modeSelect.value === "common";
  };
  autoCheck.onchange = () => {
    warning.hidden = autoCheck.checked;
  };

  return section;
}

function renderJobs(): HTMLElement {
  const section = panel("Trabajos");
  const refresh = create("button", "Actualizar");
  refresh.className = "secondary";
  refresh.onclick = () => loadJobs();
  section.appendChild(refresh);

  els.jobList.className = "jobs";
  section.appendChild(els.jobList);
  return section;
}

function renderCreateJob(): HTMLElement {
  const section = panel("Nuevo proyecto / modificar existente");
  const form = document.createElement("form");
  const name = document.createElement("input");
  name.placeholder = "Nombre del proyecto";
  const request = document.createElement("textarea");
  request.rows = 5;
  request.placeholder = "Describe lo que quieres construir o modificar";
  const directory = document.createElement("select");
  directory.dataset.role = "existing-directory";
  directory.innerHTML = `<option value="">Crear nuevo proyecto</option>`;
  const submit = create("button", "Crear y ejecutar");
  const feedback = create("p");
  feedback.className = "hint";

  form.appendChild(create("label", "Nombre"));
  form.appendChild(name);
  form.appendChild(create("label", "Solicitud"));
  form.appendChild(request);
  form.appendChild(create("label", "Proyecto existente (opcional)"));
  form.appendChild(directory);
  form.appendChild(submit);
  form.appendChild(feedback);

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    feedback.textContent = "Enviando...";
    const payload: Record<string, string> = {
      name: name.value.trim(),
      request: request.value.trim(),
    };
    if (directory.value) payload.directory = directory.value;
    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      feedback.textContent = data.error || "No se pudo crear el trabajo";
      return;
    }
    feedback.textContent = `Trabajo creado: ${data.id}`;
    name.value = "";
    request.value = "";
    await loadJobs();
    await loadProjects();
  };

  section.appendChild(form);
  return section;
}

function renderPreview(): HTMLElement {
  const section = panel("Vista previa y ZIP");
  const row = create("div");
  row.className = "actions-inline";

  els.projectSelect.innerHTML = `<option value="">Selecciona proyecto...</option>`;
  row.appendChild(els.projectSelect);

  const start = create("button", "Arrancar");
  const stop = create("button", "Detener");
  stop.className = "danger";
  const zip = create("button", "Generar ZIP");
  zip.className = "secondary";
  row.appendChild(start);
  row.appendChild(stop);
  row.appendChild(zip);

  els.previewStatus.className = "hint";
  els.previewLogs.textContent = "";
  els.previewFrame.style.width = "100%";
  els.previewFrame.style.height = "420px";
  els.previewFrame.style.border = "0";
  els.previewFrame.hidden = true;

  section.appendChild(row);
  section.appendChild(els.previewStatus);
  section.appendChild(els.previewFrame);
  section.appendChild(els.previewLogs);

  start.onclick = async () => {
    const dir = els.projectSelect.value;
    if (!dir) return;
    els.previewStatus.textContent = "Arrancando...";
    const r = await fetch("/api/preview/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: dir }),
    });
    const data = await r.json();
    if (!r.ok) {
      els.previewStatus.textContent = data.error || "No se pudo arrancar la vista previa";
      return;
    }
    els.previewStatus.textContent = data.mode === "static" ? `Vista previa estática: ${data.url}` : `Vista previa activa: ${data.url}`;
    if (data.url) {
      els.previewFrame.src = data.url;
      els.previewFrame.hidden = false;
    }
    if (Array.isArray(data.logs)) els.previewLogs.textContent = data.logs.join("\n");
  };

  stop.onclick = async () => {
    const dir = els.projectSelect.value;
    if (!dir) return;
    await fetch("/api/preview/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: dir }),
    });
    els.previewStatus.textContent = "Vista previa detenida.";
    els.previewFrame.hidden = true;
    els.previewFrame.removeAttribute("src");
  };

  zip.onclick = async () => {
    const dir = els.projectSelect.value;
    if (!dir) return;
    const r = await fetch(`/api/projects/zip?directory=${encodeURIComponent(dir)}`);
    if (!r.ok) {
      let message = "No se pudo generar el ZIP";
      try {
        const data = await r.json();
        message = data.error || message;
        if (Array.isArray(data.files) && data.files.length) message += `\n${data.files.join("\n")}`;
      } catch {}
      window.alert(message);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dir}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return section;
}

function renderHeader(): HTMLElement {
  const header = document.createElement("header");
  const left = document.createElement("div");
  const brand = document.createElement("div");
  brand.className = "brand";
  const svg = document.createElement("div");
  svg.innerHTML = '<svg width="32" height="32" viewBox="0 0 64 64" role="img" aria-label="FactoryOS"><path d="M8 54V32L22 22V32L36 22V32L50 22V54Z" fill="none" stroke="#ff9f1c" stroke-width="4" stroke-linejoin="miter"></path><rect x="26" y="40" width="10" height="14" fill="#ff9f1c"></rect></svg>';
  brand.appendChild(svg);
  const name = document.createElement("span");
  name.className = "brand-name";
  name.innerHTML = "Factory<span>OS</span>";
  brand.appendChild(name);
  left.appendChild(brand);
  const lead = create("p", "Agentes OpenCode · Brain STATIC/SIMPLE/COMPLEJA · Preview local · ZIP · Modificación");
  left.appendChild(lead);
  const badge = create("span", "Local / Windows");
  badge.className = "chip";
  header.appendChild(left);
  header.appendChild(badge);
  return header;
}

async function loadSettings() {
  const r = await fetch("/api/settings");
  const data = await r.json();
  state.settings = data as Settings;
  const preservedSelections = [
    "common-model",
    "model-factory-manager",
    "model-developer",
    "model-qa-reviewer",
    "model-delivery-manager",
  ].map(id => ({
    id,
    value: (document.getElementById(id) as HTMLSelectElement | null)?.value ?? "",
  }));
  const mode = qs<HTMLSelectElement>("#mode");
  const common = qs<HTMLSelectElement>("#common-model");
  const auto = qs<HTMLInputElement>("#auto-approve");
  const grid = qs<HTMLDivElement>(".agent-grid");
  mode.value = state.settings.mode;
  common.value = state.settings.commonModel;
  auto.checked = !!state.settings.autoApprove;
  grid.hidden = state.settings.mode === "common";
  (document.getElementById("auto-approve-warning") as HTMLElement).hidden = auto.checked;
  if (state.models.length) populateAllModelSelects();
  for (const { id, value } of preservedSelections) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select && value && Array.from(select.options).some(option => option.value === value)) select.value = value;
  }
}

function populateAllModelSelects() {
  if (!state.settings) return;
  fillModelSelect(qs<HTMLSelectElement>("#common-model"), state.settings.commonModel);
  fillModelSelect(qs<HTMLSelectElement>("#model-factory-manager"), state.settings.agentModels["factory-manager"]);
  fillModelSelect(qs<HTMLSelectElement>("#model-developer"), state.settings.agentModels.developer);
  fillModelSelect(qs<HTMLSelectElement>("#model-qa-reviewer"), state.settings.agentModels["qa-reviewer"]);
  fillModelSelect(qs<HTMLSelectElement>("#model-delivery-manager"), state.settings.agentModels["delivery-manager"]);
}

async function loadModels() {
  const r = await fetch("/api/models");
  const data = await r.json();
  state.models = data.models || [];
  populateAllModelSelects();
}

async function loadJobs() {
  const r = await fetch("/api/jobs");
  const jobs = (await r.json()) as Job[];
  const sig = JSON.stringify(jobs.map(j => [j.id, j.status, j.phase, j.updatedAt, j.lastError, (j.logs || []).length]));
  if (sig === state.lastJobsSignature) return;
  state.lastJobsSignature = sig;
  state.jobs = jobs;
  els.jobList.innerHTML = "";

  for (const job of jobs) {
    const card = document.createElement("article");
    const top = renderJobSummary(document, job);
    card.appendChild(top);

    const meta = create("small", `ID: ${job.id} · Actualizado: ${job.updatedAt}`);
    card.appendChild(meta);

    const req = create("p", job.request);
    req.className = "hint";
    card.appendChild(req);

    if (job.lastError) {
      const err = create("div", `Error: ${job.lastError}`);
      err.className = "job-error";
      card.appendChild(err);
    }

    const actions = create("div");
    actions.className = "actions";
    if (job.status === "queued" || job.status === "running") {
      const cancel = create("button", "Cancelar");
      cancel.className = "danger";
      cancel.onclick = async () => { await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" }); await loadJobs(); };
      actions.appendChild(cancel);
    }
    if (["failed", "cancelled", "needs_intervention"].includes(job.status)) {
      const retry = create("button", "Reintentar");
      retry.className = "secondary";
      retry.onclick = async () => { await fetch(`/api/jobs/${job.id}/retry`, { method: "POST" }); await loadJobs(); };
      actions.appendChild(retry);
    }
    if (["done", "validated", "needs_intervention"].includes(job.status)) {
      const zip = create("button", "ZIP");
      zip.className = "secondary";
      zip.onclick = async () => {
        const r = await fetch(`/api/projects/zip?directory=${encodeURIComponent(job.directory)}`);
        if (!r.ok) {
          let message = "No se pudo generar el ZIP";
          try {
            const data = await r.json();
            message = data.error || message;
            if (Array.isArray(data.files) && data.files.length) message += `\n${data.files.join("\n")}`;
          } catch {}
          window.alert(message);
          return;
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${job.directory.split(/[\\/]/).pop() || "proyecto"}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      };
      actions.appendChild(zip);
    }
    const del = create("button", "Borrar");
    del.className = "danger";
    del.onclick = async () => {
      if (!confirm("Borrar este trabajo del listado?")) return;
      await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
      await loadJobs();
    };
    actions.appendChild(del);
    card.appendChild(actions);

    const details = document.createElement("details");
    details.open = state.openLogs.has(job.id);
    const summary = create("summary", `Ver registro (${(job.logs || []).length} líneas)`);
    details.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = (job.logs || []).slice(-200).join("\n");
    details.appendChild(pre);
    details.ontoggle = () => {
      if (details.open) state.openLogs.add(job.id);
      else state.openLogs.delete(job.id);
    };
    card.appendChild(details);

    els.jobList.appendChild(card);
  }
}

async function loadProjects() {
  const r = await fetch("/api/projects");
  state.projects = await r.json();
  // Capture after the request: the user may change selection while it is pending.
  const selectedProject = els.projectSelect.value;
  const dirSelect = document.querySelector("select[data-role='existing-directory']") as HTMLSelectElement | null;
  const selectedDirectory = dirSelect?.value || "";
  els.projectSelect.innerHTML = `<option value="">Selecciona proyecto...</option>`;
  if (dirSelect) dirSelect.innerHTML = `<option value="">Crear nuevo proyecto</option>`;
  for (const project of state.projects) {
    const opt = document.createElement("option");
    opt.value = project.name;
    opt.textContent = `${project.name}${project.hasIndex ? " · static" : ""}${project.hasPackage ? " · app" : ""}`;
    els.projectSelect.appendChild(opt);
    if (dirSelect) dirSelect.appendChild(opt.cloneNode(true));
  }
  els.projectSelect.value = state.projects.some(project => project.name === selectedProject) ? selectedProject : "";
  if (dirSelect) dirSelect.value = state.projects.some(project => project.name === selectedDirectory) ? selectedDirectory : "";
}

function buildApp() {
  const main = document.createElement("main");
  main.appendChild(renderHeader());
  main.appendChild(buildSettingsUI());
  main.appendChild(renderCreateJob());
  main.appendChild(renderJobs());
  main.appendChild(renderPreview());
  app.appendChild(main);
}

buildApp();
loadSettings().catch(() => void 0);
loadModels().catch(() => void 0);
loadProjects().catch(() => void 0);
loadJobs().catch(() => void 0);
setInterval(() => { loadJobs().catch(() => void 0); loadProjects().catch(() => void 0); }, 3000);
