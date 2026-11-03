import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AGENT_IDS, normalizeAgentModels, syncAgentModelFiles, updateAgentModelFrontmatter } from "../server/agent-model-config.ts";

test("factory model configuration includes all six project agents", () => {
  assert.deepEqual(AGENT_IDS, [
    "factory-manager",
    "developer",
    "qa-reviewer",
    "delivery-manager",
    "disenador",
    "auditoria-seguridad",
  ]);
});

test("adding an agent model preserves its instructions and other frontmatter", () => {
  const source = "---\ndescription: Test agent\nmode: subagent\n---\nPrompt body stays intact.\n";
  const updated = updateAgentModelFrontmatter(source, "openai/gpt-6-luna");
  assert.match(updated, /^---\n/m);
  assert.match(updated, /^description: Test agent$/m);
  assert.match(updated, /^mode: subagent$/m);
  assert.match(updated, /^model: openai\/gpt-6-luna$/m);
  assert.match(updated, /\n---\n/);
  assert.ok(updated.endsWith("Prompt body stays intact.\n"));
});

test("updating a model changes only the existing model frontmatter entry", () => {
  const source = "---\ndescription: Test agent\nmodel: old/provider\nmode: subagent\n---\nKeep this body.\n";
  const updated = updateAgentModelFrontmatter(source, "new/provider");
  assert.equal((updated.match(/^model:/gm) || []).length, 1);
  assert.match(updated, /model: new\/provider/);
  assert.doesNotMatch(updated, /old\/provider/);
  assert.ok(updated.endsWith("Keep this body.\n"));
});

test("invalid model IDs and malformed agent frontmatter are rejected", () => {
  const validAgent = "---\ndescription: Test\nmode: subagent\n---\nBody\n";
  assert.throws(() => updateAgentModelFrontmatter(validAgent, "not-a-model-id"), /model/i);
  assert.throws(() => updateAgentModelFrontmatter("no frontmatter", "provider/model"), /frontmatter/i);
});

test("common mode assigns the common model to all six agents", () => {
  const result = normalizeAgentModels("common", "provider/common", {});
  assert.equal(result?.mode, "common");
  assert.ok(AGENT_IDS.every(id => result.agentModels[id] === "provider/common"));
});

test("independent mode preserves each model and fills missing new-agent models from common", () => {
  const result = normalizeAgentModels("independent", "provider/fallback", {
    "factory-manager": "provider/manager",
    developer: "provider/developer",
  });
  assert.equal(result?.mode, "independent");
  assert.equal(result.agentModels["factory-manager"], "provider/manager");
  assert.equal(result.agentModels.developer, "provider/developer");
  assert.equal(result.agentModels.disenador, "provider/fallback");
  assert.equal(result.agentModels["auditoria-seguridad"], "provider/fallback");
});

test("invalid agent model IDs reject the complete settings payload", () => {
  assert.equal(normalizeAgentModels("independent", "provider/fallback", {
    developer: "invalid model",
  }), null);
});

test("aggregator model IDs with several segments are accepted", () => {
  const result = normalizeAgentModels("independent", "openrouter/openai/gpt-4.1", {
    developer: "openrouter/~anthropic/claude-opus-latest",
    "qa-reviewer": "openrouter/thinkingmachines/inkling:free",
  });
  assert.equal(result?.commonModel, "openrouter/openai/gpt-4.1");
  assert.equal(result?.agentModels.developer, "openrouter/~anthropic/claude-opus-latest");
  assert.equal(result?.agentModels["qa-reviewer"], "openrouter/thinkingmachines/inkling:free");
  assert.equal(result?.agentModels["delivery-manager"], "openrouter/openai/gpt-4.1");
});

test("an agent model without a provider segment is rejected", () => {
  assert.equal(normalizeAgentModels("common", "openrouter", {}), null);
  assert.equal(normalizeAgentModels("independent", "provider/fallback", {
    developer: "openrouter",
  }), null);
});

test("aggregator model IDs are written to the agent frontmatter", () => {
  const source = "---\ndescription: Test agent\nmode: subagent\n---\nPrompt body stays intact.\n";
  const updated = updateAgentModelFrontmatter(source, "openrouter/openai/gpt-4.1");
  assert.match(updated, /^model: openrouter\/openai\/gpt-4\.1$/m);
  assert.ok(updated.endsWith("Prompt body stays intact.\n"));
});

test("sync writes each selected model while preserving each agent prompt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-agent-models-"));
  try {
    for (const agent of AGENT_IDS) fs.writeFileSync(path.join(directory, `${agent}.md`), `---\ndescription: ${agent}\nmode: subagent\n---\n${agent} instructions\n`);
    const models = Object.fromEntries(AGENT_IDS.map((agent, index) => [agent, `provider/model-${index}`]));
    syncAgentModelFiles(directory, models);
    AGENT_IDS.forEach((agent, index) => {
      const content = fs.readFileSync(path.join(directory, `${agent}.md`), "utf8");
      assert.match(content, new RegExp(`^model: provider/model-${index}$`, "m"));
      assert.ok(content.endsWith(`${agent} instructions\n`));
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sync rejects a missing agent config before changing existing configs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-agent-models-"));
  try {
    const existing = path.join(directory, "factory-manager.md");
    const original = "---\ndescription: manager\nmode: primary\n---\nKeep me.\n";
    fs.writeFileSync(existing, original);
    const models = Object.fromEntries(AGENT_IDS.map(agent => [agent, "provider/model"]));
    assert.throws(() => syncAgentModelFiles(directory, models), /developer\.md/);
    assert.equal(fs.readFileSync(existing, "utf8"), original);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
