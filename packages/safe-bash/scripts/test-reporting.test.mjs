import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import conciseReporter, { reporterArguments, runNodeTests } from "./test-reporting.mjs";

async function report(events) {
  let output = "";
  for await (const chunk of conciseReporter(events)) output += chunk;
  return output;
}

function event(type, data = {}) {
  return { type: `test:${type}`, data };
}

test("reporting preserves local defaults and explicit Node reporters", () => {
  for (const environment of [{}, { CI: "" }, { CI: "false" }, { CI: "0" }]) {
    assert.deepEqual(reporterArguments([], environment), []);
  }
  for (const args of [["--test-reporter=tap"], ["--test-reporter", "spec"], ["--test-reporter=dot", "--test-reporter=junit"]]) {
    assert.deepEqual(reporterArguments(args, { CI: "true" }), []);
  }
  for (const CI of ["true", "1"]) {
    const args = reporterArguments(["--test-name-pattern=example"], { CI });
    assert.deepEqual(args, [`--test-reporter=${new URL("./test-reporting.mjs", import.meta.url).href}`]);
  }
});

test("Node launch preserves all arguments, inherited streams and exact exit status", () => {
  const args = Object.freeze(["--test-concurrency=2", "--test-reporter=spec", "example.test.mjs"]);
  for (const status of [0, 1, 17, 130]) {
    assert.equal(runNodeTests(args, (executable, forwarded, options) => {
      assert.equal(executable, process.execPath);
      assert.deepEqual(forwarded, ["--test", ...args]);
      assert.deepEqual(options, { stdio: "inherit" });
      return { status };
    }, { CI: "true" }), status);
  }
  assert.equal(runNodeTests([], () => ({ status: null, signal: "SIGTERM" }), {}), 1);
  const failure = new Error("spawn unavailable");
  assert.throws(() => runNodeTests([], () => ({ error: failure }), {}), error => error === failure);
});

test("CI launch defaults to concise without changing test selection", () => {
  assert.equal(runNodeTests(["first.test.mjs", "second.test.mjs"], (executable, args) => {
    assert.deepEqual(args, ["--test", ...reporterArguments([], { CI: "1" }), "first.test.mjs", "second.test.mjs"]);
    return { status: 0 };
  }, { CI: "1" }), 0);
});

test("successful assertions and fixture streams are quiet while counts survive", async () => {
  const file = resolve("passing.test.mjs");
  const output = await report([
    event("stdout", { file, message: "verbose fixture stdout\n" }),
    event("stderr", { file, message: "verbose fixture stderr\n" }),
    event("start", { file, nesting: 0, name: "successful assertion" }),
    event("pass", { file, nesting: 0, name: "successful assertion", details: { duration_ms: 1 } }),
    event("summary", { file, success: true }),
    ...["tests 1", "suites 0", "pass 1", "fail 0", "cancelled 0", "skipped 0", "todo 0", "duration_ms 3"].map(message => event("diagnostic", { nesting: 0, message })),
    event("summary", { success: true }),
  ]);
  assert(!output.includes("fixture"));
  assert(!output.includes("successful assertion"));
  for (const message of ["tests 1", "pass 1", "fail 0", "cancelled 0", "skipped 0", "todo 0", "duration_ms 3"]) assert(output.includes(message));
});

test("failures retain full names, stack, assertion diff and both streams", async () => {
  const file = resolve("failing.test.mjs");
  const error = new assert.AssertionError({ actual: "actual value", expected: "expected value", operator: "strictEqual" });
  const output = await report([
    event("start", { file, nesting: 0, name: "outer suite" }),
    event("start", { file, nesting: 1, name: "inner suite" }),
    event("stdout", { file: "failing.test.mjs", message: "stdout before failure\n" }),
    event("stderr", { file, message: "stderr before failure\n" }),
    event("start", { file, nesting: 2, name: "fails deliberately" }),
    event("fail", { file, line: 12, column: 3, nesting: 2, name: "fails deliberately", details: { duration_ms: 1, error } }),
    event("stdout", { file, message: "stdout after failure\n" }),
    event("stderr", { file, message: "stderr after failure\n" }),
    event("summary", { file, success: false }),
    event("diagnostic", { nesting: 0, message: "fail 1" }),
    event("summary", { success: false }),
  ]);
  for (const message of ["outer suite > inner suite > fails deliberately", "failing.test.mjs:12:3", "AssertionError", "actual value", "expected value", "test-reporting.test.mjs", "stdout before failure", "stderr before failure", "stdout after failure", "stderr after failure", "fail 1"]) assert(output.includes(message), message);
});

test("concurrent file output is retained only for failures", async () => {
  const output = await report([
    event("stdout", { file: "passing.test.mjs", message: "quiet passing fixture\n" }),
    event("stderr", { file: "failing.test.mjs", message: "failed file setup error\n" }),
    event("summary", { file: resolve("passing.test.mjs"), success: true }),
    event("summary", { file: resolve("failing.test.mjs"), success: false }),
  ]);
  assert(!output.includes("quiet passing fixture"));
  assert(output.includes("failed file setup error"));
});

test("unattributed diagnostics and unfinished file output are never lost", async () => {
  const output = await report([
    event("stderr", { message: "runner error\n" }),
    event("diagnostic", { nesting: 0, level: "error", message: "uncaught exception" }),
    event("stdout", { file: "crashed.test.mjs", message: "output before crash\n" }),
    event("stderr", { file: "crashed.test.mjs", message: "crash detail\n" }),
  ]);
  for (const message of ["runner error", "uncaught exception", "output before crash", "crash detail"]) assert(output.includes(message));
});

test("large successful runs emit periodic file progress, not individual test names", async () => {
  const events = Array.from({ length: 205 }, (_, index) => event("summary", { file: resolve(`file-${index}.test.mjs`), success: true }));
  const output = await report(events);
  assert(output.includes("completed 100 test files"));
  assert(output.includes("completed 200 test files"));
  assert.equal(output.trim().split("\n").length, 2);
});

test("reporter errors propagate instead of producing a successful summary", async () => {
  const failure = new Error("test event stream failed");
  async function* events() {
    yield Promise.reject(failure);
  }
  await assert.rejects(report(events()), error => error === failure);
});
