import assert from "node:assert/strict";
import test from "node:test";
import {
  QUICK_SCOPE_MAX_CHARS,
  classifyModification,
} from "../server/modification-scope.ts";

test("short text and style tweaks use the quick scope", () => {
  assert.equal(classifyModification("cambia el color del boton a naranja"), "quick");
  assert.equal(classifyModification("Cambia el texto JT por JORGE TARIFA"), "quick");
  assert.equal(classifyModification("sube el logo 8 pixeles"), "quick");
});

test("functional requests stay in the full pipeline", () => {
  assert.equal(classifyModification("anade una seccion de contacto"), "full");
  assert.equal(classifyModification("crea un formulario de registro"), "full");
  assert.equal(classifyModification("conecta la API de pagos"), "full");
  assert.equal(classifyModification("instala una dependencia para las rutas"), "full");
});

test("long requests and empty input never take the quick path", () => {
  assert.equal(QUICK_SCOPE_MAX_CHARS, 600);
  assert.equal(classifyModification("x".repeat(601)), "full");
  assert.equal(classifyModification(""), "full");
  assert.equal(classifyModification("   "), "full");
  assert.equal(classifyModification(null), "full");
});

test("the classifier ignores accents and letter case", () => {
  assert.equal(classifyModification("AÑADE UNA SECCIÓN nueva"), "full");
  assert.equal(classifyModification("CAMBIA EL TÍTULO"), "quick");
});
