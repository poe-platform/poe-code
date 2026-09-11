import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext, CommandInvoker, CommandInvokeOptions, InvocationCleanup } from "../../src/contracts/command.js";

type Same<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2) ? true : false;

type AcceptsCleanup<Candidate> = [Candidate] extends [InvocationCleanup] ? true : false;

test("cleanup registration is an additive optional readonly callback with no public drain handle", () => {
  const absent: Pick<CommandContext, "registerCleanup"> = {};
  const shape: Same<Pick<CommandContext, "registerCleanup">,
    Readonly<{ registerCleanup?: (cleanup: InvocationCleanup) => void }>> = true;
  const parameters: Same<Parameters<InvocationCleanup>, []> = true;
  const result: Same<ReturnType<NonNullable<CommandContext["registerCleanup"]>>, void> = true;
  assert.equal(absent.registerCleanup, undefined);
  assert.equal(shape, true);
  assert.equal(parameters, true);
  assert.equal(result, true);
});

test("cleanup callback type accepts synchronous void and asynchronous Promise<void>", async () => {
  const calls: string[] = [];
  const synchronous: InvocationCleanup = () => { calls.push("sync"); };
  const asynchronous: InvocationCleanup = async () => { await Promise.resolve(); calls.push("async"); };
  assert.equal(synchronous(), undefined);
  const pending = asynchronous();
  assert.ok(pending instanceof Promise);
  await pending;
  assert.deepEqual(calls, ["sync", "async"]);
});

test("cleanup negative type controls exclude values, required arguments and nonvoid results", () => {
  const controls: {
    nonCallable: AcceptsCleanup<Promise<void>>;
    requiresSignal: AcceptsCleanup<(signal: AbortSignal) => Promise<void>>;
    returnsNumber: AcceptsCleanup<() => number>;
    resolvesNumber: AcceptsCleanup<() => Promise<number>>;
    returnsUnknown: AcceptsCleanup<() => unknown>;
    returnsNull: AcceptsCleanup<() => null>;
  } = {
    nonCallable: false,
    requiresSignal: false,
    returnsNumber: false,
    resolvesNumber: false,
    returnsUnknown: false,
    returnsNull: false,
  };
  assert.deepEqual(Object.values(controls), [false, false, false, false, false, false]);
});

test("registration does not change nested invoke options or invocation result types", () => {
  const invoker: Same<CommandContext["invoke"], CommandInvoker | undefined> = true;
  const options: Same<keyof CommandInvokeOptions,
    "argumentValues" | "signal" | "stdin" | "stdinIsDefault" | "stdout" | "stderr" | "cwd" | "env" | "replaceEnv"> = true;
  const callback: Same<InvocationCleanup, () => void | Promise<void>> = true;
  assert.equal(invoker, true);
  assert.equal(options, true);
  assert.equal(callback, true);
});
