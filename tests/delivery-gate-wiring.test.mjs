import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

test("Factory-manager pipeline validates a fresh delivery report before marking a project validated", () => {
  assert.match(source, /const deliveryStartedAtNs = BigInt\(Date\.now\(\)\) \* 1_000_000n/);
  assert.match(source, /captureDeliveryReportState\(j\.directory\)/);
  assert.match(source, /wasDeliveryReportUpdatedSince\(j\.directory, deliveryStartedAtNs, deliveryBeforeState\)/);
  assert.match(source, /validateDeliveryCompletion\(true, reportFresh, reportContent\)/);
  assert.match(source, /if \(!deliveryCompletion\.ok\)/);
  assert.match(source, /j\.status = "failed"/);
  assert.match(source, /j\.status = "validated"/);
});
