import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { execute } from "../safejs/helpers.js";
import { localRoot, localRuntime, localSkip } from "../safejs/local-runtime.js";

for (const [constructor, expression, expected] of [
  ["Error", 'new Error("constructed").message', "constructed"],
  ["TypeError", 'new TypeError("constructed").message', "constructed"],
  ["Map", 'new Map([["key", "value"]]).get("key")', "value"],
  ["Set", 'new Set(["value"]).has("value")', true],
  ["RegExp", 'new RegExp("^value$").test("value")', true],
] as const) {
  test(`KNOWN UPSTREAM LIMITATION: signal loses ${constructor} construction, not compatibility acceptance`, { skip: localSkip }, async context => {
    assert(localRoot);
    const module = await import(pathToFileURL(join(localRoot, "src/run.ts")).href) as {
      run(source: string, options?: { signal?: AbortSignal }): Promise<{ ok: boolean; returnValue?: unknown }>;
    };
    const source = `return ${expression};`;
    const withoutSignal = await module.run(source);
    assert.equal(withoutSignal.ok, true);
    assert.equal(withoutSignal.returnValue, expected);
    await assert.rejects(module.run(source, { signal: new AbortController().signal }), { message: `${constructor} is not a constructor.` });
    const result = await execute(["-p", "-e", source], { runtime: await localRuntime() });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, new RegExp(`${constructor} is not a constructor\\.`));
    context.diagnostic(`Expected ${JSON.stringify(expected)}; supplied-signal raw engine and plugin instead reject ${constructor} construction. No workaround applied.`);
  });
}

for (const [expression, expected, message] of [
  ["Array.isArray([])", true, "Function#isArray is not a supported method."],
  ["Array.from([1, 2])", [1, 2], "Function#from is not a supported method."],
] as const) {
  test(`KNOWN UPSTREAM LIMITATION: signal loses static ${expression}, not compatibility acceptance`, { skip: localSkip }, async () => {
    assert(localRoot);
    const module = await import(pathToFileURL(join(localRoot, "src/run.ts")).href) as {
      run(source: string, options?: { signal?: AbortSignal }): Promise<{ ok: boolean; returnValue?: unknown }>;
    };
    const source = `return ${expression};`;
    const control = await module.run(source);
    assert.equal(control.ok, true);
    assert.deepEqual(control.returnValue, expected);
    await assert.rejects(module.run(source, { signal: new AbortController().signal }), { message });
    const result = await execute(["-p", "-e", source], { runtime: await localRuntime() });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, `safejs: ${message}\n`);
  });
}

test("KNOWN UPSTREAM LIMITATION: signal drops own __proto__ data, not env-key compatibility", { skip: localSkip }, async context => {
  assert(localRoot);
  const module = await import(pathToFileURL(join(localRoot, "src/run.ts")).href) as {
    run(source: string, options: { modules: object; signal?: AbortSignal }): Promise<{ ok: boolean; returnValue?: unknown }>;
  };
  const env = Object.fromEntries([["__proto__", "literal"], ["constructor", "ctor"], ["prototype", "proto"]]);
  const source = 'import { env } from "command"; return [env["__proto__"], env.constructor, env.prototype];';
  const control = await module.run(source, { modules: { command: { env } } });
  assert.equal(control.ok, true);
  assert.deepEqual(control.returnValue, ["literal", "ctor", "proto"]);
  const signalled = await module.run(source, { modules: { command: { env } }, signal: new AbortController().signal });
  assert.equal(signalled.ok, true);
  assert.deepEqual(signalled.returnValue, [undefined, "ctor", "proto"]);
  const result = await execute(["-p", "-e", source], { runtime: await localRuntime() }, "", { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.toString()), [null, "ctor", "proto"]);
  assert.equal(Object.getOwnPropertyDescriptor(env, "__proto__")?.value, "literal");
  context.diagnostic('Expected literal __proto__ value; raw signalled engine loses it, plugin JSON consequently prints null. Not a successful preservation test.');
});

test("KNOWN UPSTREAM LIMITATION: raw pre-aborted pure run succeeds; plugin rejects before runner", { skip: localSkip }, async () => {
  assert(localRoot);
  const module = await import(pathToFileURL(join(localRoot, "src/run.ts")).href) as {
    run(source: string, options: { signal: AbortSignal }): Promise<{ ok: boolean; returnValue?: unknown }>;
  };
  const controller = new AbortController();
  const reason = new Error("already cancelled");
  controller.abort(reason);
  const raw = await module.run("return 42;", { signal: controller.signal });
  assert.equal(raw.ok, true);
  assert.equal(raw.returnValue, 42);
  const real = await localRuntime();
  let invoked = false;
  const runtime = { ...real, run: (...args: Parameters<typeof real.run>) => { invoked = true; return real.run(...args); } };
  await assert.rejects(execute(["-e", "return 42;"], { runtime }, "", { signal: controller.signal }), error => error === reason);
  assert.equal(invoked, false);
});
