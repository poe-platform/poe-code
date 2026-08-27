import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { syncBuiltinESMExports } from "node:module";
import threads, { type WorkerOptions } from "node:worker_threads";
import { Budget, ExprError, screenMatch, settings } from "../../../src/commands/expr/internal.js";
import { exprCommands, type ExprCommandsOptions } from "../../../src/commands/expr/index.js";
import { RegexSession } from "../../../src/commands/regex-execution/client.js";
import { exprMatchCeilings, type ExprMatchDescriptor } from "../../../src/commands/regex-execution/protocol.js";
import type { InvocationCleanup } from "../../../src/contracts/command.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { run } from "./helpers.js";

const named = { LC_ALL: "en_US.UTF-8" };
const encodingError = "expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding\n";
const collationError = "expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n";
const bracketError = "expr: unsupported BRE: bracket expressions require C/POSIX or C.UTF-8/C.utf8 LC_CTYPE and LC_COLLATE\n";
const byteError = "expr: regex input bytes limit exceeded\n";
type Expected = readonly [number, string, string];

const NativeWorker = threads.Worker;
const workers: ObservedWorker[] = [];
class ObservedWorker extends NativeWorker {
  closed = false;
  constructor(filename: string | URL, options?: WorkerOptions) {
    super(filename, options);
    workers.push(this);
    this.once("exit", () => { this.closed = true; });
  }
}
threads.Worker = ObservedWorker;
syncBuiltinESMExports();
after(async () => {
  const activeBeforeSafetyCleanup = workers.filter(worker => !worker.closed).length;
  await Promise.all(workers.filter(worker => !worker.closed).map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  console.log(JSON.stringify({ namedProfileWorkers: workers.length, activeBeforeSafetyCleanup,
    activeAfter: workers.filter(worker => !worker.closed).length }));
  assert.equal(activeBeforeSafetyCleanup, 0);
});

function observe(context: TestContext) {
  const jobs: ExprMatchDescriptor[] = [];
  const match = RegexSession.prototype.matchExpr;
  context.mock.method(RegexSession.prototype, "matchExpr", function (this: RegexSession, ...args: Parameters<typeof match>) {
    jobs.push(args[0]);
    return match.apply(this, args);
  });
  return jobs;
}

async function both(args: readonly string[], env: Readonly<Record<string, string>>, expected: Expected,
  options: ExprCommandsOptions = {}) {
  const originalEnv = { ...env };
  const direct = await run(args, options, { env });
  assert.deepEqual([direct.exitCode, direct.stdout, direct.stderr], expected, "direct command");
  const shell = new Shell({ fs: createMemoryFileSystem(), env,
    limits: { maxSourceBytes: 2_000_000, maxExpansionBytes: 2_000_000 } }).use(exprCommands(options));
  try {
    const source = ["expr", ...args].map(argument => `'${argument.replaceAll("'", "'\\''")}'`).join(" ");
    const actual = await shell.exec(source);
    assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], expected, "actual Shell registry");
  } finally { await shell.dispose(); }
  assert.deepEqual(env, originalEnv, "caller environment is not rewritten");
}

for (const [label, args, expected] of [
  ["length scalars", ["length", "a😀é"], [0, "4\n", ""]],
  ["substring scalar", ["substr", "a😀z", "2", "1"], [0, "😀\n", ""]],
  ["index scalar", ["index", "a😀z", "z"], [0, "3\n", ""]],
  ["literal match", ["é😀", ":", "é"], [0, "1\n", ""]],
  ["dot match", ["😀é", ":", ".."], [0, "2\n", ""]],
  ["first capture", ["match", "😀é", "\\(.\\)."], [0, "😀\n", ""]],
  ["backreference", ["éé", ":", "\\(é\\)\\1"], [0, "é\n", ""]],
  ["no normalization", ["é", ":", "é"], [1, "0\n", ""]],
  ["empty capture", ["", ":", "\\(a*\\)"], [1, "\n", ""]],
  ["literal Unicode value", ["é😀"], [0, "é😀\n", ""]],
] as const) test(`named encoding direct/Shell: ${label}`, async context => {
  const jobs = observe(context);
  await both(args, named, expected);
  for (const descriptor of jobs) {
    assert.equal(descriptor.profile, "utf8-scalar");
    assert.deepEqual(Object.keys(descriptor).sort(), ["kind", "limits", "pattern", "profile"]);
    assert.equal(Buffer.from(descriptor.pattern).toString(), args.at(-1));
  }
});

