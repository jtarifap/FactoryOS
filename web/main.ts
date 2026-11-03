import "./style.css";
import { renderJobSummary, renderModelTooltip } from "./safe-dom";
import { buildModelGroups, type ModelItem } from "./model-select";
import { buildDashboardRows, buildDashboardStats, type DashboardJob } from "./dashboard";
import { DEFAULT_VIEW, MENU_ITEMS, hashForView, viewFromHash, type ViewId } from "./navigation";
import { readTheme, THEME_STORAGE_KEY, toggleTheme, type Theme } from "./theme";
import { addTokenUsage, emptyTokenUsage, formatCost, formatTokenUsage, type TokenUsage } from "../shared/token-usage";

type AgentId = "factory-manager" | "developer" | "qa-reviewer" | "delivery-manager" | "disenador" | "auditoria-seguridad";
type Job = {
  id: string;
  name: string;
  request: string;
  requestKind?: "project" | "question";
  answer?: string;
  tokens?: TokenUsage;
  status: string;
  phase: string;
  createdAt: string;
  updatedAt: string;
  directory: string;
  logs: string[];
  lastError?: string;
};
type ProjectItem = { name: string; path: string; hasPackage: boolean; hasIndex: boolean };
type Settings = {
  mode: "common" | "independent";
  commonModel: string;
  agentModels: Record<AgentId, string>;
  autoApprove: boolean;
  modelStatus?: Record<string, string>;
  agentModelConfigVersion?: 2;
};

const app = document.querySelector<HTMLDivElement>("#app")!;
let activeTheme: Theme;
try {
  activeTheme = readTheme(window.localStorage);
} catch {
  activeTheme = "dark";
}
document.documentElement.dataset.theme = activeTheme;

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
  activeConsultationId: "",
  consultationSelectionInitialized: false,
  activeView: DEFAULT_VIEW as ViewId,
};

let consultationOutputField: HTMLTextAreaElement | null = null;
const AGENTS: Array<{ id: AgentId; label: string }> = [
  { id: "factory-manager", label: "factory-manager" },
  { id: "developer", label: "developer" },
  { id: "qa-reviewer", label: "qa-reviewer" },
  { id: "delivery-manager", label: "delivery-manager" },
  { id: "disenador", label: "disenador" },
  { id: "auditoria-seguridad", label: "auditoria-seguridad" },
];

const els = {
  settingsBody: document.createElement("div"),
  settingsToggle: document.createElement("button"),
  settingsFeedback: document.createElement("p"),
  jobList: document.createElement("div"),
  projectSelect: document.createElement("select"),
  previewStatus: document.createElement("p"),
  previewLogs: document.createElement("pre"),
  previewFrame: document.createElement("iframe"),
  previewArgs: document.createElement("input"),
  previewLink: document.createElement("a"),
  dashboardCards: document.createElement("div"),
  dashboardTable: document.createElement("div"),
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

function panel(title?: string): HTMLElement {
  const section = create("section");
  section.className = "panel";
  if (title) section.appendChild(create("h2", title));
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
  const groups = buildModelGroups(state.models, selected, state.settings?.modelStatus);
  for (const group of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.provider;
    for (const option of group.options) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      opt.selected = option.selected;
      optgroup.appendChild(opt);
    }
    select.appendChild(optgroup);
  }
  if (selected) select.value = selected;
}

