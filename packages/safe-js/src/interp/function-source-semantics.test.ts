import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { hashSource } from "../parse/hash.js";

describe("versioned function source semantics", () => {
  it("marks new source-aware execution as v8", async () => {
    expect(await run("function fn(){}return String(fn)")).toMatchObject({
      ok: true,
      returnValue: "function fn(){}",
      snapshot: { executionSemantics: "jobs-v8" }
    });
  });

  // Synthetic empty checkpoints select a mode; preserved historical fixtures
  // remain unchanged in the independent v6/v7 compatibility suites.
  it.each(["jobs-v6", "jobs-v7"])(
    "retains %s conversion and its hash without relabeling",
    async (executionSemantics) => {
      const source = "function fn(){/*aaaa*/}return [String(fn),typeof fn.toString]";
      const sourceHash = hashSource(source, undefined, false);
      const snapshot = { version: 1 as const, executionSemantics, sourceHash };
      const result = await run(source, { snapshot });
      expect(result).toMatchObject({
        ok: true,
        returnValue: ["[object Object]", "undefined"],
        snapshot: { executionSemantics, sourceHash }
      });
      expect(await run(source.replace("aaaa", "bbbb"), { snapshot })).toMatchObject({
        ok: true,
        returnValue: ["[object Object]", "undefined"],
        snapshot: { executionSemantics, sourceHash }
      });
      expect(await run("function fn(){}return String(fn)")).toMatchObject({
        ok: true,
        returnValue: "function fn(){}",
        snapshot: { executionSemantics: "jobs-v8" }
      });
    }
  );

  it.each(["jobs-v6", "jobs-v7"])(
    "keeps explicit guest conversion hooks in %s",
    async (executionSemantics) => {
      const source = "function fn(){}fn.toString=()=> 'custom';return [String(fn),fn.toString()]";
      const snapshot = {
        version: 1 as const,
        executionSemantics,
        sourceHash: hashSource(source, undefined, false)
      };
      expect(await run(source, { snapshot })).toMatchObject({
        ok: true,
        returnValue: ["custom", "custom"]
      });
    }
  );
});
