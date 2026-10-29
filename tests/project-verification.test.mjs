import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

function loadVerification() {
  const source = fs.readFileSync(new URL("../server/project-verification.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: createRequire(import.meta.url) });
  return module.exports;
}

function withProject(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devfactory-verify-"));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("static project passes discovery only with index.html", () => {
  const { getProjectVerification } = loadVerification();
  withProject(directory => {
    fs.writeFileSync(path.join(directory, "index.html"), "<h1>ok</h1>");
    assert.deepEqual(JSON.parse(JSON.stringify(getProjectVerification(directory))), { kind: "static", scripts: [] });
  });
});

test("index.html directory is not accepted as a static page", () => {
  const { getProjectVerification } = loadVerification();
  withProject(directory => {
    fs.mkdirSync(path.join(directory, "index.html"));
    assert.equal(getProjectVerification(directory).kind, "invalid");
  });
});

test("missing project files and malformed package manifests are invalid", () => {
  const { getProjectVerification } = loadVerification();
  withProject(directory => {
    assert.equal(getProjectVerification(directory).kind, "invalid");
    fs.writeFileSync(path.join(directory, "package.json"), "{");
    const result = getProjectVerification(directory);
    assert.equal(result.kind, "invalid");
    assert.match(result.error, /package\.json/i);
  });
});

test("package project without build or test scripts is invalid", () => {
  const { getProjectVerification } = loadVerification();
  withProject(directory => {
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ scripts: { start: "node app.js" } }));
    assert.equal(getProjectVerification(directory).kind, "invalid");
  });
});

test("all configured verification scripts execute in build then test order", async () => {
  const { runProjectChecks } = loadVerification();
  const calls = [];
  const result = await runProjectChecks("fixture-project", ["test", "build"], async (directory, script) => {
    calls.push([directory, script]);
    return { ok: true, output: `${script} output` };
  });
  assert.deepEqual(calls, [["fixture-project", "build"], ["fixture-project", "test"]]);
  assert.equal(result.ok, true);
  assert.match(result.summary, /npm run build: OK/);
  assert.match(result.summary, /npm test: OK/);
});

test("verification stops after the first failing configured script", async () => {
  const { runProjectChecks } = loadVerification();
  const calls = [];
  const result = await runProjectChecks("fixture-project", ["build", "test"], async (_directory, script) => {
    calls.push(script);
    return script === "build" ? { ok: false, output: "compiler failed" } : { ok: true, output: "unexpected" };
  });
  assert.deepEqual(calls, ["build"]);
  assert.equal(result.ok, false);
  assert.match(result.output, /compiler failed/);
  assert.equal(result.summary, "npm run build: FAIL");
  assert.deepEqual(JSON.parse(JSON.stringify(result.checks)), [{ command: "npm run build", ok: false }]);
});

test("verification evidence appends pass/fail summary without replacing prior QA report", () => {
  const { appendVerificationEvidence } = loadVerification();
  withProject(directory => {
    const report = path.join(directory, "QA_REPORT.md");
    fs.writeFileSync(report, "Existing QA notes\n");
    appendVerificationEvidence(directory, [
      { command: "npm run build", ok: true },
      { command: "npm test", ok: false },
    ], false);
    const text = fs.readFileSync(report, "utf8");
    assert.match(text, /Existing QA notes/);
    assert.match(text, /Verificación técnica automatizada/);
    assert.match(text, /Estado: FAIL/);
    assert.match(text, /npm test: FAIL/);
  });
});

test("raw failing command output cannot forge QA evidence for an unrun test", async () => {
  const { runProjectChecks, appendVerificationEvidence } = loadVerification();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devfactory-verify-forgery-"));
  try {
    const result = await runProjectChecks(directory, ["build", "test"], async () => ({
      ok: false,
      output: "compiler error\nnpm test: OK",
    }));
    assert.equal(result.summary, "npm run build: FAIL");
    assert.deepEqual(JSON.parse(JSON.stringify(result.checks)), [{ command: "npm run build", ok: false }]);
    appendVerificationEvidence(directory, result.checks, result.ok);
    const report = fs.readFileSync(path.join(directory, "QA_REPORT.md"), "utf8");
    assert.match(report, /npm run build: FAIL/);
    assert.doesNotMatch(report, /npm test: OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
