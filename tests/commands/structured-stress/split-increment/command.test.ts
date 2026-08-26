import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { execute } from "../harness.js";
import { evidence } from "./evidence.js";

for (const fixture of evidence.cases) test(`split command native: ${fixture.id}`, { timeout: 3000 }, async () => {
  const actual = await execute(fixture.argv, fixture.input);
  assert.equal(actual.status, fixture.status, actual.stderr);
  assert.deepEqual(Buffer.from(actual.stdout), Buffer.from(fixture.stdout));
  if (fixture.status === 0) assert.equal(actual.stderr, fixture.stderr);
  else assert.match(actual.stderr, /^jq: .+\n$/u);
  if (fixture.stderr.includes("split input and separator must be strings")) {
    assert.match(actual.stderr, /split input and separator must be strings/u);
  }
});

test("split command output cap preserves complete earlier results only", { timeout: 3000 }, async () => {
  const actual = await execute(["-c", 'split((",", ";"))'], '"a,b"', { limits: { maxOutputBytes: 10 } });
  assert.equal(actual.status, 5, actual.stderr);
  assert.equal(actual.stdout, '["a","b"]\n');
  assert.match(actual.stderr, /maxOutputBytes limit exceeded/u);
});

test("split command allows shrinking intermediate arrays before output", { timeout: 3000 }, async () => {
  const actual = await execute(["-c", 'split(",") | length'], '"a,b,c"', { limits: { maxOutputBytes: 2 } });
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(actual.stdout, "3\n");
});

test("split optional cannot suppress collection budgets", { timeout: 3000 }, async () => {
  const actual = await execute(["-c", 'split(",")?'], '\",,,\"', { limits: { maxCollectionSize: 3 } });
  assert.equal(actual.status, 5, actual.stderr);
  assert.equal(actual.stdout, "");
  assert.match(actual.stderr, /maxCollectionSize limit exceeded/u);
});

test("split separator generators share the command result budget", { timeout: 3000 }, async () => {
  const actual = await execute(["-c", 'split((",", ";"))'], '\"a,b\"', { limits: { maxResults: 1 } });
  assert.equal(actual.status, 5, actual.stderr);
  assert.equal(actual.stdout, '["a","b"]\n');
  assert.match(actual.stderr, /maxResults limit exceeded/u);
});

for (const filter of ["split", 'split(","; "g")']) test(`split rejects out-of-scope arity: ${filter}`, { timeout: 3000 }, async () => {
  let acquired = false;
  const actual = await execute([filter], { [Symbol.asyncIterator]() { acquired = true; throw new Error("input must not be acquired"); } });
  assert.equal(actual.status, 3);
  assert.match(actual.stderr, /unsupported function split\/(0|2)/u);
  assert.equal(actual.stdout, "");
  assert.equal(acquired, false);
});

for (const [name, filter, input] of [
  ["literal scan", 'split("b")?', "a".repeat(100000)],
  ["separator preprocessing", `split("${"a".repeat(30000)}b")?`, "a".repeat(100000)],
  ["code-point expansion", 'split("")?', "😀".repeat(20000)],
] as const) test(`split command cancellation during ${name}`, { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error(`cancel split ${name}`);
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const running = execute(["-r", `"ready",${filter}`], JSON.stringify(input), { limits: { maxSteps: 1000000 } }, {
    signal: controller.signal,
    stdout: { async write(bytes) { assert.equal(Buffer.from(bytes).toString(), "ready\n"); entered(); } },
  });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  await setImmediate();
  controller.abort(reason);
  await rejected;
});

test("split respects output backpressure before later separator errors and observes late rejections", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel blocked split output");
  let entered!: () => void;
  let rejectLate!: (error: Error) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const running = execute(["-c", 'split((",",1/0))'], '"a,b"', {}, {
    signal: controller.signal,
    stdout: { write(bytes) {
      assert.equal(Buffer.from(bytes).toString(), '["a","b"]\n');
      entered();
      return new Promise<never>((_, reject) => { rejectLate = reject; });
    } },
  });
  const rejected = assert.rejects(running, error => error === reason);
  await ready;
  await setImmediate();
  controller.abort(reason);
  await rejected;
  rejectLate(new Error("late split sink rejection"));
  await delay(0);
});

for (const [name, limits] of [
  ["maxSteps", { maxSteps: 200 }],
  ["maxValueBytes", { maxValueBytes: 2500 }],
] as const) test(`split optional cannot suppress ${name}`, { timeout: 3000 }, async () => {
  const actual = await execute(["-c", 'split(",")?'], JSON.stringify(",".repeat(1000)), { limits });
  assert.equal(actual.status, 5, actual.stderr);
  assert.equal(actual.stdout, "");
  assert.match(actual.stderr, new RegExp(`${name} limit exceeded`, "u"));
});
