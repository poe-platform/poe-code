import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSafeJsShellModule } from "../../../src/integrations/safejs/index.js";
import type { SafeJsShellOptions, ShellExecutionOptions, ShellHostOperation } from "../../../src/integrations/safejs/index.js";
import { StubFileSystem } from "./stub-filesystem.js";

function setup() {
  const fs = new StubFileSystem();
  const controller = new AbortController();
  const policies: { operation: ShellHostOperation; policy: string }[] = [];
  const options: SafeJsShellOptions = {
    fs, signal: controller.signal, replayPolicy: "read-side-effect",
    declareHostOperation(operation, policy) { policies.push({ operation, policy }); return operation; },
  };
  return { fs, controller, policies, options };
}

test("exports one top-level named operation with an explicit effectful replay policy", async () => {
  const { options, policies, fs, controller } = setup();
  const module = makeSafeJsShellModule(async (source, context) => {
    assert.equal(source, "printf hello");
    assert.equal(context.fs, fs);
    assert.equal(context.signal, controller.signal);
    assert.deepEqual(context.env, { KEY: "value" });
    assert.equal(context.stdin, "input");
    assert.equal(context.cwd, "/work");
    return { stdout: "hello", stderr: "", exitCode: 0, hiddenFs: fs, hiddenSignal: controller.signal };
  }, options);
  assert.deepEqual(Object.keys(module), ["exec"]);
  assert.equal(policies[0]?.operation, module.exec);
  assert.equal(policies[0]?.policy, "read-side-effect");
  assert.equal(module.exec.name, "exec");
  assert.deepEqual(await module.exec("printf hello", { cwd: "/work", env: { KEY: "value" }, stdin: "input" }), { stdout: "hello", stderr: "", exitCode: 0 });
});

test("accepts a structural executor and retains its receiver", async () => {
  const { options } = setup();
  const executor = {
    count: 0,
    exec(_source: string, _options: ShellExecutionOptions) {
      this.count += 1;
      return { stdout: String(this.count), stderr: "", exitCode: 7 };
    },
  };
  const module = makeSafeJsShellModule(executor, options);
  assert.equal((await module.exec("ignored")).stdout, "1");
  assert.equal(executor.count, 1);
});

test("rejects guest signals, filesystem objects, and unrecognized options before execution", async () => {
  const { options } = setup();
  let count = 0;
  const module = makeSafeJsShellModule(() => { count += 1; return { stdout: "", stderr: "", exitCode: 0 }; }, options);
  await assert.rejects(Reflect.apply(module.exec, undefined, ["command", { signal: options.signal }]), /Unsupported option: signal/u);
  await assert.rejects(Reflect.apply(module.exec, undefined, ["command", { fs: options.fs }]), /Unsupported option: fs/u);
  await assert.rejects(Reflect.apply(module.exec, undefined, ["command", { env: { OBJECT: options.fs } }]), TypeError);
  await assert.rejects(Reflect.apply(module.exec, undefined, ["command", { get cwd() { throw new Error("getter executed"); } }]), /data properties/u);
  await assert.rejects(module.exec("command", { env: { "BAD=KEY": "value" } }), TypeError);
  assert.equal(count, 0);
});

test("copies guest environment and removes host-only result properties", async () => {
  const { options } = setup();
  const env = { KEY: "before" };
  const module = makeSafeJsShellModule((_source, context) => {
    assert.notEqual(context.env, env);
    return { stdout: "ok", stderr: "", exitCode: 0, signal: options.signal };
  }, options);
  const result = await module.exec("command", { env });
  assert.deepEqual(Object.keys(result), ["stdout", "stderr", "exitCode"]);
});

test("validates results and rejects pre-aborted calls without executing", async () => {
  const { options, controller } = setup();
  let count = 0;
  const module = makeSafeJsShellModule(() => { count += 1; return { stdout: "", stderr: "", exitCode: 256 }; }, options);
  await assert.rejects(module.exec("bad result"), /exitCode/u);
  controller.abort({ secret: true });
  await assert.rejects(module.exec("not run"), { name: "AbortError", code: "ABORT_ERR" });
  assert.equal(count, 1);
});

test("passes cancellation to the executor and rejects uncooperative in-flight work", async () => {
  const { options, controller } = setup();
  let notify: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { notify = resolve; });
  const module = makeSafeJsShellModule(async (_source, context) => {
    assert.equal(context.signal, controller.signal);
    notify();
    return new Promise(() => undefined);
  }, options);
  const pending = module.exec("slow");
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("does not permit a re-issue policy for an arbitrary effectful shell", () => {
  const { options } = setup();
  assert.throws(() => Reflect.apply(makeSafeJsShellModule, undefined, [() => undefined, { ...options, replayPolicy: "re-issue" }]), /read-side-effect/u);
});
