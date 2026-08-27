import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import threads from "node:worker_threads";

const [snapshot, design] = process.argv.slice(2);
assert(snapshot && design);
const workers = [];
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  closed = false;
  constructor(...args) {
    super(...args);
    workers.push(this);
    this.once("exit", () => { this.closed = true; });
  }
};
syncBuiltinESMExports();
const load = path => import(pathToFileURL(join(snapshot, "dist", path)));
const { createExprCommand, exprCommands } = await load("commands/expr/index.js");
const { RegexSession } = await load("commands/regex-execution/client.js");
const { createMemoryFileSystem } = await load("fs/memory/index.js");
const { Shell } = await load("shell/shell.js");
const history = JSON.parse(await readFile(join(design, "HISTORICAL10.json"), "utf8"));
const controls = JSON.parse(await readFile(join(design, "CONTROLS.json"), "utf8"));
let jobs = [];
const match = RegexSession.prototype.matchExpr;
RegexSession.prototype.matchExpr = function (descriptor, subject) {
  jobs.push({ profile: descriptor.profile, patternHex: Buffer.from(descriptor.pattern).toString("hex"),
    descriptorKeys: Object.keys(descriptor).sort(), maxSteps: descriptor.limits.maxSteps });
  return match.call(this, descriptor, subject);
};
const tuple = result => ({ status: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: result.stderrHex });
async function run(argv, env, shellMode = false) {
  jobs = [];
  const originalEnv = structuredClone(env);
  let actual;
  if (shellMode) {
    const shell = new Shell({ fs: createMemoryFileSystem(), env }).use(exprCommands());
    try {
      const source = ["expr", ...argv].map(argument => `'${argument.replaceAll("'", "'\\''")}'`).join(" ");
      const result = await shell.exec(source);
      actual = { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") };
    } finally { await shell.dispose(); }
  } else {
    const stdout = [], stderr = [];
    const result = await createExprCommand().execute({
      command: "expr", args: argv, cwd: "/", env, fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: { [Symbol.asyncIterator]() { throw new Error("unexpected stdin acquisition"); } },
      stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
      stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    });
    actual = tuple({ ...result, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") });
  }
  assert.deepEqual(env, originalEnv);
  assert(workers.every(worker => worker.closed), "each settlement awaits worker retirement");
  return { ...actual, jobs };
}

try {
  const scalarSuccesses = [], continuedCollationRefusals = [];
  for (const row of history.rows) {
    const actual = await run(row.input.argv, row.virtualInvocation.environment);
    const shell = await run(row.input.argv, row.virtualInvocation.environment, true);
    const expected = row.id === "unicode-collation" ? row.actual : row.expected;
    for (const observed of [actual, shell]) assert.deepEqual(
      { status: observed.status, stdoutHex: observed.stdoutHex, stderrHex: observed.stderrHex },
      { status: expected.status, stdoutHex: expected.stdout.hex, stderrHex: expected.stderr.hex }, row.id);
    const result = { id: row.id, argv: row.input.argv, environment: row.virtualInvocation.environment, actual, shell };
    (row.id === "unicode-collation" ? continuedCollationRefusals : scalarSuccesses).push(result);
  }
  assert.equal(scalarSuccesses.length, 9);
  assert.equal(continuedCollationRefusals.length, 1);
  const admissionControls = [];
  const operationDefaults = {
    length: ["length", "é"], index: ["index", "Aé😀", "😀"], substr: ["substr", "Aé😀", "2", "1"],
    "string-comparison": ["a", "<", "b"],
  };
  for (const row of controls.rows) {
    const argv = row.argv ?? (row.operation === "match" ? [row.subject ?? "Aé😀é", ":", row.pattern]
      : operationDefaults[row.operation]);
    assert(argv, `missing real operation fixture ${row.id}`);
    const actual = await run(argv, row.env);
    if (row.expected.decision === "refuse") {
      assert.equal(actual.status, 2, row.id);
      assert.equal(actual.stdoutHex, "", row.id);
      assert.equal(Buffer.from(actual.stderrHex, "hex").toString(), row.expected.stderr, row.id);
      assert.equal(actual.jobs.length, 0, row.id);
    } else if (row.operation === "match") {
      assert.equal(actual.jobs.length, 1, row.id);
      assert.equal(actual.jobs[0].profile, row.expected.profile, row.id);
      assert.equal(actual.jobs[0].patternHex, Buffer.from(row.pattern).toString("hex"), row.id);
      assert.deepEqual(actual.jobs[0].descriptorKeys, ["kind", "limits", "pattern", "profile"]);
    } else {
      assert(actual.status < 2, row.id);
      assert.equal(actual.stderrHex, "", row.id);
      assert.equal(actual.jobs.length, 0, row.id);
      if (!row.argv && row.operation !== "string-comparison") {
        const scalar = row.expected.profile === "utf8-scalar";
        const expectedHex = row.operation === "length" ? scalar ? "310a" : "320a"
          : row.operation === "index" ? scalar ? "330a" : "340a" : scalar ? "c3a90a" : "c30a";
        assert.equal(actual.stdoutHex, expectedHex, row.id);
      }
    }
    admissionControls.push({ id: row.id, argv, environment: row.env, expectedAdmission: row.expected, actual,
      qualification: row.operation === "match" && row.expected.decision === "allow"
        ? "Admission only: worker syntax/unsupported results remain explicit, not matching successes." : "Exact refusal or successful scalar/nonmatching operation." });
  }
  const defaultControls = [];
  for (const env of [{}, { LC_ALL: "", LC_CTYPE: "", LC_COLLATE: "", LANG: "" }]) {
    const actual = await run(["length", "é"], env);
    assert.equal(actual.stdoutHex, "320a");
    defaultControls.push({ env, actual });
  }
  console.log(JSON.stringify({ ambientHarnessLocale: process.env.LC_ALL, scalarSuccesses, continuedCollationRefusals,
    admissionControls, defaultControls, cleanup: { workers: workers.length, activeBeforeSafetyCleanup: workers.filter(worker => !worker.closed).length } }));
} finally {
  await Promise.all(workers.filter(worker => !worker.closed).map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  RegexSession.prototype.matchExpr = match;
}
