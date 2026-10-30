import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Minimal DOM and HTTP boundary: execute the actual UI without calling paid models.
async function mount(testResponse = { ok: true }, mode = "common") {
  const elements = [];
  class Element {
    children = []; style = {}; dataset = {}; listeners = {}; ownText = "";
    value = ""; disabled = false;
    constructor(tag) { this.tagName = tag; elements.push(this); }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.ownText = ""; this.append(...children); }
    set textContent(value) { this.ownText = String(value); this.children = []; }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(""); }
    addEventListener(event, fn) { this.listeners[event] = fn; }
    getBoundingClientRect() { return { left: 20, bottom: 80 }; }
  }
  const app = new Element("div"); app.id = "app";
  const document = {
    body: new Element("body"),
    createElement: tag => new Element(tag),
    getElementById: id => elements.find(el => el.id === id),
    querySelector: selector => elements.find(el => selector.startsWith("#")
      ? el.id === selector.slice(1) : selector.startsWith(".")
        ? el.className === selector.slice(1) : false) || null,
  };
  const calls = [];
  const settings = {
    mode, commonModel: "test/model", autoApprove: false,
    agentModels: Object.fromEntries(["factory-manager", "developer", "qa-reviewer", "delivery-manager"].map(id => [id, "test/model"])),
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/settings" && options?.method === "PUT") {
      const next = JSON.parse(options.body);
      Object.assign(settings, next);
      return { ok: true, json: async () => ({ ok: true, settings }) };
    }
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
    .replace('import { renderJobSummary, renderModelTooltip } from "./safe-dom";', "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const mainModule = { exports: {} };
  vm.runInNewContext(js, {
    module: mainModule, exports: mainModule.exports,
    renderJobSummary: safeDomModule.exports.renderJobSummary,
    renderModelTooltip: safeDomModule.exports.renderModelTooltip,
    document, fetch, window: { innerWidth: 1000, scrollY: 0 },
    Option: class extends Element { constructor(text, value) { super("option"); this.textContent = text; this.value = value; } },
    setInterval: () => 0,
  });
  await new Promise(resolve => setImmediate(resolve));
  const select = document.getElementById("common-model");
  const button = select.parentElement.children.find(el => el.tagName === "button");
  return { select, button, calls, settings, tooltip: document.getElementById("model-tooltip"), elements };
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

test("modo común muestra el modelo común y oculta los agentes", async () => {
  const { elements } = await mount();
  const commonSection = elements.find(el => el.id === "common-model-section");
  const grid = elements.find(el => el.className === "agent-grid");
  assert.ok(commonSection, "Missing common model section");
  assert.ok(grid, "Missing agent grid");
  assert.equal(commonSection.hidden, false);
  assert.equal(grid.hidden, true);
});

test("modo independiente oculta el modelo común y muestra los agentes", async () => {
  const { elements } = await mount({ ok: true }, "independent");
  const commonSection = elements.find(el => el.id === "common-model-section");
  const grid = elements.find(el => el.className === "agent-grid");
  assert.ok(commonSection, "Missing common model section");
  assert.ok(grid, "Missing agent grid");
  assert.equal(commonSection.hidden, true);
  assert.equal(grid.hidden, false);
});

test("cambiar el modo alterna la visibilidad de ambas secciones", async () => {
  const { elements } = await mount();
  const mode = elements.find(el => el.id === "mode");
  const commonSection = elements.find(el => el.id === "common-model-section");
  const grid = elements.find(el => el.className === "agent-grid");
  assert.ok(mode && commonSection && grid, "Missing settings controls");
  mode.value = "independent";
  mode.onchange();
  assert.equal(commonSection.hidden, true);
  assert.equal(grid.hidden, false);
  mode.value = "common";
  mode.onchange();
  assert.equal(commonSection.hidden, false);
  assert.equal(grid.hidden, true);
});

test("el CSS respeta hidden en la sección de modelo común", async () => {
  const css = fs.readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /#common-model-section\[hidden\]\s*\{[^}]*display\s*:\s*none/);
});

const AGENT_IDS = ["model-factory-manager", "model-developer", "model-qa-reviewer", "model-delivery-manager"];
const AGENT_KEYS = ["factory-manager", "developer", "qa-reviewer", "delivery-manager"];
const saveButton = elements => elements.find(el => el.tagName === "button" && el.textContent === "Guardar configuración");

test("guardar en modo común aplica el modelo común a todos los agentes", async () => {
  const { elements, settings, calls } = await mount({ ok: true }, "common");
  for (const id of AGENT_IDS) elements.find(el => el.id === id).value = "test/other";
  elements.find(el => el.id === "common-model").value = "test/new";
  const save = saveButton(elements);
  assert.ok(save, "Missing save button");
  await save.onclick({ preventDefault() {} });
  const put = calls.find(call => call.url === "/api/settings" && call.options?.method === "PUT");
  assert.ok(put, "Missing settings PUT");
  const payload = JSON.parse(put.options.body);
  for (const agent of AGENT_KEYS) {
    assert.equal(payload.agentModels[agent], "test/new", `payload ${agent}`);
    assert.equal(settings.agentModels[agent], "test/new", `saved ${agent}`);
    assert.equal(elements.find(el => el.id === `model-${agent}`).value, "test/new", `select ${agent}`);
  }
});

test("guardar en modo independiente conserva los modelos por agente", async () => {
  const { elements, settings } = await mount({ ok: true }, "independent");
  elements.find(el => el.id === "common-model").value = "test/new";
  elements.find(el => el.id === "model-developer").value = "test/other";
  const save = saveButton(elements);
  assert.ok(save, "Missing save button");
  await save.onclick({ preventDefault() {} });
  assert.equal(settings.commonModel, "test/new");
  assert.equal(settings.agentModels.developer, "test/other");
  assert.equal(settings.agentModels["factory-manager"], "test/model");
  assert.equal(elements.find(el => el.id === "model-developer").value, "test/other");
});
