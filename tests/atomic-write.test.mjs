import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteFileSync } from "../server/atomic-write.ts";

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-atomic-"));
}

function tempFiles(directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith(".tmp"));
}

test("atomic write stores the complete content and leaves no temporary file", () => {
  const directory = temporaryDirectory();
  try {
    const file = path.join(directory, "jobs.json");
    atomicWriteFileSync(file, JSON.stringify({ ok: true }, null, 2), "utf8");
    assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify({ ok: true }, null, 2));
    assert.deepEqual(tempFiles(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed replacement preserves the previous valid file", () => {
  const directory = temporaryDirectory();
  try {
    const file = path.join(directory, "jobs.json");
    atomicWriteFileSync(file, "previous-valid-state", "utf8");
    assert.throws(
      () => atomicWriteFileSync(file, "new-state", "utf8", { renameSync: () => { throw new Error("rename failed"); } }),
      /rename failed/
    );
    assert.equal(fs.readFileSync(file, "utf8"), "previous-valid-state");
    assert.deepEqual(tempFiles(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed write preserves the previous valid file and removes the temporary", () => {
  const directory = temporaryDirectory();
  try {
    const file = path.join(directory, "settings.json");
    atomicWriteFileSync(file, "previous-valid-settings", "utf8");
    assert.throws(
      () => atomicWriteFileSync(file, "new-settings", "utf8", { writeSync: () => { throw new Error("write failed"); } }),
      /write failed/
    );
    assert.equal(fs.readFileSync(file, "utf8"), "previous-valid-settings");
    assert.deepEqual(tempFiles(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
