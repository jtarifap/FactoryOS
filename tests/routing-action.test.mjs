import assert from "node:assert/strict";
import test from "node:test";
import { resolveJobAction, routeRequest } from "../server/request-routing.ts";

test("a new action remains a creation even when a directory is assigned", () => {
  assert.deepEqual(routeRequest("project", "projects/demo", "new"), { kind: "project", action: "new" });
  assert.deepEqual(routeRequest("new", "projects/demo"), { kind: "project", action: "new" });
  assert.deepEqual(routeRequest({ kind: "project", directory: "projects/demo", action: "new" }), { kind: "project", action: "new" });
});

test("an explicit modify action is preserved", () => {
  assert.deepEqual(routeRequest("project", "projects/demo", "modify"), { kind: "project", action: "modify" });
  assert.deepEqual(routeRequest("modify", "projects/demo"), { kind: "project", action: "modify" });
  assert.deepEqual(routeRequest({ action: "modify", directory: "projects/demo" }), { kind: "project", action: "modify" });
});

test("an explicit question action is never converted into a modification", () => {
  assert.deepEqual(routeRequest("question", "projects/demo", "question"), { kind: "question", action: "question" });
  assert.deepEqual(routeRequest({ kind: "question", directory: "projects/demo", action: "question" }), { kind: "question", action: "question" });
});

test("the legacy two-argument routing remains compatible", () => {
  assert.deepEqual(routeRequest("project", ""), { kind: "project", action: "new" });
  assert.deepEqual(routeRequest("project", "projects/demo"), { kind: "project", action: "modify" });
  assert.deepEqual(routeRequest("question", ""), { kind: "question" });
});

test("unknown explicit actions are rejected", () => {
  assert.equal(routeRequest("project", "projects/demo", "unknown"), null);
});

test("legacy jobs without an action use a safe fallback instead of the directory", () => {
  assert.equal(resolveJobAction({ requestKind: "question", directory: "projects/demo" }), "question");
  assert.equal(resolveJobAction({ requestKind: "project", directory: "projects/demo" }), "new");
  assert.equal(resolveJobAction({ action: "modify", requestKind: "project", directory: "projects/demo" }), "modify");
  assert.equal(resolveJobAction({ action: "new", requestKind: "project", directory: "projects/demo" }), "new");
  assert.equal(resolveJobAction({ requestKind: "project", directory: "projects/demo", checkpoint: "projects/demo-checkpoint" }), "modify");
});
