import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture() {
  // Model select semantics: replacing options resets selection to the placeholder.
  class Select {
    options = [{ value: "" }, { value: "alpha" }, { value: "beta" }];
    selected = "";
    get value() { return this.selected; }
    set value(value) { this.selected = this.options.some(o => o.value === value) ? value : ""; }
    set innerHTML(_) { this.options = [{ value: "" }]; this.selected = ""; }
    appendChild(option) { this.options.push(option); }
  }
  const preview = new Select();
  const existing = new Select();
  let complete;
  const response = new Promise(resolve => { complete = resolve; });
  const source = fs.readFileSync(new URL("../web/main.ts", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("async function loadProjects()"), source.indexOf("function buildApp()"));
  const context = vm.createContext({
    els: { projectSelect: preview }, state: {},
    fetch: async () => ({ json: () => response }),
    document: {
      querySelector: () => existing,
      createElement: () => ({ value: "", cloneNode() { return { value: this.value }; } }),
    },
  });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { preview, existing, complete, refresh: () => vm.runInContext("loadProjects()", context) };
}

const projects = [{ name: "alpha" }, { name: "beta" }];

test("preview retains selected project after list refresh", async () => {
  const f = fixture();
  f.preview.value = "beta";
  f.complete(projects);
  await f.refresh();
  assert.equal(f.preview.value, "beta");
});

test("existing project selection is independent and retained after refresh", async () => {
  const f = fixture();
  f.preview.value = "beta";
  f.existing.value = "alpha";
  f.complete(projects);
  await f.refresh();
  assert.equal(f.existing.value, "alpha");
  assert.equal(f.preview.value, "beta");
});

test("selection changed while projects request is pending is retained", async () => {
  const f = fixture();
  f.preview.value = "alpha";
  const pending = f.refresh();
  f.preview.value = "beta";
  f.complete(projects);
  await pending;
  assert.equal(f.preview.value, "beta");
});

test("removed project resets selection to placeholder", async () => {
  const f = fixture();
  f.preview.value = "beta";
  f.complete([{ name: "alpha" }]);
  await f.refresh();
  assert.equal(f.preview.value, "");
});
