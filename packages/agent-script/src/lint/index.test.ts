import { describe, expect, it } from "vitest";

import { lint } from "./index.js";

describe("lint", () => {
  it("returns AS001 diagnostics for disallowed syntax instead of throwing", () => {
    expect(() => lint("function example() {}", { filename: "rule.js" })).not.toThrow();
    expect(lint("function example() {}", { filename: "rule.js" })).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: function.",
        filename: "rule.js",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 9, offset: 8 }
        }
      }
    ]);
  });

  it("orders diagnostics by line, column, and code", () => {
    const source = ['import { missing } from "api";', 'import { request } from "htp";'].join("\n");

    expect(
      lint(source, {
        modules: {
          api: ["request"]
        }
      })
    ).toEqual([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'missing' is never referenced.",
        filename: "<input>",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("missing") },
          end: { line: 1, column: 17, offset: source.indexOf("missing") + "missing".length }
        }
      },
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'missing'. Available exports: request.",
        filename: "<input>",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("missing") },
          end: { line: 1, column: 17, offset: source.indexOf("missing") + "missing".length }
        }
      },
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'request' is never referenced.",
        filename: "<input>",
        line: 2,
        column: 10,
        span: {
          start: { line: 2, column: 10, offset: source.lastIndexOf("request") },
          end: { line: 2, column: 17, offset: source.lastIndexOf("request") + "request".length }
        }
      },
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: api.",
        filename: "<input>",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.lastIndexOf('"htp"') },
          end: { line: 2, column: 30, offset: source.lastIndexOf('"htp"') + '"htp"'.length }
        }
      }
    ]);
  });

  it("suppresses AS007 when AS010 reports the same unread host-call binding", () => {
    const source = ['import { spawn } from "agent";', "let handle = spawn();"].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: {
          agent: ["spawn"]
        }
      })
    ).toEqual([
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

  it("includes AS-UNREACHABLE diagnostics", () => {
    const source = "export default () => { return 1; 2; };";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-UNREACHABLE");
  });

  it("includes AS-UNREACHABLE diagnostics after labeled breaks to enclosing loops", () => {
    const source =
      "outer: for (const value of values) { for (const item of value.items) { break outer; log(item); } }";
    const codes = lint(source).map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("AS001");
    expect(codes).toContain("AS-UNREACHABLE");
  });

  it("includes AS-AWAIT-NON-PROMISE diagnostics", () => {
    const source = "await 1;";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-AWAIT-NON-PROMISE");
  });

  it("includes AS-ASYNC-NOT-NEEDED diagnostics", () => {
    const source = "const run = async () => 1;";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-ASYNC-NOT-NEEDED");
  });

  it("includes AS-MISSING-ASYNC diagnostics", () => {
    const source = "const run = () => await load();";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-MISSING-ASYNC");
    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS008");
  });

  it("includes AS-NEEDLESS-TEMPLATE diagnostics", () => {
    const source = "const value = `${x}`;";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-NEEDLESS-TEMPLATE");
  });
});
