import { describe, expect, it } from "vitest";

import { AS_MISSING_ASYNC, fixASMissingAsync } from "./AS-missing-async.js";

function codes(source: string): string[] {
  return AS_MISSING_ASYNC(source, { filename: "rule.js" }).map((diagnostic) => diagnostic.code);
}

describe("AS_MISSING_ASYNC", () => {
  it("reports a non-async arrow function with an expression-body await", () => {
    const source = "const f = () => await x;";

    expect(AS_MISSING_ASYNC(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-MISSING-ASYNC",
        severity: "error",
        message: "Functions that contain await must be marked async.",
        filename: "rule.js",
        line: 1,
        column: 11,
        span: {
          start: { line: 1, column: 11, offset: source.indexOf("() =>") },
          end: {
            line: 1,
            column: 24,
            offset: source.indexOf("() => await x") + "() => await x".length
          }
        }
      }
    ]);
  });

  it("allows async arrow functions with await", () => {
    expect(codes("const f = async () => await x;")).toEqual([]);
  });

  it("allows non-async arrow functions without await", () => {
    expect(codes("const f = () => { return x; };")).toEqual([]);
  });

  it("does not report an outer non-async arrow when only a nested async arrow awaits", () => {
    expect(codes("const f = () => async () => await x;")).toEqual([]);
  });

  it("reports an outer non-async arrow when await appears outside the nested arrow", () => {
    const source = "const f = () => { const g = async () => await y; return await x; };";

    expect(AS_MISSING_ASYNC(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-MISSING-ASYNC",
        severity: "error",
        message: "Functions that contain await must be marked async.",
        filename: "rule.js",
        line: 1,
        column: 11,
        span: {
          start: { line: 1, column: 11, offset: source.indexOf("() =>") },
          end: {
            line: 1,
            column: 67,
            offset:
              source.indexOf("() => {") +
              "() => { const g = async () => await y; return await x; }".length
          }
        }
      }
    ]);
  });

  it("allows top-level await", () => {
    expect(codes("await x;")).toEqual([]);
  });

  it("fixes missing async keywords", () => {
    expect(fixASMissingAsync("const f = () => await x;")).toBe("const f = async () => await x;");
    expect(fixASMissingAsync("const f = x => await x;")).toBe("const f = async x => await x;");
  });

  it("reports awaits in binding patterns inside non-async arrow bodies", () => {
    expect(codes("const f = () => { const [value = await load()] = values; };")).toEqual([
      "AS-MISSING-ASYNC"
    ]);
    expect(codes("const f = () => { const { value = await load() } = values; };")).toEqual([
      "AS-MISSING-ASYNC"
    ]);
  });

  it("reports awaits in assignment targets inside non-async arrow bodies", () => {
    expect(codes("const f = () => { target[await key()] = value; };")).toEqual([
      "AS-MISSING-ASYNC"
    ]);
    expect(codes("const f = () => { ({ value = await load() } = source); };")).toEqual([
      "AS-MISSING-ASYNC"
    ]);
    expect(codes("const f = () => { for (target[await key()] of values) run(); };")).toEqual([
      "AS-MISSING-ASYNC"
    ]);
  });

  it("reports awaits in catch parameters inside non-async arrow bodies", () => {
    expect(
      codes("const f = () => { try { run(); } catch ({ value = await load() }) {} };")
    ).toEqual(["AS-MISSING-ASYNC"]);
  });

  it("reports nested non-async arrows from arrow parameters and assignment targets", () => {
    expect(codes("const f = (value = (() => await x)) => value;")).toEqual(["AS-MISSING-ASYNC"]);
    expect(codes("const f = () => { (() => await x).value = 1; };")).toEqual(["AS-MISSING-ASYNC"]);
  });
});
