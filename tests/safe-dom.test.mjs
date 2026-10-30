import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadSafeDom() {
  const source = fs.readFileSync(new URL("../web/safe-dom.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports });
  return module.exports;
}

class FakeElement {
  children = [];
  className = "";
  ownText = "";
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(""); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.ownText = ""; }
}

const document = { createElement: tag => Object.assign(new FakeElement(), { tagName: tag }) };

test("job name and phase with HTML are rendered as literal text, never parsed as markup", () => {
  const { renderJobSummary } = loadSafeDom();
  const name = '<img src=x onerror="alert(1)">';
  const phase = '<svg onload="alert(2)">';
  const summary = renderJobSummary(document, { name, phase, status: "failed" });
  assert.match(summary.textContent, /<img/);
  assert.match(summary.textContent, /<svg/);
  assert.match(summary.textContent, / · failed/);
  assert.deepEqual(summary.children.map(child => child.tagName), ["strong", "span", "span"]);
});

test("model tooltip metadata with HTML is rendered literally", () => {
  const { renderModelTooltip } = loadSafeDom();
  const tooltip = new FakeElement();
  renderModelTooltip(document, tooltip, {
    name: '<img src=x onerror="alert(1)">', id: "provider/model", providerID: "<svg>", status: "active",
  });
  assert.match(tooltip.textContent, /<img/);
  assert.match(tooltip.textContent, /<svg>/);
  assert.equal(tooltip.children.some(child => child.tagName === "img" || child.tagName === "svg"), false);
});
