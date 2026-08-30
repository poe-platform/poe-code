import { describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S, toJsonSchema } from "toolcraft-schema";

import { makeExecuteCommand } from "./execute.js";

function fixtureRoot(overrides: { fail?: () => Promise<unknown> } = {}) {
  return defineGroup({
    name: "math_tools",
    children: [
      defineCommand({
        name: "add",
        scope: ["sdk"],
        params: S.Object({
          left: S.Number(),
          right: S.Number()
        }),
        handler: async ({ params }) => params.left + params.right
      }),
      defineCommand({
        name: "multiply",
        scope: ["sdk"],
        params: S.Object({
          left: S.Number(),
          right: S.Number()
        }),
        handler: async ({ params }) => params.left * params.right
      }),
      defineCommand({
        name: "fail",
        scope: ["sdk"],
        params: S.Object({}),
        handler: overrides.fail ?? (async () => null)
      })
    ]
  });
}

async function runExecute(
  source: string,
  options: {
    budget?: {
      maxSteps?: number;
    };
    fail?: () => Promise<unknown>;
  } = {}
) {
  const root = fixtureRoot({
    fail: options.fail
  });
  const command = makeExecuteCommand({
    root,
    sdk: createSDK(root),
    ...(options.budget ? { budget: options.budget } : {})
  });

  return command.handler({ params: { source } } as never);
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(Object.prototype, key, descriptor);
      } else {
        delete (Object.prototype as Record<string, unknown>)[key];
      }
    }
  }
}

describe("makeExecuteCommand", () => {
  it("returns a value computed from two host calls", async () => {
    const result = await runExecute(
      [
        'import { add, multiply } from "math_tools";',
        "const sum = await add({ left: 2, right: 3 });",
        "return await multiply({ left: sum, right: 4 });"
      ].join("\n")
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: 20,
      stats: {
        nodeVisits: expect.any(Number)
      }
    });
  });

  it("returns lint diagnostics instead of throwing on lint failure", async () => {
    const result = await runExecute("eval('1');");

    expect(result).toMatchObject({
      ok: false,
      kind: "lint",
      diagnostics: [
        expect.objectContaining({
          code: "AS001",
          severity: "error",
          filename: "<execute>"
        })
      ]
    });
  });

  it("accepts ordinary functions with invocation-local arguments", async () => {
    const result = await runExecute(
      "function read(value) { arguments[0] += 1; return [value, arguments[0]]; } return read(5);"
    );

    expect(result).toMatchObject({ ok: true, returnValue: [5, 6] });
  });

  it("advertises and rejects empty source", async () => {
    const root = fixtureRoot();
    const command = makeExecuteCommand({
      root,
      sdk: createSDK(root)
    });

    expect(toJsonSchema(command.params)).toMatchObject({
      properties: {
        source: {
          minLength: 1,
          pattern: "\\S"
        }
      }
    });

    await expect(command.handler({ params: { source: "" } } as never)).rejects.toThrow(
      "source must not be empty or whitespace"
    );
    await expect(command.handler({ params: { source: "   " } } as never)).rejects.toThrow(
      "source must not be empty or whitespace"
    );
  });

  it("returns lint diagnostics instead of rejecting malformed source", async () => {
    const result = await runExecute("return (");

    expect(result).toMatchObject({
      ok: false,
      kind: "lint",
      diagnostics: [
        expect.objectContaining({
          code: "AS001",
          severity: "error",
          filename: "<execute>"
        })
      ]
    });
  });

  it("returns runtime errors from host call failures", async () => {
    const fail = vi.fn(async () => {
      throw new Error("host exploded");
    });
    const result = await runExecute(
      ['import { fail } from "math_tools";', "return await fail({});"].join("\n"),
      { fail }
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "runtime",
      error: {
        message: "host exploded",
        stack: expect.any(String)
      }
    });
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("does not report inherited runtime error codes", async () => {
    const fail = vi.fn(async () => {
      throw new Error("host exploded");
    });

    await withObjectPrototypeProperties({ code: "EACCES" }, async () => {
      const result = await runExecute(
        ['import { fail } from "math_tools";', "return await fail({});"].join("\n"),
        { fail }
      );

      expect(result).toMatchObject({
        ok: false,
        kind: "runtime",
        error: {
          message: "host exploded",
          code: undefined
        }
      });
    });
  });

  it("does not report inherited runtime error message or stack", async () => {
    const actualSafeJS =
      await vi.importActual<typeof import("@poe-code/safe-js/core")>("@poe-code/safe-js/core");
    vi.resetModules();
    vi.doMock("@poe-code/safe-js/core", () => ({
      ...actualSafeJS,
      run: vi.fn(async () => {
        throw {};
      })
    }));

    try {
      const { makeExecuteCommand: makeMockedExecuteCommand } = await import("./execute.js");
      const root = fixtureRoot();
      const command = makeMockedExecuteCommand({
        root,
        sdk: createSDK(root)
      });

      await withObjectPrototypeProperties(
        { message: "polluted message", stack: "polluted stack" },
        async () => {
          const result = await command.handler({
            params: { source: "return 1;" }
          } as never);

          expect(result).toMatchObject({
            ok: false,
            kind: "runtime",
            error: {
              message: "[object Object]",
              stack: undefined
            }
          });
        }
      );
    } finally {
      vi.doUnmock("@poe-code/safe-js/core");
      vi.resetModules();
    }
  });

  it("returns a runtime budget error when maxSteps is exceeded", async () => {
    const result = await runExecute("while (true) {}", {
      budget: {
        maxSteps: 1
      }
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "runtime",
      error: {
        code: "budgetExceeded"
      }
    });
  });
});
