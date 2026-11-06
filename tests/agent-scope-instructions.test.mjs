import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = name => fs.readFileSync(new URL(`../.opencode/agents/${name}.md`, import.meta.url), "utf8");

test("the designer can update an existing design file", () => {
  const designer = read("disenador");
  assert.match(designer, /^\s*edit:\s*true\s*$/m, "The designer must be able to edit factory/diseno.md");
  assert.match(designer, /^\s*write:\s*true\s*$/m);
});

test("the quick agent cannot run commands or render the page", () => {
  const quick = read("quick-developer");
  assert.match(quick, /^\s*bash:\s*false\s*$/m, "Shell access makes every check a new costly turn");
  assert.match(quick, /^\s*edit:\s*true\s*$/m);
  // A CSS or text tweak is verified by reading the diff, not by launching a browser.
  assert.match(quick, /no (?:ejecutes|abras|arranques|renderices)/i);
  assert.match(quick, /navegador|chrome|servidor/i);
  assert.match(quick, /en (?:una sola|un solo) (?:edici[oó]n|mensaje)|de una sola vez/i);
});

test("the factory manager does not regenerate design or delivery for a tweak", () => {
  const manager = read("factory-manager");
  assert.match(manager, /modificacion puntual|modificación puntual/i);
  assert.match(manager, /no regener/i);
  assert.match(manager, /presupuesto_tokens/);
});