async function testModel(select: HTMLSelectElement, agent: AgentId, button: HTMLButtonElement) {
  button.disabled = true;
  const previousText = button.textContent || "Probar";
  button.textContent = "Probando...";
  try {
    const model = select.value;
    const r = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, agent }),
    });
    const data = await r.json();
    els.settingsFeedback.textContent = r.ok && data.ok
      ? `OK: ${agent} -> ${model}`
      : `Fallo: ${data.error || model}`;
    await loadSettings();
  } catch (error) {
    els.settingsFeedback.textContent = `Error al probar ${agent}: ${String(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

function buildSettingsUI(): HTMLElement {
  const section = panel();

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

  const commonLabel = create("label", "Modelo común");
  const commonSelect = document.createElement("select");
  commonSelect.id = "common-model";
  setTooltipForModel(commonSelect);
  const commonRow = create("div");
  commonRow.className = "row";
  const commonTest = create("button", "Probar");
  commonTest.type = "button";
  commonTest.className = "secondary test-model";
  commonTest.onclick = () => testModel(commonSelect, "factory-manager", commonTest);
  commonRow.appendChild(commonSelect);
  commonRow.appendChild(commonTest);
  commonLabel.appendChild(commonRow);
  commonLabel.id = "common-model-section";
  commonLabel.hidden = true;
  els.settingsBody.appendChild(commonLabel);

  const grid = document.createElement("div");
  grid.className = "agent-grid";
  for (const agent of AGENTS) {
    const wrap = create("label", agent.label);
    const row = create("div");
    row.className = "row";
    const select = document.createElement("select");
    select.id = `model-${agent.id}`;
    setTooltipForModel(select);
    const test = create("button", "Probar");
    test.type = "button";
    test.className = "secondary test-model";
    test.onclick = () => testModel(select, agent.id, test);
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
    const agentModels = Object.fromEntries(AGENTS.map(agent => [
      agent.id,
      mode === "common"
        ? commonModel
        : (document.getElementById(`model-${agent.id}`) as HTMLSelectElement).value,
    ])) as Record<AgentId, string>;
    const payload: Settings = {
      mode,
      commonModel,
      autoApprove: autoCheck.checked,
      agentModels,
    };
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    els.settingsFeedback.textContent = r.ok ? "Configuración guardada." : data.error || "Error al guardar";
    await loadSettings(false);
  };
  els.settingsBody.appendChild(save);
  els.settingsBody.appendChild(els.settingsFeedback);


  modeSelect.onchange = () => {
    const commonMode = modeSelect.value === "common";
    commonLabel.hidden = !commonMode;
    grid.hidden = commonMode;
  };
  autoCheck.onchange = () => {
    warning.hidden = autoCheck.checked;
  };

  return section;
}

function renderJobs(): HTMLElement {
  const section = panel();
  const refresh = create("button", "Actualizar");
  refresh.className = "secondary";
  refresh.onclick = () => loadJobs();
  section.appendChild(refresh);

  els.jobList.className = "jobs";
  section.appendChild(els.jobList);
  return section;
}

function renderCreateJob(): HTMLElement {
  const section = panel();
  const form = document.createElement("form");
  const requestKind = document.createElement("select");
  requestKind.id = "request-kind";
  requestKind.appendChild(new Option("Proyecto", "project"));
  requestKind.appendChild(new Option("Consulta", "question"));
  requestKind.value = "project";
  const name = document.createElement("input");
  name.placeholder = "Nombre del proyecto";
  const request = document.createElement("textarea");
  request.rows = 5;
  request.placeholder = "Describe lo que quieres construir, modificar o consultar";
  consultationOutputField = request;
  const directory = document.createElement("select");
  directory.dataset.role = "existing-directory";
  directory.innerHTML = `<option value="">Crear nuevo proyecto</option>`;
  const submit = create("button", "Crear y ejecutar");
  const feedback = create("p");
  feedback.className = "hint";

  form.appendChild(create("label", "Tipo de solicitud"));
  form.appendChild(requestKind);
  const nameLabel = create("label", "Nombre");
  const requestLabel = create("label", "Solicitud");
  const directoryLabel = create("label", "Proyecto existente (opcional)");
  form.appendChild(nameLabel);
  form.appendChild(name);
  form.appendChild(requestLabel);
  form.appendChild(request);
  form.appendChild(directoryLabel);
  form.appendChild(directory);
  form.appendChild(submit);
  form.appendChild(feedback);

  let currentKind = requestKind.value;
  const updateFormMode = (clearFields = false) => {
    const isQuestion = requestKind.value === "question";
    if (clearFields || requestKind.value !== currentKind) {
      name.value = "";
      request.value = "";
      state.activeConsultationId = "";
      state.consultationSelectionInitialized = true;
    }
    currentKind = requestKind.value;
    if (isQuestion) directory.value = "";
    nameLabel.hidden = false;
    nameLabel.textContent = isQuestion ? "Consultar" : "Nombre";
    name.placeholder = isQuestion ? "Escribe aquí tu consulta" : "Nombre del proyecto";
    name.hidden = false;
    requestLabel.textContent = isQuestion ? "Respuestas" : "Solicitud";
    request.placeholder = isQuestion ? "Respuestas a tus consultas" : "Describe lo que quieres construir o modificar";
    request.readOnly = isQuestion;
    directoryLabel.hidden = isQuestion;
    directory.hidden = isQuestion;
    submit.textContent = isQuestion
      ? "Consultar"
      : directory.value ? "Modificar proyecto" : "Crear y ejecutar";
  };
  requestKind.onchange = () => updateFormMode(true);
  directory.onchange = () => updateFormMode();

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    feedback.textContent = "Enviando...";
    const kind = requestKind.value === "question" ? "question" : "project";
    const payload: Record<string, string> = {
      name: kind === "question" ? "Consulta" : name.value.trim(),
      request: kind === "question" ? name.value.trim() : request.value.trim(),
      requestKind: kind,
    };
    if (kind === "project" && directory.value) payload.directory = directory.value;
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
    feedback.textContent = kind === "question"
      ? `Consulta enviada a Factory-manager: ${data.id}.`
      : directory.value
        ? `Proyecto modificado: ${name.value.trim()} (${directory.value})`
        : `Trabajo creado: ${data.id}`;
    if (kind === "question") {
      state.activeConsultationId = data.id;
      state.consultationSelectionInitialized = true;
      request.value = "Consultando...";
    } else {
      name.value = "";
      request.value = "";
      directory.selectedIndex = 0;
      updateFormMode();
    }
    await loadJobs();
    await loadProjects();
  };

  section.appendChild(form);
  return section;
}

function renderPreview(): HTMLElement {
  const section = panel();
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

  const argsLabel = create("label", "Argumentos extra del script (opcional)");
  els.previewArgs.id = "preview-args";
  els.previewArgs.placeholder = "--host 0.0.0.0 --port 4000";
  els.previewArgs.autocomplete = "off";
  argsLabel.appendChild(els.previewArgs);

  els.previewStatus.className = "hint";
  els.previewLogs.textContent = "";
  els.previewFrame.style.width = "100%";
  els.previewFrame.style.height = "420px";
  els.previewFrame.style.border = "0";
  els.previewFrame.hidden = true;
  els.previewFrame.title = "Vista previa de la app";
  els.previewLink.className = "preview-link";
  els.previewLink.hidden = true;
  els.previewLink.target = "_blank";
  els.previewLink.rel = "noopener";

  section.appendChild(row);
  section.appendChild(argsLabel);
  section.appendChild(els.previewStatus);
  section.appendChild(els.previewLink);
  section.appendChild(els.previewFrame);
  section.appendChild(els.previewLogs);

  start.onclick = async () => {
    const dir = els.projectSelect.value;
    if (!dir) {
      els.previewStatus.textContent = "Selecciona primero un proyecto.";
      return;
    }
    els.previewStatus.textContent = "Arrancando la app (puede tardar si hay que instalar dependencias)...";
    els.previewLink.hidden = true;
    const r = await fetch("/api/preview/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: dir, args: els.previewArgs.value }),
    });
    const data = await r.json();
    if (!r.ok) {
      els.previewStatus.textContent = data.error || "No se pudo arrancar la vista previa";
      els.previewFrame.hidden = true;
      els.previewFrame.removeAttribute("src");
      els.previewLink.hidden = true;
      els.previewLogs.textContent = Array.isArray(data.logs) ? data.logs.join("\n") : "";
      return;
    }
    const script = data.script ? ` (script: ${data.script})` : "";
    els.previewStatus.textContent = data.mode === "static"
      ? `Vista previa estatica: ${data.url}`
      : `Vista previa activa${script}: ${data.url}`;
    els.previewLink.href = data.url;
    els.previewLink.textContent = "Abrir la app en una pestana nueva";
    els.previewLink.hidden = false;
    if (data.url) {
      // Clearing it first forces a reload when the same project is started again.
      els.previewFrame.removeAttribute("src");
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
    els.previewLink.hidden = true;
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
  const brand = document.createElement("a");
  brand.className = "brand";
  brand.href = "/";
  const svg = document.createElement("div");
  svg.innerHTML = '<svg width="32" height="32" viewBox="0 11 64 64" role="img" aria-label="FactoryOS"><path d="M8 54V32L22 22V32L36 22V32L50 22V54Z" fill="none" stroke="#ff9f1c" stroke-width="4" stroke-linejoin="miter"></path><rect x="26" y="40" width="10" height="14" fill="#ff9f1c"></rect></svg>';
  brand.appendChild(svg);
  const name = document.createElement("span");
  name.className = "brand-name";
  name.innerHTML = "Factory<span>OS</span>";
  brand.appendChild(name);
  left.appendChild(brand);

  const themeToggle = create("button");
  themeToggle.type = "button";
  themeToggle.className = "secondary theme-toggle";
  const updateThemeToggle = () => {
    const nextTheme = toggleTheme(activeTheme);
    const action = nextTheme === "light" ? "claro" : "oscuro";
    themeToggle.setAttribute("aria-label", `Cambiar a tema ${action}`);
    themeToggle.title = `Cambiar a tema ${action}`;
    themeToggle.innerHTML = nextTheme === "light"
      ? '<svg data-icon="sun" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>'
      : '<svg data-icon="moon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"></path></svg>';
  };
  updateThemeToggle();
  themeToggle.onclick = () => {
    activeTheme = toggleTheme(activeTheme);
    document.documentElement.dataset.theme = activeTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
    } catch {
      // Keep the in-session theme switch working when browser storage is unavailable.
    }
    updateThemeToggle();
  };

  const badge = create("span", "Local / Windows");
  badge.className = "chip";
  const statusGroup = create("div");
  statusGroup.className = "header-status-group";
  const owner = create("span", "taridev");
  owner.className = "header-owner";
  statusGroup.appendChild(owner);
  statusGroup.appendChild(themeToggle);
  statusGroup.appendChild(badge);
  header.appendChild(left);
  header.appendChild(statusGroup);
  return header;
}

async function loadSettings(preserveSelection = true) {
  const r = await fetch("/api/settings");
  const data = await r.json();
  const preservedSelections = preserveSelection
    ? ["common-model", ...AGENTS.map(agent => `model-${agent.id}`)].map(id => ({
        id,
        value: (document.getElementById(id) as HTMLSelectElement | null)?.value ?? "",
      }))
    : [];
  state.settings = data as Settings;
  const mode = qs<HTMLSelectElement>("#mode");
  const common = qs<HTMLSelectElement>("#common-model");
  const auto = qs<HTMLInputElement>("#auto-approve");
  mode.value = state.settings.mode;
  common.value = state.settings.commonModel;
  auto.checked = !!state.settings.autoApprove;
  const commonLabel = document.getElementById("common-model-section") as HTMLElement;
  const grid = qs<HTMLDivElement>(".agent-grid");
  commonLabel.hidden = state.settings.mode !== "common";
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
  for (const agent of AGENTS) {
    const selected = state.settings.mode === "common"
      ? state.settings.commonModel
      : state.settings.agentModels[agent.id] || state.settings.commonModel;
    fillModelSelect(qs<HTMLSelectElement>(`#model-${agent.id}`), selected);
  }
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
  const sig = JSON.stringify(jobs.map(j => [j.id, j.requestKind, j.status, j.phase, j.updatedAt, j.lastError, j.answer, j.tokens, (j.logs || []).length]));
  if (sig === state.lastJobsSignature) {
    // Los datos no han cambiado: solo se refrescan los tiempos relativos del dashboard.
    refreshDashboard();
    return;
  }
  state.lastJobsSignature = sig;
  state.jobs = jobs;
  const requestKind = document.getElementById("request-kind") as HTMLSelectElement | null;
  if (requestKind?.value === "question" && consultationOutputField) {
    if (!state.consultationSelectionInitialized) {
      state.activeConsultationId = jobs.find(job => job.requestKind === "question")?.id || "";
      state.consultationSelectionInitialized = true;
    }
    const consultation = jobs.find(job => job.id === state.activeConsultationId && job.requestKind === "question");
    consultationOutputField.value = consultation?.answer
      || (consultation && ["queued", "running"].includes(consultation.status) ? "Consultando..." : "");
  }
  els.jobList.innerHTML = "";
  const totalTokens = jobs.reduce((total, job) => addTokenUsage(total, job.tokens ?? emptyTokenUsage()), emptyTokenUsage());
  if (totalTokens.total > 0) {
    const total = create("p", `Consumo total registrado: ${formatTokenUsage(totalTokens)}`);
    total.className = "token-total";
    els.jobList.appendChild(total);
  }

  for (const job of jobs) {
    const card = document.createElement("article");
    const top = renderJobSummary(document, job);
    card.appendChild(top);

    const meta = create("small", `ID: ${job.id} · Actualizado: ${job.updatedAt}`);
    card.appendChild(meta);

    if (job.tokens && job.tokens.total > 0) {
      const tokens = create("div", `Tokens: ${formatTokenUsage(job.tokens)}`);
      tokens.className = "token-usage";
      card.appendChild(tokens);
    } else if (job.status === "queued" || job.status === "running") {
      const tokens = create("div", "Tokens: en curso");
      tokens.className = "token-usage pending";
      card.appendChild(tokens);
    }

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
    if (job.requestKind !== "question" && ["done", "validated", "needs_intervention"].includes(job.status)) {
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
  refreshDashboard();
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

type ViewMeta = { title: string; subtitle: string };

const VIEWS: Record<ViewId, ViewMeta> = {
  dashboard: { title: "Dashboard", subtitle: "Estado y coste de IA de cada trabajo" },
  nuevo: { title: "Nuevo proyecto", subtitle: "Crea un proyecto nuevo, modifica uno existente o lanza una consulta" },
  trabajos: { title: "Trabajos", subtitle: "Estado, consumo de tokens y registro de cada trabajo" },
  preview: { title: "Vista previa", subtitle: "Arranca la app generada, deténla o descarga el ZIP del proyecto" },
  ajustes: { title: "Ajustes", subtitle: "Modelos de IA y configuración de la fábrica" },
};

/** Menu lateral con las secciones del panel. */
function renderSidebar(): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "sidebar";
  nav.setAttribute("aria-label", "Secciones");
  for (const item of MENU_ITEMS) {
    const link = document.createElement("a");
    link.className = "sidebar-item";
    link.href = hashForView(item.id);
    link.dataset.view = item.id;
    link.textContent = item.label;
    nav.appendChild(link);
  }
  return nav;
}

/** Cabecera de la vista con su titulo y descripcion. */
function renderViewShell(view: ViewId, content: HTMLElement): HTMLElement {
  const section = create("section");
  section.className = "view";
  section.dataset.view = view;
  const head = create("div");
  head.className = "view-head";
  const heading = create("div");
  const title = create("h1", VIEWS[view].title);
  title.className = "view-title";
  const subtitle = create("p", VIEWS[view].subtitle);
  subtitle.className = "view-subtitle";
  heading.append(title, subtitle);
  head.appendChild(heading);
  section.append(head, content);
  return section;
}

/** Muestra la vista indicada y marca el item activo del menu. */
function showView(view: ViewId) {
  state.activeView = view;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(".view"))) {
    element.hidden = element.dataset.view !== view;
  }
  for (const element of Array.from(document.querySelectorAll<HTMLAnchorElement>(".sidebar-item"))) {
    const active = element.dataset.view === view;
    element.classList.toggle("active", active);
    if (active) element.setAttribute("aria-current", "page");
    else element.removeAttribute("aria-current");
  }
}

