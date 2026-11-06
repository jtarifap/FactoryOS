import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../server/runner.ts", import.meta.url), "utf8");
const zip = fs.readFileSync(new URL("../server/zip.ts", import.meta.url), "utf8");
const web = fs.readFileSync(new URL("../web/main.ts", import.meta.url), "utf8");

test("the API validates Host, Origin, fetch metadata and JSON content type before routing", () => {
  assert.match(index, /authorizeRequest\(/);
  assert.match(index, /pathname: u\.pathname/);
  assert.ok(index.indexOf("authorizeRequest(") < index.indexOf('u.pathname === "/api/health"'));
  assert.match(index, /res\.setHeader\("X-Content-Type-Options", "nosniff"\)/);
  assert.match(index, /res\.setHeader\("Referrer-Policy", "no-referrer"\)/);
  assert.doesNotMatch(index, /Access-Control-Allow-Origin/);
});

test("model probes reject shell-like ids and preview arguments are validated before spawn", () => {
  assert.match(index, /isModelId\(model\)/);
  assert.match(runner, /validatePreviewArgs\(extraArgs\)/);
  assert.ok(runner.indexOf("validatePreviewArgs(extraArgs)") < runner.indexOf("spawn(\"npm\", runArgs"));
});

test("all project directory entry points use the shared canonical resolver", () => {
  for (const source of [index, runner, zip]) {
    assert.match(source, /resolveProjectDirectory\(PROJECTS/);
  }
  assert.doesNotMatch(index, /path\.basename\(input\)/);
  assert.match(index, /readProjectFile\(/);
});

test("the panel downloads ZIPs by project name instead of sending an absolute path", () => {
  assert.doesNotMatch(web, /encodeURIComponent\(job\.directory\)/);
  assert.match(web, /job\.directory\.split\(\/\[\\\\\/\]\/\)\.pop\(\)/);
});

test("job output and preview logs are redacted before exposing them", () => {
  assert.match(index, /redactSecrets/);
  assert.match(index, /logs: x\.logs\.map\(redactSecrets\)/);
  assert.match(index, /jobs\.map\(persistedJob\)/);
  assert.match(runner, /redactSecrets/);
  assert.match(zip, /redactSecrets/);
});
