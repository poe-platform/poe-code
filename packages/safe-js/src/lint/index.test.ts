import { describe, expect, it } from "vitest";

import { lint } from "./index.js";

describe("lint", () => {
  it.each(["\n", "\r\n", "\r"])("locates unknown directives after %j line endings", (newline) => {
    const source = `const value = 1;${newline}// @as-disable AS999${newline}return value;`;
    expect(lint(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "AS-UNKNOWN-DIRECTIVE", line: 2, column: 16 })
      ])
    );
  });
  it("returns AS001 diagnostics for disallowed syntax instead of throwing", () => {
    expect(() => lint("eval('7')", { filename: "rule.js" })).not.toThrow();
    expect(lint("eval('7')", { filename: "rule.js" })).toEqual([
      {
        code: "AS001",
        severity: "error",
        message: "Disallowed syntax: eval.",
        filename: "rule.js",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 }
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
        fix: {
          range: [0, source.indexOf("import { request }")],
          replacement: ""
        },
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
        fix: {
          range: [source.indexOf("import { request }"), source.length],
          replacement: ""
        },
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

  it("includes AS-UNBOUNDED-LOOP diagnostics", () => {
    const source = "while (true) { tick(); }";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-UNBOUNDED-LOOP");
  });

  it("includes AS-UNREACHABLE diagnostics after labeled breaks to enclosing loops", () => {
    const source =
      "outer: for (const value of values) { for (const item of value.items) { break outer; log(item); } }";
    const codes = lint(source).map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("AS001");
    expect(codes).toContain("AS-UNREACHABLE");
  });

  it("accepts a primitive await as a scheduling boundary", () => {
    const source = "await 1;";

    expect(lint(source)).toEqual([]);
  });

  it("includes AS-FLOATING-PROMISE diagnostics", () => {
    const source = ['import { spawn } from "agent";', "spawn();"].join("\n");

    expect(
      lint(source, {
        modules: {
          agent: {
            exports: {
              spawn: {
                async: true,
                type: "() => Promise<unknown>"
              }
            }
          }
        }
      }).map((diagnostic) => diagnostic.code)
    ).toContain("AS-FLOATING-PROMISE");
  });

  it("includes AS-ASYNC-NOT-NEEDED diagnostics", () => {
    const source = "const run = async () => 1;";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-ASYNC-NOT-NEEDED");
  });

  it("includes AS-SHADOW-GLOBAL diagnostics", () => {
    const source = 'const String = "x";';

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-SHADOW-GLOBAL");
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

  it("includes fix metadata on fixable diagnostics without applying fixes", () => {
    const source = "const value = `${x}`;";
    const [diagnostic] = lint(source).filter((entry) => entry.code === "AS-NEEDLESS-TEMPLATE");

    expect(diagnostic).toMatchObject({
      fix: {
        range: [source.indexOf("`"), source.lastIndexOf("`") + 1],
        replacement: "String(x)"
      }
    });
  });

  it("returns an idempotent fixed source when fix is enabled", () => {
    const source = 'const x = "ok"; const value = `${x}`; return value;';
    const first = lint(source, { fix: true });
    const second = lint(first.fixed, { fix: true });

    expect(first.fixed).toBe('const x = "ok"; const value = String(x); return value;');
    expect(first.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "AS-NEEDLESS-TEMPLATE"
    );
    expect(second.fixed).toBe(first.fixed);
    expect(second.diagnostics).toEqual([]);
  });

  it("applies disjoint fixes in the same lint pass", () => {
    const source = ["const value = `${x}`;", "const run = async () => 1;"].join("\n");
    const result = lint(source, { fix: true });

    expect(result.fixed).toBe(["const value = String(x);", "const run = () => 1;"].join("\n"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toEqual(
      expect.arrayContaining(["AS-NEEDLESS-TEMPLATE", "AS-ASYNC-NOT-NEEDED"])
    );
  });

  it("applies only the first overlapping fix and reports the remaining diagnostic", () => {
    const source = 'const x = "ok"; const value = `${`${x}`.trim()}`; return value;';
    const result = lint(source, { fix: true });

    expect(result.fixed).toBe('const x = "ok"; const value = String(`${x}`.trim()); return value;');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "AS-NEEDLESS-TEMPLATE",
          fix: expect.objectContaining({
            replacement: "String(x)"
          })
        })
      ])
    );
  });

  it("preserves a trailing newline when fixing away the only import line", () => {
    const result = lint('import { unused } from "api";\n', {
      fix: true,
      modules: {
        api: ["unused"]
      }
    });

    expect(result.fixed).toBe("\n");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "AS-UNUSED-IMPORT"
    );
  });

  it("fixes multiple unused specifiers from one import idempotently", () => {
    const source = 'import { a, b, c } from "api";\nreturn b;\n';
    const first = lint(source, {
      fix: true,
      modules: {
        api: ["a", "b", "c"]
      }
    });
    const second = lint(first.fixed, {
      fix: true,
      modules: {
        api: ["a", "b", "c"]
      }
    });

    expect(first.fixed).toBe('import { b } from "api";\nreturn b;\n');
    expect(first.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "AS-UNUSED-IMPORT"
    );
    expect(second.fixed).toBe(first.fixed);
  });

  it("includes AS-LARGE-LITERAL diagnostics", () => {
    const source = `const value = [${Array.from({ length: 11 }, (_, index) => index).join(", ")}];`;

    expect(
      lint(source, { largeLiteralThreshold: 10 }).map((diagnostic) => diagnostic.code)
    ).toContain("AS-LARGE-LITERAL");
  });

  it("includes AS-MUTATING-FROZEN diagnostics", () => {
    const source = "Object.freeze([1]).push(2);";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-MUTATING-FROZEN");
  });

  it("includes AS-DESTRUCTURE-NULL-DEFAULT diagnostics", () => {
    const source = "const { a = 1 } = { a: null };";

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain(
      "AS-DESTRUCTURE-NULL-DEFAULT"
    );
  });

  it("includes AS-JSDOC-TYPE diagnostics when typed modules opt in", () => {
    const source = "/** @type {string} */ const x = 1;";

    expect(
      lint(source, {
        filename: "rule.ajs",
        modules: {
          current: {
            exports: {
              default: "unknown"
            },
            filename: "rule.ajs",
            source
          }
        }
      }).map((diagnostic) => diagnostic.code)
    ).toContain("AS-JSDOC-TYPE");
  });

  it("suppresses the next statement with @as-disable", () => {
    const source = ["// @as-disable AS003", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS003");
  });

  it("treats a blank line after @as-disable as trivia before the next statement", () => {
    const source = ["// @as-disable AS003", "", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS003");
  });

  it("applies adjacent @as-disable directives to the same next statement", () => {
    const source = [
      "// @as-disable AS003",
      "// @as-disable AS012",
      "missing.replace('a', () => 'b');"
    ].join("\n");
    const codes = lint(source).map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("AS003");
    expect(codes).not.toContain("AS012");
  });

  it("suppresses same-line diagnostics with @as-disable-line", () => {
    const source = "missing; // @as-disable-line AS003";

    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS003");
  });

  it("applies @as-disable-line to an entire multi-line expression statement", () => {
    const source = ["message // @as-disable-line AS012", "  .replace('a', () => 'b');"].join("\n");

    expect(
      lint(source, { allowedGlobals: ["message"] }).map((diagnostic) => diagnostic.code)
    ).not.toContain("AS012");
  });

  it("does not suppress diagnostics after the next statement", () => {
    const source = ["// @as-disable AS003", "const ok = 1;", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS003");
  });

  it("suppresses file diagnostics with top-level @as-disable-file", () => {
    const source = ["/* @as-disable-file AS003 */", "missing;", "alsoMissing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS003");
  });

  it("ignores @as-disable-file after any non-whitespace top-of-file content", () => {
    const source = ["// leading comment", "/* @as-disable-file AS003 */", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS003");
  });

  it("reports unknown disable directive rule codes", () => {
    const source = ["// @as-disable ASXXX", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-UNKNOWN-DIRECTIVE");
  });

  it("reports code-like disable directive typos", () => {
    const source = ["// @as-disable ASxxx", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS-UNKNOWN-DIRECTIVE");
  });

  it("suppresses multiple rule codes from one directive", () => {
    const source = ["// @as-disable AS003 AS012", "missing.replace('a', () => 'b');"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toEqual(
      expect.arrayContaining(["AS003", "AS012"])
    );
  });

  it("parses directive codes before trailing message text", () => {
    const source = ["// @as-disable AS003 because of AS999", "missing;"].join("\n");
    const codes = lint(source).map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("AS003");
    expect(codes).not.toContain("AS-UNKNOWN-DIRECTIVE");
  });

  it("applies known directive codes and reports unknown codes from the same directive", () => {
    const source = ["// @as-disable AS003 AS999", "missing;"].join("\n");
    const codes = lint(source).map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("AS003");
    expect(codes).toContain("AS-UNKNOWN-DIRECTIVE");
  });

  it("does not report unused disable directives", () => {
    const source = ["// @as-disable AS003", "const ok = 1;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS-UNKNOWN-DIRECTIVE");
  });

  it("ignores non-file disable directives in block comments because only line comments are recognized", () => {
    const source = ["/* @as-disable AS003 */", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).toContain("AS003");
  });

  it("ignores @as-enable because enable directives are not supported", () => {
    const source = ["// @as-disable AS003", "// @as-enable AS003", "missing;"].join("\n");

    expect(lint(source).map((diagnostic) => diagnostic.code)).not.toContain("AS003");
  });
});
