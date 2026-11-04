import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/main.ts", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/style.css", import.meta.url), "utf8");

test("the panel decides the mode from the API before loading data", () => {
  assert.match(appSource, /from "\.\/demo"/);
  assert.match(appSource, /probeApiHealth\(/);
  assert.match(appSource, /resolveDemo\(/);
  assert.match(appSource, /forcedDemo\(window\.location\.search\)/);
});

test("every API call goes through the demo aware client", () => {
  assert.doesNotMatch(appSource, /fetch\("\/api/);
  assert.doesNotMatch(appSource, /fetch\(`\/api/);
  assert.match(appSource, /function apiFetch\(/);
});

test("demo mode shows a banner and relabels the status chip", () => {
  assert.match(appSource, /demo-banner/);
  assert.match(appSource, /status-chip/);
  assert.match(appSource, /applyDemoMode\(/);
  assert.match(css, /\.demo-banner\{/);
});

test("the demo banner styles use the existing theme tokens", () => {
  for (const token of ["--accent", "--surface", "--border", "--text"]) {
    assert.match(css, new RegExp(`\\.demo-banner[^}]*var\\(${token}\\)`));
  }
});
