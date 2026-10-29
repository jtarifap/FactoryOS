import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

function loadDeliveryReport() {
  const source = fs.readFileSync(new URL("../server/delivery-report.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: createRequire(import.meta.url) });
  return module.exports;
}

function withProject(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devfactory-delivery-"));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const headings = [
  "## Funcionalidades",
  "## Dependencias",
  "## Variables de entorno",
  "## Instalación y ejecución",
  "## Problemas conocidos y limitaciones",
];
const validReport = headings.map(title => `${title}\nDetalle correspondiente.`).join("\n\n");

test("complete report with non-empty required sections validates", () => {
  const { validateDeliveryReport } = loadDeliveryReport();
  assert.deepEqual(JSON.parse(JSON.stringify(validateDeliveryReport(validReport))), { ok: true, missing: [] });
});

test("empty report and empty required section are rejected", () => {
  const { validateDeliveryReport } = loadDeliveryReport();
  assert.equal(validateDeliveryReport("   ").ok, false);
  assert.equal(validateDeliveryReport(validReport.replace("## Dependencias\nDetalle correspondiente.", "## Dependencias\n\n## Variables" )).ok, false);
});

test("each missing required heading is reported", () => {
  const { validateDeliveryReport } = loadDeliveryReport();
  for (const heading of headings) {
    const report = validReport.replace(`${heading}\nDetalle correspondiente.`, "");
    const result = validateDeliveryReport(report);
    assert.equal(result.ok, false, `expected missing heading ${heading}`);
    assert.ok(result.missing.length > 0);
  }
});

test("report is fresh only when a non-empty file was updated after phase start", () => {
  const { captureDeliveryReportState, wasDeliveryReportUpdatedSince } = loadDeliveryReport();
  withProject(directory => {
    const report = path.join(directory, "DELIVERY_REPORT.md");
    assert.equal(wasDeliveryReportUpdatedSince(directory, 0n, null), false);
    fs.writeFileSync(report, "old report");
    const oldTime = new Date(Date.now() - 10_000);
    fs.utimesSync(report, oldTime, oldTime);
    const before = captureDeliveryReportState(directory);
    const phaseStart = BigInt(Date.now()) * 1_000_000n;
    fs.writeFileSync(report, "new report written in phase");
    assert.equal(wasDeliveryReportUpdatedSince(directory, phaseStart, before), true);
    fs.writeFileSync(report, "");
    assert.equal(wasDeliveryReportUpdatedSince(directory, phaseStart, before), false);
  });
});

test("unchanged report with a future modification time is not considered fresh", () => {
  const { captureDeliveryReportState, wasDeliveryReportUpdatedSince } = loadDeliveryReport();
  withProject(directory => {
    const report = path.join(directory, "DELIVERY_REPORT.md");
    fs.writeFileSync(report, "stale but future-dated report");
    const futureTime = new Date(Date.now() + 60 * 60 * 1000);
    fs.utimesSync(report, futureTime, futureTime);
    const before = captureDeliveryReportState(directory);
    const phaseStart = BigInt(Date.now()) * 1_000_000n;
    assert.equal(wasDeliveryReportUpdatedSince(directory, phaseStart, before), false);
  });
});

test("delivery completion requires successful agent, fresh report and all sections", () => {
  const { validateDeliveryCompletion } = loadDeliveryReport();
  assert.equal(validateDeliveryCompletion(true, true, validReport).ok, true);
  assert.equal(validateDeliveryCompletion(false, true, validReport).ok, false);
  assert.equal(validateDeliveryCompletion(true, false, validReport).ok, false);
  const incomplete = validateDeliveryCompletion(true, true, "## Funcionalidades\nsolo una sección");
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /apartados/i);
});
