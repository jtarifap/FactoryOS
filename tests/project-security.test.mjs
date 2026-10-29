import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

function loadSecurity() {
  const source = fs.readFileSync(new URL("../server/project-security.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: createRequire(import.meta.url), Buffer });
  return module.exports;
}

function withDirectory(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devfactory-security-"));
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("sensitive paths include credentials, private keys and excluded dependency directories", () => {
  const { isSensitiveRelativePath } = loadSecurity();
  for (const name of [".env", ".env.local", "credentials.json", "service-account.json", "id_rsa", "tls/private.pem", "nested/node_modules/pkg/index.js", ".git/config", ".cache/state"]) {
    assert.equal(isSensitiveRelativePath(name), true, name);
  }
  assert.equal(isSensitiveRelativePath("src/index.html"), false);
  assert.equal(isSensitiveRelativePath("assets/logo.svg"), false);
});

test("secret scanner finds synthetic high-confidence content without returning values", () => {
  const { findSecretCandidates } = loadSecurity();
  withDirectory(root => {
    fs.writeFileSync(path.join(root, "index.html"), "<h1>safe</h1>");
    fs.writeFileSync(path.join(root, "config.txt"), "token=ghp_123456789012345678901234567890123456");
    fs.writeFileSync(path.join(root, "aws.txt"), "AKIA1234567890ABCDEF");
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "ignored.txt"), "ghp_123456789012345678901234567890123456");
    const candidates = findSecretCandidates(root);
    assert.deepEqual([...candidates].sort(), ["aws.txt", "config.txt"]);
    assert.equal(candidates.some(value => value.includes("ghp_1234") || value.includes("AKIA1234")), false);
  });
});

test("secret scanner flags credential filenames and private-key headers", () => {
  const { findSecretCandidates } = loadSecurity();
  withDirectory(root => {
    fs.writeFileSync(path.join(root, ".env.production"), "SYNTHETIC=placeholder");
    fs.writeFileSync(path.join(root, "private.txt"), "-----BEGIN PRIVATE KEY-----\nfake fixture\n");
    assert.deepEqual([...findSecretCandidates(root)].sort(), [".env.production", "private.txt"]);
  });
});

test("mixed-case excluded paths are scanned rather than silently skipped", () => {
  const { findSecretCandidates } = loadSecurity();
  withDirectory(root => {
    fs.mkdirSync(path.join(root, ".GIT"));
    fs.writeFileSync(path.join(root, ".GIT", "fixture.txt"), "AKIA1234567890ABCDEF");
    fs.writeFileSync(path.join(root, "debug.LOG"), "ghp_SYNTHETIC_NOT_A_REAL_TOKEN_0123456789");
    const candidates = findSecretCandidates(root);
    assert.ok(candidates.some(file => file.toLowerCase().includes(".git")));
    assert.ok(candidates.includes("debug.LOG"));
  });
});

test("scanner skips binaries and excluded directories but fails closed on scan budget", () => {
  const { findSecretCandidates, ProjectScanLimitError } = loadSecurity();
  withDirectory(root => {
    fs.writeFileSync(path.join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules", "secret.txt"), "AKIA1234567890ABCDEF");
    assert.deepEqual([...findSecretCandidates(root)], []);
    assert.throws(() => findSecretCandidates(root, { maxFileBytes: 3 }), ProjectScanLimitError);
    assert.throws(() => findSecretCandidates(root, { maxTotalBytes: 3 }), ProjectScanLimitError);
    assert.throws(() => findSecretCandidates(root, { maxEntries: 1 }), ProjectScanLimitError);
  });
});

test("preview resolver allows benign files and rejects traversal, encoded separators and sensitive paths", () => {
  const { resolveProjectFile } = loadSecurity();
  withDirectory(root => {
    fs.writeFileSync(path.join(root, "index.html"), "safe");
    fs.writeFileSync(path.join(root, ".env"), "synthetic");
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "assets", "main.css"), "body{}");
    assert.equal(resolveProjectFile(root, "index.html").relativePath, "index.html");
    assert.equal(resolveProjectFile(root, "assets/main.css").relativePath.replaceAll("\\", "/"), "assets/main.css");
    for (const requestPath of ["../outside.txt", "%2e%2e/outside.txt", "%252e%252e/outside.txt", "assets%5c..%5coutside", ".env", "%2eenv"]) {
      assert.equal(resolveProjectFile(root, requestPath), null, requestPath);
    }
  });
});

test("preview resolver refuses symlinks that escape the project", t => {
  const { resolveProjectFile } = loadSecurity();
  withDirectory(root => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "devfactory-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "outside.txt"), "synthetic outside content");
      try { fs.symlinkSync(outside, path.join(root, "linked"), "junction"); }
      catch { t.skip("Windows symlink/junction creation is unavailable in this environment"); return; }
      assert.equal(resolveProjectFile(root, "linked/outside.txt"), null);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("scanned snapshot archives exactly the inspected bytes and excludes omitted trees", () => {
  const { createScannedSnapshot } = loadSecurity();
  withDirectory(root => {
    const snapshot = path.join(os.tmpdir(), `devfactory-snapshot-${randomUUID()}`);
    try {
      fs.writeFileSync(path.join(root, "index.html"), "snapshot version");
      fs.mkdirSync(path.join(root, ".git"));
      fs.writeFileSync(path.join(root, ".git", "ignored.txt"), "not archived");
      fs.mkdirSync(path.join(root, "node_modules"));
      fs.writeFileSync(path.join(root, "node_modules", "ignored.txt"), "not archived");
      fs.writeFileSync(path.join(root, "ignored.log"), "not archived");
      assert.deepEqual([...createScannedSnapshot(root, snapshot)], []);
      fs.writeFileSync(path.join(root, "index.html"), "changed after inspection");
      assert.equal(fs.readFileSync(path.join(snapshot, "index.html"), "utf8"), "snapshot version");
      assert.equal(fs.existsSync(path.join(snapshot, ".git")), false);
      assert.equal(fs.existsSync(path.join(snapshot, "node_modules")), false);
      assert.equal(fs.existsSync(path.join(snapshot, "ignored.log")), false);
    } finally {
      fs.rmSync(snapshot, { recursive: true, force: true });
    }
  });
});
