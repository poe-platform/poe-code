import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [mode, manifestName, expectedManifestHash, expectation] = process.argv.slice(2);
assert.ok(mode && manifestName && expectedManifestHash);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const manifestBytes = await readFile(resolve(manifestName));
assert.equal(sha256(manifestBytes), expectedManifestHash, "controller-authenticated manifest");
const manifest = JSON.parse(manifestBytes);
const packageRoot = resolve(manifest.packageRoot);
const packageBytes = await readFile(join(packageRoot, "package.json"));
assert.equal(sha256(packageBytes), manifest.files["package.json"]);
const packageJson = JSON.parse(packageBytes);
assert.equal(packageJson.name, "virtual-bash");
assert.equal(packageJson.version, "0.0.0");
const vectors = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url)));

async function load(relative) {
  const bytes = await readFile(join(packageRoot, relative));
  assert.equal(sha256(bytes), manifest.files[relative], relative);
  return import(pathToFileURL(join(packageRoot, relative)).href);
}

async function directEvaluation() {
  const { Interpreter } = await load("dist/commands/structured/interpreter.js");
  const { Budget, JqError, JqLimitError, object, put, resolveJqLimits } = await load("dist/commands/structured/limits.js");
  const { Decimal } = await load("dist/commands/structured/numbers.js");
  const { FsError } = await load("dist/contracts/errors.js");
  class ObservedBudget extends Budget {
    charges = [];
    ticks = 0;
    step(count = 1) { this.charges.push(count); super.step(count); }
    async tick() { this.ticks++; await super.tick(); }
  }
  const ast = { kind: "call", name: "length", args: [] };
  const evaluate = async (input, signal = new AbortController().signal) => {
    const budget = new ObservedBudget(resolveJqLimits({ maxSteps: 1 }), signal);
    const iterator = new Interpreter(budget, new Map()).run(ast, input);
    const first = await iterator.next();
    assert.equal(first.done, false);
    await iterator.return(undefined);
    assert.deepEqual(budget.charges, [1]);
    assert.equal(budget.ticks, 1);
    assert.throws(() => budget.step(), error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
    return first.value;
  };
  const observations = [];
  for (const row of vectors.strings) {
    assert.ok(row.input.length <= vectors.maximumLiteralStringCodeUnits);
    assert.equal(await evaluate(row.input), row.expected, row.id);
    observations.push({ cohort: "unicode", id: row.id, value: row.expected, entryTicks: 1 });
  }
  const specialObject = object();
  put(specialObject, "__proto__", 3); put(specialObject, "constructor", 2);
  const successful = [
    ["null", null, 0], ["positive", 2.25, 2.25], ["negative", -2.25, 2.25], ["negative-zero", -0, 0],
    ["infinity", -Infinity, Infinity], ["nan", NaN, NaN], ["array", [null, false, "x"], 3],
    ["empty-array", [], 0], ["sparse-array", new Array(3), 3], ["empty-object", object(), 0],
    ["own-special-keys", specialObject, 2], ["decimal", new Decimal("25", -1, true, "-2.5", -2.5), 2.5],
  ];
  for (const [id, input, expected] of successful) {
    assert.ok(Object.is(await evaluate(input), expected), id);
    observations.push({ cohort: "non-string", id, expected: String(expected), entryTicks: 1 });
  }
  for (const input of [true, false]) {
    const budget = new ObservedBudget(resolveJqLimits({ maxSteps: 1 }), new AbortController().signal);
    const iterator = new Interpreter(budget, new Map()).run(ast, input);
    await assert.rejects(iterator.next(), error => error instanceof JqError && error.message === "boolean has no length" && error.exitCode === 5);
    assert.deepEqual(budget.charges, [1]); assert.equal(budget.ticks, 1);
    observations.push({ cohort: "non-string", id: `boolean-${input}`, error: "JqError:boolean has no length:5", entryTicks: 1 });
  }
  for (const [id, reason] of [["errno", new FsError("EFBIG")], ["null", null], ["false", false], ["zero", 0], ["empty", ""], ["symbol", Symbol("stop")]]) {
    const controller = new AbortController(); controller.abort(reason);
    const budget = new ObservedBudget(resolveJqLimits({ maxSteps: 1 }), controller.signal);
    const iterator = new Interpreter(budget, new Map()).run(ast, vectors.sentinel);
    await assert.rejects(iterator.next(), error => error === reason);
    assert.deepEqual(budget.charges, [1]); assert.equal(budget.ticks, 1);
    observations.push({ cohort: "pre-abort", id, exactReason: true, entryTicks: 1 });
  }
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator);
  const original = descriptor.value;
  for (const scenario of ["finite", "empty", "throws", "abort-without-new-observation"]) {
    const controller = new AbortController();
    const reason = new FsError("EACCES");
    const events = [];
    Object.defineProperty(String.prototype, Symbol.iterator, { ...descriptor, value: function (...args) {
      if (this !== vectors.trustedIteratorSentinel) return Reflect.apply(original, this, args);
      let index = 0;
      return { next() {
        events.push(`next-${++index}`);
        if (scenario === "throws") throw reason;
        if (scenario === "empty") return { done: true };
        if (scenario === "abort-without-new-observation" && index === 1) {
          controller.abort(false); queueMicrotask(() => events.push("microtask"));
        }
        return index <= 3 ? { done: false, get value() { events.push(`value-${index}`); return index; } } : { done: true };
      } };
    } });
    try {
      if (scenario === "throws") {
        const budget = new ObservedBudget(resolveJqLimits({ maxSteps: 1 }), controller.signal);
        const iterator = new Interpreter(budget, new Map()).run(ast, vectors.trustedIteratorSentinel);
        await assert.rejects(iterator.next(), error => error === reason);
      } else {
        const budget = new ObservedBudget(resolveJqLimits({ maxSteps: 1 }), controller.signal);
        const iterator = new Interpreter(budget, new Map()).run(ast, vectors.trustedIteratorSentinel);
        const first = await iterator.next();
        assert.equal(first.value, scenario === "empty" ? 0 : vectors.trustedIteratorExpected);
        await iterator.return(undefined);
      }
    } finally { Object.defineProperty(String.prototype, Symbol.iterator, descriptor); }
    assert.deepEqual(Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator), descriptor);
    if (scenario === "abort-without-new-observation") {
      assert.equal(controller.signal.reason, false);
      assert.deepEqual(events, ["next-1", "value-1", "next-2", "value-2", "next-3", "value-3", "next-4", "microtask"]);
    }
    observations.push({ cohort: "trusted-iterator", id: scenario, events, restored: true });
  }
  assert.equal(observations.length, 41);
  return observations;
}

