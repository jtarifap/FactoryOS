import assert from "node:assert/strict";
import test from "node:test";
import {
  isModelId,
  mergeModelLists,
  modelsFromCatalog,
  parseModelBlocks,
} from "../server/model-list.ts";

const verboseModel = (id, data) => `${id}\n${JSON.stringify(data, null, 2)}\n`;

test("provider models with more than one slash are parsed", () => {
  const output = verboseModel("opencode/beam-free", {
    id: "beam-free",
    providerID: "opencode",
    name: "Beam Free",
    status: "active",
    limit: { context: 1048576, output: 131072 },
    cost: { input: 0, output: 0 },
  }) + verboseModel("openrouter/openai/gpt-4.1", {
    id: "openai/gpt-4.1",
    providerID: "openrouter",
    name: "GPT 4.1",
    status: "active",
    limit: { context: 1048576, output: 32768 },
    cost: { input: 2, output: 8 },
    capabilities: { reasoning: false, input: { text: true, image: true, audio: false, pdf: false, video: false } },
  });

  const models = parseModelBlocks(output);

  assert.deepEqual(models.map(m => m.id), ["opencode/beam-free", "openrouter/openai/gpt-4.1"]);
  const router = models[1];
  assert.equal(router.providerID, "openrouter");
  assert.equal(router.name, "GPT 4.1");
  assert.equal(router.limit.context, 1048576);
  assert.equal(router.cost.output, 8);
  assert.equal(router.capabilities.input.image, true);
});

test("model ids with tilde or colon are parsed", () => {
  const output = verboseModel("openrouter/~anthropic/claude-opus-latest", {
    id: "~anthropic/claude-opus-latest",
    providerID: "openrouter",
    name: "Claude Opus Latest",
  }) + verboseModel("openrouter/thinkingmachines/inkling:free", {
    id: "thinkingmachines/inkling:free",
    providerID: "openrouter",
    name: "Inkling Free",
  });

  const models = parseModelBlocks(output);

  assert.deepEqual(models.map(m => m.id), [
    "openrouter/~anthropic/claude-opus-latest",
    "openrouter/thinkingmachines/inkling:free",
  ]);
});

test("an unparsable block does not remove the models around it", () => {
  const output = verboseModel("opencode/beam-free", {
    id: "beam-free",
    providerID: "opencode",
    name: "Beam Free",
  }) + "not a model id\n{\n  \"id\": \"broken\"\n}\n" + verboseModel("openai/gpt-4.1", {
    id: "gpt-4.1",
    providerID: "openai",
    name: "GPT 4.1",
  });

  const models = parseModelBlocks(output);

  assert.deepEqual(models.map(m => m.id), ["opencode/beam-free", "openai/gpt-4.1"]);
});

test("model ids accept provider ids with several segments", () => {
  assert.equal(isModelId("openrouter/openai/gpt-4.1"), true);
  assert.equal(isModelId("openrouter/~anthropic/claude-opus-latest"), true);
  assert.equal(isModelId("openrouter/thinkingmachines/inkling:free"), true);
  assert.equal(isModelId("openai/gpt-4.1"), true);
});

test("invalid model ids are rejected", () => {
  assert.equal(isModelId("not-a-model-id"), false);
  assert.equal(isModelId("openrouter"), false);
  assert.equal(isModelId("openrouter/openai/gpt 4.1"), false);
  assert.equal(isModelId("openrouter//gpt"), false);
  assert.equal(isModelId(""), false);
  assert.equal(isModelId(null), false);
  assert.equal(isModelId("a/".repeat(100)), false);
});

test("catalog entries are qualified with their provider id", () => {
  const catalog = {
    openrouter: {
      id: "openrouter",
      models: {
        "openai/gpt-4.1": { id: "openai/gpt-4.1", name: "GPT 4.1", limit: { context: 100, output: 10 }, cost: { input: 1, output: 2 } },
      },
    },
    openai: {
      id: "openai",
      models: {
        "gpt-4.1": { id: "gpt-4.1", name: "GPT 4.1" },
      },
    },
  };

  const models = modelsFromCatalog(catalog);

  assert.deepEqual(models.map(m => m.id).sort(), ["openai/gpt-4.1", "openrouter/openai/gpt-4.1"]);
  const router = models.find(m => m.id === "openrouter/openai/gpt-4.1");
  assert.equal(router.providerID, "openrouter");
  assert.equal(router.name, "GPT 4.1");
  assert.equal(router.limit.context, 100);
});

test("catalog entries without a usable id are ignored", () => {
  assert.deepEqual(modelsFromCatalog(null), []);
  assert.deepEqual(modelsFromCatalog({ broken: { models: "nope" } }), []);
  // Without a provider id a model key without a slash cannot be qualified.
  assert.deepEqual(modelsFromCatalog({ orphan: { models: { "gpt-4.1": { id: "gpt-4.1" } } } }), []);
});

test("catalog entries keep the model key when the entry has no id", () => {
  const models = modelsFromCatalog({ openai: { id: "openai", models: { "gpt-4.1": {} } } });
  assert.deepEqual(models.map(m => m.id), ["openai/gpt-4.1"]);
});

test("deprecated catalog models are not offered", () => {
  const models = modelsFromCatalog({
    openai: {
      id: "openai",
      models: {
        "gpt-4.1": { id: "gpt-4.1", name: "GPT 4.1", status: "deprecated" },
        "gpt-4.1-mini": { id: "gpt-4.1-mini", name: "GPT 4.1 mini" },
      },
    },
  });

  assert.deepEqual(models.map(m => m.id), ["openai/gpt-4.1-mini"]);
});

test("merging keeps the listed models and adds the missing ones", () => {
  const listed = [{ id: "openai/gpt-4.1", name: "GPT 4.1", providerID: "openai" }];
  const extra = [
    { id: "openai/gpt-4.1", name: "GPT 4.1 old", providerID: "openai" },
    { id: "openrouter/openai/gpt-4.1", name: "GPT 4.1 via OpenRouter", providerID: "openrouter" },
  ];

  const merged = mergeModelLists(listed, extra);

  assert.deepEqual(merged.map(m => m.id), ["openai/gpt-4.1", "openrouter/openai/gpt-4.1"]);
  assert.equal(merged[0].name, "GPT 4.1");
});
