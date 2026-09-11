import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { createNodeRegexProvider } from "../../../src/commands/regex-execution/client.js";
import { RegexExecutor, withRegexSession } from "../../../src/commands/regex-execution/portable.js";
import { exprMatchCeilings, type BreSearchDescriptor } from "../../../src/commands/regex-execution/protocol.js";
import type { BoundedRegexProvider, RegexWorkerRequest } from "../../../src/commands/regex-execution/provider.js";
import { csplitCommands } from "../../../src/commands/csplit/index.js";
import { nativeCases } from "./native-cases.js";
import { finiteCases } from "./finite-cases.js";

for (const profile of ["byte", "utf8-scalar"] as const) test(`session owns pattern, subject and limits before queued admission: ${profile}`, async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  const pattern = Uint8Array.of(97), subject = Uint8Array.of(255, 97);
  const limits = { ...exprMatchCeilings };
  try {
    const pending = session.searchBre({ kind: "bre-search", pattern, profile, limits }, subject);
    pattern.fill(122); subject.fill(0); limits.maxSteps = 1;
    const result = await pending;
    assert.deepEqual(result.overall, { start: 1, end: 2 });
    assert.equal(result.matched, true);
  } finally { await session.close(); await executor.dispose(); }
});

for (const reason of [false, null, 0, ""]) test(`actual Shell searchBre preserves ${JSON.stringify(reason)} and retires admitted provider work`, async () => {
  const controller = new AbortController();
  const base = createBoundedRegexProvider();
  let requests = 0, retirements = 0, writes = 0;
  const provider: BoundedRegexProvider = { createWorker(options) {
    const worker = base.createWorker(options);
    const post = worker.postMessage.bind(worker), terminate = worker.terminate.bind(worker);
    worker.postMessage = request => {
      requests++;
      post(request);
      controller.abort(reason);
    };
    worker.terminate = async () => { await terminate(); retirements++; };
    return worker;
  } };
  const executor = new RegexExecutor(provider);
  const selected: BreSearchDescriptor = { kind: "bre-search", pattern: Buffer.from("\\(a\\|aa\\)*b"), profile: "byte", limits: exprMatchCeilings };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use({ name: "independent-bre", setup(host) {
    host.commands.register({ name: "bre-review", async execute(context) {
      return withRegexSession(context, executor, async session => {
        await session.searchBre(selected, Buffer.from("a".repeat(32)));
        writes++;
        await context.stdout.write(Buffer.from("unexpected late output"));
        return { exitCode: 0 };
      });
    } });
  }, async dispose() { await executor.dispose(); } });
  try {
    await assert.rejects(shell.exec("bre-review", { signal: controller.signal }), error => Object.is(error, reason));
    assert.deepEqual({ requests, retirements, writes }, { requests: 1, retirements: 1, writes: 0 });
    assert.equal((await shell.exec(":")).exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const prepareOnly of [false, true]) test(`csplit recompilation shares invocation work, prepareOnly=${prepareOnly}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("a\n".repeat(40)));
  const requests: RegexWorkerRequest[] = [];
  const base = createBoundedRegexProvider();
  const provider: BoundedRegexProvider = { createWorker(options) {
    const worker = base.createWorker(options), post = worker.postMessage.bind(worker);
    worker.postMessage = request => { requests.push(request); post(request); };
    return worker;
  } };
  const shell = new Shell({ fs, cwd: "/work" }).use(csplitCommands({ regexExecutor: provider, limits: { maxWork: 1000 } }));
  try {
    const result = await shell.exec(`csplit input ${prepareOnly ? Array<string>(20).fill("/z/").join(" ") : "/z/"}`);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("limit"), result.stderr);
    assert.ok(requests.length > 1);
    assert.ok(requests.length < (prepareOnly ? 20 : 41));
    for (let index = 1; index < requests.length; index++) {
      const previous = requests[index - 1]!.descriptor, current = requests[index]!.descriptor;
      assert.equal(previous.kind, "bre-search"); assert.equal(current.kind, "bre-search");
      if (previous.kind !== "bre-search" || current.kind !== "bre-search") assert.fail("unexpected operation");
      assert.ok(current.limits.maxSteps < previous.limits.maxSteps);
    }
    if (prepareOnly) assert.ok(requests.every(request => request.rows[0]!.bytes.length === 0));
    else assert.ok(requests.some(request => request.rows[0]!.bytes.length === 1));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["input"]);
  } finally { await shell.dispose(); }
});

test("refreshed Node worker independently replays the saved native search cohort", async context => {
  const executor = new RegexExecutor(createNodeRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    for (const fixture of [...nativeCases, ...finiteCases]) await context.test(`${fixture.locale} ${fixture.name}`, async () => {
      const result = await session.searchBre({
        kind: "bre-search", pattern: Buffer.from(fixture.pattern),
        profile: fixture.locale === "C" ? "byte" : "utf8-scalar", limits: exprMatchCeilings,
      }, Buffer.from(fixture.subjectBase64, "base64"));
      assert.equal(result.matched, fixture.status === 0);
      assert.equal(result.offsetUnit, "byte");
      assert.equal(result.overall === null, fixture.status !== 0);
    });
    await context.test("queued scalar inputs keep original bytes and absolute offsets", async () => {
      const pattern = Buffer.from("é\\+"), subject = Buffer.from("zzéé");
      const pending = session.searchBre({ kind: "bre-search", pattern, profile: "utf8-scalar", limits: exprMatchCeilings }, subject);
      pattern.fill(0); subject.fill(0);
      assert.deepEqual((await pending).overall, { start: 2, end: 6 });
    });
  } finally { await session.close(); await executor.dispose(); }
});
