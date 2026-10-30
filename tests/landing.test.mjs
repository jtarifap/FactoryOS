import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const file = (relative) => new URL(relative, import.meta.url);
const read = (relative) => fs.readFileSync(file(relative), "utf8");
const exists = (relative) => fs.existsSync(file(relative));

test("la landing es la entrada web y la app conserva su propia página", () => {
  assert.ok(exists("../web/index.html"), "falta web/index.html");
  assert.ok(exists("../web/landing.css"), "falta web/landing.css");
  assert.ok(exists("../web/app.html"), "falta web/app.html");
});

test("la landing conserva sus secciones y etiquetas", () => {
  const html = read("../web/index.html");
  for (const id of ["agentes", "flujo", "docs", "github", "empezar"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta la sección ${id}`);
  }
  for (const label of ["Agentes", "Flujo", "Docs", "GitHub", "Empezar"]) {
    assert.ok(html.includes(label), `falta la etiqueta ${label}`);
  }
});

test("los botones de inicio abren la aplicación FactoryOS", () => {
  const html = read("../web/index.html");
  assert.match(html, /<a[^>]*class="cta"[^>]*href="\/app\.html"[^>]*>Empezar<\/a>/);
  assert.match(html, /<a[^>]*class="cta"[^>]*href="\/app\.html"[^>]*>Crear mi primer proyecto<\/a>/);
  assert.ok(!html.includes('href="#empezar"'), "quedan botones apuntando al ancla interna");
});

test("la landing no carga el bundle del panel", () => {
  const html = read("../web/index.html");
  assert.ok(!html.includes("/main.ts"), "la landing no debe ejecutar la app");
});

test("el CTA mantiene el contraste del texto al pasar el ratón", () => {
  const css = read("../web/landing.css");
  assert.match(css, /\.cta:hover\s*\{[^}]*color:\s*var\(--bg\)/, "a:hover pisaría el color del CTA");
});

test("vite declara la landing y la app como entradas de build", () => {
  const config = read("../vite.config.ts");
  assert.match(config, /web\/index\.html/);
  assert.match(config, /web\/app\.html/);
});

test("el logo y el nombre comparten la misma alineación", () => {
  assert.match(read("../web/index.html"), /viewBox="0 11 64 64"/);
  assert.match(read("../web/main.ts"), /viewBox="0 11 64 64"/);
});

test("los enlaces de la landing apuntan a destinos reales", () => {
  const html = read("../web/index.html");
  assert.ok(!html.includes('href="#"'), "quedan enlaces muertos en la portada");
  assert.ok(html.includes("https://github.com/jtarifap/DevFactory"), "falta el repositorio real");
});

test("la página de la app sigue cargando el bundle de FactoryOS", () => {
  const html = read("../web/app.html");
  assert.match(html, /src="\/main\.ts"/);
  assert.match(html, /id="app"/);
});

test("la landing conserva los tokens de diseño de FactoryOS", () => {
  const css = read("../web/landing.css");
  assert.ok(css.includes("#0c0d0e"));
  assert.ok(css.includes("#ff9f1c"));
  assert.ok(css.includes("JetBrains Mono"));
});
