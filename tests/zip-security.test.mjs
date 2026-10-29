import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handleZip } from "../server/zip.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = path.join(ROOT, "projects");
const ZIPS = path.join(ROOT, "data", "zips");
const TAR = "C:\\Windows\\System32\\tar.exe";

async function withProject(run) {
  const name = `security-fixture-${randomUUID()}`;
  const directory = path.join(PROJECTS, name);
  const archive = path.join(ZIPS, `${name}.zip`);
  fs.mkdirSync(directory, { recursive: true });
  try { await run({ name, directory, archive }); }
  finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
}

async function withZipServer(run) {
  const server = http.createServer(async (req, res) => {
    try {
      const handled = await handleZip(req, res, new URL(req.url || "/", `http://${req.headers.host}`));
      if (!handled && !res.writableEnded) { res.writeHead(404); res.end(); }
    } catch {
      if (!res.writableEnded) { res.writeHead(500); res.end(); }
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("ZIP rejects synthetic credential files without returning their contents", async () => {
  await withProject(async ({ name, directory, archive }) => {
    const fakeSecret = "ghp_SYNTHETIC_NOT_A_REAL_TOKEN_0123456789";
    fs.writeFileSync(path.join(directory, "index.html"), "safe page");
    fs.writeFileSync(path.join(directory, "credentials.json"), fakeSecret);
    await withZipServer(async origin => {
      const response = await fetch(`${origin}/api/projects/zip?directory=${encodeURIComponent(name)}`);
      const body = await response.text();
      assert.equal(response.status, 422);
      assert.match(body, /credentials\.json/);
      assert.equal(body.includes(fakeSecret), false);
      assert.equal(fs.existsSync(archive), false);
    });
  });
});

test("ZIP rejects high-confidence synthetic secret content in benign-named files", async () => {
  await withProject(async ({ name, directory }) => {
    fs.writeFileSync(path.join(directory, "settings.txt"), "AKIA1234567890ABCDEF");
    await withZipServer(async origin => {
      const response = await fetch(`${origin}/api/projects/zip?directory=${encodeURIComponent(name)}`);
      assert.equal(response.status, 422);
      assert.match(await response.text(), /settings\.txt/);
    });
  });
});

test("ZIP rejects mixed-case excluded directory names instead of skipping their scan", async () => {
  await withProject(async ({ name, directory }) => {
    fs.mkdirSync(path.join(directory, ".GIT"));
    fs.writeFileSync(path.join(directory, ".GIT", "settings.txt"), "AKIA1234567890ABCDEF");
    await withZipServer(async origin => {
      const response = await fetch(`${origin}/api/projects/zip?directory=${encodeURIComponent(name)}`);
      assert.equal(response.status, 422);
      assert.match(await response.text(), /\.GIT/);
    });
  });
});

test("ZIP fails closed when the project exceeds scanner file-size limits", async () => {
  await withProject(async ({ name, directory, archive }) => {
    fs.writeFileSync(path.join(directory, "large.bin"), Buffer.alloc(1024 * 1024 + 1, 65));
    await withZipServer(async origin => {
      const response = await fetch(`${origin}/api/projects/zip?directory=${encodeURIComponent(name)}`);
      assert.equal(response.status, 422);
      assert.match(await response.text(), /inspección de seguridad/i);
      assert.equal(fs.existsSync(archive), false);
    });
  });
});

test("ZIP delivers clean projects and archive contains ordinary project files", async () => {
  await withProject(async ({ name, directory, archive }) => {
    fs.mkdirSync(path.join(directory, "assets"));
    fs.mkdirSync(path.join(directory, ".cache"));
    fs.mkdirSync(path.join(directory, "vendor", "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(directory, "vendor", ".git"), { recursive: true });
    fs.mkdirSync(path.join(directory, "vendor", ".cache"), { recursive: true });
    fs.mkdirSync(path.join(directory, "nested", "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(directory, ".git"));
    fs.mkdirSync(path.join(directory, "logs"));
    fs.writeFileSync(path.join(directory, "index.html"), "<h1>clean fixture</h1>");
    fs.writeFileSync(path.join(directory, "assets", "site.css"), "body{color:black}");
    fs.writeFileSync(path.join(directory, ".cache", "fixture.txt"), "not for archive");
    fs.writeFileSync(path.join(directory, "vendor", "node_modules", "fixture.txt"), "not for archive");
    fs.writeFileSync(path.join(directory, "vendor", ".git", "fixture.txt"), "not for archive");
    fs.writeFileSync(path.join(directory, "vendor", ".cache", "fixture.txt"), "not for archive");
    fs.writeFileSync(path.join(directory, "nested", "node_modules", "fixture.txt"), "not for archive");
    fs.writeFileSync(path.join(directory, ".git", "fixture.txt"), "not for archive");
    fs.writeFileSync(path.join(directory, "logs", "fixture.log"), "not for archive");
    await withZipServer(async origin => {
      const response = await fetch(`${origin}/api/projects/zip?directory=${encodeURIComponent(name)}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/zip");
      assert.ok((await response.arrayBuffer()).byteLength > 0);
      const listing = spawnSync(TAR, ["-tf", archive], { encoding: "utf8", windowsHide: true });
      assert.equal(listing.status, 0, listing.stderr);
      assert.match(listing.stdout, /index\.html/);
      assert.match(listing.stdout, /site\.css/);
      assert.doesNotMatch(listing.stdout, /\.cache|node_modules|\.git|fixture\.log/);
    });
  });
});

test("ZIP refuses a project directory junction that points outside projects", async t => {
  const name = `security-link-${randomUUID()}`;
  const link = path.join(PROJECTS, name);
  const archive = path.join(ZIPS, `${name}.zip`);
  const outside = fs.mkdtempSync(path.join(path.dirname(PROJECTS), "devfactory-outside-project-"));
  try {
    fs.writeFileSync(path.join(outside, "index.html"), "synthetic outside project");
    try { fs.symlinkSync(outside, link, "junction"); }
    catch { t.skip("Windows junction creation is unavailable in this environment"); return; }
    await withZipServer(async origin => {
      const response = await fetch(`${origin}/api/projects/zip?directory=${encodeURIComponent(name)}`);
      assert.notEqual(response.status, 200);
      assert.doesNotMatch(await response.text(), /synthetic outside project/);
    });
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
});
