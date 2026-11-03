import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Minimal DOM and HTTP boundary: execute the actual UI without calling paid models.
async function mount(testResponse = { ok: true }, mode = "independent", initialJobs = []) {
  const elements = [];
  class ClassList {
    constructor(element) { this.element = element; }
    get values() { return new Set(String(this.element.className || "").split(/\s+/).filter(Boolean)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
      const values = this.values;
      const enabled = force === undefined ? !values.has(name) : !!force;
      if (enabled) values.add(name); else values.delete(name);
      this.element.className = [...values].join(" ");
    }
  }
  class Element {
    children = []; style = {}; dataset = {}; listeners = {}; attributes = {}; ownText = "";
    value = ""; disabled = false;
    constructor(tag) { this.tagName = tag; this.classList = new ClassList(this); elements.push(this); }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.ownText = ""; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    set textContent(value) { this.ownText = String(value); this.children = []; }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(""); }
    get options() { return this.children.flatMap(child => child.tagName === "optgroup" ? child.children : [child]); }
    addEventListener(event, fn) { this.listeners[event] = fn; }
    getBoundingClientRect() { return { left: 20, bottom: 80 }; }
  }
  const app = new Element("div"); app.id = "app";
  const root = new Element("html");
  const matches = (element, selector) => selector.startsWith(".")
    ? String(element.className || "").split(/\s+/).includes(selector.slice(1))
    : selector.startsWith("#") ? element.id === selector.slice(1) : false;
  const document = {
    documentElement: root,
    body: new Element("body"),
    createElement: tag => new Element(tag),
    getElementById: id => elements.find(el => el.id === id),
    querySelector: selector => elements.find(el => matches(el, selector)) || null,
    querySelectorAll: selector => elements.filter(el => matches(el, selector)),
  };
  let savedTheme = null;
  const storage = {
    getItem: () => savedTheme,
    setItem: (_key, value) => { savedTheme = value; },
  };
  const calls = [];
  const agentIds = ["factory-manager", "developer", "qa-reviewer", "delivery-manager", "disenador", "auditoria-seguridad"];
  const settings = {
    mode, commonModel: "test/model", autoApprove: false,
    agentModels: Object.fromEntries(agentIds.map(id => [id, "test/model"])),
  };
  let latestJobs = initialJobs;
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/settings" && options?.method === "PUT") {
      const next = JSON.parse(options.body);
      Object.assign(settings, next);
      return { ok: true, json: async () => ({ ok: true, settings }) };
    }
    if (url === "/api/jobs" && options?.method === "POST") {
      const payload = JSON.parse(options.body);
      const id = "job-query1";
      latestJobs = [{ id, name: payload.name, request: payload.request, requestKind: payload.requestKind, answer: payload.requestKind === "question" ? "Respuesta desde Factory-manager" : undefined, status: "done", phase: "Consulta respondida", createdAt: "now", updatedAt: "now", directory: "", logs: [] }];
      return { ok: true, json: async () => ({ id }) };
    }
    if (url === "/api/jobs") return { ok: true, json: async () => latestJobs };
    if (url === "/api/models/test" && testResponse instanceof Error) throw testResponse;
    return { ok: true, json: async () => url === "/api/settings" ? settings
      : url === "/api/models" ? { models: [
          { id: "test/model", name: "Test Model", providerID: "test" },
          { id: "test/new", name: "New Model", providerID: "test" },
          { id: "test/other", name: "Other Model", providerID: "test" },
        ] }
        : url === "/api/models/test" ? testResponse : [] };
  };
  const safeDomSource = fs.readFileSync(new URL("../web/safe-dom.ts", import.meta.url), "utf8");
  const safeDomJs = ts.transpileModule(safeDomSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const safeDomModule = { exports: {} };
  vm.runInNewContext(safeDomJs, { module: safeDomModule, exports: safeDomModule.exports });
  const source = fs.readFileSync(new URL("../web/main.ts", import.meta.url), "utf8")
    .replace('import "./style.css";', "")
    .replace('import { renderJobSummary, renderModelTooltip } from "./safe-dom";', "")
    .replace('import { buildModelGroups, type ModelItem } from "./model-select";', "")
    .replace('import { buildDashboardRows, buildDashboardStats, type DashboardJob } from "./dashboard";', "")
    .replace('import { DEFAULT_VIEW, MENU_ITEMS, hashForView, viewFromHash, type ViewId } from "./navigation";', "")
    .replace('import { readTheme, THEME_STORAGE_KEY, toggleTheme, type Theme } from "./theme";', "")
    .replace('import { addTokenUsage, emptyTokenUsage, formatCost, formatTokenUsage, type TokenUsage } from "../shared/token-usage";', "");
  const themeModule = await import("../web/theme.ts");
  const tokenModule = await import("../shared/token-usage.ts");
  const modelSelectModule = await import("../web/model-select.ts");
  const dashboardModule = await import("../web/dashboard.ts");
  const navigationModule = await import("../web/navigation.ts");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const mainModule = { exports: {} };
  vm.runInNewContext(js, {
    module: mainModule, exports: mainModule.exports,
    renderJobSummary: safeDomModule.exports.renderJobSummary,
    renderModelTooltip: safeDomModule.exports.renderModelTooltip,
    buildModelGroups: modelSelectModule.buildModelGroups,
    buildDashboardRows: dashboardModule.buildDashboardRows,
    buildDashboardStats: dashboardModule.buildDashboardStats,
    DEFAULT_VIEW: navigationModule.DEFAULT_VIEW,
    MENU_ITEMS: navigationModule.MENU_ITEMS,
    hashForView: navigationModule.hashForView,
    viewFromHash: navigationModule.viewFromHash,
    readTheme: themeModule.readTheme,
    THEME_STORAGE_KEY: themeModule.THEME_STORAGE_KEY,
    toggleTheme: themeModule.toggleTheme,
    addTokenUsage: tokenModule.addTokenUsage,
    emptyTokenUsage: tokenModule.emptyTokenUsage,
    formatCost: tokenModule.formatCost,
    formatTokenUsage: tokenModule.formatTokenUsage,
    document, fetch,
    window: {
      innerWidth: 1000, scrollY: 0, localStorage: storage,
      location: { hash: "" },
      history: { replaceState: () => {} },
      addEventListener: () => {},
    },
    Option: class extends Element { constructor(text, value) { super("option"); this.textContent = text; this.value = value; } },
    setInterval: () => 0,
  });
  await new Promise(resolve => setImmediate(resolve));
  const select = document.getElementById("common-model");
  const button = select.parentElement.children.find(el => el.tagName === "button");
  return { select, button, calls, settings, tooltip: document.getElementById("model-tooltip"), elements, document, storage };
}

