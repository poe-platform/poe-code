import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { hashSource } from "../parse/hash.js";
import { restore } from "../restore.js";
import { run } from "../run.js";

const knownErrorNames = new Set([
  "AbortError",
  "Error",
  "HarnessFailure",
  "ParseError",
  "RangeError",
  "ReferenceError",
  "SandboxError",
  "SnapshotMismatchError",
  "SyntaxError",
  "TypeError",
  "AggregateError",
  "UnhandledRejectionError"
]);

type AuditedError = {
  cause?: unknown;
  message?: unknown;
  name?: unknown;
  span?: unknown;
  stack?: unknown;
};

describe("error shape audit", () => {
  it("passes for a parse error", async () => {
    const source = "return 'unterminated";
    const error = await captureError(run(source, { filename: "audit.ajs" }));

    auditErrorShape(error, { source, sourceBound: true });
  });

  it("passes for a runtime TypeError", async () => {
    const source = ["const value = 1;", "return value();"].join("\n");
    const error = await captureError(run(source, { filename: "audit.ajs" }));

    auditErrorShape(error, { source, sourceBound: true });
  });

  it("passes for a runtime ReferenceError", async () => {
    const source = "return missing;";
    const result = await run(source, { filename: "audit.ajs" });

    if (result.ok) {
      expect.unreachable("expected undeclared identifier to fail");
    }

    auditErrorShape(result.error, { source, sourceBound: true });
  });

  it("passes for a budget error and identifies the budget", async () => {
    const source = 'return "hello";';
    const error = await captureError(
      run(source, {
        budget: new Budget({ stringLength: 4 }),
        filename: "audit.ajs"
      })
    );

    auditErrorShape(error, { source, sourceBound: true });
    expect(readError(error).message).toContain("stringLength");
  });

  it("passes for a snapshot mismatch and mentions the expected and actual hash", () => {
    const snapshotSource = "return 1;";
    const currentSource = "return 2;";
    const snapshot = {
      version: 1,
      sourceHash: hashSource(snapshotSource)
    };

    try {
      restore(snapshot, { source: currentSource });
      expect.unreachable("expected snapshot mismatch");
    } catch (error) {
      auditErrorShape(error);
      expect(readError(error).message).toContain(snapshot.sourceHash);
      expect(readError(error).message).toContain(hashSource(currentSource));
    }
  });

  it("passes for a host call error and preserves the host cause", async () => {
    const source = "return load();";
    const cause = new Error("host boom");
    const error = await captureError(
      run(source, {
        bindings: {
          load() {
            throw cause;
          }
        },
        filename: "audit.ajs"
      })
    );

    auditErrorShape(error, { cause, source, sourceBound: true });
  });

  it("passes for a cancellation error and is recognizable as an abort", async () => {
    const controller = new AbortController();
    const source = "return wait();";
    controller.abort();

    const error = await captureError(
      run(source, {
        bindings: {
          wait() {
            return "missed";
          }
        },
        filename: "audit.ajs",
        signal: controller.signal
      })
    );

    auditErrorShape(error, { source, sourceBound: true });
    expect(readError(error).name).toBe("AbortError");
  });

  it("passes for an unhandled rejection and mentions the rejected value", async () => {
    const source = 'return Promise.reject("audit rejection");';
    const error = await captureError(run(source, { filename: "audit.ajs" }));

    auditErrorShape(error, { source, sourceBound: true });
    expect(readError(error).message).toContain("audit rejection");
  });

  it("passes for an uncaught thrown object", async () => {
    const source = "throw { code: 7 };";
    const error = await captureError(run(source, { filename: "audit.ajs" }));

    auditErrorShape(error, { source, sourceBound: true });
    expect(readError(error).name).toBe("Error");
    expect(readError(error).message).toContain('"code":7');
  });

  it("passes for an uncaught sandbox Error with an empty message", async () => {
    const source = "throw Error();";
    const error = await captureError(run(source, { filename: "audit.ajs" }));

    auditErrorShape(error, { source, sourceBound: true });
    expect(readError(error).message).toContain("Error");
  });

  it("passes for an uncaught sandbox Error with an object message", async () => {
    const source = "throw Error({ code: 7 });";
    const error = await captureError(run(source, { filename: "audit.ajs" }));

    auditErrorShape(error, { source, sourceBound: true });
    expect(readError(error).message).toContain("non-string");
  });

  it("normalizes custom sandbox error names to a known class when uncaught", async () => {
    const source = 'const error = Error("boom"); error.name = "CustomError"; throw error;';
    const error = await captureError(run(source, { filename: "audit.ajs" }));

    auditErrorShape(error, { source, sourceBound: true });
    expect(readError(error).name).toBe("Error");
  });
});

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  expect.unreachable("expected promise to reject");
}