const categories: readonly [string, Readonly<Record<string, string>>, string | undefined, boolean, boolean][] = [
  ["default", {}, "2", true, true],
  ["empty fallthrough default", { LC_ALL: "", LC_CTYPE: "", LC_COLLATE: "", LANG: "" }, "2", true, true],
  ["all overrides categories", { LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "unknown", LANG: "unknown" }, "2", true, true],
  ["all named overrides C", { LC_ALL: "en_US.UTF-8", LC_CTYPE: "C", LC_COLLATE: "C", LANG: "C" }, "1", false, false],
  ["independent named ctype", { LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "C" }, "1", true, false],
  ["independent named collate", { LC_CTYPE: "C", LC_COLLATE: "en_US.UTF-8" }, "2", false, false],
  ["unknown ctype irrelevant to comparison", { LC_CTYPE: "unknown", LC_COLLATE: "C" }, undefined, true, false],
  ["unknown collate irrelevant to length", { LC_CTYPE: "C.UTF-8", LC_COLLATE: "unknown" }, "1", false, false],
  ["LANG named", { LANG: "en_US.UTF-8" }, "1", false, false],
  ["empty all named ctype", { LC_ALL: "", LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "POSIX", LANG: "unknown" }, "1", true, false],
  ["empty categories named LANG", { LC_ALL: "", LC_CTYPE: "", LC_COLLATE: "", LANG: "en_US.UTF-8" }, "1", false, false],
  ["C categories override LANG", { LC_CTYPE: "C.utf8", LC_COLLATE: "POSIX", LANG: "en_US.UTF-8" }, "1", true, true],
  ["whitespace ALL is nonempty", { LC_ALL: " ", LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "C" }, undefined, false, false],
  ["whitespace ctype is nonempty", { LC_CTYPE: " ", LC_COLLATE: "C", LANG: "en_US.UTF-8" }, undefined, true, false],
  ["whitespace collate is nonempty", { LC_CTYPE: "C", LC_COLLATE: " ", LANG: "en_US.UTF-8" }, "2", false, false],
  ["POSIX", { LC_ALL: "POSIX" }, "2", true, true],
  ["C scalar", { LC_ALL: "C.UTF-8" }, "1", true, true],
];
for (const [label, env, length, comparison, brackets] of categories) {
  test(`category precedence direct/Shell: ${label}`, async context => {
    const jobs = observe(context);
    await both(["length", "é"], env, length === undefined ? [2, "", encodingError] : [0, `${length}\n`, ""]);
    await both(["a", "<", "b"], env, comparison ? [0, "1\n", ""] : [2, "", collationError]);
    await both(["a", ":", "[a]"], env, length === undefined ? [2, "", encodingError]
      : brackets ? [0, "1\n", ""] : [2, "", bracketError]);
    assert.equal(jobs.length, brackets ? 2 : 0);
    if (length !== undefined) await both(["é", ":", "."], env, [0, "1\n", ""]);
  });
}

for (const locale of ["en_US.utf8", "en_US.UTF8", "en-US.UTF-8", "EN_US.UTF-8", "en_us.UTF-8", "en_US.UTF-8@x", "fr_FR.UTF-8", "UTF-8", "/en_US.UTF-8", "en_US.UTF-8 "]) {
  test(`exact name refuses alias ${locale}`, async context => {
    const jobs = observe(context);
    const env = { LC_ALL: locale };
    await both(["length", "é"], env, [2, "", encodingError]);
    await both(["é", ":", "."], env, [2, "", encodingError]);
    await both(["40", "+", "2"], env, [0, "42\n", ""]);
    await both(["001", "=", "1"], env, [0, "1\n", ""]);
    await both(["é"], env, [0, "é\n", ""]);
    assert.equal(jobs.length, 0);
  });
}

for (const operator of ["<", "<=", "=", "==", "!=", ">=", ">"])
  test(`named nonnumeric comparison still refuses ${operator}`, async () => {
    await both(["a", operator, "a"], named, [2, "", collationError]);
  });

