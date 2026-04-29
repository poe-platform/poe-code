import { describe, expect, it } from "vitest";

import { AS013 } from "./AS013.js";

describe("AS013", () => {
  it("reports top-level const and let bindings that shadow registered module names", () => {
    const source = [
      "const agent = createAgent();",
      "let git = repo;",
      "const { mcp, safe } = config;",
      "const [harness, other] = values;"
    ].join("\n");

    expect(
      AS013(source, {
        filename: "rule.js",
        modules: {
          agent: ["run"],
          git: ["status"],
          harness: ["wait"],
          mcp: ["call"]
        }
      })
    ).toEqual([
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'agent' shadows registered module 'agent'.",
        filename: "rule.js",
        line: 1,
        column: 7,
        span: {
          start: { line: 1, column: 7, offset: source.indexOf("agent") },
          end: { line: 1, column: 12, offset: source.indexOf("agent") + "agent".length }
        }
      },
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'git' shadows registered module 'git'.",
        filename: "rule.js",
        line: 2,
        column: 5,
        span: {
          start: { line: 2, column: 5, offset: source.indexOf("git") },
          end: { line: 2, column: 8, offset: source.indexOf("git") + "git".length }
        }
      },
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'mcp' shadows registered module 'mcp'.",
        filename: "rule.js",
        line: 3,
        column: 9,
        span: {
          start: { line: 3, column: 9, offset: source.indexOf("mcp") },
          end: { line: 3, column: 12, offset: source.indexOf("mcp") + "mcp".length }
        }
      },
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'harness' shadows registered module 'harness'.",
        filename: "rule.js",
        line: 4,
        column: 8,
        span: {
          start: { line: 4, column: 8, offset: source.indexOf("harness") },
          end: { line: 4, column: 15, offset: source.indexOf("harness") + "harness".length }
        }
      }
    ]);
  });

  it("reports every shadowing binding inside top-level declarators", () => {
    const source = [
      "const safe = value, agent = createAgent();",
      "let { nested: { git }, mcp = connect(), ...rest } = config;",
      "const [{ harness }] = values;"
    ].join("\n");

    expect(
      AS013(source, {
        filename: "rule.js",
        modules: {
          agent: ["run"],
          git: ["status"],
          harness: ["wait"],
          mcp: ["call"]
        }
      })
    ).toEqual([
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'agent' shadows registered module 'agent'.",
        filename: "rule.js",
        line: 1,
        column: 21,
        span: {
          start: { line: 1, column: 21, offset: source.indexOf("agent =") },
          end: { line: 1, column: 26, offset: source.indexOf("agent =") + "agent".length }
        }
      },
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'git' shadows registered module 'git'.",
        filename: "rule.js",
        line: 2,
        column: 17,
        span: {
          start: { line: 2, column: 17, offset: source.indexOf("git") },
          end: { line: 2, column: 20, offset: source.indexOf("git") + "git".length }
        }
      },
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'mcp' shadows registered module 'mcp'.",
        filename: "rule.js",
        line: 2,
        column: 24,
        span: {
          start: { line: 2, column: 24, offset: source.indexOf("mcp") },
          end: { line: 2, column: 27, offset: source.indexOf("mcp") + "mcp".length }
        }
      },
      {
        code: "AS013",
        severity: "error",
        message: "Top-level binding 'harness' shadows registered module 'harness'.",
        filename: "rule.js",
        line: 3,
        column: 10,
        span: {
          start: { line: 3, column: 10, offset: source.indexOf("harness") },
          end: { line: 3, column: 17, offset: source.indexOf("harness") + "harness".length }
        }
      }
    ]);
  });

  it("ignores nested bindings, aliases, and unregistered names", () => {
    const source = [
      "const safe = value;",
      "const { agent: alias } = config;",
      "const { git: renamed = fallback, ...rest } = config;",
      "const { nested: { harness: runner } } = config;",
      "if (ready) {",
      "  const agent = value;",
      "}",
      "const fn = (git) => git;"
    ].join("\n");

    expect(
      AS013(source, {
        modules: new Map([
          ["agent", ["run"]],
          ["git", ["status"]]
        ])
      })
    ).toEqual([]);
  });

  it("returns no diagnostics when no modules are registered", () => {
    expect(AS013("const agent = value;", { modules: {} })).toEqual([]);
  });
});