/** Resumen con las cuatro tarjetas y la tabla de trabajos. */
function renderDashboardView(): HTMLElement {
  const section = create("section");
  section.className = "dash";
  els.dashboardCards.className = "dash-cards";
  els.dashboardTable.className = "dash-table";
  section.append(els.dashboardCards, els.dashboardTable);
  refreshDashboard();
  return section;
}

/** Repinta las tarjetas y la tabla con los datos reales de los trabajos. */
function refreshDashboard() {
  if (!els.dashboardCards.parentElement) return;
  const jobs = state.jobs as unknown as DashboardJob[];
  const stats = buildDashboardStats(jobs);
  const rows = buildDashboardRows(jobs);

  els.dashboardCards.replaceChildren();
  const addCard = (label: string, value: string, tone?: string) => {
    const box = create("div");
    box.className = "dash-card";
    const caption = create("div", label);
    caption.className = "dash-card-label";
    const amount = create("div", value);
    amount.className = tone ? `dash-card-value ${tone}` : "dash-card-value";
    box.append(caption, amount);
    els.dashboardCards.appendChild(box);
  };
  addCard("Activos", String(stats.activos), "accent");
  addCard("Finalizados", String(stats.finalizados), "ok");
  addCard("Con error", String(stats.conError), "error");
  addCard("Coste IA del mes", formatCost(stats.costeMes));

  els.dashboardTable.replaceChildren();
  if (!rows.length) {
    const empty = create("p", "Todavia no hay trabajos. Crea uno desde Nuevo proyecto.");
    empty.className = "hint";
    els.dashboardTable.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Trabajo", "Estado", "Fase", "Coste IA", "Actualizado"]) {
    headRow.appendChild(create("th", label));
  }
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const name = create("td", row.name);
    name.className = "dash-name";
    const status = document.createElement("td");
    const chip = create("span", row.status);
    chip.className = `status-chip tone-${row.tone}`;
    status.appendChild(chip);
    const phase = create("td", row.phase);
    phase.className = "dash-muted dash-phase";
    phase.title = row.phase;
    const cost = create("td", formatCost(row.cost));
    const updated = create("td", row.updated);
    updated.className = "dash-muted";
    tr.append(name, status, phase, cost, updated);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  els.dashboardTable.appendChild(table);
}