test("common model has a working Probar button using the selected model", async () => {
  const { select, button, calls } = await mount();
  assert.ok(button, "Missing common-model Probar button");
  select.value = "test/selected";
  const pending = button.onclick();
  assert.equal(button.disabled, true);
  await pending;
  const call = calls.find(call => call.url === "/api/models/test");
  assert.deepEqual(JSON.parse(call.options.body), { model: "test/selected", agent: "factory-manager" });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Probar");
});

test("common model tooltip appears on hover/focus and hides on exit", async () => {
  const { select, tooltip } = await mount();
  select.value = "test/model";
  assert.equal(typeof select.listeners.mouseenter, "function", "Missing common-model tooltip");
  select.listeners.mouseenter();
  assert.equal(tooltip.style.display, "block");
  assert.match(tooltip.textContent, /test\/model/);
  select.listeners.mouseleave();
  assert.equal(tooltip.style.display, "none");
  select.listeners.focus();
  assert.equal(tooltip.style.display, "block");
  select.listeners.blur();
  assert.equal(tooltip.style.display, "none");
});

test("common model test reports connection errors and restores button", async () => {
  const { button, elements } = await mount(new Error("Sin conexión"));
  assert.ok(button, "Missing common-model Probar button");
  await button.onclick();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Probar");
  assert.ok(elements.some(el => el.textContent.includes("Sin conexión")));
});

test("independent mode exposes a separate model selector for all six agents", async () => {
  const { elements } = await mount();
  const ids = ["factory-manager", "developer", "qa-reviewer", "delivery-manager", "disenador", "auditoria-seguridad"];
  assert.ok(elements.find(el => el.id === "mode"), "Missing model mode selector");
  assert.ok(elements.find(el => el.className === "agent-grid"), "Missing agent selectors");
  for (const id of ids) assert.ok(elements.find(el => el.id === `model-${id}`), `Missing model selector for ${id}`);
  assert.equal(elements.find(el => el.className === "agent-grid").hidden, false);
});

test("common mode fans out one model and hides the per-agent selectors", async () => {
  const { elements } = await mount({ ok: true }, "common");
  const common = elements.find(el => el.id === "common-model-section");
  const grid = elements.find(el => el.className === "agent-grid");
  assert.ok(common && grid, "Missing common or independent settings section");
  assert.equal(common.hidden, false);
  assert.equal(grid.hidden, true);
});

test("el CSS respeta hidden en la sección de modelo común", async () => {
  const css = fs.readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /#common-model-section\[hidden\]\s*\{[^}]*display\s*:\s*none/);
});

const AGENT_KEYS = ["factory-manager", "developer", "qa-reviewer", "delivery-manager", "disenador", "auditoria-seguridad"];
const saveButton = elements => elements.find(el => el.tagName === "button" && el.textContent === "Guardar configuración");

