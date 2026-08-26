import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  CommandRegistry, composeMiddleware, type CommandContext, type CommandDefinition,
  type Middleware, type Next,
} from "../../src/contracts/index.js";

function context(): CommandContext {
  return { signal: new AbortController().signal } as CommandContext;
}

test("late next calls cannot dispatch commands after middleware has returned", async () => {
  let continuation: Next = async () => ({ exitCode: 0 });
  let executions = 0;
  const run = composeMiddleware([(_context, next) => {
    continuation = next;
    return { exitCode: 126 };
  }], () => { executions++; return { exitCode: 0 }; });
  assert.deepEqual(await run(context()), { exitCode: 126 });
  await assert.rejects(continuation(), /completed/u);
  assert.equal(executions, 0);
});

test("concurrent repeated next attempts execute the terminal only once", async () => {
  let executions = 0;
  const run = composeMiddleware([async (_context, next) => {
    const results = await Promise.allSettled([next(), next()]);
    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "rejected");
    return { exitCode: 0 };
  }], () => { executions++; return { exitCode: 0 }; });
  await run(context());
  assert.equal(executions, 1);
});

test("middleware cancellation between layers prevents terminal execution", async () => {
  const controller = new AbortController();
  const reason = new Error("canceled");
  const run = composeMiddleware([(_context, next) => {
    controller.abort(reason);
    return next();
  }], () => { throw new Error("must not execute"); });
  await assert.rejects(run({ ...context(), signal: controller.signal }), (error) => error === reason);
});

test("reentrant invocation has its own dispatch cursor", async () => {
  let nested = false;
  let executions = 0;
  const run = composeMiddleware([async (_context, next) => {
    if (!nested) { nested = true; await run(context()); }
    return next();
  }], () => { executions++; return { exitCode: 0 }; });
  await run(context());
  assert.equal(executions, 2);
});

test("middleware stacks are snapshotted and invalid runtime handlers fail loudly", async () => {
  const stack: Middleware[] = [];
  const run = composeMiddleware(stack, () => ({ exitCode: 0 }));
  stack.push(() => ({ exitCode: 7 }));
  assert.deepEqual(await run(context()), { exitCode: 0 });
  assert.throws(() => composeMiddleware([undefined as unknown as Middleware],
    () => ({ exitCode: 0 })), TypeError);
});

test("registries accept class-based command definitions without dropping prototype methods", async () => {
  class ExampleCommand implements CommandDefinition {
    name = "class-command";
    execute() { return { exitCode: 3 }; }
  }
  const registry = new CommandRegistry([new ExampleCommand()]);
  assert.deepEqual(await registry.get("class-command")!.execute(context()), { exitCode: 3 });
});

test("registry rejects non-string names from JavaScript callers", () => {
  for (const name of [12, {}, [], true]) {
    const command = { name, execute: () => ({ exitCode: 0 }) } as unknown as CommandDefinition;
    assert.throws(() => new CommandRegistry([command]), TypeError);
  }
});

test("prototype-like names remain ordinary map keys and failed registration preserves existing entries", () => {
  const registry = new CommandRegistry();
  for (const name of ["__proto__", "constructor", "toString"]) {
    const execute = () => ({ exitCode: 0 });
    registry.register({ name, execute });
    assert.equal(registry.get(name)?.execute, execute);
    assert.throws(() => registry.register({ name, execute }), /already registered/u);
    assert.equal(registry.get(name)?.execute, execute);
  }
});

test("middleware cannot finish while detached next work is still running", async () => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let settled = false;
  const run = composeMiddleware([(_context, next) => {
    void next().catch(() => {});
    return { exitCode: 0 };
  }], async () => { await waiting; return { exitCode: 0 }; });
  const result = run(context()).then(
    (value) => { settled = true; return value; },
    (error: unknown) => { settled = true; throw error; },
  );
  const rejected = assert.rejects(result, /await or return next/u);
  void rejected.catch(() => {});
  await setImmediate();
  const finishedEarly = settled;
  release();
  await rejected;
  assert.equal(finishedEarly, false);
});

test("middleware failure drains started downstream work and preserves the original error", async () => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const failure = new Error("middleware failed");
  let settled = false;
  const run = composeMiddleware([(_context, next) => {
    void next().catch(() => {});
    throw failure;
  }], async () => { await waiting; throw new Error("downstream failed"); });
  const result = run(context()).finally(() => { settled = true; });
  const rejected = assert.rejects(result, (error) => error === failure);
  await setImmediate();
  const finishedEarly = settled;
  release();
  await rejected;
  assert.equal(finishedEarly, false);
});

test("middleware may intentionally recover from an awaited downstream error", async () => {
  const run = composeMiddleware([async (_context, next) => {
    try { return await next(); }
    catch { return { exitCode: 127 }; }
  }], () => { throw new Error("command failure"); });
  assert.deepEqual(await run(context()), { exitCode: 127 });
});

test("ignored downstream rejection is supervised rather than left unhandled", async () => {
  const run = composeMiddleware([(_context, next) => {
    void next();
    return { exitCode: 0 };
  }], async () => {
    await setImmediate();
    throw new Error("detached command failed");
  });
  await assert.rejects(run(context()), /await or return next/u);
  await setImmediate();
});
