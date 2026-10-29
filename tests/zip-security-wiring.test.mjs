import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/zip.ts", import.meta.url), "utf8");

test("ZIP is generated from a scanned snapshot, not the mutable source directory", () => {
  assert.match(source, /createScannedSnapshot\(dir, snapshotDir\)/);
  assert.match(source, /createZip\(snapshotDir, out\)/);
  assert.doesNotMatch(source, /createZip\(dir, out\)/);
  assert.match(source, /rmSync\(snapshotDir/);
});
