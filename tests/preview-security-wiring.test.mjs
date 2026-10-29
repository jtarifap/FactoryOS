import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/runner.ts", import.meta.url), "utf8");

test("static file handler resolves through the sensitive-path and real-containment policy", () => {
  assert.match(source, /resolveProjectFile\(/);
  assert.match(source, /resolvedFile\.absolutePath/);
  assert.doesNotMatch(source, /path\.resolve\(slug, rest/);
});
