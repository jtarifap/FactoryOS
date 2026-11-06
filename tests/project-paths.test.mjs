import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseProjectName, resolveProjectDirectory } from "../server/project-paths.ts";

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-paths-"));
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("project names accept a direct child or the documented projects/ prefix", () => {
  assert.equal(parseProjectName("demo"), "demo");
  assert.equal(parseProjectName(" projects/demo "), "demo");
  assert.equal(parseProjectName("projects\\demo"), "demo");
  assert.equal(parseProjectName("demo-1234"), "demo-1234");
});

test("project names reject traversal, absolute paths and invalid Windows names", () => {
  for (const input of [
    "", "   ", "..", "../demo", "demo/../other", "projects/../other", "projects", "projects/", "projects/demo/extra",
    "C:\\Windows", "C:/Windows", "/etc", "\\\\server\\share", "C:demo", "//server/share",
    "CON", "nul", "com1", "lpt9", "name.", "name ", "a:b", "a*b", "a?b", "a|b", 'a"b', "a<b", "a>b", "a\0b",
    null, 42, {},
  ]) {
    assert.equal(parseProjectName(input), null, String(input));
  }
});

test("an existing direct child is resolved canonically", () => {
  withRoot(root => {
    const directory = path.join(root, "demo");
    fs.mkdirSync(directory);
    assert.deepEqual(resolveProjectDirectory(root, "demo"), {
      ok: true,
      name: "demo",
      directory: fs.realpathSync(directory),
    });
    assert.equal(resolveProjectDirectory(root, "projects/demo").ok, true);
  });
});

test("missing projects and regular files are rejected", () => {
  withRoot(root => {
    assert.equal(resolveProjectDirectory(root, "missing").ok, false);
    assert.equal(resolveProjectDirectory(root, "missing").reason, "not-found");
    fs.writeFileSync(path.join(root, "file.txt"), "not a directory");
    assert.equal(resolveProjectDirectory(root, "file.txt").ok, false);
    assert.equal(resolveProjectDirectory(root, "file.txt").reason, "not-directory");
  });
});

test("directory junctions are rejected even when they point inside projects", t => {
  withRoot(root => {
    fs.mkdirSync(path.join(root, "target"));
    try { fs.symlinkSync(path.join(root, "target"), path.join(root, "link"), "junction"); }
    catch { t.skip("Windows junction creation is unavailable in this environment"); return; }
    assert.equal(resolveProjectDirectory(root, "link").ok, false);
    assert.equal(resolveProjectDirectory(root, "link").reason, "symlink");
  });
});

test("directory junctions that point outside projects are rejected", t => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-outside-"));
  try {
    withRoot(root => {
      fs.writeFileSync(path.join(outside, "secret.txt"), "synthetic outside");
      try { fs.symlinkSync(outside, path.join(root, "link"), "junction"); }
      catch { t.skip("Windows junction creation is unavailable in this environment"); return; }
      assert.equal(resolveProjectDirectory(root, "link").ok, false);
      assert.equal(resolveProjectDirectory(root, "link").reason, "symlink");
    });
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
