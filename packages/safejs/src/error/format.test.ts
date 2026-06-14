import { describe, expect, it } from "vitest";

import { SandboxError } from "../interp/budget.js";
import { formatParseError } from "../parse/format-error.js";
import { formatInterpreterError } from "./format.js";

function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => T
): T {
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
    return callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("formatInterpreterError", () => {
  it("renders a parser syntax error with a source excerpt and aligned caret", () => {
    const source = ["const alpha = 1;", "const beta = );", "const gamma = 3;"].join("\n");
    const diagnostic = formatParseError(
      source,
      "script.ajs",
      new Error("Unexpected token ')' at line 2, column 14.")
    );

    const formatted = formatInterpreterError(diagnostic);

    expect(formatted).toBe(
      [
        "ParseError: script.ajs:2:14",
        "",
        "1 | const alpha = 1;",
        "2 | const beta = );",
        "3 | const gamma = 3;",
        "  |              ^",
        "",
        "Unexpected token ')' at line 2, column 14."
      ].join("\n")
    );
    const [, , , sourceLine, , caretLine] = formatted.split("\n");
    expect(caretLine?.indexOf("^")).toBe(sourceLine?.indexOf(")"));
  });

  it("renders a runtime error with a sandbox-only stack", () => {
    expect(
      formatInterpreterError({
        name: "TypeError",
        message: "boom",
        stack: [
          "TypeError: boom",
          "    at explode (line 4, column 3)",
          "    at main (line 8, column 1)",
          "    at hostFrame (/Users/kjopek/Workspace/poe-code/packages/safejs/src/run.ts:1:1)"
        ].join("\n")
      })
    ).toBe(
      [
        "TypeError: boom",
        "    at explode (line 4, column 3)",
        "    at main (line 8, column 1)"
      ].join("\n")
    );
  });

  it("renders a budget-exceeded error with the limit that fired", () => {
    expect(
      formatInterpreterError(
        new SandboxError({
          budget: "steps",
          current: 101,
          limit: 100
        })
      )
    ).toBe(
      [
        "SandboxError: Sandbox budget exceeded for steps: 101 > 100.",
        "",
        "Budget exceeded: steps (101 > 100)"
      ].join("\n")
    );
  });

  it("renders a thrown-from-sandbox non-error value with a JSON-ish representation", () => {
    expect(
      formatInterpreterError({
        code: "failed",
        nested: {
          value: 1
        }
      })
    ).toBe('Thrown value: {"code":"failed","nested":{"value":1}}');
  });

  it("does not crash when thrown non-error value cannot be stringified", () => {
    expect(
      formatInterpreterError({
        toJSON() {
          throw new Error("toJSON failed");
        },
        toString() {
          throw new Error("toString failed");
        }
      })
    ).toBe("Thrown value: [Unserializable thrown value]");
  });

  it("renders every error in a three-deep cause chain", () => {
    const error = new Error("top", {
      cause: new TypeError("middle", {
        cause: new RangeError("bottom")
      })
    });

    expect(formatInterpreterError(error)).toBe(
      ["Error: top", "", "Caused by: TypeError: middle", "Caused by: RangeError: bottom"].join("\n")
    );
  });

  it("ignores inherited causes when rendering cause chains", () => {
    withObjectPrototypeProperties({ cause: new Error("polluted") }, () => {
      expect(formatInterpreterError(new Error("top"))).toBe("Error: top");
    });
  });

  it("wraps an error from a host call with the host call name", () => {
    expect(formatInterpreterError(new Error("ECONNRESET"), { hostCallName: "loadProfile" })).toBe(
      "Host call loadProfile failed: Error: ECONNRESET"
    );
  });

  it("falls back to the plain message when source is not provided", () => {
    expect(
      formatInterpreterError({
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'missing' is not defined.",
        nodeType: "Identifier",
        span: {
          start: { line: 3, column: 8, offset: 32 },
          end: { line: 3, column: 15, offset: 39 }
        }
      })
    ).toBe("Identifier 'missing' is not defined.");
  });

  it("truncates very long error messages with an explicit suffix", () => {
    const formatted = formatInterpreterError(new Error("x".repeat(10_025)));

    expect(formatted).toHaveLength("Error: ".length + 10_000 + "... [truncated 25 chars]".length);
    expect(formatted.startsWith("Error: xxx")).toBe(true);
    expect(formatted.endsWith("... [truncated 25 chars]")).toBe(true);
  });
});
