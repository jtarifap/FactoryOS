import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const web = fs.readFileSync(new URL("../web/main.ts", import.meta.url), "utf8");

test("FactoryOS and OpenCode use Factory-manager as the factory entry point", () => {
  const manager = fs.readFileSync(new URL("../.opencode/agents/factory-manager.md", import.meta.url), "utf8");
  const config = JSON.parse(fs.readFileSync(new URL("../.opencode/opencode.jsonc", import.meta.url), "utf8"));
  assert.ok(/^mode: primary$/m.test(manager));
  assert.equal(config.default_agent, "factory-manager");
  assert.equal(fs.existsSync(new URL("../.opencode/agents/brain.md", import.meta.url)), false);
  assert.ok(!/--agent", "brain"|runAgent\(j, "brain"/.test(server), "Server must not launch Brain");
});

test("Factory-manager answers consultations directly and owns project pipeline decisions", () => {
  const manager = fs.readFileSync(new URL("../.opencode/agents/factory-manager.md", import.meta.url), "utf8");
  assert.ok(/consultas directas[\s\S]*responde directamente/i.test(manager));
  assert.ok(/complejidad/i.test(manager) && /pipeline/i.test(manager));
});

test("worker sends a question directly to Factory-manager and project jobs through its pipeline", () => {
  const worker = server.slice(server.indexOf("async function worker()"), server.indexOf("function safeProjectPath("));
  assert.ok(/runConsultation\(j/.test(worker));
  assert.ok(/runAgent\(j, "factory-manager"/.test(worker));
  assert.ok(/j\.answer\s*=\s*answer/.test(worker));
  // The only direct developer call is the explicit quick modification path;
  // every other project job is delegated by Factory-manager.
  const quickStart = worker.indexOf('j.scope === "quick"');
  const quickEnd = worker.indexOf("} else {", quickStart);
  assert.ok(quickStart >= 0 && quickEnd > quickStart, "Missing quick modification branch");
  assert.ok(/runAgent\(j, "developer"/.test(worker.slice(quickStart, quickEnd)), "The quick path runs the developer");
  const outsideQuick = worker.slice(0, quickStart) + worker.slice(quickEnd);
  assert.ok(!/runAgent\(j, "developer"/.test(outsideQuick), "Factory-manager must choose and delegate the full pipeline");
});

test("consultation form uses the query field as input and the response textarea as output", () => {
  assert.ok(/nameLabel\.textContent\s*=\s*isQuestion\s*\?\s*["']Consultar["']\s*:\s*["']Nombre["']/.test(web));
  assert.ok(/name\.placeholder\s*=\s*isQuestion\s*\?\s*["']Escribe aquí tu consulta["']/.test(web));
  assert.ok(/requestLabel\.textContent\s*=\s*isQuestion\s*\?\s*["']Respuestas["']/.test(web));
  assert.ok(/request\.placeholder\s*=\s*isQuestion\s*\?\s*["']Respuestas a tus consultas["']/.test(web));
  assert.ok(/request\.readOnly\s*=\s*isQuestion/.test(web));
  assert.ok(/consultationOutputField\.value\s*=/.test(web));
  const css = fs.readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
  assert.ok(/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/.test(css), "Mode-specific fields must be reliably hidden in the browser");
});

test("consultation output is not duplicated into job logs or project ZIP controls", () => {
  const worker = server.slice(server.indexOf("async function worker()"), server.indexOf("function safeProjectPath("));
  assert.ok(/j\.answer\s*=\s*answer/.test(worker));
  assert.ok(!/log\(j, `Respuesta de/.test(worker));
  assert.ok(/job\.requestKind\s*!==\s*["']question["']/.test(web));
});
