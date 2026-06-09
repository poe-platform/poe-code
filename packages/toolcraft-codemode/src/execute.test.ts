import { describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";

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

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
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
    const result = await runExecute("function nope() { return 1; }");

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

    await withObjectPrototypeCode("EACCES", async () => {
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
