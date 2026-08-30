import { describe, expect, it, vi } from "vitest";

import { parse, type ParseResult } from "../parse.js";
import { parseModule } from "../parse/parser.js";
import { emitResumeBreakpoint, type InterpreterYieldPoint } from "./async.js";
import { Budget } from "./budget.js";
import { interpret, type InterpreterValue } from "./interpreter.js";
import { createPromiseGlobals } from "./promise.js";
import { Scope } from "./scope.js";
import { createSandboxClosure, createSandboxPromise, type SandboxValue } from "./values.js";

describe("emitResumeBreakpoint", () => {
  it("emits a lazy snapshot for non-await breakpoints", () => {
    const scope = new Scope({ phase: "setup", iteration: 3 });
    const snapshotScope = vi.spyOn(scope, "snapshot");
    let kind: InterpreterYieldPoint["kind"] | undefined;
    let snapshot: ReturnType<InterpreterYieldPoint["snapshot"]> | undefined;

    emitResumeBreakpoint(
      {
        budget: new Budget(),
        callStack: [],
        onYield: (emittedYieldPoint) => {
          kind = emittedYieldPoint.kind;
          expect(snapshotScope).not.toHaveBeenCalled();
          snapshot = emittedYieldPoint.snapshot();
        },
        scope,
        stats: { nodeVisits: 0 }
      },
      {
        kind: "loop-iteration",
        nodeId: 42,
        span: {
          start: { line: 1, column: 0, offset: 0 },
          end: { line: 1, column: 1, offset: 1 }
        }
      }
    );

    expect(kind).toBe("loop-iteration");
    expect(snapshotScope).toHaveBeenCalledOnce();
    expect(snapshot).toEqual({
      bindings: { phase: "setup", iteration: 3 }
    });
  });
});

describe("async/await scheduling", () => {
  it.each([
    "return load();",
    "return (() => pending)();",
    "function loadSource() { return pending; } return loadSource();",
    "return new Load();"
  ])("preserves a promise returned synchronously: %s", async (source) => {
    const pending = createSandboxPromise(Promise.resolve("ready"));
    const result = await run(source, {
      pending,
      load: createSandboxClosure({ call: () => pending }),
      Load: createSandboxClosure({ call: () => undefined, construct: () => pending })
    });

    expect(result).toBe(pending);
    await expect(pending.promise).resolves.toBe("ready");
  });

  it("awaits non-promise values", async () => {
    await expect(run("return await 1")).resolves.toBe(1);
  });

  it("awaits resolved Promise values", async () => {
    await expect(run("return await Promise.resolve(1)")).resolves.toBe(1);
  });

  it("awaits async arrow results", async () => {
    await expect(run("return await (async () => 1)()")).resolves.toBe(1);
  });

  it("resumes parallel awaits in settlement order", async () => {
    const first = deferred("first");
    const second = deferred("second");

    await expect(
      run(
        [
          "let result;",
          "const order = [];",
          "const left = (async () => { order.push(await first); })();",
          "const right = (async () => { order.push(await second); })();",
          "await settleSecondThenFirst();",
          "await Promise.all([left, right]);",
          "result = order;"
        ].join("\n"),
        {
          first: first.promise,
          second: second.promise,
          settleSecondThenFirst: createSandboxClosure({
            async: true,
            call: () =>
              createSandboxPromise(
                Promise.resolve()
                  .then(() => {
                    second.resolve();
                  })
                  .then(() => {
                    first.resolve();
                  })
              ),
            name: "settleSecondThenFirst"
          })
        }
      )
    ).resolves.toEqual(["second", "first"]);
  });

  it("runs Promise.then reactions in FIFO microtask order", async () => {
    await expect(
      run(
        [
          "let result;",
          "const order = [];",
          'Promise.resolve().then(() => order.push("a"));',
          'Promise.resolve().then(() => order.push("b"));',
          "await Promise.resolve();",
          "await Promise.resolve();",
          "result = order;"
        ].join("\n")
      )
    ).resolves.toEqual(["a", "b"]);
  });

  it("lets an outer catch handle a rejected promise awaited inside try", async () => {
    await expect(
      run(
        [
          "let result;",
          "try {",
          "  try {",
          '    await Promise.reject("boom");',
          "  } finally {",
          "  }",
          "} catch (error) {",
          "  result = error;",
          "}"
        ].join("\n")
      )
    ).resolves.toBe("boom");
  });

  it("throws rejected Promise reasons at the await point", async () => {
    await expect(
      run(
        [
          "let result;",
          "const order = [];",
          "try {",
          '  order.push("before");',
          '  await Promise.reject("boom");',
          '  order.push("after");',
          "} catch (error) {",
          "  order.push(error);",
          "}",
          "result = order;"
        ].join("\n")
      )
    ).resolves.toEqual(["before", "boom"]);
  });

  it("yields to queued promise reactions for every await in a chain", async () => {
    await expect(
      run(
        [
          "let result;",
          "const order = [];",
          'Promise.resolve().then(() => order.push("before-first"));',
          "await 1;",
          'order.push("after-first");',
          'Promise.resolve().then(() => order.push("before-second"));',
          "await 2;",
          'order.push("after-second");',
          "result = order;"
        ].join("\n")
      )
    ).resolves.toEqual(["before-first", "after-first", "before-second", "after-second"]);
  });

  it("turns synchronous throws before the first async arrow await into rejections", async () => {
    await expect(
      run(
        'try { await (async () => { throw "boom"; await 1; })(); } catch (error) { return error; }'
      )
    ).resolves.toBe("boom");
  });

  it("unwraps one level when an async arrow returns a Promise", async () => {
    await expect(run("return await (async () => Promise.resolve(1))()")).resolves.toBe(1);
  });

  it("awaits thenables", async () => {
    await expect(run("return await ({ then: (resolve) => resolve(1) })")).resolves.toBe(1);
  });

  it("chains a promise resolved with another later-settling promise", async () => {
    const later = deferred("later");

    await expect(
      run(
        "let result; const promise = later(); const wrapped = wrap(promise); settle(); result = await wrapped;",
        {
          later: createSandboxClosure({
            async: true,
            call: () => later.promise,
            name: "later"
          }),
          settle: createSandboxClosure({
            call: () => {
              later.resolve();
              return undefined;
            },
            name: "settle"
          }),
          wrap: createSandboxClosure({
            async: true,
            call: ([value]) =>
              createSandboxPromise(
                new Promise<SandboxValue>((resolve) => {
                  resolve(value);
                })
              ),
            name: "wrap"
          })
        }
      )
    ).resolves.toBe("later");
  });
});

async function run(
  source: string,
  bindings: Record<string, InterpreterValue> = {}
): Promise<InterpreterValue> {
  const budget = new Budget();
  const result = await interpret(parseScript(source), {
    bindings: {
      ...createPromiseGlobals({ budget }),
      ...bindings
    },
    budget
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.returnValue ?? result.snapshot.bindings.result;
}

function parseScript(source: string): ParseResult {
  try {
    return parse(source);
  } catch {
    const module = parseModule(source);
    return {
      type: "BlockStatement",
      body: module.body,
      span: module.span
    };
  }
}

function deferred(value: SandboxValue): {
  promise: ReturnType<typeof createSandboxPromise>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = createSandboxPromise(
    new Promise<SandboxValue>((innerResolve) => {
      resolve = () => innerResolve(value);
    })
  );

  return {
    promise,
    resolve
  };
}
