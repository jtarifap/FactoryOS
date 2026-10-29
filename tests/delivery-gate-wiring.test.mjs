import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const start = source.indexOf("// Delivery phase");
const end = source.indexOf('if (j.status === "running")', start);
assert.notEqual(start, -1, "delivery phase not found");
assert.notEqual(end, -1, "worker completion boundary not found");
const delivery = source.slice(start, end);

test("validated transition requires current report and successful completion contract", () => {
  assert.match(delivery, /deliveryStartedAtNs/);
  assert.match(delivery, /captureDeliveryReportState\(j\.directory\)/);
  assert.match(delivery, /wasDeliveryReportUpdatedSince\(j\.directory, deliveryStartedAtNs, deliveryBeforeState\)/);
  assert.match(delivery, /validateDeliveryCompletion\(/);
  assert.match(delivery, /if \(!deliveryCompletion\.ok\)/);
  assert.match(delivery, /j\.status = "failed"/);
  assert.match(delivery, /j\.status = "validated"/);
  assert.doesNotMatch(delivery, /se continúa como validado/);
});
