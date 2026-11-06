import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectGroups,
  formatModificationDate,
  isModificationJob,
  projectNameFromDirectory,
  statusLabel,
} from "../web/project-history.ts";

const project = (name, extra = {}) => ({
  name,
  path: `C:\\Projects\\Dev\\DevFactory\\projects\\${name}`,
  hasPackage: false,
  hasIndex: true,
  ...extra,
});

const job = (id, directory, action, createdAt = "2026-11-06T10:00:00.000Z", extra = {}) => ({
  id,
  name: `cambio ${id}`,
  request: `solicitud ${id}`,
  action,
  status: "done",
  phase: "Completado",
  createdAt,
  updatedAt: createdAt,
  directory,
  logs: [],
  ...extra,
});

test("project names are derived from Windows and POSIX paths", () => {
  assert.equal(projectNameFromDirectory("C:\\Projects\\Dev\\DevFactory\\projects\\alpha"), "alpha");
  assert.equal(projectNameFromDirectory("/srv/factoryos/projects/beta/"), "beta");
  assert.equal(projectNameFromDirectory(""), "");
  assert.equal(projectNameFromDirectory(null), "");
});

test("only explicit modification jobs belong to the history", () => {
  assert.equal(isModificationJob(job("a", "C:\\projects\\alpha", "modify")), true);
  assert.equal(isModificationJob(job("b", "C:\\projects\\alpha", "new")), false);
  assert.equal(isModificationJob(job("c", "C:\\projects\\alpha", "question")), false);
});

test("modifications are grouped under their original project and sorted newest first", () => {
  const groups = buildProjectGroups(
    [project("alpha"), project("beta")],
    [
      job("old", "C:\\projects\\alpha", "modify", "2026-11-05T10:00:00.000Z"),
      job("new", "C:\\projects\\alpha", "modify", "2026-11-06T10:00:00.000Z"),
      job("creation", "C:\\projects\\alpha", "new"),
      job("unknown", "C:\\projects\\gamma", "modify"),
    ],
  );

  assert.deepEqual(groups.map(group => group.project.name), ["alpha", "beta"]);
  assert.deepEqual(groups[0].modifications.map(item => item.id), ["new", "old"]);
  assert.deepEqual(groups[1].modifications, []);
});

test("modification status and dates are rendered in a stable form", () => {
  assert.equal(statusLabel("validated"), "Validado");
  assert.equal(statusLabel("needs_intervention"), "Requiere intervención");
  assert.equal(statusLabel("custom"), "custom");
  assert.equal(formatModificationDate("2026-11-06T10:30:00.000Z"), "2026-11-06 10:30 UTC");
  assert.equal(formatModificationDate("no es una fecha"), "no es una fecha");
});