async function publicInstalled() {
  const expectedRoot = pathToFileURL(join(packageRoot, "dist/index.js")).href;
  assert.equal(import.meta.resolve("virtual-bash"), expectedRoot);
  assert.equal(sha256(await readFile(fileURLToPath(expectedRoot))), manifest.files["dist/index.js"]);
  const { createMemoryFileSystem, createStructuredCommands, toByteSource } = await import("virtual-bash");
  const rows = [
    ...vectors.strings.filter(row => !row.internalOnly).map(row => ({ id: row.id, input: JSON.stringify(row.input), expected: `${row.expected}\n` })),
    ...vectors.public,
  ];
  const observations = [];
  for (const row of rows) {
    const stdout = [], stderr = [];
    const result = await createStructuredCommands()[0].execute({ command: "jq", args: ["-c", "length"], cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(row.input), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
    assert.equal(result.exitCode, 0, row.id);
    assert.equal(Buffer.concat(stdout).toString(), row.expected, row.id);
    assert.equal(Buffer.concat(stderr).length, 0, row.id);
    observations.push({ cohort: "installed-public-command", id: row.id, stdout: row.expected });
  }
  assert.equal(observations.length, 18);
  return observations;
}

async function allocationDiscriminator() {
  const { Interpreter } = await load("dist/commands/structured/interpreter.js");
  const { Budget, resolveJqLimits } = await load("dist/commands/structured/limits.js");
  const ast = { kind: "call", name: "length", args: [] };
  const descriptor = Object.getOwnPropertyDescriptor(Array, "from");
  const original = descriptor.value;
  const marker = new Error("author tiny sentinel collection marker");
  const stacks = [];
  let productCollected = false;
  Object.defineProperty(Array, "from", { ...descriptor, value: function (...args) {
    if (typeof args[0] === "string" && args[0] === vectors.sentinel) {
      stacks.push(new Error().stack); throw marker;
    }
    return Reflect.apply(original, this, args);
  } });
  try {
    assert.throws(() => Array.from(vectors.sentinel), error => error === marker);
    let count = 0;
    for (const value of vectors.sentinel) { void value; count++; }
    assert.equal(count, vectors.sentinelExpected);
    assert.deepEqual(Array.from([7]), [7]);
    assert.deepEqual(Array.from(`${vectors.sentinel}x`), ["L", "😀", "e", "́", "x"]);
    const budget = new Budget(resolveJqLimits({ maxSteps: 1 }), new AbortController().signal);
    const iterator = new Interpreter(budget, new Map()).run(ast, vectors.sentinel);
    try {
      const first = await iterator.next();
      assert.equal(first.value, vectors.sentinelExpected);
      await iterator.return(undefined);
    } catch (error) { if (error !== marker) throw error; productCollected = true; }
    if (productCollected) {
      assert.equal(stacks.length, 2);
      assert.match(stacks[1], /dist\/commands\/structured\/interpreter\.js/u);
    } else assert.equal(stacks.length, 1);
  } finally { Object.defineProperty(Array, "from", descriptor); }
  assert.deepEqual(Object.getOwnPropertyDescriptor(Array, "from"), descriptor);
  if (expectation === "noncollecting") assert.equal(productCollected, false, "candidate must not call Array.from for the sentinel");
  else if (expectation === "collecting") assert.equal(productCollected, true, "baseline/reversion must trip the sentinel wrapper");
  else throw new Error(`unknown discriminator expectation: ${expectation}`);
  return [{ cohort: "moved-discriminator", id: "tiny-array-from", productCollected, wrapperActive: true, wrongInputDelegated: true,
    unrelatedDelegated: true, counterReturned: vectors.sentinelExpected, restored: true, markerStacks: stacks }];
}

async function movedPublic() {
  const expectedRoot = pathToFileURL(join(packageRoot, "dist/index.js")).href;
  assert.equal(import.meta.resolve("virtual-bash"), expectedRoot);
  const { Shell, createMemoryFileSystem, structuredCommands } = await import("virtual-bash");
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.json", new TextEncoder().encode('["A😀B","é","👩‍💻"]'));
  const shell = new Shell({ fs }).use(structuredCommands());
  try {
    const result = await shell.exec("jq -c 'map(length)' /input.json | jq -c 'length' > /result.json");
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: 0, stdout: "", stderr: "" });
    assert.equal(new TextDecoder().decode(await fs.readFile("/result.json")), "3\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/input.json")), '["A😀B","é","👩‍💻"]');
  } finally { await shell.dispose(); }
  return [{ cohort: "moved-shell-vfs", id: "jq-pipeline", resultFile: "3\\n", inputPreserved: true }];
}

let observations;
if (mode === "direct") observations = await directEvaluation();
else if (mode === "installed-public") observations = await publicInstalled();
else if (mode === "discriminator") observations = await allocationDiscriminator();
else if (mode === "moved-public") observations = await movedPublic();
else throw new Error(`unknown mode: ${mode}`);
process.stdout.write(`${JSON.stringify({ mode, candidate: manifest.candidate, packageRoot, observations, nativeExecuted: false })}\n`);

