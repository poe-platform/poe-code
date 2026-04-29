import { describe, expect, it } from "vitest";

import { Budget } from "../budget.js";
import { createSandboxClosure, type SandboxClosure, type SandboxObject } from "../values.js";
import { createErrorGlobals } from "./error.js";

describe("createErrorGlobals", () => {
  it("creates subset error values with name, message, and sandbox-only stack", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });
    const error = getClosure(globals.Error);

    expect(
      error.call(["boom"], {
        stack: ["    at Error (script:1:1)"]
      })
    ).toEqual({
      message: "boom",
      name: "Error",
      stack: "Error: boom\n    at Error (script:1:1)"
    });
  });

  it("coerces non-string messages and defaults missing messages to the empty string", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });

    expect(getClosure(globals.TypeError).call([42], { stack: [] })).toEqual({
      message: "42",
      name: "TypeError",
      stack: "TypeError: 42"
    });
    expect(getClosure(globals.Error).call([], { stack: [] })).toEqual({
      message: "",
      name: "Error",
      stack: "Error"
    });
    expect(getClosure(globals.Error).call(["boom"])).toEqual({
      message: "boom",
      name: "Error",
      stack: "Error: boom"
    });
  });

  it("never includes host stack frames in produced stacks", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });
    const wrap = createSandboxClosure({
      name: "wrap",
      call: async (args, context) => getClosure(globals.Error).call(args, context)
    });

    const result = (await wrap.call(["nested"], {
      stack: ["    at wrap (script:2:1)"]
    })) as SandboxObject;

    expect(result.stack).toBe("Error: nested\n    at wrap (script:2:1)");
    expect(String(result.stack)).not.toContain("error.test.ts");
  });

  it("orders nested sandbox frames from innermost to outermost", async () => {
    const globals = createErrorGlobals({
      budget: new Budget()
    });

    expect(
      getClosure(globals.TypeError).call(["boom"], {
        stack: [
          "    at outer (line 1, column 1)",
          "    at inner (line 2, column 3)",
          "    at TypeError (line 3, column 5)"
        ]
      })
    ).toEqual({
      message: "boom",
      name: "TypeError",
      stack: [
        "TypeError: boom",
        "    at TypeError (line 3, column 5)",
        "    at inner (line 2, column 3)",
        "    at outer (line 1, column 1)"
      ].join("\n")
    });
  });

  it("applies the string budget to message and stack strings", async () => {
    const globals = createErrorGlobals({
      budget: new Budget({
        stringLength: 8
      })
    });

    expect(() => getClosure(globals.Error).call(["toolong"], { stack: [] })).toThrowError(
      expect.objectContaining({
        budget: "stringLength",
        current: 14,
        limit: 8
      })
    );
  });
});

function getClosure(value: unknown): SandboxClosure {
  return value as SandboxClosure;
}
