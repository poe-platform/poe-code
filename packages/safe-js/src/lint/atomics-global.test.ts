import { expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../run.js";

it("accepts implemented Atomics behavior in harness source", async () => {
  const source = "return Atomics.add(new Int32Array([5]),0,7)";
  expect(await run(source)).toMatchObject({ok:true,returnValue:5});
  expect(lint(source)).toEqual([]);
});

it("warns about local Atomics shadowing", () => {
  expect(lint("const Atomics=1;return Atomics")).toEqual([
    expect.objectContaining({code:"AS-SHADOW-GLOBAL",severity:"warning"})
  ]);
});

it("accepts shared-buffer Atomics behavior in harness source", async () => {
  const source="return Atomics.add(new Int32Array(new SharedArrayBuffer(4)),0,7)";
  expect(await run(source)).toMatchObject({ok:true,returnValue:0});
  expect(lint(source)).toEqual([]);
});
