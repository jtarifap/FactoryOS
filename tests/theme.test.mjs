import assert from "node:assert/strict";
import test from "node:test";
import { readTheme, THEME_STORAGE_KEY, toggleTheme } from "../web/theme.ts";

const storageWith = value => ({ getItem: key => key === THEME_STORAGE_KEY ? value : null });

test("theme defaults to dark when there is no saved preference", () => {
  assert.equal(readTheme(storageWith(null)), "dark");
});

test("theme reads saved light and dark preferences", () => {
  assert.equal(readTheme(storageWith("light")), "light");
  assert.equal(readTheme(storageWith("dark")), "dark");
});

test("theme defaults to dark for invalid saved values", () => {
  assert.equal(readTheme(storageWith("system")), "dark");
});

test("theme defaults to dark when storage is unavailable", () => {
  assert.equal(readTheme({ getItem() { throw new Error("blocked"); } }), "dark");
});

test("theme toggle alternates between dark and light", () => {
  assert.equal(toggleTheme("dark"), "light");
  assert.equal(toggleTheme("light"), "dark");
});
