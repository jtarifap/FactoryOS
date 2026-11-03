import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import net from "node:net";
import test from "node:test";
import { killTree } from "../server/runner.ts";

const PORT = 45991;

const isPortOpen = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: "127.0.0.1" });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => { socket.destroy(); resolve(false); });
  socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
});

const waitFor = async (predicate, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
};

test("Windows tree termination waits for taskkill before killing the parent", async () => {
  const taskkill = new EventEmitter();
  const order = [];
  const child = Object.assign(new EventEmitter(), { pid: 12345, kill: () => { order.push("parent"); } });

  const pending = killTree(child, "win32", (command, args) => {
    order.push([command, ...args]);
    return taskkill;
  });

  assert.deepEqual(order, [["taskkill", "/pid", "12345", "/T", "/F"]]);
  taskkill.emit("close", 0);
  await pending;
  assert.equal(order.at(-1), "parent");
});

test("killing the preview process also kills the app it started", async () => {
  // The wrapper spawns a child that opens the port, like `npm run start` does.
  const helper = `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", "require('http').createServer((q,s)=>s.end('x')).listen(${PORT})"], { stdio: "ignore" });
    setInterval(() => {}, 1000);
  `;
  const proc = spawn(process.execPath, ["-e", helper], { stdio: "ignore" });

  try {
    assert.ok(await waitFor(() => isPortOpen(PORT)), "the child process should be listening");

    await killTree(proc);

    assert.ok(await waitFor(async () => !(await isPortOpen(PORT))), "the app process should be gone");
  } finally {
    try { proc.kill(); } catch {}
    // Clean up anything that survived.
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  }
});