test("saving in common mode applies one model to all six agents", async () => {
  const { elements, settings, calls } = await mount({ ok: true }, "common");
  elements.find(el => el.id === "common-model").value = "test/new";
  const save = saveButton(elements);
  assert.ok(save, "Missing save button");
  await save.onclick({ preventDefault() {} });
  const put = calls.find(call => call.url === "/api/settings" && call.options?.method === "PUT");
  assert.ok(put, "Missing settings PUT");
  const payload = JSON.parse(put.options.body);
  assert.equal(payload.mode, "common");
  for (const agent of AGENT_KEYS) {
    assert.equal(payload.agentModels[agent], "test/new", `payload ${agent}`);
    assert.equal(settings.agentModels[agent], "test/new", `saved ${agent}`);
  }
});

test("saving in independent mode preserves each selected agent model", async () => {
  const { elements, settings, calls } = await mount();
  for (const [index, agent] of AGENT_KEYS.entries()) elements.find(el => el.id === `model-${agent}`).value = `test/model-${index}`;
  const save = saveButton(elements);
  await save.onclick({ preventDefault() {} });
  const put = calls.find(call => call.url === "/api/settings" && call.options?.method === "PUT");
  const payload = JSON.parse(put.options.body);
  assert.equal(payload.mode, "independent");
  AGENT_KEYS.forEach((agent, index) => {
    assert.equal(payload.agentModels[agent], `test/model-${index}`);
    assert.equal(settings.agentModels[agent], `test/model-${index}`);
  });
});

test("new security agent selector tests its own selected model", async () => {
  const { elements, calls } = await mount();
  const select = elements.find(el => el.id === "model-auditoria-seguridad");
  assert.ok(select, "Missing Auditoría model selector");
  select.value = "test/other";
  const testButton = select.parentElement.children.find(el => el.tagName === "button");
  await testButton.onclick();
  const call = calls.find(entry => entry.url === "/api/models/test");
  assert.deepEqual(JSON.parse(call.options.body), { model: "test/other", agent: "auditoria-seguridad" });
});

test("consultation uses its own input and displays Factory-manager's answer in the response field", async () => {
  const { elements, calls } = await mount();
  const kind = elements.find(el => el.id === "request-kind");
  assert.ok(kind, "Missing request type selector");
  kind.value = "question";
  kind.onchange();
  const submit = elements.find(el => el.tagName === "button" && el.textContent === "Consultar");
  const form = elements.find(el => typeof el.onsubmit === "function");
  assert.ok(submit && form, "Consultation form is not ready");
  const query = elements.find(el => el.tagName === "input" && el.placeholder === "Escribe aquí tu consulta");
  const response = elements.find(el => el.tagName === "textarea");
  query.value = "¿Cómo organizo este proyecto?";
  await form.onsubmit({ preventDefault() {} });
  const job = calls.find(call => call.url === "/api/jobs" && call.options?.method === "POST");
  assert.ok(job, "Missing job submission");
  const payload = JSON.parse(job.options.body);
  assert.equal(payload.requestKind, "question");
  assert.equal(payload.request, "¿Cómo organizo este proyecto?");
  assert.equal(payload.directory, undefined);
  assert.equal(response.value, "Respuesta desde Factory-manager");
});

test("Project is the default request type", async () => {
  const { elements } = await mount();
  assert.equal(elements.find(el => el.id === "request-kind")?.value, "project");
});

test("switching modes restores project fields and reveals the existing-project selector", async () => {
  const { elements } = await mount();
  const directory = elements.find(el => el.dataset.role === "existing-directory");
  const kind = elements.find(el => el.id === "request-kind");
  assert.ok(directory && kind, "Missing project routing controls");
  const nameLabel = elements.find(el => el.tagName === "label" && el.textContent === "Nombre");
  const requestLabel = elements.find(el => el.tagName === "label" && el.textContent === "Solicitud");
  const name = elements.find(el => el.placeholder === "Nombre del proyecto");
  const request = elements.find(el => el.tagName === "textarea");
  directory.value = "projects/sample";
  directory.onchange();
  assert.equal(elements.find(el => el.tagName === "button" && el.textContent === "Modificar proyecto")?.textContent, "Modificar proyecto");
  kind.value = "question";
  kind.onchange();
  assert.equal(directory.value, "", "Consultations must not retain a project directory");
  assert.equal(nameLabel.textContent, "Consultar");
  assert.equal(name.placeholder, "Escribe aquí tu consulta");
  assert.equal(nameLabel.hidden, false);
  assert.equal(name.hidden, false);
  assert.equal(requestLabel.textContent, "Respuestas");
  assert.equal(request.placeholder, "Respuestas a tus consultas");
  assert.equal(request.readOnly, true);
  assert.equal(directory.hidden, true);
  kind.value = "project";
  kind.onchange();
  assert.equal(nameLabel.textContent, "Nombre");
  assert.equal(name.placeholder, "Nombre del proyecto");
  assert.equal(requestLabel.textContent, "Solicitud");
  assert.equal(request.readOnly, false);
  assert.equal(directory.hidden, false);
  assert.equal(elements.find(el => el.tagName === "button" && el.textContent === "Crear y ejecutar")?.textContent, "Crear y ejecutar");
});

