import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

test("server stores a model for all six agents and normalizes common or independent modes", () => {
  assert.ok(/import \{ AGENT_IDS, normalizeAgentModels, syncAgentModelFiles/.test(server), "Server must use the tested six-agent settings helper");
  assert.ok(/agentModels:\s*AgentModelMap/.test(server), "Settings need one model per agent");
  assert.ok(/normalizeAgentModels\(/.test(server), "Settings API must normalize both model modes");
  assert.ok(/syncAgentModelFiles\(/.test(server), "Selected models must reach OpenCode agent config");
  assert.ok(/saved\.agentModelConfigVersion === 2 && saved\.mode === "common" \? "common" : "independent"/.test(server), "Legacy settings must restore independent controls");
});

test("settings save the six models to agent frontmatter before returning success", () => {
  const update = server.slice(server.indexOf('if (u.pathname === "/api/settings" && req.method === "PUT")'), server.indexOf('if (u.pathname === "/api/settings/validate"'));
  assert.ok(update.indexOf("syncAgentModelFiles(") < update.indexOf("settings = next"));
  assert.ok(/settings = next; saveSettings\(\)/.test(update));
});

test("effective model lookup honors the role selected by FactoryOS", () => {
  const effective = server.slice(server.indexOf("function effectiveModel("), server.indexOf("function normalizeSettings("));
  assert.ok(/settings\.agentModels\[agent\]/.test(effective));
  assert.ok(!/settings\.agentModels\["factory-manager"\]/.test(effective));
});

test("all six agents can be tested with the model probe endpoint", () => {
  const probe = server.slice(server.indexOf('if (u.pathname === "/api/models/test"'), server.indexOf('if (u.pathname === "/api/jobs" && req.method === "GET")'));
  assert.ok(/AGENT_IDS\.includes\(agent\)/.test(probe), "Model probe must accept every configured agent");
});

test("consultations call Factory-manager once and persist only the answer field", () => {
  const worker = server.slice(server.indexOf("async function worker()"), server.indexOf("function safeProjectPath("));
  assert.ok(/runConsultation\(j/.test(worker), "Question branch should use a direct Factory-manager consultation");
  assert.ok(/j\.answer\s*=\s*answer/.test(worker), "Consultation response must be persisted separately from request");
  assert.ok(/runAgent\(j, "factory-manager"/.test(worker), "Project pipeline must start at Factory-manager");
  assert.ok(!/runAgent\(j, "brain"|--agent", "brain"/.test(worker), "Brain must be removed from FactoryOS execution");
});

test("Factory-manager is the only factory primary and the project default agent", () => {
  const root = new URL("../.opencode/agents/", import.meta.url);
  const manager = fs.readFileSync(new URL("factory-manager.md", root), "utf8");
  assert.ok(/^mode: primary$/m.test(manager));
  assert.ok(/consulta[\s\S]*directamente/i.test(manager), "Manager must answer consultations directly");
  for (const id of ["developer", "qa-reviewer", "delivery-manager", "disenador", "auditoria-seguridad"]) {
    const agent = fs.readFileSync(new URL(`${id}.md`, root), "utf8");
    assert.ok(/^mode: subagent$/m.test(agent), `${id} must remain a subagent`);
  }
  assert.equal(fs.existsSync(new URL("brain.md", root)), false, "Brain agent must be removed");
  const config = JSON.parse(fs.readFileSync(new URL("../.opencode/opencode.jsonc", import.meta.url), "utf8"));
  assert.equal(config.default_agent, "factory-manager");
});
