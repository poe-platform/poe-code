import { describe, expect, it } from "vitest";

import { AS_ASYNC_NOT_NEEDED, fixASAsyncNotNeeded } from "./AS-async-not-needed.js";

function codes(source: string): string[] {
  return AS_ASYNC_NOT_NEEDED(source, { filename: "rule.js" }).map((diagnostic) => diagnostic.code);
}

describe("AS_ASYNC_NOT_NEEDED", () => {
  it.each([
    "async function read(){for await(const value of []){}}",
    "const read=async()=>{for await(const value of []){}};",
    "const object={async read(){for await(const value of []){}}};",
    "class Box{async read(){for await(const value of []){}}}"
  ])("counts for-await as an await: %s", source => {
    expect(codes(source)).toEqual([]);
    expect(fixASAsyncNotNeeded(source)).toBe(source);
  });
  it.each([
    "async function* items(){yield 1}",
    "const items=async function*(){return 1};",
    "const object={async *items(){yield 1}};",
    "class Box{async *items(){yield 1}}"
  ])("preserves required async generator semantics: %s", source => {
    expect(codes(source)).toEqual([]);
    expect(fixASAsyncNotNeeded(source)).toBe(source);
  });
  it("reports async arrow functions without await in the body", () => {
    const source = "const f = async () => 1;";

    expect(AS_ASYNC_NOT_NEEDED(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-ASYNC-NOT-NEEDED",
        severity: "info",
        message: "Async functions without await should remove the async keyword.",
        filename: "rule.js",
        line: 1,
        column: 11,
        span: {
          start: { line: 1, column: 11, offset: source.indexOf("async") },
          end: {
            line: 1,
            column: 16,
            offset: source.indexOf("async") + "async".length
          }
        }
      }
    ]);
  });

  it("allows async arrow functions with await in the body", () => {
    expect(codes("const f = async () => await x;")).toEqual([]);
  });

  it("allows default-exported async arrow functions without await", () => {
    expect(codes("export default async () => 1;")).toEqual([]);
  });

  it("reports nested async arrows without await inside async arrows with await", () => {
    const source = "const f = async () => { const g = async () => 1; return await x; };";

    expect(AS_ASYNC_NOT_NEEDED(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-ASYNC-NOT-NEEDED",
        severity: "info",
        message: "Async functions without await should remove the async keyword.",
        filename: "rule.js",
        line: 1,
        column: 35,
        span: {
          start: { line: 1, column: 35, offset: source.lastIndexOf("async") },
          end: {
            line: 1,
            column: 40,
            offset: source.lastIndexOf("async") + "async".length
          }
        }
      }
    ]);
  });

  it("fixes unnecessary async keywords", () => {
    expect(fixASAsyncNotNeeded("const f = async () => 1;")).toBe("const f = () => 1;");
  });
});
