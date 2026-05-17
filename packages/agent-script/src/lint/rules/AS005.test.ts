import { describe, expect, it } from "vitest";

import { AS005 } from "./AS005.js";

describe("AS005", () => {
  it("allows imports of exported names from registered modules", () => {
    const source = [
      'import value from "delay";',
      'import * as api from "api";',
      'import { request, fetch as load } from "api";'
    ].join("\n");

    expect(
      AS005(source, {
        filename: "rule.js",
        modules: {
          api: ["fetch", "request"],
          delay: ["default"]
        }
      })
    ).toEqual([]);
  });

  it("reports unknown named imports with the available exports", () => {
    const source = 'import { request, missing as load } from "api";';

    expect(
      AS005(source, {
        filename: "rule.js",
        modules: {
          api: ["fetch", "request"]
        }
      })
    ).toEqual([
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'missing'. Available exports: fetch, request.",
        filename: "rule.js",
        line: 1,
        column: 19,
        span: {
          start: { line: 1, column: 19, offset: source.indexOf("missing") },
          end: { line: 1, column: 26, offset: source.indexOf("missing") + "missing".length }
        }
      }
    ]);
  });

  it("reports default imports when the module has no default export", () => {
    const source = 'import value from "api";';

    expect(
      AS005(source, {
        modules: {
          api: ["request"]
        }
      })
    ).toEqual([
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'default'. Available exports: request.",
        filename: "<input>",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: source.indexOf("value") },
          end: { line: 1, column: 13, offset: source.indexOf("value") + "value".length }
        }
      }
    ]);
  });

  it("reports when a registered module exports nothing", () => {
    const source = 'import { request } from "api";';

    expect(
      AS005(source, {
        modules: {
          api: []
        }
      })
    ).toEqual([
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'request'. The module exports nothing.",
        filename: "<input>",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("request") },
          end: { line: 1, column: 17, offset: source.indexOf("request") + "request".length }
        }
      }
    ]);
  });

  it("accepts a Map and lists deduped sorted exports", () => {
    const source = 'import { missing } from "api";';

    expect(
      AS005(source, {
        modules: new Map([["api", ["zeta", "alpha", "alpha", "default"]]])
      })
    ).toEqual([
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'missing'. Available exports: alpha, default, zeta.",
        filename: "<input>",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("missing") },
          end: { line: 1, column: 17, offset: source.indexOf("missing") + "missing".length }
        }
      }
    ]);
  });

  it("accepts typed export maps as registered module exports", () => {
    const source = 'import { request } from "api";';

    expect(
      AS005(source, {
        modules: {
          api: {
            exports: {
              request: "(url: string) => string"
            }
          }
        }
      })
    ).toEqual([]);
  });

  it("reports each invalid named import and keeps namespace imports valid", () => {
    const source = [
      'import { missing, absent as alias } from "api";',
      'import * as api from "api";'
    ].join("\n");

    expect(
      AS005(source, {
        filename: "rule.js",
        modules: {
          api: ["request"]
        }
      })
    ).toEqual([
      {
        code: "AS005",
        severity: "error",
        message: "Module 'api' does not export 'missing'. Available exports: request.",
        filename: "rule.js",
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
        message: "Module 'api' does not export 'absent'. Available exports: request.",
        filename: "rule.js",
        line: 1,
        column: 19,
        span: {
          start: { line: 1, column: 19, offset: source.indexOf("absent") },
          end: { line: 1, column: 25, offset: source.indexOf("absent") + "absent".length }
        }
      }
    ]);
  });
});
