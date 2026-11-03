import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardRows,
  buildDashboardStats,
  formatRelativeTime,
} from "../web/dashboard.ts";

const NOW = new Date("2026-11-03T12:00:00.000Z");

const job = (overrides = {}) => ({
  id: "abc12345",
  name: "crm-clientes",
  status: "running",
  phase: "En curso",
  updatedAt: "2026-11-03T11:58:00.000Z",
  tokens: { cost: 3.4 },
  ...overrides,
});

test("the stats count the jobs by state", () => {
  const jobs = [
    job({ id: "a", status: "running" }),
    job({ id: "b", status: "queued" }),
    job({ id: "c", status: "done" }),
    job({ id: "d", status: "validated" }),
    job({ id: "e", status: "failed" }),
    job({ id: "f", status: "needs_intervention" }),
  ];

  const stats = buildDashboardStats(jobs, NOW);

  assert.equal(stats.activos, 2);
  assert.equal(stats.finalizados, 2);
  assert.equal(stats.conError, 2);
});

test("the monthly cost only adds the jobs updated this month", () => {
  const jobs = [
    job({ id: "a", updatedAt: "2026-11-03T10:00:00.000Z", tokens: { cost: 3.4 } }),
    job({ id: "b", updatedAt: "2026-11-01T10:00:00.000Z", tokens: { cost: 2.1 } }),
    job({ id: "c", updatedAt: "2026-10-28T10:00:00.000Z", tokens: { cost: 9.99 } }),
  ];

  const stats = buildDashboardStats(jobs, NOW);

  assert.equal(Math.round(stats.costeMes * 100) / 100, 5.5);
});

test("a job without tokens or cost does not break the stats", () => {
  const stats = buildDashboardStats([
    job({ id: "a", tokens: undefined }),
    job({ id: "b", tokens: { cost: 0 } }),
  ], NOW);

  assert.equal(stats.costeMes, 0);
  assert.equal(stats.activos, 2);
});

test("the rows keep the real name, phase and cost of every job", () => {
  const rows = buildDashboardRows([
    job({ id: "a", name: "crm-clientes", phase: "En curso", tokens: { cost: 3.4 } }),
  ], NOW);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "crm-clientes");
  assert.equal(rows[0].phase, "En curso");
  assert.equal(rows[0].cost, 3.4);
  assert.equal(rows[0].status, "En curso");
  assert.equal(rows[0].tone, "active");
});

test("every job status has a Spanish label and a tone", () => {
  const statuses = ["queued", "running", "done", "validated", "failed", "cancelled", "needs_intervention"];
  const rows = buildDashboardRows(statuses.map((status, index) => job({ id: `id${index}`, status })), NOW);

  assert.deepEqual(rows.map(row => row.status), [
    "En cola",
    "En curso",
    "Completado",
    "Validado",
    "Con error",
    "Cancelado",
    "Requiere intervención",
  ]);
  assert.deepEqual(rows.map(row => row.tone), [
    "idle",
    "active",
    "ok",
    "ok",
    "error",
    "muted",
    "error",
  ]);
});

test("a job without a name falls back to its id", () => {
  const rows = buildDashboardRows([job({ id: "xyz", name: "" })], NOW);
  assert.equal(rows[0].name, "xyz");
});

test("relative times are written in Spanish", () => {
  assert.equal(formatRelativeTime("2026-11-03T11:59:30.000Z", NOW), "hace un momento");
  assert.equal(formatRelativeTime("2026-11-03T11:45:00.000Z", NOW), "hace 15 min");
  assert.equal(formatRelativeTime("2026-11-03T09:00:00.000Z", NOW), "hace 3 h");
  assert.equal(formatRelativeTime("2026-11-02T12:00:00.000Z", NOW), "ayer");
  assert.equal(formatRelativeTime("2026-10-31T12:00:00.000Z", NOW), "hace 3 d");
});

test("an invalid date is shown as unknown", () => {
  assert.equal(formatRelativeTime("no-es-una-fecha", NOW), "desconocido");
  assert.equal(formatRelativeTime("", NOW), "desconocido");
});

test("the relative time of a far away job falls back to the date", () => {
  assert.match(formatRelativeTime("2026-06-01T12:00:00.000Z", NOW), /01\/06\/2026/);
});
