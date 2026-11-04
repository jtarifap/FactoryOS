import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_JOBS,
  DEMO_MODELS,
  DEMO_MUTATION_ERROR,
  DEMO_PROJECTS,
  DEMO_SETTINGS,
  createDemoBackend,
  forcedDemo,
  probeApiHealth,
  resolveDemo,
} from "../web/demo.ts";

test("the demo flag can be forced from the URL", () => {
  assert.equal(forcedDemo("?demo=1"), true);
  assert.equal(forcedDemo("?demo=true"), true);
  assert.equal(forcedDemo("?demo=0"), false);
  assert.equal(forcedDemo("?demo=false"), false);
});

test("without a flag the mode is decided by the API health check", () => {
  assert.equal(forcedDemo(""), null);
  assert.equal(forcedDemo("?otra=1"), null);
  assert.equal(forcedDemo("?demostracion=1"), null);
});

test("an unreachable API switches to demo and a healthy one keeps the real mode", () => {
  assert.equal(resolveDemo(null, false), true);
  assert.equal(resolveDemo(null, true), false);
});

test("a forced URL flag wins over the health check", () => {
  assert.equal(resolveDemo(true, true), true);
  assert.equal(resolveDemo(false, false), false);
});

test("the demo backend answers the endpoints the panel loads", async () => {
  const backend = createDemoBackend();

  const settingsResponse = backend("/api/settings");
  assert.equal(settingsResponse.status, 200);
  assert.match(settingsResponse.headers.get("Content-Type") || "", /application\/json/);
  assert.deepEqual(await settingsResponse.json(), DEMO_SETTINGS);

  const models = await backend("/api/models").json();
  assert.deepEqual(models.models, DEMO_MODELS);

  const jobs = await backend("/api/jobs").json();
  assert.deepEqual(jobs, DEMO_JOBS);

  const projects = await backend("/api/projects").json();
  assert.deepEqual(projects, DEMO_PROJECTS);

  const health = await backend("/api/health").json();
  assert.equal(health.ok, true);
  assert.equal(health.mode, "demo");
});

test("the demo backend ignores the query string", async () => {
  const backend = createDemoBackend();
  const jobs = await backend("/api/jobs?t=123").json();
  assert.deepEqual(jobs, DEMO_JOBS);
});

test("mutations are rejected with a message that points to the local version", async () => {
  const backend = createDemoBackend();
  for (const method of ["POST", "PUT", "DELETE"]) {
    const response = backend("/api/jobs", { method });
    assert.equal(response.status, 501);
    const data = await response.json();
    assert.equal(data.error, DEMO_MUTATION_ERROR);
    assert.match(data.error, /demo/i);
    assert.match(data.error, /local/i);
  }
});

test("an unknown endpoint keeps returning a not found error", async () => {
  const backend = createDemoBackend();
  const response = backend("/api/desconocido");
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /no encontrada/i);
});

test("the demo jobs cover the states the dashboard renders", () => {
  assert.ok(DEMO_JOBS.length >= 4);
  const statuses = new Set(DEMO_JOBS.map(job => job.status));
  for (const status of ["running", "validated", "failed", "done"]) {
    assert.ok(statuses.has(status), `falta un trabajo con estado ${status}`);
  }
  const question = DEMO_JOBS.find(job => job.requestKind === "question");
  assert.ok(question, "falta una consulta de ejemplo");
  assert.ok(question.answer);
});

test("every demo job has the fields the panel expects", () => {
  for (const job of DEMO_JOBS) {
    assert.match(job.id, /^[a-f0-9]{8}$/);
    assert.ok(job.name);
    assert.ok(job.request);
    assert.ok(job.phase);
    assert.ok(Array.isArray(job.logs));
    assert.ok(!Number.isNaN(Date.parse(job.createdAt)));
    assert.ok(!Number.isNaN(Date.parse(job.updatedAt)));
  }
});

test("the demo settings reference models that exist in the catalog", () => {
  const known = new Set(DEMO_MODELS.map(model => model.id));
  assert.ok(known.has(DEMO_SETTINGS.commonModel));
  for (const id of Object.values(DEMO_SETTINGS.agentModels)) {
    assert.ok(known.has(id), `modelo desconocido en los ajustes: ${id}`);
  }
});

test("the health probe accepts a healthy API and rejects everything else", async () => {
  const healthy = await probeApiHealth(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assert.equal(healthy, true);

  const notFound = await probeApiHealth(async () => new Response("not found", { status: 404 }));
  assert.equal(notFound, false);

  const malformed = await probeApiHealth(async () => new Response("<html></html>", { status: 200 }));
  assert.equal(malformed, false);

  const offline = await probeApiHealth(async () => { throw new Error("connection refused"); });
  assert.equal(offline, false);
});

test("the health probe gives up instead of blocking the panel", async () => {
  const offline = await probeApiHealth(() => new Promise(() => {}), 20);
  assert.equal(offline, false);
});
