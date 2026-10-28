import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import test from "node:test";
import ts from "typescript";

function probe() {
  const source = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  // Execute the production probe and its error classifiers without starting the worker/API.
  const code = source.slice(source.indexOf("const KNOWN_MODEL_ERRORS"), source.indexOf("function runAgent("));
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let invocation;
  let killed = false;
  const context = vm.createContext({
    Buffer, Date, process, ROOT: ".", OPENCODE_BIN: "opencode.exe",
    spawn: (bin, args, options) => { invocation = { bin, args, options }; return child; },
    killTree: () => { killed = true; }, setTimeout: () => 1, clearTimeout: () => {},
  });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const result = vm.runInContext('testOpenCodeModel("openai/test", "factory-manager")', context);
  return { child, result, invocation, isKilled: () => killed };
}

test("connection probe bypasses factory agent instructions and requests only text", async () => {
  const p = probe();
  const args = p.invocation.args;
  assert.equal(args[args.indexOf("--agent") + 1], "build");
  assert.equal(args[args.indexOf("--format") + 1], "json");
  assert.match(args.at(-1), /No uses herramientas/);
  p.child.stdout.emit("data", Buffer.from('{"type":"text","part":{"text":"OK"}}\n'));
  p.child.emit("close", 0);
  assert.equal((await p.result).ok, true);
});

test("successful CLI exit without model text is not a successful connection", async () => {
  const p = probe();
  p.child.emit("close", 0);
  const result = await p.result;
  assert.equal(result.ok, false);
  assert.match(result.error, /sin respuesta de texto/);
});

test("free usage limit is reported immediately rather than waiting for timeout", async () => {
  const p = probe();
  p.child.stderr.emit("data", Buffer.from('ERROR error.error=Free usage limit reached. Free models work in OpenCode\n'));
  assert.equal(p.isKilled(), true);
  const result = await p.result;
  assert.equal(result.ok, false);
  assert.match(result.error, /[Ll]ímite.*gratuit/);
});
