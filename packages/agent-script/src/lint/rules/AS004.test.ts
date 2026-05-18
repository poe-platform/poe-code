import { describe, expect, it } from "vitest";

import { AS004 } from "./AS004.js";

describe("AS004", () => {
  const unknownModules = (
    source: string,
    modules: NonNullable<Parameters<typeof AS004>[1]>["modules"]
  ) => AS004(source, { modules }).map((diagnostic) => diagnostic.message.match(/'([^']+)'/)?.[1]);

  it("allows imports from registered modules", () => {
    const source = [
      'import value from "delay";',
      'import * as fs from "fs";',
      'import { readFile } from "fs";'
    ].join("\n");

    expect(
      AS004(source, {
        filename: "rule.js",
        modules: {
          delay: ["default"],
          fs: ["default", "readFile"]
        }
      })
    ).toEqual([]);
  });

  it("reports unknown import modules with the available module names", () => {
    const source = ['import { readFile } from "fs";', 'import { request } from "htp";'].join("\n");

    expect(
      AS004(source, {
        filename: "rule.js",
        modules: {
          api: ["request"],
          fs: ["readFile"]
        }
      })
    ).toEqual([
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: api, fs.",
        filename: "rule.js",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.lastIndexOf('"htp"') },
          end: { line: 2, column: 30, offset: source.lastIndexOf('"htp"') + '"htp"'.length }
        }
      }
    ]);
  });

  it("reports when no modules are registered", () => {
    const source = 'import { request } from "api";';

    expect(
      AS004(source, {
        modules: {}
      })
    ).toEqual([
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'api'. No modules are registered.",
        filename: "<input>",
        line: 1,
        column: 25,
        span: {
          start: { line: 1, column: 25, offset: source.indexOf('"api"') },
          end: { line: 1, column: 30, offset: source.indexOf('"api"') + '"api"'.length }
        }
      }
    ]);
  });

  it("accepts a Map and lists deduped sorted module names", () => {
    const source = 'import { request } from "htp";';

    expect(
      AS004(source, {
        modules: new Map([
          ["zeta", ["last"]],
          ["api", ["request"]],
          ["alpha", ["first"]],
          ["api", ["request"]]
        ])
      })
    ).toEqual([
      {
        code: "AS004",
        severity: "error",
        message: "Unknown module 'htp'. Available modules: alpha, api, zeta.",
        filename: "<input>",
        line: 1,
        column: 25,
        span: {
          start: { line: 1, column: 25, offset: source.indexOf('"htp"') },
          end: { line: 1, column: 30, offset: source.indexOf('"htp"') + '"htp"'.length }
        }
      }
    ]);
  });

  it("reports unknown modules at the start and end of a file", () => {
    const source = [
      'import { early } from "early";',
      "const value = 1;",
      'import { late } from "late";'
    ].join("\n");

    expect(unknownModules(source, { known: ["early"] })).toEqual(["early", "late"]);
  });

  it("ignores module-like text outside import declarations", () => {
    const source = [
      'const text = "import { request } from \\"missing\\"";',
      'const template = `import { request } from "also-missing"`;'
    ].join("\n");

    expect(AS004(source, { modules: {} })).toEqual([]);
  });

  it("keeps registered namespace and default imports valid while reporting later unknown imports", () => {
    const source = [
      'import value from "api";',
      'import * as tools from "tools";',
      'import { run } from "missing";'
    ].join("\n");

    expect(unknownModules(source, { api: ["default"], tools: ["run"] })).toEqual(["missing"]);
  });

  it("reports unknown default and namespace imports at opposite file boundaries", () => {
    const source = [
      'import first from "first";',
      "const value = 1;",
      'import * as last from "last";'
    ].join("\n");

    expect(unknownModules(source, { known: ["default"] })).toEqual(["first", "last"]);
  });

  it("accepts source-backed and typed module registrations as known modules", () => {
    const source = ['import { run } from "agent";', 'import { request } from "api";'].join("\n");

    expect(
      AS004(source, {
        modules: {
          agent: {
            exports: ["run"],
            filename: "/agents/agent.ajs",
            source: "export const run = () => 1;"
          },
          api: {
            exports: {
              request: "(url: string) => Promise<string>"
            }
          }
        }
      })
    ).toEqual([]);
  });

  it("ignores module-looking text inside default parameters and destructuring defaults", () => {
    const source = [
      "const run = (value = 'import value from \"missing\"') => value;",
      'const { value = `import { x } from "also-missing"` } = input;'
    ].join("\n");

    expect(AS004(source, { modules: {} })).toEqual([]);
  });
});
