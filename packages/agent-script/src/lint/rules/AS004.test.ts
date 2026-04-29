import { describe, expect, it } from "vitest";

import { AS004 } from "./AS004.js";

describe("AS004", () => {
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
    const source = [
      'import { readFile } from "fs";',
      'import { request } from "htp";'
    ].join("\n");

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
});
