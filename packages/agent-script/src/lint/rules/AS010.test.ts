import { describe, expect, it } from "vitest";

import { AS010 } from "./AS010.js";

describe("AS010", () => {
  it("reports a top-level let that stores a host call result and is never read", () => {
    const source = ['import { spawn } from "agent";', "let handle = spawn();"].join("\n");

    expect(AS010(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS010",
        severity: "warning",
        message: "Top-level let 'handle' stores a host call result but is never read again.",
        filename: "rule.js",
        line: 2,
        column: 5,
        span: {
          start: { line: 2, column: 5, offset: source.indexOf("handle") },
          end: { line: 2, column: 11, offset: source.indexOf("handle") + "handle".length }
        }
      }
    ]);
  });

  it("allows later reads, reassignments, and non-top-level lets", () => {
    const source = [
      'import { spawn } from "agent";',
      'import * as api from "api";',
      "let used = spawn();",
      "used;",
      "let reassigned = spawn();",
      "reassigned = other();",
      "let captured = spawn();",
      "const fn = () => captured;",
      "if (true) {",
      "  let nested = api.request();",
      "}"
    ].join("\n");

    expect(AS010(source, { filename: "rule.js" })).toEqual([]);
  });

  it("reports namespace and awaited host calls", () => {
    const source = [
      'import * as agent from "agent";',
      "let task = await agent.spawn();"
    ].join("\n");

    expect(AS010(source)).toEqual([
      {
        code: "AS010",
        severity: "warning",
        message: "Top-level let 'task' stores a host call result but is never read again.",
        filename: "<input>",
        line: 2,
        column: 5,
        span: {
          start: { line: 2, column: 5, offset: source.indexOf("task") },
          end: { line: 2, column: 9, offset: source.indexOf("task") + "task".length }
        }
      }
    ]);
  });

  it("skips bindings referenced later in the same declaration, through members, and inside closures", () => {
    const source = [
      'import { spawn } from "agent";',
      "let handle = spawn(), alias = handle;",
      "let member = spawn();",
      "member.status;",
      "let deferred = spawn();",
      "const readLater = () => deferred;"
    ].join("\n");

    expect(AS010(source, { filename: "rule.js" })).toEqual([]);
  });

  it("skips bindings reassigned through direct, destructuring, and for-of assignment targets", () => {
    const source = [
      'import { spawn } from "agent";',
      "let direct = spawn();",
      "direct = next;",
      "let objectTarget = spawn();",
      "({ objectTarget } = input);",
      "let iterator = spawn();",
      "for (iterator of items) {}"
    ].join("\n");

    expect(AS010(source, { filename: "rule.js" })).toEqual([]);
  });

  it("still reports when later references only target shadowing bindings", () => {
    const source = [
      'import { spawn } from "agent";',
      "let handle = spawn();",
      "const shadowed = (handle = fallback) => handle;"
    ].join("\n");

    expect(AS010(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS010",
        severity: "warning",
        message: "Top-level let 'handle' stores a host call result but is never read again.",
        filename: "rule.js",
        line: 2,
        column: 5,
        span: {
          start: { line: 2, column: 5, offset: source.indexOf("handle") },
          end: { line: 2, column: 11, offset: source.indexOf("handle") + "handle".length }
        }
      }
    ]);
  });
});
