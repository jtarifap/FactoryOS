import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/main.ts", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/style.css", import.meta.url), "utf8");

test("app applies the saved theme and persists changes from its toggle", () => {
  assert.match(appSource, /import \{[^}]*readTheme[^}]*THEME_STORAGE_KEY[^}]*toggleTheme[^}]*\} from "\.\/theme"/);
  assert.match(appSource, /document\.documentElement\.dataset\.theme\s*=/);
  assert.match(appSource, /localStorage\.setItem\(THEME_STORAGE_KEY/);
  assert.match(appSource, /className = "secondary theme-toggle"/);
});

test("theme toggle exposes an accessible action and matching sun/moon icons", () => {
  assert.match(appSource, /aria-label/);
  assert.match(appSource, /\.title\s*=/);
  assert.match(appSource, /sun|moon/i);
});

test("app stylesheet defines dark defaults and a light palette for semantic colors", () => {
  assert.match(css, /\[data-theme="light"\]/);
  for (const token of ["--bg", "--surface", "--text", "--muted", "--border", "--accent"]) {
    assert.match(css, new RegExp(`${token}\\s*:`));
    assert.match(css, new RegExp(`var\\(${token}\\)`));
  }
  assert.match(css, /--job-error-bg:#1a0e12/);
  assert.match(css, /--job-error-bg:#fff0f0/);
  assert.match(css, /background:var\(--job-error-bg\)/);
});
