import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VIEW, MENU_ITEMS, hashForView, viewFromHash } from "../web/navigation.ts";

test("the menu shows the dashboard first and the current sections", () => {
  assert.deepEqual(MENU_ITEMS.map(item => item.id), [
    "dashboard",
    "nuevo",
    "trabajos",
    "preview",
    "ajustes",
  ]);
  assert.deepEqual(MENU_ITEMS.map(item => item.label), [
    "Dashboard",
    "Nuevo proyecto",
    "Trabajos",
    "Vista previa",
    "Ajustes",
  ]);
});

test("the dashboard is the default view", () => {
  assert.equal(DEFAULT_VIEW, "dashboard");
});

test("a known hash selects its view", () => {
  assert.equal(viewFromHash("#/dashboard"), "dashboard");
  assert.equal(viewFromHash("#/trabajos"), "trabajos");
  assert.equal(viewFromHash("#/preview"), "preview");
  assert.equal(viewFromHash("#/ajustes"), "ajustes");
});

test("an unknown or empty hash falls back to the dashboard", () => {
  assert.equal(viewFromHash(""), "dashboard");
  assert.equal(viewFromHash("#/"), "dashboard");
  assert.equal(viewFromHash("#/inventada"), "dashboard");
  assert.equal(viewFromHash("cualquier cosa"), "dashboard");
});

test("every view has its own hash", () => {
  for (const item of MENU_ITEMS) {
    assert.equal(hashForView(item.id), `#/${item.id}`);
    assert.equal(viewFromHash(hashForView(item.id)), item.id);
  }
});
