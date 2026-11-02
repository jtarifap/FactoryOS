import assert from "node:assert/strict";
import test from "node:test";
import { extractOpenCodeText, routeRequest } from "../server/request-routing.ts";

test("new projects are routed to the project pipeline", () => {
  assert.deepEqual(routeRequest("project", ""), { kind: "project", action: "new" });
});

test("consultations are routed as direct manager responses", () => {
  assert.deepEqual(routeRequest("question", ""), { kind: "question" });
});

test("an existing project directory routes to modification", () => {
  assert.deepEqual(routeRequest("project", "  projects/demo  "), { kind: "project", action: "modify" });
});

test("an existing directory cannot accidentally be routed as a consultation", () => {
  assert.deepEqual(routeRequest("question", "projects/demo"), { kind: "project", action: "modify" });
});

test("unknown request types are rejected", () => {
  assert.equal(routeRequest("unknown", ""), null);
});

test("consultation response extracts text parts from OpenCode JSON events", () => {
  const output = [
    JSON.stringify({ type: "text", part: { text: "Respuesta " } }),
    JSON.stringify({ type: "text", part: { text: "directa." } }),
    JSON.stringify({ type: "step_finish", part: {} }),
  ].join("\n");
  assert.equal(extractOpenCodeText(output), "Respuesta directa.");
});

test("consultation response falls back to plain text when output is not JSON events", () => {
  assert.equal(extractOpenCodeText("  respuesta simple  \n"), "respuesta simple");
});

test("consultation response rejects structured output that contains no text event", () => {
  assert.equal(extractOpenCodeText(JSON.stringify({ type: "step_finish", part: {} })), "");
});