for (const pattern of ["[", "[a]", "[^a]", "[é]", "[a-z]", "[[:alpha:]]", "[[=a=]]", "[[.a.]]", "[]]", "[[]", "\\([a]\\)", "a\\|[b]", "é[", "\\[[a]"])
  test(`conservative bracket refusal before worker: ${JSON.stringify(pattern)}`, async context => {
    const jobs = observe(context);
    await both(["a", ":", pattern], named, [2, "", bracketError]);
    assert.equal(jobs.length, 0);
  });

for (let count = 0; count <= 8; count++) test(`escape-aware bracket parity ${count}`, async context => {
  const jobs = observe(context);
  const subject = "\\".repeat(Math.floor(count / 2)) + "[";
  const pattern = "\\".repeat(count) + "[";
  await both([subject, ":", pattern], named, count % 2 === 0 ? [2, "", bracketError] : [0, `${subject.length}\n`, ""]);
  assert.equal(jobs.length, count % 2 === 0 ? 0 : 2);
  for (const job of jobs) assert.equal(Buffer.from(job.pattern).toString(), pattern);
});

test("admitted trailing escape keeps worker syntax diagnostic", async context => {
  const jobs = observe(context);
  await both(["a", ":", "a\\"], named, [2, "", "expr: Trailing backslash\n"]);
  assert.equal(jobs.length, 2);
});

test("bracket byte caps precede screen and create no jobs", async context => {
  const jobs = observe(context);
  await both(["é", ":", "[é]"], named, [3, "", byteError], { limits: { maxRegexPatternBytes: 3 } });
  await both(["é", ":", "[é]"], named, [2, "", bracketError], { limits: { maxRegexPatternBytes: 4 } });
  const subject = "a".repeat(exprMatchCeilings.maxSubjectBytes + 1);
  await both([subject, ":", "["], named, [3, "", byteError], {
    limits: { maxArgumentBytes: 2_000_000, maxStringBytes: 2_000_000, maxSteps: 50_000_000 },
  });
  assert.equal(jobs.length, 0);
});

test("screen precharges every pattern byte before first indexed read", async () => {
  const { context } = await run(["1"], {}, { env: named });
  const raw = Buffer.from("a\\[a");
  for (const maxSteps of [raw.length - 1, raw.length]) {
    const budget = new Budget(context, settings({ limits: { maxSteps } }));
    let reads = 0;
    const pattern = new Proxy(raw, { get(target, key) {
      if (key !== "length") {
        reads++;
        assert.equal(budget.remaining(), 0, "entire scan charged before accessing bytes");
      }
      return Reflect.get(target, key, target) as unknown;
    } });
    if (maxSteps < raw.length) {
      assert.throws(() => screenMatch(new Uint8Array(), pattern, budget), error => error instanceof ExprError && error.exitCode === 3);
      assert.equal(reads, 0);
    } else {
      screenMatch(new Uint8Array(), pattern, budget);
      assert(reads > 0);
    }
  }
});

test("both byte caps precede reads and scan work even with exhausted budget", async () => {
  const { context } = await run(["1"], {}, { env: named });
  for (const [subject, raw, limits] of [
    [Buffer.from("a"), Buffer.from("[a]"), { maxRegexPatternBytes: 2 }],
    [Buffer.from("aa"), Buffer.from("["), { maxStringBytes: 1 }],
  ] as const) {
    const budget = new Budget(context, settings({ limits: { ...limits, maxSteps: 1 } }));
    budget.charge();
    const pattern = new Proxy(raw, { get(target, key) {
      assert.equal(key, "length", "no pattern byte read before cap");
      return Reflect.get(target, key, target) as unknown;
    } });
    assert.throws(() => screenMatch(subject, pattern, budget), error => error instanceof ExprError
      && error.exitCode === 3 && error.message === "regex input bytes limit exceeded");
    assert.equal(budget.remaining(), 0);
  }
});

test("worker gets remaining budget after full screen, not a reset", async context => {
  const jobs = observe(context);
  for (const env of [{ LC_ALL: "C.UTF-8" }, named]) await both(["abc", ":", "a.c"], env, [0, "3\n", ""]);
  assert.equal(jobs.length, 4);
  for (let index = 0; index < 2; index++) assert.equal(jobs[index]!.limits.maxSteps - jobs[index + 2]!.limits.maxSteps, 3);
});

