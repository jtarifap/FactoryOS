import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadCoordinator() {
  const source = fs.readFileSync(new URL("../server/job-coordinator.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports });
  return module.exports;
}

test("worker lease excludes overlapping runs and its release is idempotent", () => {
  const { WorkerLease } = loadCoordinator();
  const lease = new WorkerLease();
  const release = lease.tryAcquire();
  assert.equal(typeof release, "function");
  assert.equal(lease.tryAcquire(), null);
  release();
  release();
  assert.equal(typeof lease.tryAcquire(), "function");
});

test("job process registry cancels every child without affecting another job", () => {
  const { JobProcessRegistry } = loadCoordinator();
  const killed = [];
  const registry = new JobProcessRegistry(child => killed.push(child.id));
  const first = Object.assign(new EventEmitter(), { id: "first" });
  const second = Object.assign(new EventEmitter(), { id: "second" });
  const unrelated = Object.assign(new EventEmitter(), { id: "unrelated" });
  registry.add("job-1", first);
  registry.add("job-1", second);
  registry.add("job-2", unrelated);

  registry.cancel("job-1");

  assert.deepEqual(killed, ["first", "second"]);
  assert.equal(registry.isCancelled("job-1"), true);
  assert.equal(registry.isCancelled("job-2"), false);
  first.emit("close");
  second.emit("close");
  registry.finish("job-1");
  assert.equal(registry.isCancelled("job-1"), false);
});

test("process registered after cancellation is terminated immediately", () => {
  const { JobProcessRegistry } = loadCoordinator();
  const killed = [];
  const registry = new JobProcessRegistry(child => killed.push(child.id));
  registry.cancel("job-1");
  const late = Object.assign(new EventEmitter(), { id: "late" });
  registry.add("job-1", late);
  assert.deepEqual(killed, ["late"]);
});

test("finished job releases process registry after child closes", () => {
  const { JobProcessRegistry } = loadCoordinator();
  const registry = new JobProcessRegistry(() => {});
  const child = new EventEmitter();
  registry.add("job-1", child);
  registry.finish("job-1");
  assert.equal(registry.isCancelled("job-1"), false);
  child.emit("close");
  assert.equal(registry.isCancelled("job-1"), false);
});

test("finishing a job waits for outstanding child processes to close", async () => {
  const { JobProcessRegistry } = loadCoordinator();
  const registry = new JobProcessRegistry(() => {});
  const child = new EventEmitter();
  registry.add("job-1", child);
  let settled = false;
  const finished = registry.finish("job-1").then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit("close");
  await finished;
  assert.equal(settled, true);
});

test("child arriving after cancellation remains tracked until close", async () => {
  const { JobProcessRegistry } = loadCoordinator();
  const killed = [];
  const registry = new JobProcessRegistry(child => killed.push(child.id));
  registry.cancel("job-late");
  const child = Object.assign(new EventEmitter(), { id: "late" });
  registry.add("job-late", child);
  let finished = false;
  const pending = registry.finish("job-late").then(() => { finished = true; });
  await Promise.resolve();
  assert.deepEqual(killed, ["late"]);
  assert.equal(finished, false);
  child.emit("close");
  await pending;
  assert.equal(finished, true);
});

test("job process registry stays active until worker finish completes", async () => {
  const { JobProcessRegistry } = loadCoordinator();
  const registry = new JobProcessRegistry(() => {});
  const child = new EventEmitter();
  registry.add("job-active", child);
  child.emit("close");
  assert.equal(registry.isActive("job-active"), true);
  await registry.finish("job-active");
  assert.equal(registry.isActive("job-active"), false);
});

test("Windows tree termination waits for taskkill before killing the parent", () => {
  const { terminateChildTree } = loadCoordinator();
  const taskkill = new EventEmitter();
  const order = [];
  const child = Object.assign(new EventEmitter(), { pid: 12345, kill: () => order.push("parent") });
  terminateChildTree(child, "win32", (command, args) => {
    order.push([command, ...args]);
    return taskkill;
  });
  assert.deepEqual(order, [["taskkill", "/pid", "12345", "/T", "/F"]]);
  taskkill.emit("close", 0);
  assert.deepEqual(order.at(-1), "parent");
});

test("Windows tree termination kills a real child process tree", { skip: process.platform !== "win32" }, async t => {
  const { terminateChildTree } = loadCoordinator();
  const script = "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(c.pid); setInterval(()=>{},1000);";
  const parent = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  let descendantPid;
  try {
    descendantPid = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child PID was not reported")), 5000);
      parent.stdout.on("data", data => {
        const value = Number(data.toString("utf8").trim().split(/\r?\n/)[0]);
        if (Number.isInteger(value)) { clearTimeout(timer); resolve(value); }
      });
      parent.once("error", reject);
    });
    const parentClosed = new Promise(resolve => parent.once("close", resolve));
    terminateChildTree(parent, "win32", (command, args) => spawn(command, args, { stdio: "ignore", windowsHide: true }));
    await parentClosed;
    let remains = true;
    for (let attempt = 0; attempt < 20 && remains; attempt++) {
      const result = spawnSync("tasklist", ["/FI", `PID eq ${descendantPid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
      remains = result.stdout.includes(`"${descendantPid}"`);
      if (remains) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(remains, false, `descendant process ${descendantPid} survived tree termination`);
  } finally {
    if (parent.pid) spawnSync("taskkill", ["/PID", String(parent.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    if (descendantPid) spawnSync("taskkill", ["/PID", String(descendantPid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
});
