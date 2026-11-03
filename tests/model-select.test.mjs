import assert from "node:assert/strict";
import test from "node:test";
import { buildModelGroups } from "../web/model-select.ts";

test("models are grouped by provider", () => {
  const groups = buildModelGroups([
    { id: "openai/gpt-4.1", name: "GPT 4.1", providerID: "openai" },
    { id: "openrouter/openai/gpt-4.1", name: "GPT 4.1", providerID: "openrouter" },
    { id: "google/gemini-3-pro", name: "Gemini 3 Pro", providerID: "google" },
  ], "openai/gpt-4.1");

  assert.deepEqual(groups.map(group => group.provider), ["openai", "openrouter", "google"]);
  assert.deepEqual(groups[0].options.map(option => option.value), ["openai/gpt-4.1"]);
});

test("the selected model is marked as selected", () => {
  const groups = buildModelGroups([
    { id: "openai/gpt-4.1", name: "GPT 4.1", providerID: "openai" },
    { id: "openrouter/openai/gpt-4.1", name: "GPT 4.1", providerID: "openrouter" },
  ], "openrouter/openai/gpt-4.1");

  const selected = groups.flatMap(group => group.options).filter(option => option.selected);
  assert.deepEqual(selected.map(option => option.value), ["openrouter/openai/gpt-4.1"]);
});

test("the connection status is shown next to the model name", () => {
  const groups = buildModelGroups([
    { id: "openai/gpt-4.1", name: "GPT 4.1", providerID: "openai" },
    { id: "openrouter/openai/gpt-4.1", name: "GPT 4.1", providerID: "openrouter" },
  ], "openai/gpt-4.1", { "openai/gpt-4.1": "ok", "openrouter/openai/gpt-4.1": "no-results" });

  assert.equal(groups[0].options[0].label, "GPT 4.1 ✔");
  assert.equal(groups[1].options[0].label, "GPT 4.1 ⚠");
});

test("a configured model that is not listed stays visible", () => {
  const groups = buildModelGroups([
    { id: "openai/gpt-4.1", name: "GPT 4.1", providerID: "openai" },
  ], "openrouter/minimax/minimax-m3.1-flash");

  const missing = groups.find(group => group.provider === "no disponible");
  assert.ok(missing, "the missing model should be listed");
  assert.equal(missing.options[0].value, "openrouter/minimax/minimax-m3.1-flash");
  assert.equal(missing.options[0].selected, true);
  assert.match(missing.options[0].label, /no disponible/);
});

test("models without provider are grouped as unknown", () => {
  const groups = buildModelGroups([{ id: "custom/model", name: "Custom" }], "");
  assert.deepEqual(groups.map(group => group.provider), ["unknown"]);
});