test("scan work exhaustion wins over bracket refusal and admits no jobs", async context => {
  const jobs = observe(context);
  const charge = Budget.prototype.charge;
  const encode = Budget.prototype.encode;
  const encoded = new WeakSet<Budget>();
  context.mock.method(Budget.prototype, "encode", function (this: Budget, text: string) {
    const result = encode.call(this, text);
    if (text === "[".repeat(37)) encoded.add(this);
    return result;
  });
  context.mock.method(Budget.prototype, "charge", function (this: Budget, size = 1) {
    if (size === 37 && encoded.has(this)) {
      charge.call(this, this.remaining() - 36);
    }
    return charge.call(this, size);
  });
  await both(["a", ":", "[".repeat(37)], named, [3, "", "expr: evaluation work limit exceeded\n"]);
  assert.equal(jobs.length, 0);
});

test("short-circuited bracket/alias regex submits zero jobs", async context => {
  const jobs = observe(context);
  for (const env of [named, { LC_ALL: "unknown" }]) {
    await both(["1", "|", "match", "a", "["], env, [0, "1\n", ""]);
    await both(["0", "&", "a", ":", "[a]"], env, [1, "0\n", ""]);
  }
  assert.equal(jobs.length, 0);
});

for (const reason of [false, 0, "", null]) test(`named preabort and admitted cleanup preserve ${JSON.stringify(reason)}`, async context => {
  const preaborted = new AbortController();
  preaborted.abort(reason);
  await assert.rejects(run(["a", ":", "[a]"], {}, { env: named, signal: preaborted.signal }), error => error === reason);
  const controller = new AbortController();
  const match = RegexSession.prototype.matchExpr;
  let registered: InvocationCleanup | undefined;
  let pendingCleanup: Promise<void> | undefined;
  let cleanupSettled = false;
  context.mock.method(RegexSession.prototype, "matchExpr", function (this: RegexSession, ...args: Parameters<typeof match>) {
    assert(registered, "cleanup registered before worker admission");
    const pending = match.apply(this, args);
    controller.abort(reason);
    pendingCleanup = Promise.resolve(registered()).then(() => { cleanupSettled = true; });
    return pending;
  });
  await assert.rejects(run(["é", ":", "."], {}, {
    env: named, signal: controller.signal, registerCleanup(cleanup) { registered = cleanup; },
  }), error => error === reason);
  assert.equal(cleanupSettled, true, "command rejection awaits overlapping cleanup");
  await pendingCleanup;
  assert(registered);
  await registered();
});

for (const reason of [false, 0, "", null]) {
  test(`screen precharge direct/Shell cancellation preserves ${JSON.stringify(reason)}`, async context => {
    const jobs = observe(context);
    const pattern = "[".repeat(37);
    const encode = Budget.prototype.encode, charge = Budget.prototype.charge;
    const encoded = new WeakSet<Budget>();
    let controller = new AbortController();
    context.mock.method(Budget.prototype, "encode", function (this: Budget, text: string) {
      const result = encode.call(this, text);
      if (text === pattern) encoded.add(this);
      return result;
    });
    context.mock.method(Budget.prototype, "charge", function (this: Budget, size = 1) {
      if (size === pattern.length && encoded.has(this)) controller.abort(reason);
      return charge.call(this, size);
    });
    await assert.rejects(run(["a", ":", pattern], {}, { env: named, signal: controller.signal }), error => error === reason);
    controller = new AbortController();
    const shell = new Shell({ fs: createMemoryFileSystem(), env: named }).use(exprCommands());
    try {
      await assert.rejects(shell.exec(`expr a : '${pattern}'`, { signal: controller.signal }), error => error === reason);
    } finally { await shell.dispose(); }
    assert.equal(jobs.length, 0);
  });

  test(`actual Shell admitted cancellation preserves ${JSON.stringify(reason)}`, async context => {
    const controller = new AbortController();
    const match = RegexSession.prototype.matchExpr;
    const from = workers.length;
    context.mock.method(RegexSession.prototype, "matchExpr", function (this: RegexSession, ...args: Parameters<typeof match>) {
      const pending = match.apply(this, args);
      controller.abort(reason);
      return pending;
    });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: named }).use(exprCommands());
    try {
      await assert.rejects(shell.exec("expr é : .", { signal: controller.signal }), error => error === reason);
      assert(workers.length > from);
      assert(workers.slice(from).every(worker => worker.closed), "exec settlement awaits admitted worker retirement");
    } finally { await shell.dispose(); }
  });
}
