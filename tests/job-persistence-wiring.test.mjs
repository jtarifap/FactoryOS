import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

test("jobs and settings are persisted with the atomic writer", () => {
  assert.match(server, /const saveSettings = \(\) => atomicWriteFileSync\(SETTINGS_FILE/);
  assert.match(server, /const save = \(\) => atomicWriteFileSync\(DB/);
  assert.doesNotMatch(server, /fs\.writeFileSync\(DB/);
  assert.doesNotMatch(server, /fs\.writeFileSync\(SETTINGS_FILE/);
});

test("a modification checkpoint is verified before the job can be queued", () => {
  const start = server.indexOf('u.pathname === "/api/jobs" && req.method === "POST"');
  const end = server.indexOf('const match = u.pathname.match', start);
  const createJob = server.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(createJob.indexOf("createCheckpoint(existingSafe, checkpointPath)") < createJob.indexOf("jobs.push(j)"));
  assert.match(createJob, /j\.checkpoint = checkpointPath/);
  assert.doesNotMatch(createJob, /force:\s*true/);
  assert.match(createJob, /No se pudo crear el checkpoint/);
});

test("the worker uses the persisted action instead of the directory", () => {
  const start = server.indexOf("async function worker()");
  const end = server.indexOf("function safeProjectPath(", start);
  const worker = server.slice(start, end);
  assert.match(worker, /const action = resolveJobAction\(j\)/);
  assert.doesNotMatch(worker, /routeRequest\(/);
  assert.doesNotMatch(worker, /j\.action\s*=.*j\.directory/);
});
