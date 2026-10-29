import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handlePreview } from "../server/runner.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = path.join(ROOT, "projects");

test("static preview serves ordinary files but hides credential files", async () => {
  const name = `preview-security-${randomUUID()}`;
  const directory = path.join(PROJECTS, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), "<h1>safe</h1>");
  fs.writeFileSync(path.join(directory, ".env"), "SYNTHETIC_VALUE=not-a-real-secret");
  const server = http.createServer(async (req, res) => {
    try { await handlePreview(req, res, new URL(req.url || "/", `http://${req.headers.host}`)); }
    catch { if (!res.writableEnded) { res.writeHead(500); res.end(); } }
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const page = await fetch(`${origin}/preview-static/${name}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /safe/);
    const env = await fetch(`${origin}/preview-static/${name}/.env`);
    assert.equal(env.status, 404);
    assert.doesNotMatch(await env.text(), /SYNTHETIC_VALUE/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("static preview refuses a project directory junction outside projects", async t => {
  const name = `preview-link-${randomUUID()}`;
  const link = path.join(PROJECTS, name);
  const outside = fs.mkdtempSync(path.join(path.dirname(PROJECTS), "devfactory-outside-preview-"));
  fs.writeFileSync(path.join(outside, "index.html"), "synthetic outside preview");
  try {
    try { fs.symlinkSync(outside, link, "junction"); }
    catch { t.skip("Windows junction creation is unavailable in this environment"); return; }
    const server = http.createServer(async (req, res) => {
      try { await handlePreview(req, res, new URL(req.url || "/", `http://${req.headers.host}`)); }
      catch { if (!res.writableEnded) { res.writeHead(500); res.end(); } }
    });
    try {
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/preview-static/${name}/`);
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /synthetic outside preview/);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