function auditErrorShape(
  value: unknown,
  options: {
    cause?: unknown;
    source?: string;
    sourceBound?: boolean;
  } = {}
): void {
  const error = readError(value);

  expect(knownErrorNames.has(error.name)).toBe(true);
  expect(error.message.length).toBeGreaterThan(0);
  expect(error.message).not.toBe("[object Object]");
  expect(error.stack.length).toBeGreaterThan(0);
  expect(error.stack).not.toContain("/node_modules/");
  expect(error.stack).not.toContain("/packages/safejs/internal");
  expect(error.stack).not.toContain("/packages/safejs/src");
  expect(error.stack).not.toContain("/packages/safe-js/internal");
  expect(error.stack).not.toContain("/packages/safe-js/src");

  if (options.sourceBound === true) {
    expect(isValidSourceSpan(error.span, options.source ?? "")).toBe(true);
  }

  if (options.cause !== undefined) {
    expect(error.cause).toBe(options.cause);
  }
}

function readError(
  value: unknown
): Required<Pick<AuditedError, "message" | "name" | "stack">> &
  Pick<AuditedError, "cause" | "span"> {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();

  const error = value as AuditedError;
  expect(typeof error.name).toBe("string");
  expect(typeof error.message).toBe("string");
  expect(typeof error.stack).toBe("string");

  return error as Required<Pick<AuditedError, "message" | "name" | "stack">> &
    Pick<AuditedError, "cause" | "span">;
}

function isValidSourceSpan(span: unknown, source: string): boolean {
  if (typeof span !== "object" || span === null || !("start" in span) || !("end" in span)) {
    return false;
  }

  const sourceSpan = span as {
    end: { column?: unknown; line?: unknown; offset?: unknown };
    start: { column?: unknown; line?: unknown; offset?: unknown };
  };

  if (!isValidPosition(sourceSpan.start, source) || !isValidPosition(sourceSpan.end, source)) {
    return false;
  }

  return sourceSpan.start.offset <= sourceSpan.end.offset;
}

function isValidPosition(
  position: { column?: unknown; line?: unknown; offset?: unknown },
  source: string
): position is { column: number; line: number; offset: number } {
  if (
    typeof position.line !== "number" ||
    typeof position.column !== "number" ||
    typeof position.offset !== "number" ||
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.column) ||
    !Number.isInteger(position.offset) ||
    position.line < 1 ||
    position.column < 1 ||
    position.offset < 0 ||
    position.offset > source.length
  ) {
    return false;
  }

  return sourceOffsetFor(position.line, position.column, source) === position.offset;
}

function sourceOffsetFor(line: number, column: number, source: string): number | undefined {
  let currentLine = 1;
  let currentColumn = 1;

  for (let offset = 0; offset <= source.length; offset += 1) {
    if (currentLine === line && currentColumn === column) {
      return offset;
    }

    const character = source[offset];
    if (character === undefined) {
      return undefined;
    }

    if (character === "\n") {
      currentLine += 1;
      currentColumn = 1;
    } else {
      currentColumn += 1;
    }
  }

  return undefined;
}