test("theme toggle updates the root theme, saved preference and accessible icon", async () => {
  const { document, elements, storage } = await mount();
  const button = elements.find(el => el.className === "secondary theme-toggle");
  assert.ok(button, "Missing theme toggle");
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(button.attributes["aria-label"], "Cambiar a tema claro");
  assert.match(button.innerHTML, /data-icon="sun"/);

  button.onclick();

  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(storage.getItem("factoryos-theme"), "light");
  assert.equal(button.attributes["aria-label"], "Cambiar a tema oscuro");
  assert.match(button.innerHTML, /data-icon="moon"/);
});

test("theme toggle sits immediately before the Local / Windows badge", async () => {
  const { elements } = await mount();
  const header = elements.find(el => el.tagName === "header");
  const statusGroup = elements.find(el => el.className === "header-status-group");
  const owner = elements.find(el => el.className === "header-owner");
  const toggle = elements.find(el => el.className === "secondary theme-toggle");
  const badge = elements.find(el => el.className === "chip");

  assert.ok(statusGroup, "Missing header status group");
  assert.ok(owner, "Missing taridev label in the header");
  assert.equal(owner.ownText, "taridev");
  assert.equal(header.children[1], statusGroup);
  assert.deepEqual(statusGroup.children, [owner, toggle, badge]);
});

test("the panel shows the sidebar sections and only one view at a time", async () => {
  const { elements } = await mount();
  const items = elements.filter(el => el.tagName === "a" && el.dataset.view);
  assert.deepEqual(items.map(el => el.ownText), ["Dashboard", "Nuevo proyecto", "Trabajos", "Vista previa", "Ajustes"]);
  assert.deepEqual(items.map(el => el.dataset.view), ["dashboard", "nuevo", "trabajos", "preview", "ajustes"]);
  assert.deepEqual(items.map(el => el.href), ["#/dashboard", "#/nuevo", "#/trabajos", "#/preview", "#/ajustes"]);

  const views = elements.filter(el => el.className === "view");
  assert.equal(views.length, 5);
  const visible = views.filter(view => view.hidden !== true);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].dataset.view, "dashboard");
  assert.ok(items[0].classList.contains("active"), "the dashboard item should be active");
});

test("job cards and the panel show token usage", async () => {
  const job = {
    id: "job-token1", name: "Demo tokens", request: "Crea una app", status: "done", phase: "Validado",
    createdAt: "now", updatedAt: "now", directory: "", logs: [],
    tokens: { input: 1000, output: 20, reasoning: 5, cacheRead: 200, cacheWrite: 3, total: 1228, cost: 0.01 },
  };
  const { elements } = await mount({ ok: true }, "independent", [job]);
  await new Promise(resolve => setTimeout(resolve, 20));

  const tokenLine = elements.find(el => el.className === "token-usage");
  assert.ok(tokenLine, "Missing per-job token line");
  assert.match(tokenLine.textContent, /Tokens: 1\.228 tokens/);
  assert.match(tokenLine.textContent, /entrada 1\.000/);
  assert.match(tokenLine.textContent, /caché L 200/);

  const totalLine = elements.find(el => el.className === "token-total");
  assert.ok(totalLine, "Missing global token summary");
  assert.match(totalLine.textContent, /Consumo total registrado: 1\.228 tokens/);
});

test("saving uses refreshed common model instead of stale independent selections", async () => {
  const { elements, settings, calls } = await mount({ ok: true }, "independent");
  for (const agent of AGENT_KEYS) elements.find(el => el.id === `model-${agent}`).value = "test/other";
  elements.find(el => el.id === "common-model").value = "test/new";
  const mode = elements.find(el => el.id === "mode");
  mode.value = "common";
  if (typeof mode.onchange === "function") mode.onchange();
  const save = saveButton(elements);
  assert.ok(save, "Missing save button");
  await save.onclick({ preventDefault() {} });
  for (const agent of AGENT_KEYS) {
    assert.equal(
      elements.find(el => el.id === `model-${agent}`).value,
      "test/new",
      `${agent} did not reflect the refreshed common model`
    );
  }
});


