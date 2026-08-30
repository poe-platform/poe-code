import assert from "node:assert/strict";
import * as publicRoot from "virtual-bash";
import * as publicContracts from "virtual-bash/contracts";
import { createOutputOperation as outputSubpath } from "virtual-bash/contracts/output";

const { Shell, MemoryFileSystem, createOutputOperation, standardCommands } = publicRoot;
const encode = value => new TextEncoder().encode(value);
const rows = [];
const deferred = () => {
  let resolve;
  const promise = new Promise(fulfill => { resolve = fulfill; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const deadline = setTimeout(() => { console.error("AUTHOR public fixture containment deadline; no acceptance"); process.exit(124); }, 10000);
async function check(id, body) {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  try { await body(shell); rows.push({ id, status: "PASS" }); }
  finally { await shell.dispose(); }
}

try {
  assert.equal(createOutputOperation, publicContracts.createOutputOperation);
  assert.equal(createOutputOperation, outputSubpath);
  for (const name of ["Shell", "MemoryFileSystem", "createOutputOperation", "curlCommands", "safeJsCommands", "makeSafeJsShellModule"]) assert.equal(typeof publicRoot[name], "function", name);
  for (const specifier of ["virtual-bash/src/index.ts", "virtual-bash/dist/index.js", "virtual-bash/shell/runtime"]) await assert.rejects(import(specifier), error => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");

  await check("P01-optional-capability-and-legacy", async shell => {
    let ordinary = 0;
    let enrolled = 0;
    const consumer = new AbortController();
    shell.register({ name: "owned", async execute(context) {
      const operation = createOutputOperation(context, context.stdout);
      await operation.output.write(encode("owned"));
      return { exitCode: 0 };
    } });
    const result = await shell.exec("owned", { stdout: { async write() { ordinary += 1; }, ownedOutput: { consumerClosed: consumer.signal, async write() { enrolled += 1; } } }, limits: { maxOutputBytes: 5 } });
    assert.equal(result.stdout, "owned");
    assert.equal(enrolled, 1);
    assert.equal(ordinary, 0);
    const legacy = await shell.exec("owned", { stdout: { async write() { ordinary += 1; } } });
    assert.equal(legacy.stdout, "owned");
    assert.equal(ordinary, 1);
    assert.equal(enrolled, 1);
  });

  await check("P02-accounting-once-and-budget", async shell => {
    const consumer = new AbortController();
    let acceptedBytes = 0;
    shell.register({ name: "counted", async execute(context) {
      const operation = createOutputOperation(context, context.stdout);
      await operation.output.write(encode("1234"));
      await operation.output.write(encode("5"));
      return { exitCode: 0 };
    } });
    const sink = { async write() { throw new Error("Unselected ordinary destination"); }, ownedOutput: { consumerClosed: consumer.signal, async write(bytes) { acceptedBytes += bytes.length; } } };
    assert.equal((await shell.exec("counted", { stdout: sink, limits: { maxOutputBytes: 5 } })).stdout, "12345");
    assert.equal(acceptedBytes, 5);
    await assert.rejects(shell.exec("counted", { stdout: sink, limits: { maxOutputBytes: 4 } }), error => error.limit === "maxOutputBytes");
    assert.equal(acceptedBytes, 9);
  });

  await check("P03-admitted-acquisition-close-race", async shell => {
    const started = deferred();
    const acquireGate = deferred();
    const releaseEntered = deferred();
    const releaseGate = deferred();
    const resource = {};
    let releases = 0;
    let settled = false;
    let operation;
    shell.register({ name: "pending", execute(context) {
      operation = createOutputOperation(context, context.stdout);
      const acquiring = operation.acquire(() => { started.resolve(); return acquireGate.promise; }, async received => {
        assert.equal(received, resource);
        releases += 1;
        releaseEntered.resolve();
        await releaseGate.promise;
      });
      void acquiring.catch(() => {});
      return { exitCode: 0 };
    } });
    const invocation = shell.exec("pending");
    void invocation.then(() => { settled = true; }, () => { settled = true; });
    await started.promise;
    await turn();
    assert.equal(settled, false);
    const closing = operation.close();
    assert.equal(operation.close(), closing);
    let lateStarts = 0;
    await assert.rejects(operation.acquire(() => { lateStarts += 1; return {}; }, () => {}));
    assert.equal(lateStarts, 0);
    acquireGate.resolve(resource);
    await releaseEntered.promise;
    await turn();
    assert.equal(settled, false);
    releaseGate.resolve();
    assert.equal((await invocation).exitCode, 0);
    await closing;
    assert.equal(releases, 1);
  });

  await check("P04-nested-cleanup-before-return", async shell => {
    const events = [];
    shell.register({ name: "nested", execute(context) {
      const operation = createOutputOperation(context, context.stdout);
      operation.registerCleanup(async () => { await turn(); events.push("cleanup"); });
      return { exitCode: 7 };
    } });
    shell.register({ name: "outer", async execute(context) {
      const result = await context.invoke("nested", ["literal;not-a-command"]);
      events.push("nested-return");
      assert.deepEqual(events, ["cleanup", "nested-return"]);
      return result;
    } });
    assert.equal((await shell.exec("outer")).exitCode, 7);
    assert.deepEqual(events, ["cleanup", "nested-return"]);
  });

  await check("P05-legacy-not-implicitly-enrolled", async shell => {
    const consumer = new AbortController();
    consumer.abort(new Error("Only enrolled operations observe this"));
    let ordinary = 0;
    let enrolled = 0;
    shell.register({ name: "legacy", async execute(context) { await context.stdout.write(encode("legacy")); return { exitCode: 0 }; } });
    const result = await shell.exec("legacy", { stdout: { async write() { ordinary += 1; }, ownedOutput: { consumerClosed: consumer.signal, async write() { enrolled += 1; } } } });
    assert.equal(result.stdout, "legacy");
    assert.equal(ordinary, 1);
    assert.equal(enrolled, 0);
  });

  await check("P06-borrowed-cursor-and-actual-cat", async shell => {
    await shell.use(standardCommands());
    let returns = 0;
    let reads = 0;
    const borrowed = { [Symbol.asyncIterator]() { return this; }, async next() { reads += 1; return reads === 1 ? { done: false, value: encode("cursor") } : { done: true, value: undefined }; }, async return() { returns += 1; return { done: true, value: undefined }; } };
    assert.equal((await shell.exec("cat", { stdin: borrowed })).stdout, "cursor");
    assert.equal(returns, 0);
  });

  for (const mode of ["caller", "execution", "cleanup"]) await check(`P07-precedence-${mode}`, async shell => {
    const caller = new AbortController();
    const callerFailure = new Error("caller-identity");
    const executionFailure = new Error("execution-identity");
    const cleanupFailure = new Error("cleanup-identity");
    let cleaned = 0;
    let selectorCalls = 0;
    shell.register({ name: "precedence", execute(context) {
      const operation = createOutputOperation(context, context.stdout);
      operation.registerCleanup(() => { cleaned += 1; throw cleanupFailure; });
      if (mode === "caller") caller.abort(callerFailure);
      if (mode !== "cleanup") throw executionFailure;
      return { exitCode: 3 };
    } });
    const expected = mode === "caller" ? callerFailure : mode === "execution" ? executionFailure : cleanupFailure;
    const source = mode === "execution" ? "precedence\n)" : "precedence";
    const stderr = { async write(bytes) {
      if (mode === "execution" && new TextDecoder().decode(bytes) === "shell: Expected command at offset 11\n") {
        selectorCalls += 1;
        throw executionFailure;
      }
    } };
    await assert.rejects(shell.exec(source, { signal: caller.signal, stderr }), error => error === expected);
    assert.equal(selectorCalls, mode === "execution" ? 1 : 0);
    assert.equal(cleaned, 1);
  });
  console.log(JSON.stringify({ qualification: "AUTHOR_PUBLIC_CONSUMER_ONLY", exports: { root: Object.keys(publicRoot).sort(), contracts: Object.keys(publicContracts).sort() }, rows, pending: ["curl+cat mixed destinations", "actual-current SafeJS 25", "original five custom pre-first-read cohort", "different final verifier"] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ qualification: "AUTHOR_PUBLIC_NONPASS", rows, error: { name: error.name, message: error.message, stack: error.stack } }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
