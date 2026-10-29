import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Minimal DOM and HTTP boundary: execute the actual UI without calling paid models.
async function mount(testResponse = { ok: true }) {
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
    mode: "common", commonModel: "test/model", autoApprove: false,
    agentModels: Object.fromEntries(["factory-manager", "developer", "qa-reviewer", "delivery-manager"].map(id => [id, "test/model"])),
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/models/test" && testResponse instanceof Error) throw testResponse;
    return { ok: true, json: async () => url === "/api/settings" ? settings
      : url === "/api/models" ? { models: [{ id: "test/model", name: "Test Model", providerID: "test" }] }
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
  return { select, button, calls, tooltip: document.getElementById("model-tooltip"), elements };
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
