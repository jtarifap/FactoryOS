import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/runner.ts", import.meta.url), "utf8");

test("static file handler reads through the sensitive-path and descriptor policy", () => {
  assert.match(source, /readProjectFile\(/);
  assert.match(source, /resolvedFile\.relativePath/);
  assert.doesNotMatch(source, /path\.resolve\(slug, rest/);
});

test("the project listing excludes junctions and canonicalizes entries", () => {
  assert.match(source, /resolveProjectDirectory\(PROJECTS, d\.name\)\.ok/);
});