function buildApp() {
  const shell = create("div");
  shell.className = "app-shell";
  shell.appendChild(renderHeader());

  const body = create("div");
  body.className = "app-body";
  body.appendChild(renderSidebar());

  const content = document.createElement("main");
  content.className = "app-content";
  const views: Record<ViewId, HTMLElement> = {
    dashboard: renderViewShell("dashboard", renderDashboardView()),
    nuevo: renderViewShell("nuevo", renderCreateJob()),
    trabajos: renderViewShell("trabajos", renderJobs()),
    preview: renderViewShell("preview", renderPreview()),
    ajustes: renderViewShell("ajustes", buildSettingsUI()),
  };
  for (const view of Object.values(views)) content.appendChild(view);
  body.appendChild(content);
  shell.appendChild(body);
  app.appendChild(shell);

  const initial = viewFromHash(window.location.hash);
  showView(initial);
  if (!window.location.hash) window.history.replaceState(null, "", hashForView(initial));
  window.addEventListener("hashchange", () => showView(viewFromHash(window.location.hash)));
}

buildApp();
loadSettings().catch(() => void 0);
loadModels().catch(() => void 0);
loadProjects().catch(() => void 0);
loadJobs().catch(() => void 0);
setInterval(() => { loadJobs().catch(() => void 0); loadProjects().catch(() => void 0); }, 3000);
