import { describe, expect, it } from "vitest";

import { hostErrorData } from "../error/shape.js";
import { parse } from "../parse.js";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { interpret } from "./interpreter.js";
import { createSandboxClosure } from "./values.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

const propagationPaths = [
  ["direct", "throw reason;"],
  ["function", "(() => { throw reason; })();"],
  ["async", "await (async () => { await 0; throw reason; })();"],
  ["rejection", "await Promise.reject(reason);"],
  ["thenable", "await { then(resolve, reject) { reject(reason); } };"],
  ["rethrow", "try { await Promise.reject(reason); } catch (inner) { throw inner; }"],
  ["callback", "[1].map(() => { throw reason; });"],
  ["constructor", "new (function Failure() { throw reason; })();"],
  ["default", "((value = (() => { throw reason; })()) => value)();"],
  [
    "generator",
    "function* fail() { yield 1; throw reason; } const iterator = fail(); iterator.next(); iterator.next();"
  ]
] as const;

describe("source exception value controls", () => {
  describe.each([
    [
      "ordinary record",
      '{ name: "DomainFailure", message: "retry", code: "RETRY", retryable: true, context: { job: "alpha" } }'
    ],
    ["plain object", '{ code: "RETRY", retryable: true, context: { job: "alpha" } }'],
    ["Error", 'Error("retry")'],
    ["string", '"retry"'],
    ["number", "42"],
    ["null", "null"],
    ["undefined", "undefined"]
  ])("%s", (_name, initializer) => {
    it.each(propagationPaths)("preserves %s propagation", async (_path, operation) => {
      const source = `
        const reason = ${initializer};
        if (reason && typeof reason === "object") {
          reason.context = { job: "alpha", attempts: [] };
        }
        let caught;
        try { ${operation} } catch (error) { caught = error; }
        if (caught && typeof caught === "object") {
          if (caught.context) caught.context.attempts.push("recovered");
          return {
            same: caught === reason,
            code: caught.code,
            retryable: caught.retryable,
            contextSame: caught.context === reason.context,
            original: reason.context,
            caught: caught.context,
            errorInstance: caught instanceof Error
          };
        }
        return { same: caught === reason, caught };
      `;
      const expected = await new AsyncFunction(source)();

      expect(expected.same).toBe(true);
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    });
  });
});

describe("exception boundaries remain intentional", () => {
  it.each([false, true])(
    "converts host Error and copies registered metadata (async=%s)",
    async (asynchronous) => {
      const failure = new TypeError("host failure");
      const detail = { attempts: [] as string[] };
      hostErrorData.set(failure, { code: "HOST", detail });
      const fail = () => {
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      };
      const result = await run(
        `
      try { await fail(); } catch (error) {
        error.detail.attempts.push("caught");
        return [error.name, error.message, error.code, error.detail.attempts, error instanceof TypeError];
      }
    `,
        { bindings: { fail } }
      );

      expect(result).toMatchObject({
        ok: true,
        returnValue: ["TypeError", "host failure", "HOST", ["caught"], true]
      });
      expect(detail.attempts).toEqual([]);
    }
  );

  it.each([false, true])(
    "normalizes host ordinary thrown records (async=%s)",
    async (asynchronous) => {
      const failure = { name: "DomainFailure", message: "retry", code: "RETRY" };
      const fail = () => {
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      };

      await expect(
        run(
          "try { await fail(); } catch (error) { return [error.name, error.message, error.code, error instanceof Error]; }",
          { bindings: { fail } }
        )
      ).resolves.toMatchObject({
        ok: true,
        returnValue: ["Error", "retry", undefined, true]
      });
    }
  );

  it("keeps host input/output copies separate from source aliases", async () => {
    const original = {
      name: "DomainFailure",
      message: "retry",
      context: { attempts: [] as string[] }
    };
    const result = await run(
      `
      const received = await load();
      let same = false;
      try { await Promise.reject(received); } catch (error) {
        same = error === received;
        if (error.context) error.context.attempts.push("caught");
      }
      return { same, attempts: received.context.attempts };
    `,
      { bindings: { load: async () => original } }
    );

    expect(result).toMatchObject({ ok: true, returnValue: { same: true, attempts: ["caught"] } });
    expect(original.context.attempts).toEqual([]);
  });

  it.each([false, true])(
    "keeps low-level untrusted closure exception copies (async=%s)",
    async (asynchronous) => {
      const reason = { context: { attempts: [] as string[] } };
      const result = await interpret(
        parse(
          "try { fail(); } catch (error) { error.context.attempts[0] = 'caught'; return error; }"
        ),
        {
          budget: new Budget(),
          bindings: {
            fail: createSandboxClosure({
              call: () => {
                if (asynchronous) return Promise.reject(reason);
                throw reason;
              }
            })
          }
        }
      );

      expect(result).toMatchObject({
        ok: true,
        returnValue: { context: { attempts: ["caught"] } }
      });
      if (result.ok) expect(result.returnValue).not.toBe(reason);
      expect(reason.context.attempts).toEqual([]);
    }
  );

  it.each([
    ['throw "retry";', "Error", "retry"],
    ["throw 42;", "Error", "42"],
    ['throw { name: "DomainFailure", message: "retry", code: "RETRY" };', "Error", "retry"],
    [
      'await (async () => { throw { name: "DomainFailure", message: "retry", code: "RETRY" }; })();',
      "Error",
      "retry"
    ],
    ['throw Error("retry");', "Error", "retry"],
    ['throw { code: "RETRY" };', "Error", '{"code":"RETRY"}']
  ])(
    "rejects unhandled source errors at the public boundary: %s",
    async (source, name, message) => {
      await expect(run(source)).rejects.toMatchObject({
        name,
        message,
        stack: expect.any(String),
        span: expect.any(Object)
      });
    }
  );

  it("retains the ok:false interpreter diagnostic envelope", async () => {
    await expect(run("return missing;")).resolves.toMatchObject({
      ok: false,
      error: { code: "UNBOUND_IDENTIFIER", name: "ReferenceError" }
    });
  });
});
