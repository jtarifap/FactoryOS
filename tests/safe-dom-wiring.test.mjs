import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../web/main.ts", import.meta.url), "utf8");

test("job summary and model tooltip use safe DOM renderers", () => {
  assert.match(source, /import \{[^}]*renderJobSummary[^}]*renderModelTooltip[^}]*\} from "\.\/safe-dom"/);
  assert.match(source, /renderJobSummary\(document, job\)/);
  assert.match(source, /renderModelTooltip\(document, tooltip, model\)/);
  assert.doesNotMatch(source, /top\.innerHTML\s*=.*job\.(?:name|phase)/);
  assert.doesNotMatch(source, /tooltip\.innerHTML\s*=/);
});
