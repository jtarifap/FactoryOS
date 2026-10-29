import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const start = source.indexOf("async function verifyProject(");
const end = source.indexOf("async function worker()", start);
assert.notEqual(start, -1, "verifyProject implementation not found");
assert.notEqual(end, -1, "worker boundary not found");
const verifyProject = source.slice(start, end);

test("worker verification delegates project policy and records actual command results", () => {
  assert.match(verifyProject, /getProjectVerification\(j\.directory\)/);
  assert.match(verifyProject, /runProjectChecks\(/);
  assert.match(verifyProject, /appendVerificationEvidence\(j\.directory/);
  assert.match(verifyProject, /execInProject\(j, "npm"/);
});
