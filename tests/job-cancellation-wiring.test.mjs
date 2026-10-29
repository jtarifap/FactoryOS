import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing source section ${start}`);
  assert.notEqual(to, -1, `missing source boundary ${end}`);
  return source.slice(from, to);
}

test("worker holds its lease until its child processes are closed", () => {
  const worker = between("async function worker()", "function safeProjectPath(");
  assert.match(worker, /workerLease\.tryAcquire\(\)/);
  assert.match(worker, /await jobProcesses\.finish\(j\.id\)/);
  assert.match(worker, /releaseWorker\(\)/);
  assert.equal((worker.match(/releaseWorker\(\)/g) || []).length, 2, "release only on empty queue and once in finally");
  assert.match(worker, /validateConfiguredModels\(j\.id\)/);
  assert.match(worker, /if \(\(j\.status as Status\) === "cancelled"\) return;/);
});

test("brain, agent and npm children are registered against their job", () => {
  assert.match(between("function runAgent(", "function runLightAgent("), /jobProcesses\.add\(j\.id, child\)/);
  assert.match(between("function runLightAgent(", "function execInProject("), /jobProcesses\.add\(j\.id, child\)/);
  assert.match(between("function execInProject(", "async function verifyProject("), /jobProcesses\.add\(j\.id, proc\)/);
  assert.match(between("function listOpenCodeModels(", "async function validateConfiguredModels("), /jobId\?: string[\s\S]*jobProcesses\.add\(jobId, child\)/);
});

test("model listing, brain and npm timeouts kill but await process close", () => {
  for (const [start, end] of [
    ["function listOpenCodeModels(", "async function validateConfiguredModels("],
    ["function runLightAgent(", "function execInProject("],
    ["function execInProject(", "async function verifyProject("],
  ]) {
    const section = between(start, end);
    const timer = section.match(/const timer = setTimeout\(\(\) => \{([\s\S]*?)\}, [^;]+;/)?.[1];
    assert.ok(timer, `missing timeout in ${start}`);
    assert.match(timer, /timedOut = true/);
    assert.match(timer, /killTree\(/);
    assert.doesNotMatch(timer, /resolve\(|finish\(/, "timeout must wait for close event before resolving");
  }
});

test("cancel endpoint terminates all job children and finalizes queued jobs", () => {
  const cancel = between('u.pathname.match(/^\\/api\\/jobs\\/([a-f0-9]{8})\\/cancel$/)', 'const retryMatch =');
  assert.match(cancel, /jobProcesses\.cancel\(j\.id\)/);
  assert.match(cancel, /if \(\!\["queued", "running"\]\.includes\(j\.status\)\)/);
  assert.match(cancel, /if \(wasQueued\) await jobProcesses\.finish\(j\.id\)/);
});

test("retry cannot requeue a cancelled job while its old worker still owns the process registry", () => {
  const retryStart = source.indexOf("const retryMatch =");
  const retryEnd = source.indexOf("const deleteMatch =", retryStart);
  const retry = source.slice(retryStart, retryEnd);
  assert.match(retry, /jobProcesses\.isActive\(j\.id\)/);
  assert.match(retry, /409/);
  assert.ok(retry.indexOf("isActive") < retry.indexOf('j.status = "queued"'));
});

test("Windows killTree delegates tree termination to the ordered helper", () => {
  const start = source.indexOf("function killTree(");
  const end = source.indexOf("function effectiveModel(", start);
  const killTree = source.slice(start, end);
  assert.match(killTree, /terminateChildTree\(child, process\.platform/);
});
