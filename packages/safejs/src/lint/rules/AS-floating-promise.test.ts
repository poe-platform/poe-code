import { describe, expect, it } from "vitest";

import { AS_FLOATING_PROMISE } from "./AS-floating-promise.js";
import type { Modules } from "./module-registry.js";

const modules: Modules = {
  host: {
    exports: {
      myAsyncHost: {
        async: true,
        type: "() => Promise<unknown>"
      },
      default: {
        async: true,
        type: "() => Promise<unknown>"
      },
      other: "() => unknown",
      syncHost: "() => unknown"
    }
  }
};

function codes(source: string): string[] {
  return AS_FLOATING_PROMISE(source, { filename: "rule.ajs", modules }).map(
    (diagnostic) => diagnostic.code
  );
}

describe("AS_FLOATING_PROMISE", () => {
  it("reports an async host call used as a statement", () => {
    const source = ['import { myAsyncHost } from "host";', "myAsyncHost();"].join("\n");

    expect(AS_FLOATING_PROMISE(source, { filename: "rule.ajs", modules })).toEqual([
      {
        code: "AS-FLOATING-PROMISE",
        severity: "warning",
        message: "Promise-returning call is not awaited, returned, stored, or chained.",
        filename: "rule.ajs",
        line: 2,
        column: 1,
        span: {
          start: { line: 2, column: 1, offset: source.indexOf("myAsyncHost();") },
          end: {
            line: 2,
            column: "myAsyncHost()".length + 1,
            offset: source.indexOf("myAsyncHost();") + "myAsyncHost()".length
          }
        }
      }
    ]);
  });

  it("allows an awaited async host call", () => {
    expect(
      codes(['import { myAsyncHost } from "host";', "await myAsyncHost();"].join("\n"))
    ).toEqual([]);
  });

  it("allows a returned async host call inside an async arrow", () => {
    expect(
      codes(
        [
          'import { myAsyncHost } from "host";',
          "const run = async () => {",
          "  return myAsyncHost();",
          "};"
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("allows Promise.all consumption of async host calls", () => {
    expect(
      codes(
        [
          'import { myAsyncHost, other } from "host";',
          "Promise.all([myAsyncHost(), other()]);"
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("allows an async host call held in a binding", () => {
    expect(
      codes(['import { myAsyncHost } from "host";', "const p = myAsyncHost();"].join("\n"))
    ).toEqual([]);
  });

  it("reports an async host call used as an if consequent statement", () => {
    expect(
      codes(['import { myAsyncHost } from "host";', "if (cond) myAsyncHost();"].join("\n"))
    ).toEqual(["AS-FLOATING-PROMISE"]);
  });

  it("reports a local async arrow call used as a statement", () => {
    expect(codes(["const load = async () => 1;", "load();"].join("\n"))).toEqual([
      "AS-FLOATING-PROMISE"
    ]);
  });

  it("reports async host calls imported through namespace and default bindings", () => {
    expect(codes(['import * as host from "host";', "host.myAsyncHost();"].join("\n"))).toEqual([
      "AS-FLOATING-PROMISE"
    ]);
    expect(codes(['import myAsyncHost from "host";', "myAsyncHost();"].join("\n"))).toEqual([
      "AS-FLOATING-PROMISE"
    ]);
  });

  it("reports async calls in statement-position logical and conditional branches", () => {
    expect(
      codes(['import { myAsyncHost } from "host";', "cond && myAsyncHost();"].join("\n"))
    ).toEqual(["AS-FLOATING-PROMISE"]);
    expect(
      codes(['import { myAsyncHost } from "host";', "cond ? myAsyncHost() : other();"].join("\n"))
    ).toEqual(["AS-FLOATING-PROMISE"]);
  });

  it("does not report returned or stored logical and conditional async branches", () => {
    expect(
      codes(
        [
          'import { myAsyncHost } from "host";',
          "const run = async () => {",
          "  return cond && myAsyncHost();",
          "};"
        ].join("\n")
      )
    ).toEqual([]);
    expect(
      codes(
        ['import { myAsyncHost } from "host";', "const p = cond ? myAsyncHost() : other();"].join(
          "\n"
        )
      )
    ).toEqual([]);
  });

  it("uses local scope shadowing before reporting async host calls", () => {
    expect(
      codes(
        [
          'import { myAsyncHost } from "host";',
          "const run = (myAsyncHost) => {",
          "  myAsyncHost();",
          "};"
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("allows a sync host call used as a statement", () => {
    expect(codes(['import { syncHost } from "host";', "syncHost();"].join("\n"))).toEqual([]);
  });

  it("allows a then chain on an async host call", () => {
    expect(
      codes(['import { myAsyncHost } from "host";', "myAsyncHost().then(() => {});"].join("\n"))
    ).toEqual([]);
  });

  it("reports await-less Promise factory calls used as statements", () => {
    expect(codes("Promise.resolve(1);")).toEqual(["AS-FLOATING-PROMISE"]);
  });
});
