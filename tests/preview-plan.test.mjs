import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreviewCommand,
  choosePreviewScript,
  detectPreviewUrl,
  parsePackageJson,
  splitExtraArgs,
} from "../server/preview-plan.ts";

test("a package.json with a UTF-8 BOM is parsed", () => {
  const raw = "\uFEFF{ \"scripts\": { \"dev\": \"vite\" } }";
  const parsed = parsePackageJson(raw);
  assert.equal(parsed?.scripts?.dev, "vite");
});

test("an invalid package.json returns null instead of throwing", () => {
  assert.equal(parsePackageJson("{ broken"), null);
  assert.equal(parsePackageJson(""), null);
  assert.equal(parsePackageJson("[]"), null);
});

test("the preview prefers the dev script and falls back to the usual ones", () => {
  assert.equal(choosePreviewScript({ dev: "vite", start: "node dist/server.js" }), "dev");
  assert.equal(choosePreviewScript({ start: "node dist/server.js" }), "start");
  assert.equal(choosePreviewScript({ preview: "vite preview" }), "preview");
  assert.equal(choosePreviewScript({ serve: "node server.js" }), "serve");
  assert.equal(choosePreviewScript({ watch: "nodemon" }), "watch");
  assert.equal(choosePreviewScript({ build: "vite build", test: "vitest" }), null);
  assert.equal(choosePreviewScript(undefined), null);
});

test("the command runs the script with the extra arguments and the port", () => {
  const args = buildPreviewCommand("dev", ["--host"], 4321);
  assert.deepEqual(args, ["run", "dev", "--", "--host", "--port", "4321"]);
});

test("the port is not injected for start scripts", () => {
  const args = buildPreviewCommand("start", [], 4321);
  assert.deepEqual(args, ["run", "start"]);
});

test("an explicit port from the user is not overridden", () => {
  const args = buildPreviewCommand("dev", ["--port", "8080"], 4321);
  assert.deepEqual(args, ["run", "dev", "--", "--port", "8080"]);
});

test("the extra arguments are split respecting quotes", () => {
  assert.deepEqual(splitExtraArgs("--host 0.0.0.0 --title 'Mi App'"), ["--host", "0.0.0.0", "--title", "Mi App"]);
  assert.deepEqual(splitExtraArgs("   "), []);
  assert.deepEqual(splitExtraArgs(""), []);
});

test("the port the app prints in its logs is the one that is used", () => {
  const logs = [
    "  VITE v6.1.0  ready in 412 ms",
    "",
    "  ➜  Local:   http://localhost:5173/",
    "  ➜  Network: use --host to expose",
  ];
  assert.equal(detectPreviewUrl(logs, 4321), "http://127.0.0.1:5173/");
});

test("a silent app falls back to the requested port", () => {
  assert.equal(detectPreviewUrl([], 4321), "http://127.0.0.1:4321/");
  assert.equal(detectPreviewUrl(["nada que ver"], 4321), "http://127.0.0.1:4321/");
});

test("external urls in the logs are ignored", () => {
  const logs = ["Docs: https://vite.dev/config/", "Local: http://localhost:3000/"];
  assert.equal(detectPreviewUrl(logs, 4321), "http://127.0.0.1:3000/");
});
