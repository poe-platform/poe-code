import { describe, expect, it } from "vitest";

import * as api from "./index.js";
import { dump } from "./dump.js";
import { lint } from "./lint.js";
import { parse } from "./parse.js";
import { hashSource } from "./parse/hash.js";
import { restore } from "./restore.js";
import { run } from "./run.js";

describe("@poe-code/agent-script public exports", () => {
  it("re-exports the placeholder entrypoints", () => {
    expect(api.parse).toBe(parse);
    expect(api.lint).toBe(lint);
    expect(api.run).toBe(run);
    expect(api.dump).toBe(dump);
    expect(api.restore).toBe(restore);
    expect(Object.keys(api).sort()).toEqual(["dump", "lint", "parse", "restore", "run"]);
  });

  it("keeps unimplemented entrypoints explicit while validating restore hashes", () => {
    expect(api.parse("1")).toEqual({
      type: "NumericLiteral",
      raw: "1",
      value: 1,
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 2, offset: 1 }
      }
    });
    expect(
      api.lint('import { missing } from "htp";', {
        filename: "rule.js",
        modules: {
          api: ["request"],
          fs: ["readFile"]
        }
      })
    ).toEqual([
      {
        code: "AS006",
        severity: "warning",
        message: "Import 'missing' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: 9 },
          end: { line: 1, column: 17, offset: 16 }
        }
      },
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: api, fs.",
        filename: "rule.js",
        line: 1,
        column: 25,
        span: {
          start: { line: 1, column: 25, offset: 24 },
          end: { line: 1, column: 30, offset: 29 }
        }
      }
    ]);
    expect(() => api.run()).toThrowError("Not implemented");
    expect(() => api.dump()).toThrowError("Not implemented");
    expect(
      api.restore(
        {
          sourceHash: hashSource("1")
        },
        { source: "1" }
      )
    ).toEqual({
      sourceHash: hashSource("1")
    });
  });

  it("includes import module and export diagnostics in lint results", () => {
    const source = [
      'import { missing } from "api";',
      'import { request } from "htp";'
    ].join("\n");

    expect(
      lint(source, {
        modules: {
          api: ["request"]
        }
      })
    ).toEqual([
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
        code: "AS006",
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
        code: "AS006",
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

  it("accepts the lint modules Map API and sorts diagnostics by source position", () => {
    const source = [
      'import value from "api";',
      'import { request } from "htp";',
      'import { missing } from "api";'
    ].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: new Map([
          ["zeta", ["last"]],
          ["api", ["request", "request"]]
        ])
      })
    ).toEqual([
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'default'. Available exports: request.",
        filename: "rule.js",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: source.indexOf("value") },
          end: { line: 1, column: 13, offset: source.indexOf("value") + "value".length }
        }
      },
      {
        code: "AS006",
        severity: "warning",
        message: "Import 'value' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: source.indexOf("value") },
          end: { line: 1, column: 13, offset: source.indexOf("value") + "value".length }
        }
      },
      {
        code: "AS006",
        severity: "warning",
        message: "Import 'request' is never referenced.",
        filename: "rule.js",
        line: 2,
        column: 10,
        span: {
          start: { line: 2, column: 10, offset: source.indexOf("request") },
          end: { line: 2, column: 17, offset: source.indexOf("request") + "request".length }
        }
      },
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: api, zeta.",
        filename: "rule.js",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.indexOf('"htp"') },
          end: { line: 2, column: 30, offset: source.indexOf('"htp"') + '"htp"'.length }
        }
      },
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'missing'. Available exports: request.",
        filename: "rule.js",
        line: 3,
        column: 10,
        span: {
          start: { line: 3, column: 10, offset: source.lastIndexOf("missing") },
          end: { line: 3, column: 17, offset: source.lastIndexOf("missing") + "missing".length }
        }
      },
      {
        code: "AS006",
        severity: "warning",
        message: "Import 'missing' is never referenced.",
        filename: "rule.js",
        line: 3,
        column: 10,
        span: {
          start: { line: 3, column: 10, offset: source.lastIndexOf("missing") },
          end: { line: 3, column: 17, offset: source.lastIndexOf("missing") + "missing".length }
        }
      }
    ]);
  });

  it("includes unused import and binding warnings in lint results", () => {
    const source = ['import { used, unused } from "api";', "const value = used(1);", "let stale = 0;"].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: {
          api: ["used", "unused"]
        }
      })
    ).toEqual([
      {
        code: "AS006",
        severity: "warning",
        message: "Import 'unused' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf("unused") },
          end: { line: 1, column: 22, offset: source.indexOf("unused") + "unused".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'value' is declared but never read.",
        filename: "rule.js",
        line: 2,
        column: 7,
        span: {
          start: { line: 2, column: 7, offset: source.indexOf("value") },
          end: { line: 2, column: 12, offset: source.indexOf("value") + "value".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'stale' is declared but never read.",
        filename: "rule.js",
        line: 3,
        column: 5,
        span: {
          start: { line: 3, column: 5, offset: source.indexOf("stale") },
          end: { line: 3, column: 10, offset: source.indexOf("stale") + "stale".length }
        }
      }
    ]);
  });

  it("includes async host promise return diagnostics in lint results", () => {
    const source = ['import { spawn } from "agent";', "const run = async () => spawn();", "run;"].join("\n");

    expect(
      lint(source, {
        filename: "rule.js",
        modules: {
          agent: ["spawn"]
        }
      })
    ).toEqual([
      {
        code: "AS009",
        severity: "error",
        message:
          "Async arrow returns a host call without awaiting it. Add 'await' or document that this function intentionally returns a Promise.",
        filename: "rule.js",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.indexOf("spawn()") },
          end: { line: 2, column: 32, offset: source.indexOf("spawn()") + "spawn()".length }
        }
      }
    ]);
  });
});
