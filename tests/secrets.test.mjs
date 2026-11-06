import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  containsSecret,
  findSecretCandidates,
  isSensitiveRelativePath,
  redactSecrets,
} from "../server/project-security.ts";

function withDirectory(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-secrets-"));
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const secrets = {
  "aws-secret.txt": "aws_secret_access_key = " + "abcd1234ABCDEFGHIJKLMNOPQRSTUVWXYZ098765",
  "github-fine.txt": "github_" + "pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
  "gitlab.txt": "gl" + "pat-abcdefghijklmnopqrst",
  "slack.txt": "xox" + "b-123456789012-abcdefghijklmnop",
  "stripe.txt": "sk_" + "live_abcdefghijklmnopqrstuvwx",
  "google.txt": "AI" + "zaSyA1234567890abcdefghijklmnopqrstuv",
  "npm.txt": "np" + "m_abcdefghijklmnopqrstuvwxyz0123456789",
  "sendgrid.txt": `SG.${"a".repeat(22)}.${"b".repeat(43)}`,
  "openai.txt": "sk-" + "proj-" + "a".repeat(32),
  "anthropic.txt": "sk-" + "ant-" + "a".repeat(24),
  "database.txt": "postgres://user:" + "supersecretpassword@db.example.com/app",
  "generic.txt": 'client_secret = "' + "a1b2c3d4e5f6g7h8i9j0k1l2" + '"',
  "private.txt": "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nfake fixture\n",
};

test("the scanner detects common credentials without returning their values", () => {
  withDirectory(root => {
    for (const [name, content] of Object.entries(secrets)) fs.writeFileSync(path.join(root, name), content);
    const candidates = findSecretCandidates(root).sort();
    assert.deepEqual(candidates, Object.keys(secrets).sort());
    for (const candidate of candidates) {
      assert.equal(candidate.includes("abcd1234ABCD"), false);
      assert.equal(candidate.includes("supersecretpassword"), false);
    }
  });
});

test("legitimate configuration and placeholders do not trigger the scanner", () => {
  withDirectory(root => {
    fs.writeFileSync(path.join(root, "env-ref.js"), "const apiKey = process.env.API_KEY;");
    fs.writeFileSync(path.join(root, "placeholder.js"), 'const token = "changeme";');
    fs.writeFileSync(path.join(root, "example.js"), 'const apiKey = "example-api-key-value-123456";');
    fs.writeFileSync(path.join(root, "short.js"), 'const token = "abc123";');
    fs.writeFileSync(path.join(root, "form.html"), '<input type="password" name="password">');
    fs.writeFileSync(path.join(root, "id_rsa.pub"), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture user@example");
    fs.writeFileSync(path.join(root, "cert.pem"), "-----BEGIN CERTIFICATE-----\nfake fixture\n");
    fs.writeFileSync(path.join(root, ".env.example"), "API_KEY=your-api-key-here");
    assert.deepEqual(findSecretCandidates(root), []);
  });
});

test("sensitive file names cover common local credential stores without flagging public files", () => {
  for (const name of [".env", ".env.local", ".env.production", "credentials.json", "service-account.json", "id_rsa", "tls/private.pem", "nested/node_modules/pkg/index.js", ".git/config", ".npmrc", ".netrc", ".git-credentials", "terraform.tfstate", ".docker/config.json"]) {
    assert.equal(isSensitiveRelativePath(name), true, name);
  }
  for (const name of ["id_rsa.pub", "cert.pem", "public.pem", ".env.example", "src/index.html", "assets/logo.svg"]) {
    assert.equal(isSensitiveRelativePath(name), false, name);
  }
});

test("redaction removes the whole value and keeps the surrounding context", () => {
  const token = "gh" + "p_123456789012345678901234567890123456";
  assert.equal(redactSecrets(`token=${token}`), "token=[REDACTADO]");
  assert.equal(redactSecrets("const apiKey = process.env.API_KEY;"), "const apiKey = process.env.API_KEY;");
  assert.equal(redactSecrets('const token = "changeme";'), 'const token = "changeme";');
  const redacted = redactSecrets('client_secret = "a1b2c3d4e5f6g7h8i9j0k1l2"');
  assert.match(redacted, /^client_secret = "\[REDACTADO\]"$/);
  assert.equal(containsSecret(`token=${token}`), true);
  assert.equal(containsSecret("const apiKey = process.env.API_KEY;"), false);
});
