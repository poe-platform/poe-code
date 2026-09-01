import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import conciseReporter, { reporterArguments, runNodeTests } from "./test-reporting.mjs";

async function report(events) {
  let output = "";
  for await (const chunk of conciseReporter(events)) output += chunk;
  return output;
}

function event(type, data = {}) {
  return { type: `test:${type}`, data };
}

function reportNodeFixtures(fixtures, entries) {
  const sources = Object.fromEntries(Object.entries(fixtures).map(([file, source]) => [pathToFileURL(resolve(file)).href, source]));
  const loader = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const sources = ${JSON.stringify(sources)};
    registerHooks({
      resolve(specifier, context, next) {
        const url = specifier.startsWith('/') ? pathToFileURL(specifier).href : new URL(specifier, context.parentURL).href;
        return Object.hasOwn(sources, url) ? { url, shortCircuit: true } : next(specifier, context);
      },
      load(url, context, next) {
        return Object.hasOwn(sources, url) ? { format: 'module', source: sources[url], shortCircuit: true } : next(url, context);
      }
    });
  `;
  const script = `
    import { run } from 'node:test';
    import conciseReporter from ${JSON.stringify(new URL("./test-reporting.mjs", import.meta.url).href)};
    const events = [];
    for await (const event of run({ files: ${JSON.stringify(entries.map(file => resolve(file)))}, execArgv: ['--import', ${JSON.stringify(`data:text/javascript,${encodeURIComponent(loader)}`)}] })) events.push(event);
    let output = '';
    for await (const chunk of conciseReporter(events)) output += chunk;
    process.stdout.write(JSON.stringify({ events, output }));
  `;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--input-type=module"], { input: script, encoding: "utf8", env, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("real Node imported diagnostics have helper locations but only entry-file summaries", () => {
  const { events, output } = reportNodeFixtures({
    "entry.test.mjs": "await import('./helper.mjs');",
    "helper.mjs": `import test from 'node:test'; test('imported pass', async context => {
      context.diagnostic('imported successful dump');
      await context.test('nested pass', child => child.diagnostic('nested successful dump'));
    });`,
  }, ["entry.test.mjs"]);
  const diagnostic = events.find(item => item.data.message === "imported successful dump");
  assert(diagnostic, JSON.stringify(events));
  assert.equal(diagnostic.data.file, resolve("helper.mjs"));
  assert(events.some(item => item.type === "test:summary" && item.data.file === resolve("entry.test.mjs") && item.data.success));
  assert(!events.some(item => item.type === "test:summary" && item.data.file === diagnostic.data.file));
  assert(output.indexOf("imported successful dump") > output.indexOf("duration_ms"));
  assert(output.includes("nested successful dump"));
  assert(output.includes("pass 2"));
  assert(output.includes("fail 0"));
});

test("real Node failed entry files retain imported passing and failing diagnostics", () => {
  const { events, output } = reportNodeFixtures({
    "entry.test.mjs": "await import('./helper.mjs');",
    "helper.mjs": `import test from 'node:test';
      test('passing sibling', context => context.diagnostic('passing sibling dump'));
      test('failing sibling', context => { context.diagnostic('failure dump\\nsecond line'); throw new Error('runtime failure'); });`,
  }, ["entry.test.mjs"]);
  assert.equal(events.at(-1).data.success, false);
  for (const message of ["passing sibling dump", "failure dump\nsecond line", "runtime failure", "fail 1"]) assert(output.includes(message), message);
});

test("real Node late activity warnings and imported diagnostics survive failed summaries", () => {
  const { events, output } = reportNodeFixtures({
    "entry.test.mjs": "await import('./helper.mjs');",
    "helper.mjs": `import test from 'node:test'; test('late activity', context => {
      context.diagnostic('dump before late activity');
      setImmediate(() => { throw new Error('late activity error'); });
    });`,
  }, ["entry.test.mjs"]);
  assert.equal(events.at(-1).data.success, false);
  for (const message of ["dump before late activity", "late activity error", "uncaughtException"]) assert(output.includes(message), message);
});

test("real Node shared helper diagnostics survive a failure in another source file", () => {
  const { events, output } = reportNodeFixtures({
    "passing-entry.test.mjs": "await import('./helper.mjs');",
    "failing-entry.test.mjs": `await import('./helper.mjs'); import test from 'node:test'; test('entry failure', () => { throw new Error('entry runtime failure'); });`,
    "helper.mjs": `import test from 'node:test'; test('shared helper pass', context => context.diagnostic('shared helper dump'));`,
  }, ["passing-entry.test.mjs", "failing-entry.test.mjs"]);
  assert.equal(events.at(-1).data.success, false);
  assert.equal(events.filter(item => item.data.message === "shared helper dump").length, 2);
  assert.equal(output.split("shared helper dump").length - 1, 2);
  assert(output.includes("entry runtime failure"));
});

test("real Node only-option warnings have the same metadata as successful context dumps", () => {
  const { events, output } = reportNodeFixtures({
    "entry.test.mjs": "await import('./helper.mjs');",
    "helper.mjs": `import test from 'node:test'; test('only without flag', { only: true }, context => context.diagnostic('only successful dump'));`,
  }, ["entry.test.mjs"]);
  assert.equal(events.at(-1).data.success, true);
  const diagnostics = events.filter(item => item.type === "test:diagnostic" && item.data.file === resolve("helper.mjs"));
  assert.equal(diagnostics.length, 2);
  const [warning, dump] = diagnostics;
  assert(warning.data.message.includes("require the --test-only"));
  assert.equal(warning.data.level, "info");
  assert.deepEqual({ ...warning.data, message: dump.data.message }, dump.data);
  assert(output.includes(warning.data.message));
  assert(output.includes("only successful dump"));
});

test("real Node direct-file info warnings survive while successful fixture streams stay quiet", () => {
  const { events, output } = reportNodeFixtures({
    "entry.test.mjs": `import test from 'node:test'; test('direct only without flag', { only: true }, context => {
      console.log('direct fixture stdout');
      console.error('direct fixture stderr');
      context.diagnostic('direct informational diagnostic');
    });`,
  }, ["entry.test.mjs"]);
  assert.equal(events.at(-1).data.success, true);
  const diagnostics = events.filter(item => item.type === "test:diagnostic" && item.data.file === resolve("entry.test.mjs"));
  assert.equal(diagnostics.length, 2);
  assert(diagnostics[0].data.message.includes("require the --test-only"));
  assert.equal(diagnostics[0].data.level, "info");
  for (const diagnostic of diagnostics) assert(output.includes(diagnostic.data.message), diagnostic.data.message);
  assert(events.some(item => item.type === "test:summary" && item.data.file === diagnostics[0].data.file && item.data.success));
  for (const [type, message] of [["test:stdout", "direct fixture stdout"], ["test:stderr", "direct fixture stderr"]]) {
    assert(events.some(item => item.type === type && item.data.message.includes(message)));
    assert(!output.includes(message));
  }
});

test("real Node caller stdout attributes imported fixture dumps to the entry file", () => {
  for (const failing of [false, true]) {
    const { events, output } = reportNodeFixtures({
      "entry.test.mjs": `await import('./helper.mjs'); import test from 'node:test';
        test('entry result', () => { ${failing ? "throw new Error('entry failure');" : ""} });`,
      "helper.mjs": `import test from 'node:test'; test('imported fixture', () => {
        console.log('focused caller fixture dump');
        console.error('focused caller fixture stderr');
      });`,
    }, ["entry.test.mjs"]);
    assert.equal(events.at(-1).data.success, !failing);
    const dump = events.find(item => item.type === "test:stdout" && item.data.message.includes("focused caller fixture dump"));
    assert(dump, JSON.stringify(events));
    assert.equal(dump.data.file, resolve("entry.test.mjs"));
    assert.equal(output.includes("focused caller fixture dump"), failing);
    assert.equal(output.includes("focused caller fixture stderr"), failing);
    if (failing) assert(output.includes("entry failure"));
  }
});

test("completed imported diagnostics survive without an aggregate summary", async () => {
  const location = { file: "helper.mjs", line: 4, column: 2, nesting: 0 };
  const output = await report([
    event("pass", { ...location, name: "completed", details: { duration_ms: 1 } }),
    event("diagnostic", { ...location, level: "info", message: "completed diagnostic before interruption" }),
    event("summary", { file: "entry.test.mjs", success: true }),
  ]);
  assert(output.includes("completed diagnostic before interruption"));
});

test("aggregate success alone cannot authorize dropping imported or unattributed diagnostics", async () => {
  const location = { file: "helper.mjs", line: 4, column: 2, nesting: 0 };
  const output = await report([
    event("pass", { ...location, name: "completed", details: { duration_ms: 1 } }),
    event("diagnostic", { ...location, level: "info", message: "matched completed dump" }),
    event("diagnostic", { ...location, line: 5, level: "info", message: "unfinished diagnostic" }),
    event("diagnostic", { ...location, column: 3, level: "info", message: "other column diagnostic" }),
    event("diagnostic", { ...location, nesting: 1, level: "info", message: "other nesting diagnostic" }),
    event("diagnostic", { ...location, file: "other-helper.mjs", level: "info", message: "other file diagnostic" }),
    event("diagnostic", { ...location, line: undefined, level: "info", message: "unlocated diagnostic" }),
    event("diagnostic", { ...location, level: "warn", message: "located warning" }),
    event("diagnostic", { ...location, level: "error", message: "located error" }),
    event("diagnostic", { nesting: 0, level: "info", message: "unattributed information" }),
    event("diagnostic", { ...location, file: undefined, level: "warn", message: "unattributed warning" }),
    event("stderr", { file: location.file, message: "unfinished stderr\n" }),
    event("stdout", { file: location.file, message: "unfinished stdout\n" }),
    event("summary", { success: true }),
  ]);
  assert(output.includes("matched completed dump"));
  for (const message of ["unfinished diagnostic", "other column diagnostic", "other nesting diagnostic", "other file diagnostic", "unlocated diagnostic", "located warning", "located error", "unattributed information", "unattributed warning", "unfinished stderr", "unfinished stdout"]) assert(output.includes(message), message);
});

test("successful file summaries preserve diagnostics of every severity in order", async () => {
  const file = "passing.test.mjs";
  const messages = ["informational warning", "real warning", "real error", "unspecified diagnostic", "future severity diagnostic"];
  const output = await report([
    ...["info", "warn", "error", undefined, "notice"].map((level, index) => event("diagnostic", { file, nesting: 0, level, message: messages[index] })),
    event("summary", { file, success: true }),
  ]);
  let previous = -1;
  for (const message of messages) {
    const position = output.indexOf(message);
    assert(position > previous, message);
    assert.equal(output.lastIndexOf(message), position, message);
    previous = position;
  }
});

test("reporting defaults to concise without requiring CI", () => {
  assert.deepEqual(reporterArguments([]), [`--test-reporter=${new URL("./test-reporting.mjs", import.meta.url).href}`]);
  assert.deepEqual(reporterArguments(["--test-name-pattern=example"]), reporterArguments([]));
});

test("reporting preserves explicit Node reporters", () => {
  for (const args of [["--test-reporter=tap"], ["--test-reporter", "spec"], ["--test-reporter=dot", "--test-reporter=junit"]]) {
    assert.deepEqual(reporterArguments(args), []);
  }
});

test("explicit reporter destinations preserve Node selection and argument order", () => {
  for (const overrides of [
    ["--test-reporter-destination=stdout"],
    ["--test-reporter-destination", "stderr"],
    ["--test-reporter=tap", "--test-reporter-destination=stdout"],
    ["--test-reporter", "spec", "--test-reporter-destination", "stderr"],
    ["--test-reporter=spec", "--test-reporter=junit", "--test-reporter-destination=stdout", "--test-reporter-destination", "report.xml"],
  ]) {
    const args = Object.freeze([...overrides, "example.test.mjs"]);
    assert.deepEqual(reporterArguments(args), []);
    assert.equal(runNodeTests(args, (executable, forwarded, options) => {
      assert.equal(executable, process.execPath);
      assert.deepEqual(forwarded, ["--test", ...args]);
      assert.deepEqual(options, { stdio: "inherit" });
      return { status: 0 };
    }), 0);
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
    }), status);
  }
  assert.equal(runNodeTests([], () => ({ status: null, signal: "SIGTERM" })), 1);
  const failure = new Error("spawn unavailable");
  assert.throws(() => runNodeTests([], () => ({ error: failure })), error => error === failure);
});

test("launch defaults to concise without changing test selection", () => {
  assert.equal(runNodeTests(["first.test.mjs", "second.test.mjs"], (executable, args) => {
    assert.deepEqual(args, ["--test", `--test-reporter=${new URL("./test-reporting.mjs", import.meta.url).href}`, "first.test.mjs", "second.test.mjs"]);
    return { status: 0 };
  }), 0);
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

test("passing file diagnostics and unattributed warnings all survive", async () => {
  const file = resolve("passing.test.mjs");
  const warning = "Error: Test generated asynchronous activity after the test ended";
  const output = await report([
    event("pass", { file, nesting: 0, name: "passing assertion", details: { duration_ms: 1 } }),
    event("diagnostic", { file: "passing.test.mjs", nesting: 0, level: "info", message: "informational warning" }),
    event("diagnostic", { file, nesting: 1, level: "info", message: "nested informational diagnostic" }),
    event("summary", { file, success: true }),
    event("diagnostic", { nesting: 0, level: "info", message: warning }),
  ]);
  assert(output.includes("informational warning"));
  assert(output.includes("nested informational diagnostic"));
  assert(output.includes(warning));
});

test("failed file diagnostics retain their full content and stream order", async () => {
  const file = resolve("failing.test.mjs");
  const messages = ["stdout before diagnostic", '{"source":"complete failure fixture"}\nsecond diagnostic line', "stderr after diagnostic", "diagnostic after failure"];
  const output = await report([
    event("stdout", { file, message: `${messages[0]}\n` }),
    event("diagnostic", { file: "failing.test.mjs", nesting: 0, level: "info", message: messages[1] }),
    event("stderr", { file, message: `${messages[2]}\n` }),
    event("fail", { file, nesting: 0, name: "failing assertion", details: { duration_ms: 1, error: new Error("failure") } }),
    event("diagnostic", { file, nesting: 0, level: "info", message: messages[3] }),
    event("summary", { file, success: false }),
  ]);
  let previous = -1;
  for (const message of messages) {
    const position = output.indexOf(message);
    assert(position > previous, message);
    assert.equal(output.lastIndexOf(message), position, message);
    previous = position;
  }
});

test("failed file summaries retain diagnostics even without an assertion failure", async () => {
  const warning = 'Error: Test "probe" generated asynchronous activity after the test ended. This activity created the error "Error: late activity warning" and would have caused the test to fail, but instead triggered an uncaughtException event.';
  const output = await report([
    event("stdout", { file: "passing.test.mjs", message: "passing file dump\n" }),
    event("pass", { file: "failing.test.mjs", nesting: 0, name: "probe", details: { duration_ms: 1 } }),
    event("diagnostic", { file: "failing.test.mjs", nesting: 0, level: "info", message: warning }),
    event("summary", { file: resolve("passing.test.mjs"), success: true }),
    event("summary", { file: resolve("failing.test.mjs"), success: false }),
  ]);
  assert(!output.includes("passing file dump"));
  assert(output.includes(warning));
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
    event("diagnostic", { file: "crashed.test.mjs", nesting: 0, message: "unfinished file diagnostic" }),
  ]);
  for (const message of ["runner error", "uncaught exception", "output before crash", "crash detail", "unfinished file diagnostic"]) assert(output.includes(message));
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
