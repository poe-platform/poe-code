import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = realpathSync(process.env.SAFEJS_LOCAL_ROOT);
const load = name => import(pathToFileURL(realpathSync(join(root, "src", name))).href);
const values = await load("interp/values.ts");
const { wrapCancelableBindings } = await load("interp/cancel.ts");
const { run } = await load("run.ts");

test("frozen branded closure preserves construct, static cycles and repeated identity", () => {
  let calls = 0;
  let constructions = 0;
  const closure = values.createSandboxClosure({
    name: "Original", call: () => ++calls, construct: () => ++constructions,
    properties: self => ({ self }),
  });
  const wrapped = wrapCancelableBindings({ first: closure, second: closure }, new AbortController().signal);
  assert(values.isSandboxClosure(wrapped.first));
  assert(Object.isFrozen(wrapped.first));
  assert(Object.isFrozen(wrapped.first.properties));
  assert.equal(wrapped.first, wrapped.second);
  assert.equal(wrapped.first.properties.self, wrapped.first);
  assert.equal(wrapped.first.name, "Original");
  assert.equal(wrapped.first.call([]), 1);
  assert.equal(wrapped.first.construct([]), 1);
});

test("retained budget graph remains live", () => {
  const retained = { text: "retained content" };
  const closure = values.createSandboxClosure({ call: () => 0, retainedValues: () => [retained] });
  const wrapped = wrapCancelableBindings({ closure }, new AbortController().signal).closure;
  assert.equal(values.measureSandboxData([wrapped]), values.measureSandboxData([closure]));
  retained.text += " appended later";
  assert.equal(values.measureSandboxData([wrapped]), values.measureSandboxData([closure]));
});

test("shared property and retained graph is not double charged", () => {
  const retained = { text: "same object retained and visible" };
  const closure = values.createSandboxClosure({ call: () => 0, properties: { retained }, retainedValues: () => [retained] });
  const wrapped = wrapCancelableBindings({ closure }, new AbortController().signal).closure;
  assert.equal(values.measureSandboxData([wrapped]), values.measureSandboxData([closure]));
});

test("own special-name data and cycles never invoke prototype setters", () => {
  for (const payload of ["literal", { marker: "data" }]) {
    const input = Object.fromEntries([["__proto__", payload], ["constructor", "literal constructor"], ["prototype", "literal prototype"]]);
    input.self = input;
    const output = wrapCancelableBindings({ input }, new AbortController().signal).input;
    assert.equal(Object.getPrototypeOf(output), Object.getPrototypeOf(input));
    assert(Object.hasOwn(output, "__proto__"));
    assert.deepEqual(output.__proto__, payload);
    assert.equal(output.self, output);
    assert.equal(output.constructor, "literal constructor");
    assert.equal(output.prototype, "literal prototype");
    assert.equal(output.marker, undefined);
  }
});

test("branded collection and regex identity survives wrapping", () => {
  const map = values.createSandboxMap([["key", "value"]]);
  const set = values.createSandboxSet(["value"]);
  const regex = values.createSandboxRegex("^value$");
  const output = wrapCancelableBindings({ map, set, regex }, new AbortController().signal);
  assert(values.isSandboxMap(output.map));
  assert(values.isSandboxSet(output.set));
  assert(values.isSandboxRegex(output.regex));
  assert.equal(output.map, map);
  assert.equal(output.set, set);
  assert.equal(output.regex, regex);
});

test("pre-aborted call and construct reject exact reasons without effects", () => {
  for (const reason of [new Error("review cancellation"), false, null]) {
    let calls = 0;
    const closure = values.createSandboxClosure({ call: () => ++calls, construct: () => ++calls });
    const wrapped = wrapCancelableBindings({ closure }, AbortSignal.abort(reason)).closure;
    assert.throws(() => wrapped.call([]), error => error === reason);
    assert.throws(() => wrapped.construct([]), error => error === reason);
    assert.equal(calls, 0);
  }
});

test("raw preabort preserves exact null and false reasons before host work", async () => {
  for (const reason of [null, false]) {
    let reads = 0;
    const options = { signal: AbortSignal.abort(reason), get bindings() { reads += 1; return {}; } };
    await assert.rejects(run("return 42;", options), error => error === reason);
    assert.equal(reads, 0);
  }
});

test("signalled constructors retain internal instanceof identity and error data", async () => {
  for (const signal of [undefined, new AbortController().signal]) {
    const result = await run('return [new Map() instanceof Map, new Set() instanceof Set, new TypeError("x") instanceof Error, new TypeError("x") instanceof TypeError];', { signal });
    assert.deepEqual(result.returnValue, [true, true, true, true]);
  }
});

test("both cancellation-result forms observe immediate/delayed originals and clean listeners", () => {
  const child = spawnSync(process.execPath, [
    "--unhandled-rejections=strict", "--max-old-space-size=256", "--import", import.meta.resolve("tsx"),
    "--import", fileURLToPath(new URL("./import-proof.mjs", import.meta.url)),
    fileURLToPath(new URL("./promise-observation.child.mjs", import.meta.url)),
  ], { cwd: process.cwd(), env: { ...process.env, TSX_DISABLE_CACHE: "1" }, encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /all promise observation variants completed/);
});
